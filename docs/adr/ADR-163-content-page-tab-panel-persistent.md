# ADR-163：主内容页 tab-panel 常驻化：替代整 DOM 重建

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/index.ts,frontend/src/views/app-content/diagnostics/dedup.ts,frontend_repo_audit.md,frontend_design_critique.md`

---

## 1. 背景（Context）

`frontend/src/views/app-content/index.ts:147` 的 `_render()` 每次 `nav:changed` / `lang:changed` / `repo:search-creator` 都把 `this.state.root.innerHTML` 整段重建（`<div class="page">${page.html()}</div>`）。后果（2026-09-03 三路并发锐评实证，见 `frontend_design_critique.md`）：

1. **状态丢失**：切页后 <app-tree> 等 Web Component 全部走 connected→disconnected→connected 完整生命周期，展开节点、滚动位置、焦点全丢——用户「刚展开的子目录，切页回来又缩回去了」。
2. **模块级全局锁悬空**：`diagnostics/dedup.ts:15,19` 的 `_dedupBusy`/`diagExecBusy` 挂在模块级，页面销毁不复位（`resetDedupConfig` 只清 config 不清 busy），再进 dedup tab 永久卡死（审计快照 2026-08-26 点名 4 个月未修）。
3. **bus 被异化为微任务队列**：`index.ts:108-109` 先 emit `nav:changed` 再 emit `tree:set-search`，依赖「同步切页后 app-tree 已挂载」的时序假设，属跨 tick 脆弱编排。
4. **重复渲染浪费**：`lang:changed` 全页重建只为换文案；`repo:search-creator` 同 tick 双 emit。

## 2. 决策（Decision）

主内容页改为 **tab-panel 常驻 + active 切换**：

- 页面注册表 `PAGE_REGISTRY` 增加「首次挂载即渲染、之后仅切换可见性」语义：`nav:changed` 时不再 `innerHTML` 重建，而是把目标页 `display:none` 关掉、新页 `display:block`（或 `hidden` 属性切换），页面 DOM 常驻内存。
- 页面生命周期收敛为显式钩子：`init()`（首次挂载执行一次）+ `show()`/`hide()`（切换时触发，替代现 `cleanupPage` + 重建）。`disconnectedCallback` 仍负责全量清理，`app-content` 自身销毁时才走。
- **dedup busy 锁随页面实例化**：`_dedupBusy`/`diagExecBusy` 从模块级 `let` 移入 tab 初始化返回的 state，`hide()` 或组件级 cleanup 时复位——根除「再进即卡死」。
- `repo:search-creator` 改为直接调 `_render` 定位到 repository 页 + 在 app-tree 已挂载后同步触达搜索输入，不再双 emit 借 bus 中转。
- `lang:changed` 保留全量重渲染或降级为「仅当前可见页重渲染 + 广播已挂载组件」——以最小 diff 收敛。

## 3. 后果（Consequences）

**正面**：
- 树展开状态/滚动位置/焦点跨页保留，用户体感「页面是切换不是重开」。
- 消灭 dedup 全局锁竞态（测试并行串扰 + 真实用户卡死双杀）。
- 消除 bus 时序依赖；`lang:changed` 不再整 DOM 重建。
- 与「页面 init 由 PAGE_REGISTRY 声明」的既有结构（ADR-092/094 收敛）兼容：只是 html() 从「每次重建」变「首挂载渲染」。

**负面 / 需留意**：
- 常驻 DOM 内存开销：各页 DOM 同时存活。主内容区页面数量有限（仓库/创作者/社区/设置/诊断等），且 3D overlay 本就走独立生命周期，影响可控；需在实施时确认各页无「每 show 必须重建」的强依赖。
- 页面级订阅语义变化：现 `cleanupPage` 在每次 `_render` 清理，改为 hide/show 后需保证「hide 时退订、show 时重订」或「订阅常驻 + 事件带页面过滤」，防止跨页监听串扰。
- 旧 `html()` 契约的调用方需同步迁移（如 `lang:changed` 依赖重渲染取新文案的路径改为「已挂载组件自行监听 `lang:changed`」）。

**已知遗留**：
- `PAGE_REGISTRY` 的 `html()` 签名保留为「首次挂载渲染」兼容，不强制一次性迁移全部页面；可先迁移高频页（repository/settings），低频页维持现状（惰性挂载 + 首次 show 渲染）。

## 4. 数据溯源

- 2026-08-26 `frontend_repo_audit.md`：dedup 模块级全局竞态隐患点名。
- 2026-09-03 `frontend_design_critique.md`：三路并发锐评实证 `index.ts:147` 整重建 / `index.ts:108-109` bus 异化 / `dedup.ts:15,19` 无 reset；主模型抽查背书（✅ 6 项）。
- 实施进度记录于知识卡 `frontend_design_critique.md`（不变量节），不写入本 ADR。

<!-- 文件名: content-page-tab-panel-persistent.md → 实际文件 ADR-163-content-page-tab-panel-persistent.md -->
