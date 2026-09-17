---
kind: app_content_diagnostics
name: 诊断与冲突页 diagnostics
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/diagnostics/init.ts
  - frontend/src/views/app-content/diagnostics/logs.ts
  - frontend/src/views/app-content/diagnostics/dedup.ts
  - frontend/src/views/app-content/diagnostics/dedup-policy.ts
  - frontend/src/views/app-content/diagnostics/health.ts
  - frontend/src/views/app-content/diagnostics/conflicts.ts
  - frontend/src/views/app-content/diagnostics/perf.ts
  - frontend/src/views/app-content/diagnostics/perf-common.ts
  - frontend/src/views/app-content/diagnostics/perf-single-bench.ts
  - frontend/src/views/app-content/diagnostics/perf-gui-flow.ts
  - frontend/src/views/app-content/diagnostics/perf-log.ts
  - frontend/src/views/app-content/diagnostics/perf-trace.ts
auto_fields:
  symbols_with_lines:
    - bindPerfCopyHandlers
    - CLIResp
    - createDedupSession
    - DedupConfigShape
    - DedupFileLike
    - DedupSession
    - EscFn
    - formatSize
    - getDefaultKeepIdx
    - getOutBox
    - initDiagnostics
    - initPerfPanel
    - loadDiagnosticsLogs
    - loadRuntimeLogs
    - renderHealthReport
    - renderLoadTraceSection
    - respHasOutput
    - runGuiFlow
    - runHealthAudit
    - runPerfLog
    - runSingleBench
    - scanConflicts
    - scanSyncConflicts
    - sectionHeader
    - setBusy
    - setErrorCatch
    - setErrorMsg
    - setErrorResp
  tests:
    - frontend/src/views/app-content/diagnostics/conflicts.test.ts
    - frontend/src/views/app-content/diagnostics/health.test.ts
    - frontend/src/views/app-content/diagnostics/init.test.ts
    - frontend/src/views/app-content/diagnostics/perf.test.ts
    - frontend/src/views/app-content/diagnostics/perf-common.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 诊断页、仓库体检、冲突 / 去重
  - 日志查看、性能分析
  - initDiagnostics、createDedupSession
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
  - frontend/src/views/app-content/diagnostics/dedup.ts|createDedupSession
status: active
---

# 诊断与冲突页 diagnostics

## 概览

`diagnostics/` 是 `app-content` 的「诊断与冲突」页子域，顶部 8 个 `repo-tab`（log / single / gui / hist / trace / conflict / health / sync-conflict，ADR-258 由左栏分段收敛而来），由主卡 `app-content` 的 `init-pages.ts` 经 `bindTabs(host, ".repo-tab", "diag", [...])` 接入全站统一范式分发初始化。内部高内聚：`init.ts` 汇聚全部子模块，子模块之间只依赖 `logs.ts`（操作日志渲染），对外只依赖 `core/i18n` / `bus` / `backend` / `utils` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据）。

> 导航结构演进（ADR-258）：原左栏 `diag-left`（6 个 `diag-btn` + 复制/刷新/清空）已删除，分段提升为顶部 `repo-tab`；日志合并为 1 个 tab（op/runtime 子 tab 切换），性能拆为 single/gui/hist/trace 4 个 tab；清空按钮归位日志面板工具栏且仅操作日志视图可见（仅 `ClearImportLogs` 生效，运行时日志无清空后端能力）。

## 核心职责

- `init.ts` — 诊断页 `initDiagnostics`；去重会话 `createDedupSession`（由 `init-pages.ts` 持有会话实例，`session.start` 派发 `model:select` / `stats:refresh` / `tree:reload`）
- `health.ts` — 仓库体检面板：调 Go 端 `RepoHealthAudit`（go/repoaudit 同源，GUI/CLI 消双轨），渲染分数环/完整性/缓存/资源/去重/警告
- `dedup.ts` — 去重检测（读 `services/resource-registry.ts` 资源类型注册表 + Go 绑定）；`createDedupSession()` 会话工厂把 busy/exec 重入守卫与去重配置收进闭包，经 `init.ts` re-export 接线。keep 保留策略纯函数于 2026-09-03 抽至 `dedup-policy.ts`（策略决策零 DOM/会话依赖，渲染默认保留索引与 exec 删除共用同一决策源，防规则漂移）
- `dedup-policy.ts` — keep 保留策略纯函数层（`getDefaultKeepIdx` + `pickByTime` 共享 pick 辅助 + `DedupFileLike`），自 `dedup.ts` 抽出（2026-09-03，ADR-040 拆分线延续）；零 mock 单测聚焦策略分支
  - `toTimestamp` 缺失/非法返回 `null`（「无时间信息」），不参与时间裁决；全缺失时 `pickByTime` 严格比较保序回退首项（2026-09-12 P0 收口，修「newest 侧 MAX 哨兵反判最新」潜伏语义缺陷——Go 扫描恒带回 modTime，生产不可达）
- `conflicts.ts` — 冲突列表渲染（依赖 `logs.ts` 的操作日志数据）
- `logs.ts` — 操作日志渲染：`OP_META` 七种中文标签+图标，状态图标优先读 `Level`（error→❌ / warn→⚠️ / debug→🔍 / fatal→💀 / info→✅），无 Level 按 `Status` 兜底；消费 Go `logs` 包（见知识卡 `go_logs`）
- `perf.ts` — 性能面板 facade：事件接线 + re-export，业务逻辑拆至：
  - `perf-common.ts` — 共享工具层（sectionHeader / 复制按钮 / 守卫 / 错误辅助）
  - `perf-single-bench.ts` — single-bench（CLI 文本流消费 + 柱状图 + 趋势图）
  - `perf-gui-flow.ts` — gui-flow（6 阶段结构化消费）
  - `perf-log.ts` — perf-log（优化历史卡片）
  - `perf-trace.ts` — 加载剖析（load-trace store 消费）

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-pages.ts` 调用：切诊断页 → `diagnostics/init.ts` 的 `initDiagnostics(root)`
- 监听 bus：`model:select` / `stats:refresh` / `tree:reload`（去重流程派发）
- 样式：`.diag-*` / `.perf-*` / `.log-row` / `.conflict-row` / `.scan-*` 动画定义在 `app-content` 样式层 `content-diag.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `go-logs`（Go 操作日志）→ `diagnostics/logs.ts` 消费端
- `go-repoaudit`（Go 仓库审计）→ `diagnostics/health.ts` 消费端
- `preview-3d/infra/load-trace.ts` → `diagnostics/perf-trace.ts` 加载轨迹
- 主卡 `app-content` 负责页面编排与分发；本卡只管诊断页自身的初始化与渲染

## 不变量

- 去重会话 `session.start` 派发的 `model:select` / `stats:refresh` / `tree:reload` 必须齐全，否则去重后界面不刷新
- 性能轨迹读取 `preview-3d` 的 `getLoadTraces` 为只读快照，不写回
- 冲突列表顺序与 `logs.ts` 的 `Operation` 分组一致（`OP_META` 标签为单一事实源）
- exec 读用户选中态按组容器查 `input[type="radio"]:checked`（2026-09-03）：组容器按渲染平铺序与 `allResults.groups` 一一对应，替代按 `name="dedup-keep-<gi>"` 全局拼串——组间插入其它控件不致错位，消除「渲染计数 gi / exec 计数 gi2」双轨对齐依赖；keep-all 值为 `-1` 的 radio 同属组内

- **面板结构由 `renderTabs` 工厂单点产出**（ADR-259，2026-09-17 事故收口）：诊断页此前是全仓唯一的例外范式——「一个共享 `.tab-body` 包 8 个 `.diag-panel`」。该范式更脆：`.diag-log-bar` 漏一个 `</div>` 就让 `#diag-tab-log` 把后续 7 个面板吞进自己内部，而 `bindTabs` 切页时把 `#diag-tab-log` 置 `display:none`，嵌在里面的面板一并消失 → **切任何 tab 都只剩空 tab 栏**。现改用 `views/app-content/tabs-shell.ts|renderTabs`（与其他 tab 页同构：每 tab 一个 `.tab-body`），面板 id 与 `bindTabs` 的 `${prefix}-tab-${id}` 共享同一条规则；`.diag-panel` 退化为纯入场动画钩子（布局归 `.tab-body`）。防线三层：`tabs-shell.test.ts`（工厂产出契约）+ `tpl-structure.test.ts`（各页 div 配平 / 按钮↔面板一一对应 / 面板必为 `.tab-body` 且等深同层）+ `e2e/diagnostics.spec.ts`（真实浏览器逐 tab 测 `getBoundingClientRect` 尺寸——`display` 口径对此失明）。泛化规则见 `skills/pitfalls.md` #20。
- **日志面板工具栏按语义分两行**（2026-09-17 版面收口，方案 A）：行1 = 子 tab（操作 / 运行时）+ 动作（刷新 / 复制 / 清空日志），行2 = 状态筛选 chips + 搜索框；两行容器为 `.diag-log-row`，`.diag-log-bar` 退化为纵向堆叠的框。立因：9 按钮 + 1 输入框挤单行时，`flex:1` 的 spacer 把「清空」（破坏性动作、且只清操作日志）与筛选 chips 划成一组、却把刷新 / 复制推到行尾，视觉分组 ≠ 功能分组，且窄宽下 spacer 随 `flex-wrap` 折行挤散动作组。清空恒排行尾；行2 搜索框 `flex:1; min-width:110px; max-width:320px` 吃掉腾出的宽度。类名 ↔ 规则同步由 `css/content-diag-classes.test.ts` 兜底（`.diag-log-row` 属布局类，有规则即通过）。
- **日志搜索是「共用输入框 + 按子 tab 分派」**（2026-09-17 收口）：`#diag-log-search` 同时服务操作日志与运行时日志，`init.ts|dgInBindLogSearch` 按当前子 tab 分派（op → `loadDiagnosticsLogs`，runtime → `loadRuntimeLogs`）。命中域：操作日志用 `logs.ts|dgLsMatchDiagSearch` 把 ModelName / ErrorMsg / TargetDir / SourcePath / Operation 拼成串做子串匹配（此前只匹配 ModelName，搜报错内容必然空手）；运行时日志只匹配 Message（无 Status/路径概念）。两侧同为「最新 N 条窗口内检索」（op 500 / runtime 300），超窗口历史条目不召回；无命中统一落 `diagnostics.noMatchLogs` 占位。状态 chips 只作用于操作日志（运行时日志 Level 恒为 info），运行时子 tab 下点击仅更新选中态、**不回落拉 op 列表**（避免白跑一次 GetImportLogs）。placeholder 因此改为「搜索日志内容...」（key 未改名，值在 `src/locales/*.ts`）。
- **single-bench 走结构化出口，不再正则解析中文文案**（ADR-262 D1，2026-09-17 切片 1）：前端 `perf-single-bench.ts` 传 `--format json` 并消费 `resp.data`（`SingleBenchPayload`，字段与 `go/cli/bench_concurrent.go|singleBenchJSON` 逐字对齐）；Go 侧 `ctx.SetResult(&output)` + `AttachSidecar`（ADR-200 D5）让桥的 data 承载对象本体，`output` 只作「复制原文」。**total 双口径**：`total_ms` = N 次迭代累计墙钟，`per_iteration_ms` = 单次平均——旧 UI 拿累计当单次展示（「6ms 谁信」的机制性来源之一）。阶段分级（bottleneck / warn / slow / ok）由 Go `stageStatus` 单一口径给出（阈值 100/50/10ms 只在 Go），前端只做 emoji/配色映射，不得自算阈值；`stagesToJSON` 改两趟识别唯一最慢阶段（旧实现可产出多个 `bottleneck=true`）。Go 侧 `hints` 仍是中文散文，未 i18n 前不上 UI（结构化保留供 AI 消费）。契约由 `go/cli/bench_internal_test.go` 锁字段名 + sidecar 注入。

## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`go-logs`、`go-repoaudit`、`app-content`
- `frontend/src/views/app-content/css/content-diag.ts` — 诊断/工坊样式层（主卡持有）
