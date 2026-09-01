---
kind: ui_components
name: UI 组件库 ui-components
tier: architecture
category: ui
source_files:
  - frontend/src/ui/
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - UI 组件库、卡片组件、折叠面板
  - 加载动画、滑块、行组件、预设 chip
  - createCard / createSlideMenu / createLoading
quick_risk_lines:
  - UI 组件必须走 ui-components 的 helper 函数，禁止手写重复 DOM 结构
pitfalls:
  - 手写重复 DOM → 样式不一致、缺可访问性；必须经 ui-components
  - ui-components 内自定义元素 → 与全仓 Web Components 规范冲突；ui-components 只做 helper 函数

use_when:
  - UI 组件
  - 卡片组件
  - 折叠面板
  - 加载动画
  - 滑块
  - 行组件
  - 预设
  - 图标
invariant_anchors:
  - frontend/src/ui/control-registry.ts|registerControl
  - frontend/src/ui/control-registry.ts|getControl
---

# UI 组件库 ui-components

## 概览

`frontend/src/ui/` 是前端通用 UI **helper 函数库**（自 MikuMikuAR 迁移，ADR-191 去桶化）：提供卡片、折叠面板、加载遮罩、行排列、滑块、幻灯片菜单、预设 chip、图标工厂等无业务逻辑的 DOM 构建函数。**不是 Web Components 库**——`frontend/src/ui/` 内无任何 `customElements.define`（全仓自定义元素一律在 `views/app-*` 定义）；本库函数直接操作 light-DOM 或返回元素/handle，由消费方挂载到自身容器。

## 核心职责

| 模块 | 文件 | 用途 |
|------|------|------|
| 行排列 | `ui-rows.ts` | `addToggleRow`/`addSliderRow`/`toggleRow`/`addFieldRow`/`initControl`（绑定后即时 update） |
| 高级行 | `ui-advanced-rows.ts` | `addColorSliderRow`/`addModeSlider`/`addVector3SliderRow`（带额外控制的滑块行） |
| 折叠面板 | `ui-collapsible.ts` | `addCollapsible`（含 header toggle / mat 变体）/`addSectionTitle`/`addPresetChip`；折叠状态经 `panel.inert` 移出 Tab 序（可访问性） |
| 幻灯片菜单 | `ui-slide-menu.ts` | `createSlideMenu` → `SlideMenuHandle`（轻量导航栈外壳，见 [ui_slide_menu](./ui-slide-menu.md)） |
| 幻灯片行 | `ui-slide-row.ts` | `slideRow` 单行构建 |
| 卡片 | `ui-card.ts` | `cardContainer(container, fn)` — 包一层 `.lcard`，返回内部 dispose |
| 加载 | `ui-loading.ts` | `withLoadingIndicator` 自包含加载遮罩 |
| 顶部切换 | `ui-header-toggle.ts` | `createHeaderToggle` 紧凑 toggle；bind 注册用唯一 id `header-toggle-bind#<seq>`（防多实例 Map 覆盖）+ 两击断连清扫 |
| 预设 | `ui-preset.ts` | 预设选择器 |
| 滑块 | `ui-slider-controller.ts` | 数值范围滑块控件 |
| 图标 | `icons.ts` | `createIcon` 图标工厂（Iconify + emoji 回退） |
| 样式 | `ui-components-styles.ts` | `uiComponentsCss` → `CSSStyleSheet`（供 Shadow 组件 `adoptedStyleSheets` 消费）+ `installUiComponentsStyles()`（light-DOM 注入，幂等，仅一次） |
| 常量 | `ui-constants.ts` | 组件尺寸/间距常量 |
| 类型 | `ui-types.ts` | 共享 TypeScript 类型（`ControlOptions`） |
| 工具 | `ui-helpers.ts` | barrel re-export（3 值：cardContainer/addFieldRow/createSlideMenu，2026-08-26 清理后） |
| 控制注册 | `control-registry.ts` | 控件自更新注册表（可选接入外部响应式系统，默认 no-op） |
| 契约 | `dom-contract.ts` | role/class 契约单源（禁手写字符串） |

## 对外 API / 入口

- **barrel**：`import { ... } from "../ui/ui-helpers.ts"` — 仅 re-export 当前有消费方的 3 值（`cardContainer` / `addFieldRow` / `createSlideMenu`）；其余 helper（`slideRow` / `addToggleRow` / `toggleRow` / `addSliderRow` / `initControl` / `createHeaderToggle` / `addColorSliderRow` / `addModeSlider` / `addVector3SliderRow` / `withLoadingIndicator` 及各 type）一律**直接从源模块 import**（2026-08-26 移除无消费方 re-export）
- **非 barrel**：`addCollapsible`（`ui-collapsible.ts`）、`installUiComponentsStyles`（`ui-components-styles.ts`）、`addPresetChip` 等按需直接 import
- **不注册自定义元素**：本库无 `customElements.define`，消费方自行挂载返回值；不依赖 app-modules 装配（旧卡「经 app-modules.ts 统一注册为 Web Components」描述失真已修正）

## 与其他子系统关系

- **消费方（3D 预览）**：`mount-preview-core.ts`（环境面板 `createSlideMenu` + `installUiComponentsStyles` + `createHeaderToggle`）、`preview-menu/core.ts`（`createSlideMenu`）、`mmd-controls.ts`（`cardContainer`/`addFieldRow`）
- **shared-styles** — 共享按钮/焦点样式被本库样式引用
- **views/app-*** — 各视图在 Shadow DOM 内经 `adoptedStyleSheets = [uiComponentsStyleSheet, ...]` 消费样式串（`var()` 不跨 Shadow 边界继承的坑按前端 AGENTS 处理）

## 不变量

- 纯 UI helper，零业务逻辑、零 app-state import
- 样式串经 `adoptedStyleSheets` 注入（Shadow 组件）/ `installUiComponentsStyles` 注入（light-DOM，幂等 `_installed` 守卫）；改样式走 MikuMikuAR 源重跑迁移脚本，勿手改生成串
- 控件自更新：默认 `registerControl` 为 no-op（依赖各 `initControl` 挂载时立即 update），接入 `setControlRegistry` 后持续自更新才生效
- header-toggle 多实例：bind updater 各持唯一 id，注册前 `_sweepDetached()` 两击清扫——断连一轮入宽限集、连续两轮注销、恢复连接销记；从未挂载实例豁免（挂载历史 = MutationObserver.takeRecords 同步收割 + 扫描时 isConnected 补记，后者兜底 Shadow DOM）；update 不加 isConnected 守卫（保未挂载直调语义）
- 行/面板 role/class 一律取自 `dom-contract.ts`，禁止手写字符串
