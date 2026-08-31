---
kind: preview_core
name: 统一 3D 预览核心 preview-core
tier: architecture
adr:
  - ADR-125
category: utils
source_files:
  - frontend/src/preview-3d/adapters/
  - frontend/src/preview-3d/bone-tools.ts
  - frontend/src/preview-3d/caps/sky-capability.ts
  - frontend/src/preview-3d/caps/ground-capability.ts
  - internal/app/container_entries.go
  - go/litematic/voxel.go
  - frontend/src/backend/web-fs.ts
tests:
  - frontend/src/preview-3d/adapters/mmd-adapter.test.ts
  - frontend/src/preview-3d/adapters/ysm-3d.test.ts
  - frontend/src/views/app-preview/litematic-3d.test.ts
use_when:
  - 3D 预览
  - 统一预览外壳
  - 程序化天空 / sky / 背景 / scene.background
  - PreviewAdapter 适配器
  - 全模型预览（YSM / VRM / MMD / Litematic）
  - mount3D
invariant_anchors:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|mount3D
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|_singletonScene.background
  - frontend/src/preview-3d/caps/sky-capability.ts|SkyCapability
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|PreviewAdapter
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 追加模型、同台加载、多模型同框
  - 模型切换、会话内替换
  - 3D 预览菜单、根菜单、dock 按钮
  - VRM 动画播放、VRMA
quick_risk_lines:
  - 跨类型必须走 switchExternal，禁止直接调 adapter.build
  - switchTo 仅同类型；跨类型用 switchExternal
  - 适配器项经 setAdapterItems 注入，禁止内联
  - 必须 mixer.update(dt) → vrm.update(dt)，禁止手动 vrm.humanoid.update()
pitfalls:
  - 「frontend/src/preview-3d/menu/core.ts」跨类型追加走错适配器 → 必须经 switchExternal → openModel3DFullscreen(cooperate)
  - 「skeleton.ts」异步回调写入已卸载 DOM → 每个 await 后检查 container.isConnected
  - 「vrm.humanoid.update()」手动调用导致 T-pose 回归 → 只用 vrm.update(dt)
---

# 统一 3D 预览核心 preview-core

## 概览

ADR-066 落地的**统一 3D 预览核心**，收缴 vrm / litematic 复制脚手架（旧实现各内联 ~250 行同构），成为所有富格式 3D 预览的**单一事实来源外壳**。内容差异经 `PreviewAdapter.build(ctx, path)` 注入，核心统一持有 scene / camera / renderer / OrbitControls / 灯光 / rAF / ESC / GPU 释放。

这正是「**全模型预览器**」：YSM + VRM + MMD(`@moeru/three-mmd`) + Litematic 共用同一套外壳，MMD 在 Three 内预览（非 Babylon）。

## 核心职责

- **外壳**：overlay + ⚙️ 声明式根菜单(`preview-menu/defs.ts`：`CORE_MENU_ITEMS` + `PREVIEW_MENU_GROUPS`，能力驱动 dock) + viewContainer + loadingEl + 适配器控件容器(`topBar`，仅 vrm/litematic 遗留 `extraControls` 单按钮，Phase 3 收编)。`PREVIEW_MENU_GROUPS` 组定义带 `labelKey + fallback`（2026-08-31 补齐：dock 按钮/组标题走 `tr()`，与 `CORE_MENU_ITEMS` 同款兜底；新增组只加 defs.ts 一行 + 三语 key）
- **渲染基座（shared 模式）**：创建 `scene` / `camera` / `renderer` / `OrbitControls` / 灯光，驱动 rAF 循环、WASD/拖拽自转、resize、ESC 关闭、GPU 资源释放。**WASD 键位表驱动（见 [model3d](./model3d.md) 键位消费链）**：`bindInputHandlers` 按 `KeyboardEvent.code`+`loadTdKeymap()` 映射动作表，`mpApplyWasdCameraMotion` 只查 forward/back/left/right/up/down；输入框焦点守卫防止吞打字；方向键双轨 + 修饰键左右对称。
- **3D overlay 无障碍（a11y，2026-08-29）**：`#ysm-overlay-3d` 设 `role="dialog"` + `aria-modal="true"` + `aria-label="3D 预览"`（复用 `preview.title3d` i18n key），屏幕阅读器可识别模态体验；`mount3D` 入口 `rememberTrigger()` 记下触发 FAB，关闭时 `returnFocus()` 把焦点还给 FAB；document 级 `trapFocusAcrossShadow`（`utils/dom/focus-restore.ts`）拦截 Tab 越界——避免焦点逃出 3D 到背后树面板。注：overlay 整链当前为 **light DOM**（createSlideMenu 无 attachShadow），跨 shadow 下钻属防御性兜底；handler 内深焦解析 + cleanup 身份守卫已修（详见 [utils-dom](./utils-dom.md)）。单一事实源：`utils/dom/focus-restore.ts` 的 `rememberTrigger / returnFocus / trapFocusAcrossShadow` 三件套，弹窗/3D/上下文菜单统一受益。
- **适配器注入**：内容层经 `PreviewAdapter.build()` 挂进 `ctx.scene`；每帧 `update(dt)` 驱动动态部分（VRM SpringBone、动画）
- **VRM 动画播放（VRMA）**：`vrm-adapter` 注册 `VRMAnimationLoaderPlugin`，加载同目录 `.vrma`（`listAllFilePaths` 经端口注入，0 backend import），`createVRMAnimationClip` → `THREE.AnimationMixer`；每帧严格 `mixer.update(dt)` → `vrm.update(dt)`（后者内部已含 humanoid / springBone 更新，禁止手动 `vrm.humanoid.update()` 否则 T-pose 回归）；播放时暂停呼吸 / 视线 / 眨眼（与 MMD 行为对齐），复用 `MmdPlayBridge` + `fillMmdPlayPanel` 渲染播放 / 暂停 / 选片面板，无 `.vrma` 时优雅降级（面板不显示）
- **3D 内模型切换**：`switchToSession(path)` 复用外壳重建内容层（ADR-066 §5.6），对外暴露为 `switchPreview`；`switchPreview(path, { keepInScene: true })` 同台追加（多角色同框，`MAX_MODELS=8` 上限）；角色面板（🧍 模型组 🎭 roles）列出已加载角色（`sceneRegistry`），支持焦点切换 / 详情 / 卸载 / 追加
- **「➕ 追加」三态语义（ADR-115 行为契约）**：同类型候选 ➕ → `switchTo(p, { keepInScene: true })`（复用当前会话 adapter 追加）；跨类型候选 ➕ → `switchExternal(p, siblings, { keepInScene: true })` → `openModel3DFullscreen({ cooperate })` → 有活跃会话时先比对活跃会话 rtype（`sceneRegistry` entry，兼容 adapter.id / 类型 ID 两种命名）与新路径路由 rtype（preview key 反解）：**同类型 → `switchPreview(path, { keepInScene: true })` 同台追加；跨类型 → 降级「关旧开新」+ toast**（2026-08-30 审核 P3-4 守卫：活跃会话适配器无法解析跨类型文件，直接 keepInScene 会喂错格式；类型探测失败时不降级保持原行为）；行本体点击跨类型 → `switchExternal(p, siblings)`（无 keepInScene）= 替换语义（整段重建）。**红线（ADR-115）**：跨类型追加禁止直接喂当前会话 adapter.build
- **在途作废**：`invalidatePreview()` / `_gen` 防止并发加载竞态

## 对外 API / 入口

- `mount3D(adapter, path, opts?)` — 主入口，`cleanupPreview()` 旧会话后建新
- `cleanupPreview()` / `invalidatePreview()` / `switchPreview(path)`
- **会话收尾不变量（2026-08-30 修复，audit-r16 #4）**：关闭走 `cleanupFn ? fullCleanup : closeOverlay`（互斥二选一），两条路径的**收尾动作必须经 `finishSession()` 单一出口**（幂等，`session.finished` 守卫）：摘 `_handles` → `adapter.onClose?.()` → 释放焦点陷阱 + `returnFocus()`。原因：ESC 早期中断先走 `closeOverlay`（置 `aborted`），build 随后 resolve 时中止守卫会**再次进入** `fullCleanup`，不幂等则 `onClose` 重复触发（调用方 `skeleton.ts` 靠它注销 android-back 与复位 `_is3D`）。配套两条：① `cleanupPreview()` 须**快照遍历** `[..._handles]`——callee 会在遍历中摘除自身，边遍历边删会跳元素（cooperate 多会话只清一半）；② abort 分支须在 `fullCleanup()` **之前**把 `session.built` 补登记进 `allBuilt`（正常登记点在 build 成功之后），否则刚 build 完的内容层不被 dispose（GPU 泄漏）。**注意**：`cleanup-3d.ts` 的 `runFullCleanup` 是更完整的清理实现但**从未被接线**（导入即死代码，见 audit-r16 #5），其 `nullHandle`/`onClose`/焦点释放语义与本地 `fullCleanup` 重叠——若日后统一，必须保住本不变量。
- `buildCameraControls(topBar, bridge)` — 通用相机控件（旋转模式/速度/重置），已收进根菜单 `camera` 项（sharedOnly）
- `mountPreviewRootMenu(overlay, ctx)` → `PreviewMenuHandle`（`dispose`/`setAdapterItems`/`openPanel`/`refreshDock`）+ `PREVIEW_MENU_GROUPS` + `CORE_MENU_ITEMS`（`preview-menu/defs.ts` / `preview-menu/core.ts`）— **ADR-076 v3 声明式根菜单**（顶栏砍掉，⚙️ 按钮 + 弹出菜单，项表驱动；core 项 roles/environment/camera/lighting/shadow/postproc；**适配器项经 `PreviewBuildCtx.menu.setAdapterItems` 注入**；legacyTestId `ysm-close-3d`/`env-menu-btn`/`ysm-roles-entry` + 适配器项 `ysm-model-entry`/`mmd-model-entry` 等保留兼容 e2e）

  **2026-08-19 环境拆组**：环境体量 > 全部场景设置，故将 `environment` 从 `scene` 组拆出，独立成 `env` 组（🌍 环境）。scene 组 icon 换 🎛️ 避免双 🌍 混淆。dock 按钮顺序：🧍 模型 → 💃 动作 → 🌍 环境 → 🎛️ 场景。组内仅一个 panel 项时自动快捷直达面板（不渲染组根视图），故 env 组（单 environment 项）点击直接进环境面板。

  **2026-08-29 ADR-131 统计面板**：核心层 post-build（`mount3D` 注册块）对 `sceneBaseline` 差量 roots 调 `collectSceneStats`（`preview-3d/scene-stats.ts`），经 `mergeStatsMenuItems`（`preview-menu/stats.ts`）合并统计面板进 `menuItems` 后**一次** `setAdapterItems`（合并后一次注入，禁止二次调用覆盖；幂等：`STATS_PANEL_ID` 去重）；switch 路径 `registerSwitchScene` 同样重采统计并合并，`switchToSession` 成功后按新模型 menuItems 刷新 dock（非空注入 / 空清空——审查 C1 修复，此前 dock 残留首模型菜单）；注册表 `menuItems` 另经 roles 详情 / `setActive` 消费。面板节点 `kind: "panel"` + 6 个 field 行，`visibleWhen: (s) => hasSceneStats(stats)` 守卫有统计才显示（铁律：声明式节点可被所有数组类菜单调用）。i18n key `preview.stats.*` 三段式。

  **P2 详情卡补统计行（2026-08-29）**：VRM `readVrmMeta` 在 `deepDispose` 前 `collectSceneStats(vrm.scene)` 顺带采集（零额外成本，`VrmMetaInfo.stats`；顺序守护测试：deepDispose mock 真清几何，挪位即断言失败）；MMD `showMmdPreview` 经 `mmd-detail-stats.ts` 的 `readPmxStats`（Worker 解析 PMX counts + 模块级缓存防重复解析，**键含 b64 长度内容指纹**——同路径文件被替换/重导入后自动重解析不显陈旧统计，上限 64 条防无界增长；仅 `.pmx` 触发、失败降级 null）。**三口径标注**（审核建议 ②）：`preview.stats.panel` =「渲染实测」（traverse 场景图口径，3D 菜单 + VRM 详情卡共用）、`preview.stats.file` =「文件统计」（PMX 解析口径，MMD 详情卡）、YSM 模型面板 = Go AnalyzeBedrockModel 口径——三方区分，避免同屏数字口径困惑。**已知边界**：`.pmd` 老格式不触发文件统计（parser 为 PMX 专属），降级无统计行——非 bug，日后同理。

  **P3 资源包模型清单（2026-08-29）**：Go **新增** `ListPackModelsDetail` 绑定（不破坏 `ListPackModels` 4 处消费者）：`models[{path,cubes}] + total`，cubes 数 JSON `elements`，封顶 `packModelDetailCap=200` 防大包；`generate:bindings -ts` 重生 + web-fs 镜像 `listWebPackModelsDetail` 同构。`showResourcePack` 加「🧊 模型清单 (N)」区（每行 path+cubes，超限显示 total，`esc()` 防 XSS），点击单模型 `createPack3D(path, { startEntry })` 直达 pack-model-adapter 3D（适配器吃 entry path，zip 当虚拟文件夹）。

  **ADR-132 遗留 1 蓝图/litematic zip 容器多 nbt（2026-08-29）**：Go **新增** `ListContainerEntries(path, exts)`（容器内条目枚举，`container.Open` → `Entries()` → 扩展名白名单过滤 → 升序 JSON 数组）与 `GetVoxelDataInContainer(path, entry, ext)`（容器内 gzip NBT 条目读取 → 解耦后的「root→voxel」管线 → 与 `Get*VoxelData` 同形状 JSON，`containerEntrySafe` 守卫防穿越）。**voxel 解耦**：`go/litematic/voxel.go` 三个 `Build*VoxelData` 拆「路径→root」（`openGzRoot`）+「root→voxel」（`Build*VoxelDataFromRoot`），容器内读取复用后者（`OpenGzRootFromBytes` 导出入口），裸文件路径行为零回归。**前端**：`litematic-3d.ts` `createLitematic3D` 对 `.zip` 先 `ListContainerEntries` 枚举（`.nbt,.litematic,.schematic` 白名单）→ 装配 adapter（`containerPath`+`modelEntries`+`entryExt`）→ 初始 entry = 首项，容器内 voxelCall 走 `GetVoxelDataInContainer`（修复原「zip 被当 gzip 打开」坏预览）；**ext 逐条派生（2026-08-30 审核修复）**：voxelCall 按 entry 路径派生自身 ext（`entryExtOf(entryPath)`，命中 VOXEL_RPC_BY_EXT 才用；未知扩展名回退首项捕获值）——mixed-format 容器（`a.nbt` + `x.schematic`）切换各走自身 builder，不再沿用首项 ext 误派发；`litematic-adapter.ts` `buildLitematicScene` 注入 `multiModelSelectNode`（ADR-132 原语，候选 = modelEntries，activeId = 当前 entry，onSelect = `ctx.switchTo`）；空容器/单 entry 退化无 select（裸路径零回归）。**web 镜像**：`web-fs.ts` `listWebContainerEntries` + `readWebVoxelInContainer`（extractZip → findZipEntry → `decodeVoxelNbt` → voxelView）。

  **2026-08-19 下钻箭头**：组根视图（多 panel 列表）中，`kind === "panel"` 的行右侧显示 `>` 装饰性箭头（`data-testid="row-chevron"`），提示该行可点击进入下级面板。action 型行无箭头。渲染见 `makeRow(def, { chevron: def.kind === "panel" })`。
- 契约接口：`PreviewBuildCtx`（外壳句柄 + **`menu: PreviewMenuHandle` 注册通道**）、`PreviewScene`（内容契约：`update`/`dispose`/`resetCamera`/`extraControls`…）、`PreviewAdapter`（`id`/`mode`/`build`/`onClose`）、`PreviewHandle`、`CameraControlBridge`

## 与其他子系统关系

- **适配器**：`ysm-adapter` / `vrm-adapter`（`GLTFLoader`）/ `mmd-adapter`（`@moeru/three-mmd`）/ `litematic-adapter` 各自实现 `PreviewAdapter`，`build()` 进 `ctx.scene`
- **数据层**：YSM 经 `model3d-loader`（`GetModel3DSpec` 唯一事实来源 + WASM 兜底）；MMD 经 `@moeru/three-mmd`；VRM / Litematic 各加载器
- **旧并行链路（已全部删除，勿再建）**：`RenderSession` / `renderModel3D`（ADR-052）曾存在于 `frontend/src/preview-3d/`；render-session.ts（470 行）与 renderer-setup.ts 均随 ADR-052 P2 收尾删除（生产无调用方），`model3d.ts` 缩为 Spec 类型枢纽。程序化天空**仅落统一核心**。

## 不变量

- **`scene.background` 兜底（shared 模式，`mount-preview-core.ts`）**：核心创建 `scene` 并设 `scene.background = new THREE.Color("#1a1b2e")`；所有适配器 mount 进同一 `ctx.scene`
- **天空落点（已实现，ADR-073 L1）**：统一核心在 shared 模式创建 `renderer` 后立即 `new SkyCapability({ scene, renderer }).apply()`（`mount-preview-core.ts`），复用 Three 官方 `Sky`（Preetham 散射）。YSM / VRM / MMD / Litematic 因共用同一 `ctx.scene` **零改动继承**——即「MMD 有天空 → YSM/VRM 自动获得」在 Three 域内的真·自动机制。能力层 `frontend/src/preview-3d/caps/sky-capability.ts` 封装 uniform 管线 + 可选 IBL（`setEnvironmentEnabled`，默认关）+ 会话级 tone mapping（dispose 还原）。`scene.background` 纯色保留为禁用天空时的兜底。
- **self 模式**（`adapter.mode === "self"`，如个别单例）：核心仅提供外壳、不创建 `scene`，背景由适配器自管
- **dock 🧍 模型组按钮恒定直达 roles 面板（2026-08-22 收口，commit e8d6f5aa）**：`renderDock` 模型组**不再**按 `sceneRegistry` 是否为空分流。生产环境每个 `built` 都经 `mount-preview-core.ts` 注册进 `sceneRegistry`，故注册表恒非空——原「无角色→组根视图」兜底分支是**死分支**，且会导致加载模型后 🧍 显示旧组根菜单（与 FAB 直进 roles 不一致）。🧍 永远走 `makePanelView(rolesDef)` 直接开角色面板（角色管理 + 内嵌加载入口 `fillSwitch`）。单模型实例工具（模型信息/截图/骨骼/材料）保留 `dockGroup:"model"` 不变，由 `roleDetailView` 按 `dockGroup==="model"` 过滤，从 dock 根**下沉到角色详情内可达**——YS'M+PMX 同台时天然自洽，且多蓝图/投影等注册的实体也能经各自详情卸载（复用类型无关的 `unloadRole`）。

## 验证状态与迭代清单（2026-08-19）

- **ADR-076 v3 声明式根菜单（Phase 1+2 已落地，Phase 3 待立项）**：
  - **Phase 1**：顶栏整块砍掉，预览控件收进 overlay 内 ⚙️ 根菜单（`PREVIEW_MENU_DEFS` 表驱动，对齐 ADR-021 范式）。`mount3D` 内 `mountPreviewRootMenu(overlay, ctx)` 挂 ⚙️ 按钮（`preview-menu/btn`）+ 弹出（`ysm-preview-menu`）；`close` 复刻原 `closeBtn` 分支（`cleanupFn?fullCleanup:closeOverlay`），`fullCleanup` 内 `menuHandle.dispose()` 解绑 `document` 监听；`switchTo` 成功后 `currentPath = newPath` 同步高亮。三语 locale 补齐 7 键。
  - **Phase 2**：ysM/mmd 底部导航脚手架删除（`buildYsm/MmdBottomNav` + `mkNavBtn` + 两份 togglePopup/closePopup），适配器经 `PreviewBuildCtx.menu.setAdapterItems` 注入专属项——ysM：model/截图/骨骼；mmd：model/材质/播放（+ADR-077 bones 并行落地经仲裁收编）。切换归 core switch 项、相机归 core camera 项，消灭双入口。测试：`preview-menu.test.ts` 新增（14 例）+ `preview-menu/items.test.ts`（24 例全绿）。顺带修复 ysm 两处现存缺陷（navBuilder 死参数——底部导航从未挂载；骨骼按钮点击找不存在的 `#ysm-3d-panel`——无效）。
  - **Phase 2 后续（2026-08-19）**：
    - **环境拆组**：environment 从 scene 组拆出，独立为 env 组（🌍 环境），场景组 icon 换 🎛️。dock 按钮顺序：🧍 → 💃 → 🌍 → 🎛️。组定义 `PREVIEW_MENU_GROUPS` 新增 `{ id: "env", icon: "🌍", fallback: "环境" }`，`PreviewMenuGroupId` 扩展 `"env"`。`CORE_MENU_ITEMS` 中 environment 项 `dockGroup` 从 `"scene"` 改为 `"env"`。地面/水面系统后续继续膨胀时，往 env 组加 panel 项即可（组内多 panel 自动走组根视图 → 下钻导航）。
    - **下钻箭头**：panel 型行右侧加 `>` 装饰性箭头（`data-testid="row-chevron"`），提示可点击进入下级面板。`makeRow(def, { chevron: def.kind === "panel" })` 实现，action 型行无箭头。
    - **入口合并（2026-08-21）**：独立 `switch` 项（🔁 切换模型，legacyTestId `mmd-switch`）撤除——其面板（`fillSwitch`：类型 tab + siblings + 手动路径）本是角色面板底部的内嵌加载入口，双入口属重复。模型组 core 项仅余 `roles`（无适配器项时 dock-model 单 panel 快捷直达）；`needsSiblings` 字段随之删除；i18n 键 `preview.switchModel` 三语移除。后续「最近加载」类候选源应作为 `fillSwitch` 的新类型 tab 接入（行渲染/样式复用），勿另起面板。
  - **Phase 3 待立项**：vrm/litematic `extraControls` 单按钮（骨骼/分层/切换）收编为菜单项后删除 topBar 容器；ADR-074 S2 VRM 骨骼面板已接 UI（topBar 骨骼按钮开关面板，经 `makeBonePanelRenderer` 通用外壳），ysm 骨骼面板同构落地（ADR-077）。
  - **dock 🧍 模型组统一为 roles 入口（2026-08-22，commit e8d6f5aa）**：删掉 `renderDock` 模型组基于 `sceneRegistry` 是否为空的 if/else 分流补丁——生产恒非空使其成死分支，且造成加载模型后 🧍 显示旧组根菜单（与 FAB 直进 roles 不一致）。🧍 永远快捷直达 roles 面板；单模型实例工具（模型信息/截图/骨骼/材料）保留 `dockGroup:"model"`，下沉至角色详情（`roleDetailView` 按该字段过滤）可达。litematic 蓝图切片同步从 `ctx.menu.setAdapterItems`（dock 平铺 sink）搬家到 `buildLitematicScene` 返回值 `menuItems: sliceItems`（角色详情 sink），使蓝图注册进 `sceneRegistry` 的 entry 携带切片、可在其详情内显示与卸载。测试契约见 `preview-menu.test.ts` / `preview-menu/items.test.ts`。
  - **声明式类型层 + 通用渲染器（方案 A，2026-08-25，commits 8005f64e / 62f82445）**：从 MikuMikuAR `menu-node-types.ts` 移植 `PreviewMenuNode` 声明式节点类型（`preview-menu/node-types.ts`，纯类型叶零运行时）——含 `folder` 递归（`children`）/ `visibleWhen` 守卫 / `renderCustom` 逃生舱 / `action` 回调 / `dockGroup`·`sharedOnly`·`requiresEnvironment`（ysm 特有字段）；契约测试 `preview-menu/node-types.test.ts`（6 例）。配套通用递归渲染器 `renderMenu(container, nodes, deps)`（preview-menu/core.ts 模块级）：folder→可折叠 section（testid=`node.id` / `-body`，兼容既有 e2e）、panel/action→行（复用 makeRow/navigate/run）、divider/sectionTitle→轻量行。`roleDetailView` 模型/动作两 section 改为 `PreviewMenuNode` 声明树驱动，删除命令式 `renderRoleSection`。**迁移路径**：新菜单项优先写 `PreviewMenuNode`（可嵌套、可守卫），存量 flat 项经 `renderCustom` 逃生舱过渡；`PreviewMenuItemDef.render`→`renderCustom`、`run`→`action`（closePopup 必选→可选，包装兜底）。预览菜单从「壳声明式 + 肉命令式」走向「全声明式」。
  - **公共映射 previewItemToNode（方案 A 第 3 步，commit 86208061，**已删**）**：曾是 `PreviewMenuItemDef`→`PreviewMenuNode` 单向映射。方案 A 收尾（commit e0aab996）统一整条链路为 `PreviewMenuNode`，`previewItemToNode` 和逆向 `nodeToDef` 一并删除——往返转换是有损的（`children`/`visibleWhen`/`control` 被静默丢弃，`action` 的 ctx 被打成 no-op 桩）。
  - **详情=模型信息面板本体（方案 A 第 4 步，commit adf60576）**：`roleDetailView` 目标态落地——model 组第一个 panel（三适配器恒为「模型信息」）`renderCustom` **直渲进详情主体**（1 跳看内容，响应「模型信息最想进入」）；其余 model 项（截图/材质/骨骼）→ 详情内「工具」可折叠 section（`preview-role-tools`，不再平行平铺）；motion 组保留「动作」section（dock 🧍 默认折叠 / dock 💃 直达展开且模型主体隐藏）；「切换角色 ›」从详情顶部移到底部工具行（`role-switch` action 节点，经 renderMenu 渲染，testid 自动补 `preview-` 前缀故 node id 不带前缀）。roles.test 3 处旧 section 契约翻转（断言模型本体直渲/工具区/动作聚焦）。
  - **dock 🧍 = 角色列表入口（第 5 步，commit 659e6308，实测反馈修正）**：dock 🧍 点击**恒进 roles 角色列表**（加载/切换模型入口），**不再**因活跃角色有 menuItems 而直达详情——用户实测「点模型按钮跳 ysm 模型介绍而非切换模型」反直觉（B 的「🧍 1 跳直达详情」UX 决策反噬），切换模型被迫绕二级；列表点角色名同样 1 跳进详情且切换不绕路。💃 动作组保持直达详情（聚焦动作 section）。fillRoles 点角色名进详情本就不传 onSwitchRole（slide-menu ← back 返回列表）。
  - **camera self 模式守卫（commit 7cb10aec）**：`PreviewMenuNode` 加 `hideInSelfMode?: boolean`（self 模式隐藏），camera 项置 true——self 模式相机由适配器自驱（如 MMD 相机动画每帧覆盖），camBridge 控件（旋转/速度/重置）操作核心 controls 被覆盖呈现「无效空面板」，隐藏最诚实。renderDock 过滤链加 `.filter(d => !(d.hideInSelfMode && ctx.selfMode))`。self 模式 scene 组仍显（lighting/shadow/postproc 保留）。
  - **roleBaseName 剥扩展名（commit 1fcf6427）**：详情/列表/工具面板标题统一去扩展名（`lastIndexOf(".")` 剥最后一段 .ext，保留带点版本号如 1.2）——`a.ysm→a`、`foo.json→foo`、`bar.zip→bar`、`[vup]xxx.zip→[vup]xxx`。用户实测 `ysm.json` 当标题反直觉：entry.path 指向包内入口文件时 basename 暴露无意义技术文件名。roleBaseName 已导出供测试。
  - **替换/追加不关菜单（commit d6a390ce，2026-08-26 优化）**：fillSwitch 行本体（替换）与 ➕（追加）去掉 `closePopup`——替换不清场景、不关菜单。**不调 `menu.refresh()`**：全量重建会清空列表滚动位置 + 详情面板状态（`ui-slide-menu.ts renderTop` 内 `list.innerHTML = ""`），体验崩。✓ 高亮在下次打开面板时自动归位（`getCurrentPath` 已更新）。`ctx.switchTo` 类型改为 `Promise<void> | void`，mount 层透传 handle.switchTo 的 Promise；fillSwitch 增 menu 参数（保留但仅用于 isShowing 守卫等场景）。跨类型 switchExternal 整段重建 overlay 时 refresh 也是 no-op，此处统一忽略。
  - **替换误判跨源 cleanupPreview 根因（commit 32b628ff，诊断日志实锤）**：fillSwitch 路由判定 `sameType=false` 因 `curType=empty`——`mount getCurrentRtype` 用 `??` 回退，但 `opts.rtype` 空串时 `"" ?? adapter.id` 返回空串 → 所有 `.ysm` 候选 `"ysm"===""` 判 false → 走 `switchExternal` → `cleanupPreview` 整段销毁（「替换角色后界面被关」「空白页加载也关」「连续查看模型被打断」的根源）。修复双处兜底：① `getCurrentRtype`（mount 两处）空串/空白也回退 adapter.id；② `sameType` 判定 curType 空但 candType 可识别 → 视为同源走 switchTo（歧义候选 candType=null 仍保守跨源）。roles.test 替换测试加 switchExternal spy 回归防护（模拟空 rtype，断言不触发跨源）。

- **方案 A 收尾（2026-08-25，commits 45523202 / e0aab996）**：整条链路统一为 `PreviewMenuNode`——`CORE_MENU_ITEMS` 改为 `PreviewMenuNode[]`，`setAdapterItems` 直接存 `PreviewMenuNode[]` 不再转换。`nodeToDef`（有损逆向映射）和 `previewItemToNode`（正向映射）一并删除，净 -126 行。正确性收益：`children`/`visibleWhen`/`control` 不再被静默丢弃。CSS 类抽取：`ensureMenuStyles()` 幂等注入 `.cap-section-header`/`.cap-section-arrow`/`.menu-divider`，`renderMenu` 内联 `style.cssText` 改 `className`。空桩收敛：五处内联 `{ toast:()=>{}, setStatus:()=>{}, closeAllOverlays:()=>{} }` 收敛为模块级 `noopActionCtx` 常量。**注**：`PreviewMenuCtx` 仍无 `toast`/`setStatus`/`closeAllOverlays` 字段，适配器动作目前拿 `noopActionCtx` 空桩——接真 ctx 是下一台手术。
  1. ✅ **新菜单项硬截止**：已完成。
  2. ✅ **全量迁面板**：已完成。
  3. ✅ **删往返转换**：`nodeToDef`/`previewItemToNode` 已删（commit e0aab996）。
  4. 🔄 **补 renderMenu 单测**：4 例 + 契约测试，仍缺 folder 折叠/visibleWhen 假值边界。
  5. ✅ **稳定双轨交互**：已完成。

- **L1 程序化天空已落地并目视验证**：`task dev` / `npm run dev:web` 跑通，天空渲染正常、四种模型（YSM/VRM/MMD/Litematic）零改动继承。用户评定「效果一般但能跑，作为基线收口，后续迭代」。
- **基线参数**（`sky-capability.ts` 默认值）：`scale 12000`（相机 maxDistance 5000 留余量）、`turbidity 10 / rayleigh 2 / mieCoefficient 0.005 / mieDirectionalG 0.8`、`cloudCoverage 0`、默认太阳方位、`ACESFilmicToneMapping` + 曝光 0.5（会话级，dispose 还原）、IBL `scene.environment` 默认关。**v1.14 调优后**，按模型类别预设（`MODEL_SKY_PRESETS`）覆盖默认值：VRM turbidity→7、MMD exposure→0.55、YSM exposure→0.55，其他不变。
- **已知观感短板（后续迭代项，非阻断）**：
  1. ✅ 时间-of-day 滑块已收进**环境菜单**（🌍 环境根按钮 → 快捷直达面板，与云量/IBL/地面开关并列；`preview.timeOfDay` i18n 三语，代码层 `tr` 兜底）；默认 9:00；`oninput` 经闭包 `skyCap?.setTime(hour)`，0-24 映射日出/正午/日落，夜间转暗；
  2. ✅ IBL 已默认开启（`environment: true`，2026-08-16 目视验证通过，模型反射/环境光更真实）；如需关闭调 `setEnvironmentEnabled(false)`；
  3. ✅ 按模型类别散射/曝光预设已落地（`MODEL_SKY_PRESETS` 表 + `setPreset(adapter.id)`：ysm/vrm/mmd/litematic 各自 turbidity/rayleigh/exposure；数值为初始合理值，待目视微调）；
  4. ✅ 云量滑块已收进**环境菜单**（`skyCap.setCloudCoverage(v)`，0-1 映射晴空→多云，oninput 实时改天空、onchange 松手刷新 IBL；`preview.cloudCoverage` i18n 三语，代码层 `tr` 兜底）。重构背景：原顶栏滑块被批「塞垃圾」，统一收进 🌍 环境根菜单面板（环境独立成组后，地水系统同样收进此面板，不再挤占场景组）；三语键 `preview.envMenu/timeOfDay/cloudCoverage/environmentLight` 已入库，但保留 `tr` 代码兜底防并行 locale 竞争退化显示原始键名。
  5. ✅ **下钻箭头**：组根视图中 panel 型行右侧加 `>` 装饰箭头（`data-testid="row-chevron"`），与「🌍 环境组单 panel 快捷直达（不显示组根视图）」配合——多 panel 组（如 🎛️ 场景）的 camera/lighting/shadow/postproc 行均有箭头，提示可点击进入下级面板。

> **已知坑（构建期 capability 引用）**：环境菜单在 `if(!selfMode)` **之前**构建，此时 `skyCap`/`groundCap` 尚未赋值（仍为 `null`）。正确模式已改**getter 式 `PreviewMenuCtx`**（`preview-menu/core.ts`）：菜单项表通过 getter 在菜单渲染时按需取值，规避构建期 `null` 收窄报 `Property does not exist on type 'never'`；字面量默认值（time=9、IBL=true）只作为初始 UI 显示值，交互处理器写在 `oninput`/`onChange` 闭包内用 `skyCap?.`。地面行 `value: true`、IBL 行 `value: true` 即此口径。

## 已知遗留（2026-08-29 a11y 审查登记）

- **`Space=up` 吞按钮激活**（`input-and-animation.ts`）：`up` 动作绑 `Space`，`onKeyDown` 对命中动作 `preventDefault`——3D 面板内焦点在某 button 上按空格，会被相机消费吞掉该按钮的键盘激活。当前被输入阻断栈（菜单打开 `isInputBlocked()` 提前 return）掩盖，未爆。修复方向：`isEditableTarget` 之外再加「焦点在可交互元素（button/a/role=button）时不消费 Space」判定。
- **`ARROW_TO_ACTION` 方向键双轨硬编码**：Arrow/NumPad 恒映射平移动作，用户自定义键位后方向键仍强制生效、不可禁用/改绑——"自定义键位"之上叠了一层绕过 keymap 的隐藏映射。与 ADR-036（3D 操作键位）的"键位可配置"语义存在张力，后续若做键位导入/导出须一并治理。
- 输入阻断栈（`pushInputBlock`/`popInputBlock`，`utils/dom/focus-restore.ts`）当前无"嵌套阻断源计数"——同一 id 重复 push 后 pop 一次即清（`popInputBlock` 按 `lastIndexOf` 删单条）。3D 菜单 + 叠加浮层场景靠调用方自行配对，未做栈深度守卫。

## 相关

- `model3d.md`（3D 渲染层基础设施卡：Spec 类型枢纽 + 坐标口径 + 渲染管线，单会话架构）
- `app-preview.md`（预览面板组件：2D 骨骼 / 3D / 缩略图）
- 程序化天空落地见本卡「不变量」（能力层 `frontend/src/preview-3d/caps/sky-capability.ts`，经统一核心 shared 模式注入；旧 renderer-setup.ts 为死代码已删除不触碰）
