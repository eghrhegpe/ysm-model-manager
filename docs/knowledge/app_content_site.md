---
kind: app_content_site
name: 创意工坊站点视图 site
tier: leaf
category: ui
source_files:
  - frontend/src/views/app-content/site/site-view.ts
  - frontend/src/views/app-content/site/render.ts
  - frontend/src/views/app-content/site/events.ts
  - frontend/src/views/app-content/site/edit.ts
  - frontend/src/views/app-content/site/drag.ts
  - frontend/src/views/app-content/site/types.ts
  - frontend/src/views/app-content/site/workshop-data.ts
  - frontend/src/views/app-content/site/workshop-browse-mode.ts
auto_fields:
  symbols_with_lines:
    - bindBrowseEvents
    - bindDragEvents
    - bindEditEvents
    - BrowseMode
    - BrowseModeRef
    - buildSiteHtml
    - BuildSiteHtmlCtx
    - CleanupFn
    - CrCardCtx
    - createBrowseModeRef
    - createCrCard
    - CreatorIdentity
    - CreatorIdentityInput
    - getCreatorIdentity
    - getTagFromRole
    - isFaved
    - loadBrowseMode
    - loadFavs
    - LocalCreatorLike
    - parseDescTags
    - renderSiteView
    - RenderSiteViewCtx
    - RepoAuthorLike
    - saveBrowseMode
    - SiteViewState
    - toggleFav
  tests:
    - frontend/src/views/app-content/site/site-view.test.ts
    - frontend/src/views/app-content/site/render.test.ts
    - frontend/src/views/app-content/site/events.test.ts
    - frontend/src/views/app-content/site/edit.test.ts
    - frontend/src/views/app-content/site/drag.test.ts
    - frontend/src/views/app-content/site/workshop-data.test.ts
    - frontend/src/views/app-content/site/workshop-browse-mode.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 创意工坊、站点 / 创作者频道
  - 浏览模式、编辑模式切换
  - 卡片拖拽、站点卡片渲染
  - workshop-data / workshop-browse-mode
quick_risk_lines:
  - 浏览 / 编辑模式切换必须经 workshop-browse-mode 统一切换，禁止视图层各自判断
pitfalls:
  - 各视图层自己判断模式 → 状态分裂、拖拽行为不一致；必须经 workshop-browse-mode 单点
  - site 拖拽排序未回写 workshop-data → 刷新丢失；必须经 events.ts 的 drag 事件统一落盘
use_when:
  - 创意工坊
  - 站点视图
  - 浏览模式
  - 卡片拖拽
  - workshop-data
invariant_anchors:
  - frontend/src/views/app-content/site/site-view.ts|renderSiteView
status: active
---

# 创意工坊站点视图 site

## 概览

`site/` 子目录（含 `site-view.ts`、`workshop-data.ts`、`workshop-browse-mode.ts` 与 5 个子模块）是 `app-content` 的「创意工坊站点」页子域，由主卡 `app-content` 的 `init-workshop.ts` 调用 `renderSiteView` 组装。内部高内聚：`site-view.ts` 委托同目录 5 个子模块渲染与绑定（render / events / edit / drag / types），并共享 `workshop-data.ts`（收藏/标签解析）与 `workshop-browse-mode.ts`（浏览模式 ref）。对外只依赖 `core/i18n` / `bus` / `backend` / `utils` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据；2026-09 三件套已物理归位 site/ 子目录，消灭顶层散落）。

## 核心职责

- `site-view.ts` — `renderSiteView`：组装 `SiteViewState` 后委托 `site/` 子模块渲染与绑定；行内编辑选择器排除预设卡片（`[data-idx][data-fld]:not([data-edit='preset'])`，防预设 label 输入污染创作者对象，P2 修复）；拖拽 drop 用 `realIdx` 在 `allCreators` 全量数组上重排（防站点子集覆盖清空其他站点，P2 修复）
- `site/types.ts` / `site/render.ts` / `site/events.ts` / `site/edit.ts` / `site/drag.ts` — 状态类型 `SiteViewState` / `CleanupFn`、`createCrCard`（**声明式：返回 HTML 字符串，零 DOM**）+ `buildSiteHtml` 渲染、`bindBrowseEvents` 浏览交互、`bindEditEvents` 编辑模式（AbortController signal 贯穿 7 个 eeBind* 全部监听，cleanup 真实解绑幂等）、`bindDragEvents` 卡片拖拽排序；各 bind 均返回 `CleanupFn`
- `workshop-data.ts` — 工坊纯数据工具：`getCreatorIdentity` / `getTagFromRole` / `parseDescTags`（**只认「标签式描述」**：顿号/全角逗号切分 + ≥2 段且每段 ≤12 字符才返回片段，否则返回 `[]` 由详情层回退全文；ASCII 逗号不参与切分）/ 收藏 `loadFavs` / `isFaved` / `toggleFav`（localStorage `ysm-fav-creators`，写入函数 `saveFavs` 为模块内私有）
- `workshop-browse-mode.ts` — 浏览模式 ref：`BrowseModeRef{ v }` 单源（与 `wsEditModeRef:{v}` 同构），经 `ctx.browseMode` 贯穿到渲染高亮与 `openUrl`，`setBrowseMode` 只改 `.v` + localStorage → 一处 set、处处一致

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-workshop.ts` 调用：`renderSiteView(ctx)` 渲染站点页（页面切换由主卡 `nav:changed` 监听驱动，site 子模块不直接订阅导航事件）
- 派发 bus：`nav:changed`（空状态跳转 repository，`site/events.ts|cmBbBindEmptyLocalBtn` 的 `[data-local-empty]` 分支）；收藏变更（localStorage 事件）
- 样式：`.cr-*` 创作者全族 + `.ws-*` 工坊类定义在 `app-content` 样式层 `content-creator.ts` / `content-layout.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `workshop-icons.ts`（`utils/icon`）→ SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`（site/events、site/render 消费）
- `workshop-site-opener.ts` → `ctx.openUrl` 把搜索链路 `fillSearch` 拼好的带词链接透传给 `openSite`（site 视图的打开器在 `init-workshop.ts` 装配，见主卡）；内嵌分支 `workshop-site-opener.ts|openEmbedded` 的加载超时由 iframe 实例级 `_wsLoadAbort`（AbortController）承载（`WS_EMBED_TIMEOUT_MS` 15s 未完成加载 → 提示站点不允许内嵌浏览）：开新页先 abort 上一轮、load 完成或超时均 abort 收口、返回按钮同样 abort，消除 timer 残留竞态
- 主卡 `app-content` 负责页面编排与分发；本卡只管站点视图自身的渲染与交互
- **页作用域句柄 `workshop-page-state.ts`（ADR-263）**：`createWorkshopPageState()` → `WorkshopPageState { getCurrentSite() / setCurrentSite(site) }`，承载「当前浏览站点」。它是 `currentSite` 从 `AppContentState` 下沉后的家——tabs（写）/ opener（读）/ `init-workshop.ts` 注入链（读写）共享**同一实例**（由 `init-workshop.ts` 创建并下传），与 `WorkshopRefs` 同构：只给工厂、**不给模块级单例**，防「形状相同、实例不同」的 stale 错位。两者分工：refs 收**可替换的整份数据**（sites/creators 整体换新），page-state 收**页面级游标**（当前站点）

## 不变量

- 站点搜索带词链接必须**真传**到底层打开调用：`ctx.openUrl(url)` → `openSite(host, site, mode, url)` 的 `url` 不得丢弃，否则站点视图预设 / 卡片作者搜索 / 详情浮层全部退化为只开网站首页（P1 修复锁定于 `workshop-site-opener.test.ts`）
- 浏览模式「点谁用谁 + 即时生效」，收敛为单源 ref：`browseMode` 存 `BrowseModeRef{ v }`，禁止值拷贝 stale
- 行内编辑排除预设卡片、拖拽用 `realIdx` 全量重排——两处 P2 修复为站点数据不污染的底线
- **站点 JSON 导入下沉 Go**（ADR-172 对称，堵 site/edit + site/drag 双轨）：`site/edit.ts` 社区站点并入走 Go `MergeCommunitySitesFromJSON`（返回增量计数，前端 `mergeCommunitySites` 仅内存展示层合并、不驱动写回）；`site/drag.ts` 站点 JSON 拖入走 Go `MergeWorkshopSitesFromJSON`（合并/去重/写回下沉 Go，前端用 `DefaultWorkshopSites()` 拉取落盘后的最新结果刷新 `allSites`）——两端都不再 `SaveWorkshopSites(allSites)` 整存，计数以 Go 返回为准

- **站点游标只经 `WorkshopPageState` 读写（ADR-263）**：`initWorkshopTabs(host, refs, page)` / `bindSiteEvents(host, page)` 收页作用域句柄，**不得**回到 `host.state.currentSite`（该字段已删除，写了也编译不过）。⚠️ **收益边界**：两模块**仍收 `host`**（需 `root` 查 DOM、tabs 还要写 `workshopTimer`），故“越界写入编译不过”**只对站点游标成立**；盘踞 `host` 的其他字段（含 `workshopTimer`）仍然可写，接口级封堵属已知遗留
- **创作者卡片声明式通道**（2026-09 收口）：创作者卡片 HTML 由 `buildSiteHtml` 内经 `createCrCard` 直接产出并嵌入 `#cr-creator-grid`，`site/events.ts` **不再**查 grid 后 `appendChild`（原 `cmBbPopulateCreatorGrid` 已删）——grid 存亡与卡片内容同归 `buildSiteHtml`（编辑态不渲染网格的守卫随之归位）；头部头像加载失败一律走 `data-avatar-fallback` 属性 + `bindAvatarFallback` 单点实现（grid 卡片与详情浮层共用，仅 fallback class 不同）
- **持久化字段禁写 i18n 文案**（2026-09 锐评 P0-2 收口）：`name` / `desc` 经 `SaveWorkshopCreatorsBySite` 落 `creators.json`，**不得**写入 `t(...)` 语言串——`community-data.ts|mergeLocalAuthorsInto` 的本地作者空 desc 落 `""`（「来自本地仓库」提示由 `site/render.ts|createCrCard` 与 `site/events.ts|cmCrBuildDetailHtml` 按 `_fromLocal` 标记**现取当前语言**）、`site/edit.ts|eeBindCreatorsEdit` 的 `cr-add` 新增行落空 name/desc（由编辑卡 placeholder 引导），且保存路径过滤空名条目；对应 `workshop.newCreatorName` / `workshop.newCreatorDesc` 两键已从三语包删除
- **筛选行展示文案 vs 过滤键分离**（锐评 P0-4）：`.cr-tag-filter-btn` 动态标签的显示文案走 `getCreatorIdentity({ role: tag }).label`（i18n 单源，未知 tag 回退 YSM 创作者），`data-tag` 保持原始 role id——**label 是展示层，data-tag 是数据语义**，二者不得互相顶替；站点空态引导指向 `workshop.importSite`（导入），不得写 `exportSite`（历史 bug：上传图标配「导出站点」，恢复路径指反）

- **单内容区（无第二创作者面板）**：`#ws-creator-view` / `.ws-creators-list` / `creatorView` 句柄链已于 2026-09 锐评 P1 删除——那是旧双栏布局残骸（JS 恒置 `display:none`、无任何填充者，连 CSS 规则都缺），页面内容只经 `#ws-search-results`，`RenderSiteViewCtx` / `SiteViewState` 不再有 `creatorView` 字段；要加并列面板须重开设计评审，不得复活临时容器

## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`app-content`、`community-feature`
- `frontend/src/views/app-content/css/content-creator.ts` / `css/content-layout.ts` — 站点样式层（主卡持有）
- `frontend/src/views/app-content/workshop-site-opener.ts` — 站点打开器（主卡装配，经 `init-workshop.ts` 接线）
