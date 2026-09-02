---
kind: script_shared_cores
name: scripts 共享核演进（diff-coverage-core + cycles）
tier: architecture
category: utils
source_files:
  - scripts/_lib/diff-coverage-core.ts
  - scripts/_lib/cycles.ts
use_when:
  - 覆盖率门禁
  - diff-coverage
  - 循环依赖
  - 共享核
  - _lib
  - check-circular
  - findCycles
  - 脚本去重
status: active
---
# scripts 共享核演进（diff-coverage-core + cycles）

## 概览

`scripts/_lib/` 承载跨脚本共享逻辑。2026-09 按「四脚本镜像嫌疑分析」实测后，新增两个共享核，消除两对镜像脚本的重复：

| 共享核 | 消费方 | 消除的重复 |
|--------|--------|-----------|
| `diff-coverage-core.ts` | `check-diff-coverage.mjs` / `check-go-diff-coverage.mjs` | git 变更收集 + rename 处理 + 建议区块（~250 行） |
| `cycles.ts` | `check-circular.mjs` / `check-circular-go.mjs` | DFS 三色环检测 findCycles（~75 行，两处 37 行逐行相同） |

演进方向与 `scan-files.ts` 注释「删除各脚本内联 walk/resolveImport 样板」一致：**语言无关的纯函数抽核，语言专属策略留在入口**。

## 核心职责

- **diff-coverage-core**：`git()`（失败返回 null，fail-closed 契约）/ `getChangedFiles` / `addLinesFromDiff` / `parseRenameStatus` / `detectRenames` / `getChangedLines` / `buildSuggestBlock`（参数化 title/noun/hint，前端版与 Go 版文案区分）。
- **cycles**：`findCycles(graph, maxCycles=100)` → `{ cycles, truncated }`。环以「排序 key 去重」+「原始顺序链」存 Map；maxCycles 截断防稠密环区指数爆炸。

## 对外 API / 入口

- 入口脚本 re-export 共享函数，**契约测试 import 路径不变**：
  - `tests/test_check_diff_coverage.mjs` / `tests/test_check_go_diff_coverage.mjs` 从入口脚本 import（`addLinesFromDiff` / `parseRenameStatus` / `statementPctForChangedLines` / `buildSuggestBlock` 等），签名与抽核前一致。
  - `tests/test_scripts_json.mjs` 锁定 `check-circular.mjs --json` JSON 形状。
- CLI 契约不变：`--suggest --staged` / `--files --json` / 退出码 0/1/2 语义原样保留。

## 与其他子系统关系

- 依赖 `_lib/scan-files.ts`（ROOT）+ `_lib/proc.ts`（run）。
- `check-circular-go.mjs` 的目录遍历（`collectGo` 自定义 walk go/+internal/+根级不递归）不抽核——目录结构特殊，非共享样板。
- `port-align.mjs` / `line-counter.mjs` 仅共享 proc/scan-files 基建，无重复逻辑，不属本卡范围。

## 不变量

- **行为零变更**：抽核只消除重复，不改变 CLI 输出、退出码、JSON 形状、测试契约。
- **fail-closed**：`git()` 失败返回 null（调用方拒绝空跑放行），成功无输出返回 ''。
- **文案参数化**：buildSuggestBlock 的标题/称谓/提示由入口传参，测试锁定的逐字文案（「## Go 覆盖率建议（非阻断）」等）不可改。

## 实测数据（2026-09，P1/P2 判伪优化的依据）

- `git diff` 单次固定开销 ~36ms（进程启动，与文件数无关）→ **P1 批量 pathspec 优化收益极小**（40 文件 PR 省 ~1.4s），且要改 getChangedLines API + 测试，不划算。
- `go test -coverprofile ./go/...` 全包串行仅 **13.2s**（冷缓存才可能触 120s 超时）→ **P2 并行化收益 ≈ 0**，串行 120s 超时是正确兜底。
- 结论：**不要为这两个伪优化动代码**；若未来出现「一次 push 改 100+ 文件」或「coverprofile 常态 >1min」再重新评估。

## 相关

- `docs/knowledge/` 其它 `category: utils` 卡
- ADR-043（check-scripts fail-closed 契约，git() null 语义来源）
- `scripts/_lib/scan-files.ts`（共享层演进方向注释）
