---
kind: preview-menu
name: 3D 预览声明式菜单 preview-menu
tier: architecture
adr:
  - ADR-132
  - ADR-195
category: rendering
source_files:
  - frontend/src/preview-3d/menu/menu-node-types.ts
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
    - getEnvSectionCapIds
    - hasSceneStats
    - isPreviewFolderNode
    - makeSwitchState
    - mergeStatsMenuItems
    - mountPreviewRootMenu
    - multiModelSelectNode
    - MultiModelSelectOpts
    - nodeControlToView
    - PREVIEW_MENU_GROUPS
    - PreviewActionMenuCtx
    - PreviewControlDef
    - PreviewControlKind
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
  - frontend/src/preview-3d/infra/render-budget.test.ts
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
- **`renderMenu(container, nodes, deps)`**（render.ts）— 单一渲染器：按 `node.kind` 分派（folder/field/button/row/select/slider/toggle/material-row/controls/divider/sectionTitle/card/custom/panel/action），`visibleWhen` 谓词过滤。**形状前置（ADR-240 收敛，kind 形态脱钩）**：折叠判定 = `folder` **或** 带 `children` 的节点 **或** `hasFoldedBody`（`kind:"panel"` 且无 children 且带 renderCustom）——**内容型 panel（children 或 renderCustom）统一渲染为 `cap-folder` 折叠卡**，卡 body 内渲染内容（children → 递归 renderMenu；renderCustom → runCustomMount，cleanup 走注册表生命周期）；只有无内容面板渲染为可导航单行 `cm-row`（如 roles/environment/camera）。此前「renderCustom panel 在平铺场景渲染成单行」的行为由此统一为折叠卡，消同面板新旧样式混排（motion 详情的 bones/播放/感知曾割裂）。`kind:"custom"` 与 schema 面板路径（`renderAdapterPanelContent` renderCustomDirect）不经形状前置，不受影响。
- **`renderPreviewPanel(list, node, routers, ...)`**（core.ts）— 面板渲染四路互斥分派：① schemaBuilders（core 注册面板）② `renderAdapterPanelContent`（adapter 面板三通道衰退）③ `node.action`（动作节点）④ fillers（仅 roles）。
- **`buildPreviewMenuRouters(ctx, ...)`**（core.ts）— 构建面板路由表：`schemaBuilders`（lighting/shadow/postproc/settings/camera/environment 声明式 schema）、`fillers`（仅 roles）。**ADR-193 第一刀（2026-09-06）**：camera 面板 renderCustom 退役——buildCameraSchema 改产出 select/slider/button 三声明式节点（control 闭包经 ctx.getCamBridge() 惰性取桥，持久化键 td-rot-mode/td-cam-speed 逐字对齐旧 buildCameraControls；buildCameraControls DOM 拼装器连同其测试已删，camera-controls.ts 只剩 CameraControlBridge 类型），renderCustom 构造点白名单 3→2（render-custom-audit 审计门收窄，剩 bones/env）。**第二刀（同日）**：§2.5 双注册合并——buildPreviewMenuRouters 把 core 六面板统一注册进 schema-registry（快照参数 core builder 不消费，透传 menu 兼容两级菜单分支），dualChannelDebt 清零；dispose 走 unregisterCorePanelSchemas 防陈旧 ctx 闭包跨会话污染；§2.4 收 key——schemaBuilders 类型收窄为 Record<CorePanelId,…>（拼错面板 id 编译期报错），运行时取值经 corePanelBuilder 守卫桥接。**第三刀（同日，UX 拍板：folder 内联展开）**：env 面板 renderEnvLevel 过程式渲染退役——buildEnvSchema 改产出 氛围预设 select（ENV_PRESET_LINKAGE 跨 cap 联动：sky+fog+envIntensity，与 environment cap 自报的 env-preset preset-thumb「仅切 envMap」职责不同非重复真值）+ 每 cap 一个 folder（多组 cap 组内嵌 folder，labelKey=group 键；controls 传函数引用惰性重取 getMenuControls+重分区，visibleWhen B 轨实时）；render.ts rmAppendFolder 增 folderOpenState 按 node.id 记忆用户开合态（cap 订阅驱动的 refresh 重建 DOM 不再重置展开）；renderCustom 构造点白名单 2→1（唯余 bones——§2.2 最终决策点）；env.test.ts 重写为 schema 契约。**第四刀（同日，node 模型最小扩展路线）**：roles 面板 fillers 过程式臂退役——buildRolesSchema 声明式（角色 row：radio 焦点钮/整行 action 经 actionCtx.navigate 下钻 modelDetailView/⚙ badge 工具；divider + switch 段），PreviewMenuRouters.fillers 字段物理删除（renderPreviewPanel 四路分派收敛两路）；switch 段（原 fillSwitch DOM 层）改声明式——类型 tab = select（mount 级 SwitchState 持 activeTab+候选缓存，异步 getModelsByType 数据就绪后 cache+menu.refresh 对齐 litematic 范式），候选 = row（action 替换/badge ➕ 追加）；机制扩展两处：PreviewActionMenuCtx 加可选 navigate 字段、row 节点加 radio/badge 可选槽位（rmAppendDynamicRow 渲染 + rm-row-active 活跃高亮 + row/sectionTitle 无 labelKey 时 fallback 直出）；roles 进 CorePanelId（七面板），menu-graph fillers 通道删除 → proceduralPanels/dualChannelDebt 双清零，**coverage:full 达成**（判定式自然翻转，非配置开关）断言（分派入口吃任意 node.id）、`runners`（close）。
- **`PreviewMenuNode`**（menu-node-types.ts 共享叶，ADR-195 刀2 自 menu/node-types.ts 下沉）— 声明式菜单节点类型契约；`PreviewMenuNodeKind` 17 种节点类型（ADR-195 增 `color`）；`PreviewControlSpec` 控件绑定规格——**ADR-195 起与 MenuControlDef 同构**（unit/onCommit/hintKey/variant/disabled/getHint 已并入，nodeControlToCapControl 反向纯搬运零损失，终态 MenuControlDef 类型名作废并入本接口）。**类型位置**：MenuControlDef/MenuControlKind + PreviewMenuNode/Kind/ControlSpec/ActionMenuCtx/dockGroup 全在共享叶 menu-node-types.ts（零依赖，只挂 state/preview-paths）；menu/node-types.ts re-export 保 30+ 消费者 + 留 PreviewMenuCtx（依赖 caps/adapters 真依赖）+ 3 值函数（isPreviewFolderNode/collectPreviewLeafNodes/collectPreviewNodeIds，纯运行时）。caps/* 直产 PreviewMenuNode[] 只依赖共享叶，不再反向 import menu/。`row` 节点支持 `headerToggle`（对齐 MikuMikuAR PopupRow.headerToggle）：「功能=本 folder/行」时能力总开关放行内/header 一眼可见、免展开即切换；`createHeaderToggle` 内置 stopPropagation，开关点击不触发整行 action（下钻）；声明后行/folder 内容区不得再含同源开关。**直达平铺面板（scene 组：shadow/postproc/light）**——light 2026 补 light-enabled（原缺：面板首行仅 light-key 主灯参数开关，无「一键关整灯系统」入口）。**2026 长治久安：light/shadow/postproc 统一进 getMasterNodeId 单一来源契约**（enabled/visible 总开关 id）——`getMenuNodes()` 仍产完整树（含总开关首行），但**直达面板渲染经 `capPanelNodes`（settings.ts）按 getMasterNodeId filter 掉总开关**、场景组根视图经 `SCENE_CAP_FOR_PANEL`（core.ts，仅 panelId→capId 桥，照明→light/阴影→shadow/后处理→postprocessing）解析 cap 后凭 `cap.getMasterNodeId?.()` 是否存在给 headerToggle——**是否给开关的唯一真值源 = cap 声明 getMasterNodeId**，与 env 面板环境 6 cap 同契；`getMasterNodeId` 三消费方（env 子视图剔除 / 场景组 root headerToggle / 直达面板 filter / 合一）。**camera 无对应 cap 不声明 → 自然无开关**（视口=不可关，关闭=黑屏）。旧 `makePreviewMenuRow`（cm-row）仅剩 roles/motion 面板行，不再承载 headerToggle。导航行样式唯一实现 = renderMenu `.slide-item`（rmMakeRowBase），禁旁路自建行样式。**大统一**：场景组根视图与 env 面板一级共用同一套 `.slide-item.rm-row-compact` 导航行组件（rmAppendDynamicRow），样式零分歧。设计通则：**能关的功能才有一级总开关，视口/不可关功能不硬塞开关；删开关 = 删 getMasterNodeId 声明，数据驱动、无旁路硬编码。**
- **环境面板（buildEnvSchema）形态收口（2026）**：推翻 ADR-193 第三刀 folder 手风琴拍板，对齐 scene 组根视图 / roles / MikuMikuAR env 一级菜单——「行 + navigate 下钻」。一级 = 氛围预设 select + 每 cap 一行（`kind:"row"`：icon + label + 可选 headerToggle + `>` chevron），行 action 经 `actionCtx.navigate` 下钻到该 cap 参数子视图；二级子视图 **ADR-195 刀1 起经 `cap-to-node` 桥接（capControlsToNodes）转 PreviewMenuNode[] 走 renderMenu**——简单控件（toggle/slider/select/divider/color）映射原生节点（control spec 与 MenuControlDef 同构），复杂控件（timeline/histogram/image/preset-thumb/button）走 controls 节点通道（树内嵌 MenuControlDef 受控委托），group 转 folder 折叠。cap 能力总开关经 `SceneCapability.getMasterNodeId()`（可选接口，sky/fog/environment/ground/water/reflector 全部实现=6 cap 全报）声明，envCapRow 据此把开关放行尾、子视图经 `envCapSubNodes` 剔除同源控件（防双份）。守卫：env.test.ts 守护测试遍历 6 env cap 断言 prototype 必声明 getMasterNodeId + master id 集合完整（防漏声明→一级默默无开关）。最新：sky 原被注释为「无能力级开关」行无 headerToggle——实则有 isEnabled/setEnabled 真总开关（enabled 已被持久化），2026 补齐 `sky-enabled` + getMasterNodeId 后环境一级天空行尾即切。ground-visible / ground-water-enabled / sky-enabled 属「能力主开关」升级一行可切，与 fog/reflector 同构。render.ts `rmAppendDynamicRow` 扩展 headerToggle + action 无 badge 时行尾 chevron 槽位。
- **环境面板卡牌分段（2026-09-10）**：一级 cap 行不再平铺一长列，按语义聚拢进 `kind:"card"` 卡壳（顶行标题 + 分隔线 + 内容区，**不可折叠**）。分段表 `ENV_SECTIONS`（env.ts，单一事实源）：基础 = sky/ground/water、氛围 = environment/fog/reflector；未登记 cap 落末尾「其它」卡，空段/全隐段（visibleWhen 预筛）不建空卡壳。**与 folder 分工**：folder 管「可收放的参数组」（二级子视图内），card 管「同级导航行的语义聚拢」（一级）。渲染器 `rmAppendCard`——**分派时 card 必须先于 folder 判定**：card 同样带 children，否则被 renderMenu「带 children 即按可折叠 section 渲染」分支吞掉、卡壳丢失。样式 `MENU_CARD_CSS` 在 menu-styles.ts（菜单样式经 overlay 样式桥注入 ShadowRoot，全局 CSS 不穿透；原 `ui/ui-card.ts` 的 `.lcard` 全仓无 DOM 产出方（2026-09-10 连模块与 orphan 样式一并删除），故不复用）。
- **cap 控件单类型化（ADR-195，2026-09-06 刀1 落地、刀2 完成）**：架构真相——渲染层早已单源：节点 select/slider/toggle 经 `nodeControlToCapControl` 投影进 `renderCapControls`（rmAppendSelect/Slider/Toggle 已退役），唯一控件渲染器即 cap 栈；真正分裂的是**声明入口**（cap 的 `getMenuControls(): MenuControlDef[]` 平行数组 vs 节点树）。单类型终局 = 一个 schema（MenuNode[]）+ 一条渲染链（renderMenu → renderCapControls），MenuControlDef 字段并入 PreviewControlSpec 后类型名作废。刀序：刀0 渲染归属复位（button 收编 cap 渲染器、节点行/参数行视觉 token 统一）；刀1 `cap-to-node` 桥接：简单控件（toggle/slider/select/divider/color）映射原生节点（spec 同构），复杂控件（timeline/histogram/image/preset-thumb/button）走 controls 节点通道（受控委托，不触发 renderCustom 审计门），group → folder。**刀刃边界：桥接层不得产 renderCustom 构造点**（render-custom-audit 白名单唯余 bones——controls 通道是树内嵌 MenuControlDef 的受控委托，非手写 DOM 逃生舱）。**刀2（完成）逐 cap 直产节点**：全部 SceneCapability 实现 `getMenuNodes(): PreviewMenuNode[]`——纯声明层抽 `caps/*-menu.ts`（reflector/fog/shadow/render-mode/light/ground/water/sky/postprocessing/environment），复杂控件 cap 用 controls 通道节点（ground button / sky timeline / environment preset-thumb+image+histogram+button），settingsOrder 挂节点（PreviewMenuNode 增 `settingsOrder` 字段，settings 聚合双轨收集）；env/settings 消费者双轨（已迁移 cap 优先 getMenuNodes，未迁移 fallback 桥接）。getMenuControls 保留兼容待刀3 删。**刀2.5（完成）投影反转**：删 `nodeControlToCapControl`（MenuControlDef 在 renderMenu 的最后硬依赖）——cap-controls 五简单控件渲染（Divider/Toggle/Slider/Select/Color）改吃统一 `CapControlView`（MenuControlDef 读取子集），render.ts 四分支经内部 `nodeControlToView`（spec→view，bind/get/set/onChange/refreshOnChange/numeric/unit/onCommit 全保留）直调 cap 渲染器；settings 聚合全节点化（collectSettingsCapControls/buildSettingsControls 返回 `PreviewMenuNode[]`，schema 展开节点，controls 通道于 settings 退役）。`renderCapControls`/`renderCapControlSingle` 的 switch 暂保留简单 kind（经 view 适配）。**刀3（完成，2026-09-07 走法乙）类型更名收敛**：`MenuControlDef`→`PreviewControlDef`、`MenuControlKind`→`PreviewControlKind`（字段原样，渲染形态零变、不碰 render-custom 审计门）——两类型名全仓归零，控件声明单类型化（简单控件走 PreviewMenuNode.control/PreviewControlSpec，复杂控件走 controls 通道/PreviewControlDef，同一 cap 栈渲染）；`getMenuControls` 接口同时退役。判据：`grep MenuControlDef` 零命中（仅历史注释）。ADR-194（判别联合）已标被本 ADR 取代。
- **`PreviewMenuNode.fallback` 退役 → `label`（回退标准统一归 i18n）**：原 `fallback` 字段被删，回退标准**只允许 i18n `tOf` 制定**（当前语言包 → FALLBACK_LANG=en → 裸 key + warnMissingKey 三级兜底）；动态节点的明文显示名改走显式 `label` 字段（无 i18n 键、值即运行期数据，如形态名/材质名/角色名/switch 候选文件名）。根源腐蚀点 `rmLabel`（render.ts）统一为 `labelKey ? tOf(labelKey) : (label ?? node.id)`。分类迁移：① 有真实 i18n labelKey 的确定性节点 → 删冗余 fallback；② 无 labelKey 的运行时数据节点 → `fallback` 改 `label`。`PreviewControlDef.fallback`（cap-controls 层 Schema 必填字段）**保留不动**——与 MenuNode 层隔离，桥接处 `cap-to-node.ts | capControlToNode` 仅把 `c.fallback` 落在 `node.label`。守卫：`core.test.ts` 断言 CORE_MENU_ITEMS 不得再含 fallback 字段；`items.test.ts` 非 divider 项断言 `labelKey || label` 有值。
- **[2026-09 雾气锐评收口] select 选项支持 `labelKey`（i18n，取代硬编码中文）**：`PreviewControlDef.select` / `PreviewControlSpec.options` / `CapControlView.select` 的选项类型由 `{value,label}` 扩为 `{value,label,labelKey?}`（`render.ts:544` 对 options 直透传，故三处类型加字段即全链路生效）；`renderCapSelect` 落位改 `opt.labelKey ? tOf(opt.labelKey) : opt.label`——`label` 降级为「i18n 缺键 / 动态项」回退。首用例 = fog 雾型选项（`preview.fogModeLinear` / `preview.fogModeExp2`）。**遗留债**：water / ground / postprocessing 的 options 仍硬编码中文（`{value:"film",label:"薄膜"}` 等），该债已于同日清零——water / ground（来源·样式·叠加三轴）/ postprocessing（色彩映射 + 反射模式）/ render-mode（混合 + 面剔除）/ shadow（贴图尺寸）/ light（模型预设）/ camera（旋转模式）/ litematic（切片模式）全部 select options 已带 `labelKey`（各自显式注解的常量类型同步加 `labelKey?: string`）；`preset-thumb` 的 `thumb.options` 同批扩 `labelKey`（`renderCapPresetThumb` 的 `img.alt` / `span.textContent` 同口径），环境预设缩略图复用 `preview.presetQuick*`（与 env 面板快捷预设文案恒等）。
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
- **`preview-3d/caps/scene-capability.ts`** — cap 生态：`controls` 节点直持 `PreviewControlDef[]`，渲染委托 `renderCapControls`（唯一控件渲染器）。
- **`preview-3d/infra/schema-registry.ts`** — adapter 面板 schema 注册；`renderAdapterPanelContent` 第一通道查 `getSchema(node.schemaId)`。
- **`preview-3d/infra/scene-registry.ts`** — 活跃角色详情（motion 组动态直达特例）。
- **`core/i18n/t.ts`** — 菜单文案 i18n（`tOf(node.labelKey)` 多级兜底；原 `core/i18n/tr.ts` 双入口随 ADR-210 D3 根除）。
- **`utils/dom/fab.ts` / `utils/dom/focus-restore.ts`** — FAB 样式 + 输入阻断栈。
- **`preview-3d/infra/overlay-style-bridge.ts`** — overlay 样式注入根（ADR-175 M1 目标切换重注入）。

## 不变量

- **菜单即数据**：新增/迁移菜单项写 `PreviewMenuNode` 数据即可，渲染逻辑不随菜单项膨胀。
- **visibleWhen 谓词统一**：dock 组过滤（`dockGroupItemsFor`）与内容级渲染（`renderMenu`）共用同一求值器，谓词吃 `previewSnapshot()` 状态层快照。
- **schemaId 必显式**：panel id 不再隐式兜底作 schema key（P5 复盘：id 撞注册键渲染错内容且无告警）。
- **fillers 通道已退役**（ADR-193 第四刀）：roles 迁 `schemaBuilders` 声明式后 filler 过程式臂删除，`routers` 上不再有 `fillers` 字段，`proceduralPanels` 恒空。新增面板只有 schemaBuilders / schema-registry / children 三条声明式通道（旧「schema / fillers / runners 三级衰退链」表述已过期）。
- **renderCustom 末段逃生舱**：schemaId 未注册时走 renderCustom 会 console.warn 提示。**唯一在册构造点 = bones**（ADR-193 §2.2② 拍板的永久例外，camera/env 退役后唯余此项）——名单**单一事实源 = `menu/sanctioned.ts|SANCTIONED_PROCEDURAL_PANELS`**，由两处共同消费：审计门（`adapters/render-custom-audit.test.ts`，生产源码「`renderCustom`+冒号」构造点须与名单**逐一相等**）与导航图报告（`collectMenuGraph().sanctionedProcedural`，兑现 §3「不可静默」——报告不再一边宣称 `coverage:"full"` 一边对已豁免的手写 DOM 面板只字不提）。**新增例外须先 code review 拍板并把条目（id/decidedBy/rationale）写进该表**，不得只在测试白名单或注释里挂单（审计门会抓裸加）。⚠️ bones 由 adapter 注入 `menuItems`，不经 collectMenuGraph 的三通道枚举，故 `escapeHatch` 标记对它永不触发——`sanctionedProcedural` 是它唯一的显式曝光面。
- **renderCustom cleanup 双持有者**（2026-09 生命周期收编）：`renderCustom` 返回 cleanup 后同时交给两方——① 渲染器（render.ts `runCustomMount` 按容器持有，重渲染前先清旧 / `disposeCustomCleanups` 菜单 dispose 全清）；② bones 的 `cleanupRef`（adapter.dispose 模型级兜底，摘挂 viewContainer 的 raycaster listener——模型卸载而菜单存活时唯一防线）。两者持同一函数，renderer 实现幂等，双清无害。**新增 renderCustom 逃生舱自动获得面板级生命周期，勿自搓 cleanupRef**；仅当 cleanup 跨面板存活（引用模型资源）时才需模型级兜底通道。
- **disposeCustomCleanups 只挂 dispose**：不可挂 `onOverlayStyleTargetReset`——该钩子每次 mount 都触发，而 cleanup 表是模块级共享，全清会误伤并行挂载会话仍存活的骨骼面板（listener 被摘而 DOM 仍在 → 拾取静默失效）。
- **setAdapterItems id 冲突守卫**（ADR-085 S1）：重复 id 或与 CORE_MENU_ITEMS 冲突时抛错阻断。
- **dock 一级路由声明化（ADR-241）**：点击路由由 `PREVIEW_MENU_GROUPS` 数据表显式声明，`renderPreviewDock` 纯查表（directToPanel → directViewKey → rootView → 兜底 makeGroupViewFn），无 `g.id === ...` 字面量。model/env/settings → `directToPanel` 静态直达；motion → `directViewKey:"motion"` 动态工厂（活跃角色详情，directToPanel 表达不了）；scene → `rootView:true` renderMenu 组根视图。`motion` 的 key→工厂映射仍在 core.ts（需注入 sceneRegistry/详情工厂），是多态路由表而非 id 特判。
- **`dockGroup` 已是归属域单源，勿再改名 `navDomain`**（2026-09 复核证伪）：`dockGroup`（`PreviewDockGroup` = dock 组 ∪ `"stats"` 统计通道）是静态类型化声明字段，为 dock→panel 投影唯一真值源；`menu-graph.ts`（ADR-128）已把它投影成静态可机验导航图。改名是零增益 churn。`roles-views.ts` 的 `dockGroup === "model"|"motion"` 运行时过滤对象是**per-model 实例注入 panel**（适配器按模型类型产出），属本质运行时数据，无法静态化（MikuMikuAR 同样 per-model 运行时构建）。
- **同一参数不得声明两条控件（sky 时间轴复盘，2026-09）**：`caps/sky-menu.ts|buildSkyNodes` 曾同时声明 `sky-timeline`（timeline 复杂控件，走 `controls` 通道）与 `sky-time`（slider 原生节点），二者**同源同槽**——读写都落在 `caps/sky-capability.ts|SkyCapability.getTimeOfDay` / `setTime`，行为上天然同步、不会打架，但 UI 冗余且诱发「这俩是不是一个意思」的误解。根因是 ADR-195 刀2 迁移时按「控件 kind 分流」（复杂→controls 通道、简单→原生节点）**各声明了一遍**，两条通道互不知情。**已删 `sky-time` slider**，`timeOfDay` 唯一控件 = timeline（自带 `HH:MM` 读数 + 指针拖动 + 触屏，精度远高于原 0.5h 步进；`menu/cap-controls.ts|renderCapTimeline`）。**新增 cap 控件时先查同 cap 内是否已有同 `get/set` 目标的控件**——kind 分流是渲染层实现细节，不该外溢成声明层的重复。
  - 注意区分三个「时间」：天空 time-of-day（本卡）／动画播放进度（`model/ysm-animation-player.ts|executeTimeline`，Molang 时间轴事件）／昼夜自动循环开关（`sky-auto-rotate`，按真实时间推进 timeOfDay）。名字相像，语义无关。
- **动作/模型组一级卡壳收纳（ADR-242）**：`modelDetailView`/`motionDetailView` 一级改为 `kind:"card"`(collapsible) 卡壳 + 面板**入口行 array**（`panelEntryRow`：`kind:"row"` + icon + label + `rowDensity:"compact"` + `action: ctx.navigate(makePanelView(item))`），照抄 env `envCapRow` 范式——**内容仅在 navigate 到次级菜单后渲染**，骨骼/表情/材质等巨多内容不再一级内联铺开（与环境组形态统一：环境有收纳，动作也有）。骨骼二级仍走 `makeBonePanelRenderer` 逃生舱（动态树 + 跨域拾取，schema 化 ROI 为负）；表情/材质二级仍走既有声明式 children。入口行 testid 形如 `preview-motion-entry-<id>` / `preview-model-entry-<id>`（row testid 统一 `preview-` 前缀）。此决策部分推翻 ADR-240 的「renderCustom 内容内联进卡 body」做法（视觉统一保留，内联内容改跳转入口）。

- **行内按钮样式单源（`MENU_BTN_CSS`）**：`render.ts` 的 radio/badge 与 cap 控件共用 `.cc-btn` 族，规则住在 `menu-styles.ts|MENU_BTN_CSS`，行/控件两条渲染路径**各自插值**——不可只让 cap 栈注入（`ensureCapStyles()` 唯一调用点是 `renderCapControls()`）：纯 row 面板（roles 角色列表，不渲染任何 cap 控件）拿不到规则 ⇒ `<button>` 回落 UA 默认**不透明白底 + 2px 黑框**（2026-09-16 实测 `background=rgb(240,240,240)`、`box 21×20`）。守卫：`menu-styles.test.ts`（常量内容 + 两消费方真插值）+ `roles.test.ts` 断言菜单样式表含 `.cc-btn-ghost`。
- **row 槽位图标走语义名（ADR-238）**：`radio` 渲染 `radioOn`（外环+圆心）/`radioOff`（空环）SVG 图标，`badge.icon` 为 `IconRef`（roles 工具=`tools`、switch 追加=`add`）——不再用 `●/○/⚙/➕` 字形拼凑（几何随字体漂移，且 `.cc-btn-ghost` 的圆角矩形边框被误当「外圈」）。激活色用**双类锚定** `.rm-radio-btn.row-radio-active`（同为单类时后者胜，曾把 accent 吃掉）；按钮本体 18px 正圆、无边框、透明底（`.rm-radio-btn`）。
- **调试日志门控（2026-09）**：菜单装配与渲染关键路径经 `utils/debug/debug.ts|dbg()` 打点，统一 tag `preview-menu`（`mountPreviewRootMenu` 的 mount/shell built/routers built/adapter items update/open panel/disposed）与 `preview-menu-render`（`renderMenu` 的 start/每节点 rendering node/complete）。复用全局 dbg 机制：`?nodebug=1` 全局关闭，日志进 `window._DBG_RING` 环形缓冲（排查「某节点没渲染出来」先看 rendering node 是否含目标 id，再查其 `visibleWhen`）。**调试日志用完即删是 AGENTS.md 通则，本处为常驻诊断锚点非临时打点。**
## 相关

- `docs/preview-menu-overview.md`（3D 预览菜单系统全景图：分层架构 + 数据流 + ADR 索引 + 调试指南 + 快速上手）

- `docs/knowledge/preview-state.md`（状态层快照 + visibleWhen 谓词）
- `docs/knowledge/preview-controls.md`（cap 控件渲染）
- `docs/knowledge/ui-slide-menu.md`（SlideMenu 多层导航）
- `docs/knowledge/scene_capability_registry.md`（cap 生态）
