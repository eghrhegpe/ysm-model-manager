---
kind: render-federation
name: 联邦渲染能力 (Render Federation)
category: rendering
tier: architecture
adr:
  - ADR-125
source_files:
  - frontend/src/preview-3d/caps/scene-capability-registry.ts
  - frontend/src/preview-3d/caps/sky-capability.ts
  - frontend/src/preview-3d/caps/ground-capability.ts
  - frontend/src/preview-3d/caps/light-capability.ts
  - frontend/src/preview-3d/caps/postprocessing-capability.ts
  - frontend/src/preview-3d/caps/environment-capability.ts
  - frontend/src/preview-3d/caps/fog-capability.ts
  - frontend/src/preview-3d/caps/shadow-capability.ts
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
auto_fields:
  symbols_with_lines:
    - _resetSingletons
    - attenuateAmbientForSky
    - BaseScene
    - CameraControlScene
    - cleanupPreview
    - DEFAULT_ENV_PARAMS
    - DEFAULT_FOG_PARAMS
    - DEFAULT_GROUND_PARAMS
    - DEFAULT_POSTPROC_PARAMS
    - DEFAULT_SHADOW_PARAMS
    - DEFAULT_SKY_PARAMS
    - drawEnvEquirect
    - ENV_PRESET_BY_MODEL
    - ENV_PRESET_LINKAGE
    - ENV_PRESETS
    - EnvironmentCapability
    - EnvironmentParams
    - EnvPreset
    - EnvPresetId
    - EnvPresetLinkage
    - FOG_PRESETS
    - FogCapability
    - FogMode
    - FogParams
    - GroundCapability
    - GroundParams
    - GroupedScene
    - hasActivePreview
    - injectSkySunScalePatch
    - invalidatePreview
    - isSkyEnvironmentOn
    - LightCapability
    - lightDirToPosition
    - MODEL_SKY_PRESETS
    - mount3D
    - Mount3DOptions
    - PoseScene
    - POSTPROC_PRESETS
    - PostprocessingCapability
    - PostprocessingParams
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - ReflectionMode
    - SceneCapabilityFactory
    - sceneCapabilityRegistry
    - SceneCapabilityRegistry
    - ScreenshotScene
    - SemanticScene
    - SHADOW_PRESETS
    - ShadowCapability
    - ShadowParams
    - SkyCapability
    - SkyModelType
    - SkyParams
    - switchPreview
    - UpdateableScene
  tests:
    - frontend/src/preview-3d/adapters/__tests__/mount-preview-core.test.ts
    - frontend/src/preview-3d/caps/environment-capability.test.ts
    - frontend/src/preview-3d/caps/fog-capability.test.ts
    - frontend/src/preview-3d/caps/ground-capability.test.ts
    - frontend/src/preview-3d/caps/light-capability.test.ts
    - frontend/src/preview-3d/caps/postprocessing-capability.test.ts
    - frontend/src/preview-3d/caps/scene-capability-registry.test.ts
    - frontend/src/preview-3d/caps/shadow-capability.test.ts
    - frontend/src/preview-3d/caps/sky-capability.test.ts
  related_adrs:
    - ADR-073-federal-render-caps
    - ADR-084-personal-lighting
    - ADR-097-scene-capability-registry
use_when:
  - 联邦渲染
  - shared renderer
  - rAF 复用
  - 多 3D 场景
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 渲染联邦、shared renderer、rAF 复用
  - 多 3D 场景共存
quick_risk_lines:
  - 多 3D 场景必须走 render-federation 的 shared renderer / rAF，禁止各自创建 renderer
pitfalls:
  - 各自创建 renderer → 多 rAF 循环、GPU 资源浪费；必须经 render-federation 共享
  - rAF 未统一节流 → 帧率不统一；必须经 federation 的 rAF 调度
created: 2026-08-xx
updated: 2026-08-xx
description: ADR-073 确立的联邦渲染能力架构：caps/ 下的 SceneCapability 通过 sceneCapabilityRegistry 统一注册、自动挂载与菜单暴露
related_adrs:
  - ADR-073-federal-render-caps
  - ADR-084-personal-lighting
  - ADR-097-scene-capability-registry
perf:
  - gpu-bound
invariant_anchors:
  - frontend/src/preview-3d/caps/scene-capability-registry.ts|sceneCapabilityRegistry
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|mount3D
status: active
---

# 联邦渲染能力 (Render Federation)
> **架构事实已迁移至 **[architecture.md#73-场景能力注册表adr-073](../architecture.md#73-场景能力注册表adr-073)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
