---
kind: preview-menu
name: 3D 预览声明式菜单 preview-menu
tier: architecture
adr:
  - ADR-132
  - ADR-195
category: rendering
source_files:
  - frontend/src/preview-3d/menu-node-types.ts
  - frontend/src/preview-3d/menu/core.ts
  - frontend/src/preview-3d/menu/render.ts
  - frontend/src/preview-3d/menu/node-types.ts
  - frontend/src/preview-3d/menu/cap-to-node.ts
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
    - buildRolesSchema
    - buildSettingsControls
    - buildSettingsSchema
    - buildShadowSchema
    - buildStatsPanel
    - buildSwitchNodes
    - canNodeRepresent
    - capControlsToNodes
    - capControlToNode
    - capControlToView
    - CapControlView
    - clearFolderCollapsedState
    - collectPreviewLeafNodes
    - collectPreviewNodeIds
    - collectSettingsCapControls
    - collectVisiblePredicates
    - CORE_MENU_ITEMS
    - corePanelBuilder
    - CorePanelId
    - disposeCustomCleanups
    - disposeEnvSubscriptions
    - formatCapSliderValue
    - hasSceneStats
    - isPreviewFolderNode
    - makeSwitchState
    - MenuControlDef
    - MenuControlKind
    - mergeStatsMenuItems
    - mountPreviewRootMenu
    - multiModelSelectNode
    - MultiModelSelectOpts
    - PREVIEW_MENU_GROUPS
    - PreviewActionMenuCtx
    - PreviewControlSpec
    - PreviewDockGroup
    - PreviewMenuCtx
    - PreviewMenuGroupDef
    - PreviewMenuGroupId
    - PreviewMenuHandle
    - PreviewMenuNode
    - PreviewMenuNodeKind
    - PreviewMenuRouters
    - renderAdapterPanelContent
    - renderCapColor
    - renderCapControls
    - renderCapControlSingle
    - renderCapDivider
    - renderCapSelect
    - renderCapSlider
    - renderCapToggle
    - renderMenu
    - renderPreviewPanel
    - roleBaseName
    - RolesSchemaDeps
    - STATS_PANEL_ID
    - switchNormPath
    - SwitchState
    - switchTabHighlightBg
    - unregisterCorePanelSchemas
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
- **`buildPreviewMenuRouters(ctx, ...)`**（core.ts）— 构建面板路由表：`schemaBuilders`（lighting/shadow/postproc/settings/camera/environment 声明式 schema）、`fillers`（仅 roles）。**ADR-193 第一刀（2026-09-06）**：camera 面板 renderCustom 退役——buildCameraSchema 改产出 select/slider/button 三声明式节点（control 闭包经 ctx.getCamBridge() 惰性取桥，持久化键 td-rot-mode/td-cam-speed 逐字对齐旧 buildCameraControls；buildCameraControls DOM 拼装器连同其测试已删，camera-controls.ts 只剩 CameraControlBridge 类型），renderCustom 构造点白名单 3→2（render-custom-audit 审计门收窄，剩 bones/env）。**第二刀（同日）**：§2.5 双注册合并——buildPreviewMenuRouters 把 core 六面板统一注册进 schema-registry（快照参数 core builder 不消费，透传 menu 兼容两级菜单分支），dualChannelDebt 清零；dispose 走 unregisterCorePanelSchemas 防陈旧 ctx 闭包跨会话污染；§2.4 收 key——schemaBuilders 类型收窄为 Record<CorePanelId,…>（拼错面板 id 编译期报错），运行时取值经 corePanelBuilder 守卫桥接。**第三刀（同日，UX 拍板：folder 内联展开）**：env 面板 renderEnvLevel 过程式渲染退役——buildEnvSchema 改产出 氛围预设 select（ENV_PRESET_LINKAGE 跨 cap 联动：sky+fog+envIntensity，与 environment cap 自报的 env-preset preset-thumb「仅切 envMap」职责不同非重复真值）+ 每 cap 一个 folder（多组 cap 组内嵌 folder，labelKey=group 键；controls 传函数引用惰性重取 getMenuControls+重分区，visibleWhen B 轨实时）；render.ts rmAppendFolder 增 folderOpenState 按 node.id 记忆用户开合态（cap 订阅驱动的 refresh 重建 DOM 不再重置展开）；renderCustom 构造点白名单 2→1（唯余 bones——§2.2 最终决策点）；env.test.ts 重写为 schema 契约。**第四刀（同日，node 模型最小扩展路线）**：roles 面板 fillers 过程式臂退役——buildRolesSchema 声明式（角色 row：radio 焦点钮/整行 action 经 actionCtx.navigate 下钻 modelDetailView/⚙ badge 工具；divider + switch 段），PreviewMenuRouters.fillers 字段物理删除（renderPreviewPanel 四路分派收敛两路）；switch 段（原 fillSwitch DOM 层）改声明式——类型 tab = select（mount 级 SwitchState 持 activeTab+候选缓存，异步 getModelsByType 数据就绪后 cache+menu.refresh 对齐 litematic 范式），候选 = row（action 替换/badge ➕ 追加）；机制扩展两处：PreviewActionMenuCtx 加可选 navigate 字段、row 节点加 radio/badge 可选槽位（rmAppendDynamicRow 渲染 + rm-row-active 活跃高亮 + row/sectionTitle 无 labelKey 时 fallback 直出）；roles 进 CorePanelId（七面板），menu-graph fillers 通道删除 → proceduralPanels/dualChannelDebt 双清零，**coverage:full 达成**（判定式自然翻转，非配置开关）断言（分派入口吃任意 node.id）、`runners`（close）。
- **`PreviewMenuNode`**（menu-node-types.ts 共享叶，ADR-195 刀2 自 menu/node-types.ts 下沉）— 声明式菜单节点类型契约；`PreviewMenuNodeKind` 17 种节点类型（ADR-195 增 `color`）；`PreviewControlSpec` 控件绑定规格——**ADR-195 起与 MenuControlDef 同构**（unit/onCommit/hintKey/variant/disabled/getHint 已并入，nodeControlToCapControl 反向纯搬运零损失，终态 MenuControlDef 类型名作废并入本接口）。**类型位置**：MenuControlDef/MenuControlKind + PreviewMenuNode/Kind/ControlSpec/ActionMenuCtx/dockGroup 全在共享叶 menu-node-types.ts（零依赖，只挂 state/preview-paths）；menu/node-types.ts re-export 保 30+ 消费者 + 留 PreviewMenuCtx（依赖 caps/adapters 真依赖）+ 3 值函数（isPreviewFolderNode/collectPreviewLeafNodes/collectPreviewNodeIds，纯运行时）。caps/* 直产 PreviewMenuNode[] 只依赖共享叶，不再反向 import menu/。`row` 节点支持 `headerToggle`（对齐 MikuMikuAR PopupRow.headerToggle）：「功能=本 folder/行」时能力总开关放行内/header 一眼可见、免展开即切换；`createHeaderToggle` 内置 stopPropagation，开关点击不触发整行 action（下钻）；声明后行/folder 内容区不得再含同源开关。
- **环境面板（buildEnvSchema）形态收口（2026）**：推翻 ADR-193 第三刀 folder 手风琴拍板，对齐 scene 组根视图 / roles / MikuMikuAR env 一级菜单——「行 + navigate 下钻」。一级 = 氛围预设 select + 每 cap 一行（`kind:"row"`：icon + label + 可选 headerToggle + `>` chevron），行 action 经 `actionCtx.navigate` 下钻到该 cap 参数子视图；二级子视图 **ADR-195 刀1 起经 `cap-to-node` 桥接（capControlsToNodes）转 PreviewMenuNode[] 走 renderMenu**——简单控件（toggle/slider/select/divider/color）映射原生节点（control spec 与 MenuControlDef 同构），复杂控件（timeline/histogram/image/preset-thumb/button）走 controls 节点通道（树内嵌 MenuControlDef 受控委托），group 转 folder 折叠。cap 能力总开关经 `SceneCapability.getMasterToggle()`（可选接口，fog/environment/reflector 实现）声明，envCapRow 据此把开关放行尾、子视图经 `envCapRestControls` 剔除同源控件（防双份）。sky/ground/water 无能力级开关 → 行无 headerToggle。render.ts `rmAppendDynamicRow` 扩展 headerToggle + action 无 badge 时行尾 chevron 槽位。
- **cap 控件单类型化（ADR-195，2026-09-06 刀1 落地、刀2 完成）**：架构真相——渲染层早已单源：节点 select/slider/toggle 经 `nodeControlToCapControl` 投影进 `renderCapControls`（rmAppendSelect/Slider/Toggle 已退役），唯一控件渲染器即 cap 栈；真正分裂的是**声明入口**（cap 的 `getMenuControls(): MenuControlDef[]` 平行数组 vs 节点树）。单类型终局 = 一个 schema（MenuNode[]）+ 一条渲染链（renderMenu → renderCapControls），MenuControlDef 字段并入 PreviewControlSpec 后类型名作废。刀序：刀0 渲染归属复位（button 收编 cap 渲染器、节点行/参数行视觉 token 统一）；刀1 `cap-to-node` 桥接：简单控件（toggle/slider/select/divider/color）映射原生节点（spec 同构），复杂控件（timeline/histogram/image/preset-thumb/button）走 controls 节点通道（受控委托，不触发 renderCustom 审计门），group → folder。**刀刃边界：桥接层不得产 renderCustom 构造点**（render-custom-audit 白名单唯余 bones——controls 通道是树内嵌 MenuControlDef 的受控委托，非手写 DOM 逃生舱）。**刀2（完成）逐 cap 直产节点**：全部 SceneCapability 实现 `getMenuNodes(): PreviewMenuNode[]`——纯声明层抽 `caps/*-menu.ts`（reflector/fog/shadow/render-mode/light/ground/water/sky/postprocessing/environment），复杂控件 cap 用 controls 通道节点（ground button / sky timeline / environment preset-thumb+image+histogram+button），settingsOrder 挂节点（PreviewMenuNode 增 `settingsOrder` 字段，settings 聚合双轨收集）；env/settings 消费者双轨（已迁移 cap 优先 getMenuNodes，未迁移 fallback 桥接）。getMenuControls 保留兼容待刀3 删。**刀2.5（兄弟补，刀3 前置）投影反转**：`nodeControlToCapControl` 反向投影是 MenuControlDef 类型最后的硬依赖，刀3 前须删（renderMenu 四分支改直吃 node.control spec），判据 `grep nodeControlToCapControl` 零命中。ADR-194（判别联合）已标被本 ADR 取代。
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
- **renderCustom cleanup 双持有者**（2026-09 生命周期收编）：`renderCustom` 返回 cleanup 后同时交给两方——① 渲染器（render.ts `runCustomMount` 按容器持有，重渲染前先清旧 / `disposeCustomCleanups` 菜单 dispose 全清）；② bones 的 `cleanupRef`（adapter.dispose 模型级兜底，摘挂 viewContainer 的 raycaster listener——模型卸载而菜单存活时唯一防线）。两者持同一函数，renderer 实现幂等，双清无害。**新增 renderCustom 逃生舱自动获得面板级生命周期，勿自搓 cleanupRef**；仅当 cleanup 跨面板存活（引用模型资源）时才需模型级兜底通道。
- **disposeCustomCleanups 只挂 dispose**：不可挂 `onOverlayStyleTargetReset`——该钩子每次 mount 都触发，而 cleanup 表是模块级共享，全清会误伤并行挂载会话仍存活的骨骼面板（listener 被摘而 DOM 仍在 → 拾取静默失效）。
- **setAdapterItems id 冲突守卫**（ADR-085 S1）：重复 id 或与 CORE_MENU_ITEMS 冲突时抛错阻断。
- **motion 组动态直达唯一特例**：活跃角色 + 技能 → 直达动作详情；静态直达走 `directToPanel` 声明。

## 相关

- `docs/knowledge/preview-state.md`（状态层快照 + visibleWhen 谓词）
- `docs/knowledge/preview-controls.md`（cap 控件渲染）
- `docs/knowledge/ui-slide-menu.md`（SlideMenu 多层导航）
- `docs/knowledge/scene_capability_registry.md`（cap 生态）
