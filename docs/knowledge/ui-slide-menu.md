---
kind: ui-slide-menu
name: ADR 去桶化 slide-menu 外壳组件
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/menu/slide-menu.ts
  - frontend/src/preview-3d/menu/slide-menu-styles.ts
  - frontend/src/preview-3d/menu/components-styles.ts
auto_fields:
  symbols_with_lines:
    - componentsCss
    - componentsStyleSheet
    - createSlideMenu
    - installComponentsStyles
    - installSlideMenuStyles
    - slideMenuCss
    - SlideMenuHandle
    - slideMenuStyleSheet
    - SlideMenuView
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - slide-menu、slide 菜单、去桶化
  - 两级菜单、轻量导航栈、createSlideMenu
quick_risk_lines:
  - slide-menu 外壳必须复用 slide-menu 的轻量导航栈，禁止手写导航栈
pitfalls:
  - 手写导航栈 → 与 slide-menu 的 home/navigate/back 契约不一致；必须复用
  - slide-menu 挂业务 registry/schema → 外壳层混入业务；必须保持外壳纯净

use_when:
  - slide-menu
  - slide 菜单
  - 去桶化
  - 两级菜单
  - 轻量导航栈
  - createSlideMenu
invariant_anchors:
  - frontend/src/preview-3d/menu/slide-menu.ts|createSlideMenu
  - frontend/src/preview-3d/menu/slide-menu.ts|home
status: active
---

# ADR 去桶化 slide-menu 外壳组件

## 概览

`frontend/src/preview-3d/menu/slide-menu.ts` 是 ADR 去桶化（ADR-075/076）配套新增的**通用 slide-menu 卡片外壳组件**，复刻 MikuMikuAR 的 slide-menu 视觉卡片（menu-wrapper / slide-viewport / slide-panel / slide-list / slide-header），但不搬其菜单导航引擎（registry/schema/stack 等业务层）。在外壳层提供一组**轻量导航栈**能力（`home`/`navigate`/`back`/`refresh`/`isShowing`/`reset`/`isAtRoot`），供调用方以最小成本组织多级菜单（如 YSM 的「模型信息 → 表情 / 切换模型」两级）。

> **路径沿革（ADR-220，2026-09-10）**：原 `frontend/src/ui/ui-slide-menu.ts`；`ui/` 收容所解散后归位 3D 菜单子系统，符号去 `ui-` 前缀。`ui/` 目录已不存在，勿再按旧路径检索。

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
- 外壳恒含 🥉 行组件，故 `createSlideMenu` 同时安装 components 样式（`installComponentsStyles`，原 `installUiComponentsStyles`）
- **零业务依赖**：可被任意预览/面板复用，不绑定 3D/YSM/VRM 特定内容
- 向后兼容：不调用 `home`/`navigate` 的调用方（直接操作 `menu.list`）行为不变——导航栈为空，`slide-back` 在根级仍触发 `onClose`（即关闭）

## 对外 API / 入口

- `SlideMenuView` — `{ title, render(list: HTMLElement): void }`
- `SlideMenuHandle` — `{ root, list, setTitle, setOnClose, home, navigate, back, refresh, reset, isAtRoot, isShowing, onShow, onHide }`
  - `onShow(): void` — 焦点记忆 + 输入阻断 + 首项 focus
  - `onHide(opts?: { restoreFocus?: boolean }): void` — pop 阻断 + 归还焦点
- `createSlideMenu({ title?, closeIcon? })`

## 与其他子系统关系

- 消费方：`mount-preview-core.ts` 的环境面板（🌍 时间/云量/IBL/地面开关）通过 `createSlideMenu` 构建（`preview-3d/menu/core.ts` 亦直接 `import { createSlideMenu } from "./slide-menu.ts"`）
- 同目录兄弟模块：`slide-menu-styles.ts`（外壳样式）、`components-styles.ts`（行组件样式）、`style-install.ts`（两样式共用安装脚手架）、`header-toggle.ts` / `slider-controller.ts`（cap 栈控件）
- 原「🥉 行组件 barrel（`ui-helpers.ts` re-export）」已随 ADR-146 反桶运动删除（2026-08-26）：全部消费方从具体叶模块直引（`createSlideMenu` 直引 `slide-menu.ts`；`cardContainer`/`ui-card.ts` 已于 2026-09-10 随零消费者清理删除）；旧世界命令式行 builder 簇（`ui-rows`/`ui-advanced-rows`/`ui-slide-row` 等）已随拔管删除（见 [ui_components](./ui_components.md)）
- **不消费**：MikuMikuAR 的 `ui-resource-panel` / `ui-fullscreen-overlay` / `ui-virtual-grid` 未纳入本批

## 不变量

- `closeIcon` 默认 ✕，`navigate` 后返回按钮切换为 ←（不通过 CSS class 区分，靠 glyph 切换）
- 每次 `navigate`/`refresh` 都会调用视图的 `render`（须幂等）
- 导航栈清空（`reset`）后回到初始状态，`isAtRoot()` 始终为 true
- **键盘导航仅使用方向键**（不使用 WASD），避免与 3D 相机 WASD 输入冲突（input-and-animation 在 document 级监听，isInputBlocked 暂停其消费）
- **showMenu 调用方须调 `menu.onShow()`，hideMenu 调用方须调 `menu.onHide()`**（管理焦点恢复 + 输入阻断栈）；✕ 关闭 3D 时 hideMenu 传 `{ restoreFocus: false }`（由 mount3D closeOverlay 处理焦点归还）

## 已知遗留（2026-08-29 a11y 审查登记）

- `smGetNavItems` 用 `el.offsetParent !== null` 判可见性——**position:fixed 项在真实浏览器 offsetParent 为 null 会被误过滤**（happy-dom 下 offsetParent 是 undefined 恒保留，测试未暴露）。当前菜单项无 fixed 定位未触发；若未来菜单项用 fixed 需改判 `getClientRects().length` 或 `display` 检查。
- 键盘导航测试补强后仍缺「焦点真正移动」断言之外的边界场景（见 `slide-menu.test.ts` 观察项）；Numpad keyup 释放、输入阻断栈×双轨键组合补测在 `input-and-animation.test.ts` 登记，属同类规模盲区，随真实 a11y 验证需求再补。

## token 层与字号缩放（2026-09 收敛）

3D 菜单样式曾自成一套 `--uih-*` 裸 px token，**不参与全局「基准字号」设置**——用户在设置页调大字号，3D 菜单纹丝不动。2026-09 收敛：

- **字号/尺寸 token 全部经 `calc(... + var(--fs-scale))` 派生**（`components-styles.ts` 的 `:root`）。默认 `--fs-scale: 0px`（`frontend/css/variables.css`），故默认态像素零变化。
  - ⚠️ **边界（2026-09）**：3D 菜单只吃**用户偏移** `--fs-scale`，**不随 2D 的真基准 `--fs-base-size` 变动**——2D 核心/语义字号已全部派生自基准（改基准 2D 全盘跟随），3D 仍是独立调校的覆盖层，故两者只在「用户调字号」时同步。
  - 字号类系数 **1**（`--uih-font-ui/-sm/-xs/-title/-lg`、`--uih-cs-label-font-size`）；
  - 图标类系数 **1.2**（`--uih-slide-icon-size` 等，视觉重量随字号略超前）；
  - 行高类系数 **1**（`--uih-slide-item-min-height` 等）——**若图标 1.2 而行高 1 会撑破，故刻意差异化**。
- **token 数 70 → 21**（`components-styles` 19 + `slide-menu-styles` 2）。判据：**只被 `var()` 引用一次即内联**（单次消费的间接层比直接写值还长，是纯意外复杂度）。保留的是多方消费（`--uih-slide-icon-size` 18 处、`--uih-white-medium` 19 处）或语义独立（`--uih-slide-card-bg` = 卡片背景独立于 ysm 主题）。
- **白色透明度 8 档 → 3 档**（`--uih-white-weak/medium/strong`）：原 04/05/06/08/10/12/16/40 视觉难分辨。
- **清掉与 `--radius-xs` 重复的 `--uih-cs-bar-radius`**（同为 3px）。

**契约测试**（`components-styles.test.ts`）：字号/尺寸 token 必须含 `var(--fs-scale)`、token 总数**精确**断言（非宽松上限）、**无零引用 token**、本文件零硬编码 `font-size:Npx`。新增合法 token 时须同步改总数——强制走一次「这真有必要吗」的判断。

> ⚠️ 实测教训：宽松上限（≤25）时注入 `--uih-font-bad: 13px` **能溜过**；改精确断言 + 零引用断言后双重命中。断言写松等于没写。

**设计约束**：3D 菜单只允许 MenuNode schema（根 AGENTS.md 红线），故「基准字号」偏好**只在主设置页可达**，未进 3D 菜单——`preview-3d/menu/settings.ts|buildSettingsSchema` 聚合的是渲染相关 cap 控件（视锥裁剪/帧率/分辨率/画质），与 `ui-prefs` 的 UI 偏好零交集。若要进菜单，须走 `settingsOrder` 声明。

## ⚠️ 历史悬空引用（已修）

`--uih-slide-divider` 在 `slide-menu-styles.ts` 被引用 2 次（`.slide-header` 下边框、`.collapsible-header` 边框）但**从未定义**——`border-bottom: 1px solid var(--uih-slide-divider)` 整条声明失效，导致 3D 菜单标题栏下沿与折叠头边框**长期不可见**。2026-09 收敛时补齐（`rgba(255,255,255,0.08)`）。
> 教训：**收敛盘点引用与定义的对齐关系本身就能挖出潜伏 bug**，不只是洁癖。

## 相关

- [preview_core](./preview_core.md) — 环境面板等消费方
- [app-preview](./app-preview.md) — app-preview 侧 mmd-controls 等模块（现不再直接消费该外壳，经 preview-3d/menu cap 栈渲染）
- [ui_components](./ui_components.md) — 🥉 行组件库（`components-styles.ts` 同源）
- ADR-075（环境面板行式菜单）、ADR-076（根菜单 ⚙️ 收编）、ADR-220（ui 收容所解散归位）、ADR-256（设计令牌行级闸）
