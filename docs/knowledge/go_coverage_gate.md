---
kind: go_coverage_gate
name: 覆盖率门禁语句加权口径
tier: architecture
category: utils
status: active
source_files:
  - scripts/check-go-coverage-threshold.ts
auto_fields:
  symbols_with_lines:
    - aggregateByPackage
    - CoverBlock
    - DEFAULT_THRESHOLDS
    - DEFAULTS
    - parseCoverProfileText
    - pkgPercent
    - PkgStatements
    - resolveThreshold
tests:
  - tests/test_check_go_coverage_threshold.ts
use_when:
  - 覆盖率门禁
  - go 覆盖率
  - 包覆盖率 0%
  - 单函数拖垮整包
  - coverprofile 解析
pitfalls:
  - "包覆盖率必须按语句数加权（covered 语句/总语句）；曾用「文件内函数百分比最小值」→ 一个 0% 函数把整包报成 0%"
  - "判据是 profile 原文的语句数；`go tool cover -func` 输出只有百分比、没有语句数，做不了加权"
  - "阈值 pattern 匹配的是包路径（以包名结尾、无尾斜杠），`internal/app/install/` 这种尾斜杠写法永远匹配不到该包自身"
  - "本脚本用具名导出供契约测试 import，退出必须用 process.exitCode + 自然返回；用 process.exit(N) 会在 Windows 句柄清理阶段触发 libuv 断言（0xC0000409）"
  - "入口包（根 main / cmd/updater / 代码生成器）的 main() 测试内不可达，必然 0%，应进 SKIP_PACKAGES 而非当失败"
quick_groups:
  - Go 覆盖率
quick_intents:
  - "Go 覆盖率门禁怎么算包覆盖率"
  - "为什么某包报 0% 覆盖率"
quick_risk_lines:
  - scripts/check-go-coverage-threshold.ts|aggregateByPackage
invariant_anchors:
  - scripts/check-go-coverage-threshold.ts|aggregateByPackage
  - scripts/check-go-coverage-threshold.ts|resolveThreshold
---

# 覆盖率门禁语句加权口径

## 概览

`scripts/check-go-coverage-threshold.ts` 消费 `go test -coverprofile` 产物，按包比对覆盖率阈值。
判据是 **语句数加权**（覆盖语句数 / 总语句数），与 Go 官方 `go test -cover` 同口径。

2026-09 修正前用的是 `go tool cover -func` 的逐函数百分比，且把「文件内所有函数百分比的
**最小值**」当文件分、再对文件求均值当包分。后果是一个 0% 函数就代表整包——实测 **19 个包被误判失败**：

| 包 | 旧口径 | 真实 |
|---|---|---|
| `go/watcher` | 0.0% | 88.8% |
| `go/instance` | 0.0% | 93.6% |
| `go/scanner` | 0.0% | 91.0% |

典型触发者：`watcher.WaitReady()`——注释明写「测试可用于替代 `time.Sleep`」的辅助方法，
生产代码零调用、测试也不会调它，天然 0%，却把整个包拖成 0%。

## 核心职责

- `parseCoverProfileText`：解析 profile 原文为覆盖块（file + 语句数 + 命中次数）。
  **必须读原文**——`-func` 输出不含语句数，拿不到加权所需的分母。
- `aggregateByPackage`：按包累加语句数，返回 `{covered, total}`。语句数跨文件累加，
  这是「单函数 0% 不拖垮整包」的机制保证。
- `pkgPercent`：语句加权百分比；`total` 为 0 时返回 0，防 NaN 扩散进门禁判定。
- `resolveThreshold`：命中**最具体**规则与全局下限取高值。规则表按具体度降序排列，
  首个命中即最具体。
- `DEFAULT_THRESHOLDS` / `SKIP_PACKAGES`：阈值表与豁免表。

## 对外 API / 入口

```bash
node scripts/check-go-coverage-threshold.ts                          # 文本报告（默认读 go-cover.out）
node scripts/check-go-coverage-threshold.ts --fail-on-below 20       # 抬高全局下限
node scripts/check-go-coverage-threshold.ts --thresholds internal/app/:30
node scripts/check-go-coverage-threshold.ts --json                   # CI / 子代理消费
```

具名导出：`parseCoverProfileText` / `aggregateByPackage` / `pkgPercent` /
`resolveThreshold` / `DEFAULT_THRESHOLDS`（别名 `DEFAULTS`）——由契约测试 import 锁定。

## 与其他子系统关系

- 生成方：`go test ./go/... ./internal/... -coverprofile=go-cover.out`（`go-cover.out` 已被 `.gitignore` 覆盖）。
- 同族门禁：`check-go-diff-coverage.ts`（增量行覆盖）、`scripts/hooks/go-coverage-hint.ts`
  （commit 时按包提示，非阻断）。
- **本门禁刻意旁路** pre-commit/CI（见 doctor 覆盖口径输出），需手动或 CI 显式调用。

## 不变量

- 包覆盖率 = Σ覆盖语句 / Σ总语句；不得退化为「函数百分比最小值」或「文件百分比均值」。
- 阈值 pattern 匹配包路径（以包名结尾），写尾斜杠会静默失配。
- 退出码：达标 0；未达标 / 拼错 flag / profile 缺失均 1，且不得出现崩溃码 0xC0000409。
- 入口包与代码生成器进 `SKIP_PACKAGES`，不以 0% 论失败。

## 相关

- 契约测试：`tests/test_check_go_coverage_threshold.ts`（聚合口径 + 退出码双锁）
- 知识卡：`script_shared_cores.md`（scripts 共享核演进）
