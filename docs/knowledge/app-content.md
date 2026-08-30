---
kind: app-content
name: 主内容页 app-content
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/
  - frontend/src/views/app-content/content-creator.ts
  - frontend/src/views/app-content/content-diag.ts
  - frontend/src/views/app-content/content-util.ts
  - frontend/src/views/app-content/site/render.ts
  - frontend/src/views/app-content/community-data.ts
  - frontend/src/views/app-content/diagnostics/init.ts
  - frontend/src/views/app-content/diagnostics/logs.ts
  - frontend/src/views/app-content/diagnostics/dedup.ts
  - frontend/src/views/app-content/diagnostics/health.ts
  - frontend/src/views/app-content/diagnostics/conflicts.ts
  - frontend/src/views/app-content/settings/init.ts
  - frontend/src/views/app-content/tpl-recycle.ts
  - frontend/src/views/app-content/tpl-settings.ts
  - frontend/src/views/app-content/tpl-settings-about.ts
  - frontend/src/views/app-content/settings/store.ts
  - frontend/src/views/app-content/settings/path-cards.ts
  - frontend/src/views/app-content/settings/theme.ts
  - frontend/src/views/app-content/settings/ui-prefs.ts
  - frontend/src/views/app-content/settings/keymap.ts
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
invariant_anchors:
  - frontend/src/views/app-content/index.ts|_unsubs
---

# 主内容页 app-content

## 概览

`app-content` 是应用的主内容区组件（Shadow DOM + adoptedStyleSheets），承载 6 个页面：模型仓库（repository）、整合包管理（instances）、创作者频道（workshop）、创意工坊（github）、诊断与冲突（diagnostics/oldest）、设置（settings）。它监听 `nav:change` 整块重渲染当前页，也是全部全局事件 handler 的唯一注册点（致命陷阱 #2 的解法）。

构造器不再硬编码 `"repository"`，而是与 `app-nav`、`PageStore` 三源同源调用 `resolveInitialPage()`（`core/page-store.ts`）：`app-content` 经 `app-modules.ts` 动态加载，可能晚于 `app-nav` 派发的初始 `nav:change`，事件被吞后若硬编码首页，会让 UI 实际渲染页与 `PageStore.currentPage` 脱节。旧版全局 DnD 曾依赖 `page === "repository"` 守卫，现仓库页 DnD 已改为 `app-tree` 组件级绑定，不再受该守卫影响。

**i18n 收敛（2026-08-31）**：`app-content` 子域（工坊/站点编辑/诊断/设置）约 70 处裸中文 toast/弹窗/角色标签已全量迁移到 `workshop.*` / `diagnostics.*` / `settings.*` / `content.*` key（复用 `tree.browserFailed` / `content.settingsInitFailed` / `diagnostics.all`），三语言包同步（1431 keys）；残留仅 `dbg/console` 日志与 CLI 输出解析匹配符（非 UI 文案，不迁移）。新增 key 集中在 zh-CN.ts 各命名空间注释段，改 UI 文案只改语言包。

## 核心职责

- `index.ts` — `<app-content>` 生命周期编排：构造器 `resolveInitialPage()` 定初始页、`nav:change` 切页、`_render()` 按 `_current` 选择模板并重渲染、`_bindTabs` 懒初始化子 tab、预览面板拖拽调宽（localStorage `preview-width`，范围 160–500）。`<app-preview>` 改为顶部副作用静态导入 `import "../app-preview/index.ts"`（替代原动态 import 预加载）
- `tpl.ts` — 页面布局模板：`repositoryHTML` / `instancesHTML` / `settingsHTML` / `diagnosticsHTML` / `workshopHTML` / `githubHTML` / `downloadsHTML` / `recycleHTML`
- `content-css.ts` — 样式组合层：`[layout, repo, creator, diag, util, stg].join("\n")` 输出单一 CSS 字符串（6 个域文件），入口 `index.ts` 构造时 `root.adoptedStyleSheets = [appContentStyle]` 注入 Shadow DOM；CSS 全走 CSS 变量。注意：`.stg-*` 设置页样式与 `.tab-body` 已回迁本组合层（原误置于 `frontend/css/components.css` 全局 `<link>`，被 Shadow DOM 边界阻断不生效，见 2026-08-24 复盘）
- `content-layout.ts` — 基础层：`::host` 变量（`--tag-*` / `--badge-*` / `--hm-*` / `--sidebar-w` / `--diag-left-w` / `--touch-min`）+ 通用 keyframes（`pageIn` / `ring-spin` / `card-in` / `detail-in` / `fade-in` / `dl-slide-up` + 跨 shadow 本地化副本 `fadeSlideUp` / `fadeSlideDown` / `fadeSlideLeft` / `breathe-subtle`：**CSS 变量可穿 shadow，@keyframes 不可，必须在 shadow 层本地重定义**）+ 骨架（`.page` / `.stat-card` / `.placeholder-box`）+ 通用卡片系统（`.model-card` / `.model-card-sm` / `.rec-card` / `.health-ring`）+ 工坊通用按钮类（`.ws-*`：从 content-creator.ts 归位，跨 creator/gh 复用）。注：`.btn` 裸类兼容层与 `.hdr-btn` 已于 2026-08-24 迁移清理（设置页 3 处裸 `.btn` → `.btn-base sm`，兼容层删除）
  - **本地化 keyframe 契约（铁律，机检 1c 硬校验）**：`fadeSlideUp/Down/Left` 的 shadow 副本必须与 `frontend/css/components.css` 全局副本**参数值一致**（`translateY(6px)` / `translateY(-4px)` / `translateX(-8px)` 的 translate 数值）。注：不要求字节级一致（多行 vs 单行格式差异允许），仅比对 translate 参数值。`scripts/css-layer-check.mjs` 检查 1c 从两侧正则提取 from translate 值比对，不一致即 ERROR 阻断 pre-push（评审 2026-08-24 第 2 条，封堵本次 6→10/-4→-10/-8→-14 漂移逃逸路径）。document 层 dialog 与 shadow 内容用同名动画，幅度分裂会造成观感不一致。`sidebar-css.ts` 的 `fadeSlideLeft` 同此契约。`stgTabIn(-6px)` 为 settings 独立新 keyframe，不在此契约内。
- `content-repo.ts` — 仓库/实例/站点骨架（`.repo-*` / `.ins-*` / `.batch-*`）+ 资历页（`.oldest-*`）+ 热力图（`.hm-*` / `.pick-card`）+ 通用标签（`.tag-author` / `.tag-work` / `.tag-date` / `.link-badge-*`）
- `content-creator.ts` — 创作者 `.cr-*` 全族：标签（`.cr-tag*`）/ 频道（`.cr-page` / `.cr-left` / `.cr-right`）/ 卡片（`.cr-creator-card` 基础列表行 + `.cr-creator-card--grid` BEM 修饰符网格变体 + `.cr-card-*` / `.cr-creator-grid`）/ 详情浮层（`.cr-detail-*`）/ 编辑（`.cr-edit-*` / `.cr-input*` / `.cr-drop-zone` / drag states）；含头像 `.cr-avatar` / `.cr-avatar-ring` 供 gh-card 复用（`.ws-*` 工坊类已迁 content-layout.ts）
- `content-diag.ts` — 诊断页（`.diag-*` / `.perf-*` / `.log-row` / `.conflict-row` / `.scan-*` 动画）+ GitHub 工坊（`.gh-*` 全族：仓库列表 / 模型行 / 二级菜单 / 下载队列 / 错误页）。注：`.settings-group` / `.setting-row` 已于 2026-08-24 收口至 `content-stg.ts`（设置页资产归 settings 域托管），本文件不再含设置页样式；`#set-advanced-panel` 的 advPanel 动画在 content-stg.ts
- `content-util.ts` — 杂项：回收站动画（`.recy-*`）/ 资源管理器（`.rm-*`）/ 预览拖拽（`.preview-resize-handle`）/ 主题选择器（`.theme-*`）/ 响应式 `@media (max-width:768px)`
- `community-data.ts` — 社区数据层：`loadCommunityData` **首屏快路径**（并发 `App.DefaultWorkshopSites` / `LoadWorkshopCreators` / `ListModelAuthors`，**不含磁盘扫描**）；`loadLocalAuthors`（本地作者扫描，withCached 5min **STALE** 策略：过期返旧值后台刷新）+ `mergeLocalAuthorsInto`（幂等合并，同名去重 + type 分段精确比较）供调用方首屏渲染后异步补充——拆分前扫描坐在 Promise.all 里阻塞整个 tab 栏（大库秒级~分钟级）；另有 `fetchCommunityCreators` / `mergeCommunityCreators` / `fetchCommunitySites` / `mergeCommunitySites` / `fillSearch` / `DEFAULT_COMMUNITY_URL`
- `diagnostics/init.ts` — 诊断页 `initDiagnostics` 与 `startDedup` 去重流程（派发 `model:select` / `stats:refresh` / `tree:reload`）
- `diagnostics/health.ts` — 仓库体检面板：调 Go 端 `RepoHealthAudit`（go/repoaudit 同源，GUI/CLI 消双轨），渲染分数环/完整性/缓存/资源/去重/警告
- `settings/init.ts` — 设置页 `initSettings`：直接解构 bindings（`LoadAppConfig` / `SaveAppConfig` / `SelectDirectory` / `GetMinecraftPaths` / `SetLinkMode`），配置变更派发 `config:updated` / `stats:refresh` / `toast:show`，并接入 `initVersionUpdater`；「启动默认页面」下拉读写 localStorage `ui-default-page`，显示值兜底 `repository`（与 `resolveInitialPage` 的兜底一致）
- `site-view.ts` — 站点视图 `renderSiteView`：组装 `SiteViewState` 后委托 `site/` 子模块渲染与绑定；行内编辑选择器排除预设卡片（`[data-idx][data-fld]:not([data-edit='preset'])`，防预设 label 输入污染创作者对象，P2 修复）；拖拽 drop 用 `realIdx` 在 `allCreators` 全量数组上重排（防站点子集覆盖清空其他站点，P2 修复）
- `site/types.ts` / `site/render.ts` / `site/events.ts` / `site/edit.ts` / `site/drag.ts` — 站点视图拆分：状态类型 `SiteViewState` / `CleanupFn`、`createCrCard` + `buildSiteHtml` 渲染、`bindBrowseEvents` 浏览交互、`bindEditEvents` 编辑模式（AbortController signal 贯穿 7 个 eeBind* 全部监听，cleanup 真实解绑幂等）、`bindDragEvents` 卡片拖拽排序；各 bind 均返回 `CleanupFn`
- `workshop-data.ts` — 工坊纯数据工具：`getCreatorIdentity` / `getTagFromRole` / `parseDescTags` / 收藏 `loadFavs` / `isFaved` / `toggleFav`（localStorage `ysm-fav-creators`，写入函数 `saveFavs` 为模块内私有）
- `workshop-icons.ts` — SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`
- `workshop-site-opener.ts` — 站点打开器：`openSite(host, site, browseMode, targetUrl)` 按模式走 `openEmbedded`（iframe）/ `NavigatePlazaWindow` / `OpenInBrowser`，`targetUrl` 缺省回退 `site.url`；site-view 的 `ctx.openUrl` 把搜索链路 `fillSearch` 拼好的带词链接**透传**给 `openSite`（曾丢弃入参只开首页 → 全站搜索退化为只开网站，P1 修复）

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
- 所有 `bus.on` 订阅（`_unsub` / `_globalUnsubs` / `_unsubs`）必须在 `disconnectedCallback` 逐一清理；`document` 级 resize 监听先移除再重绑，防止切页累积泄漏。**`_unsubs` 在 `_render()` 开头同样清理**（P2 修复：app-content 常驻不卸载，原仅 disconnectedCallback 清理 → 多次访问 repository 的 dedup/oldest/import/recycle 会让 `repo:rtype-changed` 监听跨访问累积，N 次访问后一次切换触发 N 次 doDedup）
- `_render()` 内页面 init 分发整体包 try/catch：init 抛错不中断调用方，转 `console.error` + `toast:show` 反馈用户而非静默
- 样式走 `adoptedStyleSheets` + CSS 变量，无硬编码颜色；`innerHTML` 拼接统一过 `_esc` / `esc`
- 页面级临时缓存（`_workshopCache` / `_githubCache`）与 `_workshopTimer` 定时器在 `disconnectedCallback` 清空
- 站点搜索带词链接必须**真传**到底层打开调用：`ctx.openUrl(url)` → `openSite(host, site, mode, url)` 的 `url` 不得丢弃，否则站点视图预设 / 卡片作者搜索 / 详情浮层全部退化为只开网站首页（实际触发时与 `searchUrl` 数据是否齐全无关，P1 修复锁定于 `workshop-site-opener.test.ts`）
- 浏览模式按「点谁用谁 + 即时生效」，且收敛为**单源 ref**：`browseMode` 存为 `BrowseModeRef{ v }`（与 `wsEditModeRef:{v}` 同构），经 `ctx.browseMode` 贯穿到 `renderSiteView` 高亮（读 `.v`）与 `openUrl`→`openSite`，`setBrowseMode` 只改 `.v` + localStorage → 一处 set、处处一致，无值拷贝 stale。history：曾用单 toggle 按钮 `cycleBrowseMode` 循环切换（点谁都用循环）；后 openUrl 引用 live 变量而高亮读到 ctx 值拷贝旧值 →「能打开新模式但高亮不动」，本次重构 ref 根治；`bindSiteEvents` 死参 browseMode 已随重构清除

## 相关

- `frontend/src/core/handlers/global.ts` — 全局 handler 汇聚入口（`registerPageStore` / `registerContextMenus` / `registerSync` / `registerInstanceOps` / `registerAndroidEvents`）；`registerResourceManagerGlobal` 由本文件单独调用
- `frontend/src/views/app-tree/index.ts` — 仓库页 DnD 组件级绑定（`bindTreeDnD`）与显式 `tree-drop-hint`
- `frontend/src/core/page-store.ts` — `resolveInitialPage` / `sanitizePage` / `PageStore`，初始页与页面状态的唯一来源
- `frontend/src/features/community/` — 仓库页数据/渲染/事件/下载队列（`data.ts` / `render.ts` / `events.ts` / `download-queue.ts`，`bindRepoEvents`、`tryFetchModels` 等由 index.ts 调用）
- `frontend/src/views/app-content/site/` — 创意工坊站点视图子模块，与 `features/community/` 并存，index.ts 同时引用两套，改动前先确认归属
- `frontend/src/views/app-tree/index.ts` — `setPendingTreeSearch` 搜索词交接
- 知识卡：`app_nav`、`app_preview`、`app_sidebar`、`app_sync_manager`、`event_bus`、`page_store`、`wails_bridge`
