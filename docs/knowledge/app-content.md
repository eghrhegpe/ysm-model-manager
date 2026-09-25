---
kind: app-content
name: 主内容页 app-content
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/index.ts
  - frontend/src/views/app-content/tpl.ts
  - frontend/src/views/app-content/tpl-recycle.ts
  - frontend/src/views/app-content/settings/tpl-settings.ts
  - frontend/src/views/app-content/settings/tpl-settings-about.ts
  - frontend/src/views/app-content/css/content-css.ts
  - frontend/src/views/app-content/css/content-layout.ts
  - frontend/src/views/app-content/css/content-repo.ts
  - frontend/src/views/app-content/css/content-creator.ts
  - frontend/src/views/app-content/css/content-diag.ts
  - frontend/src/views/app-content/css/content-stg.ts
  - frontend/src/views/app-content/css/content-util.ts
  - frontend/src/views/app-content/init-pages.ts
  - frontend/src/views/app-content/init-preview.ts
  - frontend/src/views/app-content/init-workshop.ts
  - frontend/src/views/app-content/init-github.ts
  - frontend/src/views/app-content/page-registry.ts
  - frontend/src/views/app-content/state.ts
  - frontend/src/views/app-content/host.ts
  - frontend/src/views/app-content/subscription-bucket.ts
  - frontend/src/views/app-content/site/workshop-avatar.ts
  - frontend/src/views/app-content/site/workshop-page-state.ts
  - frontend/src/views/app-content/site/workshop-tabs.ts
  - frontend/src/views/app-content/site/workshop-site-opener.ts
  - frontend/src/utils/icon/workshop-icons.ts
auto_fields:
  symbols_with_lines:
    - aboutPageBody
    - AppContentHost
    - AppContentState
    - appContentStyle
    - bindSiteEvents
    - bindTabs
    - contentCreatorCSS
    - contentCSS
    - contentDiagCSS
    - contentLayoutCSS
    - contentRepoCSS
    - contentStgCSS
    - contentUtilCSS
    - createWorkshopPageState
    - createWorkshopRefs
    - diagnosticsHTML
    - extractAvatars
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
    - openSite
    - PAGE_REGISTRY
    - PageDefinition
    - recycleHTML
    - renderRecycleListHtml
    - RepoCacheEntry
    - repositoryHTML
    - resetAvatarConfigLoaded
    - settingsHTML
    - SubscriptionBucket
    - VIEW_TESTIDS
    - workshopHTML
    - WorkshopPageState
    - WorkshopRefs
  tests:
    - frontend/src/utils/resource/types.test.ts
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-toast/index.test.ts
    - frontend/src/views/app-tree/render.test.ts
    - frontend/src/views/context-menu/index.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 主内容区、页面切换、仓库页 / 创作者页 / 社区页
  - nav:changed 事件分发、全局 handler 注册
  - 页面初始化流程、订阅桶 / 会话状态
quick_risk_lines:
  - 主内容区页面切换必须经 nav:changed / app-nav 路由分发，禁止页面之间直接 init 对方
pitfalls:
  - 页面 A 直接调用页面 B 的 init → 重复初始化 / 订阅泄漏；必须经 nav:changed 单点分发
  - subscription-bucket 未退订 → 跨页残留监听、状态串扰；每次切换必须 clear 旧桶
use_when:
  - 主内容区
  - 页面切换
  - nav:changed
  - 仓库页
  - 全局 handler
invariant_anchors:
  - frontend/src/views/app-content/index.ts|AppContent
  - frontend/src/views/app-content/state.ts|AppContentState
status: active
---

# 主内容页 app-content

## 概览

`app-content` 是应用的主内容区组件（Shadow DOM + adoptedStyleSheets），承载 6 个页面：模型仓库（repository）、整合包管理（instances）、创作者频道（workshop）、创意工坊（github）、诊断（diagnostics/oldest，导航文案旧名「诊断与冲突」已随冲突 tab 退役收口为「诊断」）、设置（settings）。它监听 `nav:changed` 整块重渲染当前页，也是全部全局事件 handler 的唯一注册点（致命陷阱 #2 的解法）。

构造器不再硬编码 `"repository"`，而是与 `app-nav` 两处同源调用 `resolveInitialPage()`（`core/page-store.ts`）：`app-content` 经 `app-modules.ts` 动态加载，可能晚于 `app-nav` 派发的初始 `nav:changed`，事件被吞后若硬编码首页，会让 UI 实际渲染页与 `app-nav` 脱节。旧版全局 DnD 曾依赖 `page === "repository"` 守卫，现仓库页 DnD 已改为 `app-tree` 组件级绑定，不再受该守卫影响。

UI 文案统一走 i18n key（`workshop.*` / `diagnostics.*` / `settings.*` / `content.*`），改文案只改语言包。

## 核心职责

> **子域拆分（2026-08-31，ADR-138 同批）**：诊断页 / 设置页 / 站点视图已拆为独立子卡——
> 本卡只持编排、模板、样式层、共享数据与工坊装配。见：
> - [诊断页 `app_content_diagnostics`](./app_content_diagnostics.md) — `diagnostics/` 全子模块
> - [设置页 `app_content_settings`](./app_content_settings.md) — `settings/` 全子模块
> - [创意工坊站点视图 `app_content_site`](./app_content_site.md) — `site/` + `site-view.ts` + `workshop-data` / `workshop-browse-mode`

- `index.ts` — `<app-content>` 生命周期编排：构造器 `resolveInitialPage()` 定初始页、`nav:changed` 切页、`_render()` 按 `_current` 选择模板并重渲染（**同页重放短路**：缓存面板 `isConnected` 时直接 return——见「监听 bus」说明；防线 `app-content.component.test.ts` 同页用例）、`_bindTabs` 懒初始化子 tab、预览面板拖拽调宽（**宽度真值单点在 `init-preview.ts`**：localStorage `preview-width` 恢复 + 拖拽共用 160/500/240 夹取常量，模板不再写死 width）。`<app-preview>` 改为顶部副作用静态导入 `import "../app-preview/index.ts"`（替代原动态 import 预加载）；`connectedCallback` 末尾直接注册四组全局 handler（`registerSync` / `registerContextMenus` / `registerInstanceOps` / `registerAndroidEvents`，见 `features/sync.ts` / `features/context-menu/context-menus.ts` / `features/pack-ops/instance-ops.ts` / `features/platform/android-events.ts`）
- `tpl.ts` — 页面布局模板：`repositoryHTML` / `instancesHTML` / `settingsHTML` / `diagnosticsHTML` / `workshopHTML` / `githubHTML` / `downloadsHTML` / `recycleHTML`。**repository 的 tree tab `body` 留空**——初始挂载单点归 `init-pages.ts|initRepositoryPage.mountTree`（localStorage 恢复 rtype/subdir），模板硬编码 `<app-tree>` 会造成首挂双 mount（connect 发起扫描 RPC 后立即被替换销毁，2026-09 收债）。**rtype 变更复用实例改属性**（2026-09 收债，同 mountSyncManager 范式）：mountTree 对已存在的 app-tree 走 setAttribute/removeAttribute（app-tree 属性机制重载，视图状态跨切换存活），同值 emit 被 `oldVal === newVal` 拦下——「强制刷新树」语义归 `tree:reload`（settings/init.ts FSA 流已改发，勿再借同值 repo:rtype-changed 当刷新用）
- `tabs-shell.ts` — **tab 栏 + 面板容器的单点产出**（ADR-259）：`renderTabs(spec) → { bar, panels }`，由声明数组产出「`.repo-tabs` + 每 tab 一个 `.tab-body`」。面板 id 一律 `${prefix}-tab-${id}`，与 `init-pages.ts|bindTabs` 的运行期查找**共享同一条规则**；首个面板不写 `display`（回落 `.tab-body`）、其余 `display:none`，与 `bindTabs.activate` 的翻转口径一致。差异项（`buttonClass` / `panelClass` / `barId` / `panelTestid` / `buttonTestid` / `panelStyle`）全走声明参数。**新增 tab 只填数组，结构由工厂保证**；`workshopHTML` 例外——其 tab 栏由 `initWorkshopPage` 运行期动态注入，非静态声明。结构性防线见 `tpl-structure.test.ts`。
- `init-pages.ts|bindTabs(host, tabSelector, prefix)` — tab 壳的**运行期**绑定（ARIA tablist/roving tabindex/键盘/懒初始化/面板切换）。**真值源 = 按钮自身的 `data-tab`，不接受调用方手传 id 白名单**（ADR-259 §2.6）：白名单曾是第二份手工真值，新增 tab 漏同步即「按钮在、点了没反应、内容区空白」且不报错（2026-09 设置页新增「操作」tab 的真实事故）。新增 tab 只需改模板一处；契约违例（按钮缺 `data-tab` / 缺面板）走 `logWarn` 响亮告警。懒初始化仍须在 `TAB_INIT` 登记（当前 recycle/dedup/oldest）。防线：`init-pages.test.ts` + `tpl-structure.test.ts` 的「调用点不得出现数组白名单」静态闸。
- `css/content-css.ts` — 样式组合层：6 个域 CSS 文件（同在 `css/` 子目录）join 输出单一字符串，经 `adoptedStyleSheets` 注入 Shadow DOM，全走 CSS 变量。
- `css/content-layout.ts` — 基础层：`::host` 变量 + 通用 keyframes + 骨架卡片系统（`.page` / `.stat-card` / `.model-card` / `.health-ring` 等）+ 工坊通用按钮类（`.ws-*`）。**CSS 变量可穿 shadow，@keyframes 不可**——必须在 shadow 层本地重定义副本，且参数值与全局副本一致（机检 1c 硬校验，`scripts/css-layer-check.ts` 阻断 pre-push）。
- **居中空态/加载态块 = `.placeholder-box` 唯一原语**（`content-layout`；`.big` 大图标槽 + `--roomy` 大面积留白变体）。消费方只放内容（图标/文案/操作），**不内联、不复刻**。2026-09 体检收纳三份同构实现：本类曾是**零消费者死 CSS**，实例页把配方内联照抄一份（还借了 app-preview 的 `.dp-placeholder` 类名——在 app-content 的 shadow 内无规则），工坊站点又复刻成 `.cr-empty-site`。**刻意不并**另两族（形状不同，硬并会造视觉回归）：居中提示行（`.gh-loading-placeholder` / `.perf-no-data` / `.gh-initial-hint`）与左对齐小提示（`.stg-hint` / `.stg-card-hint`）。机检：`content-css.test.ts`「竖排+双向居中+muted 配方只允许出现在 `.placeholder-box`」（签名含 muted 是刻意的——只用三个 flex 属性会误伤 `.health-ring-inner` 这类圆环内居中数字）。
- `css/content-repo.ts` — 仓库/实例/站点骨架 + 资历页 + 通用标签。原含日历热力图 `.hm-*` 13 条（`.hm-grid`/`.hm-col`/`.hm-cell.l1..l4`/`.hm-legend` 等），2026-09 核实 **src 与 e2e 全无消费者**（git 考古 `-S 'hm-grid'` 显示引入后从未被消费）后连同孤儿令牌 `--hm-0..4` 一并删除；**资历页月热力图另有其一**（`tpl-oldest.ts` 的 `.heatmap-bar-*`，布局由内联容器与 bar 的 height/color 承载，本无 CSS 规则）。
- `css/content-creator.ts` — 创作者 `.cr-*` 全族样式（标签/频道/卡片/详情浮层/编辑）。
- `css/content-diag.ts` — 诊断页样式：日志工具栏（`.diag-log-*`）+ **通用布局三件套**（`.diag-pane` / `.diag-bar` / `.diag-bar-row` / `.diag-bar-hint` = 全页 tab 的「上栏常驻 + 结果独立」骨架，2026-09-21 由 `.perf-wrap` / `.perf-controls` / `.perf-row` / `.perf-hint` **泛化改名**而来、规则逐字未变，ADR-288 D1；这些类此前**零 CSS 规则**，由 `css-layer-check` 报出后补齐）+ 冲突/扫描/去重/同步配置。GitHub 工坊 `.gh-*` 全族**已拆至 `content-gh.ts`**（本行原称仍含 gh-*，为陈旧描述）。
- `css/content-util.ts` — 回收站动画 / 资源管理器 / 预览拖拽 / 主题选择器 / 响应式 `@media`。
- 社区数据层（`community-data.ts`，ADR-223 北迁 `features/community/community-data.ts`，经 `community-deps` seam 取绑定）：`loadCommunityData` 首屏快路径（不含磁盘扫描）；`loadLocalAuthors` withCached 5min **STALE** 策略（过期返旧值后台刷新）；`mergeLocalAuthorsInto` 幂等合并（同名去重 + type 分段精确比较）。
- `workshop-icons.ts` — SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`
- `workshop-site-opener.ts` — 站点打开器：`openSite(host, site, browseMode, targetUrl)` 按模式走 `openEmbedded` / `NavigatePlazaWindow` / `OpenInBrowser`；`targetUrl` 缺省回退 `site.url`；site-view 的 `ctx.openUrl` 须把搜索词链接**透传**给 `openSite`，不得丢弃。`bindSiteEvents(host, page)` 经页作用域句柄读当前站点（ADR-263）。
- **`AppContentState` 字段归属（ADR-263/264 收口）**：容器只收 app 壳层基础设施（`root` / `current` / `pagePanels` / `resizeMove` / `resizeUp`）与唯一一个**有意跨切**的字段——`workshopTimer`（清理点在 `_render` 开头且**必须早于 `page.init`**，搬进页内无法等效）。`currentSite` 已下沉 `site/workshop-page-state.ts`（ADR-263）；`avatarCache` 已上收 `features/community/creator-avatar-store.ts`（ADR-264，与写入方 download-queue-store 同寿命同形态）。新增字段前先读 `state.ts` 逐字段注释，别再把页私有/跨页状态往里塞。
- **订阅桶 `add*Once` 改收工厂（ADR-264）**：`addGlobalOnce(key, () => bus.on(...))` / `addPageOnce(key, () => bus.on(...))`——传现成退订函数会在实参位置急切求值，幂等分支命中时遗留「已生效但未入桶」的孤儿订阅（实测：二次 init 后一次 emit 触发两次）。TypeScript 签名 `() => () => void` 会拦截写错形态。
- **site 层不再收 host（ADR-265）**：`openSite(root, site, mode, url)` / `bindSiteEvents(root, page)` / `initWorkshopTabs(root, refs, page, registerDefaultSiteTimer)`——三入口只收 `root: ShadowRoot` 与页作用域句柄；定时器经登记函数一次性交回壳层（清理点在 `_render` 开头，所有权不变）。site 目录生产文件 `AppContentHost` 零命中，「接口宽度即权限」系列收口。

## 对外 API / 入口

- 自定义元素：`<app-content>`
- 监听 bus：`nav:changed`（切页整块重渲染，**同页重放短路**：缓存面板仍 `isConnected` 时直接 return——appendChild 对已挂载节点是 DOM move，会触发 app-tree 断连重连（全量重扫 RPC）与 app-preview 重连自清（详情面板清成空壳）；lang:changed / 装配失败路径先 `clearPanels` 面板已分离，天然绕过短路照常重建。判据用 isConnected 而非同页键，2026-09 收债）；`index.ts` 注释明示「不再每次 nav:changed 清扫描缓存」——30s 缓存由导入/同步/下载等实际数据变更处失效，见 `go-scanner.md`/`go-watcher.md`、`repo:switch-tab`、`repo:search-creator`（**先 `setPendingTreeSearch(name)` 再 emit** `nav:changed` 切仓库页 + emit `tree:set-search`——app-tree 已挂直达现存树，同页重放时经短路免重挂；app-tree chunk 未加载（元素未升级）时 emit 落空，词留 `utils/dom/search-pending.ts` 的一次性 pending，由 app-tree 挂载段 take 消费（focus-pending 同族，2026-09 收债；listener 命中路径也 take 清残，防迟到误填））、`package:selected`（instances 页注入 `<app-sync-manager>`）、`repo:rtype-changed`、`avatar:refresh`
- 派发 bus：`nav:changed`、`repo:rtype-changed`、`toast:show`（settings/init.ts 的 FSA 重扫/授权流派发 `tree:reload`——刷新树走 reload 链，含 ClearScanCache）
- 全局 handler 注册：`connectedCallback` 末尾经 `globalUnsubs` 数组逐个调用 `registerPageStore` / `registerSync` / `registerContextMenus` / `registerInstanceOps` / `registerAndroidEvents`（ADR-188 后无 `core/handlers/global.ts` 汇编壳，五组 handler 由本组件直接编排，unsub 全部收进数组）；仓库页 DnD 由 `app-tree` 组件内部 `bindTreeDnD` 绑定，不在此注册
- Wails 运行时事件：`Events.On("config-loaded")` 触发头像重提取，用模块级 `_avatarConfigLoadedRegistered` / `_avatarConfigLoadedUnsub` 保证只注册一次，`disconnectedCallback` 回收并复位 flag
- getApp 调用：`LoadGitHubRepos`、`LoadAppConfig`、`GetRepoRoot`、`ScanModelEntries`、`BatchExtractCreatorAvatars`、`OpenInBrowser`、`NavigatePlazaWindow`、`ExportWorkshopSitesJSONFile` / `ImportWorkshopSitesJSONFile`（`ClearScanCache` 已不在本组件切页路径——见监听 bus 说明）

## 与其他子系统关系

- `app-nav` 是 `nav:changed` 的主要派发源；本组件与 `PageStore` 监听 `nav:changed`（本组件切页整块重渲染，`PageStore` 单向更新状态；2026-08-17 起单事件模型，见知识卡 `app_nav`、`page_store`）
- `<app-preview>` 由本模块顶部副作用静态导入完成注册，仓库页模板直接放置元素（见知识卡 `app_preview`）
- `package:selected` 由 `app-sidebar` 卡片点击派发，本组件据此挂载 `<app-sync-manager instance=...>`（见知识卡 `app_sidebar`、`app_sync_manager`）。**2026-09 起为复用语义**：`mountSyncManager` 首次注入元素、后续仅改 `instance`/`default-type` 属性，实例跨整合包存活（组件 `attributeChangedCallback` 已支持 instance 变更）；切包由组件内 `_resetViewState()` 复位视图状态
- 仓库页事件绑定与卡片渲染委托 `features/community/events.ts`（`bindRepoEvents`）与 `features/community/render.ts`；其 cleanup 为**异步**，由两页（github / community，后者旧 id `workshop`，ADR-301）各自持页内可替换槽并 `host.subs.addPage` 登记（ADR-260，**不再**存 `state.repoEventsCleanup` 字段、也不经注入链）；工坊模型列表接入定高虚拟滚动（`virtual-list.ts`，社区上线后索引可顶 2000 级）
- 所有 Go 调用统一走 `getApp()`（见知识卡 `wails_bridge`）；跨组件通信走 bus（见知识卡 `event_bus`）

## 不变量

- 全局事件 handler 只在 `app-content` 的 `connectedCallback` 注册一次（致命陷阱 #2），返回的 unsub 全部收进 `_globalUnsubs`
- 初始页面**三源同源**：`app-nav`、`app-content`、`PageStore` 都只能通过 `resolveInitialPage()` 取初始页，禁止任一处硬编码页面名，否则 UI 与 `PageStore` 脱节（旧版 DnD 遮罩曾依赖该守卫误判；现 DnD 已组件化，不再依赖）
- `resolveInitialPage()` 的 localStorage 取值必须过 `sanitizePage()` 白名单（`VALID_PAGES`）：历史页面名 `resources` 映射为 `repository`，其余未知/损坏值一律回退 `repository`，防止 `_render()` 落入 `default` 分支却无对应 init 分发而形成死页
- 所有 `bus.on` 订阅与页面级拆除统一注册进 `SubscriptionBucket`（`addPage` / `addGlobal` / `setNavUnsub`；`addPage` 收 `() => void | Promise<void>`，ADR-260），在 `disconnectedCallback` 与 `lang:changed` 全量重建时清空。⚠️ **页面级桶不在 `_render()` 开头清**——ADR-163 面板常驻、每页 init 只跑一次，切页清订阅会造「DOM 还在、事件已死」的僵尸页（ADR-260 §2.5）；`document` 级 resize 监听先移除再重绑
- **幂等订阅用 `addPageOnce(key, fn)` / `addGlobalOnce(key, fn)`，不要自己开布尔标志**（ADR-261）：key 集合与订阅集合**同寿命**（`drainPage` / `cleanupAll` 一并清），故 lang:changed 重建后天然可重注册，无需任何外部复位。旧模式（`state.insListenerReg` / `.avatarRefreshRegistered` + `index.ts` 手工复位）已退役——它的不变量维护点横跨页与协调器两处，漏复位即「语言热切换后页面永久失去监听」（僵尸页同族）。⚠️ 幂等**须跨 init 调用**持存：闭包变量做不到（每次 init 新闭包），这也是不能「删了守卫了事」的原因（导出入口被二次调用也必须幂等，测试已锁定）
- `_render()` 内页面 init 分发整体包 try/catch：init 抛错不中断调用方，转 `console.error` + `toast:show` 反馈用户而非静默
- 样式走 `adoptedStyleSheets` + CSS 变量，无硬编码颜色；`innerHTML` 拼接统一过 `_esc` / `esc`；**页面级把 esc 传给渲染函数时统一用 `escUnknown`**（`utils/html/html.ts` 的 `EscFn` 形状适配单点，诊断页 / 去重面板接线），不再写 `(s) => esc(s == null ? "" : String(s))` 内联 lambda——测试夹具曾各手写一份并分裂成 3 / 4 / 5 实体三种转义表
- 页面级临时缓存（`_workshopCache` / `_githubCache`）与 `_workshopTimer` 定时器在 `disconnectedCallback` 清空
- 站点搜索带词链接必须**真传**到底层打开调用：`ctx.openUrl(url)` → `openSite(host, site, mode, url)` 的 `url` 不得丢弃
- 浏览模式收敛为**单源 ref**：`browseMode` 存为 `BrowseModeRef{ v }`，经 `ctx.browseMode` 贯穿到 `renderSiteView` 高亮与 `openUrl`→`openSite`，`setBrowseMode` 只改 `.v` + localStorage → 一处 set、处处一致，无值拷贝 stale
- **community-data.ts 写回路径（2026-09-03 复核修正）**：`tryAutoMergeCommunity` 的「前端一次合并 + 单次 `SaveWorkshopCreators` 整体保存」规避的是**前端逐站循环调 `SaveWorkshopCreatorsBySite` N 次的跨调用部分提交**——BySite 自身（Go `internal/app/app_workshop.go`）是单次 Load→过滤→原子写的完整事务。代价是合并/去重派生逻辑（`mergeLocalAuthorsInto`/`dedupeCreators`/type 分号段比较）落在 TS 侧，触及 AGENTS.md「Go 派生结果只读」红线；长治方案 = 下沉 Go 新增「多站点合并替换」单次原子 binding，须开 ADR 后动（注释内已标注）

## 相关

- 全局 handler 五组直注册（ADR-188 去壳）：`registerPageStore`（`frontend/src/core/page-store.ts`）、`registerSync`（`frontend/src/features/sync.ts`）、`registerContextMenus`（`frontend/src/features/context-menu/context-menus.ts`）、`registerInstanceOps`（`frontend/src/features/pack-ops/instance-ops.ts`）、`registerAndroidEvents`（`frontend/src/features/platform/android-events.ts`）——unsub 收进 `globalUnsubs`
- `frontend/src/views/app-tree/index.ts` — 仓库页 DnD 组件级绑定（`bindTreeDnD`）与显式 `tree-drop-hint`
- `frontend/src/core/page-store.ts` — `resolveInitialPage` / `sanitizePage` 纯函数（页面名校验 + 启动初始页解析），无状态持有（原 `PageStore` 经 ADR-209 移除）
- `frontend/src/features/community/` — 仓库页数据/渲染/事件/下载队列（`data.ts` / `render.ts` / `events.ts` / `download-queue.ts`，`bindRepoEvents`、`tryFetchModels` 等由 index.ts 调用）
- `frontend/src/views/app-content/site/` — 创意工坊站点视图子模块，与 `features/community/` 并存，index.ts 同时引用两套，改动前先确认归属
- `frontend/src/utils/dom/search-pending.ts` — `setPendingTreeSearch`/`takePendingTreeSearch` 搜索词一次性 pending（repo:search-creator 冷启动兜底，原卡曾描述 app-tree 持此符号——实为此轮新建，旧描述系漂移）
- 知识卡：`app_nav`、`app_preview`、`app_sidebar`、`app_sync_manager`、`event_bus`、`page_store`、`wails_bridge`
