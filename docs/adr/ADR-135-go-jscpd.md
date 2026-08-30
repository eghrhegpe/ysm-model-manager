# ADR-135：Go 端 jscpd 重复代码检测与增量门禁

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-30
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/jscpd-go.mjs;scripts/pre-push-gate.mjs;scripts/baseline/jscpd-go-baseline.json`

---

## 1. 背景（Context）

- 项目长期以 jscpd 治理前端 `.ts` 重复代码，基线存于 `scripts/baseline/deadcode-baseline.json` 的 `jscpd` 数组（78 项），由 `check-deadcode-baseline.mjs` 维护。Go 端（`go/`，323 个 `.go`）此前无重复代码门禁。
- 议题：Go 端 jscpd 接入范围三选一——① 仅 `go/`；② `go/` + `rust-core/`；③ 全仓库 `*.go *.rs *.ts`。
- 约束：① 与 AGENTS.md「前端 vs Go 职责红线」一致，类型判定以 Go 为唯一事实源、前端只读不判；② 不得污染/重洗前端既有 78 条基线；③ `rust-core/` 现处 poc 阶段（`src/` 仅 7 个 `.rs`），重复本就少。

## 2. 决策（Decision）

- 采纳方案 ①：仅扫 `./go/**/*.go`，Go 债务独立账本。
- Go 端复用前端已装的 jscpd v5（Rust 内核，5.0.14）二进制（`frontend/node_modules/jscpd`），不另装依赖。
- baseline 独立落 `scripts/baseline/jscpd-go-baseline.json`（`clones` 数组存 `A#B` 文件对，仿前端格式），**绝不写回** `deadcode-baseline.json` 的 `jscpd` 段，前端基线零耦合。
- 增量门禁语义：baseline 冻结现状（首版 174 对），只拦「新增重复对」、不惩罚存量；接入 `pre-push-gate.mjs` 的 `GO_STATIC_TOOLS`（推送含 Go 变更时）与 `ALL_STATIC_TOOLS`（`doctor --all` 全量），单一实现源覆盖双路径。
- `rust-core/` 账本延后：待其脱离 poc、成真栈时，按方案②思路**单独**开 `jscpd-rust.mjs` + `jscpd-rust-baseline.json`，不与 go 混（避免跨语言混 baseline、归属裁剪成本 > 收益）。

## 3. 后果（Consequences）

- 正面：Go 重复代码引入即被 pre-push 阻断，逼改动方当场处理；Go/前端/rust 三账本分离、各自演进不互扰；复用同款二进制，无新增依赖与版本漂移。
- 负面/成本：多一份 baseline 需维护；Go 端 `*_test.go` 的 fixture 套路（trivial/decode_inject/adversarial）占基线多数，当前全量冻结——若需聚焦真源码，后续可加 `--ignore "**/*_test.go"` 另起非测试基线（二选一，未采用）。
- 已知遗留：未挂 `doctor`/`pre-push` 之外的 CI 独立长跑；rust 账本未开（预期内，待 poc 出）。

## 4. 数据溯源

- 来源：实跑 `node frontend/node_modules/jscpd/run-jscpd.js --pattern './go/**/*.go' --format go`。
- 结果：扫描 312 文件，457 重复块 → 去重 174 个唯一文件对，复制率 4.73%；首版 baseline 已冻结；`--check` 门禁通过（exit 0），`--json` 契约供 `pre-push-gate` 的 `runTools` 消费。

<!-- 文件名: go-jscpd.md → 实际文件 ADR-135-go-jscpd.md -->
