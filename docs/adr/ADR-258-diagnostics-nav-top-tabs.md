# ADR-258：诊断页导航：左栏分段收敛为顶部统一 tab 范式

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/tpl.ts; frontend/src/views/app-content/diagnostics/init.ts; frontend/src/views/app-content/init-pages.ts`

---

## 1. 背景（Context）

## 1. 背景（Context）

诊断页（`frontend/src/views/app-content/diagnostics/`）当前导航结构存在双重层级、与全站范式割裂：

- 顶部 `repo-tabs` 只有 1 个退化的 `data-tab="diagnostics"` 按钮，不切换任何内容，实为标题条。
- 真正做分段切换的是左栏 `diag-left`（固定宽 `--diag-left-w:120px`），含 6 个 `diag-btn`（操作日志/运行时日志/冲突检测/性能/仓库健康/同步冲突）+ 3 个操作按钮（复制/刷新/清空），靠 `init.ts` 自写的 `dgInBindTabSwitcher` 显隐右侧 6 个 `diag-panel`。
- 该左栏导航是诊断页私有实现，复用不了 `init-pages.ts` 的 `bindTabs`（ARIA/键盘 roving tabindex/懒加载）通用范式；仓库页、设置页、instances 页均走 `bindTabs`，唯独诊断页另起炉灶。
- **功能层级错配**：`diag-clear` 调用 `ClearImportLogs`，**只清操作日志**，却被挂在左栏底部当全局按钮，与 6 个分段平级；运行时日志无清空后端能力。用户感到「清空很关键却放错位置」。
- **粒度不一**：左栏把「性能」与「操作日志」平级，但性能面板内又嵌 single-bench/gui-flow/perf-log/load-trace 四个子功能（`perf.ts` 的 `diag-perf-*` 按钮行），左栏粒度失配。
- **合并机会**：操作日志与运行时日志都是日志查看器，仅数据源不同，应合并。

## 2. 决策（Decision）

将诊断页左栏分段**提升为顶部 `repo-tabs`**，接入全站统一 `bindTabs(host, ".repo-tab", "diag", [...])` 范式，删除 `diag-left` 整段及 `dgInBindTabSwitcher`。具体分段方案：

1. **日志（合并）**：操作日志 + 运行时日志合并为 1 个顶部 tab `diag-tab-log`，面板内用小型子切换（数据源 radio/按钮）切换两种日志；**清空按钮归位到日志面板工具栏，且仅在操作日志视图可见**（运行时日志无清空能力）。
2. **性能（拆 4）**：原性能段拆成 4 个顶部 tab：`single`（单一模型基准）/ `gui`（GUI 加载链路）/ `hist`（优化历史）/ `trace`（加载剖析）。与仓库页扁平「一 tab = 一内容卡」范式一致。
3. **冲突/体检/同步冲突（原样）**：保留为 3 个顶部 tab `conflict` / `health` / `sync-conflict`，各自绑定原扫描入口。
4. **复制/刷新**：归位到日志面板工具栏（`diag-log-bar`，与清空同处），而非顶部 tab 栏。理由：`.repo-tabs` 由 `bindTabs` 注入 `role="tablist"`，tablist 内只应含 `role="tab"` 元素，混入非 tab 操作按钮会破坏 ARIA 语义；且复制/刷新语义上只作用于日志视图，与工具栏内的清空按钮同组更自洽（与 github/workshop 页「操作按钮置于内容工具栏而非 tablist」的布局惯例一致）。
内容卡 id 沿用 `diag-tab-<name>` 前缀（与 `bindTabs` 的 `${prefix}-tab-${id}` 约定对齐）。查看器模式（`isViewerMode`）隐藏桌面专属 tab（conflict/health/sync-conflict）仍由 `dgInHideDesktopOnly` 负责（仅保留该隐藏分支，左栏分段分支已删）；因其对 tab 设 `display:none`，`bindTabs` 的键盘导航（Arrow/Home/End）已同步改为跳过 `display:none` 的 tab，避免 viewer 模式方向键聚焦隐藏 tab。

## 3. 后果（Consequences）

**正面**

- 消除「双重导航」观感，诊断页与仓库页/设置页 100% 同范式，复用 `bindTabs` 的 ARIA + 键盘 + 懒加载。
- 删除 `diag-left` 整段 CSS（`.diag-left`/`.diag-btn`/`.diag-left-spacer`）+ `dgInBindTabSwitcher` + `dgInHideDesktopOnly` 左栏分支，净减代码。
- 修正清空按钮层级错配：清空回到操作日志工具栏，语义自洽。
- 性能段粒度对齐其他 tab，不再「一个 tab 内含四件套」。

**负面 / 已知遗留**

- 多文件改动（tpl.ts / content-diag.ts / init.ts / init-pages.ts / 测试），需同步更新 `init.test.ts`、`tpl.test.ts` 的 DOM 选择器与绑定断言。
- 顶部 tab 数由「1 个退化 tab」变为「8 个真实 repo-tab」（日志 / 性能×4 / 冲突 / 体检 / 同步冲突），窄屏需确认 `.repo-tabs` 的 `overflow-x:auto` 横向滚动体验；复制/刷新已下沉至日志面板工具栏，不占顶栏。
- 性能 4 个子 tab 的初始化需登记进 `bindTabs` 的 `TAB_INIT` 表（或页内 init 直接渲染，因性能面板本就随诊断页 init 一次性挂载）。

## 4. 数据溯源

- 来源：`frontend/src/views/app-content/tpl.ts:99-145`（诊断页模板，含退化顶部 tab + 左栏）、`frontend/src/views/app-content/diagnostics/init.ts:143`（dgInBindTabSwitcher）、`frontend/src/views/app-content/init-pages.ts:92`（bindTabs 范式）、`frontend/src/views/app-content/css/content-diag.ts`（diag-left/diag-btn 样式）。
- 结果：本次重构落地后，诊断页顶部 tab 栏 = 8 个 `repo-tab` 内容卡；复制/刷新/清空归位于日志面板工具栏 `diag-log-bar`；左栏 `diag-left` 删除。

