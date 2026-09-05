---
kind: preview-menu
name: 3D 预览声明式菜单 preview-menu
tier: architecture
adr:
  - ADR-132
category: rendering
source_files:
  - frontend/src/preview-3d/menu/core.ts
  - frontend/src/preview-3d/menu/render.ts
  - frontend/src/preview-3d/menu/node-types.ts
  - frontend/src/preview-3d/menu/defs.ts
  - frontend/src/preview-3d/menu/cap-controls.ts
  - frontend/src/preview-3d/menu/env.ts
  - frontend/src/preview-3d/menu/roles.ts
  - frontend/src/preview-3d/menu/settings.ts
  - frontend/src/preview-3d/menu/stats.ts
  - frontend/src/preview-3d/menu/switch.ts
  - frontend/src/preview-3d/menu/multi-model.ts
auto_fields:
  symbols_with_lines:
    - buildCameraSchema
    - buildCrossCuttingControls
    - buildEnvSchema
    - buildLightingSchema
    - buildPostprocessingSchema
    - buildPreviewMenuRouters
    - buildSettingsControls
    - buildSettingsSchema
    - buildShadowSchema
    - buildStatsPanel
    - collectPreviewLeafNodes
    - collectPreviewNodeIds
    - collectSettingsCapControls
    - collectVisiblePredicates
    - CORE_MENU_ITEMS
    - disposeEnvSubscriptions
    - fillRoles
    - fillSwitch
    - formatCapSliderValue
    - frRoleRowClass
    - hasSceneStats
    - isPreviewFolderNode
    - mergeStatsMenuItems
    - modelDetailView
    - motionDetailView
    - mountPreviewRootMenu
    - multiModelSelectNode
    - MultiModelSelectOpts
    - PREVIEW_MENU_GROUPS
    - PreviewActionMenuCtx
    - PreviewControlSpec
    - PreviewMenuCtx
    - PreviewMenuGroupDef
    - PreviewMenuGroupId
    - PreviewMenuHandle
    - PreviewMenuNode
    - PreviewMenuNodeKind
    - PreviewMenuRouters
    - renderAdapterPanelContent
    - renderCapControls
    - renderEnvLevel
    - renderMenu
    - renderPreviewPanel
    - roleBaseName
    - STATS_PANEL_ID
    - switchTabHighlightBg
tests:
  - frontend/src/features/community/render.test.ts
  - frontend/src/preview-3d/adapters/preview-menu.test.ts
  - frontend/src/preview-3d/adapters/render-custom-audit.test.ts
  - frontend/src/preview-3d/adapters/switch-preview.test.ts
  - frontend/src/preview-3d/caps/render-mode-capability.test.ts
  - frontend/src/preview-3d/menu/cap-controls.test.ts
  - frontend/src/preview-3d/menu/core.test.ts
  - frontend/src/preview-3d/menu/env.test.ts
  - frontend/src/preview-3d/menu/multi-model.test.ts
  - frontend/src/preview-3d/menu/node-types.test.ts
  - frontend/src/preview-3d/menu/roles.test.ts
  - frontend/src/preview-3d/menu/stats.test.ts
  - frontend/src/preview-3d/perception/core.test.ts
  - frontend/src/preview-3d/render-budget.test.ts
  - frontend/src/test-utils/render.test.ts
  - frontend/src/views/app-content/site/render.test.ts
  - frontend/src/views/app-sidebar/render.test.ts
  - frontend/src/views/app-tree/render.test.ts
  - frontend/src/workers/stats-core.test.ts
  - frontend/src/workers/stats.worker.test.ts
quick_groups:
  - 3D 预览菜单系统
quick_intents:
  - PreviewMenuNode 声明式菜单
  - visibleWhen 谓词
  - mountPreviewRootMenu 挂载
  - renderMenu 单一渲染器
  - schema-registry 面板注册
pitfalls:
  - 3D 菜单只允许 visibleWhen 谓词，禁止手写 3D 菜单；新增 UI 功能必须可被所有数组类菜单调用
  - schemaId 必显式声明（panel id 不再隐式兜底作 schema key，防 id 撞注册键渲染错内容）
  - fillers 仅 roles 一项（G3 删 fill* 后唯一残留），health.test 白名单守卫——禁止新增 filler
  - renderCustom 是末段逃生舱，schemaId 未注册时走 renderCustom 会 console.warn
use_when:
  - 3D 预览菜单
  - 声明式菜单节点
  - visibleWhen 谓词
  - 面板 schema 注册
  - SlideMenu 多层导航
invariant_anchors:
  - frontend/src/preview-3d/menu/core.ts|mountPreviewRootMenu
  - frontend/src/preview-3d/menu/core.ts|buildPreviewMenuRouters
  - frontend/src/preview-3d/menu/render.ts|renderMenu
  - frontend/src/preview-3d/menu/render.ts|renderAdapterPanelContent
  - frontend/src/preview-3d/menu/node-types.ts|PreviewMenuNode
  - frontend/src/preview-3d/menu/defs.ts|CORE_MENU_ITEMS
  - frontend/src/preview-3d/menu/defs.ts|PREVIEW_MENU_GROUPS
status: active
---

# 3D 预览声明式菜单 preview-menu

## 概览

3D 预览底部根菜单的声明式菜单系统（ADR-076 v3）。对齐 MikuMikuAR 范式：底部根按钮 → `createSlideMenu` 多层导航。菜单即数据——`PreviewMenuNode` 树 + `visibleWhen: (s: PreviewSnapshot) => boolean` 谓词驱动；单一渲染器 `renderMenu()` 递归渲染整棵树。能力驱动 dock 按钮显隐（有模型/骨骼项 → 🧍 角色；有动作/播放项 → 💃 动作；有环境能力 → 🌍 环境；有场景/相机能力 → 🎛️ 场景）。

与 AGENTS.md 红线对齐：**3D 菜单只允许 visibleWhen 谓词，禁止手写 3D 菜单**；新增 UI 功能必须可被所有数组类菜单调用。

## 核心职责

- **`mountPreviewRootMenu(overlay, ctx): PreviewMenuHandle`**（core.ts）— 主入口：装配 dock + popup + SlideMenu 外壳 → 构建面板路由表 → 渲染 dock → 绑定 tap 识别。返回句柄（`dispose` / `setAdapterItems` / `openPanel` / `refreshDock`）。
- **`renderMenu(container, nodes, deps)`**（render.ts）— 单一渲染器：按 `node.kind` 分派（folder/field/button/row/select/slider/toggle/material-row/controls/divider/sectionTitle/custom/panel/action），`visibleWhen` 谓词过滤。
- **`renderPreviewPanel(list, node, routers, ...)`**（core.ts）— 面板渲染四路互斥分派：① schemaBuilders（core 注册面板）② `renderAdapterPanelContent`（adapter 面板三通道衰退）③ `node.action`（动作节点）④ fillers（仅 roles）。
- **`buildPreviewMenuRouters(ctx, ...)`**（core.ts）— 构建面板路由表：`schemaBuilders`（lighting/shadow/postproc/settings/camera/environment 声明式 schema）、`fillers`（仅 roles）、`runners`（close）。
- **`PreviewMenuNode`**（node-types.ts）— 声明式菜单节点类型契约（纯类型叶，零运行时依赖）；`PreviewMenuNodeKind` 16 种节点类型；`PreviewControlSpec` 控件绑定规格。
- **`CORE_MENU_ITEMS` / `PREVIEW_MENU_GROUPS`**（defs.ts）— 核心菜单项（roles/environment/camera/lighting/shadow/postproc/settings）+ 底栏分组定义（model/motion/env/scene/settings）。
- **`renderAdapterPanelContent(list, node, deps)`**（render.ts）— adapter 面板内容三通道衰退：`schema-registry(schemaId)` → `children` → `renderCustom`。

## 对外 API / 入口

- `mountPreviewRootMenu(overlay: HTMLElement | ShadowRoot, ctx: PreviewMenuCtx): PreviewMenuHandle` — 挂载预览底部根菜单
- `renderMenu(container: HTMLElement, nodes: PreviewMenuNode[], deps: RenderMenuDeps): void` — 声明式菜单通用渲染器
- `renderPreviewPanel(list: HTMLElement, node: PreviewMenuNode, ...): void` — 单面板渲染（四路互斥分派）
- `buildPreviewMenuRouters(...): PreviewMenuRouters` — 构建面板路由表（导出供 preview-menu-health.test.ts 复用）
- `renderAdapterPanelContent(...): boolean` — adapter 面板内容三通道衰退
- `PreviewMenuHandle` — 根菜单句柄（`dispose` / `setAdapterItems` / `openPanel` / `refreshDock`）
- `PreviewMenuNode` / `PreviewMenuNodeKind` / `PreviewControlSpec` / `PreviewMenuCtx` / `PreviewActionMenuCtx` — 类型契约
- `CORE_MENU_ITEMS: PreviewMenuNode[]` / `PREVIEW_MENU_GROUPS: PreviewMenuGroupDef[]` — 核心菜单项与分组定义

## 与其他子系统关系

- **`ui/ui-slide-menu.ts` `createSlideMenu`** — SlideMenu 多层导航外壳（底部根菜单容器）。
- **`preview-3d/state/preview-state.ts` `previewSnapshot()`** — `visibleWhen` 谓词吃的状态层快照；dock 组过滤（`dockGroupItemsFor`）与内容级渲染共用同一求值器。
- **`preview-3d/caps/scene-capability.ts`** — cap 生态：`controls` 节点直持 `MenuControlDef[]`，渲染委托 `renderCapControls`（唯一控件渲染器）。
- **`preview-3d/adapters/schema-registry.ts`** — adapter 面板 schema 注册；`renderAdapterPanelContent` 第一通道查 `getSchema(node.schemaId)`。
- **`preview-3d/adapters/scene-registry.ts`** — 活跃角色详情（motion 组动态直达特例）。
- **`core/i18n/tr.ts`** — 菜单文案 i18n（`tr(node.labelKey, node.fallback)`）。
- **`utils/dom/fab.ts` / `utils/dom/focus-restore.ts`** — FAB 样式 + 输入阻断栈。
- **`preview-3d/overlay-style-bridge.ts`** — overlay 样式注入根（ADR-175 M1 目标切换重注入）。

## 不变量

- **菜单即数据**：新增/迁移菜单项写 `PreviewMenuNode` 数据即可，渲染逻辑不随菜单项膨胀。
- **visibleWhen 谓词统一**：dock 组过滤（`dockGroupItemsFor`）与内容级渲染（`renderMenu`）共用同一求值器，谓词吃 `previewSnapshot()` 状态层快照。
- **schemaId 必显式**：panel id 不再隐式兜底作 schema key（P5 复盘：id 撞注册键渲染错内容且无告警）。
- **fillers 仅 roles**：G3 删 fill* 后唯一残留；health.test 白名单守卫——禁止新增 filler。
- **renderCustom 末段逃生舱**：schemaId 未注册时走 renderCustom 会 console.warn 提示。
- **setAdapterItems id 冲突守卫**（ADR-085 S1）：重复 id 或与 CORE_MENU_ITEMS 冲突时抛错阻断。
- **motion 组动态直达唯一特例**：活跃角色 + 技能 → 直达动作详情；静态直达走 `directToPanel` 声明。

## 相关

- `docs/knowledge/preview-state.md`（状态层快照 + visibleWhen 谓词）
- `docs/knowledge/preview-controls.md`（cap 控件渲染）
- `docs/knowledge/ui-slide-menu.md`（SlideMenu 多层导航）
- `docs/knowledge/scene_capability_registry.md`（cap 生态）
