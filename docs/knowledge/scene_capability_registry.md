---
kind: scene_capability_registry
name: 场景能力注册表 scene-capability-registry
tier: architecture
adr:
  - ADR-132
category: rendering
source_files:
  - frontend/src/preview-3d/caps/
  - frontend/src/preview-3d/infra/scene-registry.ts
auto_fields:
  symbols_with_lines:
    - AmbientLightParams
    - AntiRepeatDualOptions
    - AntiRepeatOptions
    - AntiRepeatStrategy
    - applyGroundSurfaceAppearance
    - applyGroundSurfaceStructural
    - applyOverlayMaterial
    - attenuateAmbientForSky
    - bindFieldRestorers
    - buildEnvironmentNodes
    - buildFogNodes
    - buildGroundNodes
    - buildGroundOverlaySpec
    - buildGroundSurfaceSpec
    - buildLightNodes
    - buildLightPersistPayload
    - buildPostprocessingNodes
    - buildReflectorNodes
    - buildRenderModeNodes
    - buildShadowNodes
    - buildSkyNodes
    - buildWaterNodes
    - CapabilityId
    - CapabilityMap
    - clampPoolRoundness
    - customHdrThumbnail
    - DeepPartial
    - DEFAULT_GROUND_SURFACE_PARAMS
    - DEFAULT_LIGHT_PARAMS
    - DEFAULT_POSTPROC_PARAMS
    - derandomize
    - derandomizeDual
    - drawEnvEquirect
    - effectiveParamsOf
    - ENV_PRESETS
    - EnvBorrowedTextures
    - EnvironmentCapability
    - EnvironmentParams
    - EnvMigrationInput
    - envOwnsSceneEnvironment
    - EnvPlacement
    - EnvPreset
    - EnvPresetId
    - EnvSectionId
    - EnvSource
    - fbm2
    - fcMasterToggleNode
    - FieldKind
    - FieldRestorer
    - filmStrategy
    - FLATTEN_MAP
    - flattenLightParams
    - FogCapability
    - FogMode
    - generateGrassPixels
    - generateMarblePixels
    - generateOverlayPixels
    - generatePlainPixels
    - generateSandPixels
    - getTypedCap
    - getWaterBodyStrategy
    - godRaysIntensity
    - GROUND_CANVAS_STYLES
    - GROUND_LAYER_OFFSETS
    - GROUND_MAT_PARAMS
    - GROUND_MATERIAL_PRESET_IDS
    - GROUND_MATERIAL_PRESET_KEYS
    - GROUND_MATERIAL_PRESETS
    - GROUND_OVERLAY_STYLES
    - GROUND_SOURCE_KINDS
    - GROUND_SURFACE_MODES
    - GroundAxisMapping
    - GroundCanvasStyle
    - GroundCapability
    - GroundMaterialParams
    - GroundMaterialPreset
    - GroundMaterialPresetDef
    - GroundMatParam
    - groundMatSourceFromAxes
    - GroundOverlayParams
    - GroundOverlaySpec
    - GroundOverlayStyle
    - GroundSourceKind
    - GroundSurfaceAppearanceSpec
    - GroundSurfaceMode
    - groundSurfaceNeedsRebuild
    - GroundSurfaceSpec
    - GroundSurfaceStructuralSpec
    - injectSkySunScalePatch
    - INNER_WALL_OPACITY_FACTOR
    - isEnvDisposableSource
    - isSkyEnvironmentOn
    - LEGACY_CANVAS_PATTERNS
    - LEGACY_GROUND_MAT_SOURCES
    - LegacyGroundMatSource
    - LIGHT_AMBIENT_FOLDER_ID
    - LIGHT_MASTER_NODE_ID
    - LIGHT_SLOT_FOLDER_ID
    - LIGHT_SLOTS
    - LIGHT_VOL_CARD_ID
    - LightCapability
    - lightDirToPosition
    - lightEnvKeys
    - LightInstanceParams
    - LightKey
    - LightParams
    - LightSlot
    - lightSlotLabelKey
    - LightType
    - lowFreqMask
    - luminanceHistogram
    - makeDecorrelatedVariant
    - MAX_MODELS
    - maxSeamDiscontinuity
    - maxWrapSeamDiscontinuity
    - migrateEnvSource
    - migrateGroundMatSource
    - ModelEntry
    - normalizeEnvLegacyState
    - normalizeGroundLegacyState
    - oneOf
    - OVERLAY_TEX_SIZE
    - overlayNeedsRebuild
    - overlaySpecKey
    - paramIsEffective
    - persistState
    - pickPersistFields
    - poolStrategy
    - POSTPROC_PERSIST_FIELDS
    - PostprocessingCapability
    - PostprocessingParams
    - PP_PARAMS_TO_ENV
    - rcMasterToggleNode
    - readLightParams
    - REFLECTION_MODES
    - ReflectionMode
    - ReflectorCapability
    - registerWaterBodyStrategy
    - RenderModeCapability
    - repetitionScore
    - restoreBySchema
    - restoreFields
    - restoreLightParams
    - restoreState
    - ringLog
    - SceneCapability
    - SceneCapabilityFactory
    - SceneCapabilityLookup
    - sceneCapabilityRegistry
    - SceneCapabilityRegistry
    - sceneRegistry
    - ShadowCapability
    - ShadowType
    - SkyCapability
    - smoothStep
    - spotDistanceAttenuation
    - SunBeams
    - SURFACE_PIXEL_GENERATORS
    - SurfaceCanvasStyle
    - SurfacePixelGenerator
    - SurfacePixelInput
    - surfaceSpecKey
    - textureRepeat
    - textureRepeatForDerepeat
    - TILE_WORLD_SIZE
    - tiledFbm
    - tilePlain
    - TONE_MAPPING_KEYS
    - valueNoise2
    - valueNoise4D
    - VolumetricCone
    - VolumetricDriver
    - VolumetricParams
    - WATER_FRAME_READ_KEYS
    - WATER_MODES
    - WATER_NOOP_APPLIER_KEYS
    - WATER_PARAM_APPLIER_KEYS
    - WATER_UNIFORM_NAMES
    - WATER_WAVE_SEGMENTS
    - WaterBody
    - WaterBodyStrategy
    - WaterBuildContext
    - WaterCapability
    - WaterMode
    - WaterPartRole
    - WaterTopMesh
    - WaterUniformName
  tests:
    - frontend/src/preview-3d/caps/scene-capability-registry.test.ts
    - frontend/src/preview-3d/caps/ground-capability.test.ts
    - frontend/src/preview-3d/caps/light-capability.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 场景能力 / cap / registry
  - 新增 3D 能力（雾/阴影/反射/环境/灯光/后处理）
  - createAll / loadAll / setPreset / saveAll / dispose
  - 3D 菜单控件声明式渲染
quick_risk_lines:
  - 3D 能力必须走 scene-capability-registry 注册，禁止在 adapter 里直接创建场景对象
pitfalls:
  - adapter 直接创建场景对象 → 能力列表 / 菜单 / 状态同步不一致；必须经 sceneCapabilityRegistry 注册
  - 能力未实现 getMenuControls → 菜单缺控件；必须在 SceneCapability 接口中实现 getMenuControls

use_when:
  - 场景能力 / cap / registry / SceneCapability
  - 3D 菜单控件声明式渲染（getMenuControls）
  - 新增 3D 能力（雾/阴影/反射/环境/灯光/后处理）
  - 3D 会话生命周期（createAll / loadAll / applyModelPreset / saveAll / dispose）
  - 「光」指代消歧（light 是光源，fog/shadow/reflector 不是）
perf:
  - gpu-bound
invariant_anchors:
  - frontend/src/preview-3d/caps/scene-capability-registry.ts|sceneCapabilityRegistry
  - frontend/src/preview-3d/caps/scene-capability.ts|SceneCapability
  - frontend/src/preview-3d/caps/scene-capability-registry.ts|createAll
  - frontend/src/preview-3d/menu/panels/env.ts|buildEnvSchema
  - frontend/src/preview-3d/menu/panels/env.ts|envCapRow
status: active
---

# 场景能力注册表 scene-capability-registry
> **架构事实已迁移至 **[architecture.md#73-场景能力注册表adr-073](../architecture.md#73-场景能力注册表adr-073)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
