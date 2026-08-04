---
kind: app_tree
name: 资源树 app-tree
tier: architecture
category: ui
source_files:
  - frontend/js/widgets/app-tree/index.ts
  - frontend/js/widgets/app-tree/
use_when:
  - 树形
  - 资源列表
  - tree
  - 节点
  - 树
  - 目录树
---

# 资源树 app-tree

## 概览

`app-tree` 是 YSM 核心的资源目录树组件，使用 Web Components 实现，支持展开/折叠、右键菜单、文件图标显示。

## 核心职责

- 渲染模型资源目录树
- 节点选择与多选
- 右键菜单触发
- 拖拽排序支持

## 对外 API / 入口

- `AppTree` 生命周期：`connectedCallback`（绑定事件 + `_unsubs` 收集订阅）→ `disconnectedCallback`（清理订阅 / keydown / 虚拟滚动）
- `_load` — 加载条目数据；`_renderTree` — 渲染树（grid/list 双模式）
- `_initKeyboardShortcuts` / `_deleteSelected` — 键盘快捷键 / 批量删除
- 子模块：`bus-handlers.ts`（事件处理）/ `events.ts`（委托）/ `virtual-scroll.ts`（虚拟滚动）

## 与其他子系统关系

- `app-content/`: 选中节点内容在 content 区域渲染
- `app-sidebar/`: 侧栏面板状态联动
- `context-menu.ts`: 右键菜单事件路由
- 通过 bus 发出节点选择事件

## 不变量

- 文件名显示统一走 `renderDisplayName()`（治理红线 4.3）
- 使用 Shadow DOM 隔离样式
- 组件拆分遵循 app-xxx 规范（index/tpl/row-tpl/data/render/events）

## 相关

- `frontend/js/utils/dom/display.ts` — 文件名渲染
- `frontend/js/widgets/app-tree/` — 组件目录
