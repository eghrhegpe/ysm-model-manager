---
kind: preview_env_state
name: 3D 预览统一状态层 envState（ADR-196）
tier: architecture
category: rendering
adr:
  - ADR-196
status: active
source_files:
  - frontend/src/preview-3d/state/env-state.ts
  - frontend/src/preview-3d/state/env-state-schema.ts
  - frontend/src/preview-3d/state/env-dispatcher.ts
  - frontend/src/preview-3d/state/model-defaults.ts
  - frontend/src/preview-3d/state/atmosphere-presets.ts
  - frontend/src/preview-3d/adapters/shared-infra.ts
tests:
  - frontend/src/preview-3d/adapters/shared-infra.test.ts
auto_fields:
  symbols_with_lines:
    - applyModelDefaults
    - applyPostProcDefaults
    - ATMOSPHERE_PRESETS
    - AtmospherePresetId
    - buildSharedInfra
    - clearEnvCallbacks
    - clearSceneCaps
    - deriveDefaultEnvState
    - dispatchEnvChange
    - ENV_STATE_SCHEMA
    - EnvCallback
    - envState
    - EnvState
    - EnvStateSchema
    - getEnvCallbackCount
    - getPresetKeys
    - getSceneCaps
    - getStateValue
    - MODEL_DEFAULTS
    - ModelType
    - registerEnvCallback
    - resetEnvState
    - resetSceneInfra
    - setEnvState
    - setStateValue
    - SharedInfra
    - teardownSharedInfra
perf: gpu-bound
use_when:
  - 3D 预览场景参数（天空/地面/水面/雾/阴影/反射/环境/后处理/灯光）在哪读哪写
  - cap 参数为何不存 this.params（ADR-196 统一状态层）
  - 新增 cap 参数字段要动哪里（env-state-schema.ts）
  - 排查 cap 参数改动没生效 / 被预设覆盖
pitfalls:
  - 直接改 envState 对象字段（不经 setEnvState）→ 不派发回调，cap 渲染不更新；必须走 setEnvState
  - cap 忘记 registerEnvCallback / dispose 不退订 → 状态变更不落地或泄漏回调
  - 测试不 beforeEach resetEnvState → envState 单例跨用例串扰
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 场景参数 / envState / 统一状态层
  - cap 参数存哪 / 怎么改不生效
  - 新增 cap 参数 / env-state-schema 字段
quick_risk_lines:
  - cap 参数必须存 envState，禁止各自 this.params 私有化（ADR-196）
invariant_anchors:
  - frontend/src/preview-3d/state/env-state.ts|envState
  - frontend/src/preview-3d/state/env-state.ts|setEnvState
  - frontend/src/preview-3d/state/env-state-schema.ts|ENV_STATE_SCHEMA
  - frontend/src/preview-3d/state/env-dispatcher.ts|registerEnvCallback
  - frontend/src/preview-3d/state/env-dispatcher.ts|dispatchEnvChange
---

# 3D 预览统一状态层 envState（ADR-196）

## 概览

全局可变单例 `envState` 收口全部 10 个 SceneCapability 的场景参数（sky/ground/water/environment/fog/shadow/reflector/renderMode/postprocessing/light），cap 退化为「状态 → Three.js」渲染适配器。仿 MikuMikuAR `ENV_STATE_SCHEMA` 模式，菜单-状态绑定从根上打通（刀3 StatePath）。

预设体系三轴（ADR-196 全链）最终统一到单一事实源：
- 模型类别预设 → `MODEL_DEFAULTS[modelType]`（刀5，`Partial<EnvState>`），各 cap `setPreset` 收口为 `setEnvState(..., {source:'auto-model'})`；
- 氛围预设 → `ATMOSPHERE_PRESETS` 完整快照（刀4a）+ `auto-atmosphere` source，取代 ENV_PRESET_LINKAGE 硬编码联动；
- 手动守卫 → `setEnvState` 的 `lastWriteSource` 优先级 `manual > auto-atmosphere > auto-model`，手动调参不被预设覆盖。

## 核心职责

- `env-state-schema.ts`：`ENV_STATE_SCHEMA` 声明全部参数字段 `{ type, default, group }`。键名 = `{cap}{Group}{Field}` 扁平化（`skyTimeOfDay`/`groundMatSource`/`waterMode`/`ppBloomStrength`/`lightKeyIntensity`/`lightSpotAngle`），颜色统一 `number`(hex)（勿用 tuple3——仅 ground 风格 RGB 用 tuple3）。能力级 enabled（cap 是否挂载）**不入 schema**，留 cap 私有 `this.enabled`。`deriveDefaultEnvState()` 派生默认值，`EnvState` 类型由 schema 推导（枚举取 `V[number]`）。
- `env-state.ts`：可变单例 `envState` + `setEnvState(partial, {source})` 中央写入入口 + `getStateValue/setStateValue(path)` StatePath 读写 + `resetEnvState()`（测试用）。写入带 `lastWriteSource`（`auto-model`/`auto-atmosphere`/`manual`），守卫决策 `manual > auto-atmosphere > auto-model`——手动调参不被预设覆盖。
- `env-dispatcher.ts`：`registerEnvCallback(cap, cb)` 回调注册表 + `dispatchEnvChange(changed, state)` 派发（setEnvState 自动触发）。cap 构造时注册、dispose 退订。`clearEnvCallbacks()` 测试用。

## 对外 API / 入口

- `setEnvState(partial, { source })`：唯一写入口。cap setter 收口为它（`source:'manual'`）；模型类别预设用 `source:'auto-model'`；氛围预设（刀4 ATMOSPHERE_PRESETS）用 `auto-atmosphere`。
- cap 公开 setter/getter **保留**（`setWaterMode`/`getPresetId` 等签名不变），内部实现改读/写 envState + registerEnvCallback 落地渲染——菜单闭包不感知，装配链见下「已收敛」。

## 统一数据源（ADR-196 刀4–5）

- `state/model-defaults.ts`：`MODEL_DEFAULTS: Record<ModelType, Partial<EnvState>>` 收敛模型类别预设（default/ysm/vrm/mmd/mmd-scene/litematic/resourcepack），来源合并此前散落的 7 张表（MODEL_SKY_PRESETS / FOG_PRESETS / ENV_PRESET_BY_MODEL / LIGHT_PRESETS / REFLECTOR_PRESETS / POSTPROC_PRESETS / SHADOW_PRESET_BY_MODEL）。`skyForceEnv: true` 标记「模型切换是离散动作，应触发 PMREM 重建」。
- `state/atmosphere-presets.ts`：`ATMOSPHERE_PRESETS` 完整氛围快照（含 light 强度/色温 + postproc exposure/bloom 氛围语义），取代 ENV_PRESET_LINKAGE 硬编码联动。
- **预设套用收口态（刀3.5/刀5 + 装配链收尾）**：`SceneCapability.setPreset` 接口**已删除**（2026-09-07），各 cap 预设套用方法降级为非接口 public——sky/fog/shadow/reflector/light/environment 统一命名 `applyModelPreset(modelType)`，postprocessing 为 `applyPostProcDefaults(modelType)`。六个 cap 内部读 `MODEL_DEFAULTS` 只取自己关注的键并 `setEnvState(..., {source:'auto-model'})`（light 为 `{source:'manual'}` 双入口），侧效（isStateLoaded 守卫、shadow needsUpdate、light 锥组挂载/手动压制、reflector 重建、sky regenerateEnvironment 后置）仍留在 cap 内。
- **装配链已收敛（2026-09-07）**：adapters/shared-infra.ts 由 7 个散落 `cap.setPreset(adapter.id)` 改为两个命名入口——`applyModelDefaults(modelType, deps)`（预 apply 6 cap：sky→light→fog→shadow→reflector→environment）+ `applyPostProcDefaults(postProcCap, modelType)`（post-apply 1 cap，在 apply/syncShadowLights 之后、setReflectorCap 之前）。**刻意不做**「字面单一 `setEnvState(MODEL_DEFAULTS[adapter.id])`」：isStateLoaded 全量守卫、light 手动/自动双入口、postproc enabled 侧效无法被单次 setEnvState 等效替代，钝直合并会回归。装配序逐字复刻原行为。

## 与其他子系统关系

- caps/*-capability.ts：构造注册 callback 监听自己的 envState 键 → 分派 Three 应用（结构字段 rebuild 容器、参数字段就地改材质/uniform）。setter 不再直接改 Three（防双写双重建）。
- menu 层（ADR-195 刀2 直产节点）：控件闭包绑 cap setter/getter，刀3 换 StatePath 直绑 envState 键。
- 持久化：各 cap `saveState/loadState` 仍写 localStorage（旧键轨向后兼容），恢复时映射 setEnvState。envState 层自身持久化（env-state-persist.ts）为预留。
- 测试：各 cap 测试 `beforeEach(() => resetEnvState())` 隔离单例；`clearEnvCallbacks()` 清泄漏。

## 不变量

- 只经 `setEnvState` 写 envState，不直接改对象字段（否则不派发）。
- 能力级 enabled 不入 schema；运行时态（customHdrTex/currentPreset/manualPreset/volumetricEngine）留 cap 私有。
- 颜色字段统一 number(hex)；枚举字段 `type:"enum"` + `values`。
- 已迁移 cap（10/10，刀2 完成）：Sky/Fog/Reflector/Shadow/Ground/RenderMode/Water/Environment/Postprocessing/Light。
- MODEL_DEFAULTS 缺口（已知）：cap 参数全部入 envState，但 postprocessing 的 `applyPostProcDefaults` 仍读自家 `POSTPROC_PRESETS`（postprocessing-state.ts），未改读 MODEL_DEFAULTS——第 7 张表未删（刀5 遗漏，本次按专属数据源保留，风险封存不复现）。

## 相关

- ADR-196（预设三轴统一）、ADR-195（cap 控件单类型化）
- `docs/knowledge/scene_capability_registry.md`
