---
kind: app-content
name: 主内容页 app-content
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/index.ts
  - frontend/src/views/app-content/tpl.ts
  - frontend/src/views/app-content/tpl-recycle.ts
  - frontend/src/views/app-content/tpl-settings.ts
  - frontend/src/views/app-content/tpl-settings-about.ts
  - frontend/src/views/app-content/content-css.ts
  - frontend/src/views/app-content/content-layout.ts
  - frontend/src/views/app-content/content-repo.ts
  - frontend/src/views/app-content/content-creator.ts
  - frontend/src/views/app-content/content-diag.ts
  - frontend/src/views/app-content/content-stg.ts
  - frontend/src/views/app-content/content-util.ts
  - frontend/src/views/app-content/init-pages.ts
  - frontend/src/views/app-content/init-preview.ts
  - frontend/src/views/app-content/init-workshop.ts
  - frontend/src/views/app-content/init-github.ts
  - frontend/src/views/app-content/page-registry.ts
  - frontend/src/views/app-content/state.ts
  - frontend/src/views/app-content/subscription-bucket.ts
  - frontend/src/views/app-content/community-data.ts
  - frontend/src/views/app-content/workshop-avatar.ts
  - frontend/src/views/app-content/workshop-tabs.ts
  - frontend/src/views/app-content/workshop-site-opener.ts
  - frontend/src/utils/icon/workshop-icons.ts
auto_fields:
  symbols_with_lines:
    - aboutHTML
    - AppContentHost
    - AppContentState
    - appContentStyle
    - bindSiteEvents
    - clearAllCommunityCache
    - CommunityData
    - contentCreatorCSS
    - contentCSS
    - contentDiagCSS
    - contentLayoutCSS
    - contentRepoCSS
    - contentStgCSS
    - contentUtilCSS
    - createWorkshopRefs
    - creditsHTML
    - dedupeCreators
    - DEFAULT_COMMUNITY_URL
    - diagnosticsHTML
    - extractAvatars
    - fetchCommunityCreators
    - fetchCommunitySites
    - fillSearch
    - forceRefreshCommunityMerge
    - forceRefreshCommunitySites
    - forceRefreshScanAuthors
    - getLastModelPath
    - getSiteIcon
    - getTagIconFromRole
    - githubHTML
    - GithubPageCtx
    - ICONS
    - initDiagnosticsPage
    - initGithubPage
    - initInstancesPage
    - initPreviewResize
    - initRepositoryPage
    - initSettingsPage
    - initWorkshopPage
    - initWorkshopTabs
    - instancesHTML
    - loadCommunityData
    - loadLocalAuthors
    - LocalAuthorLike
    - LocalCreator
    - mergeCommunityCreators
    - mergeCommunitySites
    - mergeLocalAuthorsInto
    - openSite
    - PAGE_REGISTRY
    - PageDefinition
    - recycleHTML
    - rememberModelPath
    - RepoCacheEntry
    - repositoryHTML
    - resetAvatarConfigLoaded
    - setShowSiteView
    - settingsHTML
    - SubscriptionBucket
    - VIEW_TESTIDS
    - workshopHTML
    - WorkshopRefs
  tests:
    - frontend/src/utils/resource/types.test.ts
    - frontend/src/views/app-content/community-data.test.ts
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-toast/index.test.ts
    - frontend/src/views/app-tree/render.test.ts
    - frontend/src/views/context-menu/index.test.ts
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - 主内容区、页面切换、仓库页 / 创作者页 / 社区页
    - nav:change 事件分发、全局 handler 注册
    - 页面初始化流程、订阅桶 / 会话状态
  quick_risk_lines:
    - 主内容区页面切换必须经 nav:change / app-nav 路由分发，禁止页面之间直接 init 对方
  pitfalls:
    - 页面 A 直接调用页面 B 的 init → 重复初始化 / 订阅泄漏；必须经 nav:change 单点分发
    - subscription-bucket 未退订 → 跨页残留监听、状态串扰；每次切换必须 clear 旧桶
  use_when:
    - 主内容区
    - 页面切换
    - nav:change
    - 仓库页
    - 全局 handler
  invariant_anchors:
    - frontend/src/views/app-content/index.ts|_unsubs
tests:
  - frontend/src/utils/resource/types.test.ts
  - frontend/src/views/app-content/community-data.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/render.test.ts
  - frontend/src/views/context-menu/index.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 主内容区、页面切换、仓库页 / 创作者页 / 社区页
  - nav:change 事件分发、全局 handler 注册
  - 页面初始化流程、订阅桶 / 会话状态
quick_risk_lines:
  - 主内容区页面切换必须经 nav:change / app-nav 路由分发，禁止页面之间直接 init 对方
pitfalls:
  - 页面 A 直接调用页面 B 的 init → 重复初始化 / 订阅泄漏；必须经 nav:change 单点分发
  - subscription-bucket 未退订 → 跨页残留监听、状态串扰；每次切换必须 clear 旧桶
use_when:
  - 主内容区
  - 页面切换
  - nav:change
  - 仓库页
  - 全局 handler
invariant_anchors:
  - frontend/src/views/app-content/index.ts|_unsubs
status: active
---

# 主内容页 app-content

## 概览

`app-content` 是应用的主内容区组件（Shadow DOM + adoptedStyleSheets），承载 6 个页面：模型仓库（repository）、整合包管理（instances）、创作者频道（workshop）、创意工坊（github）、诊断与冲突（diagnostics/oldest）、设置（settings）。它监听 `nav:change` 整块重渲染当前页，也是全部全局事件 handler 的唯一注册点（致命陷阱 #2 的解法）。

构造器不再硬编码 `"repository"`，而是与 `app-nav`、`PageStore` 三源同源调用 `resolveInitialPage()`（`core/page-store.ts`）：`app-content` 经 `app-modules.ts` 动态加载，可能晚于 `app-nav` 派发的初始 `nav:change`，事件被吞后若硬编码首页，会让 UI 实际渲染页与 `PageStore.currentPage` 脱节。旧版全局 DnD 曾依赖 `page === "repository"` 守卫，现仓库页 DnD 已改为 `app-tree` 组件级绑定，不再受该守卫影响。

UI 文案统一走 i18n key（`workshop.*` / `diagnostics.*` / `settings.*` / `content.*`），改文案只改语言包。

## 核心职责

> **子域拆分（2026-08-31，ADR-138 同批）**：诊断页 / 设置页 / 站点视图已拆为独立子卡——
> 本卡只持编排、模板、样式层、共享数据与工坊装配。见：
> - [诊断与冲突页 `app_content_diagnostics`](./app_content_diagnostics.md) — `diagnostics/` 全子模块
> - [设置页 `app_content_settings`](./app_content_settings.md) — `settings/` 全子模块
> - [创意工坊站点视图 `app_content_site`](./app_content_site.md) — `site/` + `site-view.ts` + `workshop-data` / `workshop-browse-mode`

- `index.ts` — `<app-content>` 生命周期编排：构造器 `resolveInitialPage()` 定初始页、`nav:change` 切页、`_render()` 按 `_current` 选择模板并重渲染、`_bindTabs` 懒初始化子 tab、预览面板拖拽调宽（localStorage `preview-width`，范围 160–500）。`<app-preview>` 改为顶部副作用静态导入 `import "../app-preview/index.ts"`（替代原动态 import 预加载）
- `tpl.ts` — 页面布局模板：`repositoryHTML` / `instancesHTML` / `settingsHTML` / `diagnosticsHTML` / `workshopHTML` / `githubHTML` / `downloadsHTML` / `recycleHTML`
- `content-css.ts` — 样式组合层：6 个域 CSS 文件 join 输出单一字符串，经 `adoptedStyleSheets` 注入 Shadow DOM，全走 CSS 变量。
- `content-layout.ts` — 基础层：`::host` 变量 + 通用 keyframes + 骨架卡片系统（`.page` / `.stat-card` / `.model-card` / `.health-ring` 等）+ 工坊通用按钮类（`.ws-*`）。**CSS 变量可穿 shadow，@keyframes 不可**——必须在 shadow 层本地重定义副本，且参数值与全局副本一致（机检 1c 硬校验，`scripts/css-layer-check.ts` 阻断 pre-push）。
- `content-repo.ts` — 仓库/实例/站点骨架 + 资历页 + 热力图 + 通用标签。
- `content-creator.ts` — 创作者 `.cr-*` 全族样式（标签/频道/卡片/详情浮层/编辑）。
- `content-diag.ts` — 诊断页 + GitHub 工坊 `.gh-*` 全族样式。
- `content-util.ts` — 回收站动画 / 资源管理器 / 预览拖拽 / 主题选择器 / 响应式 `@media`。
- `community-data.ts` — 社区数据层：`loadCommunityData` 首屏快路径（不含磁盘扫描）；`loadLocalAuthors` withCached 5min **STALE** 策略（过期返旧值后台刷新）；`mergeLocalAuthorsInto` 幂等合并（同名去重 + type 分段精确比较）。
- `workshop-icons.ts` — SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`
- `workshop-site-opener.ts` — 站点打开器：`openSite(host, site, browseMode, targetUrl)` 按模式走 `openEmbedded` / `NavigatePlazaWindow` / `OpenInBrowser`；`targetUrl` 缺省回退 `site.url`；site-view 的 `ctx.openUrl` 须把搜索词链接**透传**给 `openSite`，不得丢弃。

## 对外 API / 入口

- 自定义元素：`<app-content>`
- 监听 bus：`nav:change`（切页并回发 `nav:changed`，同时 `App.ClearScanCache()` 清扫描缓存）、`repo:switch-tab`、`repo:search-creator`（写入 `setPendingTreeSearch` 后切仓库页）、`package:selected`（instances 页注入 `<app-sync-manager>`）、`repo:rtype-changed`、`avatar:refresh`
- 派发 bus：`nav:changed`、`repo:rtype-changed`、`toast:show`
- 全局 handler 注册：`connectedCallback` 末尾调用 `registerGlobalHandlers()`（`core/handlers/global.ts`，汇聚 PageStore / 右键菜单 / 同步 / 实例操作 / Android 事件 handler，返回 unsub 数组收进 `_globalUnsubs`）；另单独调用 `registerResourceManagerGlobal(this._globalUnsubs)`；仓库页 DnD 由 `app-tree` 组件内部 `bindTreeDnD` 绑定，不在此注册
- Wails 运行时事件：`Events.On("config-loaded")` 触发头像重提取，用模块级 `_avatarConfigLoadedRegistered` / `_avatarConfigLoadedUnsub` 保证只注册一次，`disconnectedCallback` 回收并复位 flag
- getApp 调用：`ClearScanCache`、`LoadGitHubRepos`、`LoadAppConfig`、`GetRepoRoot`、`ScanModelEntries`、`BatchExtractCreatorAvatars`、`OpenInBrowser`、`NavigatePlazaWindow`、`ExportWorkshopSitesJSONFile` / `ImportWorkshopSitesJSONFile`

## 与其他子系统关系

- `app-nav` 是 `nav:change` 的派发源；本组件消费后整块重渲染并回发 `nav:changed`，`PageStore` 监听 `nav:changed` 单向更新状态（见知识卡 `app_nav`、`page_store`）
- `<app-preview>` 由本模块顶部副作用静态导入完成注册，仓库页模板直接放置元素（见知识卡 `app_preview`）
- `package:selected` 由 `app-sidebar` 卡片点击派发，本组件据此挂载 `<app-sync-manager instance=...>`（见知识卡 `app_sidebar`、`app_sync_manager`）
- 仓库页事件绑定与卡片渲染委托 `features/community/events.ts`（`bindRepoEvents`，清理函数存 `_repoEventsCleanup`）与 `features/community/render.ts`；工坊模型列表接入定高虚拟滚动（`virtual-list.ts`，社区上线后索引可顶 2000 级）
- 所有 Go 调用统一走 `getApp()`（见知识卡 `wails_bridge`）；跨组件通信走 bus（见知识卡 `event_bus`）

## 不变量

- 全局事件 handler 只在 `app-content` 的 `connectedCallback` 注册一次（致命陷阱 #2），返回的 unsub 全部收进 `_globalUnsubs`
- 初始页面**三源同源**：`app-nav`、`app-content`、`PageStore` 都只能通过 `resolveInitialPage()` 取初始页，禁止任一处硬编码页面名，否则 UI 与 `PageStore` 脱节（旧版 DnD 遮罩曾依赖该守卫误判；现 DnD 已组件化，不再依赖）
- `resolveInitialPage()` 的 localStorage 取值必须过 `sanitizePage()` 白名单（`VALID_PAGES`）：历史页面名 `resources` 映射为 `repository`，其余未知/损坏值一律回退 `repository`，防止 `_render()` 落入 `default` 分支却无对应 init 分发而形成死页
- 所有 `bus.on` 订阅（`_unsub` / `_globalUnsubs` / `_unsubs`）必须在 `disconnectedCallback` 逐一清理；`_unsubs` 在 `_render()` 开头同样清理（防 app-content 常驻下跨访问累积）；`document` 级 resize 监听先移除再重绑
- `_render()` 内页面 init 分发整体包 try/catch：init 抛错不中断调用方，转 `console.error` + `toast:show` 反馈用户而非静默
- 样式走 `adoptedStyleSheets` + CSS 变量，无硬编码颜色；`innerHTML` 拼接统一过 `_esc` / `esc`
- 页面级临时缓存（`_workshopCache` / `_githubCache`）与 `_workshopTimer` 定时器在 `disconnectedCallback` 清空
- 站点搜索带词链接必须**真传**到底层打开调用：`ctx.openUrl(url)` → `openSite(host, site, mode, url)` 的 `url` 不得丢弃
- 浏览模式收敛为**单源 ref**：`browseMode` 存为 `BrowseModeRef{ v }`，经 `ctx.browseMode` 贯穿到 `renderSiteView` 高亮与 `openUrl`→`openSite`，`setBrowseMode` 只改 `.v` + localStorage → 一处 set、处处一致，无值拷贝 stale
- **community-data.ts 写回路径（2026-09-03 复核修正）**：`tryAutoMergeCommunity` 的「前端一次合并 + 单次 `SaveWorkshopCreators` 整体保存」规避的是**前端逐站循环调 `SaveWorkshopCreatorsBySite` N 次的跨调用部分提交**——BySite 自身（Go `internal/app/app_workshop.go`）是单次 Load→过滤→原子写的完整事务。代价是合并/去重派生逻辑（`mergeLocalAuthorsInto`/`dedupeCreators`/type 分号段比较）落在 TS 侧，触及 AGENTS.md「Go 派生结果只读」红线；长治方案 = 下沉 Go 新增「多站点合并替换」单次原子 binding，须开 ADR 后动（注释内已标注）

## 相关

- `frontend/src/core/handlers/global.ts` — 全局 handler 汇聚入口（`registerPageStore` / `registerContextMenus` / `registerSync` / `registerInstanceOps` / `registerAndroidEvents`）；`registerResourceManagerGlobal` 由本文件单独调用
- `frontend/src/views/app-tree/index.ts` — 仓库页 DnD 组件级绑定（`bindTreeDnD`）与显式 `tree-drop-hint`
- `frontend/src/core/page-store.ts` — `resolveInitialPage` / `sanitizePage` / `PageStore`，初始页与页面状态的唯一来源
- `frontend/src/features/community/` — 仓库页数据/渲染/事件/下载队列（`data.ts` / `render.ts` / `events.ts` / `download-queue.ts`，`bindRepoEvents`、`tryFetchModels` 等由 index.ts 调用）
- `frontend/src/views/app-content/site/` — 创意工坊站点视图子模块，与 `features/community/` 并存，index.ts 同时引用两套，改动前先确认归属
- `frontend/src/views/app-tree/index.ts` — `setPendingTreeSearch` 搜索词交接
- 知识卡：`app_nav`、`app_preview`、`app_sidebar`、`app_sync_manager`、`event_bus`、`page_store`、`wails_bridge`
