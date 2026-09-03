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
    - buildGroundSurfaceSpec
    - createListenerSet
    - DEFAULT_ENV_PARAMS
    - DEFAULT_FOG_PARAMS
    - DEFAULT_GROUND_PARAMS
    - DEFAULT_GROUND_SURFACE_PARAMS
    - DEFAULT_LIGHT_PARAMS
    - DEFAULT_POSTPROC_PARAMS
    - DEFAULT_REFLECTOR_PARAMS
    - DEFAULT_SHADOW_PARAMS
    - DEFAULT_SKY_PARAMS
    - DEFAULT_WATER_PARAMS
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
    - FieldRestorer
    - FOG_PRESETS
    - FogCapability
    - FogMode
    - FogParams
    - generateSurfacePixels
    - GroundCapability
    - GroundMaterialParams
    - GroundParams
    - GroundSurfaceAppearanceSpec
    - GroundSurfaceMode
    - groundSurfaceNeedsRebuild
    - GroundSurfaceSpec
    - GroundSurfaceStructuralSpec
    - injectSkySunScalePatch
    - isSkyEnvironmentOn
    - LIGHT_PRESETS
    - LightCapability
    - lightDirToPosition
    - LightParams
    - MAX_MODELS
    - MenuControlDef
    - MenuControlKind
    - MODEL_SKY_PRESETS
    - ModelEntry
    - persistState
    - POSTPROC_PRESETS
    - PostprocessingCapability
    - PostprocessingParams
    - ReflectionMode
    - REFLECTOR_PRESETS
    - ReflectorCapability
    - ReflectorParams
    - RenderModeCapability
    - restoreFields
    - restoreState
    - SceneCapability
    - SceneCapabilityFactory
    - SceneCapabilityLookup
    - sceneCapabilityRegistry
    - SceneCapabilityRegistry
    - sceneRegistry
    - SHADOW_PRESETS
    - ShadowCapability
    - ShadowParams
    - SkyCapability
    - SkyModelType
    - SkyParams
    - SpotlightParams
    - surfaceSpecKey
    - textureRepeat
    - TILE_WORLD_SIZE
    - VolumetricParams
    - WaterCapability
    - WaterMode
    - WaterParams
    - WireframeCapability
  tests:
    - frontend/src/preview-3d/caps/scene-capability-registry.test.ts
    - frontend/src/preview-3d/caps/ground-capability.test.ts
    - frontend/src/preview-3d/caps/light-capability.test.ts
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
  - 3D 会话生命周期（createAll / loadAll / setPreset / saveAll / dispose）
  - 「光」指代消歧（light 是光源，fog/shadow/reflector 不是）
perf:
  - gpu-bound
invariant_anchors:
  - frontend/src/preview-3d/caps/scene-capability-registry.ts|sceneCapabilityRegistry
  - frontend/src/preview-3d/caps/scene-capability.ts|SceneCapability
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|createAll
  - frontend/src/preview-3d/menu/env.ts|buildEnvSchema
  - frontend/src/preview-3d/menu/env.ts|renderEnvLevel
status: active
---

# 场景能力注册表 scene-capability-registry

## 概览

ADR-073 扩展落地的**场景能力注册表**：所有场景能力（Sky / Ground / Environment / Fog / Shadow / Reflector / Light / Postprocessing）由统一注册表**创建、持久化、释放**，菜单由各能力的 `getMenuControls()` 声明式驱动。新增能力只需两步——实现 `SceneCapability` 接口 + 在 registry 底部 `add()` 注册一行——菜单/生命周期/持久化零手工 wiring。

这正是「**新类型加面板零改核心菜单**」的机制：隔壁会话按此模式在 2 小时内接入了 Fog/Shadow/Reflector/Environment/Postprocessing 五个新能力，核心菜单只字未动。

## 核心职责

- **能力工厂注册与实例化**：`add(factory)` 登记工厂；`createAll({ scene, renderer })` 先 `dispose()` 旧实例，再逐个工厂 try/catch 创建（单个能力抛错不阻断其余）
- **统一生命周期**（mount-preview-core 驱动）：
  1. `createAll` → 2. `getById` 引用 → 3. `loadAll`（localStorage 恢复）→ 4. `setPreset(adapter.id)`（模型类别预设，已有持久化值不覆盖用户显式选择）→ 5. `apply()` 挂入场景 → 会话结束 `saveAll()` + `dispose()`
- **声明式菜单**：每 cap 的 `getMenuControls()` 返回 `MenuControlDef[]`，`preview-menu` 的 `renderCapControls` 统一渲染十种控件（`toggle / slider / select / button / divider / image / color / timeline / histogram / preset-thumb`，全 kind 带 `cap-<id>` testid）。**菜单层不碰能力实现**——引擎/锥角/预设等参数操作全部由 cap 自报控件。2026-09 起 cap 控件可经 `PreviewMenuNode.controls`（声明式节点新 kind）原生进任意面板，settings/env 不再 `renderCustom` 套壳
- **持久化**：`persistState` / `restoreState`（localStorage 前缀 `ysm-scene-cap-`，隐私模式安全降级静默）

## 对外 API / 入口

- `sceneCapabilityRegistry`（`scene-capability-registry.ts` 模块级单例）：`add` / `createAll` / `getAll` / `getById` / `saveAll` / `loadAll` / `dispose` / `getFactoryCount`
- `SceneCapability` 契约（`scene-capability.ts`）：`id` / `labelKey` / `icon` / `descKey` / `apply` / `dispose` / `setEnabled` / `isEnabled` / `getMenuControls` / `saveState` / `loadState`（`setPreset` 可选）
- `MenuControlDef`：`id`（稳定，持久化/调试用）/ `kind` / `labelKey` / `fallback` / `slider?` / `select?` / `getValue` / `setValue`

## 与其他子系统关系

- **mount-preview-core**：`createAll` 建实例 → `getById("sky"/"ground"/"light"/"fog"/"shadow"/"reflector"/"environment"/"postprocessing")` 引用 → 生命周期驱动；Shadow 额外调 `syncLights` / `applyMeshCasts`（与 Light 解耦，经 scene 遍历取光）
- **preview-menu / preview-menu/env**：环境面板由 `preview-menu/core.ts` 经 `buildEnvSchema`（声明式 schemaBuilder，内部调 `renderEnvLevel`）只收 **ENV_IDS 白名单**（sky/ground/environment/fog/reflector，`getAll().filter(ENV_IDS.has)`），`fillLighting` 查 `light`，阴影面板查 `shadow`——同一能力控件**不会双面板重复**
- **mount-preview-core `fullCleanup`**：会话清理统一 `saveAll()` + `dispose()`，cap 自身 dispose 还原构造前状态（`scene.fog` / `renderer.shadowMap` / tone mapping 等）
- **i18n**：cap 的 `labelKey`/`descKey` 需三语入库（`frontend/src/core/i18n/locales/`），缺键时 `tr()` 回退 fallback 中文

## 不变量

- **注册顺序 = 菜单渲染顺序**：Sky → Ground → Environment → Fog → Shadow → Reflector → Light（→ Postprocessing），与「先环境后灯光」心智一致，新能力按此语义插队注册
- **`scene-capability.ts` 只含接口/类型/持久化工具**：旧版双单例（`sceneCapabilityRegistry`）已于 2026-08-18 清理删除，**勿从该文件 import 同名单例**——唯一实现在 `scene-capability-registry.ts`
- **「光」指代消歧**：`light` 是唯一光源能力（主灯/补灯/轮廓灯/顶光/环境光/体积光）；`fog`（雾）、`shadow`（阴影）、`reflector`（反射）不是光源，菜单/语义归环境类
- **setPreset 只做合理默认**：不覆盖用户显式选择（reflectionMode / enabled 等持久化值优先）
- **cap 间协调走构造注入，不 import registry**：`createAll` 向每个工厂 ctx 注入 `caps` 查询器（`SceneCapabilityLookup.getById`，`scene-capability.ts` 接口叶）；cap 需要联动其他能力（如 sky 环境开关 → light ambient ×0.5）时经 `this.caps?.getById(...)`——本组合根 import 全部 cap，cap 反向 import registry 即成模块环（check-circular 卡点，2026-08-29 破环）。跨组件查询的模块级函数放组合根（如 `isSkyEnvironmentOn` 在 registry 文件，消费方 `preview-3d/screenshot-lights.ts` 的 toScreenshotLights 截图 ambient 镜像，ADR-136 归位）
- **ambient ×0.5 让位系数单源**：`SKY_ENV_AMBIENT_ATTENUATION` / `attenuateAmbientForSky()` 在 light-capability.ts 导出——预览（refreshAmbientFromSky）与截图（`screenshot-lights.ts` toScreenshotLights）共用，禁止两处手写 0.5（镜像漂移教训）
- **决策记录：三点灯全关不回退标准灯**（7531eef3 定版，取代 e8178c82 初版「全关回退标准灯」语义）：仅 light cap 缺席才回退标准灯；cap 在场但三点全关 = 用户刻意的暗场景，截图必须保持暗。下一个觉得「暗场景截图偏暗像 bug」的人：这是特性不是缺陷
- **dispose 必须还原构造前状态**（prevFog / prevShadowMap / prevToneMapping），防跨会话泄漏

## 相关

- ADR-073（caps/ 能力模式）、ADR-075（环境面板）、ADR-081（灯光 L1/L2）、ADR-099（3D Cap Registry 分层与 SSR 闭环）
- 知识卡：`preview_core.md`（统一 3D 预览核心，mount3D 生命周期）
