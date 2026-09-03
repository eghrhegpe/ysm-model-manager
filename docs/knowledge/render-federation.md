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
    - AmbientLightParams
    - attenuateAmbientForSky
    - cleanupPreview
    - DEFAULT_ENV_PARAMS
    - DEFAULT_FOG_PARAMS
    - DEFAULT_GROUND_PARAMS
    - DEFAULT_LIGHT_PARAMS
    - DEFAULT_POSTPROC_PARAMS
    - DEFAULT_SHADOW_PARAMS
    - DEFAULT_SKY_PARAMS
    - DirectionalLightParams
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
    - hasActivePreview
    - injectSkySunScalePatch
    - invalidatePreview
    - isSkyEnvironmentOn
    - LIGHT_PRESETS
    - LightCapability
    - lightDirToPosition
    - LightParams
    - MODEL_SKY_PRESETS
    - mount3D
    - Mount3DOptions
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
    - SHADOW_PRESETS
    - ShadowCapability
    - ShadowParams
    - SkyCapability
    - SkyModelType
    - SkyParams
    - SpotlightParams
    - switchPreview
    - VolumetricParams
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
status: active
---

# 联邦渲染能力 (Render Federation)

## 概述

基于 **ADR-073** 确立的联邦架构，每个渲染特性（天空、地面、灯光、Bloom 等）是一个独立的 `SceneCapability` 类，在 `sceneCapabilityRegistry` 中注册，由 `mount-preview-core.ts` 统一创建 → apply → refreshDock。

## 注册顺序（决定场景层叠）

```
Sky → Ground → Environment → Fog → Light → Shadow → Reflector → Postprocessing
```

## Cap 清单

| ID | 文件 | 默认开启 | v1.14 状态 | 职责 |
|----|------|---------|-----------|------|
| sky | sky-capability.ts | ❌ false | ✅ preset enabled（MMD exposure↑, VRM turbidity↓） | 大气散射天空盒 + IBL 环境贴图联动 + God Rays + Sunset Tint |
| ground | ground-capability.ts | ✅ true | ✅ size 50→80, wetness 0→0.15 (微湿地面光泽), grid对比加深 | GridHelper + 程序化表面纹理 + 动态水面叠加 |
| environment | environment-capability.ts | - | ✅ HDR 序列支持 + histogram | 背景色/HDR序列切换 + 背景开关 |
| fog | fog-capability.ts | - | - | 近远雾（线性/指数），与天空融合 |
| light | light-capability.ts | - | ✅ MMD/VRM volumetric+spotlight enabled:true, rim增强 | 三点布光(key/fill/rim) + Spotlight体积光锥 + 模型预设 |
| shadow | shadow-capability.ts | - | - | 深度图阴影投射（需启用 spotlight） |
| reflector | reflector-capability.ts | - | - | 单平面镜面反射（SSR 开启时自动禁用防 z-fighting） |
| postprocessing | postprocessing-capability.ts | - | ✅ MMD/VRM bloom enabled:true, strength上调 | Bloom + SSAO + SSR + ToneMapping + Exposure |

## UI 暴露路径

每个 Cap 实现 `getMenuControls(): MenuControlDef[]`，返回菜单项定义数组。
`preview-menu/core.ts` 的 `refreshDock()` 调用 `cap.getMenuControls()` 渲染到 dock-nav。

分组示例（postprocessing）：
- Basic: enabled toggle / toneMapping / exposure
- Bloom: strength / threshold / radius
- SSAO: enabled / radius / minDist / maxDist
- Reflection: mode (envmap-only/envmap+ssr/ssr-only) / opacity / maxDistance

## 性能注意

- Bloom + SSR + SSAO 三开是"重型组合"，低端 Android WebView 建议至少关闭 SSAO
- Volumetric cone 只在 `spotlight.enabled && volumetric.enabled` 同时真时渲染
- Postprocessing composer 延迟创建：需要时才 new EffectComposer，节省 GPU 资源
- **总闸与门禁分层（2026-08-29 审核修复）**：`setEnabled`（手动开关 pp-enabled）写 `this.enabled` + `params.enabled`；`setMasterEnabled`（性能档位 render.bloom 入口）只写 `this.enabled`，**不触碰 per-type 门禁 `params.enabled`**——总闸 off 再 on 不会把门禁抹掉（旧实现经 `setEnabled(false)` 把门禁写死，VRM/MMD bloom 再也开不回来）。
- **`setPreset` composer 只构建一次（2026-08-29 审核修复）**：enabled 翻转分支内 buildComposer 后，末尾不再无条件重建；仅「enabled 未变且已启用」路径重建（同步 loadState 更新的参数）。此前翻转 false→true 时 composer 被 dispose+重建两遍。

## v1.14 视觉调优变更

- [x] PostProcessing: MMD bloom `strength:0.8→1.0, threshold:0.6→0.5, enabled:false→true`; VRM `enabled:false→true, threshold:0.65→0.7`
- [x] Sky: MMD exposure `0.42→0.55`; VRM turbidity `8→7`; YSM exposure `0.6→0.55`
- [x] Ground: size `50→80`, divisions `50→60`, wetness `0→0.15`, waterOpacity `0.6→0.25`, grid color 加深
- [x] Light: MMD/VRM `volumetric.enabled` / `spotlight.enabled` → true; rim intensity 提升; key intensity 微调
- [ ] Shadow: pending — 待打开 spotlight.shadow.enabled 配合 volumetric
- [ ] Light UI panel: pending — 菜单控件已有(getMenuControls)，但顶层入口需确认用户是否可见
