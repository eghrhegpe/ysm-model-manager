---
kind: app-content-site
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
  - frontend/src/views/app-content/site/edit-drag.ts
  - frontend/src/views/app-content/tpl-workshop.ts
auto_fields:
  symbols_with_lines:
    - AvatarVariant
    - bindBrowseEvents
    - bindDragEvents
    - bindDragSort
    - bindEditEvents
    - BrowseMode
    - BrowseModeRef
    - buildCreatorEditCard
    - buildSiteHtml
    - BuildSiteHtmlCtx
    - CleanupFn
    - compareByAuthorCount
    - compareFavFirst
    - computeCreatorTiers
    - CrCardCtx
    - createBrowseModeRef
    - createCrCard
    - creatorAvatarHtml
    - CreatorIdentity
    - CreatorIdentityInput
    - creatorPlatformBadgesHtml
    - creatorStarBtnHtml
    - creatorTagChipHtml
    - DragSortSpec
    - DragStateShell
    - FAV_CREATORS_KEY
    - FavSortInput
    - getCreatorIdentity
    - getTagDisplayLabel
    - getTagFromRole
    - isFaved
    - joinSiteIds
    - loadActiveTag
    - loadBrowseMode
    - loadFavs
    - loadSearchKw
    - LocalCreatorLike
    - parseDescTags
    - parseSiteIds
    - renderSiteView
    - RenderSiteViewCtx
    - RepoAuthorLike
    - saveActiveTag
    - saveBrowseMode
    - saveSearchKw
    - SiteViewState
    - toggleFav
    - workshopTpl
    - WS_ACTIVE_TAG_KEY
    - WS_LAST_TAB_KEY
    - WS_SEARCH_KW_KEY
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

`site/` 子目录是 `app-content` 的「创意工坊站点」页子域，由主卡 `app-content` 的 `init-workshop.ts` 调用 `renderSiteView` 组装。内部高内聚：`site-view.ts` 委托同目录模块渲染与绑定（render / events / edit / drag / types），并共享 `workshop-data.ts`（收藏/标签解析）与 `workshop-browse-mode.ts`（浏览模式 ref）。对外只依赖 `core/i18n` / `bus` / `backend` / `utils` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据；2026-09 三件套已物理归位 site/ 子目录，消灭顶层散落）。生产文件包括：site-view、render、events、edit、edit-drag、drag、types、workshop-data、workshop-browse-mode、workshop-page-state、workshop-site-opener、workshop-tabs、workshop-avatar。

## 核心职责

- `site-view.ts` — `renderSiteView`：组装 `SiteViewState` 后委托 `site/` 子模块渲染与绑定；行内编辑选择器排除预设卡片（`[data-idx][data-fld]:not([data-edit='preset'])`，防预设 label 输入污染创作者对象，P2 修复）；拖拽 drop 用 `realIdx` 在 `allCreators` 全量数组上重排（防站点子集覆盖清空其他站点，P2 修复）
- `site/types.ts` / `site/render.ts` / `site/events.ts` / `site/edit.ts` / `site/drag.ts` — 状态类型 `SiteViewState` / `CleanupFn`、`createCrCard`（**声明式：返回 HTML 字符串，零 DOM**）+ `computeCreatorTiers`（排名分档一次性 O(n log n) 预计算，见不变量「排名分档预计算」条）+ `buildSiteHtml` 渲染、`bindBrowseEvents` 浏览交互、`bindEditEvents` 编辑模式（AbortController signal 贯穿 7 个 eeBind* 全部监听，cleanup 真实解绑幂等）、`bindDragEvents` 卡片拖拽排序；各 bind 均返回 `CleanupFn`
- `workshop-data.ts` — 工坊纯数据工具：`getCreatorIdentity` / `getTagDisplayLabel`（tag 展示文案：已知身份走 i18n label，**未知 tag 原样返回**，不冒充别的身份）/ `getTagFromRole` / `parseDescTags`（**只认「标签式描述」**：顿号/全角逗号切分，段数 2..6 且每段 ≤8 字符才返回片段，否则返回 `[]` 由详情层回退全文；ASCII 逗号不参与切分，>6 段**不截断**而是整体回退全文）/ 收藏 `loadFavs` / `isFaved` / `toggleFav`（localStorage key 以单源常量定义导出：`FAV_CREATORS_KEY`）；4 个页面级持久键统一存于此模块作为单一事实源（`FAV_CREATORS_KEY`, `WS_ACTIVE_TAG_KEY`, `WS_SEARCH_KW_KEY`, `WS_LAST_TAB_KEY`）
- `workshop-browse-mode.ts` — 浏览模式 ref：`BrowseModeRef{ v }` 单源（与 `wsEditModeRef:{v}` 同构），经 `ctx.browseMode` 贯穿到渲染高亮与 `openUrl`，`setBrowseMode` 只改 `.v` + localStorage → 一处 set、处处一致

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-workshop.ts` 调用：`renderSiteView(ctx)` 渲染站点页（页面切换由主卡 `nav:changed` 监听驱动，site 子模块不直接订阅导航事件）
- 派发 bus：`nav:changed`（空状态跳转 repository，`site/events.ts|cmBbBindEmptyLocalBtn` 的 `[data-local-empty]` 分支）；收藏变更（localStorage 事件）
- 样式：`.cr-*` 创作者全族 + `.ws-*` 工坊类定义在 `app-content` 样式层 `content-creator.ts` / `content-layout.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `workshop-icons.ts`（`utils/icon`）→ SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`（site/events、site/render 消费）
- `workshop-site-opener.ts` → `ctx.openUrl` 把搜索链路 `fillSearch` 拼好的带词链接透传给 `openSite`（site 视图的打开器在 `init-workshop.ts` 装配，见主卡）；内嵌分支 `workshop-site-opener.ts|openEmbedded` 的加载超时由模块级 `loadAborts` WeakMap（iframe → AbortController，键随元素 GC 自动回收；原 iframe 伪字段 `_wsLoadAbort` + `declare global` 已除——与 app-tree `vsStates` 同教义：原生 DOM 元素不私搭状态）承载（`WS_EMBED_TIMEOUT_MS` 15s 未完成加载 → 提示站点不允许内嵌浏览）：开新页先 abort 上一轮、load 完成或超时均 abort 收口、返回按钮同样 abort，消除 timer 残留竞态
- 主卡 `app-content` 负责页面编排与分发；本卡只管站点视图自身的渲染与交互
- **页作用域句柄 `workshop-page-state.ts`（ADR-263）**：`createWorkshopPageState()` → `WorkshopPageState { getCurrentSite() / setCurrentSite(site) }`，承载「当前浏览站点」。它是 `currentSite` 从 `AppContentState` 下沉后的家——tabs（写）/ opener（读）/ `init-workshop.ts` 注入链（读写）共享**同一实例**（由 `init-workshop.ts` 创建并下传），与 `WorkshopRefs` 同构：只给工厂、**不给模块级单例**，防「形状相同、实例不同」的 stale 错位。两者分工：refs 收**可替换的整份数据**（sites/creators 整体换新），page-state 收**页面级游标**（当前站点）

## 不变量

- 站点搜索带词链接必须**真传**到底层打开调用：`ctx.openUrl(url)` → `openSite(host, site, mode, url)` 的 `url` 不得丢弃，否则站点视图预设 / 卡片作者搜索 / 详情浮层全部退化为只开网站首页（P1 修复锁定于 `workshop-site-opener.test.ts`）
- 浏览模式「点谁用谁 + 即时生效」，收敛为单源 ref：`browseMode` 存 `BrowseModeRef{ v }`，禁止值拷贝 stale
- `WorkshopRefs` 的**引用语义字段不套 `{ v: T }` 包装层**：`allSites` / `allCreators` / `repoAuthors` / `showSiteView` 直接持有值——数组/函数是整体替换，持有 refs 的闭包天然读到最新（闭包捕获的是 refs 对象本身，包装层只在需要重绑原语时才必要）。`wsEditModeRef` 仍保留 `{ v: boolean }`：它按「可变布尔句柄」横切 render / edit / site-view 七处消费（值语义传递），拆它属另一维度改造，勿在无 ADR 时顺手统一
- 行内编辑排除预设卡片、拖拽用 `realIdx` 全量重排——两处 P2 修复为站点数据不污染的底线
- **站点 JSON 导入下沉 Go**（ADR-172 对称，堵 site/edit + site/drag 双轨）：`site/edit.ts` 社区站点并入走 Go `MergeCommunitySitesFromJSON`（返回增量计数，前端 `mergeCommunitySites` 仅内存展示层合并、不驱动写回）；`site/drag.ts` 站点 JSON 拖入走 Go `MergeWorkshopSitesFromJSON`（合并/去重/写回下沉 Go，前端用 `DefaultWorkshopSites()` 拉取落盘后的最新结果刷新 `allSites`）——两端都不再 `SaveWorkshopSites(allSites)` 整存，计数以 Go 返回为准

- **站点游标只经 `WorkshopPageState` 读写（ADR-263）**：`initWorkshopTabs(root, refs, page, registerDefaultSiteTimer)` / `bindSiteEvents(root, page, onSitesImported?)` 只收 `root: ShadowRoot` + 页作用域句柄，**不得**回到 `host.state.currentSite`（该字段已删除，写了也编译不过）——host 依赖已彻底摘除（连 `workshopTimer` 也经 `registerDefaultSiteTimer` 回调交回壳层，ADR-265，两模块不再持有任何 host 字段）。**`initWorkshopTabs` 返回 `reloadWorkshopTabs()` 重载入口**（拉数据→写 refs→重建 tab 栏→渲染当前站点，与 0ms 定时器初载同链路）；`bindSiteEvents` 的站点**导入成功（n>0）后经 `onSitesImported` 触发该重载**（init-workshop 组装注入）——旧 TODO「导入后重新加载创作者列表」清偿，桌面拖入 JSON（site/drag）走 Go 返回值刷 `allSites` 属另一条已通路径，勿混淆
- **创作者卡片声明式通道**（2026-09 收口）：创作者卡片 HTML 由 `buildSiteHtml` 内经 `createCrCard` 直接产出并嵌入 `#cr-creator-grid`，`site/events.ts` **不再**查 grid 后 `appendChild`（原 `cmBbPopulateCreatorGrid` 已删）——grid 存亡与卡片内容同归 `buildSiteHtml`（编辑态不渲染网格的守卫随之归位）；头部头像加载失败一律走 `data-avatar-fallback` 属性 + `bindAvatarFallback` 单点实现（grid 卡片与详情浮层共用，仅 fallback class 不同）
- **排名分档预计算 + 图标收编 + 入场封顶**（2026-09 锐评 P0 性能债）：`site/render.ts|computeCreatorTiers` 一次性 O(n log n) 算出全量分档（**三条发牌纪律**：① 全站产量为 0（`authorCountMap` 缺条目或榜首 count ≤ 0）时全员无牌——所有 key 相等时排序退化为保持原序，照 pct 位次发牌会让数组第一人白拿 gold；② 单人站点不发牌，无比较对象不称「顶级」；③ silver 底保，纯位次 pct<0.25 在 n=2~5 时命中空集，第 2 名兜底拿银。**并列口径 = 同 count 同档**：并列者无可区分名次依据，按数组下标区分等于用展示顺序冒充排名（同 ① 的噪声），故先取各并列组组内最靠前位次再定档、组序裁断不腰斩），`buildSiteBrowseSection` 预计算后按 `name` 取值传入 `createCrCard`，**替代原每张卡片内对全量列表重排的 O(n² log n) 写法**；卡片星标双态（收藏/未收藏）与编辑卡拖拽手柄改走 `utils/icon/ui-icons.ts|UI_ICONS` 语义 SVG（`star`/`starFilled` 实心经 `.ws-icon[fill]` 切换、`dragHandle` 六圆点 grip），**不再硬编码 `⭐`/`☆`/`⠿` 字符**；入场 `animation-delay` 取**展示位次** `stagger(staggerIdx)` 且带 **300ms 封顶**（旧实现按产量名次线性累加无封顶，收藏置顶卡反而入场乱序）。**图例** `site/render.ts|buildTierLegendRow` 仅在存在分档卡时渲染——gold/silver 只有 2px 色条 + 头像光环、无任何文字说明，缺图例时用户无从得知这两档凭什么区分（`content.tierGold`/`content.tierSilver` 文案即「本地模型数第一/第二」）；图例必须复用已算好的 tiers 表，**不得在其内部重算**（那是每轮渲染多跑一次 O(n log n)）
- **创作者数据面禁写界面文案**（2026-09 锐评 P0-2，**复核后治本**）：**`creators.json` 的 `name` / `desc`** 不得承载任何一种语言的字面文案（`SaveWorkshopCreatorsBySite` 会落盘）。⚠️ **规则边界**：Go 默认**站点元数据**（`internal/app/app_workshop.go` 的 `Label` / `Desc`，如「B站」）属**捆绑内容**，与创作者数据面不同性质、不受本规则约束（复核 N7：原措辞「不得承载任何一种语言的字面文案」过宽会误伤该处）。⚠️ **首次修复只改了前端、对生产数据无效**（复核 P1-1 实证）：本地作者 desc 的**源头**是 `go/scanner/scanner.go` 与 `frontend/src/backend/web-community.ts|scanWebLocalAuthors` 里硬编码的「来自本地仓库」，前端 `mergeLocalAuthorsInto` 的 `|| ""` 分支根本不可达。治本口径：**源头落空串**（Go/网页版两处同口径），`community-data.ts|mergeLocalAuthorsInto` 对该空值**恒等透传**（不是"兜底被触发"），「来自本地仓库」提示由展示层按 `_fromLocal` 标记**现取当前语言**（`site/render.ts|createCrCard` 卡片 + `site/events.ts|cmCrBuildDetailHtml` 浮层）；`site/edit.ts|eeBindCreatorsEdit` 的 `cr-add` 新增行落空 name/desc（编辑卡 placeholder 引导）+ 保存路径过滤空名条目。相关死键 `workshop.newCreatorName` / `newCreatorDesc` / `activeCreators` 已从三语包删除
- **五身份标签色恰为五条，缺一条即裸文字**（2026-10-13 修）：`.cr-tag-<role>` 的 class 由 `site/render.ts|createCrCard` 拼成 `cr-tag-` + `site/workshop-data.ts|getTagFromRole`，故合法取值只有 role 枚举五种（`creator/official/vup/oc/repo`，权威源 = `site/render.ts|buildCreatorEditCard` 编辑下拉 + `site/workshop-data.ts|getCreatorIdentity`）。⚠️ **历史缺陷**：存量 CSS 曾配了 `.cr-tag-game` 而 `game` 不在 role 枚举内，同时 `official`/`creator`/`repo` **无任何配色规则**——最常见的「官方/普通创作者」渲染成裸文字且与 vup/oc 无视觉区分。现状：`css/content-creator.ts` 五条齐备、色值走 `:host` 变量（`--tag-official` 金 / `--tag-creator` 靛 / `--tag-repo` 青绿，bg alpha .13），回归锁在 `css/content-css.test.ts`。⚠️ **边界**：`--tag-game`/`--tag-game-bg` 变量**保留在 `:host`**（当前全仓零消费者，无害；清理前须确认是否有人打算复活 game 身份）。**新增 role 时须同补一条配色，否则该身份静默退化为裸文字**
- **筛选行/卡片/浮层的 tag 展示走 `getTagDisplayLabel` 单源**（锐评 P0-4 + 复核 P1-3）：已知身份 → `getCreatorIdentity` 的 i18n label；**未知 tag 原样显示**（曾回退成「YSM 创作者」，导致按钮文案与 `data-tag` 过滤语义不符）。`data-tag` 与 `cr-tag-<role>` class 始终是原始 role id（**展示层 ≠ 数据语义**）。站点空态引导指向 `workshop.importSite`（导入）——历史 bug：上传图标配「导出站点」，恢复路径指反
- **筛选按钮按本站实际数据派生，不硬编码身份**（2026-10-13 锐评修）：`site/render.ts|buildSiteTagFilterRow` 只渲染「全部」+ `tagSet` 中**真实存在**的身份（顺序走 `ORDERED_ROLES` 常量，未知 role 追加在后保证扩展不丢）。⚠️ **历史缺陷**：曾无条件渲染「创作者 / 官方」两个固定按钮，与本站数据无关——实测 `creators.json` 十站中九站无 `official` 条目，那九站点「官方」必得零结果（落 `#cr-filter-empty` 空态）；另有多站全为默认 `creator`，「创作者」与「全部」结果集完全相同，是纯死按钮。**按钮必须由数据算出，不是猜出来的**；回归锁在 `site/render.test.ts`（含「本站不存在的身份不出按钮」用例）。**新增 role 时须同补 `ORDERED_ROLES`**，否则按钮序不更新（不丢按钮，故是隐性退化而非故障）
- **筛选态按站点 id 分域持久化**（2026-10-13 锐评修）：`activeTag` / `searchKw` 的 localStorage 键为「前缀 + 站点 id」，读写统一经 `workshop-data.ts|loadActiveTag` / `saveActiveTag` / `loadSearchKw` / `saveSearchKw`（**禁止再裸调 `safeGet`/`safeSet` 打无后缀键**）。⚠️ **历史缺陷**：曾用全局单键——用户在某站选中「官方」再切站，旧标签直接套到新站：`site/edit.ts|eeBindCreatorFilter` 末尾会立刻按该标签过滤 → 全员隐藏、网格空白，而按钮仍高亮 active（一条可复现的用户可见故障）。分域后切站读到的是本站自己的筛选态
- **创作者卡片键盘导航须走深焦解析**（2026-10-13 锐评修）：`site/events.ts|cmBbBindKeyboardNav` 与 `cmCrCreateDetailOverlay` 的焦点判定必须用 `utils/dom/deep-active-element.ts|deepActiveElement`（或 `deepActiveElementOf`），**不得直接读 `document.activeElement`**。⚠️ **历史缺陷**：网格位于 app-content 的 shadow root 内，按 DOM retargeting 规则 `document.activeElement` 返回的是 **shadow host** 而非内层卡片 → `cards.indexOf(cur)` 恒 `-1`，`↑↓←→` 与 Enter/Space 激活全线早退（100% 失效），而 `docs/guide/keyboard-shortcuts.md` 仍在教用户该手势。**更值钱的是门禁缺口**：原单测把夹具 `document.body.appendChild(searchResults)`（light DOM）→ `document.activeElement === 卡片` 恒成立，测绿而生产全废；回归现改挂真 shadow root 并断言 `root.activeElement`。⚠️ **happy-dom 与浏览器同为 retargeting 口径**——单测若直接断言 `document.activeElement === shadow 内元素`，那是测试环境模拟问题、不是生产 bug，判据一律读 `deepActiveElement()` 或 `root.activeElement`
- **编辑态焦点恢复（锐评 Perf #3，2026-10-14）**：preset 编辑区的「上移/下移/删除」各自触发整站重渲（`reRender` → `renderSiteView` → `searchResults.innerHTML`），按钮 DOM 被销毁重建——键盘用户连按两次、或鼠标连点排序时第二次操作落回 body。`site/focus-restore.ts` 在 `init-workshop.ts` 的 `reRender` wrapper 内「渲染前记锚点、渲染后恢复」。锚点用 **preset 稳定身份**（卡片 `data-preset-q` = `ps.q || ps.label`，沿用 `render.ts` 浏览态既有惯例）而非 `data-idx` 位置索引——**上移/下移会让索引漂移**（点第 3 项「上移」→ 它变成第 2 项 → `data-idx` 2 变 1），按索引恢复会跳错行。只认三类编辑区按钮（`cr-order-up`/`cr-order-down`/`cr-del-preset`），搜索框等焦点不越界抢（`captureEditFocus` 返回 null 即跳过）。⚠️ 焦点判定走 `ownerDocument.activeElement`（本域在 shadow root 内，`document.activeElement` 因 retargeting 返回 shadow host，同本卡「深焦解析」条）。目标已删（点删除后重渲）→ `restoreEditFocus` 返回 false 不抛。回归锁：`site/focus-restore.test.ts` 7 例（含「上移后按稳定身份而非旧索引恢复」「目标已删返回 false」），变异验证：返回 false 即转红
- **渲染层对收藏零 localStorage 访问**（2026-10-13 锐评🟡清偿）：`site/render.ts|BuildSiteHtmlCtx` 收 `favedNames: readonly string[]`（由 `site-view.ts|renderSiteView` 每轮渲染调一次 `loadFavs()` 注入），`sortCreatorsFavedFirst` 与卡片星标判定都从这份名单派生（Set 化一次）。⚠️ **历史缺陷**：`createCrCard` 每卡各调一次 `ctx.isFaved` → `isFaved` 内部 `loadFavs`（`localStorage.getItem` + `JSON.parse` 全量数组）→ 一轮渲染解析 N+1 次。`site/render.test.ts` 有可执行契约断言「buildSiteHtml 全程 `loadFavs` 零调用」——**任何人把 isFaved/loadFavs 引回卡片工厂或排序循环，该用例立刻转红**。纯函数渲染层不得有 I/O 副作用是本仓通用纪律，此处是创作者频道的落点
- **role 单选回写取 `value`、不经 `joinSiteIds`**（2026-10-13 锐评🟡收拢埋雷）：`site/edit.ts|syncFieldToCreator` 的 `HTMLSelectElement` 分支直取 `inp.value`。⚠️ **历史缺陷**：该分支曾用 `joinSiteIds(selectedOptions)`——而 `joinSiteIds` 是**站点归属**的分号拼装器（`type` 字段专用，P1-5 后 type 已改 chip 组），用它处理 role 属语义错配；单选时巧合等价所以从未爆雷，但一旦 role 加 `multiple` 或新增任何非站点的 select，就会拼出 `"official;vup"` 式脏值并**直接落盘** `creators.json`。回归锁 `site/edit.test.ts`「role 单选回写不含分号」。**新 select 字段接入编辑态时先判定归属**：站点多值走 chip 组，单值枚举直取 value
- **编辑下拉的身份文案同样走 `getTagDisplayLabel` 单源**（2026-10-13 锐评🟡补齐）：`site/render.ts|buildCreatorEditCard` 五项 role `<option>` 的 label 全走单源（vup/oc 曾写裸字面量 `"VUP"`/`"OC"`，与卡片/筛选行口径分裂）。⚠️ **不变量**：`value` 仍是原始 role id（数据语义），只有 label 过展示层——`getTagDisplayLabel` 对未知 tag 原样返回，编辑下拉作为 role 权威枚举源不得引入枚举外的值
- **卡片与浮层的标记片段单源**（ADR-034-d1）：`site/render.ts` 导出 `creatorAvatarHtml` / `creatorPlatformBadgesHtml` / `creatorStarBtnHtml` / `creatorTagChipHtml` 四个片段，卡片（`site/render.ts|createCrCard`）与详情浮层（`site/events.ts|cmCrBuildDetailHtml`）共用——两处布局不同但**标记不得各写一份**。⚠️ **历史缺陷漂过两次**：① 平台徽章的站点图标只在浮层有、卡片没有（文档与 CSS 都承诺卡片该有）；② 浮层那份徽章的外层 `<span class="cr-platform-badge">` **从未闭合**——多平台创作者的第二个徽章被 HTML 解析器嵌进第一个里面（嵌套 inline-flex + 双份 padding），而回归锁只测卡片时完全看不见。片段化后这类「修一处漏一处」从结构上不可能再发生
- **编辑态增删走局部 DOM 并重编号，不整树重建**（P1-3b）：`site/edit.ts|eeBindCreatorsEdit` 的删除 / 新增只动单张卡（`closest(".cr-edit-card").remove()` / `insertAdjacentHTML`），随后 `site/edit.ts|reindexCreatorCards` 按 DOM 顺序**重编号**每张卡的 `data-edit-idx` 与其内全部 `data-idx`。⚠️ **不变量**：数组已 splice/push，**DOM 序号必须跟着变**——否则保存路径 `site/edit.ts|syncFieldToCreator` 会把「第 N 张卡」的输入写进错误的数组槽（静默写错创作者，且落盘）。整树 `refreshView` 会丢焦点，故新增后须手动 `.focus()` 落到新卡 name 输入
- **创作者按站保存是意图式契约：`siteCreators`（本站期望集合）+ `detachedNames`（解除名单）**（ADR-335）：`internal/app/app_workshop.go|SaveWorkshopCreatorsBySite` 对 `detachedNames` 里的条目**以磁盘副本为基础**只去掉本站段——段非空则保留（仍属他站）且其余字段一字不动，段空则整条删除；**同名同时出现在两参时以解除为准**。⚠️ **历史缺陷**：旧契约是「前端重建全量列表」（`siteCreators` 拼接前端改过 type 的 `detachedCreators` 对象）——前端漏併 / 用了陈旧副本，就会被 Go 的「先移除 type 含本站的全部旧条目」把他站条目一并抹掉，或整条覆盖磁盘，属**静默数据丢失**。现前端只传名字（`site/types.ts|SiteViewState.detachedNames`），段级维护全归 Go；删除处理**不得再就地改 `cr.type`**（那会污染 `allCreators` 的内存显示）。网页版 `frontend/src/backend/web-community.ts|SaveWorkshopCreatorsBySite` 同签名同语义。回归锁：`internal/app/app_workshop_test.go` 的 `DetachedNames` / `DetachedWinsOverUpsert`、`browser-adapter.contract-b2.test.ts`、`site/edit.test.ts` 的 7b/10

- **单内容区（无第二创作者面板）**：`#ws-creator-view` / `.ws-creators-list` / `creatorView` 句柄链已于 2026-09 锐评 P1 删除——那是旧双栏布局残骸（JS 恒置 `display:none`、无任何填充者，连 CSS 规则都缺），页面内容只经 `#ws-search-results`，`RenderSiteViewCtx` / `SiteViewState` 不再有 `creatorView` 字段；死字段税 P1-c 手术同步切除 `showRepoModels` / `repoModelCache` / `backToSite`（`RenderSiteViewCtx`）与 `state.ctx` ——`ctx` 仅在 `init-workshop.ts` 的闭包内用于 reRender 路由，不再作为公共状态传递。要加并列面板须重开设计评审，不得复活临时容器
- **预设搜索词保存必须回填 `q`**（2026-10-13 锐评修，**必现数据损坏**）：`site/edit.ts|eeBindToolbarBtns` 保存路径从原数组 `site.presetSearches` 按 `data-idx` 回读 `q` 后一并落盘。⚠️ **历史缺陷**：曾只构造 `{ label: val } as WorkshopPresetSearch`——`q` 被静默丢弃，而 Go 侧 `go/types/config.go|WorkshopPresetSearch.Q` 非 omitempty、`internal/app/app_workshop.go|SaveWorkshopPresetsBySite` 是**整数组替换**落盘（`sites[i].PresetSearches = presets`）。编辑界面只有 `label` 一个输入位、`q` 不由用户改，故 `q` 必须恒取原值。实测 `workshop_sites.json` 中 bowlroll 站有 `label ≠ q` 的真实条目（如「热门日系模型」→ `MMD`），**用户哪怕一个字没改、点一次保存就永久覆盖**。⚠️ 教学意义：`as WorkshopPresetSearch` 这类断言会把「少给必填字段」从编译期错误降格为运行时静默——**落盘对象的字段完整性由类型系统兜不住，须有回归锁**（见 `site/edit.test.ts` 的 q 保留用例）
- **收藏后的卡片重排与渲染排序共用同一比较器**（2026-10-13 锐评修）：`site/events.ts|cmCrReorderCard`（收藏点击后就地重排）与 `site/render.ts|sortCreatorsFavedFirst`（渲染期排序）**同用 `workshop-data.ts|compareFavFirst`**，规则 = 收藏置顶 → 组内按本地模型产量降序。⚠️ **历史缺陷**：`cmBbBindStarBtns` 曾手写「收藏 → `insertBefore(firstChild)` / 取消收藏 → `appendChild` 队尾」，与排序规则**反向**——产量高的创作者取消收藏后被沉到队尾；且不触发重渲染，错乱持续到整树重建。两套口径必然漂移，故比较器提到 `workshop-data.ts` 作单源。实现要点：只搬运被点的那一张卡（其余节点不动）以保住滚动位置与展开态，**不整树重渲染**；用 `insertBefore(anchor)` 表达目标位次而非盲 `appendChild`
- **头像调试探针只在 `isDevMode()` 下绑 click**（2026-10-13 锐评修）：`site/events.ts|cmBbBindDebugAvatar` 对 `[data-debug-avatar]` **恒绑** error→字母 fallback（功能性降级，破图不留），而 `DebugExtractCreatorAvatar` 探针**非开发态根本不绑**。⚠️ **历史缺陷三重错位**：该探针无条件绑在用户手势上，Go 侧 `internal/app/app_avatar.go|DebugExtractCreatorAvatar` 每次调用都对整库跑 `ScanModelEntries(ysmRoot())` 全量扫描，结果只写 `dbg()` 环形缓冲（生产无控制台，用户看不见任何反应），且 handler 的 `stopPropagation` 还吞掉本应打开详情浮层的卡片点击——**最贵的手势 + 零可见反馈 + 吃掉正常行为**。⚠️ 门必须用 `utils/debug/dev-mode.ts|isDevMode()`（默认关），**不可用 `debug.ts|isDebugEnabled()`**（默认开，门等于没关）。回归锁在 `site/events.test.ts`：生产态断言桥调用零次 + 浮层正常打开（夹具须挂真 shadow root——浮层写 `searchResults.getRootNode()`，留在 light DOM 时该值是 Document，happy-dom 的 `document.appendChild` 直接抛「Only one element on document allowed」，那是夹具结构错不是生产缺陷）
- **平台徽章 = 站点图标 + 站点 id，卡片与浮层同口径**（2026-10-13 锐评修）：`site/render.ts|createCrCard` 与 `site/events.ts|cmCrBuildDetailHtml` 两处都产出 `.cr-platform-badge`，均走 `getSiteIcon(platform)` + 站点 id；图标尺寸规则挂在共享类 `.cr-platform-badge .ws-icon`（`css/content-creator.ts`），**不再限定 `.cr-detail-platforms` 作用域**。⚠️ **历史缺陷**：`docs/guide/creators.md` 明写卡片显示「收录的平台图标」、CSS 基类 `.cr-platform-badge` 也早就按 `inline-flex + gap:2px` 的图标+文字形状设计，但 `createCrCard` 只拼裸站点 id——图标只在浮层出现，文档与代码互相矛盾且 CSS 约束对卡片无效。⚠️ **口径边界**：徽章文字用站点 id 而**不用** `workshop_sites.json` 的 `label`——`label` 是中文优先的捆绑内容（"B站"/"爱发电"），拿去 en/ja 界面属新增中文硬编码（与「创作者数据面禁写界面文案」不同性质但同样影响多语观感）；站点名多语化是独立产品决策（10+ 站点 × 3 语言包），不得顺手夹带。视觉侧量化取证：图标 10×10、徽章高 18px、无横向溢出


## 裁定记录

- `2026-10-13`：创作者卡片与详情浮层抽「片段级单源渲染器」（头像/星标/身份 tag/平台徽章）供两视图共用，不合并两视图｜两视图 DOM/a11y 语义不同（网格项 vs role=dialog），合并=布局耦合；片段单源止住「修一处漏一处」式口径漂移｜回退 = `site/events.ts|cmCrBuildDetailHtml`

## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`app-content`、`community-feature`、`mutable-ref-discipline`（`{v:T}` 拆留判据）
- `frontend/src/views/app-content/css/content-creator.ts` / `css/content-layout.ts` — 站点样式层（主卡持有）
- `frontend/src/views/app-content/workshop-site-opener.ts` — 站点打开器（主卡装配，经 `init-workshop.ts` 接线）
