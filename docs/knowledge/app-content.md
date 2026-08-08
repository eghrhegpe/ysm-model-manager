---
kind: app-content
name: 主内容页 app-content
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/index.ts
  - frontend/src/views/app-content/tpl.ts
  - frontend/src/views/app-content/content-css.ts
  - frontend/src/views/app-content/community-data.ts
  - frontend/src/views/app-content/diagnostics/community.ts
  - frontend/src/views/app-content/settings/community.ts
  - frontend/src/views/app-content/site-view.ts
  - frontend/src/views/app-content/site/drag.ts
  - frontend/src/views/app-content/site/edit.ts
  - frontend/src/views/app-content/site/events.ts
  - frontend/src/views/app-content/site/render.ts
  - frontend/src/views/app-content/site/types.ts
  - frontend/src/views/app-content/workshop-data.ts
  - frontend/src/utils/icon/workshop-icons.ts
tests:
  - frontend/src/utils/resource/types.test.ts
  - frontend/src/views/app-content/community-data.test.ts
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-resource-manager/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/render.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 主内容区
  - 页面切换
  - nav:change
  - 仓库页
  - 诊断页
  - 设置页
  - 创作者频道
  - 创意工坊
  - 全局 handler
---

# 主内容页 app-content

## 概览

`app-content` 是应用的主内容区组件（Shadow DOM + adoptedStyleSheets），承载 6 个页面：模型仓库（repository）、整合包管理（instances）、创作者频道（workshop）、创意工坊（github）、诊断与冲突（diagnostics/oldest）、设置（settings）。它监听 `nav:change` 整块重渲染当前页，也是全部全局事件 handler 的唯一注册点（致命陷阱 #2 的解法）。

构造器不再硬编码 `"repository"`，而是与 `app-nav`、`PageStore` 三源同源调用 `resolveInitialPage()`（`core/page-store.ts`）：`app-content` 经 `app-modules.ts` 动态加载，可能晚于 `app-nav` 派发的初始 `nav:change`，事件被吞后若硬编码首页，会让 UI 实际渲染页与 `PageStore.currentPage` 脱节，仓库页 DnD 遮罩被 `page !== "repository"` 守卫误拦。

## 核心职责

- `index.ts` — `<app-content>` 生命周期编排：构造器 `resolveInitialPage()` 定初始页、`nav:change` 切页、`_render()` 按 `_current` 选择模板并重渲染、`_bindTabs` 懒初始化子 tab、预览面板拖拽调宽（localStorage `preview-width`，范围 160–500）。`<app-preview>` 改为顶部副作用静态导入 `import "../app-preview/index.ts"`（替代原动态 import 预加载）
- `tpl.ts` — 页面布局模板：`repositoryHTML` / `instancesHTML` / `settingsHTML` / `diagnosticsHTML` / `workshopHTML` / `githubHTML` / `downloadsHTML` / `recycleHTML`
- `content-css.ts` — Shadow DOM 样式表（CSS 字符串，全走 CSS 变量）
- `community-data.ts` — 社区数据层：`loadCommunityData`（并发 `App.LoadWorkshopSites` / `LoadWorkshopCreators` / `ListModelAuthors` / `ScanLocalAuthors`）、`fetchCommunityCreators` / `mergeCommunityCreators` / `fetchCommunitySites` / `mergeCommunitySites` / `fillSearch` / `DEFAULT_COMMUNITY_URL`
- `diagnostics/community.ts` — 诊断页 `initDiagnostics` 与 `startDedup` 去重流程（派发 `model:select` / `stats:refresh` / `tree:reload`）
- `settings/community.ts` — 设置页 `initSettings`：直接解构 bindings（`LoadAppConfig` / `SaveAppConfig` / `SelectDirectory` / `GetMinecraftPaths` / `SetLinkMode`），配置变更派发 `config:updated` / `stats:refresh` / `toast:show`，并接入 `initVersionUpdater`；「启动默认页面」下拉读写 localStorage `ui-default-page`，显示值兜底 `repository`（与 `resolveInitialPage` 的兜底一致）
- `site-view.ts` — 站点视图 `renderSiteView`：组装 `SiteViewState` 后委托 `site/` 子模块渲染与绑定；行内编辑选择器排除预设卡片（`[data-idx][data-fld]:not([data-edit='preset'])`，防预设 label 输入污染创作者对象，P2 修复）；拖拽 drop 用 `realIdx` 在 `allCreators` 全量数组上重排（防站点子集覆盖清空其他站点，P2 修复）
- `site/types.ts` / `site/render.ts` / `site/events.ts` / `site/edit.ts` / `site/drag.ts` — 站点视图拆分：状态类型 `SiteViewState` / `CleanupFn`、`createCrCard` + `buildSiteHtml` 渲染、`bindBrowseEvents` 浏览交互、`bindEditEvents` 编辑模式、`bindDragEvents` 卡片拖拽排序；各 bind 均返回 `CleanupFn`
- `workshop-data.ts` — 工坊纯数据工具：`getCreatorIdentity` / `getTagFromRole` / `parseDescTags` / 收藏 `loadFavs` / `isFaved` / `toggleFav`（localStorage `ysm-fav-creators`，写入函数 `saveFavs` 为模块内私有）
- `workshop-icons.ts` — SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`

## 对外 API / 入口

- 自定义元素：`<app-content>`
- 监听 bus：`nav:change`（切页并回发 `nav:changed`，同时 `App.ClearScanCache()` 清扫描缓存）、`repo:switch-tab`、`repo:search-creator`（写入 `setPendingTreeSearch` 后切仓库页）、`package:selected`（instances 页注入 `<app-sync-manager>`）、`repo:rtype-changed`、`avatar:refresh`
- 派发 bus：`nav:changed`、`repo:rtype-changed`、`toast:show`
- 全局 handler 注册：`connectedCallback` 末尾调用 `registerGlobalHandlers()`（`core/handlers/global.ts`，汇聚 PageStore / 右键菜单 / DnD / 同步 / 实例操作 / 资源管理器 handler，返回 unsub 数组收进 `_globalUnsubs`）
- Wails 运行时事件：`Events.On("config-loaded")` 触发头像重提取，用模块级 `_avatarConfigLoadedRegistered` / `_avatarConfigLoadedUnsub` 保证只注册一次，`disconnectedCallback` 回收并复位 flag
- getApp 调用：`ClearScanCache`、`LoadGitHubRepos`、`LoadAppConfig`、`GetRepoRoot`、`ScanModelEntries`、`BatchExtractCreatorAvatars`、`OpenInBrowser`、`StartProxy`、`ExportWorkshopSitesJSONFile` / `ImportWorkshopSitesJSONFile`

## 与其他子系统关系

- `app-nav` 是 `nav:change` 的派发源；本组件消费后整块重渲染并回发 `nav:changed`，`PageStore` 监听 `nav:changed` 单向更新状态（见知识卡 `app_nav`、`page_store`）
- `<app-preview>` 由本模块顶部副作用静态导入完成注册，仓库页模板直接放置元素（见知识卡 `app_preview`）
- `package:selected` 由 `app-sidebar` 卡片点击派发，本组件据此挂载 `<app-sync-manager instance=...>`（见知识卡 `app_sidebar`、`app_sync_manager`）
- 仓库页事件绑定与卡片渲染委托 `features/community/events.ts`（`bindRepoEvents`，清理函数存 `_repoEventsCleanup`）与 `features/community/render.ts`
- 所有 Go 调用统一走 `getApp()`（见知识卡 `wails_bridge`）；跨组件通信走 bus（见知识卡 `event_bus`）

## 不变量

- 全局事件 handler 只在 `app-content` 的 `connectedCallback` 注册一次（致命陷阱 #2），返回的 unsub 全部收进 `_globalUnsubs`
- 初始页面**三源同源**：`app-nav`、`app-content`、`PageStore` 都只能通过 `resolveInitialPage()` 取初始页，禁止任一处硬编码页面名，否则 UI 与 `PageStore` 脱节会让依赖 `PageStore.currentPage` 的守卫（如 DnD 遮罩）误判
- `resolveInitialPage()` 的 localStorage 取值必须过 `sanitizePage()` 白名单（`VALID_PAGES`）：历史页面名 `resources` 映射为 `repository`，其余未知/损坏值一律回退 `repository`，防止 `_render()` 落入 `default` 分支却无对应 init 分发而形成死页
- 所有 `bus.on` 订阅（`_unsub` / `_globalUnsubs` / `_unsubs`）必须在 `disconnectedCallback` 逐一清理；`document` 级 resize 监听先移除再重绑，防止切页累积泄漏。**`_unsubs` 在 `_render()` 开头同样清理**（P2 修复：app-content 常驻不卸载，原仅 disconnectedCallback 清理 → 多次访问 repository 的 dedup/oldest/import/recycle 会让 `repo:rtype-changed` 监听跨访问累积，N 次访问后一次切换触发 N 次 doDedup）
- `_render()` 内页面 init 分发整体包 try/catch：init 抛错不中断调用方，转 `console.error` + `toast:show` 反馈用户而非静默
- 样式走 `adoptedStyleSheets` + CSS 变量，无硬编码颜色；`innerHTML` 拼接统一过 `_esc` / `esc`
- 页面级临时缓存（`_workshopCache` / `_githubCache`）与 `_workshopTimer` 定时器在 `disconnectedCallback` 清空

## 相关

- `frontend/src/core/handlers/global.ts` — 全局 handler 汇聚入口（`registerPageStore` / `registerContextMenus` / `registerDnD` / `registerSync` / `registerInstanceOps` / `registerResourceManagerGlobal`）
- `frontend/src/core/page-store.ts` — `resolveInitialPage` / `sanitizePage` / `PageStore`，初始页与页面状态的唯一来源
- `frontend/src/features/community/` — 仓库页数据/渲染/事件/下载队列（`data.ts` / `render.ts` / `events.ts` / `download-queue.ts`，`bindRepoEvents`、`tryFetchModels` 等由 index.ts 调用）
- `frontend/src/views/app-content/site/` — 创意工坊站点视图子模块，与 `features/community/` 并存，index.ts 同时引用两套，改动前先确认归属
- `frontend/src/views/app-tree/index.ts` — `setPendingTreeSearch` 搜索词交接
- 知识卡：`app_nav`、`app_preview`、`app_sidebar`、`app_sync_manager`、`event_bus`、`page_store`、`wails_bridge`
