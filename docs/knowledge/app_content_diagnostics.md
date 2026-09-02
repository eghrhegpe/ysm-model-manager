---
kind: app_content_diagnostics
name: 诊断与冲突页 diagnostics
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/diagnostics/init.ts
  - frontend/src/views/app-content/diagnostics/logs.ts
  - frontend/src/views/app-content/diagnostics/dedup.ts
  - frontend/src/views/app-content/diagnostics/health.ts
  - frontend/src/views/app-content/diagnostics/conflicts.ts
  - frontend/src/views/app-content/diagnostics/perf.ts
  - frontend/src/views/app-content/diagnostics/perf-cli.ts
  - frontend/src/views/app-content/diagnostics/perf-trace.ts
auto_fields:
  symbols_with_lines:
    - bindPerfCopyHandlers
    - EscFn
    - formatSize
    - getDedupConfig
    - initDedupConfig
    - initDiagnostics
    - initPerfPanel
    - loadDiagnosticsLogs
    - loadRuntimeLogs
    - renderHealthReport
    - renderLoadTraceSection
    - resetDedupConfig
    - runGuiFlow
    - runHealthAudit
    - runPerfLog
    - runSingleBench
    - scanConflicts
    - scanSyncConflicts
    - sectionHeader
    - startDedup
  tests:
    - frontend/src/views/app-content/diagnostics/conflicts.test.ts
    - frontend/src/views/app-content/diagnostics/health.test.ts
    - frontend/src/views/app-content/diagnostics/init.test.ts
    - frontend/src/views/app-content/diagnostics/perf.test.ts
    - frontend/src/views/app-content/diagnostics/perf-cli.test.ts
  quick_groups:
    - 模型扫描与仓库管理
  quick_intents:
    - 诊断页、仓库体检、冲突 / 去重
    - 日志查看、性能分析
    - initDiagnostics、startDedup
    - oldest 资历排行
  quick_risk_lines:
    - 去重 / 体检必须经 diagnostics 页发起，禁止在其他页直接调 doDedup
  pitfalls:
    - 在仓库页直接调 doDedup → 缺上下文、无法展示冲突视图；必须走 diagnostics 页 initDiagnostics
    - 性能 trace 未释放 → 长时占用内存；file-bench / perf-trace 完成后必须 stop 回收
  use_when:
    - 诊断页
    - 冲突
    - 去重流程
    - 诊断页日志 tab
    - 性能
    - oldest
  perf:
    - cpu-bound
    - gpu-bound
    - concurrent
  invariant_anchors:
    - frontend/src/views/app-content/diagnostics/init.ts|startDedup
tests:
  - frontend/src/views/app-content/diagnostics/conflicts.test.ts
  - frontend/src/views/app-content/diagnostics/health.test.ts
  - frontend/src/views/app-content/diagnostics/init.test.ts
  - frontend/src/views/app-content/diagnostics/perf.test.ts
  - frontend/src/views/app-content/diagnostics/perf-cli.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 诊断页、仓库体检、冲突 / 去重
  - 日志查看、性能分析
  - initDiagnostics、startDedup
  - oldest 资历排行
quick_risk_lines:
  - 去重 / 体检必须经 diagnostics 页发起，禁止在其他页直接调 doDedup
pitfalls:
  - 在仓库页直接调 doDedup → 缺上下文、无法展示冲突视图；必须走 diagnostics 页 initDiagnostics
  - 性能 trace 未释放 → 长时占用内存；file-bench / perf-trace 完成后必须 stop 回收
use_when:
  - 诊断页
  - 冲突
  - 去重流程
  - 诊断页日志 tab
  - 性能
  - oldest
perf:
  - cpu-bound
  - gpu-bound
  - concurrent
invariant_anchors:
  - frontend/src/views/app-content/diagnostics/init.ts|startDedup
status: active
---

# 诊断与冲突页 diagnostics

## 概览

`diagnostics/` 是 `app-content` 的「诊断与冲突」页子域（6 个 tab：冲突 / 日志 / 体检 / 去重 / 性能 / 资历），由主卡 `app-content` 的 `init-pages.ts` 在切到诊断页时分发初始化。内部高内聚：`init.ts` 汇聚全部子模块，子模块之间只依赖 `logs.ts`（操作日志渲染），对外只依赖 `core/i18n` / `bus` / `backend` / `utils` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据）。

## 核心职责

- `init.ts` — 诊断页 `initDiagnostics` 与 `startDedup` 去重流程（派发 `model:select` / `stats:refresh` / `tree:reload`）
- `health.ts` — 仓库体检面板：调 Go 端 `RepoHealthAudit`（go/repoaudit 同源，GUI/CLI 消双轨），渲染分数环/完整性/缓存/资源/去重/警告
- `dedup.ts` — 去重检测（读 `utils/resource/registry.ts` 注册表 + Go 绑定），`startDedup` 经 `init.ts` 接线
- `conflicts.ts` — 冲突列表渲染（依赖 `logs.ts` 的操作日志数据）
- `logs.ts` — 操作日志渲染：`OP_META` 七种中文标签+图标，状态图标优先读 `Level`（error→❌ / warn→⚠️ / debug→🔍 / fatal→💀 / info→✅），无 Level 按 `Status` 兜底；消费 Go `logs` 包（见知识卡 `go_logs`）
- `perf.ts` / `perf-cli.ts` / `perf-trace.ts` — 性能面板：CLI 基准（`services/cli-bridge`）+ 加载轨迹（`preview-3d/load-trace.ts`）

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-pages.ts` 调用：切诊断页 → `diagnostics/init.ts` 的 `initDiagnostics(root)`
- 监听 bus：`model:select` / `stats:refresh` / `tree:reload`（去重流程派发）
- 样式：`.diag-*` / `.perf-*` / `.log-row` / `.conflict-row` / `.scan-*` 动画定义在 `app-content` 样式层 `content-diag.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `go-logs`（Go 操作日志）→ `diagnostics/logs.ts` 消费端
- `go-repoaudit`（Go 仓库审计）→ `diagnostics/health.ts` 消费端
- `preview-3d/load-trace.ts` → `diagnostics/perf-trace.ts` 加载轨迹
- 主卡 `app-content` 负责页面编排与分发；本卡只管诊断页自身的初始化与渲染

## 不变量

- `startDedup` 派发的 `model:select` / `stats:refresh` / `tree:reload` 必须齐全，否则去重后界面不刷新
- 性能轨迹读取 `preview-3d` 的 `getLoadTraces` 为只读快照，不写回
- 冲突列表顺序与 `logs.ts` 的 `Operation` 分组一致（`OP_META` 标签为单一事实源）

## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`go-logs`、`go-repoaudit`、`app-content`
- `frontend/src/views/app-content/content-diag.ts` — 诊断/工坊样式层（主卡持有）
