---
kind: model3d
name: 3D 预览渲染 model3d
tier: architecture
adr:
  - ADR-129
category: rendering
source_files:
  - frontend/src/preview-3d/
  - frontend/src/views/app-preview/model3d-loader.ts
auto_fields:
  symbols_with_lines:
    - __setEncodeImplForTest:205
    - _clearPmxStatsCache:31
    - _resetSingletons:218
    - AdaptiveRenderBudget:52
    - addMeshToBoneGroup:31
    - ALPHA_F_HOLE:6
    - ALPHA_F_TRANSLUCENT:7
    - ALPHA_F_VISIBLE:5
    - AlphaIndex:18
    - AmbientLightParams:46
    - AngleShot:55
    - applyGroundSurfaceAppearance:280
    - applyGroundSurfaceStructural:261
    - applyPerfPreset:61
    - applyRotationIfNonIdentity:102
    - applyWorkerDecodedTextures:169
    - assembleBoneSelectInfo:68
    - attenuateAmbientForSky:364
    - AutoDanceOptions:26
    - b64ToBytes:6
    - bakeMeshFragments:10
    - BasisEncoderLike:13
    - BasisModuleLike:29
    - BeatDetectorLike:18
    - BeatDetectorOptions:27
    - BedrockBone:26
    - BedrockCube:6
    - BedrockGeometry:41
    - BedrockModel:56
    - BedrockSubModel:19
    - bindInputHandlers:122
    - BlinkCallback:24
    - BlinkOptions:42
    - BoneData:99
    - BoneDetail:101
    - BoneGroupMap:6
    - BoneInfoLite:7
    - BoneListItem:58
    - BoneMaps:62
    - BoneNode:11
    - BoneSelectInfo:48
    - BonesPanelItemOpts:32
    - BoneTree:23
    - buildBoneHierarchy:14
    - buildBoneTree:36
    - buildCameraControls:31
    - buildCameraSchema:32
    - buildCrossCuttingControls:105
    - buildCubeMeshData:192
    - buildEnvSchema:239
    - buildFbxScene:168
    - buildFbxSceneFromData:214
    - buildGroundSurfaceSpec:92
    - buildLightingSchema:46
    - buildLipMorphIndices:132
    - buildLitematicScene:406
    - buildMmdScene:1168
    - buildModelGroup:299
    - buildOrderedTexKeys:21
    - buildPackScene:289
    - buildPmxScene:76
    - buildPmxSceneSliced:209
    - buildPostprocessingSchema:69
    - buildPreviewMenuRouters:181
    - buildSceneMesh:54
    - buildSettingsControls:170
    - buildSettingsSchema:78
    - buildShadowSchema:60
    - buildSpecFromGeometryJSON:128
    - buildSpecFromModel:67
    - buildStatsPanel:25
    - buildVrmBoneNodes:20
    - buildVrmBoneTree:52
    - buildVrmScene:506
    - buildYsmObject:50
    - buildYsmScene:500
    - bytesToArrayBuffer:15
    - bytesToBase64:17
    - cacheGet:43
    - cacheSet:65
    - cacheSetEvictHandler:39
    - CacheValue:10
    - CameraControlBridge:13
    - cancelPendingEncodings:71
    - captureTextureName:102
    - cleanupPreview:196
    - clearLoadTraces:63
    - clearModelRoots:99
    - collectBlobUrls:48
    - collectMenuGraph:147
    - CollectMenuGraphOpts:73
    - collectNodePredicates:86
    - collectPreviewLeafNodes:128
    - collectPreviewNodeIds:141
    - collectSceneStats:35
    - collectSettingsCapControls:157
    - collectVisiblePredicates:455
    - compKey:18
    - computeBoneLocalPos:24
    - ConsoleLogger:6
    - CORE_MENU_ITEMS:54
    - createAdaptiveRenderBudget:63
    - createAutoDanceController:69
    - createBeatDetector:68
    - createBlinkController:55
    - createBreathController:48
    - createFbxParser:27
    - createFootIKController:27
    - createGazeController:35
    - createLipSyncController:51
    - createListenerSet:209
    - createPmxParser:54
    - createResolveModeBridge:165
    - createWorkerBridge:65
    - CreateWorkerBridgeOpts:44
    - createYsmAnimPlayer:281
    - CUBE_EPS:6
    - Cube2D:30
    - cullModelGroups:38
    - DecodedTexture:23
    - DecodedYsm:13
    - decodeYsmViaWasm:22
    - DEFAULT_ENV_PARAMS:138
    - DEFAULT_FOG_PARAMS:30
    - DEFAULT_GROUND_PARAMS:53
    - DEFAULT_GROUND_SURFACE_PARAMS:46
    - DEFAULT_LIGHT_PARAMS:107
    - DEFAULT_POSTPROC_PARAMS:87
    - DEFAULT_REFLECTOR_PARAMS:34
    - DEFAULT_SHADOW_PARAMS:39
    - DEFAULT_SKY_PARAMS:63
    - DEFAULT_TD_KEYMAP:11
    - DEFAULT_WATER_PARAMS:50
    - devLog:8
    - DirectionalLightParams:36
    - Disposable:6
    - disposeDebugGroup:14
    - disposeEnvSubscriptions:30
    - disposeMaterial:36
    - disposeSceneMeshes:40
    - drawEnvEquirect:158
    - encodeAndCacheTexture:216
    - encodeToKTX2Basis:81
    - Endianness:4
    - ENV_PRESET_BY_MODEL:147
    - ENV_PRESET_LINKAGE:100
    - ENV_PRESETS:43
    - EnvironmentCapability:399
    - EnvironmentParams:127
    - EnvPreset:22
    - EnvPresetId:20
    - EnvPresetLinkage:88
    - eulerToQuaternion:15
    - extractIKChainFromTree:200
    - FBX_TARGET_MAX_DIM:36
    - fbxBonesToBoneNodes:29
    - FbxDataPort:29
    - FbxGeometryData:16
    - FBXLoader:4582
    - FbxMaterialData:29
    - FbxMeshData:56
    - FbxParser:18
    - FbxParseRequest:17
    - FbxParseResponse:23
    - FbxScaleInfo:39
    - FbxSceneBuilderConfig:44
    - FbxSceneData:88
    - fbxSceneToData:209
    - FbxSkeletonData:45
    - FieldRestorer:159
    - fillRoles:282
    - fillSwitch:217
    - filterAnimFiles:24
    - findAncestorBoneId:153
    - fitCameraToRoots:68
    - fitCameraToScene:54
    - flagsForAlpha:12
    - FOG_PRESETS:40
    - FogCapability:68
    - FogMode:15
    - FogParams:17
    - FootIKController:13
    - formatCapSliderValue:99
    - frameCameraSide:21
    - FrameSideOptions:8
    - generateSurfacePixels:164
    - getBoneDetail:110
    - getBoneList:21
    - getBonePath:78
    - getBonePosition:93
    - getCustomAnimPath:12
    - getFrameIntervalMs:44
    - getLoadTraces:57
    - getMaxFps:33
    - getMaxPixelRatio:10
    - getMeshBoneId:53
    - getMmdMaterialDetail:71
    - getModelRootCount:29
    - getPerfPreset:50
    - getSchema:52
    - getSemanticBone:186
    - getSemanticMorph:95
    - getStateValue:300
    - getTextureAlphaInfo:17
    - getTextureAlphaMode:35
    - getTextureDecoder:149
    - getTintColorSync:56
    - getVrmMaterialDetail:62
    - GroundCapability:62
    - GroundMaterialParams:19
    - GroundParams:40
    - GroundSurfaceAppearanceSpec:73
    - GroundSurfaceMode:17
    - groundSurfaceNeedsRebuild:132
    - GroundSurfaceSpec:81
    - GroundSurfaceStructuralSpec:61
    - hasActivePreview:240
    - hasBoneRotation:32
    - hasSceneStats:20
    - hasSchema:57
    - IKChain:24
    - IKConfig:27
    - IKResult:45
    - injectSkySunScalePatch:126
    - InputHandlers:43
    - InputOptions:28
    - invalidateMaxFpsCache:30
    - invalidatePreview:191
    - isFrustumCullEnabled:111
    - isIdentityQuat:32
    - isPathAvailable:319
    - isPreviewFolderNode:123
    - isRenderableModel:320
    - isSkyEnvironmentOn:133
    - JavaModelFace:44
    - JavaModelResult:59
    - KNOWN_PATHS:53
    - Ktx2EncodeRequest:9
    - Ktx2EncodeResponse:17
    - Ktx2TextureLoader:61
    - Ktx2TextureLoaderDeps:21
    - LIGHT_PRESETS:117
    - LightCapability:368
    - lightDirToPosition:348
    - LightParams:79
    - LipSyncCallback:26
    - LipSyncOptions:36
    - listBonesWithDepth:65
    - listMmdMaterials:31
    - listSchemas:62
    - listVrmMaterials:28
    - LITEMATIC_SLICE_SCHEMA_ID:219
    - LitematicBuildOpts:394
    - LoadingProgressMode:14
    - loadMcTints:29
    - loadTdCamSpeed:45
    - loadTdKeymap:27
    - loadTdRotMode:52
    - loadTextures:9
    - LoadTrace:38
    - LoadTraceAssets:18
    - LoadTraceStage:12
    - LoadTraceTexture:6
    - makeBonePanelRenderer:40
    - makeBonesPanelItem:51
    - makeMenuCtx:12
    - makePackAdapter:58
    - makeYsmAdapter:531
    - makeYsmModelSchemaId:29
    - makeZipOverlayPort:120
    - matchSemanticBone:154
    - matchSemanticMorph:60
    - MaterialBridgeLike:10
    - materialNodes:18
    - MAX_FPS_DEFAULT:22
    - MAX_FPS_KEY:23
    - MAX_KTX2_PIXELS:65
    - MAX_MODELS:209
    - MAX_PIXEL_RATIO_KEY:5
    - MenuControlDef:17
    - MenuControlKind:14
    - MenuGraph:58
    - MenuGraphNode:32
    - mergeCubes:261
    - mergeStatsMenuItems:59
    - MeshData:109
    - MeshFragment:14
    - MMD_SEMANTIC_CANDIDATES:92
    - MMD_SEMANTIC_MORPH_CANDIDATES:43
    - MmdBonePickResult:32
    - mmdBonesToBoneNodes:16
    - MmdDataDeserializer:5
    - MmdDataPort:66
    - MmdMaterialDetail:19
    - MmdMaterialListItem:13
    - mmdMenuItems:1273
    - MmdMenuItemsOpts:1241
    - MmdPanelHooks:185
    - mmdSemanticBoneMap:216
    - mmdSemanticMorphMap:87
    - MmdZipConfig:20
    - mockMenuHandle:36
    - MODEL_SKY_PRESETS:91
    - modelDetailView:38
    - ModelEntry:21
    - modelEntryFor:85
    - ModelGroup:87
    - ModelLike:13
    - ModelSpec:25
    - MorphMeshLike:10
    - morphNodes:20
    - motionDetailView:112
    - mount3D:263
    - Mount3DOptions:245
    - mountPreviewRootMenu:467
    - MultiLipSyncCallback:29
    - multiModelSelectNode:39
    - MultiModelSelectOpts:16
    - normalizeFbxScale:55
    - OrderedTexInput:7
    - PackAdapterOpts:34
    - PackDeps:27
    - PackEntryReader:73
    - parseBedrockGeometryFromJSON:95
    - parseJavaModel:292
    - parseYsmJsonDirect:23
    - PerceptionCapability:19
    - perceptionNodes:36
    - PerceptionState:10
    - PERF_PRESET_DEFAULT:22
    - PERF_PRESET_KEY:19
    - PERF_PRESETS:28
    - PerfLevel:16
    - persistState:143
    - pickBone:169
    - pickMmdBone:39
    - PmxBoneData:56
    - PmxBuilderConfig:29
    - PmxBuildResult:37
    - PmxDisplayFrameData:130
    - PmxFaceData:33
    - PmxFileStats:16
    - PmxJointData:115
    - PmxMaterialData:39
    - PmxMorphData:71
    - PmxObject:1
    - pmxObjectToResponse:194
    - PmxParser:46
    - PmxParseRequest:17
    - PmxParseResponse:78
    - PmxReader:62
    - PmxRigidBodyData:98
    - PmxVertexData:23
    - POSTPROC_PRESETS:359
    - PostprocessingCapability:369
    - PostprocessingLike:8
    - PostprocessingParams:35
    - preloadModel:115
    - prepareMmdZipInput:209
    - PREVIEW_FRAME_INTERVAL_MS:17
    - PREVIEW_MENU_GROUPS:32
    - PreviewActionMenuCtx:17
    - PreviewAdapter:130
    - PreviewBuildCtx:81
    - PreviewControlSpec:40
    - PreviewHandle:140
    - PreviewMenuCtx:38
    - PreviewMenuGroupDef:23
    - PreviewMenuGroupId:20
    - PreviewMenuHandle:74
    - PreviewMenuNode:68
    - PreviewMenuNodeKind:23
    - PreviewMenuRouters:169
    - previewPixelRatio:58
    - PreviewScene:104
    - previewSnapshot:328
    - PreviewSnapshot:82
    - PreviewStatePath:74
    - readPmxStats:39
    - readVrmMeta:110
    - rebuildDebug:58
    - recordLoadTrace:52
    - ReflectionMode:33
    - REFLECTOR_PRESETS:45
    - ReflectorCapability:125
    - ReflectorParams:18
    - registerBoneRaycast:130
    - registerModelRoot:18
    - registerSchema:41
    - renderAdapterPanelContent:482
    - renderCapControls:70
    - renderEnvLevel:116
    - renderLoadingState:17
    - renderMenu:35
    - RenderModeCapability:59
    - renderMultiAngle:77
    - RenderMultiAngleOptions:66
    - renderPreviewPanel:225
    - RenderVrmBonePanel:31
    - RepresentativeSnapshot:26
    - resetActiveComponent:269
    - resetEncoderState:83
    - resetSchemas:67
    - resetSettingsListeners:335
    - resolveMmdZipConfig:41
    - ResolveModeBridge:158
    - ResolveModeResponse:15
    - resolveSemanticBones:167
    - resolveSemanticMorphs:70
    - restoreFields:175
    - restoreModelGroupsVisible:122
    - restoreState:148
    - roleBaseName:29
    - safeDispose:11
    - sampleAdaptivePixelRatio:74
    - SceneCapability:95
    - SceneCapabilityFactory:24
    - SceneCapabilityLookup:91
    - sceneCapabilityRegistry:111
    - SceneCapabilityRegistry:32
    - sceneRegistry:206
    - SceneStats:19
    - scheduleBackgroundEncoding:267
    - SchemaBuilder:34
    - screenshotFromRenderer:27
    - ScreenshotLights:18
    - ScreenshotOpts:13
    - SEMANTIC_BONE_IDS:47
    - SEMANTIC_MORPH_IDS:24
    - SemanticBoneEntry:74
    - SemanticBoneId:21
    - SemanticBoneMap:82
    - SemanticMorphEntry:30
    - SemanticMorphId:14
    - SemanticMorphMap:36
    - setBoneNodeVisible:129
    - setBoneVisible:11
    - setFrustumCullEnabled:117
    - setMmdMaterialOpacity:59
    - setMmdMaterialVisible:38
    - setPerfPreset:70
    - setStateValue:309
    - setVrmMaterialOpacity:48
    - setVrmMaterialVisible:38
    - SHADOW_PRESETS:49
    - ShadowCapability:171
    - ShadowParams:24
    - shouldRenderAtFps:101
    - shouldRenderPreviewFrame:90
    - showLoadFailure:35
    - showModelGroup:29
    - SkyCapability:315
    - SkyModelType:83
    - SkyParams:30
    - solveIK:78
    - Spec3D:43
    - SpecBone:23
    - SpecBone3D:11
    - SpecBuildResult:38
    - SpecCube:11
    - SpecMeshData:46
    - SpecMeshGroup3D:23
    - SpecModelInput:31
    - splitMeshByFaceAlpha:24
    - SpotlightParams:51
    - STATS_PANEL_ID:17
    - stripYsgpTextHeader:112
    - SubModel:72
    - subscribeSettings:279
    - surfaceSpecKey:117
    - SwitchContext:32
    - switchPreview:234
    - switchToSession:95
    - syncLightTargetFromContent:423
    - TdKeyAction:8
    - TexDecodeConfig:15
    - TexDecodeRequest:9
    - TexDecodeResponse:17
    - TextureAlphaInfo:7
    - TextureAlphaMode:4
    - textureCache:94
    - TextureCacheImpl:18
    - TextureDecoder:40
    - textureRepeat:141
    - TextureTooLargeError:68
    - TILE_WORLD_SIZE:139
    - toggleBone:19
    - toggleBoneVisible:137
    - toggleMmdMaterialVisible:48
    - toScreenshotLights:26
    - toStatePath:90
    - unregisterModelRoot:23
    - unregisterSchema:47
    - Vec3:23
    - VolumetricParams:65
    - VrmBonePanelCtx:21
    - VrmDataPort:33
    - VrmMaterialDetail:17
    - VrmMaterialListItem:11
    - vrmMenuItems:564
    - VrmMenuItemsOpts:526
    - VrmMetaInfo:89
    - VrmModelInfoCtx:173
    - VrmPanelHooks:180
    - vrmSemanticBoneMap:200
    - WaterCapability:66
    - WaterMode:18
    - WaterParams:21
    - WireframeCapability:14
    - WorkerBridge:29
    - WorkerErrorStrategy:22
    - YSM_MODEL_SCHEMA_ID:20
    - YsmAdapterOptions:44
    - YsmAnimPlayer:32
    - ysmMenuItems:592
    - YsmMenuItemsOpts:550
    - YsmObjectHandle:25
    - ysmSemanticBoneMap:303
    - zipFindEntry:226
  tests:
    - frontend/src/preview-3d/model3d-spec.test.ts
  use_when:
    - 3D 渲染层
    - Three.js
    - 相机
    - 骨骼渲染
    - 自由相机
    - 3D 截图
    - 纹理加载
    - spec 兜底
  pitfalls:
    - 「Fatal trap #11」坐标口径必须对齐 YSMViewer：pivot X 取反；Go 端已正确实现，JS 兜底 model3d-spec.ts 的 cubePivot/cubeOrigin 与 Go 口径不一致（已废弃无运行时影响）
    - mesh 级视锥剔除必须关闭（mesh.frustumCulled = false），否则骨骼旋转时扁平部件（如脸部）会误判不可见
    - dispose 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/pointer/resize/fullscreenchange 监听、dispose geometry/material/texture，缺一即泄漏
    - 纹理绑定不得静默兜底：槽位越界/缺图应报错「纹理槽位缺失」+ 灰色占位，严禁「找第一张可用」贴错图
    - perComponent 纹理索引分类与绑定索引必须同一空间：组件分支恒用局部槽 0（arr === compTexArr ? 0），非组件回退全局 texIdx/resolvedTexIdx
    - 大文件解码 peak 内存可达 ~3-4× 文件大小（base64 → Uint8Array → WASM HEAP → MEMFS → readFile → JSON.parse 六层拷贝并存）
  quick_groups:
    - 3D 渲染与预览核心
    - 多模型同框与场景管理
    - 骨骼/几何渲染层
    - 纹理加载与 spec 构建
  quick_intents:
    - 挂载/切换 3D 预览（mount3D / switchPreview）
    - 多模型同框叠加（keepInScene=true）
    - 骨骼拾取与选中（pickBone / setBoneVisible）
    - 自由相机漫游（WASD + 空格/Shift 升降）
    - 3D 截图（单角度 / 多角度）
    - 纹理预加载与缓存（preloadModel / specCache）
    - 渲染性能调优（perf preset / adaptive render budget）
    - 调试模式切换（normal / pivot / bone overlay）
  quick_risk_lines:
    - 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径
    - 所有 3D 渲染内容必须经 mount3D 统一会话外壳，禁止独立维护 renderer/scene/camera
    - dispose() 必须遍历子对象调用 geometry?.dispose() / material?.dispose() / texture?.dispose()，Object3D.remove() 不释放 WebGL 资源
    - 100MB 阈值是网页版唯一防线，低端设备（4GB RAM）峰值内存可能触顶 OOM
  invariant_anchors:
    - frontend/src/preview-3d/model3d.ts|Spec3D
    - frontend/src/views/app-preview/model3d-loader.ts|preloadModel
    - frontend/src/preview-3d/cube-mesh.ts|computeBoneLocalPos
    - frontend/src/preview-3d/mesh-builder.ts|addMeshToBoneGroup
tests:
  - frontend/src/preview-3d/model3d-spec.test.ts
use_when:
  - 3D 渲染层
  - Three.js
  - 相机
  - 骨骼渲染
  - 自由相机
  - 3D 截图
  - 纹理加载
  - spec 兜底
invariant_anchors:
  - frontend/src/preview-3d/model3d.ts|Spec3D
  - frontend/src/views/app-preview/model3d-loader.ts|preloadModel
  - frontend/src/preview-3d/cube-mesh.ts|computeBoneLocalPos
  - frontend/src/preview-3d/mesh-builder.ts|addMeshToBoneGroup
quick_groups:
  - 3D 渲染与预览核心
  - 多模型同框与场景管理
  - 骨骼/几何渲染层
  - 纹理加载与 spec 构建
quick_intents:
  - 挂载/切换 3D 预览（mount3D / switchPreview）
  - 多模型同框叠加（keepInScene=true）
  - 骨骼拾取与选中（pickBone / setBoneVisible）
  - 自由相机漫游（WASD + 空格/Shift 升降）
  - 3D 截图（单角度 / 多角度）
  - 纹理预加载与缓存（preloadModel / specCache）
  - 渲染性能调优（perf preset / adaptive render budget）
  - 调试模式切换（normal / pivot / bone overlay）
quick_risk_lines:
  - 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径
  - 所有 3D 渲染内容必须经 mount3D 统一会话外壳，禁止独立维护 renderer/scene/camera
  - dispose() 必须遍历子对象调用 geometry?.dispose() / material?.dispose() / texture?.dispose()，Object3D.remove() 不释放 WebGL 资源
  - 100MB 阈值是网页版唯一防线，低端设备（4GB RAM）峰值内存可能触顶 OOM
pitfalls:
  - 「Fatal trap #11」坐标口径必须对齐 YSMViewer：pivot X 取反；Go 端已正确实现，JS 兜底 model3d-spec.ts 的 cubePivot/cubeOrigin 与 Go 口径不一致（已废弃无运行时影响）
  - mesh 级视锥剔除必须关闭（mesh.frustumCulled = false），否则骨骼旋转时扁平部件（如脸部）会误判不可见
  - dispose 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/pointer/resize/fullscreenchange 监听、dispose geometry/material/texture，缺一即泄漏
  - 纹理绑定不得静默兜底：槽位越界/缺图应报错「纹理槽位缺失」+ 灰色占位，严禁「找第一张可用」贴错图
  - perComponent 纹理索引分类与绑定索引必须同一空间：组件分支恒用局部槽 0（arr === compTexArr ? 0），非组件回退全局 texIdx/resolvedTexIdx
  - 大文件解码 peak 内存可达 ~3-4× 文件大小（base64 → Uint8Array → WASM HEAP → MEMFS → readFile → JSON.parse 六层拷贝并存）
perf:
  - memory-heavy
  - gpu-bound
---
# 3D 预览渲染 model3d

## 概览

前端 Three.js 3D 渲染层（`frontend/src/preview-3d/`），**单会话架构**：场景/相机/渲染器/控制器由统一预览核心 `mount3D`（ADR-066）持有单实例，模型内容经适配器（ysm/vrm/mmd/litematic）挂进同一 `ctx.scene`；多模型同框经 `sceneRegistry` 注册表管理（ADR-093，`MAX_MODELS=8`）。曾落地的 RenderSession 对象化（ADR-052）因生产无调用方，render-session.ts 470 行已随 ADR-052 P2 收尾删除，本卡不再描述该链路。

**文件按层分组**：

| 层 | 文件 | 职责 |
|----|------|------|
| **场景/会话层**（核心） | `session-state.ts` / `model3d.ts` / `cube-mesh.ts` | 会话状态复位工具 + Spec 类型枢纽 + 坐标口径工具；会话外壳（mount3D 单实例）见 [preview_core](./preview_core.md) |
| **渲染管线层** | `render-loop.ts` / `camera-setup.ts` / `scene-lights.ts` / `cleanup-helper.ts` | 渲染循环 → 相机定位 → 灯光配置 → 资源释放 |
| **骨骼/几何层**（最大层） | `mesh.ts` / `mesh-builder.ts` / `cube-mesh.ts` / `model-group-builder.ts` / `bone-list.ts` / `bone-visibility.ts` / `bone-raycast.ts` | 骨骼组树构建 → 立方体几何 → mesh 合并 → 骨骼列表/可见性 → 射线拾取 |
| **工具/辅助层** | `quaternion.ts` / `debug-render.ts` / `keymap.ts` / `model3d-spec.ts` | 四元数工具 / debug 叠加 / 键位偏好 / 历史 JS spec 兜底（已废弃） |
| **加载/桥接层** | `model3d-loader.ts` / `spec-builder.ts` | 纹理 + spec 预加载（Go binding 桥接） / spec 构建工具 |

> **ADR-072 已落地**：内容适配器（ysm/vrm/litematic/mmd）已下沉至 `preview-3d/adapters/`，本卡仅覆盖渲染层基础设施。适配器层见知识卡 [preview_core](./preview_core.md)。

几何数据（顶点/法线/UV/骨骼四元数）全部由 Go 端 [go_threejs](./go-threejs.md) 预计算，本层只渲染、不做几何计算。

## 快速导航

| 你想找什么 | 跳到 |
|-----------|------|
| 单会话架构 / 多模型同框 | [§ 对外 API / 入口](#对外-api--入口) + [§ 单会话与多模型同框](#单会话--多模型同框现状adr-093)；外壳见 [preview_core](./preview_core.md) |
| 渲染循环 / 相机 / 灯光 / 材质 | [§ 渲染管线层](#渲染管线层) + [§ 渲染循环与交互](#渲染循环与交互) |
| 骨骼组树 / mesh 合并 / 拾取 | [§ 骨骼/几何层](#骨骼几何层) |
| 坐标口径 / X 轴翻转 / trap #11 | [§ 坐标口径工具](#坐标口径工具) + [不变量](#不变量) |
| 对外 API / 加载入口 | [§ 加载/桥接层](#加载桥接层) + [对外 API / 入口](#对外-api--入口) |
| 废弃兜底 spec | [§ 工具/辅助层](#工具辅助层) |
| 场景统计提取（骨骼/网格/三角面/材质/纹理/表情） | [§ 工具/辅助层](#工具辅助层) `scene-stats.ts` |

### 渲染会话（已收敛至统一核心）

会话外壳由 [preview_core](./preview_core.md) 的 `mount3D` 承担（ADR-066，单实例 renderer/scene/camera/OrbitControls/rAF 循环），本卡不再持有会话层代码。渲染内容经 `PreviewAdapter.build(ctx, path)` 挂进 `ctx.scene`，外壳与内容契约（`PreviewScene`：`update`/`dispose`/`resetCamera` 等）见 preview_core 知识卡。

### 坐标口径工具

```typescript
// cube-mesh.ts 导出，统一骨骼位置计算（ADR-052 P3）
export function computeBoneLocalPos(
  bonePivot: Vec3,
  parentPivot: Vec3 | null
): [number, number, number]
```

公式（对齐 YSMViewer/C# ConvertBones）：
- 有父骨骼：`[parent.x - bone.x, bone.y - parent.y, bone.z - parent.z]`
- 无父骨骼：`[-bone.x, bone.y, bone.z]`

**X 轴翻转是 ysmview 口径关键特征**（trap #11 反复修的根源）。

## 渲染管线层

**职责**：从场景初始化到渲染循环的完整执行链。`camera-setup.ts` 定位相机到 Z 负侧（`camera.position.set(0, 80, -120)`，`controls.target(0, 80, 0)`，模型脸朝 Z-）→ `scene-lights.ts` 配置环境光 + 双方向光（`addStandardSceneLights`，快消批收敛自 3D 灯光样板）→ `render-loop.ts` 启动 `requestAnimationFrame` 主循环。

**渲染循环与交互**：
- 默认 OrbitControls 轨道模式，`setRotationMode(false)` 切自由相机（WASD 平移 + 空格/Shift 升降）
- **3D 操作键位 / 相机偏好持久化**（localStorage）：键位存 `KeyboardEvent.code` 物理键，相机速度 `td-cam-speed`（2–200，默认 20），旋转模式 `td-rot-mode`（orbit/free）
- **键位消费链（2026-08-29 修复"改键不生效"）**：设置页存 `KeyboardEvent.code`（`settings/keymap.ts` 捕获）→ `loadTdKeymap()` 读取（`preview-3d/keymap.ts`）→ `input-and-animation.ts` `bindInputHandlers` 按 code 映射成**动作表**（forward/back/left/right/up/down 布尔）→ `mount-preview-core.ts` `mpApplyWasdCameraMotion` 只查动作表，不再硬编码键位。**自定义键位真正生效**（原来消费端硬编码 `keys["w"]` 等，设置页改键白改）。方向键双轨保留（ArrowUp→forward 等，FPS 惯例）；修饰键左右对称（ShiftLeft/ShiftRight 对 down 等价，对齐旧 `keys["shift"]` 行为）。**输入框守卫**：焦点在 INPUT/TEXTAREA/SELECT/contentEditable 时不记录、不 preventDefault——3D 面板内文本框打字不被吞（原 document 级监听无条件吞 w/a/s/d）。
- **相机偏好初始读偏好**（2026-08-29）：会话初始 `camSpeed=loadTdCamSpeed()`、`orbitMode=loadTdRotMode()`，free 模式下同步 `controls.enableRotate=false`（此前硬编码 orbit+速度 20，设置页改相机偏好 3D 打开不生效）
- **材质为 ysmview 风格**：`DoubleSide + transparent + alphaTest:0.1 + depthWrite:true`；alpha 模式由 `texture-alpha.ts getTextureAlphaMode` 逐纹理分类并缓存 userData（ADR-118 Phase A：半透明像素占比 ≤0.5% 视为杂点不判 blend——wine_fox 实测错路面 80.9%→35.6%，8 模型 blend→cutout 翻正，18_wedding 真混合保持 blend）
  - **mesh 级视锥剔除关闭**（2026-08-25 修复）：`mesh-builder.ts` 统一 `mesh.frustumCulled = false`。Three.js 默认 mesh 级剔除常开，但设置页 `ysm_3d_frustumCull` 开关只管 Group 级（`frustum-cull.ts` `cullModelGroups`），单模型场景 Group 级本就豁免，导致 mesh 级剔除始终是场上唯一在跑的剔除机制——骨骼旋转时脸部等扁平小包围球部件落到视锥边缘被误判不可见（"转头脸消失"根因之一）。关闭 mesh 级剔除后，可见性交由 Group 级 `cullModelGroups` 统一管理，多模型同框性能由 Group 级兜底，单模型场景无损。
- **面级透明路由**（ADR-118 Phase B）：`getTextureAlphaInfo(texture)` 一次读像素同时产出全局 mode + `alpha-index.ts` AlphaIndex（小矩形精确扫描 / 大矩形 TILE=8 前缀和）缓存 `userData.ysmAlphaInfo`；`face-split.ts splitMeshByFaceAlpha` 逐三角形 UV 包围盒查 flags 分桶（严格口径：any translucent→blend / hole→cutout / else opaque），`ysm-object.ts` 统一碎片流——cutout/opaque 碎片按 `boneId:texIdx:mode` 烘合，**blend 碎片保持独立 mesh 不烘合**（逐 mesh 深度排序契约）；flipY=true 或无索引纹理回退整图模式。YSM 主链路 `model3d-loader.ts` flipY=false，v 即图像行域无需翻转
- **debug 叠加层**（`debug-render.ts`）：`state.debugMode = "normal"|"pivot"|"bone"` 切换，`rebuildDebug(scene, rootGroup, boneGroupMap, spec, state)` 重建叠加层
- **cleanup**（`cleanup-helper.ts`）：资源释放工具，遍历子对象并调用 `geometry/material/texture` 的 `dispose()`，确保 WebGL 资源完全释放

## 骨骼/几何层

**职责**：骨骼层级组树构建 + 立方体几何生成 + mesh 合并 + 骨骼交互。

- **骨骼组树**：`model-group-builder.ts` 的 `buildModelGroup` 递归构建骨骼 Group 树，`mesh.ts` 的 `buildSceneMesh` 组装完整场景；同一骨骼下按 `boneId + ":" + texIdx` 分组，同组多个 MeshGroup 合并顶点/法线/UV/索引减少 draw call
- **立方体几何**：`cube-mesh.ts` 的 `computeBoneLocalPos` + `buildCubeGeometry` 生成单个 cube 顶点/法线/UV（**坐标口径见上方坐标口径工具**）
- **单个 mesh**：`mesh-builder.ts` 的 `addMeshToBoneGroup` 构造单个 Mesh 并挂到骨骼 Group
- **骨骼交互**：`bone-raycast.ts` 用 `Raycaster.setFromCamera` + `intersectObjects` 做骨骼拾取，命中时组装 `BoneSelectInfo` 调 `handle.onBoneSelect`；`bone-list.ts` / `bone-visibility.ts` 分别维护骨骼列表与可见性切换（`setBoneVisible` / `toggleBone` / `showModelGroup`）
- **四元数**（`quaternion.ts`）：骨骼旋转的 `localRotation` 四元数 `[x,y,z,w]` 工具函数

## 工具/辅助层

- `keymap.ts` — 键位/相机偏好持久化（`loadTdKeymap` / `loadTdCamSpeed` / `loadTdRotMode`）
- `debug-render.ts` — debug 叠加层渲染（pivot 标记 / 骨骼线框）
- `model3d-spec.ts` — JS 端 spec 类型定义与 `buildSpecFromModel` 构建器；`CUBE_EPS` 被 cube-mesh.ts 消费（零厚度面修正/合并 epsilon 单点），`fetchSpec` 被 model3d-loader.ts 调用。与 Go `threejs.Build()` 口径不一致（cubePivot/cubeOrigin 不做 X 取反），仅作前端 spec 类型枢纽与测试黄金样本使用
- `scene-stats.ts` — **3D 场景统计提取器（ADR-131 P0）**：`collectSceneStats(roots)` 一次 traverse 出 `SceneStats`（boneCount / meshCount / triangleCount / materialCount / textureCount / morphCount）。材质/纹理按实例去重；骨骼 = `SkinnedMesh.skeleton.bones` ∪ 裸 Bone（Set 去重不双计）；表情数取 `morphTargetInfluences` 最长网格；Line/Points 不计入网格与三角面。纯函数零视图依赖，供 mount-preview-core post-build 挂点采统计（「能渲染就能出统计」），映射进 `StatsCardModel` 由视图层完成。实现陷阱：异步纹理 onLoad 前 `texture.image` 为 null，本提取器只计纹理数，尺寸由调用方 onLoad 后补

## 加载/桥接层

**`model3d-loader.ts`**：
- `preloadModel(model): Promise<{ texArr, spec, componentTexMap }>` — 纹理 + spec 并行预加载（纹理加载走 `texture-loader.ts` 的 `loadTextures`，ADR-136 归位 features）；内部 `fetchSpec` 走 Go `GetModel3DSpec` binding（模块级 `specCache` LRU 缓存上限 20）；Android/网页 viewer 模式降级 WASM 解码兜底（`fetchSpecViaWasmFallback` + `buildSpecFromModel`）。**ADR-114 perComponent：componentTexMap 数据源 = `spec.componentTextures`**（Go GetModel3DSpec 注入，键 = `comp_<i>` 对齐 BuildMulti ModelGroup 命名，zip/7z/解压目录三路同源；`model.componentTextures` 仅旧数据链兼容）——未声明组件（arrow 等投射物）按 YSM 游戏语义用同名纹理，不再依赖全局 texArr 槽位
- `spec-builder.ts` — spec 构建工具（WASM 兜底通道，含 `thicknessEpsilon` 零厚度面修正）；`cubeTexW/cubeTexH` 已对齐 Go 端 per-cube 记录来源 geometry 的 texture_width/height（恒 0 会让多组件 UV 全按第一个 geometry 尺寸归一化 → 缩放错）

**桥接方向**：Go `GetModel3DSpec` ← [go_threejs](./go-threejs.md) `threejs.Build()` → `model3d-loader.ts` `fetchSpec` → 适配器 `build()` 挂进 `mount3D` 统一场景渲染。纹理/模型对象来自 [go_geometry](./go-geometry.md)。

## 对外 API / 入口

`model3d.ts`（类型枢纽，无渲染入口）：
- 类型：`Spec3D` / `SpecModelGroup3D` / `SpecBone3D`（localPosition/localRotation 四元数 [x,y,z,w]/parentId）/ `SpecMeshGroup3D`（positions/normals/uvs/indices/texIdx）/ `BoneSelectInfo` / `BoneMaps`
- re-export：键位/相机偏好（`DEFAULT_TD_KEYMAP` / `loadTdKeymap` / `loadTdCamSpeed` / `loadTdRotMode`，对外统一出口）

渲染入口在统一预览核心 [preview_core](./preview_core.md)（`mount-preview-core.ts`）：
- `mount3D(adapter, path, opts?)` — 会话外壳主入口（单实例 renderer/scene/camera/controls/rAF）
- `switchPreview(path, { keepInScene? })` — 会话内切换 / 同台追加（ADR-066 §5.6；keep 追加即多模型同框）
- `cleanupPreview()` / `invalidatePreview()` — 清理与在途作废竞态守卫
- `preview-library.ts` `openModel3DFullscreen(path, { cooperate? })` — 跨类型统一路由入口（ADR-093 T4）；**方案 A（2026-08-24）**：`cooperate=false` 且有活跃会话时先 `cleanupPreview()` 清理旧活跃全屏层（释放旧内容层 + 复位注册表 + 复原单例），再建新模型——把本函数注释「cooperate=false 会先清理旧的活跃全屏层」从名义变实际；对 ysm/mmd/vrm/litematic 所有类型的「二次点击资源列表」统一生效，不影响 `cooperate=true` 的 keepInScene 追加语义，也不影响会话内 `switchTo` 切换。契约测试见 `preview-library-replace.test.ts`
- 截图：`preview-3d/screenshot.ts` 纯函数（接收 renderer+scene+camera）+ `screenshot-render.ts` 离屏多角度（ADR-136 归位 features）+ `screenshot-lights.ts` toScreenshotLights（预览灯光提取）

`model3d-loader.ts`：
- `loadTextures(urls?): Promise<(THREE.Texture | null)[]>` — 并行加载，`flipY=false` + `NearestFilter` + `SRGB`；**null 占位不压缩索引**
- `preloadModel(model): Promise<{ texArr, spec }>` — 纹理 + spec 并行预加载；内部 `fetchSpec` 走 Go `GetModel3DSpec` binding（模块级 `specCache` LRU 缓存上限 20）；Android/网页 viewer 模式降级 WASM 解码兜底

## 单会话 + 多模型同框（现状，ADR-093）

**不是多面板多实例**：renderer/scene/camera 单实例，同一会话内可叠加多个模型：

| 机制 | 落点 | 说明 |
|------|------|------|
| 会话外壳 | `mount-preview-core.ts` `mount3D` | 一个预览面板 = 一个会话（renderer/rAF/controls 单例） |
| 模型切换 | `switch-preview.ts` `switchToSession` | 复用外壳重建内容层（ADR-066 §5.6）；对外暴露为 `switchPreview`（mount-preview-core.ts） |
| 多模型同框 | `switchPreview(path, { keepInScene: true })` | 旧内容不移除，新模型 add 进同一 scene（上限 `MAX_MODELS=8`，超量 toast 拒绝） |
| 多蓝图同框（litematic） | `appendLitematicPreview(path)`（`litematic-3d.ts`） | 与 `appendMmdPreview`/`appendVrmPreview` 对称：经 `openModel3DFullscreen(path, { cooperate: true })` → `switchPreview({ keepInScene: true })` 收口；litematic 会话内点菜单 ➕（`preview-menu/core.ts` 行尾「➕ 追加」按钮，**任何非当前候选无条件显示，与类型无关**）亦可触发；各蓝图独立 entry + 各自 dispose，旧内容不误清（2026-08-23 Phase B-1 收口） |
| 场景注册表 | `scene-registry.ts` `sceneRegistry` | 每模型 `roots`/`visible`/`built`/`boneMaps`/`menuItems` 元数据；相机多包围盒累加（`fitCameraToRoots`）、拾取归属、上限计数单一事实来源。**`built.menuItems` 是角色详情 sink**（2026-08-22 收口）：角色详情 `roleDetailView` 按 `entry.menuItems` 中 `kind==="panel" && dockGroup==="model"` 过滤渲染该实体的专属工具；适配器须**同时在 `build()` 返回值里带 `menuItems`**（如 ysm-adapter 既 `ctx.menu.setAdapterItems` 喂 dock 历史通道、又返回值带 `menuItems` 喂角色详情），否则注册进 `sceneRegistry` 的 entry 详情为空。litematic 蓝图切片即此：原仅经 `ctx.menu.setAdapterItems(sliceItems)`（dock 平铺通道），现改为 `buildLitematicScene` 返回值 `menuItems: sliceItems`，使其经角色详情 sink 显示与卸载（commit e8d6f5aa）。dock 模型组（🧍）自 2026-08-22 起恒定直达 roles 面板，不再平铺 model 组项 |
| 拾取 dispatch | 统一拾取器（仅 `registry.count() >= 2` 激活） | 射线命中 → `pickModelByObject` 沿父链反查归属 → `setActive` 切活跃模型 + 换菜单（ADR-093 T5） |

**历史**：ADR-052 的 RenderSession 对象化（2026-08-11）曾为实现「多实例隔离」落地，但 UI 从未出现多面板并存场景——生产无调用方，render-session.ts 470 行随 ADR-052 P2 收尾删除；其「实例字段封装、显式 dispose」思想由 ADR-066 统一核心继承。

## 与其他子系统关系

- 消费方：`app-preview/ysm-3d.ts`（YSM 3D 薄包装，skeleton.ts 经此接入统一外壳）、`preview-3d/screenshot-render.ts`（复用 buildSceneMesh + loadTextures 做离屏多角度截图，ADR-136 归位）
- 上游数据：Go `GetModel3DSpec` binding ← [go_threejs](./go-threejs.md) `threejs.Build()`；纹理/模型对象来自 [go_geometry](./go-geometry.md)

## 不变量

- **致命陷阱 #11**：3D 坐标变换是全项目 fix 次数最多的区域（model3d.ts 历史 fix 第一）。坐标口径必须对齐 YSMViewer：pivot X 取反、`from.x = origin.x - size.x`（Go go/threejs 实现）。**消费侧（mesh.ts buildSceneMesh / 各适配器 build）直接透传 Go 坐标，不再二次翻转**；JS 兜底 model3d-spec.ts 的 cubePivot/cubeOrigin **不做 X 取反、与 Go 口径不一致**（已废弃无运行时影响）。改 model2d/model3d/threejs spec 前先 grep `docs/archive/bug-chronicle.md`，改完用自由相机近距验证
- `dispose()` 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/pointer/resize/fullscreenchange 全部监听（Pointer Events 迁移，ADR-047）、dispose controls/renderer/geometry/material、清空容器 —— 缺一即泄漏
- **Three.js 资源 dispose 模式**：移除 `Object3D` 时，`Object3D.remove()` 只从场景图移除引用，**不释放底层 WebGL 资源**。必须遍历子对象并调用 `geometry?.dispose()`、`material?.dispose()`、`texture?.dispose()`
- 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径；JS 兜底算法（model3d-spec.ts）已废弃，不再承担降级职责
- **纹理绑定不静默兜底**（2026-08-23 根除）：`mesh-builder.ts` 槽位越界/缺图 → 灰色占位 + `console.error`（含组件 boneId/期望索引），**绝不「找第一张可用」贴错图**——贴错皮肤还装没事比诚实暴露映射断裂糟糕得多（wine_fox 多组件渲染错乱帮凶）。排查入口：环形日志搜 `纹理槽位缺失`
- **perComponent 纹理链**：Go `FindComponentsInExtractedYSM`（解压目录）/`buildComponents`（zip/7z）给未声明组件挂同名纹理 `ComponentTextures`（TexSlot=0 局部索引）→ `GetModel3DSpec` 经 `injectComponentTextures` 注入 `spec.componentTextures` → 前端 `preloadModel` 转 `componentTexMap` → `ysm-object.ts` 按 `mg.name || mg.id` 查表。**键 = SourceName**（如 "main"/"arm"/"arrow"），与 spec.models[i].name 同源（BuildMulti 中 Name=SourceName，fallback compID="comp_N"）。Go 侧注入时若 SourceName 为空则 fallback `comp_<i>`；前端查表顺序 `mg.name || mg.id` 两路均能命中。**分类索引与绑定索引同一空间**（2026-08-23 收口）：组件分支恒用局部槽 0（mesh-builder 对组件数组 `arr === compTexArr ? 0`），非组件回退全局 `mesh.texIdx`/`resolvedTexIdx`——绝不用全局 texIdx 查组件数组（WASM 路径 TexSlot=组件文件序 i，对长度 1 数组越界 → blend 组件误判 batchable 被烘进不透明批次）。Go 注入侧 SourceName 碰撞（zip 内两子目录同名 geometry）→ log 告警不静默丢映射
- 治理红线 R1：模块级状态不挂 `window.__*`（场景状态收敛进 mount3D 会话 + sceneRegistry）

## ⚠️ 大文件性能阈值

> **状态**：欠账（ADR-049:98）。100MB 上限是唯一防线，但从未在真实设备上实测校准。

### 内存拷贝链（解码时 peak）

网页版 WASM 解码流水线在解码瞬间存在 2-3 份全量拷贝：

```
Go/binding 返回 base64 字符串        ← 拷贝①：文本形态（~1.33× 原始大小）
  │
  ▼
b64ToBytes → Uint8Array             ← 拷贝②：二进制形态（原始大小）
  │
  ▼
_writeHeap → _malloc → HEAPU8.set   ← 拷贝③：WASM 线性内存（原始大小）
  │
  ▼
WASM 解码 → MEMFS 输出文件            ← 拷贝④：WASM 内部 FS（解码后产物）
  │
  ▼
collectOutputFiles → FS.readFile    ← 拷贝⑤：JS 侧读取解码结果
  │
  ▼
parseBedrockGeometry → JSON.parse   ← 拷贝⑥：字符串化 + 解析
```

**关键点**：拷贝③④⑤⑥在解码过程中并存，但拷贝③（`_malloc`）在 `finally` 块中 `_free` 释放（`ysm-parser.ts`），拷贝⑤在读取后通过 `wipeDir` 清理 MEMFS 残留（`ysm-parser.ts`）。**不存在长期泄漏，但解码瞬间 peak 内存可达 ~3-4× 文件大小。**

### 当前 100MB 防线（四层互锁）

| 层 | 文件 | 常量 | 阶段 |
|----|------|------|------|
| 导入层（网页） | `web-common.ts` | `MAX_IMPORT_BYTES = 100MB` | 拖入/选择文件时过滤 |
| 导入层（桌面） | `import-dnd.ts` | 引用 `MAX_IMPORT_BYTES` | 拖入文件时过滤 |
| ZIP 解压 | `extract.ts` | `MAX_ZIP_FILE_BYTES = 100MB` | 单 entry 解压前拦截 |
| NBT 解析 | `nbt-parse.ts` | `MAX_NBT_BYTES = 100MB` | 解压后 NBT 解析前 |
| Spec 构建 | `spec-builder.ts` | `MAX_PARSE_SIZE = 100MB` | 解析 bedrock geometry JSON 前 |
| Go 侧（桌面） | `geometry/parse.go` | `maxParseSize = 100MB` | 服务端解析 |
| Go 侧（桌面） | `litematic/nbt.go` | `maxDecodedBytes = 100MB` | 服务端 NBT 解析 |

所有 100MB 阈值同源（继承自 Go `geometry/parse.go` 的设计值），但 **从未在网页版真实设备上实证**——包括低端手机（4GB RAM）、中端平板、旧款 Chromebook 等边缘场景。

### 解码后释放策略现状

| 策略 | 状态 | 说明 |
|------|------|------|
| `_malloc` → `_free` | ✅ 已落地 | `ysm-parser.ts` finally 块释放 |
| MEMFS `wipeDir` | ✅ 已落地 | `decodeYsmFile` 末尾清理 `/output` 和 `/input`；`decodeYsmFileFromMemory` 不写 MEMFS，无需清理 |
| 并发去重守卫 | ✅ 已落地 | `wasm.ts` `_decodeInFlight` Map，同一路径只解码一次 |
| LRU spec 缓存 | ✅ 已落地 | `model3d-loader.ts` `SPEC_CACHE_MAX = 20`，用 Map 淘汰 |
| Worker 独立 HEAP | ✅ 已落地 | `ysm-worker-loader.ts` stats worker 内独立 WASM 实例，不占主线程 HEAP |
| base64 中间态及时释放 | ⚠️ 依赖 GC | `b64ToBytes` 返回的 `Uint8Array` 在 `_decodeYsmViaWasm` 内无显式释放，依赖 V8 GC（解码结束后自然可达） |
| 大文件导入后 IDB 残留 | ⚠️ 未评估 | 100MB 文件写入 IDB 后删除，IDB 是否及时回收空间未验证 |

### 如需实测阈值

```bash
# 1. 启动网页版
cd frontend && npm run dev:web

# 2. 准备不同大小的测试模型（可用 Python/Node 生成填充骨架）
#    建议测试梯度：10MB、30MB、50MB、80MB、100MB、120MB（超限验证）

# 3. 在 Chrome DevTools → Performance 面板录制解码过程，记录：
#    - JS Heap 峰值（尤其是解码瞬间）
#    - DOM GC 后的常驻内存
#    - 解码耗时
#    - 是否触发 OOM / tab 崩溃

# 4. 至少覆盖 3 类设备：
#    - 低端（4GB RAM，Chrome）
#    - 中端（8GB RAM，Edge）
#    - 高端（16GB+ RAM，Chrome）

# 5. 实测数据填回本表，并据此调整 MAX_IMPORT_BYTES 等阈值
```

## 相关

- [ADR-049](../adr/ADR-049-web-edition-bridge.md) — 网页版桥接（含大文件性能欠账）
- [ADR-052](../adr/ADR-052-render-session-objectification.md) — RenderSession 对象化决策（落地后删除，见文件内后续状态注记）
- [ADR-066](../adr/ADR-066-universal-resource-preview.md) — 统一预览核心（现行会话外壳）
- [ADR-093](../adr/ADR-093-multi-model-scene-core.md) — 多模型同框（sceneRegistry / 拾取 dispatch）
- [ADR-040](../adr/ADR-040-architecture-scale-governance.md) — 架构治理（拆分基准）
- [ADR-047](../adr/ADR-047-android-usability-plan.md) — Pointer Events 统一
- [go-threejs](./go-threejs.md) — spec 生成（Go 端）
- [model2d](./model2d.md) — 2D 预览（同一坐标口径约束）
- [app_preview](./app-preview.md) — 预览面板消费方
- [web-edition 路线图](../roadmap/web-edition.md) — 网页版性能线 R4
- `frontend/src/preview-3d/cube-mesh.ts` — computeBoneLocalPos 工具
