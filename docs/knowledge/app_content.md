---
kind: app_content
name: 主内容页 app-content
tier: architecture
category: ui
source_files:
  - frontend/js/components/app-content/index.ts
  - frontend/js/components/app-content/tpl.ts
  - frontend/js/components/app-content/content-css.ts
  - frontend/js/components/app-content/community/core.ts
  - frontend/js/components/app-content/community/diagnostics.ts
  - frontend/js/components/app-content/community/settings.ts
  - frontend/js/components/app-content/community/site-view.ts
  - frontend/js/components/app-content/community/workshop-data.ts
  - frontend/js/components/app-content/community/workshop-icons.ts
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

## 核心职责

- `index.ts` — `<app-content>` 生命周期编排：`nav:change` 切页、`_render()` 按 `_current` 选择模板并重渲染、预览面板拖拽调宽（localStorage `preview-width`，范围 160–500）、仓库页按需 `import("../app-preview/index.ts")` 懒加载 3D 预览
- `tpl.ts` — 页面布局模板：`repositoryHTML` / `instancesHTML` / `resourceLibraryHTML` / `settingsHTML` / `placeholderHTML` / `downloadsHTML` / `diagnosticsHTML` / `recycleHTML` / `githubHTML` / `workshopHTML`
- `content-css.ts` — Shadow DOM 样式表（CSS 字符串，全走 CSS 变量）
- `community/core.ts` — 社区数据层：`loadCommunityData`（并发 `App.LoadWorkshopSites` / `LoadWorkshopCreators` / `ListModelAuthors` / `ScanLocalAuthors`）、`fetchCommunityCreators` / `mergeCommunityCreators` / `fetchCommunitySites` / `mergeCommunitySites` / `getRepoModelsData` / `fillSearch`
- `community/diagnostics.ts` — 诊断页 `initDiagnostics` 与 `startDedup` 去重流程（派发 `model:select` / `stats:refresh` / `tree:reload`）
- `community/settings.ts` — 设置页 `initSettings`：直接解构 bindings（`LoadAppConfig` / `SaveAppConfig` / `SelectDirectory` / `GetMinecraftPaths` / `SetLinkMode`），配置变更派发 `config:updated` / `stats:refresh` / `toast:show`，并接入 `initVersionUpdater`
- `community/site-view.ts` — 站点视图 `renderSiteView`：创作者/站点卡片渲染与收藏落库（`App.SaveWorkshopCreators` / `SaveWorkshopSites` / `LoadGitHubRepos` / `LoadResourceTypes`）
- `community/workshop-data.ts` — 工坊纯数据工具：`PLATFORM_NAMES` / `getCreatorIdentity` / `getTagFromRole` / `parseDescTags` / 收藏 `loadFavs` / `saveFavs` / `isFaved` / `toggleFav`（localStorage `ysm-fav-creators`）
- `community/workshop-icons.ts` — SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`

## 对外 API / 入口

- 自定义元素：`<app-content>`
- 监听 bus：`nav:change`（切页并回发 `nav:changed`，同时 `App.ClearScanCache()` 清扫描缓存）、`repo:switch-tab`、`repo:search-creator`（写入 `setPendingTreeSearch` 后切仓库页）、`package:selected`（instances 页注入 `<app-sync-manager>`）、`repo:rtype-changed`、`avatar:refresh`
- 派发 bus：`nav:changed`、`repo:rtype-changed`、`toast:show`
- 全局 handler 注册：`connectedCallback` 末尾调用 `registerGlobalHandlers()`（`core/global-handlers.ts`，汇聚 DnD / 同步 / 实例操作 handler，返回 unsub 数组收进 `_globalUnsubs`）
- getApp 调用：`ClearScanCache`、`LoadGitHubRepos`

## 与其他子系统关系

- `app-nav` 是 `nav:change` 的派发源；本组件消费后整块重渲染并回发 `nav:changed`（见知识卡 `app_nav`）
- 仓库页渲染时动态 `import("../app-preview/index.ts")` 懒加载预览面板（见知识卡 `app_preview`）
- `package:selected` 由 `app-sidebar` 卡片点击派发，本组件据此挂载 `<app-sync-manager instance=...>`（见知识卡 `app_sidebar`、`app_sync_manager`）
- 仓库页事件绑定与卡片渲染委托 `features/community/events.ts`（`bindRepoEvents`，清理函数存 `_repoEventsCleanup`）与 `features/community/render.ts`
- 所有 Go 调用统一走 `getApp()`（见知识卡 `wails_bridge`）；跨组件通信走 bus（见知识卡 `event_bus`）

## 不变量

- 全局事件 handler 只在 `app-content` 的 `connectedCallback` 注册一次（致命陷阱 #2），返回的 unsub 全部收进 `_globalUnsubs`
- 所有 `bus.on` 订阅（`_unsub` / `_globalUnsubs` / `_unsubs`）必须在 `disconnectedCallback` 逐一清理；`document` 级 resize 监听先移除再重绑，防止切页累积泄漏
- 样式走 `adoptedStyleSheets` + CSS 变量，无硬编码颜色；`innerHTML` 拼接统一过 `_esc` / `esc`
- 页面级临时缓存（`_workshopCache` / `_githubCache`）在 `disconnectedCallback` 清空

## 相关

- `frontend/js/core/global-handlers.ts` — 全局 handler 汇聚入口（handler-dnd / handler-sync / handler-other）
- `frontend/js/features/community/` — 仓库页数据/渲染/事件/下载队列（`bindRepoEvents` 等由 index.ts 调用）
- `frontend/js/components/app-content/community/` — 与 features/community 并存的创意工坊模块（site-view / core / settings / diagnostics / workshop-data / workshop-icons），index.ts 同时引用两套，改动前先确认归属
- `frontend/js/components/app-tree/index.ts` — `setPendingTreeSearch` 搜索词交接
- 知识卡：`app_nav`、`app_preview`、`app_sidebar`、`app_sync_manager`、`event_bus`、`wails_bridge`
