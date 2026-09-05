---
kind: preview_core
name: 统一 3D 预览核心 preview-core
tier: architecture
adr:
  - ADR-125
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/
  - frontend/src/preview-3d/bone-tools.ts
  - frontend/src/preview-3d/caps/sky-capability.ts
  - frontend/src/preview-3d/caps/ground-capability.ts
  - internal/app/container_entries.go
  - go/litematic/voxel.go
  - frontend/src/backend/web-fs.ts
auto_fields:
  symbols_with_lines:
    - __setEncodeImplForTest
    - _clearPmxStatsCache
    - _resetSingletons
    - App.GetVoxelDataInContainer
    - App.ListContainerEntries
    - applyVPDToMesh
    - applyWasdCameraMotion
    - applyWorkerDecodedTextures
    - BaseScene
    - BasisEncoderLike
    - BasisModuleLike
    - bindInputHandlers
    - BoneDetail
    - BoneListItem
    - BoneNode
    - boneRowActiveBg
    - BonesPanelItemOpts
    - BoneTree
    - buildBoneTree
    - buildCameraControls
    - buildFbxScene
    - buildFbxSceneFromData
    - buildLitematicScene
    - buildMmdScene
    - BuildNbtVoxelData
    - BuildNbtVoxelDataFromRoot
    - buildPackScene
    - buildPmxScene
    - BuildSchematicVoxelData
    - BuildSchematicVoxelDataFromRoot
    - buildSharedInfra
    - BuildVoxelData
    - BuildVoxelDataFromRoot
    - buildVrmBoneNodes
    - buildVrmBoneTree
    - buildVrmScene
    - buildYsmScene
    - CameraControlBridge
    - CameraControlScene
    - cancelPendingEncodings
    - captureTextureName
    - cleanupPreview
    - clearSceneCaps
    - closeOverlay
    - closeUnusedDecodedBitmaps
    - collectAllWebEntries
    - collectMenuGraph
    - CollectMenuGraphOpts
    - collectNodePredicates
    - concurrentMap
    - createFbxParser
    - createPmxParser
    - createResolveModeBridge
    - createWorkerBridge
    - CreateWorkerBridgeOpts
    - createWorkerParser
    - DecodedTexture
    - DEFAULT_GROUND_PARAMS
    - DEFAULT_SKY_PARAMS
    - DISPOSE_TEX_KEYS
    - disposeMmdMesh
    - disposeTextureDecoder
    - encodeAndCacheTexture
    - encodeToKTX2Basis
    - Error
    - estimateTexGpuBytes
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
    - getSchema
    - getTextureDecoder
    - GroundCapability
    - GroundParams
    - GroupedScene
    - hasActivePreview
    - hasSchema
    - importWebFiles
    - injectSkySunScalePatch
    - InputHandlers
    - InputOptions
    - invalidatePreview
    - isLikelyTga
    - Ktx2EncodeRequest
    - Ktx2EncodeResponse
    - Ktx2TextureLoader
    - Ktx2TextureLoaderDeps
    - listBonesWithDepth
    - listSchemas
    - LITEMATIC_SLICE_SCHEMA_ID
    - LitematicAdapterDeps
    - LitematicBuildOpts
    - LoadingProgressMode
    - makeBonePanelRenderer
    - makeBonesPanelItem
    - makeFbxAdapter
    - makeLitematicAdapter
    - makeMenuCtx
    - makeMmdAdapter
    - makePackAdapter
    - makeUnifiedPickHandler
    - makeVrmAdapter
    - makeYsmAdapter
    - makeYsmModelSchemaId
    - makeZipOverlayPort
    - MaterialBridgeLike
    - MaterialControlBridge
    - materialNodes
    - matTexSlots
    - MatTexSlots
    - MAX_KTX2_PIXELS
    - MAX_MODELS
    - MdMmAllocEntry
    - MdMmBuildCtx
    - mdMmDetectFormat
    - MdMmDetectFormatCtx
    - MdMmParsePmdCtx
    - mdMmParsePmdStage
    - MdMmParsePmxCtx
    - mdMmParsePmxStage
    - MdMmStage1bCtx
    - MdMmStage1Ctx
    - mdMmStage1Input
    - MdMmStage2Ctx
    - mdMmStage2LoadingManager
    - MdMmStage3Ctx
    - mdMmStage3SceneMesh
    - mdMmStage4Anim
    - MdMmStage4Ctx
    - MdMmStage5Ctx
    - mdMmStage5Menu
    - MdMmStage6bCtx
    - MdMmStage6Ctx
    - mdMmStage6Result
    - mdMmTrackAlloc
    - MenuGraph
    - MenuGraphNode
    - MmdAdapterDeps
    - MmdBottomNavCtx
    - MmdDataPort
    - mmdDiag
    - mmdMenuItems
    - MmdMenuItemsOpts
    - MmdPanelHooks
    - MmdPlayBridge
    - MmdZipConfig
    - mockMenuHandle
    - MODEL_SKY_PRESETS
    - ModelEntry
    - MorphMeshLike
    - morphNodes
    - mount3D
    - Mount3DOptions
    - MountCtx
    - MpSessionState
    - normalizeFbxScale
    - OpenGzRootFromBytes
    - PackAdapterOpts
    - PackDeps
    - packTextureLabel
    - PerceptionCapability
    - perceptionNodes
    - PerceptionState
    - pickBone
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
    - PostprocessingLike
    - prepareMmdZipInput
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - readPmxStats
    - readVrmMeta
    - readWebFile
    - registerPerFrame
    - registerSchema
    - removePerFrame
    - renderLoadingState
    - RenderVrmBonePanel
    - RepresentativeSnapshot
    - resetEncoderState
    - resetLoopState
    - resetSceneInfra
    - resetSchemas
    - resolveMmdZipConfig
    - ResolveModeBridge
    - ResolveModeResponse
    - runFailedMountCleanup
    - runFullCleanup
    - scanAllWebModels
    - scanWebModels
    - sceneRegistry
    - scheduleBackgroundEncoding
    - SchemaBuilder
    - ScreenshotScene
    - SemanticScene
    - setBoneNodeVisible
    - SharedInfra
    - showLoadFailure
    - SkyCapability
    - SkyModelType
    - SkyParams
    - startGlobalRenderLoop
    - stopIfIdle
    - SwitchContext
    - switchPreview
    - switchToSession
    - syncLightTargetFromContent
    - teardownSharedInfra
    - TexDecodeConfig
    - TexDecodeRequest
    - TexDecodeResponse
    - TEXTURE_EXTS
    - TextureDecoder
    - TextureTooLargeError
    - toggleBoneVisible
    - typeFromWebDir
    - UnloadCtx
    - unloadModel
    - unloadSessionModel
    - unregisterSchema
    - UpdateableScene
    - VrmAdapterDeps
    - VrmBonePanelCtx
    - VrmDataPort
    - vrmMenuItems
    - VrmMenuItemsOpts
    - VrmMetaInfo
    - VrmModelInfoCtx
    - VrmPanelHooks
    - WasdReuse
    - webFsBindings
    - WorkerBridge
    - WorkerErrorStrategy
    - YSM_MODEL_SCHEMA_ID
    - YsmAdapterOptions
    - YsmContentHandle
    - YsmControlsContext
    - ysmMenuItems
    - YsmMenuItemsOpts
    - YsmModel
    - YsmPreloadedModel
    - zipFindEntry
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
perf:
  - gpu-bound
invariant_anchors:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|mount3D
  - frontend/src/preview-3d/adapters/shared-infra.ts|_singletonScene.background
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
- **会话切换**：`switchPreview(path)` 复用外壳重建内容层（`switchPreview({ keepInScene: true })` 同台追加多模型，上限 8）；跨类型 / 关旧开新走 `openModel3DFullscreen`
- **生命周期清理**：
  - `runFullCleanup(ctx)`：**完整关闭**语义——拆 overlay + 解绑输入监听 + 拆菜单 + 停 rAF + 清内容层 GPU + 清场景能力 + `textureCache.disposeAll` + `clearSingletons` + **`setPerceptionPaused(false)` 复位感知暂停标志**（防 adapter 崩溃/切模型残留冻结下次 mount，属模块级单例无属主，须由会话完整关闭路径复位；见 `perception.md`） + `finishSession`。ESC / abort / 正常退出走这里
  - `runFailedMountCleanup(ctx)`：**build 失败路径**——保留 overlay（上展示 `showLoadFailure` 错误提示），不清场景能力/纹理缓存（可能被其他活跃会话共享）——只解绑输入监听 + 拆菜单 + 清 tip 定时器 + `removePerFrame` + `stopIfIdle`。catch 段调用（escH 由调用方先移除）
  - `closeOverlay(ctx)`：**早期关闭**（build 尚未成功，cleanupFn 未赋值的 ESC 出口）——aborted/disposed 置位 + 拆 escH + 拆菜单 + 拆 overlay + `finishSession`
- **多模型管理**：`sceneRegistry` 存每模型 `roots/visible/content/boneMaps/menuItems`；`fitCameraToRoots(visibleRoots())` 相机框可见模型；统一拾取器（`count >= 2` 激活）沿父链反查归属

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
- **能力注册表 `saveAll/dispose` 只在 `runFullCleanup`**——build 失败路径不清（可能共享）；`evictZeroRefIfNeeded` 只淘汰 `refs===0` 条目，已 dispose 纹理禁止再次 dispose（LRU 失效）
- **会话清理分工**：abort/gen 打断走 `runFullCleanup`（已登记 allContent → 需补登记 content 防 GPU 泄漏）；build 抛错走 `runFailedMountCleanup` + 调用方清 scene 差量 + escH
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
