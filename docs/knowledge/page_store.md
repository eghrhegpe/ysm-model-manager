---
kind: page_store
name: 页面状态管理 page-store.js
tier: architecture
category: core
source_files:
  - frontend/js/core/page-store.js
use_when:
  - 页面
  - 当前页
  - 状态管理
  - page store
  - currentPage
---

# 页面状态管理 page-store.js

## 概览

`page-store.js` 管理 YSM 的前端页面导航状态，是 `PageStore.currentPage` 的唯一数据源，替代了旧版 `window.__currentPage`。

## 核心职责

- 维护当前激活页面标识
- 提供 `get` / `set` 接口，支持响应式更新
- 作为页面组件挂载/卸载的协调者

## 与其他子系统关系

- `app-content/`: 根据 `currentPage` 切换内容渲染
- `app-nav/`: 导航栏高亮状态同步
- 禁止使用 `window.__currentPage`（治理红线 4.1）

## 不变量

- 始终通过 `PageStore.currentPage` 获取，不使用 `window.__*`
- 页面切换时先卸载旧组件，再挂载新组件

## 相关

- 治理红线 §4.1: 零 `window.__*` 全局变量
