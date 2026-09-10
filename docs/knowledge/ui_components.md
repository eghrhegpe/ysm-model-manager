---
kind: ui_components
name: UI 组件库 ui-components
tier: architecture
category: ui
source_files:
  - frontend/src/ui/
auto_fields:
  symbols_with_lines:
    - ARIA_ATTR
    - createHeaderToggle
    - createSlideMenu
    - DragSliderController
    - DragSliderOptions
    - HeaderToggleConfig
    - HeaderToggleElement
    - installSlideMenuStyles
    - installUiComponentsStyles
    - isPreviewOverlayActive
    - PREVIEW_OVERLAY_ID
    - ROLE
    - slideMenuCss
    - SlideMenuHandle
    - slideMenuStyleSheet
    - SlideMenuView
    - SLIDER_BAR_CLASS
    - uiComponentsCss
    - uiComponentsStyleSheet
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - UI 组件库、卡片组件、加载遮罩
  - 滑块控制器、幻灯片菜单外壳、头部开关
  - cardContainer / createSlideMenu / withLoadingIndicator / DragSliderController
quick_risk_lines:
  - UI 组件必须走 ui-components 的 helper 函数，禁止手写重复 DOM 结构
pitfalls:
  - 手写重复 DOM → 样式不一致、缺可访问性；必须经 ui-components
  - ui-components 内自定义元素 → 与全仓 Web Components 规范冲突；ui-components 只做 helper 函数

use_when:
  - UI 组件
  - 卡片组件
  - 加载动画
  - 滑块
  - 幻灯片菜单
invariant_anchors:
  - frontend/src/ui/ui-slide-menu.ts|createSlideMenu
  - frontend/src/ui/ui-header-toggle.ts|createHeaderToggle
status: active
---

# UI 组件库 ui-components

## 概览

`frontend/src/ui/` 是前端通用 UI **helper 函数库**（自 MikuMikuAR 迁移，ADR-191 去桶化）：提供卡片、加载遮罩、滑块控制器、幻灯片菜单外壳、头部开关等无业务逻辑的 DOM 构建函数；旧世界命令式行 builder 簇（`ui-rows`/`ui-advanced-rows`/`ui-slide-row`/`ui-collapsible` + `icons`/`ui-types`/`utils/uid`）已随拔管删除——3D 菜单行归 MenuNode schema 声明式路线（renderMenu 分派 + cap 栈）。**不是 Web Components 库**——`frontend/src/ui/` 内无任何 `customElements.define`（全仓自定义元素一律在 `views/app-*` 定义）；本库函数直接操作 light-DOM 或返回元素/handle，由消费方挂载到自身容器。

## 核心职责

| 模块 | 文件 | 用途 |
|------|------|------|
| 行排列 | （已拔管） | `ui-rows.ts`/`ui-advanced-rows.ts`/`ui-slide-row.ts` 已删除（`addSliderRow`/`addModeRow`/`addFieldRow`/`initControl`/`addColorSliderRow`/`addVector3SliderRow`/`addModeSlider`/`slideRow` 等 15 个命令式行 builder 生产零消费）；滑块能力下沉 cap 栈 `preview-3d/menu/cap-controls|renderCapSlider`，toggle 能力下沉 `ui-header-toggle|createHeaderToggle.forceToggle` |
| 折叠面板 | （已拔管） | `ui-collapsible.ts`（`addCollapsible`/`addSectionTitle`/`addPresetChip`）已删除——生产折叠组归 `preview-3d/menu/render` 的 `rmAppendFolder` cap-section 类体系（inert 移出 Tab 序语义保留在 cap-section 上） |
| 幻灯片菜单 | `ui-slide-menu.ts` | `createSlideMenu` → `SlideMenuHandle`（轻量导航栈外壳，见 [ui_slide_menu](./ui-slide-menu.md)） |
| 卡片 | （已拔管） | `ui-card.ts`（`cardContainer` 包一层 `.lcard`）2026-09-10 删除——生产零消费者，`.lcard` DOM 全仓无产出方；其 orphan 样式（`:root` 的 `--uih-lcard-*` token + `.lcard`/`.lcard > .slide-item:*` 规则，散在 `ui-components-styles.ts` 与 `ui-slide-menu-styles.ts`）同批清空。**3D 菜单的卡片分组走 `kind:"card"` + `MENU_CARD_CSS`（见 [preview_menu](./preview-menu.md)），勿复活 `.lcard`** |
| 加载 | （已拔管） | `ui-loading.ts`（`withLoadingIndicator` 自包含加载遮罩）2026-09-10 删除——生产零消费者；其 orphan 样式 `.loading-overlay*`（`ui-components-styles.ts`）同批清空 |
| 顶部切换 | `ui-header-toggle.ts` | `createHeaderToggle` 紧凑 toggle（返回 `HeaderToggleElement`，含 `forceToggle` 程序化翻转出口——整行点击等外部触发语义自 addToggleRow 下沉）；纯创建函数，无注册表自更新（bind 注册链 + control-registry 2026-09 拔除，见 ADR-085） |
| 滑块 | `ui-slider-controller.ts` | `DragSliderController` 数值范围滑块（pointer 主 + mouse 兜底互斥；cap 栈 `preview-3d/menu/cap-controls|renderCapSlider` 生产消费） |
| 图标 | （已拔管） | `icons.ts`（`createIcon`/`createIconBox`，iconify 兼容层）已删除——生产行图标经 textContent 直写 / 字面量 glyph |
| 样式 | `ui-components-styles.ts` | `uiComponentsCss` → `CSSStyleSheet`（供 Shadow 组件 `adoptedStyleSheets` 消费）+ `installUiComponentsStyles()`（light-DOM 注入，幂等，仅一次） |
| 常量 | `ui-constants.ts` | `PREVIEW_OVERLAY_ID`（3D overlay 根容器 ID）——**仅 `mount-preview-core` 建、`ui/overlay-active|isPreviewOverlayActive` 查**两个出口，其它模块不得直接引用该常量裸查 DOM；滑块四分位常量 `SLIDER_QUARTER_*` 已随 ui-rows 拔管删除 |
| 契约查询 | `overlay-active.ts` | `isPreviewOverlayActive()` —— 3D 全屏模态会话是否激活（查 overlay host 是否在 document，零状态漂移）。**单消费者（app-tree 键盘门禁）是有意为之**：本文件是契约收编点，下沉会导致 view→view 互引或裸查扩散；新增消费方直接 import，勿下沉 |
| 类型 | （已拔管） | `ui-types.ts`（`ControlOptions`）已删除——消费方为已拔管行 builder 簇 |
| 工具 | （已删） | barrel re-export 已在 ADR-146 反桶运动中移除；全部消费方改为从具体叶模块直引 |
| 契约 | `dom-contract.ts` | role/class 契约单源（禁手写字符串） |

## 对外 API / 入口

- **无 barrel**：ADR-146 反桶运动后，`ui-helpers.ts` 已删除；全部消费方**直接从具体叶模块 import**（`createSlideMenu` 从 `ui-slide-menu.ts`、`DragSliderController` 从 `ui-slider-controller.ts` 等）
- **不注册自定义元素**：本库无 `customElements.define`，消费方自行挂载返回值；不依赖 app-modules 装配（旧卡「经 app-modules.ts 统一注册为 Web Components」描述失真已修正）

## 与其他子系统关系

- **消费方（3D 预览）**：`mount-preview-core.ts`（`installUiComponentsStyles` + `uiComponentsStyleSheet` + `PREVIEW_OVERLAY_ID` + `slideMenuStyleSheet`）、`preview-3d/menu/core.ts`（`createSlideMenu`）、`preview-3d/menu/cap-controls.ts`（`createHeaderToggle` + `DragSliderController` + `dom-contract`）、`preview-3d/menu/render.ts`（`createHeaderToggle`）；`ui-card`/`ui-loading` 曾长期零生产消费（卡内记「备件保留」），2026-09-10 已连 orphan 样式一并删除——保留无期且会误导后人「有现成卡片壳可用」
- **shared-styles** — 共享按钮/焦点样式被本库样式引用
- **views/app-*** — 各视图在 Shadow DOM 内经 `adoptedStyleSheets = [uiComponentsStyleSheet, ...]` 消费样式串（`var()` 不跨 Shadow 边界继承的坑按前端 AGENTS 处理）

## 不变量

- 纯 UI helper，零业务逻辑、零 app-state import
- 样式串经 `adoptedStyleSheets` 注入（Shadow 组件）/ `installUiComponentsStyles` 注入（light-DOM，幂等 `_installed` 守卫）；改样式走 MikuMikuAR 源重跑迁移脚本，勿手改生成串
- 控件状态回写走重建式渲染：菜单 refresh 重建行元素（toggle 初始 value 即最新态），无注册表自更新（control-registry 已删，ADR-085 的 bind 回写由重建承担）
- 行/面板 role/class 一律取自 `dom-contract.ts`，禁止手写字符串
- toggle 行能力演进：`addToggleRow`/`toggleRow`/`addInlineToggleRow` 因生产零消费已删除；「整行点击切换（target 落在 `.toggle` 内跳过、防双触发）」语义并入 `ui-header-toggle|createHeaderToggle.forceToggle`，由 `preview-3d/menu/cap-controls|renderCapToggle` 消费（点 label 区翻转、点开关本体走原生 label 逻辑）。3D 菜单 toggle 唯一路径 = MenuNode schema → renderCapToggle，勿再引入第二套 toggle builder（红线：双轨必杀）
- slider 行能力演进：cap 栈滑块已从原生 `input[type=range]` 换为自绘 `.cs-bar`（fill 渐变 + thumb 细线 + 键盘 ←→/Home/End + pointer 触屏），由 `ui-slider-controller|DragSliderController` 驱动——控制器自 ui-rows `addSliderRow` 迁移（接入生产并补 pointer events：pointer 主 + mouse 兜底，`pointerDown` 互斥标志防真实鼠标双触发；`renderCapSlider` 补 click 跳转 onCommit 对齐原生 change 语义）。3D 菜单 slider 唯一路径 = MenuNode schema → renderCapSlider → cs-bar，勿再引入第二套滑块实现（红线：双轨必杀）。`addSliderRow` 本体（ui-rows）已随行 builder 簇拔管，能力叶保留（cs-bar 样式经 uiComponentsStyleSheet、控制器经 cap 栈）
- 旧世界命令式行 builder 簇全拔：`ui-rows.ts`/`ui-advanced-rows.ts`/`ui-slide-row.ts`/`ui-collapsible.ts`/`icons.ts`/`ui-types.ts`（+`utils/uid.ts`）已删除——15 个命令式行 builder（`addSliderRow`/`addModeRow`/`addColorSliderRow`/`addVector3SliderRow`/`addModeSlider`/`addCollapsible`/`addFieldRow`/`addDangerRow`/`addInfoGrid` 等）生产零消费，职责全部由 MenuNode schema 声明式路线接管（renderMenu 分派 + cap 栈渲染器 + 副作用闭包）。`ui-card`/`ui-loading` 同为「零生产消费的通用工具叶」，2026-09-10 一并删除（判据：备件若无复活排期即为负债，且 `.lcard` 的存在会让人误以为有现成卡片壳可复用）。日后任何为 3D 菜单引入第二套命令式行 builder 者，审核必杀（红线）
