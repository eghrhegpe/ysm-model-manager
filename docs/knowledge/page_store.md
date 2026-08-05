---
kind: page_store
name: 页面状态管理 page-store.ts
tier: architecture
category: core
source_files:
  - frontend/src/core/page-store.ts
use_when:
  - 页面
  - 当前页
  - 状态管理
  - page store
  - currentPage
---

# 页面状态管理 page-store.ts

## 概览

`page-store.ts` 管理 YSM 的前端页面导航状态，是 `PageStore.currentPage` 的唯一数据源，替代了旧版 `window.__currentPage`。

## 核心职责

- 维护当前激活页面标识
- `setCurrentPage(page)` 变更时 `bus.emit("nav:changed")` 驱动导航联动（无响应式订阅机制）
- 作为页面组件挂载/卸载的协调者

## 对外 API / 入口

- `currentPage` — 当前页只读值（`PageName` 联合类型，替代 `window.__currentPage` 红线）
- `setCurrentPage(page)` — 切换当前页，同步导航状态

## 与其他子系统关系

- `app-content/`: 根据 `currentPage` 切换内容渲染
- `app-nav/`: 导航栏高亮状态同步
- 禁止使用 `window.__currentPage`（治理红线 4.1）

## 不变量

- 始终通过 `PageStore.currentPage` 获取，不使用 `window.__*`
- 页面切换时先卸载旧组件，再挂载新组件

## 相关

- 治理红线 §4.1: 零 `window.__*` 全局变量
