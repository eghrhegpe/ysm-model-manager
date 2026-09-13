---
kind: scene_capability_registry
name: 场景能力注册表 scene-capability-registry
tier: architecture
adr:
  - ADR-132
category: rendering
source_files:
  - frontend/src/preview-3d/caps/
  - frontend/src/preview-3d/adapters/scene-registry.ts
auto_fields:
  symbols_with_lines:
    - AmbientLightParams
    - applyGroundSurfaceAppearance
    - applyGroundSurfaceStructural
    - attenuateAmbientForSky
    - bindFieldRestorers
    - buildEnvironmentNodes
    - buildFogNodes
    - buildGroundNodes
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
    - customHdrThumbnail
    - deepMergeLightParams
    - DeepPartial
    - DEFAULT_GROUND_SURFACE_PARAMS
    - DEFAULT_LIGHT_PARAMS
    - DEFAULT_POSTPROC_PARAMS
    - DEFAULT_SHADOW_PARAMS
    - DEFAULT_SKY_PARAMS
    - DEFAULT_WATER_PARAMS
    - DirectionalLightParams
    - drawEnvEquirect
    - ENV_PRESETS
    - EnvironmentCapability
    - EnvironmentParams
    - EnvPreset
    - EnvPresetId
    - fcMasterToggleNode
    - FieldKind
    - FieldRestorer
    - flattenLightParams
    - FogCapability
    - FogMode
    - generateSurfacePixels
    - getTypedCap
    - godRaysIntensity
    - GROUND_LAYER_OFFSETS
    - GroundCapability
    - GroundMaterialParams
    - GroundSurfaceAppearanceSpec
    - GroundSurfaceMode
    - groundSurfaceNeedsRebuild
    - GroundSurfaceSpec
    - GroundSurfaceStructuralSpec
    - injectSkySunScalePatch
    - isSkyEnvironmentOn
    - LightCapability
    - lightDirToPosition
    - LightParams
    - luminanceHistogram
    - MAX_MODELS
    - ModelEntry
    - oneOf
    - persistState
    - pickPersistFields
    - POSTPROC_PERSIST_FIELDS
    - POSTPROC_PRESETS
    - PostprocessingCapability
    - PostprocessingParams
    - PP_PARAMS_TO_ENV
    - rcMasterToggleNode
    - REFLECTION_MODES
    - ReflectionMode
    - ReflectorCapability
    - RenderModeCapability
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
    - SHADOW_TYPES
    - ShadowCapability
    - ShadowParams
    - ShadowType
    - SkyCapability
    - SkyModelType
    - SkyParams
    - SpotlightParams
    - SunBeams
    - surfaceSpecKey
    - textureRepeat
    - TILE_WORLD_SIZE
    - TONE_MAPPING_KEYS
    - VolumetricCone
    - VolumetricParams
    - WATER_MODES
    - WaterCapability
    - WaterMode
    - WaterParams
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
  - frontend/src/preview-3d/menu/env.ts|buildEnvSchema
  - frontend/src/preview-3d/menu/env.ts|envCapRow
status: active
---

# 场景能力注册表 scene-capability-registry
> **架构事实已迁移至 **[architecture.md#73-场景能力注册表adr-073](../architecture.md#73-场景能力注册表adr-073)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
