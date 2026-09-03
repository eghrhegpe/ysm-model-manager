---
kind: pointer-events
name: Pointer Events 统一交互（触屏 + 桌面）
tier: architecture
category: core
source_files:
  - frontend/src/preview-3d/adapters/input-and-animation.ts
  - frontend/src/views/app-preview/model2d/model2d.ts
  - frontend/src/views/app-preview/zoom.ts
  - frontend/src/views/app-preview/skeleton.ts
  - frontend/src/views/app-preview/litematic-3d.ts
  - frontend/src/views/app-content/index.ts
  - frontend/src/views/app-content/settings/init.ts
  - frontend/src/views/app-content/site/edit.ts
  - frontend/src/views/app-tree/toolbar-events.ts
auto_fields:
  symbols_with_lines:
    - appContentStyle
    - appendLitematicPreview
    - BedrockBone
    - BedrockCube
    - BedrockModel
    - bindEditEvents
    - bindInputHandlers
    - bindToolbarEvents
    - calcBoneHitZones
    - cleanupVoxel3D
    - closeActive3DOverlay
    - createLitematic3D
    - initSettings
    - InputHandlers
    - InputOptions
    - isEditableTarget
    - loadModel2D
    - Model2DOptions
    - openFullPreview
    - renderModel2D
    - setActive3DClose
  tests:
    - frontend/src/views/app-preview/model2d/model2d.test.ts
    - frontend/src/preview-3d/model3d.test.ts
    - frontend/src/views/app-preview/zoom.test.ts
    - frontend/src/views/app-preview/skeleton.test.ts
    - frontend/src/views/app-content/app-content.methods.test.ts
    - frontend/src/views/app-tree/toolbar-events.test.ts
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - pointerdown / pointermove / pointerup、触屏 + 桌面统一
    - setPointerCapture、touch-action、拖拽
    - input-and-animation
  quick_risk_lines:
    - 所有交互必须用 pointerdown/pointermove/pointerup 统一处理，禁止混用 mousedown/touchstart
  pitfalls:
    - 混用 mousedown + touchstart → 触屏双触发、桌面手势冲突；必须经 pointer events 统一
    - 拖拽不设 touch-action:none → 浏览器滚动吃掉手势；必须在拖拽元素上禁用 touch-action
  use_when:
    - pointerdown
    - pointermove
    - pointerup
    - 触屏
    - 拖拽
    - 旋转
  invariant_anchors:
    - frontend/src/preview-3d/adapters/input-and-animation.ts|setPointerCapture
tests:
  - frontend/src/views/app-preview/model2d/model2d.test.ts
  - frontend/src/preview-3d/model3d.test.ts
  - frontend/src/views/app-preview/zoom.test.ts
  - frontend/src/views/app-preview/skeleton.test.ts
  - frontend/src/views/app-content/app-content.methods.test.ts
  - frontend/src/views/app-tree/toolbar-events.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - pointerdown / pointermove / pointerup、触屏 + 桌面统一
  - setPointerCapture、touch-action、拖拽
  - input-and-animation
quick_risk_lines:
  - 所有交互必须用 pointerdown/pointermove/pointerup 统一处理，禁止混用 mousedown/touchstart
pitfalls:
  - 混用 mousedown + touchstart → 触屏双触发、桌面手势冲突；必须经 pointer events 统一
  - 拖拽不设 touch-action:none → 浏览器滚动吃掉手势；必须在拖拽元素上禁用 touch-action

use_when:
  - pointerdown
  - pointermove
  - pointerup
  - 触屏
  - 拖拽
  - 旋转
invariant_anchors:
  - frontend/src/preview-3d/adapters/input-and-animation.ts|setPointerCapture
status: active
---

# Pointer Events 统一交互（触屏 + 桌面）

## 概览

ADR-047 核心立项 A：全前端拖拽/缩放/旋转/hover 交互从 mouse 事件统一迁移 **Pointer Events**（`pointerdown/move/up` + `setPointerCapture` + CSS `touch-action:none`），使 Android 触屏可操作全部交互；桌面零回归（pointer 事件兼容 mouse）。同时修复 hover 菜单触屏无 hover 问题（补 tap 兜底）。

## 核心职责

- **拖拽旋转**（3D/2D 预览）：`pointerdown`（左键 `button===0`）起手 + `setPointerCapture(pointerId)` 捕获，`pointermove` 旋转，`pointerup` 释放捕获——input-and-animation.ts（3D 适配层，ADR-040 神桶拆分产物）、litematic-3d.ts、zoom.ts、skeleton.ts（model3d.ts 已不含 pointer 逻辑）
- **面板 resize**：`pointerdown` 起手 + document 级 `pointermove/up`——app-content/index.ts（预览宽度）、skeleton.ts（3D 面板宽度）
- **2D hover**（骨骼名高亮）：`pointermove` + `pointerleave`——model2d.ts
- **菜单 hover**：`pointerenter/pointerleave`（替代 `mouseenter/mouseleave`）——settings/init.ts（扫描 tooltip）、skeleton.ts（截图菜单）、toolbar-events.ts（作者菜单）
- **tap 兜底**：触屏无 hover，hover 菜单补 `click` 切换展开/收起——skeleton.ts 截图菜单、toolbar-events.ts 作者菜单（原有 click 保留）
- **`touch-action: none`**：所有可拖拽元素（3D/2D canvas、resize handle）禁浏览器手势默认（滚动/缩放），pointer 事件才完整
- **双端响应式热区（ADR-057）**：`utils/dom/fab.ts` 的 FAB/overlay 控钮走全局 CSS 类，`@media (pointer:coarse)` 下触控热区扩至 ≥44px（Apple HIG），窄屏 `max-width:480px` / 横屏 `max-height:500px` 适配（复用 MikuMikuAR 断点）；触屏把 WASD 键盘提示切为手势/虚拟控件文案

## 对外 API / 入口

无新增导出；各模块内部事件绑定迁移。公共模式：`pointerdown` 时 `setPointerCapture(e.pointerId)`，`pointerup` 时 `hasPointerCapture` 守卫后 `releasePointerCapture`（防重复释放异常）。

## 与其他子系统关系

- **modal.ts**：`android:back` 先关活动弹窗（触屏无 Esc，见 android-events.md）
- **全局清理模式**：`_sessionCleanups` / `ctx.unsubs` / `disconnectedCallback` 负责 pointer 监听回收（与 mouse 时代一致，防累积泄漏）

## 不变量

- **零残留 mouse 事件**：全前端（非测试）不得出现 `mousedown/mousemove/mouseup/mouseenter/mouseleave` 注册（红线，check 可 grep 验证）
- **左键守卫**：拖拽类 `pointerdown` 必须 `e.button === 0`（排除右键/触控笔右键）
- **捕获成对**：`setPointerCapture` 与 `releasePointerCapture` 成对，释放前 `hasPointerCapture` 守卫（jsdom 无捕获实现时测试不炸）
- **touch-action 全覆盖**：拖拽元素必须 `touch-action:none`，否则触屏上浏览器抢占手势
- **async 窗口期 DOM 守卫**：每个 `await` 前后及 DOM 创建后立即检查 `container.isConnected`，防组件卸载后异步回调写入已卸载 DOM（`skeleton.ts` 三处 async 守卫，P2 修复）

## 相关

- ADR-047（核心立项 A）、ADR-008（事件实现统一治理）、ADR-057（双端响应式触控热区：pointer:coarse 44px + 480px/横屏断点）
- `docs/knowledge/model2d.md`、`docs/knowledge/model3d.md`、`docs/knowledge/app-preview.md`、`docs/knowledge/android-events.md`
