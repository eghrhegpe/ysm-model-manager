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
  - frontend/src/preview-3d/caps/scene-capability-persist.test.ts
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
    - isSsrRenderActive
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

- `env-state-schema.ts`：`ENV_STATE_SCHEMA` 声明全部参数字段 `{ type, default, group }`。键名 = `{cap}{Group}{Field}` 扁平化（`skyTimeOfDay`/`groundMatSource`/`waterMode`/`ppBloomStrength`/`lightKeyIntensity`/`lightSpotAngle`），颜色统一 `number`(hex)（勿用 tuple3——原仅 ground 风格 RGB 三键用 tuple3，该三死键 2026-09-21 锐评清理删除后 tuple3 全仓零使用者，类型与深拷贝分支保留为通用能力）。能力级 enabled（cap 是否挂载）原则不入 schema、留 cap 私有 `this.enabled`——例外见「不变量」条（fog/water 单门收口）。`deriveDefaultEnvState()` 派生默认值，`EnvState` 类型由 schema 推导（枚举取 `V[number]`）。**（ADR-283：数值字段可再声明 `range`（合法域，写入钳制）/ `uiRange`（滑杆展示域，缺省=range）——值域的唯一事实源；读口 `getParamRange(key: RangedKey)`（未声明值域的键编译期传不进）与 `clampFieldValue`，菜单与 cap 都只是读口。）**
- `env-state.ts`：可变单例 `envState` + `setEnvState(partial, {source})` 中央写入入口 + `getStateValue/setStateValue(path)` StatePath 读写 + `resetEnvState()`（测试用）。写入带 `lastWriteSource`（`auto-model`/`auto-atmosphere`/`manual`），守卫决策 `manual > auto-atmosphere > auto-model`——手动调参不被预设覆盖。**写入中间件（ADR-254）签名 = `(patch, meta: { source })`**（锐评 P1 根治 2026-09-21）：中间件必须能按来源区分「用户手改」与程序化派发——「手改即脱离预设」类标记只许消费 manual，auto-* 携带同批字段天然免疫；显式豁免另有 `skipMiddleware` opts（存档恢复路径），两通道互补。**`isSsrRenderActive()`（锐评 F-1，2026-09-23）= `ppEnabled ∧ ppReflectionMode ≠ envmap-only`——「SSRPass 此刻真在渲染」的唯一判别式纯函数**，两处消费：pp `applyReflectorSync`（压地面单平面镜）与 water `reflectionActive`（跳水面模型倒影）。此前两处各手抄一份、pp 侧还随 R-1 血案（关 pp 仍白压镜子）演化过一次——手抄判别式即分账隐患。改 SSR 语义只动此函数，勿再抄第三份。守卫：`env-state.test.ts`「isSsrRenderActive 单源」用例。
- `env-dispatcher.ts`：`registerEnvCallback(cap, cb)` 回调注册表 + `dispatchEnvChange(changed, state)` 派发（setEnvState 自动触发）。cap 构造时注册、dispose 退订。`clearEnvCallbacks()` 测试用。**`changed` 是 `Set<EnvStateKey>`（`keyof EnvState`，schema 派生，2026-09）**——`changed.has("拼错")` 编译不过；分组键事实源是 `getPresetKeys(group)`（注册时缓存 groupKeys 前置过滤；跨组用数组形式，ADR-250）。
  - **前置过滤是「先探测、后分配」（2026-09-20）**：原实现对每个带 group 的 cap 无条件 `new Set`，即便一个键都不匹配
    （昼夜循环每帧派发 sky 键 × 其余 cap 全不匹配 = 每帧白分配 N 个空 Set）。现先 `for…break` 探测命中，
    不命中即 `continue`（零分配零回调）；分配数**不随分组 cap 数增长**，不可约为「入参 changedKeys 那 1 个」。
    守卫：`env-state.test.ts` 的计数 `Set` 桩用例（含「与 N 无关」不变量）。
- **`suspendEnvCallbacks()` / `resumeEnvCallbacks()`（2026-09，ADR-281 收口）**：挂起计数器，`_suspended > 0` 时 `dispatchEnvChange` 直接早退，全部回调不收派发。用途 = **loadState 重入治理**：`LightCapability.loadState` 里 `restoreLightParams` 内部的 `setEnvState` 会**同步**触发 `onEnvChanged`（此时 Three 灯对象还是旧类型 → callback 先重建一次），回到 loadState 末尾的显式 `syncLight` 又跑一遍（**重入双跑**，旧注释自承为 ADR-281 已知遗留）。挂起后恢复路径只写 envState，末尾统一应用一次。语义细节：计数式（多次 suspend 需等量 resume）、resume 与 suspend 不配对也安全（`Math.max(0, ...)`）；`isEnvCallbacksSuspended()` 供测试断言。**新增 cap 的 loadState 若内部走 `setEnvState` 恢复，应比照 light 同样挂起**，否则回调会在 loadState 期间以「旧 Three 对象 + 新 envState」的不一致态被触发。
- **`envSource`（ADR-292 D5/D11）：`scene.environment` 的供图通路唯一权威**。三值互斥：`preset`（程序化 Canvas 预设）/ `sky`（向 SkyCapability 取烘焙图）/ `custom`（用户 HDR 文件）。**与 `envPreset` 正交**——`envSource` 选「走哪条通路」，`envPreset` 只选「预设通路用哪张图」。故 `EnvironmentCapability.setSource()` **只写 `envSource` 一个键**；早期草案让它同写 `envPreset:"custom"`，与回退逻辑写 `envPreset:"studio"` 打架，产生「来源显示 custom、实际渲染 studio」的分裂态。旧存档迁移在 `caps/environment-migrations.ts`（纯函数，零 THREE/DOM 依赖），三判据：① env 总开关关而 sky IBL 开 → `"sky"`（唯一强意图信号，否则画面丢失）；② `preset==="custom"` → `"custom"`；③ 其余 → `"preset"`。**`envSource` 缺省即 `"preset"`，是 schema 默认值，不是「未迁移」的伪默认。**
- **`skyForceEnv` 是活键，不是死字段（ADR-292 D8 更正）**：它承载**天空内部的**阈值门控意图——`false` 时按 `PMREM_ELEVATION_THRESHOLD` 判断是否需要重烤（防昼夜循环每帧全量 PMREM 的 GPU 熔炉），`true` 时无条件重烤。收口后它**不再承担跨 cap 契约**：重建请求改由 env 侧直接调用 `bakeEnvironmentTexture({ force })` 表达。**D10 路由器判据（锐评补全 2026-09-21）**：`requestEnvironmentRefresh()` 以「**env cap 在场且启用**」定让权——env 在场一律转交（`refreshFromSkySource(force)` 自判：sky 源才重新取图装载，非 sky 源天空事件不驱动预设通路重建），env 缺席/关闭才走 sky 自持兜底（此时仍受 `skyEnvironment` 旧开关门控）。旧判据「env 未 sky 源接管 = sky 自持」在默认 `envSource="preset"` 下让 sky 顶掉 env 装载，「写者唯一」形同虚设——此为教训。sky 交回的是 **PMREM 预滤波 cubeUV 产物**，env 直装槽位、**严禁再入 `fromEquirectangular`**（二次滤波静默错乱光照）；昼夜循环 force=false 时 sky 未 dirty 交回**同一纹理引用**，env 侧同引用短路整轮免重建。**直装同值的两处连带守卫（复审 A 收口）**：槽位值恰等于 sky `renderTarget.texture` 后，sky 旧 `clearEnvironment()`（槽==自家纹理→清）分不清「env 直装」与「sky 自持」，必须先按路由器同判据让权（env 在场即不清）；env dispose 认 `skySourcedTex` 还原 `prevEnvironment`，不赌 registry 反序 dispose。守卫：sky 测试「[A]/[A 对照]」+ env 测试「[D-3 dispose 对称]/[D-4]」。
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
- **restoreState 存档形态闸（2026-09-22 锐评 F-1 复审补）**：`restoreState` **只接受 JSON 对象**，其余（number/string/boolean/`null` 字面量/数组/损坏 JSON）一律返回 `null`（同「无存档」语义）。原实现只用 try/catch 包 `JSON.parse`，`JSON.parse("5")` 得 `5` 便原样当 `Record<string,unknown>` 返回；而各 cap 的 legacy 回填写 `!("xEnabled" in s)`，**`in` 对非对象真值抛 TypeError**，该异常被 `sceneCapabilityRegistry.loadAll()`（`scene-capability-registry.ts|loadAll`）的 per-cap try/catch 吞掉并 `continue` → **后续 cap 全部静默跳过恢复**（`ringLog` 无生产 sink，用户只见黑场景、零提示）。修法 = **收口在唯一入口**：一处闸住，9 个 cap 调用点全免疫（各调用点既有的 `if (!state) return` 早退天然接住非对象），各 cap 无需重写 typeof 守卫。回归锁 = `scene-capability-persist.test.ts`（9 例，覆盖四种非对象型 + 合法对象/空对象/往返自洽）。
- **saveState**（写）：`persistState(capId, { this.enabled(能力级私有) + envState 参数字段 })` —— 从 envState **摘键**，不存全量。
  （2026-09：摘键可**派生化**——water 已改为逆历 `getPresetKeys("water")`，新增参数只进 schema；历史键名由 loadState 双轨吸收）
  （**能力级开关收口后的键形**：fog/water/shadow/reflector 已删私有 `enabled`，`saveState` **只写 schema 键**（含 `{fog,water,shadow,reflector}Enabled`），不再落无前缀 `enabled` 幽灵键；旧存档的 `enabled` 由 `loadState` 回填进对应 schema 键。**sky 亦已收口**（仅两枚开关键前缀化，兄弟键保持无前缀方言零迁移）。仍留旧键形的：ground/environment（见「不变量」末条）。）
- **loadState**（读）：`restoreState` → **旧键迁移**（ADR-196 前无前缀旧键 `{mode,color,...}` 转新键，保升级用户配置，如 fog 的 legacyKeys 分支）→ `restoreFields`（类型安全批量恢复器，按存档值实际类型分派回填）→ `setEnvState(..., {source:"auto-model"})` 写回 envState → cap apply 落地 Three。**（ADR-283：恢复路径同样经唯一入口的值域钳制——存档里的越界值不会漏进 envState。）**
  **（来源纪律 2026-09-22 立法：恢复一律 `auto-model`，禁 manual。存档值是上一次会话的偏好延续，不是本次手改——打成 manual 会永久拒绝同轨 auto-model / auto-atmosphere 覆盖（切 sunset 氛围雾/环境/灯光不跟改，模型默认值也写不进）。**
  **「同口径」是按**声明**而非按**实施**成立的判词——2026-09-22 复核发现立法时 ground/reflector/shadow/renderMode 四路**实际仍是 manual**（fog/environment/pp/light/sky 才是真 auto-model），属「文档先于代码」的漂移；当日随锐评 F-2 一并收口，现八路同轨。ground 的坑在于恢复站点分**两条路径**：`loadState` 内直连 `setEnvState` 的站点，与委托公开 setter（`setMatOpacity`/`setMatScale`/`setOverlaySize`…，这些 setter 服务用户手改、必须保持 manual）的站点——只改前者会留暗门，故 `ground-capability.ts|RESTORE_SOURCE` 把恢复来源收敛成单一常量，由 `writeOpts` 组装 opts。**
  **回归锁（一律用**行为**断言，不探内部表——`_writeSource` 是 `env-state.ts` 模块私有、无导出读口）：`fog-capability.test.ts`「F-2」、`environment-capability.test.ts`「E-2/D1」、`light-capability.test.ts`「L-1」、`ground-capability.test.ts`「恢复路径来源纪律」、`reflector-capability.test.ts` 同名块、`shadow-capability.test.ts`「F-2」、`render-mode-capability.test.ts` 同名块。判据恒为「恢复后同轨 auto-model 写入仍能落地」。）**
- **触发时机**：进入 3D → `sceneCapabilityRegistry.loadAll()`（`shared-infra.ts|buildSharedInfra`）；离开 3D → `sceneCapabilityRegistry.saveAll()`（`mount-session.ts|teardown` full 档）。

**与预设的共存（守卫链）**：装配序 `loadAll()`（恢复写 auto-model）→ `applyModelDefaults()`（模型值 auto-model）。`shouldOverwrite` 对 **auto-model→auto-model 放行**——同轨互踩是实锤（探针实证：vrm 模型值顶掉存档雾色、mmd 顶掉存档 envPreset），故**凡 MODEL_DEFAULTS 携带本 cap 键的（fog/environment/ppEnabled/shadow/reflector），恢复路径必须配 `isStateLoaded` 守卫「有存档 = 模型默认让位」**（shadow/reflector 原生自带；fog/environment 2026-09-22 锐评 R-1 补齐）。无存档首启 → `loadState` 早退不置位，模型默认照常套用。氛围快照 `auto-atmosphere` > auto-model，用户点氛围恒能盖过存档值（E-2/F-2/L-1 恢复走 auto-model 要保的通道）。回归锁：fog「R-1」+ environment「R-1」+ 首启不误伤例。**light 注脚**：ADR-282 已令灯光与模型类别解耦，MODEL_DEFAULTS 现零 light 键，light 组 auto-model 恢复无同轨对手（L-1）；若未来再往表里加 light 键，须同步补 light 的 isStateLoaded 守卫。

**envState 层为何不做全量持久化（刀0 空壳已删）**：
1. **键轨冲突**——envState 全量快照 vs 各 cap 的 `ysm-scene-cap-*` 双套并存会双写双恢复（同参数存两份，启动恢复两遍，行为取决顺序易回归）。
2. **恢复语义丢失**——envState 全量恢复经 `setEnvState` 只能写参数，写不了能力级 `this.enabled`（`isStateLoaded` 置位均 cap 独占；fog/water/shadow/reflector/**sky** 私有 enabled 已收编为 schema 键，其开关即 schema 字段 `{fog,water,shadow,reflector,sky}Enabled`；environment/ground 的私有态除外）。
3. **迁移逻辑在 cap**——fog 的 legacy 旧键迁移按 cap 语义写，envState 层代劳不了。

职责边界：**cap 管「摘哪些键、怎么恢复、带什么守卫」；envState 管「运行时唯一真值 + 写入来源仲裁」**。

## 不变量

- 只经 `setEnvState` 写 envState，不直接改对象字段（否则不派发）。
- 能力级 enabled 原则上不入 schema（是否挂载是装配态）；**例外**：fog（首例）、water（2026-09-22 跟进）、shadow（2026-09-22 锐评 F-1 并入）、reflector（同日 F-1 二度收口并入）、**sky（同日 F-1 三度收口并入，`skyEnabled`）** 已把「能力启停」并入 schema 单门——`setEnabled/isEnabled` 收敛为 `envState.{fog,water,shadow,reflector,sky}Enabled` 别名，`SceneCapability` 接口不变。运行时态（customHdrTex/currentPreset/manualPreset）仍留 cap 私有。
  （**该「原则上不入 schema」的红线已被 ADR-250（已采纳）判定为误判并推翻**——见下方 sky 收口条的「收口依据」。判「该不该并入」用下方的**并入判据**，不要援引本红线。）
  （原 `volumetricEngine` 运行时态已随 ADR-246 D1 删除——postprocess 空壳引擎移除。）
  （**并入判据 = 私有默认值与 schema 默认值是否一致 + 冲突时哪方有佐证**：shadow 两侧同默认 `true`，直接并；reflector 两侧**相反**（私有 `true` / schema `false`），但 schema 侧三重佐证（注释/邻座援引/不变式测试）而私有侧零佐证，故以 schema 为准并入；**sky 两侧同默认 `true`**（`skyEnabled` 默认 `true` = 被退役私有门有效默认），故零行为漂移、无争议。**「默认值相反」不是不能并，而是并之前必须先判定谁是对的**。排查同族时务必比对两侧默认值，不要只看「有没有 UI 写口」。）
- **[2026-09 雾气锐评收口] `FogCapability` =「能力级开关并入 schema」首例**：cap 私有 `enabled`（构造 `opts.enabled ?? true`）已删——registry `ctx` 无该字段，使其生产链路**恒 true**，造成 master toggle 显示 ON 而 `scene.fog` 恒 null 的脱节；现 `isEnabled()/setEnabled()` 唯一真值源 = `envState.fogEnabled`（单一 gate）。同批收口：① 模式不变时**原地改雾对象字段**（不再每次 `new`，仅切模式重建）；② 新增 `subscribe`（仅 `fogMode` 离散切换 notify，驱动 `menu.refresh` 刷新条件显隐，对齐 water）；③ 状态层新增 `env.fogMode` 路径（`KNOWN_PATHS` + binding），供 fog 控件 `near/far`（linear 专属）× `density`（exp2 专属）经 `visibleWhen` 互斥显隐。
- **[2026-09-22 锐评收口] `WaterCapability` 跟进同法**：fog 病根在 water 原封未动——私有 `this.enabled` 恒 true（registry 不传 `opts.enabled`、无 UI 写口）却参与 `update`/`apply`/`syncWaterVisibility`/`saveState` 四处分支，且 `loadState` 会把 ground 嵌套 legacy 的 `water.enabled` 误写进它 → **中毒即水面永久关不掉**（菜单 waterEnabled 显示 ON、水不出现，`saveState` 还落盘幽灵键自续）。收口：删私有 `enabled` + `opts.enabled`，`setEnabled/isEnabled` 收敛为 `envState.waterEnabled` 别名（与 fog 唯一差异：water 另有 wetness 门控，单门只收「能力启停」这一维）；`saveState` 不再落 `enabled`、`loadState` 不再消费顶层幽灵键；守卫 = water-capability.test.ts「单门收口」describe（含 legacy 中毒救回用例）。
- **[2026-09-22 锐评 F-1 收口] `ShadowCapability` 三度同法 + **幽灵键**症结**：与 fog/water 同族但更隐蔽——schema 早已声明 `shadowEnabled`（`env-state-schema.ts|shadowEnabled`，group `shadow`），**却零消费者**：全仓机械扫描 148 schema 键 × 562 生产文件，`shadowEnabled` 是**唯一**没有任何 reader/writer 的键（机械扫描法可复用：逐键 grep 生产文件，排除 schema 声明/i18n/测试/文档）。真开关是私有 `this.enabled`，落盘成**无前缀** `enabled`——于是「菜单开关读私有门、存档写私有门、schema 键恒默认值」三线各说各话。收口（Option A：并入 schema 单门，而非删键）：① 删私有 `enabled` 与 `opts.enabled`（**注意 registry `createAll` 的 `ctx` 无 `enabled` 字段**，私有态在生产恒为构造默认 `true`——这正是「私有门恒 true、真开关失效」的毒根）；② env 回调**新增 `changed.has("shadowEnabled")` 分支**——该键本就在 `shadow` 组内会自动派发到本回调，不接管则 toggle 改了不落地（原实现靠私有门短路挂在回调最前，键永无消费者）；③ `setEnabled/isEnabled/getParams().enabled` 收敛为 `envState.shadowEnabled` 别名；④ `saveState` 只写 6 个 schema 键（`shadowEnabled` + type/mapSize/bias/normalBias/cameraSize），不再落 `enabled`；⑤ `loadState` 双轨吸收旧键形——`enabled`→`shadowEnabled` 回填（缺 `shadowEnabled` 时）+ 无前缀 `type/mapSize/bias/normalBias/cameraSize` → 前缀键（判据 `shadowType` 缺失，fog 先例同法），保留 `state.soft` 兜底。守卫 = shadow-capability.test.ts「能力级开关单门收口」describe 四例（僵尸门守卫 `expect("enabled" in cap).toBe(false)` / 别名写口真落 `renderer.shadowMap` / 幽灵键不进存档 / legacy 中毒救回）。
- **[2026-09-22 锐评 F-1 二度收口] `ReflectorCapability` 同法——**默认值相反**才是真病根**：reflector 原为**双门** `if (!this.enabled || !envState.reflectorEnabled) return;`，`isEnabled()` 只读私有门，`getParams().enabled = 私有门 && schema 键`。关键事实：**两门默认值相反**——私有门 `opts.enabled ?? true`（registry 不传 → 恒 `true`），而 `env-state-schema.ts|reflectorEnabled` 默认 **`false`**（刻意：倒影 = 每帧多一次整场重渲进 RT，`water-menu.ts` 明记「与地面 reflectorEnabled 同纪律」）。故**首启无存档时两门必然背离**：菜单/headerToggle 读私有门显示 **ON**，`buildReflector` 却因 schema 键 `false` 不建 mesh——与 fog 收口前「master toggle 显示 ON 而 `scene.fog` 恒 null」是同一脱节病（旧认知「两键恒同步故无症状」错在只看了有存档路径；`saveState` 把两键都写、`loadState` 都恢复，恰恰掩盖了**首启**这条无存档路径）。
  - **连带收获（更隐蔽的一条）**：旧 `isEnabled()` 恒 `true` 使 postprocessing 的 SSR 抑制环 `reflectorPrevEnabled = reflectorCap.isEnabled()` 在**用户从未碰过开关**时记下 `true`（一个用户从未表达过的意图），SSR 关闭还原即 `setEnabled(true)` → **镜子凭空出现**。回归锁 `postprocessing-capability.test.ts`「[F-1] 用户从未开过 reflector…不得凭空冒出镜面」——该用例在旧语义下实测转红（探针实证非空转），且与既有「reflector 原本就关」用例互补：后者先显式 `setEnabled(false)`（用户表过态），故旧实现也能过，真正漏网的是「没表过态」路径。
  - **收口**：删私有 `enabled` 与 `opts.enabled`（退役测试 8 处构造传参 + pp `makePair` 的 `enabled: true`）；`buildReflector` 单门 `if (!envState.reflectorEnabled) return;`；`setEnabled/isEnabled/getParams().enabled` 收敛为 schema 键别名（`setEnabledReflector` 保留，与 fog `setEnabledFog` 双件同法）；`saveState` 只写 6 个 schema 键；`loadState` 按 fog 先例回填 legacy `enabled`（**且显式改述**：旧实现 `restoreFields` 里那条 `enabled` 分支是「把幽灵键写回私有门」，现改为回填 schema 键）。守卫 = reflector-capability.test.ts「能力总开关单门收口」describe 六例（僵尸门 / 别名双向 / 首启菜单读数同步 / 幽灵键不进存档 / legacy 回填 / legacy 中毒救回）。
  - **教训（写进方法层）**：判「私有门是否病灶」不能只问「有没有 UI 写口」——**必须比对私有默认值与 schema 默认值是否一致**。shadow 与 reflector 都是零/弱写口，但 shadow 症状靠 schema 键无人消费暴露，reflector 症状靠**默认值相反**暴露；`reflection-chain-invariants.test.ts` 当年甚至把 AND 关系**当作不变式记录下来**（含「注意与构造 `enabled ?? true` 区分」的注脚），等于给病根发了备案——**不变式测试也会成为病灶的掩体**，复核时要问「这条不变式是在描述期望，还是在给现状背书」。
- **[同批复核] 同族病灶余项（2026-09-22 扫描结论；含 F-1 二度收口 + sky 收口后更新）**：`sky`/`environment`/`ground` 曾留私有 `this.enabled`（`light` 经本轮核实**已收口**；`sky` 亦已于 2026-09-22 收口，见末二条），**逐个核实后严重度不同**——
  - **`reflector` = 已完成二度收口（原判「活体孪生待拍板」已决）**：见上方「F-1 二度收口」条。原以为须拍板「合一取默认关还是默认开」，实证后**无需拍板**——`reflectorEnabled` 默认 `false` 是**刻意设计**（性能：每帧多一次整场重渲），且有三重佐证（schema 注释、`water-menu.ts` 邻座援引「与地面 reflectorEnabled 同纪律」、`reflection-chain-invariants.test.ts` 默认值不变式），而私有门默认 `true` 只是「registry 不传参」的偶然产物、零佐证。**判据：两者冲突时以有注释/有 ADR/有邻座援引的一方为准**。
  - **`ground` = 僵尸私有门（非 live，暂不动）**：`getMasterNodeId()` 返回 `"ground-visible"`，即**总开关绑的是 `envState.groundVisible`**（`setVisible`/`getVisible`），私有 `enabled` 全仓**无 UI 写口**（`setEnabled` 虽存在但零生产调用方），生产恒 `true`。它参与 `apply`/`updateGridVisible`/三层 `visible` 合取与 `saveState`（落无前缀 `enabled`）；`loadState` 会读回它。因恒 true 故当前无可见缺陷，属「读起来吓人、实为惰性」——与 shadow 的差别正在于 shadow 的私有门有 UI 写口（`shadow-menu.ts|shcEnabledNode`）而 ground 没有。（⚠️ ground 的**默认值无冲突**——私有门恒 `true`，schema 侧 `groundVisible` 默认亦为 `true`，故不构成 reflector 那种「首启背离」；若未来把 `groundVisible` 默认改为 `false`，须同步收口。）
  - **`environment` = 同类但开关本就私有语义**：`getMasterNodeId` 返回 `"env-enabled"`，开关明确设计为不入 envState（`environment-capability.ts` 注释「能力总开关（不入 envState…）」）——ADR-196「刀5」段所记「能力级 enabled 不入 schema 红线」的原教旨形态，非漏网。（该红线与 fog/water/**shadow**/**reflector** 的并入例外并存，判据见上条「并入判据」。）
  - **`sky` = 已完成收口（原判「最高危余项」，2026-09-22 本轮 F-1 落地）**：原状与 shadow 同型——私有 `this.enabled`（构造 `opts.enabled ?? true`，registry 不传 → 恒 `true`）、`setEnabled/isEnabled` 直读写它、`sky-menu.ts|skyEnabledNode` 的 toggle 即绑这对方法（**有 UI 写口**）、`saveState` 落无前缀 `enabled` 幽灵键、`loadState` 把它读回**私有门**；且 schema 中**不存在 `skyEnabled` 键**。
    - **收口依据（ADR-250 已采纳，推翻旧红线）**：`ADR-250-cap-composer-sky.md` 是**决定性先例**——它明确判定「能力级 enabled 不入 schema」是**误判**（「门禁之所以一度无家可归，是因它被误判为「能力级挂载」。但实际上「是否显示后处理效果」是**用户对可见效果的偏好**，与「cap 是否构造」是两件事」），并点明 pp/light/fog/shadow/reflector/**sky** 走同一条路。源码佐证：`ppEnabled` 已入 schema、`POSTPROC_PRESETS`/`perTypeGate`/`perfMaster` 已退役。故 sky 不是「要不要破例」，而是**补上 ADR-250 已宣告的同族之路**。
    - **本文件内同病共三处（一次探针全数照出）**：`enabled`、`godRaysEnabled`、`autoRotateOn`。第三处藏得最深——由私有镜像 + env 回调同步维持，**只有 `loadState` 走 `suspendEnvCallbacks()` 挂起派发时才失同步**（存档里 `autoRotate` 是 true、`isAutoRotating()` 读 false、昼夜循环静默失效）。**教训：给 cap 补 `suspendEnvCallbacks()` 会照出所有「靠回调同步的私有镜像」**——挂起即断同步，比逐行 grep 有效得多。
    - **`skyGodRaysEnabled` = 幽灵键**：schema 早声明该键，全仓生产码**零写入者**，真开关藏在 `SunBeams` 私有门里。收口后 `SunBeams` 降为**无状态执行器**（删 `enabled`/`setEnabled`/`isEnabled`），开关真值源唯一归 `envState.skyGodRaysEnabled`，由宿主 `sky-capability.ts|syncBeams` 现读判定后驱动（开→`sync` 按 intensity 挂载、关→`detach`）。
    - **收口内容**：① schema 新增 `skyEnabled`（默认 `true`，与被退役私有门有效默认一致 → **零行为漂移**，无 reflector 那种默认值冲突）；② 删私有 `enabled`/`autoRotateOn`，`isEnabled/isAutoRotating/isGodRaysEnabled/update/apply/applyModelPreset` 一律直读 envState；③ 回调新增 `changed.has("skyEnabled")` 分支（开态 `apply`、关态 `detach` + notify；`apply()` 已从 envState 全量重写，故可直接 return，与 shadow 同形）；④ `saveState` 两枚开关改落 schema 键形，兄弟键保持无前缀方言零迁移（`environment` 键另有跨槽读者——`environment-capability.ts|loadState` 读 `skyState.environment` 做 ADR-292 旧档归一，改名即断链；同族先例 = reflector 亦仅前缀总开关）；⑤ `loadState` 双腿吸收旧键（`enabled`→`skyEnabled`、`godRaysEnabled`→`skyGodRaysEnabled`，判「前缀键缺失 ∧ 旧键类型合法」）+ 补 `suspendEnvCallbacks()` 挂起派发（fog/water/env/light 同法）。**不加 `isStateLoaded`**——sky 不在 `MODEL_DEFAULTS`，无同轨模型写对手。
    - 守卫 = `sky-capability.test.ts`「能力级开关单门收口」describe 八例（僵尸门 ×2（cap 与 beams）/ 别名双向真落场景 / 幽灵键 ×2 不进存档 / legacy 中毒救回 ×2 / 别名走单一真值源 / **第三处镜像 autoRotate 恢复后可推进**）。
  - **`ground` = 僵尸私有门（非 live，暂不动）**：`getMasterNodeId()` 返回 `"ground-visible"`，即**总开关绑的是 `envState.groundVisible`**（`setVisible`/`getVisible`），私有 `enabled` 全仓**无 UI 写口**（`setEnabled` 虽存在但零生产调用方），生产恒 `true`。它参与 `apply`/`updateGridVisible`/三层 `visible` 合取与 `saveState`（落无前缀 `enabled`）；`loadState` 会读回它。因恒 true 故当前无可见缺陷，属「读起来吓人、实为惰性」——与 shadow 的差别正在于 shadow 的私有门有 UI 写口（`shadow-menu.ts|shcEnabledNode`）而 ground 没有。（⚠️ ground 的**默认值无冲突**——私有门恒 `true`，schema 侧 `groundVisible` 默认亦为 `true`，故不构成 reflector 那种「首启背离」；若未来把 `groundVisible` 默认改为 `false`，须同步收口。）
  - **`light` = 已收口（本轮核实补记）**：`light-capability.ts` 用 **getter 别名**形态收口——`private get enabled(): boolean { return envState.lightEnabled; }`（不持字段，注释明言「本 cap 不再持有 enabled 字段」），`opts.enabled` 若传入则转写 `setEnvState({lightEnabled})`。故 light **不应**再列入「仍留私有 `this.enabled`」名单。
    - **注**：sky 收口**未**沿用 light 的 getter 别名形态，而是像 fog/water/shadow 一样**完全不留 `enabled` 成员**（连 getter 也没有），内部一律直读 `envState.skyEnabled`。原因：getter 别名虽满足 ADR-250 §2.1「不再是独立真值源」，但守门测试用 `"enabled" in cap` 探针——`in` 会**沿原型链**命中原型上的 getter 访问器，故 getter 形态通不过该守卫。两形态都合法（ADR-250 明言「`this.enabled` 保留为该派生量的读法，`isEnabled()` 语义不变，但**不再是独立真值源**」），选哪种取决于要不要留同名的行内可读性；sky 选了更简的一侧。
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
- **[ADR-246] 未落地项——「雾中体积光」**：真正的 raymarching 体积光（`VolumetricLightingPass`，ADR-084 末节「后续立项，未开始」）**仍未实现**；ADR-246 已裁定若要做须以**新增 pass** 方式引入，不得复活「切换渲染器」开关。注意与两条已落地能力区分：`FogCapability`（`scene.fog` 线性/指数雾，非体积光）、ADR-107 天空体积光束 god rays（非雾中散射）。
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
