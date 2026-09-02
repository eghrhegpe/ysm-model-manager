---
kind: dom-fab
name: 3D 预览悬浮 FAB 控制层
tier: architecture
category: ui
source_files:
  - frontend/src/utils/dom/fab.ts
auto_fields:
  symbols_with_lines:
    - createIconButton
    - ensureFabStyles
    - IconButtonOpts
    - YSW_FAB_CSS
  tests:
    - frontend/src/utils/dom/fab.test.ts
  quick_groups:
    - UI 交互与弹窗
  quick_intents:
    - FAB、悬浮按钮、3D 预览
    - overlay、ADR-057、ensureFabStyles
  quick_risk_lines:
    - FAB 控制层必须走 dom/fab.ts 的 ensureFabStyles 注入，禁止各组件各自注入 style 标签
  pitfalls:
    - 各组件各自注入 style 标签 → 多次注入、样式冲突；必须经 ensureFabStyles 一次注入
    - FAB 挂 document.body 但样式在 Shadow DOM → light DOM 按钮不继承；必须经 ensureFabStyles 注入 head 标签
  use_when:
    - FAB
    - 悬浮按钮
    - FAB 3D 预览入口
    - overlay
    - ADR-057
  invariant_anchors:
    - frontend/src/utils/dom/fab.ts|ensureFabStyles
    - frontend/src/utils/dom/fab.ts|createIconButton
tests:
  - frontend/src/utils/dom/fab.test.ts
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - FAB、悬浮按钮、3D 预览
  - overlay、ADR-057、ensureFabStyles
quick_risk_lines:
  - FAB 控制层必须走 dom/fab.ts 的 ensureFabStyles 注入，禁止各组件各自注入 style 标签
pitfalls:
  - 各组件各自注入 style 标签 → 多次注入、样式冲突；必须经 ensureFabStyles 一次注入
  - FAB 挂 document.body 但样式在 Shadow DOM → light DOM 按钮不继承；必须经 ensureFabStyles 注入 head 标签

use_when:
  - FAB
  - 悬浮按钮
  - FAB 3D 预览入口
  - overlay
  - ADR-057
invariant_anchors:
  - frontend/src/utils/dom/fab.ts|ensureFabStyles
  - frontend/src/utils/dom/fab.ts|createIconButton
status: active
---

# 3D 预览悬浮 FAB 控制层

## 概览

3D 预览悬浮控制层组件（ADR-057），替代 `skeleton.ts` 内联 `style.cssText` 控制栏，集中治理样式 + 双端响应式。FAB 挂载在 document.body（light DOM），样式通过 `ensureFabStyles` 注入 `<head>` 一次；预览面板内的 `.ysm-fab` 在 Shadow DOM 内，需本地样式。

## 核心职责

- **样式幂等注入**: `ensureFabStyles()` — 全局 CSS 注入到 `<head>`，id=`ysw-fab-styles`，只注入一次
- **图标按钮工厂**: `createIconButton(opts)` — 统一 emoji/图标按钮，`textContent` 防 XSS，支持 icon / label / title / className / onClick。**title 自 2026-08 起走自定义 tooltip**（`dom_tooltip.md`，~350ms 即显），不再设原生 `title` 属性防双气泡；可达性由 `aria-label` 承担

## 对外 API / 入口

- `YSW_FAB_CSS` — 全局 CSS 字符串（overlay 控制层 + 3D 信息面板 + 双端响应式）
- `ensureFabStyles()` — 幂等注入 CSS 到 document.head
- `createIconButton(opts: IconButtonOpts): HTMLButtonElement` — 创建图标按钮

## 不变量

- 样式只注入一次（`_fabInjected` 标志）
- 按钮文本用 `textContent`，禁止 `innerHTML`（防 XSS）
- 响应式断点复用 MikuMikuAR 口径（≤480px / landscape + max-height:500px / pointer:coarse 触控热区 44px）
