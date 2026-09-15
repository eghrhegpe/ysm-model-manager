---
kind: preview_core
name: 统一 3D 预览核心 preview-core
tier: architecture
adr:
  - ADR-125
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/
  - frontend/src/preview-3d/bone/bone-tools.ts
  - frontend/src/preview-3d/caps/sky-capability.ts
  - frontend/src/preview-3d/caps/ground-capability.ts
  - internal/app/container_entries.go
  - go/litematic/voxel.go
  - frontend/src/backend/web-fs.ts
auto_fields:
  symbols_with_lines:
    - _clearPmxStatsCache
    - _resetSingletons
    - AddOpLog
    - AllocEntry
    - App.GetVoxelDataInContainer
    - App.ListContainerEntries
    - applyModelDefaults
    - applyPostProcDefaults
    - applyVPDToMesh
    - applyWorkerDecodedTextures
    - AssembledShell
    - AutoDanceOptions
    - BaseScene
    - BeatDetectorLike
    - BeatDetectorOptions
    - BlinkCallback
    - BlinkOptions
    - BoneDetail
    - BoneListItem
    - BoneNode
    - boneRowActiveBg
    - BoneTree
    - buildBoneTree
    - BuildCtx
    - buildFbxScene
    - buildFbxSceneFromData
    - buildLipMorphIndices
    - buildLitematicScene
    - buildMmdScene
    - BuildNbtVoxelData
    - BuildNbtVoxelDataFromRoot
    - buildPackScene
    - buildPmxScene
    - BuildSchematicVoxelData
    - BuildSchematicVoxelDataFromRoot
    - buildSharedInfra
    - buildVmdRetargetClip
    - BuildVoxelData
    - BuildVoxelDataFromRoot
    - buildVrmBoneNodes
    - buildVrmBoneTree
    - buildVrmScene
    - buildYsmScene
    - CameraControlScene
    - captureTextureName
    - cleanupPreview
    - clearSceneCaps
    - closeOverlay
    - closeUnusedDecodedBitmaps
    - collectAllWebEntries
    - collectVmdBoneNames
    - concurrentMap
    - createAutoDanceController
    - createBeatDetector
    - createBlinkController
    - createBreathController
    - createFbxParser
    - createGazeController
    - createLipSyncController
    - createPerceptionPauseRef
    - createPmxParser
    - createTextureDecoder
    - DecodedTexture
    - detectFormat
    - detectFormatCtx
    - DISPOSE_TEX_KEYS
    - disposeMmdMesh
    - disposeTextureDecoder
    - Error
    - estimateTexGpuBytes
    - estimateVrmHeight
    - FBX_TARGET_MAX_DIM
    - FbxAdapterDeps
    - FbxDataPort
    - FbxGeometryData
    - FbxMaterialData
    - FbxMeshData
    - FbxParser
    - FbxParseRequest
    - FbxParseResponse
    - FbxScaleInfo
    - FbxSceneBuilderConfig
    - FbxSceneData
    - fbxSceneToData
    - FbxSkeletonData
    - filterAnimFiles
    - findAncestorBoneId
    - getBoneDetail
    - getBonePath
    - getBonePosition
    - getCustomAnimPath
    - getSceneCaps
    - getTextureDecoder
    - GroundCapability
    - GroupedScene
    - guardSessionAlive
    - hasActivePreview
    - importWebFiles
    - injectSkySunScalePatch
    - InstalledPreviewInfra
    - invalidatePreview
    - isLikelyTga
    - LipSyncCallback
    - LipSyncOptions
    - ListAllFilePaths
    - listBonesWithDepth
    - LITEMATIC_SLICE_SCHEMA_ID
    - LitematicAdapterDeps
    - LitematicBuildOpts
    - LiveSessionEntry
    - makeBonePanelRenderer
    - makeFbxAdapter
    - makeLitematicAdapter
    - makeMmdAdapter
    - makePackAdapter
    - makeVrmAdapter
    - makeYsmAdapter
    - makeZipOverlayPort
    - matTexSlots
    - MatTexSlots
    - MAX_CHAIN_DEPTH
    - MmdAdapterDeps
    - MmdDataPort
    - mmdDiag
    - mmdMenuItems
    - MmdMenuItemsOpts
    - MmdPanelHooks
    - MmdZipConfig
    - mount3D
    - Mount3DOptions
    - MountCtx
    - MpSessionState
    - MultiLipSyncCallback
    - normalizeFbxScale
    - OpenGzRootFromBytes
    - ownHandle
    - PackAdapterOpts
    - PackDeps
    - packMenuItems
    - PackMenuItemsOpts
    - packTextureLabel
    - ParsePmdCtx
    - parsePmdStage
    - ParsePmxCtx
    - parsePmxStage
    - PerceptionPauseRef
    - pickBone
    - PMX_MAT_FLAG_DOUBLE_SIDE
    - PmxBoneData
    - PmxBuilderConfig
    - PmxBuildResult
    - PmxDisplayFrameData
    - PmxFaceData
    - PmxFileStats
    - PmxJointData
    - PmxMaterialData
    - PmxMorphData
    - pmxObjectToResponse
    - PmxParser
    - PmxParseRequest
    - PmxParseResponse
    - PmxRigidBodyData
    - PmxVertexData
    - PoseScene
    - prepareMmdZipInput
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - ReadFileBytes
    - readPmxStats
    - readVrmMeta
    - readWebFile
    - removeOwnHandle
    - RenderVrmBonePanel
    - resetSceneInfra
    - resolveMmdZipConfig
    - resolveVmdBindings
    - rewriteVmdTracks
    - runFailedMountCleanup
    - runFullCleanup
    - scaleForHeight
    - scanAllWebModels
    - scanWebModels
    - sceneInfraHost
    - SceneInfraHost
    - ScreenshotScene
    - SemanticScene
    - sessionLedger
    - SessionLedgerHost
    - SessionLifecycle
    - SessionStatus
    - setBoneNodeVisible
    - SharedInfra
    - SkyCapability
    - Stage1bCtx
    - Stage1Ctx
    - Stage1Input
    - Stage2Ctx
    - Stage2LoadingManager
    - Stage3Ctx
    - Stage3SceneMesh
    - Stage4Anim
    - Stage4Ctx
    - Stage5Ctx
    - Stage5Menu
    - Stage6bCtx
    - Stage6Ctx
    - Stage6Result
    - SwitchContext
    - switchPreview
    - switchToSession
    - syncLightTargetFromContent
    - teardown
    - TeardownLevel
    - teardownSharedInfra
    - TexDecodeConfig
    - TexDecodeRequest
    - TexDecodeResponse
    - TEXTURE_EXTS
    - TextureDecoder
    - toggleBoneVisible
    - trackAlloc
    - typeFromWebDir
    - unloadSessionModel
    - UpdateableScene
    - VMD_POSITION_SCALE_DEFAULT
    - VMD_REFERENCE_HEIGHT
    - VMD_RETARGET_CANDIDATES
    - VMD_RETARGET_UNMAPPED
    - VMD_ROOT_TRANSLATION_CANDIDATES
    - VmdBindingPlan
    - VmdHumanoidRig
    - VmdRetargetOptions
    - VmdRetargetResult
    - VrmAdapterDeps
    - VrmBonePanelCtx
    - VrmDataPort
    - vrmMenuItems
    - VrmMenuItemsOpts
    - VrmMetaInfo
    - vrmMetaSummary
    - VrmMetaSummary
    - VrmModelInfoCtx
    - VrmPanelHooks
    - webFsBindings
    - workerMmdUpdateWithMixer
    - YsmAdapterOptions
    - ysmMenuItems
    - YsmMenuItemsOpts
    - YsmPreloadedModel
    - zipFindEntry
tests:
  - frontend/src/preview-3d/adapters/mmd/mmd-adapter.test.ts
  - frontend/src/preview-3d/adapters/ysm-3d.test.ts
  - frontend/src/views/app-preview/litematic-3d.test.ts
use_when:
  - 3D 预览
  - 统一预览外壳
  - 程序化天空 / sky / 背景 / scene.background
  - PreviewAdapter 适配器
  - 全模型预览（YSM / VRM / MMD / Litematic）
  - mount3D
perf:
  - gpu-bound
invariant_anchors:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|mount3D
  - frontend/src/preview-3d/adapters/shared-infra.ts|sceneInfraHost.scene.background
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
  - 截图入口走 shotNodes 菜单闭包，禁止往 PreviewHandle 透传 screenshot（2026-09-04 死透传已删）
pitfalls:
  - 「frontend/src/preview-3d/menu/core.ts」跨类型追加走错适配器 → 必须经 switchExternal → openModel3DFullscreen(cooperate)
  - 「skeleton.ts」异步回调写入已卸载 DOM → 每个 await 后检查 container.isConnected
  - 「vrm.humanoid.update()」手动调用导致 T-pose 回归 → 只用 vrm.update(dt)
---

# 统一 3D 预览核心 preview-core

> **架构事实已迁移至 **[architecture.md#71-统一预览核心adr-066)](../architecture.md#71-统一预览核心adr-066)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 概览

`frontend/src/preview-3d/adapters/mount-preview-core.ts` 是**所有富格式 3D 预览的单一事实外壳**——持有单实例 renderer / scene / camera / OrbitControls / rAF 循环 / 灯光 / 场景能力注册表。内容差异经 `PreviewAdapter.build(ctx, path)` 挂进同一 `ctx.scene`，外壳不感知内容格式（YSM/VRM/MMD/Litematic/FBX/maid 统一走 `mount3D(adapter, path, opts?)`）。

## 核心职责

- **外壳装配**（`mount3D`）：cleanup 旧会话 → `sceneCapabilityRegistry.createAll()` 创建 10 个能力（天空/地面/水面/环境/雾/阴影/反射/后处理/灯光/渲染模式）→ `adapter.build(ctx, path)` 挂内容层 → 相机取景 → 注册 rAF 循环 + ESC handler + 菜单 + 输入监听 + focus trap
- **会话切换**：`switchPreview(path)` 复用外壳重建内容层（`switchPreview({ keepInScene: true })` 同台追加多模型，计数上限 8 + **GPU 负载实测预算**（刀⑩ 立、刀⑪ 补强、刀⑬ 补全口径：`infra/gpu-budget.ts|guardGpuBudget` 统一判定 **4 维**——draw calls / `triangles` / 纹理数 / `textureBytes`。字节维度取**双口径较大的那个**：场景图快照（`infra/texture-bytes|estimateSceneTextureBytes`，由 `register-built-scene` 于构建后写入，**覆盖 MMD/VRM/FBX 等不进池的格式**）与池累计（`textureCache|getTotalBytes`，覆盖已 acquire 未挂场景的 YSM/pack 纹理）。超限 toast 附实测值；`MAX_MODELS` 保留为兜底硬顶。预算上限取 `gpu-load-calibrate|resolveGpuLoadLimits()`：真机标定值优先（clamp 到默认 ×0.1~×10 防自锁）、缺省回落 `DEFAULT_GPU_LOAD_LIMITS`））；跨类型 / 关旧开新走 `openModel3DFullscreen`
  - **两条入口共用一道门**：`switch-preview|beginSwitch`（keep 追加通道，inFlight 置位前判不卡死）与 `mount-preview-core|mount3D`（**直挂通道**——无活跃会话时 preview-library 的 cooperate 退化为直挂，超限走 `runFullCleanup` 完整回收）。缺一条即「某路径裸奔」，勿只加一侧。
- **生命周期清理**：
  - `runFullCleanup(ctx)`：**完整关闭**语义——拆 overlay + 解绑输入监听 + 拆菜单 + 停 rAF + 清内容层 GPU + 清场景能力 + `textureCache.disposeAll` + `clearSingletons` + **`setPerceptionPaused(false)` 复位感知暂停标志**（防 adapter 崩溃/切模型残留冻结下次 mount，属模块级单例无属主，须由会话完整关闭路径复位；见 `perception.md`） + `finishSession`。ESC / abort / 正常退出走这里
  - `runFailedMountCleanup(ctx)`：**build 失败路径**——保留 overlay（上展示 `showLoadFailure` 错误提示），不清场景能力/纹理缓存（可能被其他活跃会话共享）——只解绑输入监听 + 拆菜单 + 清 tip 定时器 + `removePerFrame` + `stopIfIdle`。catch 段调用（escH 解绑已归位 `teardown` 共用区，**调用方不再手动补**——刀⑰ 见 `frontend_design_critique`）
  - `closeOverlay(ctx)`：**早期关闭**（build 尚未成功，cleanupFn 未赋值的 ESC 出口）——aborted/disposed 置位 + 拆 escH + 拆菜单 + 拆 overlay + `finishSession`
- **构建后注册统一管线**（`register-built-scene.ts`）：mount 初载与 switchTo 共用「差量捕获 roots → collectSceneStats 统计合并统计面板 → sceneRegistry.register」单一实现（2026-09 锐评 P1-2 收敛）；switch 无快照兜底分支（极简注册不带菜单/骨骼元数据）不在此列
- **多模型管理**：`sceneRegistry` 存每模型 `roots/visible/content/boneMaps/menuItems`；`fitCameraToRoots(visibleRoots())` 相机框可见模型；统一拾取器（`count >= 2` 激活）沿父链反查归属。**visible 持久化**（2026 锐评 P1）：`setVisible` 经 `safeSet("ysm:model-visible:<path>", "1"/"0")` 落盘（隐私模式静默降级），register/去重重载经 `safeGet` 恢复隐藏态——隐藏模型同时被 `arrangeModelsInGrid` 排布与 `fitCameraToRoots` 取景排除

## 对外 API / 入口

- `mount3D(adapter, path, opts?)` — 挂载入口，返回 `Promise<PreviewHandle>`（`cleanup`/`switchTo`/`resetCamera`/`setSpeed` 等）
- `runFullCleanup(ctx)` / `runFailedMountCleanup(ctx)` / `closeOverlay(ctx)` — 三个清理出口（详见核心职责）
- `cleanupPreview()` — 旧会话清理（`mount3D` 入口先调）
- `switchPreview(path, opts?)` — 会话内切换
- `hasActivePreview()` — 活跃会话判定
- 契约接口：`PreviewBuildCtx`（外壳句柄 + menu 通道）、`PreviewScene`（内容层，ADR-178 拆为 `BaseScene` + 能力接口组合）、`PreviewAdapter`（`id`/`mode`/`build`/`onClose`）

## 与其他子系统关系

- **adapter 矩阵**（`preview-3d/adapters/*.ts`）：6 格式（YSM/VRM/MMD/Litematic/FBX/maid），统一 `PreviewAdapter` 契约，`withPreviewExtras()` 注入 `switchExternal` / `getModelsByType` / `getTypeTabs`
- **skeleton 2D 层**（`views/app-preview/skeleton.ts`）：`loadModel2D` 渲染骨骼线框图，2D→3D 升级走 `_toggle3D` → `createYsm3D`；`_active3DClose` 模块级单例钩子（全局同时只允许一个活跃 overlay）；`_prevAbort` 管理 2D 拖拽 window 监听（AbortController，非手动产消）
- **preview-library 路由**（`views/app-preview/preview-library.ts`）：`openModel3DFullscreen(path, { cooperate? })` 类型探测 → 注册表反向注入派发 opener；`scanModelsByType` 懒加载类型 tab 候选；`registerReRoute` / `getRegisteredRoutes` 破循环
- **Go 绑定**：`GetModel3DSpec`（spec 数据）、`DetectResourceType`（类型探测）、`FindPreviewImage`/`ExtractPreviewTexture`（预览纹理）、`SaveCachedTexture`（KTX2 缓存落盘）

## 不变量

- **外壳单例**：renderer/scene/camera/controls/rAF 循环全局唯一，`clearSingletons()` 只在 `runFullCleanup` 完整关闭时调用——`runFailedMountCleanup` / `switchTo` 不动单例
- **escH 可变引用**：switchTo 后旧 handler 被替换，cleanup 必须按**当前引用** remove；移除顺序必须先 save 旧引用再替换，否则移新函数（从未注册）旧函数仍残留
- **escH 解绑三档统一**（刀⑰）：`teardown` 的 `early`/`failed`/`full` 三档在共用区首段统一解绑 escH，**调用方不再各自补**——escH 闭包捕获整个 `ctx`，任一档漏解绑即跨会话泄漏 + 会话已拆但 ESC 仍触发陈旧 handler；曾由 `recoverMountFailure` 手动补（责任错配），新增 failed 调用点易忘。回归守卫见 `mount-preview-core.test.ts`（直数 document 监听器存活数）
- **能力注册表 `saveAll/dispose` 只在 `runFullCleanup`**——build 失败路径不清（可能共享）；`evictZeroRefIfNeeded` 只淘汰 `refs===0` 条目，已 dispose 纹理禁止再次 dispose（LRU 失效）
- **会话清理分工**：abort/gen 打断走 `runFullCleanup`（已登记 allContent → 需补登记 content 防 GPU 泄漏）；build 抛错走 `runFailedMountCleanup` + 调用方清 scene 差量（escH 已由 `teardown` 统一解绑，调用方不再负责）
- **GPU 预算门的两条时序约束**（`mount-preview-core.ts|mount3D` 直挂路径，刀⑪ 立门 / 刀⑫ 语义修正 + 前置化）：
  ① **必须 gate 在 `hasActivePreview()`**——本门读 `renderer.info` 的**上一帧**统计，而本次要加载的内容**尚未构建**；无残留会话时读到的是「刚新建的空 renderer」（全 0，白判）或「上一会话的陈旧指标」（拿旧负载拦新会话，归因错误）。只有确有未释放负载时拦，语义才成立。
  ② **必须在装配（`buildInfra`）之前判**——否则拦截时需回收**半装配**外壳（overlay/菜单/输入/rAF），而 `runFullCleanup(ctx)` 只结算**本次**会话，被 `clearSingletons` 摘掉 overlay 的残留会话 handle 仍留在台账里成**僵尸**（`hasActivePreview()` 仍 true 但外壳已拆）。前置到装配前，本次无状态可回收，直接 `cleanupPreview()`（「全部关闭」语义）一步收干净。
  ③ 背景：无活跃会话时 preview-library 的 cooperate 退化为 false → 走直挂路径而**不经** `switch-preview|beginSwitch` 的 keep 通道，曾是无预算门的不对称缺口——**两条入口共用一道门，缺一条即某路径裸奔**。
- **外壳 DOM 装配分段（assembleShell 拆分，2026-09）**：`mount-preview-core.ts|assembleShell` 原 208 行单函数（混 input 状态 / overlay 单例 / camBridge / viewContainer / 根菜单五件事）已拆为编排层 + 四个具名子函数：`ensureOverlayShell` / `makeCamBridge` / `ensureViewContainer` / `mountRootMenu`。**跨段引用约束**：`mouseDown`（`{v}` 容器）由 `assembleShell` 创建后作参数下传——`camBridge.setOrbit` 与 `bindInputHandlers` 必须持**同一引用**，勿在子函数内重建；`ensureViewContainer` 兜底补建 body 时必须**返回权威引用**（调用方用返回值，勿用传入快照），`buildInfra` 的 tip 锚点亦改为经 `root.querySelector(".mpc-body")` 现取而非复用 `shell.body` 快照（原实现用快照，body 补建场景下 `insertBefore` 抛 "node is not a child of this node"）。
- **focus trap**：`finishSession` 释放焦点陷阱 + `returnFocus()` 归还触发元素焦点，幂等（二次进入 return）

## 相关

- `frontend/src/preview-3d/adapters/` — 全部适配器 + 外壳
- `frontend/src/preview-3d/caps/` — 10 个场景能力
- `frontend/src/views/app-preview/skeleton.ts` — 2D 骨骼渲染 + 单例 3D overlay 钩子
- `frontend/src/views/app-preview/preview-library.ts` — 3D 全屏路由
- 知识卡：`app_preview`、`model3d`、`3d_patterns`、`pointer_events`
- ADR-066（统一预览核心）、ADR-178（能力接口拆分）、ADR-093（多模型同框）、ADR-073（能力注册表）

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
