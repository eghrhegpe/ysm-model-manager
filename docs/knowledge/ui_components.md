---
kind: ui_components
name: UI 组件簇（原 ui 收容所，已归位）
tier: architecture
category: ui
source_files:
  - frontend/src/preview-3d/menu/slide-menu.ts
  - frontend/src/preview-3d/menu/header-toggle.ts
  - frontend/src/preview-3d/menu/slider-controller.ts
  - frontend/src/preview-3d/menu/style/components-styles.ts
  - frontend/src/preview-3d/menu/style/slide-menu-styles.ts
  - frontend/src/preview-3d/menu/style/style-install.ts
  - frontend/src/preview-3d/menu/dom-contract.ts
  - frontend/src/preview-3d/infra/ui-constants.ts
  - frontend/src/preview-3d/infra/overlay-active.ts
tests:
  - frontend/src/preview-3d/infra/overlay-active.test.ts
  - frontend/src/preview-3d/menu/style/components-styles.test.ts
  - frontend/src/preview-3d/menu/header-toggle.test.ts
  - frontend/src/preview-3d/menu/style/slide-menu-styles.test.ts
  - frontend/src/preview-3d/menu/slide-menu.test.ts
  - frontend/src/preview-3d/menu/slider-controller.test.ts
auto_fields:
  symbols_with_lines:
    - ARIA_ATTR
    - componentsCss
    - componentsStyleSheet
    - createHeaderToggle
    - createInstallableStyles
    - createSlideMenu
    - DragSliderController
    - DragSliderOptions
    - HeaderToggleConfig
    - HeaderToggleElement
    - InstallableStyles
    - installComponentsStyles
    - installSlideMenuStyles
    - isPreviewOverlayActive
    - PREVIEW_OVERLAY_ID
    - ROLE
    - slideMenuCss
    - SlideMenuHandle
    - slideMenuStyleSheet
    - SlideMenuView
    - SLIDER_BAR_CLASS
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - UI 组件、卡片组件、加载遮罩
  - 滑块控制器、幻灯片菜单外壳、头部开关
  - createSlideMenu / withLoadingIndicator / DragSliderController
quick_risk_lines:
  - UI 组件必须复用既有 helper 函数，禁止手写重复 DOM 结构
pitfalls:
  - 手写重复 DOM → 样式不一致、缺可访问性；必须复用组件簇
  - 组件簇内定义自定义元素 → 与全仓 Web Components 规范冲突；本簇只做 helper 函数
  - 把新文件塞回 `frontend/src/ui/` → 目录已于 ADR-220 解散，不存在

use_when:
  - UI 组件
  - 卡片组件
  - 加载动画
  - 滑块
  - 幻灯片菜单
invariant_anchors:
  - frontend/src/preview-3d/menu/slide-menu.ts|createSlideMenu
  - frontend/src/preview-3d/menu/header-toggle.ts|createHeaderToggle
status: active
---

# UI 组件簇（原 ui 收容所，已归位）

## 概览

原 `frontend/src/ui/`（自称 "ui-helpers 组件库"）是 MikuMikuAR 迁移物的收容所，2026-09-10 **随 ADR-220 整体解散**：组件按唯一消费方归位——3D 菜单子系统进 `frontend/src/preview-3d/menu/`，overlay 契约查询下沉 `frontend/src/preview-3d/adapters/`，符号统一去 `ui-` 前缀（`installUiComponentsStyles` → `installComponentsStyles` 等）。`ui/` 目录与 `@/ui/*` 别名（tsconfig paths + vite ALIAS_DIRS）已一并移除。

保留的仍是**无业务逻辑的 DOM 构建函数簇**；旧世界命令式行 builder 簇（`ui-rows`/`ui-advanced-rows`/`ui-slide-row`/`ui-collapsible` + `icons`/`ui-types`/`utils/uid`）早前已随拔管删除——3D 菜单行归 MenuNode schema 声明式路线（renderMenu 分派 + cap 栈）。**不是 Web Components 库**——本簇内无任何 `customElements.define`（全仓自定义元素一律在 `views/app-*` 定义）；函数直接操作 light-DOM 或返回元素/handle，由消费方挂载到自身容器。

## 核心职责（归位后清单）

| 模块 | 文件 | 用途 |
|------|------|------|
| 行排列 | （已拔管） | `ui-rows.ts`/`ui-advanced-rows.ts`/`ui-slide-row.ts` 已删除（`addSliderRow`/`addModeRow`/`addFieldRow`/`initControl`/`addColorSliderRow`/`addVector3SliderRow`/`addModeSlider`/`slideRow` 等 15 个命令式行 builder 生产零消费）；滑块能力下沉 cap 栈 `preview-3d/menu/cap-controls\|renderCapSlider`，toggle 能力下沉 `preview-3d/menu/header-toggle\|createHeaderToggle.forceToggle` |
| 折叠面板 | （已拔管） | `ui-collapsible.ts`（`addCollapsible`/`addSectionTitle`/`addPresetChip`）已删除——生产折叠组归 `preview-3d/menu/render` 的 `rmAppendFolder` cap-section 类体系（inert 移出 Tab 序语义保留在 cap-section 上） |
| 幻灯片菜单 | `preview-3d/menu/slide-menu.ts` | `createSlideMenu` → `SlideMenuHandle`（轻量导航栈外壳，见 [ui_slide_menu](./ui-slide-menu.md)） |
| 卡片 | （已拔管） | `ui-card.ts`（`cardContainer` 包一层 `.lcard`）2026-09-10 删除——生产零消费者，`.lcard` DOM 全仓无产出方；其 orphan 样式（`:root` 的 `--uih-lcard-*` token + `.lcard`/`.lcard > .slide-item:*` 规则，散在 `components-styles.ts` 与 `slide-menu-styles.ts`）同批清空。**3D 菜单的卡片分组走 `kind:"card"` + `MENU_CARD_CSS`（见 [preview_menu](./preview-menu.md)），勿复活 `.lcard`** |
| 加载 | （已拔管） | `ui-loading.ts`（`withLoadingIndicator` 自包含加载遮罩）2026-09-10 删除——生产零消费者；其 orphan 样式 `.loading-overlay*`（`components-styles.ts`）同批清空 |
| 顶部切换 | `preview-3d/menu/header-toggle.ts` | `createHeaderToggle` 紧凑 toggle（返回 `HeaderToggleElement`，含 `forceToggle` 程序化翻转出口——整行点击等外部触发语义自 addToggleRow 下沉）；纯创建函数，无注册表自更新（bind 注册链 + control-registry 2026-09 拔除，见 ADR-085） |
| 滑块 | `preview-3d/menu/slider-controller.ts` | `DragSliderController` 数值范围滑块（pointer 主 + mouse 兜底互斥；cap 栈 `preview-3d/menu/cap-controls\|renderCapSlider` 生产消费） |
| 图标 | （已拔管） | `icons.ts`（`createIcon`/`createIconBox`，iconify 兼容层）已删除——**现行入口 = `utils/icon/resolve.ts\|applyIcon`**：语义名 → `UI_ICONS` 的 SVG（`class="ws-icon"`，着色/定尺靠 `.ws-icon` 规则）；数据图标（`resource_types.json` 的 emoji/字形）→ `textContent` 兜底（ADR-238 D1 不可动） |
| 样式 | `preview-3d/menu/style/components-styles.ts` | `componentsCss` → `CSSStyleSheet`（供 Shadow 组件 `adoptedStyleSheets` 消费）+ `installComponentsStyles()`（light-DOM 注入，幂等，仅一次）。**本串必须自带 `.ws-icon` 规则**（经 `@/utils/dom/css.ts\|wsIconCSS` 插值，勿就地重写规则本体）——3D overlay 是 adopt 本串的唯一 shadow 根，`UI_ICONS` 的 SVG 靠它着色/定尺；漏带时在 `.slide-icon`（flex 容器）里自动尺寸为 0 → **图标 0×0 不可见**（2026-09-16 实测），非「巨块」 |
| 外壳样式 | `preview-3d/menu/style/slide-menu-styles.ts` | `slideMenuCss` → `slideMenuStyleSheet` + `installSlideMenuStyles()`。2026-09 收敛：8 个 token 内联 7 个单次消费项，仅留 `--uih-slide-card-bg`（语义独立）+ 补回历史悬空的 `--uih-slide-divider` |
| token 层 | `preview-3d/menu/style/components-styles.ts` 的 `:root` | `--uih-*` 设计令牌（2026-09 收敛 **70 → 21**）。**字号/尺寸类一律经 `calc(... + var(--fs-scale))` 派生**，随主设置页「基准字号」缩放；默认 `--fs-scale: 0px` ⇒ 默认态像素零变化。系数：字号 1 / 图标 1.2 / 行高 1（**刻意差异化——图标 1.2 而行高 1 会撑破行**）。判据「只被 `var()` 引用一次即内联」。契约见 [ui-slide-menu](./ui-slide-menu.md)#token-层与字号缩放 |
| 共享样式常量 | `preview-3d/menu/style/menu-styles.ts` | 跨文件同值类的**单一事实源**（`MENU_SECTION_CSS` / `MENU_BTN_CSS` / `MENU_ROW_DENSITY_CSS` / `MENU_DIVIDER_CSS` / `MENU_CARD_CSS` / `MENU_ERROR_NOTE_CSS`），消费方各自插值；`MENU_BTN_CSS`（`.cc-btn` 族）被 cap 控件与 `render.ts` 行内按钮（radio/badge）**双路径**消费——只让 cap 栈注入会让纯 row 面板回落 UA 默认不透明按钮（2026-09-16 事故，守卫 `menu-styles.test.ts`） |
| 样式脚手架 | `preview-3d/menu/style/style-install.ts` | `createInstallableStyles`——上面两样式文件共用的「CSSStyleSheet + 幂等 light-DOM 注入」脚手架 |
| 常量 | `preview-3d/infra/ui-constants.ts` | `PREVIEW_OVERLAY_ID`（3D overlay 根容器 ID）——**仅 `mount-preview-core` 建、`preview-3d/infra/overlay-active\|isPreviewOverlayActive` 查**两个出口，其它模块不得直接引用该常量裸查 DOM；滑块四分位常量 `SLIDER_QUARTER_*` 已随 ui-rows 拔管删除 |
| 契约查询 | `preview-3d/infra/overlay-active.ts` | `isPreviewOverlayActive()` —— 3D 全屏模态会话是否激活（查 overlay host 是否在 document，零状态漂移）。ADR-220 归位挂载核心旁（与唯一生产者同目录），app-tree 键盘门禁经 `@/preview-3d/infra/overlay-active.ts` 查询；原「勿因单消费者下沉」辩护随归位失效 |
| 类型 | （已拔管） | `ui-types.ts`（`ControlOptions`）已删除——消费方为已拔管行 builder 簇 |
| 工具 | （已删） | barrel re-export 已在 ADR-146 反桶运动中移除；全部消费方改为从具体叶模块直引 |
| 契约 | `preview-3d/menu/dom-contract.ts` | role/class 契约单源（禁手写字符串）；`SLIDER_BAR_CLASS = "cs-bar"` |

## 对外 API / 入口

- **无 barrel**：ADR-146 反桶运动后 `ui-helpers.ts` 已删除；全部消费方**直接从具体叶模块 import**（`createSlideMenu` 从 `preview-3d/menu/slide-menu.ts`、`DragSliderController` 从 `preview-3d/menu/slider-controller.ts` 等）
- **不注册自定义元素**：本簇无 `customElements.define`，消费方自行挂载返回值；不依赖 app-modules 装配（旧卡「经 app-modules.ts 统一注册为 Web Components」描述失真已修正）
- **同目录优先**：`preview-3d/menu/*` 内的消费方用 `./<name>.ts` 直引（符号已去 `ui-` 前缀）；跨目录（如 adapters）走 `@/preview-3d/menu/<name>.ts`

## 与其他子系统关系

- **消费方（3D 预览）**：`mount-preview-core.ts`（`installComponentsStyles` + `componentsStyleSheet` + `PREVIEW_OVERLAY_ID` + `slideMenuStyleSheet`）、`preview-3d/menu/core.ts`（`createSlideMenu`）、`preview-3d/menu/cap-controls.ts`（`createHeaderToggle` + `DragSliderController` + `dom-contract`）、`preview-3d/menu/render.ts`（`createHeaderToggle`）；`ui-card`/`ui-loading` 曾长期零生产消费（卡内记「备件保留」），2026-09-10 已连 orphan 样式一并删除——保留无期且会误导后人「有现成卡片壳可用」
- **shared-styles** — 共享按钮/焦点样式被本簇样式引用
- **views/app-*** — 各视图在 Shadow DOM 内经 `adoptedStyleSheets = [componentsStyleSheet, ...]` 消费样式串（`var()` 不跨 Shadow 边界继承的坑按前端 AGENTS 处理）
- **views/app-tree** — ADR-220 后首次 import `preview-3d` 目录（`overlay-active` 查询），层规不拦（preview-3d 不在 LAYER_ORDER），语义为「查 3D 模态会话」

## 不变量

- 纯 UI helper，零业务逻辑、零 app-state import
- 样式串经 `adoptedStyleSheets` 注入（Shadow 组件）/ `installComponentsStyles` 注入（light-DOM，幂等 `_installed` 守卫）；改样式走 MikuMikuAR 源重跑迁移脚本，勿手改生成串
- 控件状态回写走重建式渲染：菜单 refresh 重建行元素（toggle 初始 value 即最新态），无注册表自更新（control-registry 已删，ADR-085 的 bind 回写由重建承担）
- 行/面板 role/class 一律取自 `preview-3d/menu/dom-contract.ts`，禁止手写字符串
- toggle 行能力演进：`addToggleRow`/`toggleRow`/`addInlineToggleRow` 因生产零消费已删除；「整行点击切换（target 落在 `.toggle` 内跳过、防双触发）」语义并入 `preview-3d/menu/header-toggle|createHeaderToggle.forceToggle`，由 `preview-3d/menu/cap-controls|renderCapToggle` 消费（点 label 区翻转、点开关本体走原生 label 逻辑）。3D 菜单 toggle 唯一路径 = MenuNode schema → renderCapToggle，勿再引入第二套 toggle builder（红线：双轨必杀）
- slider 行能力演进：cap 栈滑块已从原生 `input[type=range]` 换为自绘 `.cs-bar`（fill 渐变 + thumb 细线 + 键盘 ←→/Home/End + pointer 触屏），由 `preview-3d/menu/slider-controller|DragSliderController` 驱动——控制器自 ui-rows `addSliderRow` 迁移（接入生产并补 pointer events：pointer 主 + mouse 兜底，`pointerDown` 互斥标志防真实鼠标双触发；`renderCapSlider` 补 click 跳转 onCommit 对齐原生 change 语义）。3D 菜单 slider 唯一路径 = MenuNode schema → renderCapSlider → cs-bar，勿再引入第二套滑块实现（红线：双轨必杀）。`addSliderRow` 本体（ui-rows）已随行 builder 簇拔管，能力叶保留（cs-bar 样式经 componentsStyleSheet、控制器经 cap 栈）
- 旧世界命令式行 builder 簇全拔：`ui-rows.ts`/`ui-advanced-rows.ts`/`ui-slide-row.ts`/`ui-collapsible.ts`/`icons.ts`/`ui-types.ts`（+`utils/uid.ts`）已删除——15 个命令式行 builder（`addSliderRow`/`addModeRow`/`addColorSliderRow`/`addVector3SliderRow`/`addModeSlider`/`addCollapsible`/`addFieldRow`/`addDangerRow`/`addInfoGrid` 等）生产零消费，职责全部由 MenuNode schema 声明式路线接管（renderMenu 分派 + cap 栈渲染器 + 副作用闭包）。`ui-card`/`ui-loading` 同为「零生产消费的通用工具叶」，2026-09-10 一并删除（判据：备件若无复活排期即为负债，且 `.lcard` 的存在会让人误以为有现成卡片壳可复用）。日后任何为 3D 菜单引入第二套命令式行 builder 者，审核必杀（红线）
- **新增 3D 菜单 UI 不再另立目录**：新组件直接落 `preview-3d/menu/`（ADR-220 后果），勿复活 `src/ui/`
