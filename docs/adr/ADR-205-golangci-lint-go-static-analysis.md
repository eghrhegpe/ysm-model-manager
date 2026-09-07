# ADR-205：Go 静态分析引入 golangci-lint（仅补真空面，不接管自研 gofmt/jscpd-go）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-08
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/pre-push-gate.ts:506 / .github/workflows/test.yml:143 / scripts/jscpd-go.ts / .githooks/pre-commit:213-235`

---

## 1. 背景（Context）

联邦 Go 侧（458 个 `.go` 文件，`go1.26.3`）的静态分析长期只有一根独苗：`go vet`，接线于 `scripts/pre-push-gate.ts:506` 与 `.github/workflows/test.yml:143`。TS 侧已建成密集门禁网（`check-path-hygiene` / `check-biome` / `check-knowledge-drift` / gen 守护），Go 侧与之形成显著能力落差。

2026-09-08 评估「引入 golangci-lint 是否会与自研门禁‘铺两层’」，实测结论：

| 维度 | 实测结论 |
|------|----------|
| 接入现状 | 未安装 golangci-lint、无 `.golangci.yml` —— 属**零接入**，不存在叠加前提 |
| 现有 Go 检查 | 仅 `go vet`（覆盖 printf / atomic / copylocks / structtag 一类 analyzer） |
| 真正零覆盖 | `errcheck` / `unused` / `ineffassign` / `gocritic` / `gocyclo`（`staticcheck` 属对 `go vet` 的增量增强，非从零） |
| 与自研重叠 | 仅 `gofmt` 调度、`jscpd-go`（近似 `dupl`）—— 且两者均**不可等价替换**（见 §2.2） |

核心问题不是「要不要静态分析」，而是「**如何补真空面而不制造第二套账本**」。联邦此前吃过双账本打架的亏（jscpd 前端/Go 基线曾被迫物理隔离），本决策以此为第一约束。

## 2. 决策（Decision）

### 2.1 引入 golangci-lint，但只补真空面

新增 `.golangci.yml`，采用**白名单式 `enable`**，只收当前零覆盖的 linter：

```yaml
linters:
  enable:
    - errcheck
    - unused
    - ineffassign
    - gocritic
    - gocyclo
    - staticcheck
```

不启用 `enable-all`，不追求「一次到位」——增量门禁的第一原则是**不惩罚存量**，全量开启会在首跑一次性抛数百条历史债，直接堵死 push 通道。

### 2.2 显式禁用 gofmt 与 dupl，自研两套机制原地保留

```yaml
linters:
  disable:
    - gofmt
    - dupl
```

理由不是「重复」，而是**语义接不住**：

- **gofmt**：golangci-lint 的 `gofmt` linter 只报告、不修复、更不 `git add`。pre-commit 现有语义是「自动修复 + 重新 stage」（`.githooks/pre-commit:213-235`），且守卫「跳过含未暂存编辑的文件」以防混拼半成品。golangci-lint 若要接管需额外接线，收益为负。**保留自研调度**。
- **dupl**：与 `jscpd-go` 算法不同源（dupl = token 序列函数克隆；jscpd = 跨文件复制块）。更关键的是 `jscpd-go` 携带**独立 baseline 账本 + 搬迁漂移匹配**（`scripts/baseline/jscpd-go-baseline.json`、`_lib/jscpd-pairs.ts` 的 `matchDrift`，可识别 added↔fixed basename 漂移），golangci-lint 无等价机制。撤掉等于丢失漂移检测能力。**保留 jscpd-go**，不设并行期——本决策不做「两套重复检测并存」的中间态。

### 2.3 接线于 pre-push 与 CI，沿用增量范式

- `pre-push-gate.ts` 在 `go vet` 之后追加一步，并入既有 `record()` 计时与失败 tail 上报；命令形如 `golangci-lint run --new-from-rev=<merge-base>`。
- CI（`.github/workflows/test.yml`）同侧补一步，并**必须显式配置 `actions/cache`** 命中 `~/.cache/golangci-lint` —— 否则缓存论断落空，每次冷跑。
- pre-commit **不接** golangci-lint：与 `go vet` 现有定位一致（重活留给 push/CI），避免每次击键级提交付全量代价。

### 2.4 版本兼容为前置硬门槛

`go1.26.3` 属较新版本，golangci-lint v1.5x 老版本解析新版 `go` directive 会直接失败。接入前必须锁定 **v1.64+ 或 v2.x** 并实测通过。此项不通过则整体不落地。

### 2.5 增量前提须显式记录

`--new-from-rev` 依赖 merge-base 参照存在：push 到**无上游的新分支**时退化为全量跑，属已知且可接受行为（首分支创建低频）。缓存命中后单轮预期 10–30 秒，冷跑 1–3 分钟。

## 3. 后果（Consequences）

### 正面

1. Go 侧从「1 个 analyzer」跃迁到「6 类 linter」，首次获得 `errcheck`（未检查错误返回）这类高价值缺陷检出能力——这是 `go vet` 结构上无法覆盖的盲区。
2. 与自研门禁**物理零冲突**：golangci-lint 只消费 `.go`，TS 侧全部门禁（`check-path-hygiene` / `check-biome` / `check-knowledge-drift` / 各 gen 守护）照常独立运行，无需任何协调改动。
3. 增量范式与联邦既有思路同构（jscpd baseline 账本、check-biome 增量、diff-coverage），运维心智一致。

### 负面

1. 新增一个外部二进制依赖，本地环境需安装；未安装时门禁须**降级为跳过并告警**，不得硬失败（否则阻塞无该工具的开发机）。
2. push 链路时长增加（冷跑 1–3 分钟），需靠缓存与增量压制。
3. 存量债务会在首次全量跑暴露，需配套基线化策略（另案），否则 `--new-from-rev` 失效场景下直接堵门。

### 已知遗留

| 项 | 处置 |
|----|------|
| 存量 lint 违规的基线化/清零策略 | 本 ADR 不裁定，实施期另立方案 |
| golangci-lint 具体版本锁定与实测 | §2.4 前置门槛，未过不落地 |
| 未安装时的降级路径 | 实施时明确为 warn-skip，与 `gofmt` 不可用时的处理对齐（`.githooks/pre-commit:235`） |

## 4. 数据溯源

| 结论 | 来源 → 结果 |
|------|-------------|
| 零接入 | `command -v golangci-lint` → NOT INSTALLED；根目录 `.golangci*` → 无匹配 |
| Go 规模与版本 | `find go internal -name "*.go" \| wc -l` → 458；`go version` → go1.26.3 windows/amd64 |
| 现有 Go 检查仅 go vet | `scripts/pre-push-gate.ts:506` → `go vet ./go/... ./internal/app/...`；`.github/workflows/test.yml:143` → 同命令 |
| gofmt 自研 stage 语义 | `.githooks/pre-commit:213-235` → `gofmt -w "$f" && git add "$f"`，含未暂存编辑守卫 |
| jscpd-go 漂移账本 | `scripts/jscpd-go.ts` 头注释 + `scripts/baseline/jscpd-go-baseline.json` + `_lib/jscpd-pairs.ts` `matchDrift` |
| TS 侧门禁零重叠 | `scripts/check-path-hygiene.ts` / `check-biome.ts` / `check-knowledge-drift.ts` 全为 TS 侧，golangci-lint 不消费 |

<!-- 文件名: golangci-lint-go-static-analysis.md → 实际文件 ADR-205-golangci-lint-go-static-analysis.md -->
