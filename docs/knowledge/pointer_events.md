---
kind: pointer_events
name: Pointer Events 统一交互（触屏 + 桌面）
tier: architecture
category: core
source_files:
  - frontend/src/utils/3d/model3d.ts
  - frontend/src/utils/3d/model2d.ts
  - frontend/src/views/app-preview/zoom.ts
  - frontend/src/views/app-preview/skeleton.ts
  - frontend/src/views/app-preview/litematic-3d.ts
  - frontend/src/views/app-content/index.ts
  - frontend/src/views/app-content/settings/community.ts
  - frontend/src/views/app-content/site/edit.ts
  - frontend/src/views/app-tree/toolbar-events.ts
tests:
  - frontend/src/utils/3d/model2d.test.ts
  - frontend/src/utils/3d/model3d.test.ts
  - frontend/src/views/app-preview/zoom.test.ts
  - frontend/src/views/app-preview/skeleton.test.ts
  - frontend/src/views/app-content/app-content.methods.test.ts
  - frontend/src/views/app-tree/toolbar-events.test.ts
use_when:
  - pointerdown
  - pointermove
  - pointerup
  - setPointerCapture
  - touch-action
  - 触屏
  - 拖拽
  - 旋转
  - hover
  - mouseenter
  - 全窗预览
invariant_anchors:
  - frontend/src/utils/3d/model3d.ts|setPointerCapture
---

# Pointer Events 统一交互（触屏 + 桌面）

## 概览

ADR-047 核心立项 A：全前端拖拽/缩放/旋转/hover 交互从 mouse 事件统一迁移 **Pointer Events**（`pointerdown/move/up` + `setPointerCapture` + CSS `touch-action:none`），使 Android 触屏可操作全部交互；桌面零回归（pointer 事件兼容 mouse）。同时修复 hover 菜单触屏无 hover 问题（补 tap 兜底）。

## 核心职责

- **拖拽旋转**（3D/2D 预览）：`pointerdown`（左键 `button===0`）起手 + `setPointerCapture(pointerId)` 捕获，`pointermove` 旋转，`pointerup` 释放捕获——model3d.ts、litematic-3d.ts、zoom.ts、skeleton.ts
- **面板 resize**：`pointerdown` 起手 + document 级 `pointermove/up`——app-content/index.ts（预览宽度）、skeleton.ts（3D 面板宽度）
- **2D hover**（骨骼名高亮）：`pointermove` + `pointerleave`——model2d.ts
- **菜单 hover**：`pointerenter/pointerleave`（替代 `mouseenter/mouseleave`）——community.ts（扫描 tooltip）、skeleton.ts（截图菜单）、toolbar-events.ts（作者菜单）
- **tap 兜底**：触屏无 hover，hover 菜单补 `click` 切换展开/收起——skeleton.ts 截图菜单、toolbar-events.ts 作者菜单（原有 click 保留）
- **`touch-action: none`**：所有可拖拽元素（3D/2D canvas、resize handle）禁浏览器手势默认（滚动/缩放），pointer 事件才完整

## 对外 API / 入口

无新增导出；各模块内部事件绑定迁移。公共模式：`pointerdown` 时 `setPointerCapture(e.pointerId)`，`pointerup` 时 `hasPointerCapture` 守卫后 `releasePointerCapture`（防重复释放异常）。

## 与其他子系统关系

- **modal.ts**：`android:back` 先关活动弹窗（触屏无 Esc，见 android_events.md）
- **全局清理模式**：`_sessionCleanups` / `ctx.unsubs` / `disconnectedCallback` 负责 pointer 监听回收（与 mouse 时代一致，防累积泄漏）

## 不变量

- **零残留 mouse 事件**：全前端（非测试）不得出现 `mousedown/mousemove/mouseup/mouseenter/mouseleave` 注册（红线，check 可 grep 验证）
- **左键守卫**：拖拽类 `pointerdown` 必须 `e.button === 0`（排除右键/触控笔右键）
- **捕获成对**：`setPointerCapture` 与 `releasePointerCapture` 成对，释放前 `hasPointerCapture` 守卫（jsdom 无捕获实现时测试不炸）
- **touch-action 全覆盖**：拖拽元素必须 `touch-action:none`，否则触屏上浏览器抢占手势

## 相关

- ADR-047（核心立项 A）、ADR-008（事件实现统一治理）
- `docs/knowledge/model2d.md`、`docs/knowledge/model3d.md`、`docs/knowledge/app-preview.md`、`docs/knowledge/android_events.md`
