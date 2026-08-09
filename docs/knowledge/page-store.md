---
kind: page-store
name: 页面状态管理 page-store.ts
tier: architecture
category: core
source_files:
  - frontend/src/core/page-store.ts
tests:
  - frontend/src/core/page-store.test.ts
use_when:
  - 页面
  - 当前页
  - 状态管理
  - page store
  - currentPage
invariant_anchors:
  - frontend/src/core/page-store.ts|sanitizePage
---

# 页面状态管理 page-store.ts

## 概览

`page-store.ts` 管理 YSM 的前端页面导航状态，是 `PageStore.currentPage` 的唯一数据源，替代了旧版 `window.__currentPage`。核心职责是维护只读当前页状态与启动初始页解析——**不是页面挂载/卸载协调者**（那是 app-content 的职责，知识卡旧文描述失真已修正）。

## 核心职责

- 维护当前激活页面标识（只读 getter）
- `resolveInitialPage()` — 启动初始页解析：优先级 ① `ui-default-page`（设置项）→ ② `nav_page`（上次停留）→ ③ `repository`（兜底）；历史名 `resources` 映射 `repository`；读路径包 try/catch（隐私模式回退默认页）
- `sanitizePage(v)` — 白名单过滤（`VALID_PAGES` 六页），未知/损坏值回退 `repository`（防死页）
- `registerPageStore(unsubs)` — 唯一写入点：`nav:changed` listener 设 `_currentPage`（写入前过 `sanitizePage`，P3 修复：原信任 emit 方类型）

## 对外 API / 入口

- `currentPage` — 当前页只读值（`PageName` 联合类型，替代 `window.__currentPage` 红线）
- `resolveInitialPage()` — 启动初始页（app-nav / app-content / PageStore 三源同源调用）
- `sanitizePage(v)` — 白名单过滤
- `registerPageStore(unsubs)` — 注册状态同步（unsub 收进传入数组）
- **无 `setCurrentPage`**（知识卡旧文列为 API 属幽灵——已删除的历史函数，页面切换走 nav:change 请求 → app-content 渲染 → nav:changed 完成事件闭环）

## 与其他子系统关系

- `app-content/`: 根据 `currentPage` 切换内容渲染；是页面挂载/卸载的真实协调者
- `app-nav/`: 导航栏高亮状态同步
- 禁止使用 `window.__currentPage`（治理红线 4.1）

## 不变量

- 始终通过 `PageStore.currentPage` 获取，不使用 `window.__*`
- `_currentPage` 唯一写入点：`registerPageStore` 的 `nav:changed` listener（`nav:change` 是请求事件、`nav:changed` 是完成事件，方向不可写反）
- 页面切换时先卸载旧组件，再挂载新组件（由 app-content 执行）

## 相关

- 治理红线 §4.1: 零 `window.__*` 全局变量
- 知识卡 `app_content` / `app_nav` — 页面切换闭环
