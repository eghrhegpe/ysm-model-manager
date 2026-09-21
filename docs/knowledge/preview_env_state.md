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
    - ATMOSPHERE_PRESETS
    - AtmospherePresetId
    - buildSharedInfra
    - clampFieldValue
    - clearEnvCallbacks
    - clearEnvStateMiddlewares
    - clearSceneCaps
    - deriveDefaultEnvState
    - dispatchEnvChange
    - ENV_STATE_SCHEMA
    - EnvCallback
    - envState
    - EnvState
    - EnvStateKey
    - EnvStateMiddleware
    - EnvStateSchema
    - getEnvCallbackCount
    - getParamRange
    - getPresetKeys
    - getSceneCaps
    - getStateValue
    - isEnvCallbacksSuspended
    - MODEL_DEFAULTS
    - ModelType
    - NumericRange
    - pickModelDefaultFields
    - RangedKey
    - registerEnvCallback
    - registerEnvStateMiddleware
    - resetEnvState
    - resetSceneInfra
    - resumeEnvCallbacks
    - sceneInfraHost
    - SceneInfraHost
    - setEnvState
    - setStateValue
    - SharedInfra
    - suspendEnvCallbacks
    - teardownSharedInfra
    - toModelType
    - WriteSource
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

- `env-state-schema.ts`：`ENV_STATE_SCHEMA` 声明全部参数字段 `{ type, default, group }`。键名 = `{cap}{Group}{Field}` 扁平化（`skyTimeOfDay`/`groundMatSource`/`waterMode`/`ppBloomStrength`/`lightKeyIntensity`/`lightSpotAngle`），颜色统一 `number`(hex)（勿用 tuple3——原仅 ground 风格 RGB 三键用 tuple3，该三死键 2026-09-21 锐评清理删除后 tuple3 全仓零使用者，类型与深拷贝分支保留为通用能力）。能力级 enabled（cap 是否挂载）**不入 schema**，留 cap 私有 `this.enabled`。`deriveDefaultEnvState()` 派生默认值，`EnvState` 类型由 schema 推导（枚举取 `V[number]`）。**（ADR-283：数值字段可再声明 `range`（合法域，写入钳制）/ `uiRange`（滑杆展示域，缺省=range）——值域的唯一事实源；读口 `getParamRange(key: RangedKey)`（未声明值域的键编译期传不进）与 `clampFieldValue`，菜单与 cap 都只是读口。）**
- `env-state.ts`：可变单例 `envState` + `setEnvState(partial, {source})` 中央写入入口 + `getStateValue/setStateValue(path)` StatePath 读写 + `resetEnvState()`（测试用）。写入带 `lastWriteSource`（`auto-model`/`auto-atmosphere`/`manual`），守卫决策 `manual > auto-atmosphere > auto-model`——手动调参不被预设覆盖。**写入中间件（ADR-254）签名 = `(patch, meta: { source })`**（锐评 P1 根治 2026-09-21）：中间件必须能按来源区分「用户手改」与程序化派发——「手改即脱离预设」类标记只许消费 manual，auto-* 携带同批字段天然免疫；显式豁免另有 `skipMiddleware` opts（存档恢复路径），两通道互补。
- `env-dispatcher.ts`：`registerEnvCallback(cap, cb)` 回调注册表 + `dispatchEnvChange(changed, state)` 派发（setEnvState 自动触发）。cap 构造时注册、dispose 退订。`clearEnvCallbacks()` 测试用。**`changed` 是 `Set<EnvStateKey>`（`keyof EnvState`，schema 派生，2026-09）**——`changed.has("拼错")` 编译不过；分组键事实源是 `getPresetKeys(group)`（注册时缓存 groupKeys 前置过滤；跨组用数组形式，ADR-250）。
  - **前置过滤是「先探测、后分配」（2026-09-20）**：原实现对每个带 group 的 cap 无条件 `new Set`，即便一个键都不匹配
    （昼夜循环每帧派发 sky 键 × 其余 cap 全不匹配 = 每帧白分配 N 个空 Set）。现先 `for…break` 探测命中，
    不命中即 `continue`（零分配零回调）；分配数**不随分组 cap 数增长**，不可约为「入参 changedKeys 那 1 个」。
    守卫：`env-state.test.ts` 的计数 `Set` 桩用例（含「与 N 无关」不变量）。
- **`suspendEnvCallbacks()` / `resumeEnvCallbacks()`（2026-09，ADR-281 收口）**：挂起计数器，`_suspended > 0` 时 `dispatchEnvChange` 直接早退，全部回调不收派发。用途 = **loadState 重入治理**：`LightCapability.loadState` 里 `restoreLightParams` 内部的 `setEnvState` 会**同步**触发 `onEnvChanged`（此时 Three 灯对象还是旧类型 → callback 先重建一次），回到 loadState 末尾的显式 `syncLight` 又跑一遍（**重入双跑**，旧注释自承为 ADR-281 已知遗留）。挂起后恢复路径只写 envState，末尾统一应用一次。语义细节：计数式（多次 suspend 需等量 resume）、resume 与 suspend 不配对也安全（`Math.max(0, ...)`）；`isEnvCallbacksSuspended()` 供测试断言。**新增 cap 的 loadState 若内部走 `setEnvState` 恢复，应比照 light 同样挂起**，否则回调会在 loadState 期间以「旧 Three 对象 + 新 envState」的不一致态被触发。
- **`envSource`（ADR-292 D5/D11）：`scene.environment` 的供图通路唯一权威**。三值互斥：`preset`（程序化 Canvas 预设）/ `sky`（向 SkyCapability 取烘焙图）/ `custom`（用户 HDR 文件）。**与 `envPreset` 正交**——`envSource` 选「走哪条通路」，`envPreset` 只选「预设通路用哪张图」。故 `EnvironmentCapability.setSource()` **只写 `envSource` 一个键**；早期草案让它同写 `envPreset:"custom"`，与回退逻辑写 `envPreset:"studio"` 打架，产生「来源显示 custom、实际渲染 studio」的分裂态。旧存档迁移在 `caps/environment-migrations.ts`（纯函数，零 THREE/DOM 依赖），三判据：① env 总开关关而 sky IBL 开 → `"sky"`（唯一强意图信号，否则画面丢失）；② `preset==="custom"` → `"custom"`；③ 其余 → `"preset"`。**`envSource` 缺省即 `"preset"`，是 schema 默认值，不是「未迁移」的伪默认。**
- **`skyForceEnv` 是活键，不是死字段（ADR-292 D8 更正）**：它承载**天空内部的**阈值门控意图——`false` 时按 `PMREM_ELEVATION_THRESHOLD` 判断是否需要重烤（防昼夜循环每帧全量 PMREM 的 GPU 熔炉），`true` 时无条件重烤。收口后它**不再承担跨 cap 契约**：重建请求改由 env 侧直接调用 `bakeEnvironmentTexture({ force })` 表达。**D10 路由器判据（锐评补全 2026-09-21）**：`requestEnvironmentRefresh()` 以「**env cap 在场且启用**」定让权——env 在场一律转交（`refreshFromSkySource(force)` 自判：sky 源才重新取图装载，非 sky 源天空事件不驱动预设通路重建），env 缺席/关闭才走 sky 自持兜底（此时仍受 `skyEnvironment` 旧开关门控）。旧判据「env 未 sky 源接管 = sky 自持」在默认 `envSource="preset"` 下让 sky 顶掉 env 装载，「写者唯一」形同虚设——此为教训。sky 交回的是 **PMREM 预滤波 cubeUV 产物**，env 直装槽位、**严禁再入 `fromEquirectangular`**（二次滤波静默错乱光照）；昼夜循环 force=false 时 sky 未 dirty 交回**同一纹理引用**，env 侧同引用短路整轮免重建。
- **挂起器的两个口径约束（2026-09 复审补；2026-09-21 锐评 D7 回写调用点清单）**：① 粒度是**全局**的（挂起期所有 cap 都停派发，不是「只挡 light」）——调用点现有 light / ground / fog / environment 四处 loadState，各自在自身同步块内闭合、`registry.loadAll` 顺序串行故无重叠窗，但**它不是跨 cap 事务边界**，禁止用于「先改 A 再改 B、中间别派发」；② `clearEnvCallbacks()` **同时复位 `_suspended`**——clear 是「全清」语义，兼作测试隔离兜底；否则任一 suspend 逃逸（抛出/提前 return）会让计数跨测试存活，导致后续全仓 envState 派发**静默假死**（envState 有值、Three 不更新、无任何报错）。守卫：`env-dispatcher.test.ts` 的「clearEnvCallbacks 一并复位挂起计数」用例。

## 对外 API / 入口

- `setEnvState(partial, { source })`：唯一写入口。cap setter 收口为它（`source:'manual'`）；模型类别预设用 `source:'auto-model'`；氛围预设（刀4 ATMOSPHERE_PRESETS）用 `auto-atmosphere`。**（ADR-283：写入口顺带取值域钳制 `clampFieldValue`——schema 声明了 `range` 的数值字段在此就范，setter / 存档 / 预设 / 中间件产物四条路径一次性覆盖。）**
- cap 公开 setter/getter **保留**（`setWaterMode`/`getPresetId` 等签名不变），内部实现改读/写 envState + registerEnvCallback 落地渲染——菜单闭包不感知，装配链见下「已收敛」。

## 统一数据源（ADR-196 刀4–5）

- `state/model-defaults.ts`：`MODEL_DEFAULTS: Record<ModelType, Partial<EnvState>>` 收敛模型类别预设（default/ysm/vrm/mmd/mmd-scene/litematic/resourcepack），**已合并**此前散落的 7 张表（MODEL_SKY_PRESETS / FOG_PRESETS / ENV_PRESET_BY_MODEL / LIGHT_PRESETS / REFLECTOR_PRESETS / POSTPROC_PRESETS / SHADOW_PRESET_BY_MODEL）——前 6 张物理删除，POSTPROC_PRESETS 残留为 cap 专属数据源（known gap，见下）。**[ADR-282] light 已退出本表；[ADR-284] sky 大气散射段 + reflector 噪声键（opacity/color）+ `shadowType:"hard"` no-op 已退出——本表现只承载「场景尺度」（fog near/far/density、reflectorSize/Resolution）与「离散语义」（envPreset、shadowType:soft、ppEnabled）两类合法耦合；`skyForceEnv` 不在本表（系 sky cap 硬置的 IBL 重建脉冲，非类别值，**是活键**——见「核心职责」的 ADR-292 D8 更正）。**
- `state/atmosphere-presets.ts`：`ATMOSPHERE_PRESETS` 完整氛围快照（含 light 强度/色温 + postproc exposure/bloom 氛围语义），取代 ENV_PRESET_LINKAGE 硬编码联动。
- **预设套用收口态（刀3.5/刀5 + 装配链收尾）**：`SceneCapability.setPreset` 接口**已删除**（2026-09-07），各 cap 预设套用方法降级为非接口 public——sky/fog/shadow/reflector/environment 统一命名 `applyModelPreset(modelType)`，postprocessing 为 `applyPostProcDefaults(modelType)`。这些 cap 内部读 `MODEL_DEFAULTS` 只取自己关注的键并 `setEnvState(..., {source:'auto-model'})`，侧效（isStateLoaded 守卫、shadow needsUpdate、reflector 重建、sky regenerateEnvironment 后置）仍留在 cap 内。**（[ADR-282] 原列表中的 light 已退役；[ADR-284] sky 现仅硬置 skyForceEnv 重建脉冲不再读表取大气参数，reflector 仅取 size/resolution。）**
- **装配链已收敛（2026-09-07；[ADR-282] 2026-09-20 缩为 5 cap）**：adapters/shared-infra.ts 由 7 个散落 `cap.setPreset(adapter.id)` 改为两个命名入口——`applyModelDefaults(modelType, deps)`（预 apply **5** cap：sky→fog→shadow→reflector→environment）+ `applyPostProcDefaults(postProcCap, modelType)`（post-apply 1 cap，在 apply/syncShadowLights 之后、setReflectorCap 之前）。**刻意不做**「字面单一 `setEnvState(MODEL_DEFAULTS[adapter.id])`」：isStateLoaded 全量守卫、postproc enabled 侧效无法被单次 setEnvState 等效替代，钝直合并会回归。装配序逐字复刻原行为。light 已退出本链（见 ADR-282）。

## 与其他子系统关系

- caps/*-capability.ts：构造注册 callback 监听自己的 envState 键 → 分派 Three 应用（**仅 mode 类结构切换 rebuild 容器**；可就地表达的结构参数走形态 links——ADR-272：water 的 size / 池深 / 壁厚均零重建；参数字段就地改材质/uniform）。setter 不再直接改 Three（防双写双重建）。
- menu 层（ADR-195 刀2 直产节点）：控件闭包绑 cap setter/getter。**ADR-196 刀3 字面 StatePath 化已决策不采纳**（2026-09-07）——cap setter 已直通 envState（见「对外 API」），菜单控件闭包即状态驱动；`getStateValue/setStateValue` 保留为可选实现细节，非菜单绑定要求。
- 测试：各 cap 测试 `beforeEach(() => resetEnvState())` 隔离单例；`clearEnvCallbacks()` 清泄漏。

## 持久化设计（2026-09-07 翻明）

一句话：**状态运行时唯一真值在 `envState` 单例；落盘时各 cap 从 envState 摘自己关心的键写 localStorage；启动时逐 cap 恢复回 envState。envState 层自身不做第二层持久化。**

核心机制（`caps/scene-capability.ts` 的 `persistState/restoreState/restoreFields` 三件套）：
- **键轨**：`localStorage["ysm-scene-cap-" + capId]`，JSON 序列化（如 `ysm-scene-cap-fog`）。
- **saveState**（写）：`persistState(capId, { this.enabled(能力级私有) + envState 参数字段 })` —— 从 envState **摘键**，不存全量。
  （2026-09：摘键可**派生化**——water 已改为逆历 `getPresetKeys("water")`，新增参数只需进 schema；历史键名由 loadState 双轨吸收）
  （fog 例外：其私有 `enabled` 已随 2026-09 锐评收口删除，只写 envState 键。）
- **loadState**（读）：`restoreState` → **旧键迁移**（ADR-196 前无前缀旧键 `{mode,color,...}` 转新键，保升级用户配置，如 fog 的 legacyKeys 分支）→ `restoreFields`（类型安全批量恢复器，按存档值实际类型分派回填）→ `setEnvState(..., {source:"manual"})` 写回 envState → cap apply 落地 Three。**（ADR-283：恢复路径同样经唯一入口的值域钳制——存档里的越界值不会漏进 envState。）**
- **触发时机**：进入 3D → `sceneCapabilityRegistry.loadAll()`（shared-infra.ts:239）；离开 3D → `sceneCapabilityRegistry.saveAll()`（mount-session.ts:267）。

**与预设的共存（守卫链）**：装配序 `loadAll()`（恢复用户存档 source:"manual" **且** shadow/reflector 置 `isStateLoaded=true`）→ `applyModelDefaults`（读 MODEL_DEFAULTS source:"auto-model"）。`shouldOverwrite` 裁决 `manual > auto-atmosphere > auto-model` → 用户手动值（含恢复的存档）不被预设覆盖；shadow/reflector 额外用 `isStateLoaded` 早退连套用都不执行。双重机制保「上次调的雾/灯切模型不被重置」。

**envState 层为何不做全量持久化（刀0 空壳已删）**：
1. **键轨冲突**——envState 全量快照 vs 各 cap 的 `ysm-scene-cap-*` 双套并存会双写双恢复（同参数存两份，启动恢复两遍，行为取决顺序易回归）。
2. **恢复语义丢失**——envState 全量恢复经 `setEnvState` 只能写参数，写不了能力级 `this.enabled`（shadow/reflector `isStateLoaded` 置位均 cap 独占；fog 私有 enabled 已于 2026-09 删除，其开关即 schema 字段 `fogEnabled`）。
3. **迁移逻辑在 cap**——fog 的 legacy 旧键迁移按 cap 语义写，envState 层代劳不了。

职责边界：**cap 管「摘哪些键、怎么恢复、带什么守卫」；envState 管「运行时唯一真值 + 写入来源仲裁」**。

## 不变量

- 只经 `setEnvState` 写 envState，不直接改对象字段（否则不派发）。
- 能力级 enabled 不入 schema；运行时态（customHdrTex/currentPreset/manualPreset）留 cap 私有。
  （原 `volumetricEngine` 运行时态已随 ADR-246 D1 删除——postprocess 空壳引擎移除。）
- **[2026-09 雾气锐评收口] `FogCapability` =「能力级开关并入 schema」首例**：cap 私有 `enabled`（构造 `opts.enabled ?? true`）已删——registry `ctx` 无该字段，使其生产链路**恒 true**，造成 master toggle 显示 ON 而 `scene.fog` 恒 null 的脱节；现 `isEnabled()/setEnabled()` 唯一真值源 = `envState.fogEnabled`（单一 gate）。同批收口：① 模式不变时**原地改雾对象字段**（不再每次 `new`，仅切模式重建）；② 新增 `subscribe`（仅 `fogMode` 离散切换 notify，驱动 `menu.refresh` 刷新条件显隐，对齐 water）；③ 状态层新增 `env.fogMode` 路径（`KNOWN_PATHS` + binding），供 fog 控件 `near/far`（linear 专属）× `density`（exp2 专属）经 `visibleWhen` 互斥显隐。
- **[ADR-246] 灯光/体积光简化已落地（2026-09-16，主提交 `66f7b5d6f`）**：
  - **D1 删空壳引擎**：`set/getVolumetricEngine`、`lightVolumetricEngine` schema 字段、菜单「锥引擎」下拉、`saveState` 写入、`loadState` 引擎恢复步、`needComposer` 的 volumetric 分支全部摘除；老存档残留 `volumetricEngine` 成惰性数据（read 时忽略，有测试锁）。
  - **D2 参数收编**：`VolumetricParams` 内部 5 字段不动（shader 契约 + 预设表兼容），菜单层收编为「浓度 `opacity` / 衰减 `fogPower` / 边缘羽化 `edgeFade`」三语义滑块 + 单一「上下亮度比」（`tipStrength = baseStrength × ratio`，getter 除零守卫 + `clamp[0,1]`、setter 对称 clamp）。
  - **D3 可视化**：每盏灯按 type 配 helper（Directional/Spot/Point 各对应），随开关显隐 + 聚光灯/体积光合并进同一 `collapsible` 卡（**不做 visibleWhen 隐藏**）。
  - 验证：`light-capability` + `postprocessing-capability`(86) + `fog-capability`(33) 测试绿。
- **[light-type-switch] 三灯统一实例（2026-09）**：三盏灯（key/fill/rim）各可在 `directional`/`point`/`spot` 间切换，参数结构统一为 `LightInstanceParams`（type/enabled/color/intensity/azimuth/elevation/angle/penumbra/distance/decay）。
  - **破坏性重构**：原「三盏方向灯 + 一盏独立聚光灯」四灯二体系废除；`lightSpot*` schema 字段、`setSpotlight`、`getDirectionalLights`/`getSpotLight` 全部删除。
  - **切换语义**：类型变化 → dispose 旧 Three 对象 + 旧 helper → 按新 type 重建（MikuMikuAR 同款）；参数变化 → 原地更新。
  - **体积光锥**：不再绑定第四盏灯。~~由「当前编辑的灯（activeLight）优先，否则槽位顺序第一盏启用 spot」驱动~~ → **[ADR-290] 驱动源 schema 化**：`lightVolumetricDriver: enum["auto","key","fill","rim"]`（默认 auto），`getSpotLightForCone` 只读该键与 activeLight 无关；auto = 槽位顺序（key→fill→rim）第一盏启用 spot，显式槽位 = 严格绑定（该槽位非启用 spot 则无锥，**不回落**）。activeLight 回归纯 UI 焦点态（`setActiveLight` 不再收敛锥体，原内联 rebuild 补丁退役）；driver 入存档（持久化 `volumetric.driver`，oneOf 白名单从 schema values 派生），旧存档缺键落 auto = 旧槽位顺序行为。菜单：体积光卡内 `light-volumetric-driver` select。
  - **[锐评根治 2026-10] point 灯与 spot 同吃 candela 补偿（预览/截图双镜像点同式）**：UI intensity 语义统一为「到达模型中心处照度」，`applyLightParams` 位置光（SpotLight|PointLight）分支合并反推 `intensity/falloff(d, distance, decay)`。原 point 走裸强度，同参数 spot↔point 切换靶点照度瞬变 targetHeight^decay 倍（默认 ≈23 倍）——「强度」滑块跨 type 物理语义分裂已除。directional 无衰减不受影响；`spotDistanceAttenuation` 三处消费者（预览/截图/镜像守卫测试）不变。
  - **菜单**：顶栏 `light-select`（三灯按钮）选择编辑对象 → 同一套设置条读写该灯；类型专属参数（angle/penumbra/distance/decay）按 type 条件展开。
  - **旧存档迁移**：`restoreLightParams` 检测旧 `spotlight` 块 → 迁移为 key 灯 `type='spot'` + 对应参数。
- **[ADR-281] 灯光字段全集单一真相源（2026-09-20）**：三盏灯的 10 字段集曾散在 5 处（`FLATTEN_MAP` / 变更集 / 预设挑参 / 持久化表 / `readLightParams`），只有第一处有 `satisfies` 锁——新增字段漏改四处中的任何一处都是**静默 bug**（滑块无反应 / 切模型不更新 / 运行时 NaN）。
  - **收口**：`light-presets.ts` 的 `FLATTEN_MAP` 升格为唯一真相源，派生出 `LIGHT_SLOTS` / `lightEnvKeys`（变更集）/ `readLightParams`（读参数）。
  - **去双层 `as`**：`readLightParams` 字段名取自映射（键拼写有锁）+ 返回类型 `LightInstanceParams` 反向校验（值类型 / 穷尽性有锁），旧实现 `${prefix}${X}` 拼串 + 两层 `as` 退场。
  - **持久化表**（`light-persist.ts`）：存档短名（跨版本稳定契约）仍由 `LIGHT_FIELD_TYPES` 的 `satisfies Record<keyof LightInstanceParams, …>` 锁死同一字段全集；**envState 键不再拼串**（[锐评根治 2026-10]：原「后缀列 + `cap(which)` 拼接」与 FLATTEN_MAP 对齐纯靠命名巧合，schema 键重命名时编译侧红、此侧静默丢字段——`pickLightFields` 现直查 `FLATTEN_MAP[which][field]`，ambient/volumetric 恢复 lambda 同口径）。
  - **`export *` 转发桶已删**：`light-capability.ts` 不再重导出 `light-presets.ts`，消费方直引具体叶（同一符号不再两处入口）。
  - **[ADR-283] light 组值域迁入 schema（2026-09-20）**：统一设置条 7 个滑杆（intensity/azimuth/elevation/angle/penumbra/distance/decay）不再写 min/max/step 字面量，改由 `getParamRange(FLATTEN_MAP[which][field])` 取 schema `range`——`which` 是动态槽位（同一控件对应 key/fill/rim 三键之一），三键均已声明 range，漏声明即编译报错（`RangedKey` 约束兜底）。`FLATTEN_MAP` 随之从模块私有升格为导出。
  - **首次引入写入钳制**：light 组原全无钳制，现由 `setEnvState` 唯一写入口按 schema range 钳制（脏存档 / 程序化写入的越界值会被改写到上下界）。
  - **例外（有意保留字面量）**：`light-volumetric-ratio`（「上下亮度比」）的值是派生标量 `tip = base × ratio`，不落在任何 envState 键上 → 不迁 schema；其 [0,1] 域由 `setVolumetricTipRatio` 自身的 clamp 保证。
  - **守卫用例**：`light-capability.test.ts` 逐一断言 21 个槽位滑杆 + 体积光 3 + 环境光 1 的菜单值域 === schema 值域，并钉死比值滑块的字面量例外。
  - **[锐评根治 2026-10] 控件树派生闸（替代手写键清单）**：同文件「控件树写面 ≡ light 组 schema 字段集」用例——运行时逐 leaf 控件 set 探针值 → diff envState 收集被写字段 → 与 `ENV_STATE_SCHEMA` light 组字段集**双向**断言（缺入口即红 / 越界写即红；`lightVolumetricBaseStrength` 唯一豁免：经上下亮度比派生写入）。此前 `light-presets.test.ts` 的 range 守卫手抄 21 键清单，本身即平行手抄，保留但新字段接线以派生闸为准。同期补 `light-ambient-color` 控件（原 `lightAmbientColor` schema/FLATTEN_MAP/持久化全链路注册、唯控件面无入口 = 幽灵字段）；能力总开关 id 升格为 `LIGHT_MASTER_NODE_ID` 常量（light-controls 产出 / getMasterNodeId 声明 / 面板 filter 消费三方同源）。
- **[ADR-283] 值域迁移进度与首次生效边界（2026-09-20）**：已迁组 = water（首组）→ fog → environment → ground → light → postprocessing → shadow → sky → reflector——**schema 有滑杆的组已全数迁完**（renderMode 组本就无滑杆，无须迁）。每组配「菜单值域 === schema 值域」守卫用例。
  - **首次引入钳制的组**（原先全无钳制，按用户裁定「滑杆域即合法域」）：fog `fogDensity` [0.001,0.1] / `fogNear` [0,500] / `fogFar` [10,2000]；shadow `shadowBias` [-0.01,0.001] / `shadowNormalBias` [0,0.1]（`shadowCameraSize` [5,80] 原已有钳制，仅从 setter 移到写入口）；light 全组（见上，含 `lightKeyDecay` [0,4]、`lightKeyAngle` [10,70] 等滑杆域）；postprocessing `ppExposure` [0.1,3]、`ppBloomStrength` [0,3] / `ppBloomThreshold` [0,1] / `ppBloomRadius` [0,2]、`ppSsaoRadius` [0.5,32] / `ppSsaoMinDist` [0.001,0.05] / `ppSsaoMaxDist` [0.01,1]、`ppSsrOpacity` [0,1] / `ppSsrMaxDistance` [10,800] / `ppSsrThickness` [0.001,0.1]；reflector `reflectorResolution` [256,2048] / `reflectorSize` [20,500]（`reflectorOpacity` [0,1] 原已有钳制）；sky `skyCloudCoverage` [0,1]（原有钳制，`unit:"%"` 随值域入 schema）——**越界值会被改写到边界**：postprocessing 夹具 8 / 0.2、shadow 夹具 bias 0.1 / 0.002、light 夹具 decay 5.4/6.5/7.6 与 angle 73 均已被此钳制改写，已改到域内且保持互异（值梯是用例检测「读错键串位」的基础）。
  - **教训（迁移成对检查）**：值域收口后，夹具越界的兄弟测试文件（如 `light-presets.test.ts` 往返用例）不会因只跑「被改动的 cap 测试」而暴露——每组迁完须跑**整个 `src/preview-3d` 域**，不只跑本文件的测试。
  - **域分离的活证**：environment `envIntensity`（合法 [0,5] / 滑杆 [0,3]）；sky `skySunIntensityScale`（合法 [0,1.5] / 滑杆 [0.3,1.2]）与 `skySunDiscScale`（合法 [0,1.5] / 滑杆 [0,1.2]）——后两者原 setter 钳 [0,1.5]、滑杆更窄，且两处 doc 注释写的「0.5~1.0 / 0.2~1.0」是过期旧域，已随迁移订正；ground `groundMatGridSize`（原钳制只有下界 2，迁移时以滑杆上界 32 补齐合法域）。
  - **菜单工厂收口**：`reflector-menu.ts` 的 `slider()` 工厂改吃 `key: RangedKey`（位置参数 min/max/step 退场，工厂内 `...getParamRange(key)`）；light 统一设置条经 `FLATTEN_MAP` 派生值域键（动态槽位）。两者都把「值域从哪来」固定在声明层，菜单代码不再出现任何范围字面量。
  - **保留字面量的例外**：light 「上下亮度比」（派生标量 tip = base × ratio，不落在任何键上）。
- **[ADR-282] 灯光与模型类别解耦（2026-09-20）**：三盏灯的类别默认值（原 `LIGHT_PRESETS`，源自 ADR-084 §2.5）已从 `MODEL_DEFAULTS` **全部删除**。
  - **依据**：Three.js 层面「模型类别」不存在——灯光是**场景属性**，唯一合法的模型相关输入是**包围盒**（驱动 `targetHeight`/靶点），已由 `setTarget`/`setTargetHeight` **动态**处理（换模型实时重算），无需预设代劳。ADR-084 原表 vrm 与 mmd 逐字相同，唯一实质区分轴 `spotlight` 已随 ADR-280 删除 → 预设只剩三个光强数字。
  - **退役**：`LightCapability.applyModelPreset` / `manualPreset` / `currentPreset` / `getCurrentPreset` 全部删除；`shared-infra.applyModelDefaults` 预 apply cap **6 → 5**（light 退出本链）；`LIGHT_ENV_KEYS` / `VOLUMETRIC_ENV_KEYS` 随之成为孤儿，一并删除。
  - **取代**：`resetLightParams()` —— 把三盏灯 + 环境光 + 体积光写回模型无关的 `DEFAULT_LIGHT_PARAMS`（与 envState schema 初始值同源），`source:"manual"`。UI 入口 = 灯光参数组底的「重置灯光」按钮（原预设下拉已删）。
  - **反向陷阱（已修）**：原 `default` 预设的 light 段只剩 `lightVolumetricEnabled:false`（与 schema 默认同值 = 纯 no-op），但选中它会设 `manualPreset` → **永久冻结**后续模型预设（跨会话、无 UI 可解）。即「改了等于没改，却把开关焊死」。
  - **双重手动优先收敛**：旧有 `manualPreset`（粗粒度整体早退）与 `shouldOverwrite` 按 key 记 `manual`（细粒度）两套；现只剩后者独当——用户拖过的键在后续 `auto-model` 写入时自动豁免。
  - **防回退闸**：`state/model-defaults.test.ts` 断言 `MODEL_DEFAULTS` 任何类别都不得含 `light` 前缀键——防止将来「顺手」加一行 `lightKeyIntensity` 悄悄复活漂移源。
- **[ADR-284] sky 大气散射与模型类别解耦 + reflector/shadow 清噪声（2026-09-20）**：承 ADR-282 的手术刀向其余类别推广——把灯光病灶拆成 **A 噪声 / B no-op / C 单向陷阱** 三标准逐类审计。
  - **澄清**：C（`source:manual` 夺所有权永久冻结）是灯光孤例——其余 cap 走 `source:'auto-model'` + `isStateLoaded` 守卫，结构上无 C。普适病灶只有 A/B。
  - **sky 解耦**：`MODEL_DEFAULTS` 摘除全部 sky 散射段（turbidity/rayleigh/mie/mieDir/exposure/sunIntensityScale/sunDiscScale）——大气属天空盒，与「模型是 VRM 还是 MMD」无关（同灯光 1.3 论证）。`skyForceEnv` 不在挑参表内（它不参与模型类别选择）；**注意它不是死字段**——真实读点在 sky callback 的 `maybeRegenerateEnvironment` 阈值门控与云量重建分支（详见「核心职责」ADR-292 D8）。重建脉冲真实来源在 cap 内，摘表不扰动 IBL 重建。
  - **reflector**：删 opacity/color（纯噪声 A）+ 撞默认 1024 的 resolution（B）；保留 size（场景尺度）与降精度 512。
  - **shadow**：删 `shadowType:"hard"`（== schema 默认，B）；保留 soft（PBR 角色语义）。
  - **保留辩护**：fog（near/far/density 随场景体量）、envPreset（离散场景选择 studio/forest/sky）——逐类差异是量纲/语义非噪声，理由记入 ADR-284，消除「看着差不多」怀疑空间。
  - **防回退闸**：`model-defaults.test.ts` 断言任何类别不得含 `sky` 前缀键 / `reflectorOpacity` / `reflectorColor`；`shadowType` 若存在只能为 `soft`。
- **[ADR-246] 未落地项——「雾中体积光」**：真正的 raymarching 体积光（`VolumetricLightingPass`，ADR-084 §L3）**仍未实现**；ADR-246 已裁定若要做须以**新增 pass** 方式引入，不得复活「切换渲染器」开关。注意与两条已落地能力区分：`FogCapability`（`scene.fog` 线性/指数雾，非体积光）、ADR-107 天空体积光束 god rays（非雾中散射）。
- 颜色字段统一 number(hex)；枚举字段 `type:"enum"` + `values`。
- 已迁移 cap（10/10，刀2 完成）：Sky/Fog/Reflector/Shadow/Ground/RenderMode/Water/Environment/Postprocessing/Light。
- **[ADR-250] 后处理启用意图已入 schema（`ppEnabled`）**：原 `perTypeGate`（模型类别门禁）与 `perfMaster`（性能总闸）两枚 cap 私有字段、`syncEffectiveEnabled()` 二元相与、`POSTPROC_PRESETS` 表**全部退役**。「默认是否开后处理」由 `MODEL_DEFAULTS` 的 `ppEnabled` 参数表达（与六 cap 同构，经 `auto-model` 源写入，用户 `manual` 可覆盖）。cap 内 `enabled` 现为**读 envState 的 getter**，不再是被四路写入的独立字段。
- **[ADR-250] `renderer.toneMappingExposure` 属主归 sky，唯一写入口 = `SkyCapability.applyExposure`**（有效曝光 = `skyExposure × ppExposure`）。`PostprocessingCapability` **任何情况下都不写该字段**——原双写造成约 1.8× 亮度跳变（后处理一开即从 `skyExposure` 0.55 跳到 `ppExposure` 1.0），这是「MMD 亮瞎 / YSM 恰好正常」的真因。并发持有无解，只能定单一属主。
- **[ADR-250] 输出设置归还须按「字段各自的归属」判定（2026-09 补齐）**：`PostprocessingCapability.restoreOutputSettings()` 里 `toneMapping` 一向是「renderer 上仍等于本 cap 写入值才归还」，而 `outputColorSpace` 原为**无条件**赋值——若他处（适配器自建流程／其它 cap）已改色彩空间，本 cap 停用会把别人的值盲打回构造期快照（与 toneMapping 范式不对称，属漏判）。现二者对称：`outputColorSpace === THREE.SRGBColorSpace`（本 cap 在 `applyToneMapping` 写的常量）才归还。另有一层前置：`sky` 活跃时整段让位（`skyOwns` 早退），因 sky 才是 renderer 输出设置的持续写入者，本 cap 的构造期快照可能陈旧。
- **[ADR-250] composer 生命周期在会话轴，不在模型/开关轴**：构造即建、`dispose()` 才拆；启用意图翻转只切 pass 旁路（`buildComposer(syncReflector=false)` 于构造期不压制 reflector），不 allocate/dispose。原「换模型 → 门禁翻转 → 整组 GPU 资源重建」是配置缓存失效的结构性来源。
- MODEL_DEFAULTS 缺口**已收敛（ADR-250）**：原「postprocessing 的 `applyPostProcDefaults` 仍读自家 `POSTPROC_PRESETS`，未改读 MODEL_DEFAULTS——第 7 张表未删」这一 known gap 随该表删除而消失。后处理「启用意图」经查证实为**用户可见效果偏好**（非能力级挂载），故以 `ppEnabled` 正式入 schema；其余 cap 的 `this.enabled`（能力是否挂载）红线不变。

## 相关

- ADR-196（预设三轴统一）、ADR-195（cap 控件单类型化）、**ADR-250（后处理门禁降参 / composer 常驻 / 曝光属主归 sky）**
- `docs/knowledge/scene_capability_registry.md`
