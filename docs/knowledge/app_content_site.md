---
kind: app_content_site
name: 创意工坊站点视图 site
tier: leaf
category: ui
source_files:
  - frontend/src/views/app-content/site-view.ts
  - frontend/src/views/app-content/site/render.ts
  - frontend/src/views/app-content/site/events.ts
  - frontend/src/views/app-content/site/edit.ts
  - frontend/src/views/app-content/site/drag.ts
  - frontend/src/views/app-content/site/types.ts
  - frontend/src/views/app-content/workshop-data.ts
  - frontend/src/views/app-content/workshop-browse-mode.ts
tests:
  - frontend/src/views/app-content/site-view.test.ts
  - frontend/src/views/app-content/site/render.test.ts
  - frontend/src/views/app-content/site/events.test.ts
  - frontend/src/views/app-content/site/edit.test.ts
  - frontend/src/views/app-content/site/drag.test.ts
  - frontend/src/views/app-content/workshop-data.test.ts
  - frontend/src/views/app-content/workshop-browse-mode.test.ts
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
  - frontend/src/views/app-content/site-view.ts|renderSiteView
status: active
---

# 创意工坊站点视图 site

## 概览

`site/` + `site-view.ts` 是 `app-content` 的「创意工坊站点」页子域，由主卡 `app-content` 的 `init-workshop.ts` 调用 `renderSiteView` 组装。内部高内聚：`site-view.ts` 委托 `site/` 5 个子模块渲染与绑定（render / events / edit / drag / types），并共享 `workshop-data.ts`（收藏/标签解析）与 `workshop-browse-mode.ts`（浏览模式 ref）。对外只依赖 `core/i18n` / `bus` / `backend` / `utils` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据）。

## 核心职责

- `site-view.ts` — `renderSiteView`：组装 `SiteViewState` 后委托 `site/` 子模块渲染与绑定；行内编辑选择器排除预设卡片（`[data-idx][data-fld]:not([data-edit='preset'])`，防预设 label 输入污染创作者对象，P2 修复）；拖拽 drop 用 `realIdx` 在 `allCreators` 全量数组上重排（防站点子集覆盖清空其他站点，P2 修复）
- `site/types.ts` / `site/render.ts` / `site/events.ts` / `site/edit.ts` / `site/drag.ts` — 状态类型 `SiteViewState` / `CleanupFn`、`createCrCard` + `buildSiteHtml` 渲染、`bindBrowseEvents` 浏览交互、`bindEditEvents` 编辑模式（AbortController signal 贯穿 7 个 eeBind* 全部监听，cleanup 真实解绑幂等）、`bindDragEvents` 卡片拖拽排序；各 bind 均返回 `CleanupFn`
- `workshop-data.ts` — 工坊纯数据工具：`getCreatorIdentity` / `getTagFromRole` / `parseDescTags` / 收藏 `loadFavs` / `isFaved` / `toggleFav`（localStorage `ysm-fav-creators`，写入函数 `saveFavs` 为模块内私有）
- `workshop-browse-mode.ts` — 浏览模式 ref：`BrowseModeRef{ v }` 单源（与 `wsEditModeRef:{v}` 同构），经 `ctx.browseMode` 贯穿到渲染高亮与 `openUrl`，`setBrowseMode` 只改 `.v` + localStorage → 一处 set、处处一致

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-workshop.ts` 调用：`renderSiteView(ctx)` 渲染站点页
- 监听 bus：`nav:change`（经主卡分发）、收藏变更（localStorage 事件）
- 样式：`.cr-*` 创作者全族 + `.ws-*` 工坊类定义在 `app-content` 样式层 `content-creator.ts` / `content-layout.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `workshop-icons.ts`（`utils/icon`）→ SVG 图标表 `ICONS` 与 `getSiteIcon` / `getTagIconFromRole`（site/events、site/render 消费）
- `workshop-site-opener.ts` → `ctx.openUrl` 把搜索链路 `fillSearch` 拼好的带词链接透传给 `openSite`（site 视图的打开器在 `init-workshop.ts` 装配，见主卡）
- 主卡 `app-content` 负责页面编排与分发；本卡只管站点视图自身的渲染与交互

## 不变量

- 站点搜索带词链接必须**真传**到底层打开调用：`ctx.openUrl(url)` → `openSite(host, site, mode, url)` 的 `url` 不得丢弃，否则站点视图预设 / 卡片作者搜索 / 详情浮层全部退化为只开网站首页（P1 修复锁定于 `workshop-site-opener.test.ts`）
- 浏览模式「点谁用谁 + 即时生效」，收敛为单源 ref：`browseMode` 存 `BrowseModeRef{ v }`，禁止值拷贝 stale
- 行内编辑排除预设卡片、拖拽用 `realIdx` 全量重排——两处 P2 修复为站点数据不污染的底线

## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`app-content`、`community-feature`
- `frontend/src/views/app-content/content-creator.ts` / `content-layout.ts` — 站点样式层（主卡持有）
- `frontend/src/views/app-content/workshop-site-opener.ts` — 站点打开器（主卡装配，经 `init-workshop.ts` 接线）
