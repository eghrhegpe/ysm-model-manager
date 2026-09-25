---
kind: preview-menu
name: 3D 预览声明式菜单 preview-menu
tier: architecture
adr:
  - ADR-132
  - ADR-195
  - ADR-276
  - ADR-305
category: rendering
source_files:
  - frontend/src/preview-3d/menu/schema/menu-node-types.ts
  - frontend/src/preview-3d/menu/engine/core.ts
  - frontend/src/preview-3d/menu/render/render.ts
  - frontend/src/preview-3d/menu/schema/node-types.ts
  - frontend/src/preview-3d/menu/engine/defs.ts
  - frontend/src/preview-3d/menu/render/cap-controls.ts
  - frontend/src/preview-3d/menu/engine/sanctioned.ts
  - frontend/src/utils/base/pure/label.ts
  - frontend/src/preview-3d/menu/panels/env.ts
  - frontend/src/preview-3d/menu/panels/roles.ts
  - frontend/src/preview-3d/menu/panels/settings.ts
  - frontend/src/preview-3d/menu/panels/stats.ts
  - frontend/src/preview-3d/menu/shell/switch.ts
  - frontend/src/preview-3d/menu/panels/multi-model.ts
auto_fields:
  symbols_with_lines:
    - AssertCommonFieldIsExact
    - buildCameraSchema
    - buildCrossCuttingNodes
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
    - CapControlView
    - capLabel
    - clearFolderCollapsedState
    - collectPreviewLeafNodes
    - collectPreviewNodeIds
    - collectSettingsCapControls
    - collectSettingsCapSections
    - collectVisiblePredicates
    - COMMON_NODE_FIELDS
    - CORE_MENU_ITEMS
    - corePanelBuilder
    - CorePanelId
    - disposeCustomCleanups
    - disposeEnvSubscriptions
    - disposeSceneCapSubscriptions
    - formatCapSliderValue
    - hasSceneStats
    - isPreviewFolderNode
    - KIND_SPECIFIC_FIELDS
    - LabelSource
    - makeSwitchState
    - mergeStatsMenuItems
    - mountPreviewRootMenu
    - multiModelSelectNode
    - MultiModelSelectOpts
    - nodeControlToView
    - NodeFor
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
    - renderCapSelect
    - renderCapSlider
    - renderCapToggle
    - renderMenu
    - renderPreviewPanel
    - resolveLabel
    - roleBaseName
    - RolesSchemaDeps
    - SANCTIONED_PROCEDURAL_PANELS
    - SanctionedProceduralPanel
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
  - frontend/src/preview-3d/menu/schema/node-types.test.ts
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
  - frontend/src/preview-3d/menu/engine/core.ts|mountPreviewRootMenu
  - frontend/src/preview-3d/menu/engine/core.ts|buildPreviewMenuRouters
  - frontend/src/preview-3d/menu/render/render.ts|renderMenu
  - frontend/src/preview-3d/menu/render/render.ts|renderAdapterPanelContent
  - frontend/src/preview-3d/menu/schema/node-types.ts|PreviewMenuNode
  - frontend/src/preview-3d/menu/engine/defs.ts|CORE_MENU_ITEMS
  - frontend/src/preview-3d/menu/engine/defs.ts|PREVIEW_MENU_GROUPS
status: active
---

# 3D 预览声明式菜单 preview-menu

## 概览

3D 预览底部根菜单的声明式菜单系统（ADR-076 v3）。对齐 MikuMikuAR 范式：底部根按钮 → `createSlideMenu` 多层导航。菜单即数据——`PreviewMenuNode` 树 + `visibleWhen: (s: PreviewSnapshot) => boolean` 谓词驱动；单一渲染器 `renderMenu()` 递归渲染整棵树。能力驱动 dock 按钮显隐（有模型/骨骼项 → 🧍 角色；有动作/播放项 → 💃 动作；有环境能力 → 🌍 环境；有场景/相机能力 → 🎛️ 场景）。

与 AGENTS.md 红线对齐：**3D 菜单只允许 visibleWhen 谓词，禁止手写 3D 菜单**；新增 UI 功能必须可被所有数组类菜单调用。

## 核心职责

- **`mountPreviewRootMenu(overlay, ctx): PreviewMenuHandle`**（core.ts）— 主入口：装配 dock + popup + SlideMenu 外壳 → 构建面板路由表 → 渲染 dock → 绑定 tap 识别。返回句柄（`dispose` / `setAdapterItems` / `openPanel` / `refreshDock`）。
- **`renderMenu(container, nodes, deps)`**（render.ts）— 单一渲染器：按 `node.kind` 分派（folder/field/button/row/select/slider/toggle/material-row/controls/divider/sectionTitle/note/card/custom/panel/action），`visibleWhen` 谓词过滤。**形状前置（ADR-240 收敛，kind 形态脱钩）**：折叠判定 = `folder` **或** 带 `children` 的节点 **或** `hasFoldedBody`（`kind:"panel"` 且无 children 且带 renderCustom）——**内容型 panel（children 或 renderCustom）统一渲染为 `cap-folder` 折叠卡**，卡 body 内渲染内容（children → 递归 renderMenu；renderCustom → runCustomMount，cleanup 走注册表生命周期）；只有无内容面板渲染为可导航单行 `cm-row`（如 roles/environment/camera）。此前「renderCustom panel 在平铺场景渲染成单行」的行为由此统一为折叠卡，消同面板新旧样式混排（motion 详情的 bones/播放/感知曾割裂）。`kind:"custom"` 与 schema 面板路径（`renderAdapterPanelContent` renderCustomDirect）不经形状前置，不受影响。**分派实现（2026-09-19 复杂度收口）**：形状前置抽成 `appendFoldedShape`（复用 `isPreviewFolderNode`），kind 分派由 14 段 switch 改表驱动 `MENU_HANDLERS: Record<PreviewMenuNodeKind, MenuHandler>`——renderMenu 认知复杂度 73🟥→绿。穷尽守卫从 switch `default: never` 迁为非 Partial Record（联合新增 kind 漏写编译期 TS2741 报错）+ 运行期 undefined 兜底（伪造 kind 落 `rmAppendLeaf` 行壳并 warn，防 TypeError；`node-render.test.ts` 有 `color` 分派 + 未知 kind 兜底两用例锁此语义）。
- **`renderPreviewPanel(list, node, routers, ...)`**（core.ts）— 面板渲染四路互斥分派：① schemaBuilders（core 注册面板）② `renderAdapterPanelContent`（adapter 面板三通道衰退）③ `node.action`（动作节点）④ fillers（仅 roles）。
- **`buildPreviewMenuRouters(ctx, ...)`**（core.ts）— 构建面板路由表：`schemaBuilders`（lighting/shadow/postproc/settings/camera/environment 声明式 schema）、`fillers`（仅 roles）。**ADR-193 第一刀（2026-09-06）**：camera 面板 renderCustom 退役——buildCameraSchema 改产出 select/slider/button 三声明式节点（control 闭包经 ctx.getCamBridge() 惰性取桥，持久化键 td-rot-mode/td-cam-speed 逐字对齐旧 buildCameraControls；buildCameraControls DOM 拼装器连同其测试已删，camera-controls.ts 只剩 CameraControlBridge 类型），renderCustom 构造点白名单 3→2（render-custom-audit 审计门收窄，剩 bones/env）。**第二刀（同日）**：§2.5 双注册合并——buildPreviewMenuRouters 把 core 六面板统一注册进 schema-registry（快照参数 core builder 不消费，透传 menu 兼容两级菜单分支），dualChannelDebt 清零；dispose 走 unregisterCorePanelSchemas 防陈旧 ctx 闭包跨会话污染；§2.4 收 key——schemaBuilders 类型收窄为 Record<CorePanelId,…>（拼错面板 id 编译期报错），运行时取值经 corePanelBuilder 守卫桥接。**第三刀（同日，UX 拍板：folder 内联展开）**：env 面板 renderEnvLevel 过程式渲染退役——buildEnvSchema 改产出 氛围预设 select（ENV_PRESET_LINKAGE 跨 cap 联动：sky+fog+envIntensity，与 environment cap 自报的 env-preset preset-thumb「仅切 envMap」职责不同非重复真值）+ 每 cap 一个 folder（多组 cap 组内嵌 folder，labelKey=group 键；controls 传函数引用惰性重取 getMenuControls+重分区，visibleWhen B 轨实时）；render.ts rmAppendFolder 增 folderOpenState 按 node.id 记忆用户开合态（cap 订阅驱动的 refresh 重建 DOM 不再重置展开）；renderCustom 构造点白名单 2→1（唯余 bones——§2.2 最终决策点）；env.test.ts 重写为 schema 契约。**第四刀（同日，node 模型最小扩展路线）**：roles 面板 fillers 过程式臂退役——buildRolesSchema 声明式（角色 row：radio 焦点钮/整行 action 经 actionCtx.navigate 下钻 modelDetailView/⚙ badge 工具；divider + switch 段），PreviewMenuRouters.fillers 字段物理删除（renderPreviewPanel 四路分派收敛两路）；switch 段（原 fillSwitch DOM 层）改声明式——类型 tab = select（mount 级 SwitchState 持 activeTab+候选缓存，异步 getModelsByType 数据就绪后 cache+menu.refresh 对齐 litematic 范式），候选 = row（action 替换/badge ➕ 追加）；机制扩展两处：PreviewActionMenuCtx 加可选 navigate 字段、row 节点加 radio/badge 可选槽位（rmAppendDynamicRow 渲染 + rm-row-active 活跃高亮 + row/sectionTitle 无 labelKey 时 fallback 直出）；roles 进 CorePanelId（七面板），menu-graph fillers 通道删除 → proceduralPanels/dualChannelDebt 双清零，**coverage:full 达成**（判定式自然翻转，非配置开关）断言（分派入口吃任意 node.id）、`runners`（close）。
- **`PreviewMenuNode`**（menu-node-types.ts 共享叶，ADR-195 刀2 自 menu/node-types.ts 下沉）— 声明式菜单节点类型契约；`PreviewMenuNodeKind` 17 种节点类型（ADR-195 增 `color`；2026-10 菜单收口增 `note`——脚注/辅助文案行，`rows.ts|rmAppendNote` 渲染 `.menu-note`（小号弱色无分隔线），与 `sectionTitle`（分节标题，`.section-title`）视觉/语义分离；无专有字段，文案走公共 `labelKey`/`label`）；`PreviewControlSpec` 控件绑定规格——**ADR-195 起与 MenuControlDef 同构**（unit/onCommit/hintKey/variant/disabled/getHint 已并入，nodeControlToCapControl 反向纯搬运零损失，终态 MenuControlDef 类型名作废并入本接口）。**类型位置**：MenuControlDef/MenuControlKind + PreviewMenuNode/Kind/ControlSpec/ActionMenuCtx/dockGroup 全在共享叶 menu-node-types.ts（零依赖，只挂 state/preview-paths）；menu/node-types.ts re-export 保 30+ 消费者 + 留 PreviewMenuCtx（依赖 caps/adapters 真依赖）+ 3 值函数（isPreviewFolderNode/collectPreviewLeafNodes/collectPreviewNodeIds，纯运行时）。caps/* 直产 PreviewMenuNode[] 只依赖共享叶，不再反向 import menu/。`row` 节点支持 `headerToggle`（对齐 MikuMikuAR PopupRow.headerToggle）：「功能=本 folder/行」时能力总开关放行内/header 一眼可见、免展开即切换；`createHeaderToggle` 内置 stopPropagation，开关点击不触发整行 action（下钻）；声明后行/folder 内容区不得再含同源开关。**直达平铺面板（scene 组：shadow/postproc/light）**——light 2026 补 light-enabled（原缺：面板首行仅 light-key 主灯参数开关，无「一键关整灯系统」入口）。**2026 长治久安：light/shadow/postproc 统一进 getMasterNodeId 单一来源契约**（enabled/visible 总开关 id）——`getMenuNodes()` 仍产完整树（含总开关首行），但**直达面板渲染经 `capPanelNodes`（settings.ts）按 getMasterNodeId filter 掉总开关**、场景组根视图经 `SCENE_CAP_FOR_PANEL`（core.ts，仅 panelId→capId 桥，照明→light/阴影→shadow/后处理→postprocessing）解析 cap 后凭 `cap.getMasterNodeId?.()` 是否存在给 headerToggle——**是否给开关的唯一真值源 = cap 声明 getMasterNodeId**，与 env 面板环境 6 cap 同契；`getMasterNodeId` 三消费方（env 子视图剔除 / 场景组 root headerToggle / 直达面板 filter / 合一）。**camera 无对应 cap 不声明 → 自然无开关**（视口=不可关，关闭=黑屏）。旧 `makePreviewMenuRow`（cm-row）仅剩 roles/motion 面板行，不再承载 headerToggle。导航行样式唯一实现 = renderMenu `.slide-item`（rmMakeRowBase），禁旁路自建行样式。**大统一**：场景组根视图与 env 面板一级共用同一套 `.slide-item.rm-row-compact` 导航行组件（rmAppendDynamicRow），样式零分歧。设计通则：**能关的功能才有一级总开关，视口/不可关功能不硬塞开关；删开关 = 删 getMasterNodeId 声明，数据驱动、无旁路硬编码。**
- **环境面板（buildEnvSchema）形态收口（2026）**：推翻 ADR-193 第三刀 folder 手风琴拍板，对齐 scene 组根视图 / roles / MikuMikuAR env 一级菜单——「行 + navigate 下钻」。一级 = 氛围预设 select + 每 cap 一行（`kind:"row"`：icon + label + 可选 headerToggle + `>` chevron），行 action 经 `actionCtx.navigate` 下钻到该 cap 参数子视图；二级子视图经 cap `getMenuNodes()` 直产 PreviewMenuNode[] 走 renderMenu（ADR-195 刀1 曾引入 `cap-to-node` 桥接层把控件定义投影成节点，刀2 逐 cap 迁移直产后该桥接层已于增量1 退役——简单控件为原生节点 control spec，复杂控件走 controls 节点通道受控委托，group 用 folder 折叠）。cap 能力总开关经 `SceneCapability.getMasterNodeId()`（可选接口，sky/fog/environment/ground/water/reflector 全部实现=6 cap 全报）声明，envCapRow 据此把开关放行尾、子视图经 `envCapSubNodes` 剔除同源控件（防双份）。守卫：env.test.ts 守护测试遍历 6 env cap 断言 prototype 必声明 getMasterNodeId + master id 集合完整（防漏声明→一级默默无开关）。最新：sky 原被注释为「无能力级开关」行无 headerToggle——实则有 isEnabled/setEnabled 真总开关（enabled 已被持久化），2026 补齐 `sky-enabled` + getMasterNodeId 后环境一级天空行尾即切。ground-visible / ground-water-enabled / sky-enabled 属「能力主开关」升级一行可切，与 fog/reflector 同构。render.ts `rmAppendDynamicRow` 扩展 headerToggle + action 无 badge 时行尾 chevron 槽位。
- **环境面板卡牌分段与成员发现（2026-09-10 卡牌；ADR-268 插件化）**：一级 cap 行按语义聚拢进 `kind:"card"` 卡壳（顶行标题 + 分隔线 + 内容区，`collapsible` 可折叠，折叠态跨 refresh 记忆）。**成员归属自 ADR-268 起由 cap 自报**（`env.ts | getEnvPlacement`→`{section, order}`），对齐设置面板节点级 `settingsOrder` 的插件范式——`env.ts` 不再持有成员清单，新增环境 cap 只改该 cap 一个文件、`env.ts` 零改动。`env.ts` 仅保留 `ENV_SECTION_DESCRIPTORS`（卡壳语义：`section`→卡 id + labelKey + 卡间展示序），卡内行按 cap 自报 `order` 升序。当前既定分组：basic = 天空/地面/水面，atmosphere = 环境/雾/反射（各环境 cap 类实现 `getEnvPlacement` 落地）。未知段（`EnvSectionId` 联合类型编译期穷尽，仅防运行期伪造）落末尾「其它」卡，空段不建空卡壳。**守卫**：`env.test.ts` 守护用例遍历各环境 cap 断言 prototype 必声明 `getMasterNodeId` + `getEnvPlacement`，并校验自报 section/order 与既定分组一致、段内序两两不同。**与 folder 分工**：folder 管「可收放的参数组」（二级子视图内），card 管「同级导航行的语义聚拢」（一级）。渲染器 `rmAppendCard`——**分派时 card 必须先于 folder 判定**：card 同样带 children，否则被 renderMenu「带 children 即按可折叠 section 渲染」分支吞掉、卡壳丢失。样式 `MENU_CARD_CSS` 在 menu-styles.ts（菜单样式经 overlay 样式桥注入 ShadowRoot，全局 CSS 不穿透；原 `ui/ui-card.ts` 的 `.lcard` 全仓无 DOM 产出方，2026-09-10 连模块与 orphan 样式一并删除，故不复用）。

- **环境面板「成员发现」的测试注入范式（2026-09-19 补齐）**：`buildEnvSchema` 的成员集**只**来自 `sceneCapabilityRegistry.getAll()`（`env.ts | collectEnvEntries()`），故面板测试的唯一注入口 = `vi.spyOn(sceneCapabilityRegistry, "getAll").mockReturnValue([...])`（`env.test.ts` 10 处；经 `mountPreviewRootMenu` 间接开面板的 `items.test.ts` / `core.test.ts` 同款）。⚠️ `ctx.getCap` **不能替代**——它只承担「按 id 取值」（dock 谓词 `env.skyGroundCap` / 一级行 headerToggle），无从枚举全集。ADR-270 menu 分层重构时这两个间接测试文件漏跟进，3 个用例（`core 拆组契约` / `core environment 面板` / `dispose 清环境订阅`）长期常红且被误判为「无关既有失败」，直至 2026-09-19 定性修复（`803c6cc7b`）。**cap 桩四件套**：`id`（行 id = `env-cap-${cap.id}`，缺则退化成 `env-cap-undefined`）+ `labelKey` + `icon` + `getEnvPlacement()`（入选守卫，返回 undefined 即被排除）——缺任一都会让行「静默不出现」，比抛错更难查。
- **cap 控件单类型化（ADR-195，2026-09-06 刀1 落地、刀2 完成）**：架构真相——渲染层早已单源：节点 select/slider/toggle 经 `nodeControlToCapControl` 投影进 `renderCapControls`（rmAppendSelect/Slider/Toggle 已退役），唯一控件渲染器即 cap 栈；真正分裂的是**声明入口**（cap 的 `getMenuControls(): MenuControlDef[]` 平行数组 vs 节点树）。单类型终局 = 一个 schema（MenuNode[]）+ 一条渲染链（renderMenu → renderCapControls），MenuControlDef 字段并入 PreviewControlSpec 后类型名作废。刀序：刀0 渲染归属复位（button 收编 cap 渲染器、节点行/参数行视觉 token 统一）；刀1 `cap-to-node` 桥接：简单控件（toggle/slider/select/divider/color）映射原生节点（spec 同构），复杂控件（timeline/histogram/image/preset-thumb/button）走 controls 节点通道（受控委托，不触发 renderCustom 审计门），group → folder。**刀刃边界：桥接层不得产 renderCustom 构造点**（render-custom-audit 白名单唯余 bones——controls 通道是树内嵌 MenuControlDef 的受控委托，非手写 DOM 逃生舱）。**刀2（完成）逐 cap 直产节点**：全部 SceneCapability 实现 `getMenuNodes(): PreviewMenuNode[]`——纯声明层抽 `caps/*-menu.ts`（reflector/fog/shadow/render-mode/light/ground/water/sky/postprocessing/environment），复杂控件 cap 用 controls 通道节点（ground button / sky timeline / environment preset-thumb+image+histogram+button），settingsOrder 挂节点（PreviewMenuNode 增 `settingsOrder` 字段，settings 聚合双轨收集）；env/settings 消费者双轨（已迁移 cap 优先 getMenuNodes，未迁移 fallback 桥接）。getMenuControls 保留兼容待刀3 删。**刀2.5（完成）投影反转**：删 `nodeControlToCapControl`（MenuControlDef 在 renderMenu 的最后硬依赖）——cap-controls 五简单控件渲染（Divider/Toggle/Slider/Select/Color）改吃统一 `CapControlView`（MenuControlDef 读取子集），render.ts 四分支经内部 `nodeControlToView`（spec→view，bind/get/set/onChange/refreshOnChange/numeric/unit/onCommit 全保留）直调 cap 渲染器；settings 聚合全节点化（collectSettingsCapControls/buildSettingsControls 返回 `PreviewMenuNode[]`，schema 展开节点，controls 通道于 settings 退役）。`renderCapControls`/`renderCapControlSingle` 的 switch 暂保留简单 kind（经 view 适配）。**刀3（完成，2026-09-07 走法乙）类型更名收敛**：`MenuControlDef`→`PreviewControlDef`、`MenuControlKind`→`PreviewControlKind`（字段原样，渲染形态零变、不碰 render-custom 审计门）——两类型名全仓归零，控件声明单类型化（简单控件走 PreviewMenuNode.control/PreviewControlSpec，复杂控件走 controls 通道/PreviewControlDef，同一 cap 栈渲染）；`getMenuControls` 接口同时退役。判据：`grep MenuControlDef` 零命中（仅历史注释）。ADR-194（判别联合）已标被本 ADR 取代。**桥接层退役（增量1，2026-09-19）**：settings 横切项 `buildCrossCuttingControls(): PreviewControlDef[]` 改直产 `buildCrossCuttingNodes(): PreviewMenuNode[]`、preview-state.test.ts fake cap 改直产 `getMenuNodes` 节点树后，`cap-to-node.ts`（`canNodeRepresent`/`capControlToNode`/`capControlsToNodes`）及其测试全仓零引用，已 `git rm`。注：`PreviewControlDef` 类型本身仍在（复杂控件 controls 通道 + `collectVisiblePredicates` 消费）。**增量2a（2026-09-19，通道收窄为复杂件专用）**：`PreviewControlKind` 砍至 `button|image|timeline|histogram|preset-thumb` 五件，`PreviewControlDef` 删 `slider/select/hintKey/onChange` 四简单字段，`renderCapControlSingle` 的简单臂（divider/toggle/slider/select/color）整体移除，`capControlToView`（def→view 恒等适配）与 `renderCapDivider`（仅该臂消费、node divider 走 `rmAppendDecor`）随之退役。至此简单件在声明层只剩一条路（节点原生 kind + `PreviewControlSpec` → render.ts `nodeControlToView` → `CapControlView` → `renderCap*` 渲染器），刀2.5「switch 暂保留简单 kind」的过渡态被反转清零；`PreviewControlSpec`/`PreviewControlDef` 字段统一（增量2b）+ `CapControlView`/`Def` 视图合并（增量3）经 2026-09-19 实证定性为 churn / 空目标，不做——2a 后简单↔Spec、复杂↔Def 按 kind 已不相交、走法乙下声明侧即单一 `MenuNode[]` schema（`controls` 通道本身是一种 node kind），复杂件全原生化（刀3 走法甲 / B2）列为可选未来项、非必偿债。守卫随能力收缩：cap-controls.test.ts 简单件用例改直调 `renderCapToggle/Slider`（喂 `CapControlView`），preview-menu.test.ts 通道分组探针与复杂件 testid 用例改用 button/image/timeline/histogram/preset-thumb，divider-through-通道用例删除。**增量2c（2026-10，button 原生化收口）**：`PreviewControlKind` 再收窄至 `image|timeline|histogram|preset-thumb` 四件——environment 的 pick/clear HDR 按钮自 controls 通道迁为节点 `kind:"button"` + `control`（对齐 ground 先例），`PreviewControlDef` 删 `button` 配置块、`preview-3d/menu/render/cap-controls.ts` 删 `renderCapButton` 及 switch button 臂。至此 controls 通道仅剩真·无法数据化的四类复杂件；button 的节点双形态（`preview-3d/menu/render/rows.ts|rmAppendButton`：有按钮语义 control → 行内真按钮 / 无 → 整行 action）单一化。**per-kind 字段契约门（2026-10 新增）**：`PreviewMenuNode` 是宽接口、`kind` 非 TS 判别器（`{kind:"field", radio:{…}}` 编译通过、渲染器静默忽略，既有校验只管 id 唯一性），新增 `preview-3d/menu/schema/node-validation.ts|validateNode`/`validateNodeTree` —— `KIND_SPECIFIC_FIELDS: Record<PreviewMenuNodeKind,…>` 穷尽表锁「字段 ⇄ kind」配对（新增 kind 漏登记编译期报错），`node-validation.test.ts` 走 CORE_MENU_ITEMS + core 面板 builder + schema-registry 断言零违规（含防门空转的非空断言），`caps/cap-menu-trees.test.ts` 另经 `sceneCapabilityRegistry.createAll` 实例化全部内置 cap（新增 cap 自动纳入）逐个校验 `getMenuNodes()` 的树——cap 树是菜单节点大头而 core 门跑不到（无 cap 注册时 settings/environment 的 cap 段为空），两门合起来覆盖「core 手写节点 + cap 自产节点」全量菜单树，各自带防门空转断言（cap 门断言「实例数==工厂数」+「每个 cap 都产出节点」，⚠️ cap 构造若抛错会被 createAll 静默 ringLog 吞掉，故该计数断言是必要防线——实证 = ShadowCapability 需 `renderer.shadowMap`，test-setup 全局 Fake 无该字段）；运行期只在 adapter 注入点 `preview-3d/menu/engine/core.ts|validateAdapterItemIds` warn（不 throw——外来节点阻断挂载比告警更糟），**渲染热路径不跑**（每次 refresh 遍历全树逐字段校验是白付成本）。**类型层单源（ADR-302 走法丙，2026-09 采纳并实施刀1）**：`KIND_SPECIFIC_FIELDS` 升为 per-kind 契约的**唯一事实源**（`as const satisfies Record<PreviewMenuNodeKind, readonly (keyof PreviewMenuNode)[]>`——`as const` 保留字面量供类型层投影，`satisfies` 保穷尽性与防拼错），类型层经 `KindSpecificFieldOf<K>` → `CommonNodeField`（= 宽接口字段全集减 kind 与全部专有字段并集，**自动推导无手写清单**）→ `NodeFor<K>`（可选窄类型；**`PreviewMenuNode` 宽别名不变**，既有引用零改动）；新增构造点写 `{…} satisfies NodeFor<"folder">` 即得编译期字段校验。**为何否决一次性判别联合（走法甲）**：实测 680 处编译错误（生产 120 / 测试 560；`control` 266 + `children` 151 占 77%），其中 33 处 TS2322 **全落在运行期表自身**（`keyof 联合` 只会折叠成公共键）⇒ **真实字面量违规 0 处**——联合今天抓不到任何现存缺陷，收益纯属面向将来，故按 ADR-195 走法乙精神取渐进（数字与复评触发条件见 ADR-302）。⚠️ **类型级锁的空转陷阱（实施时实证踩中）**：tsconfig 开 `exactOptionalPropertyTypes`，故赋值 `undefined` **无论字段归属对错都报错**——拿 `{ control: undefined }` 做 `@ts-expect-error` 负向断言，指令会被「拒绝 undefined」这个错满足，门**恒绿却什么都没验**；必须填真值，且**多行字面量的过量属性错误报在属性行**（指令只作用于紧邻下一行，写在 `const` 行会 TS2578「未使用」+ TS2353「属性不存在」双错）。**验证本锁非空转的负控手段**：临时放宽任一 kind 的字段集 → tsc 必报 TS2578 Unused '@ts-expect-error' directive。**刀2（2026-09）逐 kind 收窄渲染器**：`preview-3d/menu/render/render.ts|MENU_HANDLERS` 由 `Record<PreviewMenuNodeKind, MenuHandler>`（宽签名）改为**映射类型** `{ [K in PreviewMenuNodeKind]: MenuHandlerFor<K> }`（`MenuHandlerFor<K>` 的 node 形参 = `NodeFor<K>`），于是每个臂的 `n` 拿到**该 kind 的窄类型**——臂内读别的 kind 的字段直接编译报错（负控实证：`field` 臂读 `n.radio` → TS2339 `Property 'radio' does not exist on type 'NodeFor<"field">'`；宽接口下这是静默可读的）。分派位点因此需**一处**类型断言（`MENU_HANDLERS[node.kind] as MenuHandler`）——这是全文件唯一逃生舱，安全性由「映射类型穷尽 kind」+「运行期门保证 node 与其 kind 相符」双条兜底。`rows.ts` 叶原语随之收窄（`rmMakeRowBase` = `NodeFor<"button"> | NodeFor<"row">`、`rmAppendField`/`rmAppendButton`/`rmAppendDynamicRow`/`rmAppendMaterialRow`/`rmAppendDecor` 各按其 kind）；**`rmAppendLeaf` 刻意保持宽类型**——它是「未知/伪造 kind」的兜底出口，收窄会堵死伪造 kind 的落叶行壳路径。⚠️ **收窄边界（ADR-240 决定，勿试图突破）**：窄类型只适用于**按 kind 分派的叶路径**；「形状前置」折叠路径（`render.ts|appendFoldedShape` → `node-types.ts|isPreviewFolderNode`）按 `kind==="folder" || Array.isArray(children)` 判形态、**刻意与 kind 脱钩**，故 `rmAppendFolder`/`rmAppendCard` 天然 kind 无关、必须保持宽类型；推论 = `children`/`defaultOpen`/`headerToggle` **对任意 kind 都被读取**（任何带 `children` 的节点都会被形状前置成折叠卡），属**通用字段**而非 folder/panel/card 专有——留在逐 kind 白名单会对其他 kind 产生误报。**单一事实源闭环的另一半（2026-09 加）**：`node-validation.ts|AssertCommonFieldIsExact`（编译期类型断言，消费处 = `node-validation.test.ts`）强制「推导公共集 ⇔ `ExpectedCommonField` 双向相等」——封堵自动推导的副作用：新增 `PreviewMenuNode` 字段若既不入任何 kind、也不进 `COMMON_NODE_FIELDS`，会静默落进公共集从而逃过 per-kind 判定；该断言把它变成「编译期必须显式决定归属」（负控实证：临时加 `zzProbeUnregistered` 字段 → `TS2322 ... not assignable to type '{ unregistered: "zzProbeUnregistered"; }'`，错误信息直接指名违规字段）。**防线归属（实证澄清，勿误判）**：「表被误放宽」由**编译期三重 `satisfies`（`COMMON_NODE_FIELDS` 自身 / 逐 kind 表项 / `AssertCommonFieldIsExact`）+ 运行期「跨 kind 共用图恒等」断言**共同把守——加通用字段、加他 kind 的专有字段、加接口里未登记的字段、加不存在的字段名，四种改宽方式**全部会被拦**（负控实证：给 `slider` 加 `radio`+`danger` → 共用图断言报红；加 `icon` → 编译期双层同时开火）。⚠️ 但类型级「每 kind 一条 `@ts-expect-error`」负控**只**覆盖「用被断言的那个字段放宽」（实证：给 `slider` 加 `radio` 时，断言 `opacity` 的指令仍绿）——它是逐 kind 的**拒绝语义证据**，不是任意放宽的守卫。另注：tsc 的实际执行点已确证两处——CI `.github/workflows/test.yml`「前端类型检查」步骤，与**本地 pre-push 经 `scripts/pre-push-gate.ts|runFrontendDomain` 执行 `cd frontend && npx tsc --noEmit`**（残留风险仅 `git push --no-verify` 主动绕过，属审计可见的刻意行为）。**契约表是「多对多」关系**（`action`/`control` 各被 5 个 kind 共用、`danger` 3 个、`renderCustom`/`rowDensity`/`value` 各 2 个）——**共用是设计不是漂移**，勿按「字段唯一归属」写成对互斥断言（曾误写并被 `action` 当场证伪，失败信息点名 panel ⇄ action）。**刀2.5（同批）窄类型接入构造点 + 契约归属迁移**：①**契约与其类型层投影**（`COMMON_NODE_FIELDS` / `KIND_SPECIFIC_FIELDS` / `NodeFor` / `AssertCommonFieldIsExact`）已由 `node-validation.ts` **迁至 `menu-node-types.ts`**（契约与它约束的类型同址）；`node-validation.ts` 退回**纯校验器**（只 import 契约常量、不再持有表），`node-types.ts` 转出 `NodeFor` 供 menu 层消费（caps 仍直引契约叶，保持 ADR-195 刀2 的双域同源设计）。②窄类型的推荐接入形态 = **给单节点工厂注返回类型**（`function fcMasterToggleNode(cap): NodeFor<"toggle">`）而非逐字面量包壳——零运行期开销、零嵌套噪音，已在 `caps/*-menu.ts` 与 `menu/panels/{env,settings,bones-panel-node}.ts` 的单节点工厂落地；**剩余生产侧单节点工厂已全量收口**（`stats.ts|field/buildStatsPanel`、`reflector-menu|slider` 内联工厂、`litematic-adapter|layerSlider`、`roles-views|panelEntryRow`、`core|panelNodeToRow`、`litematic-adapter|registerSliceSchema`——注窄顺带删去 `panelNodeToRow` 的 `as PreviewMenuNode` cast，当场抓出 `icon: node.icon` 向可选属性显式赋 undefined 的 exactOptionalPropertyTypes 违规（原被 cast 掩盖），改存在性展开后 tsc 全绿；判据 = 生产侧返回 `PreviewMenuNode` 单节点的工厂仅剩 `panelNodeToRow` 一处**设计性宽签名**（panel→row 转换器，非 panel 项原样透传），其余经 `grep "): PreviewMenuNode"` 归零）；**注窄当场抓出一个命名谎言**：`menu/panels/settings.ts|bsBuildPerfPresetRow` 名含 `Row` 而实为 `kind:"select"`（其注释也写「声明式 select 节点」），编译器以 `TS2322 '"select"' is not assignable to '"row"'` 直接点名——这就是「不下断言就没人发现名字在骗人」。③**代价实证为零**：过程中冒出的 30+ 处 `TS7006`（形参隐式 any）一度被误读为「窄类型的固有上下文类型代价」，实为**缺 `NodeFor` import 使返回类型退化成 error type 的级联假象**，补 import 后全数消失（最小探针并列对照全清）；教训入 `skills/pitfalls.md` #22。**清空归属收口（2026-10）**：`SlideMenuView.render` 幂等契约明确为「视图自清空」，`ui/slide-menu.ts|smRenderTop` 删代清（原与视图自清空双重 `innerHTML=""`），`preview-3d/menu/engine/core.ts|makeRootView` 补 `list.replaceChildren()`（五个 production 视图中唯一未自清者，契约违规修正）；⚠️ 新增视图必须自清空，shell 不再兜底。**渲染器组织（2026-10）**：`preview-3d/menu/render/render.ts` 的叶节点原语（rmAppend* 行壳/字段/按钮/动态行/材质行/装饰/叶节点 + `CAP_CONTROL_RENDERERS` + `nodeControlToView`）拆至同目录 `rows.ts`（零行为变更纯移动）；`rmAppendFolder`/`rmAppendCard` 因递归调用 `renderMenu` 留 render.ts（防 rows↔render 循环），`nodeControlToView` 由 render.ts 转发保消费者 import 路径不变。
- **`PreviewMenuNode.fallback` 退役 → `label`（回退标准统一归 i18n）**：原 `fallback` 字段被删，回退标准**只允许 i18n `tOf` 制定**（当前语言包 → FALLBACK_LANG=en → 裸 key + warnMissingKey 三级兜底）；动态节点的明文显示名改走显式 `label` 字段（无 i18n 键、值即运行期数据，如形态名/材质名/角色名/switch 候选文件名）。根源腐蚀点 `rmLabel`（render.ts）统一为 `labelKey ? tOf(labelKey) : (label ?? node.id)`。分类迁移：① 有真实 i18n labelKey 的确定性节点 → 删冗余 fallback；② 无 labelKey 的运行时数据节点 → `fallback` 改 `label`。`PreviewControlDef.fallback`（cap-controls 层 Schema 必填字段）**保留不动**——与 MenuNode 层隔离（原 `cap-to-node.ts | capControlToNode` 桥接把 `c.fallback` 落在 `node.label`，桥接层退役后 cap 直产节点时自行落 `label`）。守卫：`core.test.ts` 断言 CORE_MENU_ITEMS 不得再含 fallback 字段；`items.test.ts` 非 divider 项断言 `labelKey || label` 有值。
- **★ 2026-09 收口：回退决策唯一出口 `resolveLabel`（表情整列空白行事故）**：`frontend/src/utils/base/pure/label.ts|resolveLabel({labelKey, plain}, translate, valueOverride?)`——**唯一**回退决策纯函数（翻译器注入式，本层零 i18n 依赖）：① `labelKey` 非空 → `translate(labelKey)`；② 无 labelKey 且有 `valueOverride` → `String(valueOverride)`（field 行「显示值优先」，顺序不可换）；③ 其余 → `plain` 明文。`rmLabel`（render.ts）与 `capLabel`（cap-controls.ts）**双双委托它**，杜绝「同一契约两栈两种读法」。**事故根因**：cap 栈各渲染器此前只读 `labelKey`，而 `nodeControlToView` 把动态名装进 `fallback`（=`node.label ?? node.id`）、把 `labelKey` **置为空串**，`tOf("")` 三级回退全 miss → 原样返回空串 → `morphNodes` 表情开关整列**有控件无文字**；骨骼面板不受影响（sanctioned `renderCustom` 直写 `textContent = item.name`，不经 tOf）。⚠️ **空 labelKey 不得送进 tOf**——`resolveLabel` 以真值判断短路，`label.test.ts` 已钉「空 labelKey 不触碰翻译器」。守卫：`cap-controls.test.ts`（capLabel 两分支 + 只声明 fallback 的 toggle/slider 上屏，含 aria-label）+ `morph-controls.test.ts`（`morphNodes → nodeControlToView → renderCapToggle` 端到端三行文本）。
- **★ 2026-09 收口（续）：写入侧归一 + 渲染侧唯一出口**：`labelKey` **只装真 i18n 键**，动态名一律走 `label`（明文通道）——清除六处「动态文本借 labelKey 搭车、靠 `tOf` 缺键回退侥幸显示」：`core.ts:506` / `material-controls.ts:33` / `roles-views.ts` 入口行 / `skeleton-fill-panel.ts` 纹理行 / `pack-model-adapter.ts` 纹理短名行（均改 `label`），`core.ts:158/381` 的 `tOf(node.labelKey ?? node.id)` 手搓读法并入 `resolveLabel`。渲染侧 `rmLabel`（render.ts）成为 row/field/sectionTitle **唯一**取值点，`rmAppendDynamicRow` 的 else 分支补 `value` 副标签（仅当 `value` 与行文案不同，避免重复）——所以「名称 + 声明/面数」类动态行（纹理短名 + 引用面数）在归一后**仍展示副标签**。⚠️ 新增「动态名 + value」类 row 时勿再塞 `labelKey` 骗取 meta。守卫：`node-render.test.ts`（动态行 meta + 无 labelKey 不落 id）、`material-controls.test.ts`（`label` 替代 labelKey）、`pack-model-adapter.test.ts` / `skeleton-fill-panel.test.ts`（明文 `label`）。
- **★ 2026-09 收口（三）：`labelKey` 全链钉死为 `LocaleKey`（编译期无洞守卫，ADR-277）**：P1 只清了写入侧现患，类型仍放行 `string`，滥用可复发。现把整条链收窄为 `LocaleKey`（`keyof typeof zhCN`，单一类型源 `@/core/i18n/t.ts`）——节点/控件（`PreviewMenuNode.labelKey?` / `PreviewControlDef.labelKey` / `PreviewControlSpec.options[]`·`thumb.options[]` / `CapControlView.labelKey`·`select[]`）、能力声明（`SceneCapability` / `PreviewMenuGroupDef` / `PerceptionCapability` / `MultiModelSelectOpts` / cap helper 形参）、cap 分组常量（`WATER_GROUP_*` / `FOG_PARAMS_GROUP` / `SKY_GROUP_ADVANCED` / `SHADOW_PARAMS_GROUP` / `MAT_GROUP` / `OVERLAY_GROUP` / `REFLECTOR_PARAMS_GROUP` / `ENV_GROUP_*`）与 `ENV_PRESET_LABEL_KEY: Record<string, LocaleKey>` 显式标注。⚠️ **只钉 node 层会留洞**（实测仅 1 处报错）——cap 构建器普遍松类型 / `as` 构造，`labelKey: cap.labelKey` 一类透传不报错，故必须全链。`CapControlView.labelKey` 保留 `LocaleKey | ""`（无键节点写空串，经 `resolveLabel` 真值短路，**勿送 `tOf`**）；动态名仍走 `label` 明文通道。测试桩键（`"x"` / `` `cap.${id}` `` 等）以 `as LocaleKey` 显式断言；类型叶 `menu-node-types.ts` 经 `import type` 引 `LocaleKey`（check-layering 豁免，不破零运行时依赖）。实测：全链收窄后 `tsc` 0 错误、`vite build` 通过、preview-3d 2610 用例全绿。
- **[2026-09 雾气锐评收口] select 选项支持 `labelKey`（i18n，取代硬编码中文）**：`PreviewControlSpec.options` / `CapControlView.select` 的选项类型由 `{value,label}` 扩为 `{value,label,labelKey?}`（options 直透传，故类型加字段即全链路生效；增量2a 前第三处 `PreviewControlDef.select` 已随 controls 通道收窄为复杂件专用而移除，select 声明现只存于节点 `PreviewControlSpec`）；`renderCapSelect` 落位改 `opt.labelKey ? tOf(opt.labelKey) : opt.label`——`label` 降级为「i18n 缺键 / 动态项」回退。首用例 = fog 雾型选项（`preview.fogModeLinear` / `preview.fogModeExp2`）。**遗留债**：water / ground / postprocessing 的 options 仍硬编码中文（`{value:"film",label:"薄膜"}` 等），该债已于同日清零——water / ground（来源·样式·叠加三轴）/ postprocessing（色彩映射 + 反射模式）/ render-mode（混合 + 面剔除）/ shadow（贴图尺寸）/ light（模型预设）/ camera（旋转模式）/ litematic（切片模式）全部 select options 已带 `labelKey`（各自显式注解的常量类型同步加 `labelKey?: string`）；`preset-thumb` 的 `thumb.options` 同批扩 `labelKey`（`renderCapPresetThumb` 的 `img.alt` / `span.textContent` 同口径），环境预设缩略图复用 `preview.presetQuick*`（与 env 面板快捷预设文案恒等）。
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
- **`preview-3d/caps/scene-capability.ts`** — cap 生态：`controls` 节点直持 `PreviewControlDef[]`（增量2a 起复杂件专用，2026-10 增量2c 再收窄为 image/timeline/histogram/preset-thumb——button 已迁节点原生 `kind:"button"` + `control`），渲染委托 `renderCapControls`（复杂件唯一渲染器；简单件走节点原生 kind + `renderCap*` 直渲）。
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
- **renderCustom 末段逃生舱**：schemaId 未注册时走 renderCustom 会 console.warn 提示。**唯一在册构造点 = bones**（ADR-193 §2.2② 拍板的永久例外，camera/env 退役后唯余此项）——名单**单一事实源 = `menu/sanctioned.ts|SANCTIONED_PROCEDURAL_PANELS`**，由两处共同消费：审计门（`adapters/render-custom-audit.test.ts`，生产源码「`renderCustom`+冒号」构造点须与名单**逐一相等**）与导航图报告（`collectMenuGraph().sanctionedProcedural`，兑现 §3「不可静默」——报告不再一边宣称 `coverage:"full"` 一边对已豁免的手写 DOM 面板只字不提）。**新增例外须先 code review 拍板并把条目写进该表**，不得只在测试白名单或注释里挂单（审计门会抓裸加）。⚠️ bones 由 adapter 注入 `menuItems`，不经 collectMenuGraph 的三通道枚举，故 `escapeHatch` 标记对它永不触发——`sanctionedProcedural` 是它唯一的显式曝光面。
- **[2026-09 追加] 豁免条目须自证三件 + 判据收敛为能力面（ADR-276）**：条目字段 = `decidedBy`（ADR 依据）+ `rationale`（真·无法数据化的具体性质）+ **`exitWhen`（假释条件）**，审计门逐一断言，缺一即红——永久例外 ≠ 永久特权（ADR-193 §2.2「拒绍挂着不动」的可执行化）。**豁免判据只认能力面缺口三条、需满两条**：① 活对象注入（相机/场景/容器实时引用）② 副作用注册 + 生命周期（外部事件监听 + cleanup 归属）③ DOM 位置依赖运行时选中态（选中行下方内联详情 / 深度缩进）；bones 三条全中（`VrmBonePanelCtx{viewContainer,camera,scene}` / click 监听 + cleanup / `activeId` 详情块 + `paddingLeft=depth*12+6`）。⚠️ **「数据动态」「名字进不了语言包」「列表项数不定」不是豁免理由**——动态名走 `label` 明文通道（见下条）、动态列表走 `row` kind（`menu-node-types.ts|PreviewMenuNodeKind` 注释即点名 bone）；以动态为由申请豁免即为误读。**触发条件（两次法则）**：出现**第二个**需①②③中至少两条的面板时，本例外升级为模式提取（选项①：给 node 模型补 `subscribe` 订阅通道 + 树形 row），届时条目须从名单移除——契约预定义见 ADR-276。
- **renderCustom cleanup 双持有者**（2026-09 生命周期收编）：`renderCustom` 返回 cleanup 后同时交给两方——① 渲染器（render.ts `runCustomMount` 按容器持有，重渲染前先清旧 / `disposeCustomCleanups` 菜单 dispose 全清）；② bones 的 `cleanupRef`（adapter.dispose 模型级兜底，摘挂 viewContainer 的 raycaster listener——模型卸载而菜单存活时唯一防线）。两者持同一函数，renderer 实现幂等，双清无害。**新增 renderCustom 逃生舱自动获得面板级生命周期，勿自搓 cleanupRef**；仅当 cleanup 跨面板存活（引用模型资源）时才需模型级兜底通道。
- **disposeCustomCleanups 只挂 dispose**：不可挂 `onOverlayStyleTargetReset`——该钩子每次 mount 都触发，而 cleanup 表是模块级共享，全清会误伤并行挂载会话仍存活的骨骼面板（listener 被摘而 DOM 仍在 → 拾取静默失效）。
- **setAdapterItems id 冲突守卫**（ADR-085 S1）：重复 id 或与 CORE_MENU_ITEMS 冲突时抛错阻断。
- **dock 一级路由声明化（ADR-241）**：点击路由由 `PREVIEW_MENU_GROUPS` 数据表显式声明，`renderPreviewDock` 纯查表（directToPanel → directViewKey → rootView → 兜底 makeGroupViewFn），无 `g.id === ...` 字面量。model/env/settings → `directToPanel` 静态直达；motion → `directViewKey:"motion"` 动态工厂（活跃角色详情，directToPanel 表达不了）；scene → `rootView:true` renderMenu 组根视图。`motion` 的 key→工厂映射仍在 core.ts（需注入 sceneRegistry/详情工厂），是多态路由表而非 id 特判。
- **`dockGroup` 已是归属域单源，勿再改名 `navDomain`**（2026-09 复核证伪）：`dockGroup`（`PreviewDockGroup` = dock 组 ∪ `"stats"` 统计通道）是静态类型化声明字段，为 dock→panel 投影唯一真值源；`menu-graph.ts`（ADR-128）已把它投影成静态可机验导航图。改名是零增益 churn。`roles-views.ts` 的 `dockGroup === "model"|"motion"` 运行时过滤对象是**per-model 实例注入 panel**（适配器按模型类型产出），属本质运行时数据，无法静态化（MikuMikuAR 同样 per-model 运行时构建）。
- **同一参数不得声明两条控件（sky 时间轴复盘，2026-09）**：`caps/sky-menu.ts|buildSkyNodes` 曾同时声明 `sky-timeline`（timeline 复杂控件，走 `controls` 通道）与 `sky-time`（slider 原生节点），二者**同源同槽**——读写都落在 `caps/sky-capability.ts|SkyCapability.getTimeOfDay` / `setTime`，行为上天然同步、不会打架，但 UI 冗余且诱发「这俩是不是一个意思」的误解。根因是 ADR-195 刀2 迁移时按「控件 kind 分流」（复杂→controls 通道、简单→原生节点）**各声明了一遍**，两条通道互不知情。**已删 `sky-time` slider**，`timeOfDay` 唯一控件 = timeline（自带 `HH:MM` 读数 + 指针拖动 + 触屏，精度远高于原 0.5h 步进；`menu/cap-controls.ts|renderCapTimeline`）。**新增 cap 控件时先查同 cap 内是否已有同 `get/set` 目标的控件**——kind 分流是渲染层实现细节，不该外溢成声明层的重复。
  - 注意区分三个「时间」：天空 time-of-day（本卡）／动画播放进度（`model/ysm-animation-player.ts|executeTimeline`，Molang 时间轴事件）／昼夜自动循环开关（`sky-auto-rotate`，按真实时间推进 timeOfDay）。名字相像，语义无关。
- **timeline 拖动相位通道（2026-09-23，S2-1 修复配套）**：`PreviewControlDef` 增可选钩子 `onDragStart?/onDragEnd?(v)`（`cap-controls.ts|renderCapTimeline` 在 pointerdown 首发 / pointerup+pointercancel 松手触发）——**「逐帧写入 × 后端代价高（整场重建/全量 PMREM 烤图）」的控件，拖动期降为门控、松手 force 一次**。首例 = sky `setTime(hour, {phase})`：dragging → forceEnv=false 走阈值门控，settled → force 一次取当前帧图；未传 phase 保持旧默认 true（兼容既有调用方）。可选钩子，未声明的 timeline 消费方（motion 进度）行为零变化。reflector size/resolution（S11-1/2 结构键滑杆）是同处方待接候选。**烘焙决策单点纪律**：phase 只写 envState（skyTimeOfDay/skyForceEnv 同批），真烘焙判定统一在 registerEnvCallback 分支——setTime 不直调 bake，防相位语义 cap 侧双路径分叉。⚠️ `skyForceEnv` 是**脉冲键**：写侧须 `force:true` 绕 shouldOverwrite（resetEnvState 后无来源标记时 manual 也会被拒，S2-1 实证）。
- **动作/模型组一级卡壳收纳（ADR-242）**：`modelDetailView`/`motionDetailView` 一级改为 `kind:"card"`(collapsible) 卡壳 + 面板**入口行 array**（`panelEntryRow`：`kind:"row"` + icon + label + `rowDensity:"compact"` + `action: ctx.navigate(makePanelView(item))`），照抄 env `envCapRow` 范式——**内容仅在 navigate 到次级菜单后渲染**，骨骼/表情/材质等巨多内容不再一级内联铺开（与环境组形态统一：环境有收纳，动作也有）。骨骼二级仍走 `makeBonePanelRenderer` 逃生舱（动态树 + 跨域拾取，schema 化 ROI 为负）；表情/材质二级仍走既有声明式 children。入口行 testid 形如 `preview-motion-entry-<id>` / `preview-model-entry-<id>`（row testid 统一 `preview-` 前缀）。此决策部分推翻 ADR-240 的「renderCustom 内容内联进卡 body」做法（视觉统一保留，内联内容改跳转入口）。

- **行内按钮样式单源（`MENU_BTN_CSS`）**：`render.ts` 的 radio/badge 与 cap 控件共用 `.cc-btn` 族，规则住在 `menu-styles.ts|MENU_BTN_CSS`，行/控件两条渲染路径**各自插值**——不可只让 cap 栈注入（`ensureCapStyles()` 唯一调用点是 `renderCapControls()`）：纯 row 面板（roles 角色列表，不渲染任何 cap 控件）拿不到规则 ⇒ `<button>` 回落 UA 默认**不透明白底 + 2px 黑框**（2026-09-16 实测 `background=rgb(240,240,240)`、`box 21×20`）。守卫：`menu-styles.test.ts`（常量内容 + 两消费方真插值）+ `roles.test.ts` 断言菜单样式表含 `.cc-btn-ghost`。
- **row 槽位图标走语义名（ADR-238）**：`radio` 渲染 `radioOn`（外环+圆心）/`radioOff`（空环）SVG 图标，`badge.icon` 为 `IconRef`（roles 工具=`tools`、switch 追加=`add`）——不再用 `●/○/⚙/➕` 字形拼凑（几何随字体漂移，且 `.cc-btn-ghost` 的圆角矩形边框被误当「外圈」）。激活色用**双类锚定** `.rm-radio-btn.row-radio-active`（同为单类时后者胜，曾把 accent 吃掉）；按钮本体 18px 正圆、无边框、透明底（`.rm-radio-btn`）。
- **调试日志门控（2026-09）**：菜单装配与渲染关键路径经 `utils/debug/debug.ts|dbg()` 打点，统一 tag `preview-menu`（`mountPreviewRootMenu` 的 mount/shell built/routers built/adapter items update/open panel/disposed）与 `preview-menu-render`（`renderMenu` 的 start/每节点 rendering node/complete）。复用全局 dbg 机制：`?nodebug=1` 全局关闭，日志进 `window._DBG_RING` 环形缓冲（排查「某节点没渲染出来」先看 rendering node 是否含目标 id，再查其 `visibleWhen`）。**调试日志用完即删是 AGENTS.md 通则，本处为常驻诊断锚点非临时打点。**
- **命名脱钩裁定（ADR-305，2026-09-24）**：preview-3D 菜单三命名族——envState schema 键 = **存储标识符**（默认不改名；改名须带存档迁移 + ADR 词系 + ADR-286 分派表同步）、labelKey = **用户可见语义标识符**（命名跟控件语义走，掉前缀/缩写/语义改名均合法）、菜单工厂 join（`caps/*-menu.ts|buildWaterNodes` 等）= 唯一语义拼接点（`LocaleKey × RangedKey` 类型锁定）。**审查判据（ADR-305 D2）：命名脱钩项当且仅当「用户可见文案错/误导」才构成缺陷；labelKey 名 ≠ schema 键名本身不是缺陷**——38 对同构件（water 8 / postprocessing 20 / 体积光 5 / sky 3 / ground 2，清单见 ADR-305 D4）普查文案三语全对，统一裁定「不动」；新产生的脱钩不需登记，按判据自动裁定。P2-2（waterFilmDensity↔waterWetness）为该族首例，收口注释在 `caps/water-menu.ts|buildWaterNodes` 的 water-wetness 拼接点。
## 相关

- `docs/preview-menu-overview.md`（3D 预览菜单系统全景图：分层架构 + 数据流 + ADR 索引 + 调试指南 + 快速上手）

- `docs/knowledge/preview-state.md`（状态层快照 + visibleWhen 谓词）
- `docs/knowledge/preview-controls.md`（cap 控件渲染）
- `docs/knowledge/ui-slide-menu.md`（SlideMenu 多层导航）
- `docs/knowledge/scene_capability_registry.md`（cap 生态）
