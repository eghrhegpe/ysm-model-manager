---
kind: ui-slide-menu
name: ADR 去桶化 slide-menu 外壳组件
tier: leaf
category: ui
source_files:
  - frontend/src/ui/ui-slide-menu.ts
  - frontend/src/ui/ui-slide-menu-styles.ts
  - frontend/src/ui/ui-helpers.ts
  - frontend/src/ui/ui-components-styles.ts
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - slide-menu、slide 菜单、去桶化
  - 两级菜单、轻量导航栈、createSlideMenu / slideRow
quick_risk_lines:
  - slide-menu 外壳必须复用 ui-slide-menu 的轻量导航栈，禁止手写导航栈
pitfalls:
  - 手写导航栈 → 与 ui-slide-menu 的 home/navigate/back 契约不一致；必须复用
  - slide-menu 挂业务 registry/schema → 外壳层混入业务；必须保持外壳纯净

use_when:
  - slide-menu
  - slide 菜单
  - 去桶化
  - 两级菜单
  - 轻量导航栈
  - createSlideMenu
  - slideRow
invariant_anchors:
  - frontend/src/ui/ui-slide-menu.ts|createSlideMenu
  - frontend/src/ui/ui-slide-menu.ts|home
---

# ADR 去桶化 slide-menu 外壳组件

## 概览

`frontend/src/ui/ui-slide-menu.ts` 是 ADR 去桶化（ADR-075/076）配套新增的**通用 slide-menu 卡片外壳组件**，复刻 MikuMikuAR 的 slide-menu 视觉卡片（menu-wrapper / slide-viewport / slide-panel / slide-list / slide-header），但不搬其菜单导航引擎（registry/schema/stack 等业务层）。在外壳层提供一组**轻量导航栈**能力（`home`/`navigate`/`back`/`refresh`/`isShowing`/`reset`/`isAtRoot`），供调用方以最小成本组织多级菜单（如 YSM 的「模型信息 → 表情 / 切换模型」两级）。

## 核心职责

- `createSlideMenu(opts?)` — 构建外壳根元素（`.menu-wrapper.slide-menu`），返回 `SlideMenuHandle`
- `SlideMenuHandle.root` — 卡片根元素，挂到定位容器即可
- `SlideMenuHandle.list` — 内容挂载点（`.slide-list.render-card`），legacy 直接操作时可用
- `home(view)` — 以给定视图为根重置导航栈并渲染（用于顶部菜单进入一级）
- `navigate(view)` — 下钻到子视图（压栈并渲染）
- `back()` — 返回上一级；已在根级则触发 `onClose` 回调
- `setTitle(title)` / `setOnClose(fn)` — 直接设置标题栏文字与关闭回调
- `refresh()` — 重渲当前视图
- `reset()` / `isAtRoot()` — 栈重置与根级检测
- `isShowing()` — 是否处于打开状态
- **键盘导航（a11y，2026-08-29）**：↑↓ 方向键在菜单项间循环（roving tabindex：当前项 `tabindex=0`，其余 `-1`）；Enter/Space 激活聚焦项（触发 click，复用已有行 click handler）；Escape 返回上一级 / 根级触发关闭；Home/End 跳首尾。**不使用 WASD**（避免与 3D 相机输入冲突，上下文栈可后续接入）
- **焦点记忆 + 输入阻断栈（a11y，2026-08-29）**：`onShow()` 记住触发焦点 + `pushInputBlock("slide-menu")`（暂停相机 WASD/方向键消费）+ 给首项 focus；`onHide({ restoreFocus? })` pop 输入阻断 + 归还焦点（3D overlay 关闭路径传 `{restoreFocus:false}` 避免双 returnFocus 竞争）

## 解耦要点

- 关闭/返回按钮用**字面量 glyph**（根级 ✕，子集 ←），不依赖 iconify 运行时
- 外壳恒含 🥉 行组件，故 `createSlideMenu` 同时安装 `ui-components` 样式（`installUiComponentsStyles`）
- **零业务依赖**：可被任意预览/面板复用，不绑定 3D/YSM/VRM 特定内容
- 向后兼容：不调用 `home`/`navigate` 的调用方（直接操作 `menu.list`）行为不变——导航栈为空，`slide-back` 在根级仍触发 `onClose`（即关闭）

## 对外 API / 入口

- `SlideMenuView` — `{ title, render(list: HTMLElement): void }`
- `SlideMenuHandle` — `{ root, list, setTitle, setOnClose, home, navigate, back, refresh, reset, isAtRoot, isShowing, onShow, onHide }`
  - `onShow(): void` — 焦点记忆 + 输入阻断 + 首项 focus
  - `onHide(opts?: { restoreFocus?: boolean }): void` — pop 阻断 + 归还焦点
- `createSlideMenu({ title?, closeIcon? })`

## 与其他子系统关系

- 消费方：`mount-preview-core.ts` 的环境面板（🌍 时间/云量/IBL/地面开关）通过 `createSlideMenu` 构建
- 消费方：`mmd-controls.ts` 的 `cardContainer` 与 `addFieldRow`（来自 `ui-helpers` barrel re-export）
- 🥉 行组件 barrel（`ui-helpers.ts` re-export，2026-08-26 二次清理后仅 3 值）：`cardContainer` / `addFieldRow` / `createSlideMenu`；其余行组件（`slideRow`/`addToggleRow`/`initControl` 等）直接从各自源模块 import（历史清理记录见 [ui_components](./ui_components.md)）
- **不消费**：MikuMikuAR 的 `ui-resource-panel` / `ui-fullscreen-overlay` / `ui-virtual-grid` 未纳入本批

## 不变量

- `closeIcon` 默认 ✕，`navigate` 后返回按钮切换为 ←（不通过 CSS class 区分，靠 glyph 切换）
- 每次 `navigate`/`refresh` 都会调用视图的 `render`（须幂等）
- 导航栈清空（`reset`）后回到初始状态，`isAtRoot()` 始终为 true
- **键盘导航仅使用方向键**（不使用 WASD），避免与 3D 相机 WASD 输入冲突（input-and-animation 在 document 级监听，isInputBlocked 暂停其消费）
- **showMenu 调用方须调 `menu.onShow()`，hideMenu 调用方须调 `menu.onHide()`**（管理焦点恢复 + 输入阻断栈）；✕ 关闭 3D 时 hideMenu 传 `{ restoreFocus: false }`（由 mount3D closeOverlay 处理焦点归还）

## 已知遗留（2026-08-29 a11y 审查登记）

- `smGetNavItems` 用 `el.offsetParent !== null` 判可见性——**position:fixed 项在真实浏览器 offsetParent 为 null 会被误过滤**（happy-dom 下 offsetParent 是 undefined 恒保留，测试未暴露）。当前菜单项无 fixed 定位未触发；若未来菜单项用 fixed 需改判 `getClientRects().length` 或 `display` 检查。
- 键盘导航测试补强后仍缺「焦点真正移动」断言之外的边界场景（见 `ui-slide-menu.test.ts` 观察项）；Numpad keyup 释放、输入阻断栈×双轨键组合补测在 `input-and-animation.test.ts` 登记，属同类规模盲区，随真实 a11y 验证需求再补。

## 相关

- [preview_core](./preview_core.md) — 环境面板等消费方
- [app-preview](./app-preview.md) — mmd-controls.ts 等消费方
- ADR-075（环境面板行式菜单）、ADR-076（根菜单 ⚙️ 收编）