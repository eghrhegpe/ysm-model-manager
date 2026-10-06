---
kind: golangci-lint
name: golangci-lint（Go 静态分析真空面）
tier: architecture
category: go
status: active
source_files:
  - .golangci.yml
  - scripts/pre-push-gate.ts
auto_fields:
  symbols_with_lines: []
use_when:
  - golangci-lint
  - Go 静态分析
  - errcheck
  - 未检查错误
  - lint 基线
  - new-from-rev
  - 增量 lint
pitfalls:
  - 「全量跑必红」→ 门禁只能跑 `--new-from-rev`，全量存量债会淹没信号；清零另案（条数刻意不写死，ADR-162）
  - 「未安装不是失败」→ pre-push 检测不到二进制时降级 debt 跳过，不阻断；安装走 `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`
  - 「无基线 rev 不是失败」→ 孤儿分支/无远端时解析不出 merge-base，同款降级跳过，避免存量债堵门
  - 「别开 enable-all」→ 一次性抛数百条历史债直接堵死 push 通道；白名单只收 6 类零覆盖 linter
  - 「别启用 govet/gofmt/dupl」→ govet 与既有 `go vet` 重复；gofmt/dupl 自研机制有自动 stage 与漂移账本，golangci-lint 接不住（ADR-205 §2.2）
  - 「版本 < v1.64 解析 go1.26 directive 直接失败」→ 必须 v1.64+ / v2.x，实测 v2.13.2 built with go1.26.3 通过
quick_groups:
  - 门禁与脚本
quick_intents:
  - 为什么 Go 侧要引入 golangci-lint
  - lint 报了多少存量债
  - push 被 golangci-lint 阻断怎么办
quick_risk_lines:
  - Go 曾是静态分析真空面（go vet 独苗）：golangci-lint 白名单制补齐——.golangci.yml 为 default: none + 显式 enable，勿开 enable-all
  - 存量债不惩罚：pre-push-gate 跑 --new-from-rev 只拦本次引入（全量必红），未安装/无基线自动降级跳过
  - push 被阻断先看 FAIL 块定位 linter 与文件；语义误报用 //nolint 注明 linter 名与理由，禁止 git push --no-verify 绕过
invariant_anchors:
  - .golangci.yml|default: none
  - .golangci.yml|ADR-205
  - scripts/pre-push-gate.ts|--new-from-rev
---

# golangci-lint（Go 静态分析真空面）

## 概览

Go 侧静态分析长期只有 `go vet` 一根独苗，与 TS 侧密集门禁网形成显著落差。ADR-205 决定引入
golangci-lint **只补真空面**（errcheck / unused / ineffassign / gocritic / gocyclo / staticcheck），
不接管自研的 gofmt 调度与 jscpd-go 重复检测——理由是后者有自动 stage 语义与漂移账本，
golangci-lint 结构上接不住。

## 核心职责

- **真空面补齐**：`go vet` 结构上覆盖不到的未检查错误返回（errcheck）等高价值缺陷。
- **增量门禁**：只检本次推送新增代码，存量债务不惩罚。

## 测试文件豁免策略（2026-09-08 实测校准）

首次接入时增量 23 条中 **20 条在 `_test.go`**（噪音/信号比 87%）。按「只补真空面、不制造噪音」
原则，对测试文件定向豁免两类 linter：**生产代码一律照常生效**。

| linter | 对 `*_test.go` | 理由 |
|--------|----------------|------|
| `errcheck` | **豁免** | 13 条中 12 条是 `defer resp.Body.Close()` / `w.Write(...)` 测试辅助调用；进程一退资源全释放，风险≈0 |
| `gocyclo` | **豁免** | 集成测试函数复杂度 22 / 32，分支来自 `if err != nil { t.Fatalf }` 断言序列，非业务逻辑复杂度 |
| `gocritic` / `staticcheck` / `ineffassign` / `unused` | 生效 | SA1012（传 nil Context）等仍拦，测试代码质量不放松 |

豁免后增量 23 → 11 → 修完生产 3 条 + 测试机械项后 **0 条**。

> 反面案例（勿重蹈）：`TestNewDownloadQueue_NilParent` 的 nil 是**被测输入**（验证 nil parent 回退
> Background），差点被 SA1012 的「换个 TODO()」机械修复掉语义——此处必须 `//nolint:staticcheck`。
> 同理 `TestFindDuplicateFiles_Guard` 的注释误判「无重复」，实测返回 1 组；改断言前先跑实测。

## 接线位置

| 位置 | 说明 |
|------|------|
| `.golangci.yml` | 白名单配置（`default: none` + 6 类 enable），显式排除 `upstream/` `build/` `node_modules/` |
| `scripts/pre-push-gate.ts` | Go 域，`go vet` 之后执行 `golangci-lint run --new-from-rev=<base> ./...` |
| `.github/workflows/test.yml` | 「Go 静态分析（golangci-lint，仅增量）」step + `actions/cache` 缓存分析结果 |

基线 rev 解析走 `resolveBaseRev()`（pre-push-gate.ts 模块级）：远端 oid → `merge-base origin/<branch>`
→ `origin/HEAD` → `origin/main` → `origin/master`。与 `resolveChanges()` 的 fallback 链**同口径**，
改一处须同步另一处，否则「新增代码」判定与「变更文件」判定会漂移。

## 实测数据（2026-10-06 复测）

> **具体条数刻意不写死**（ADR-162 去行号/去计数精神：数字随收债与并行改动漂移、无人维护，
> 本卡曾写死「736 条（errcheck 623 占 85%）」而 errcheck 清零后无人发现——活生生的漂移案例）。
> 需要数字时**当场跑**：全量 `golangci-lint run ./...`，增量 `golangci-lint run --new-from-rev=<base> ./...`。

| 指标 | 实测 |
|------|------|
| 债的**构成**（比条数有用） | **errcheck 已清零**（2026-10-06 本轮清零，此前为最重一类）；余以 **gocyclo（复杂度）+ gocritic（惯用法）** 为主，staticcheck / ineffassign / unused 少量 |
| 债的**性质变化** | 从「错误被静默吞掉」（缺陷债）转为「函数过长/写法不地道」（可维护性债）——**两者优先级不同，别再用旧判词评估** |
| 全量耗时 | 冷跑十秒级，缓存命中后 10–30s |
| 增量过滤率 | 2026-09-08 首跑实测约 3%（增量 / 全量）→ `--new-from-rev` 过滤有效，非全量泄漏 |
| 版本兼容 | v2.13.2 built with go1.26.3 通过 |

**口径坑（2026-10-06 实证）**：命令行 `--default none --enable <x>` 的 `--enable` 是**追加**到
`.golangci.yml` 的 enable 列表，**不替换**。想复现门禁口径（也是「全量存量债条数」的权威口径）
必须**裸跑** `golangci-lint run ./...`——带头跑出来的数字偏少且不完整（易被误读成「只剩这几条」）。

## 已知遗留

- **errcheck 已清零**（2026-10-06）：生产代码的未检查错误返回归零；测试文件由配置本身豁免。
- **其余类别存量债未清零**（以复杂度/惯用法为主）：门禁靠增量规避；若哪天需要全量门禁，须先清零或
  建 baseline 账本（另案，参照 jscpd-go 的 `scripts/baseline/` 范式）。
- **收债靠改代码，不靠关闸**：门槛（`gocyclo.min-complexity`）与测试文件豁免是 ADR-205 的拍板结果，
  为让全量转绿而放宽配置＝把门禁废掉，禁止。
