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
  symbols_with_lines:
    - fallbackBranchRevs
    - resolveBaseRev
use_when:
  - golangci-lint
  - Go 静态分析
  - errcheck
  - 未检查错误
  - lint 基线
  - new-from-rev
  - 增量 lint
pitfalls:
  - 「全量跑会撞 736 条存量债」→ 门禁只能跑 `--new-from-rev`，全量必红（errcheck 623 占 85%），存量清零另案
  - 「未安装不是失败」→ pre-push 检测不到二进制时降级 debt 跳过，不阻断；安装走 `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`
  - 「无基线 rev 不是失败」→ 孤儿分支/无远端时解析不出 merge-base，同款降级跳过，避免存量债堵门
  - 「别开 enable-all」→ 一次性抛数百条历史债直接堵死 push 通道；白名单只收 6 类零覆盖 linter
  - 「别启用 govet/gofmt/dupl」→ govet 与既有 `go vet` 重复；gofmt/dupl 自研机制有自动 stage 与漂移账本，golangci-lint 接不住（ADR-205 §2.2）
  - 「版本 < v1.64 解析 go1.26 directive 直接失败」→ 必须 v1.64+ / v2.x，实测 v2.13.2 built with go1.26.3 通过
quick_groups:
  - 门禁
  - Go
  - 静态分析
quick_intents:
  - 为什么 Go 侧要引入 golangci-lint
  - lint 报了多少存量债
  - push 被 golangci-lint 阻断怎么办
quick_risk_lines:
  - .golangci.yml|default: none
  - scripts/pre-push-gate.ts|--new-from-rev
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

## 实测数据（2026-09-08）

| 指标 | 实测 |
|------|------|
| 全量存量债 | **736 条**（errcheck 623 / gocyclo 51 / gocritic 40 / staticcheck 12 / unused 6 / ineffassign 4） |
| 全量耗时 | 18.8s（冷），缓存命中后 10–30s |
| 增量（`origin/main..HEAD`） | **23 条**（errcheck 13 / staticcheck 4 / gocritic 3 / gocyclo 2 / ineffassign 1） |
| 增量过滤率 | 3.1%（23 / 736）→ `--new-from-rev` 过滤有效，非全量泄漏 |
| 版本兼容 | v2.13.2 built with go1.26.3 通过 |

## 已知遗留

- **736 条存量债未清零**：门禁靠增量规避；若哪天需要全量门禁，须先清零或建 baseline 账本（另案，参照 jscpd-go 的 `baseline/` 范式）。
- **未推送改动已检出 23 条**：本地 push 会被真实阻断，属预期行为（新代码不许新增 lint 问题），需修完再推。
