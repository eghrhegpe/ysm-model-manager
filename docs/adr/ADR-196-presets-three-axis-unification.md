# ADR-196：预设三轴统一——全局 envState 单例 + cap 退化为渲染器（激进路线）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-195（cap 控件单类型化，并列）；ADR-193（preview-menu declarative endgame）；`frontend/src/preview-3d/caps/scene-capability.ts`、`frontend/src/preview-3d/menu/panels/env.ts`、`frontend/src/preview-3d/adapters/shared-infra.ts`

---

## 1. 背景（Context）

### 1.1 预设体系三轴并行

YSM 3D 预览有 10 个 SceneCapability（sky/ground/water/environment/fog/shadow/reflector/postprocessing/light/renderMode），每个 cap 各自维护一套**模型类别预设**（`setPreset(adapter.id)`）。跨 cap 的**氛围预设联动**则由 `menu/env.ts` 的 `applyPreset()` 硬编码实现。**手动/自动守卫**（用户手动调参后是否被预设覆盖）各 cap 自行实现、口径不一。三者各自为政，构成"三轴分裂"。

**轴 1 — 模型类别预设**：各 cap 内联 `MODEL_*_PRESETS` 表，按模型类型（ysm/vrm/mmd/mmd-scene/litematic/resourcepack）选初始参数。问题：
- 7 个 cap 的预设表 **key 集不一致**——Sky 缺 `resourcepack`（`sky-state.ts:70-133`），Shadow 缺 `resourcepack` 映射（`shadow-state.ts:46-57`），切模型时部分 cap 走 default、部分走 resourcepack 预设，行为不对称
- Shadow 沿用旧 key 命名（`character/prop/small/architecture/scene/creature`），与其它 cap 的 `ysm/vrm/mmd` 风格迥异
- Ground/Water 无 `setPreset` 方法，切模型永远不响应

**轴 2 — 氛围预设联动**：`ENV_PRESET_LINKAGE`（`environment-state.ts:116-141`）+ `applyPreset()`（`env.ts:70-109`）实现 5 个氛围（sky/studio/sunset/night/forest）的跨 cap 协调。问题：
- 只联动 3 个 cap 的 5 个字段（sky time/cloud、fog enabled/mode/density/near/far、envIntensity），**其余 7 个 cap 完全不动**——选「夜景」时灯光/阴影/后处理/反光/地面/水面参数不变，氛围割裂
- `applyPreset()` 是**纯硬编码** `if (link.sky)` / `if (link.fog)`，新增 cap 需同时改类型定义 + 常量表 + 函数体三处
- Sky 的 turbidity/rayleigh 等散射参数不被联动，日落/夜景的天空散射仍是正午值，视觉矛盾

**轴 3 — 手动/自动守卫**：各 cap 守卫机制三足鼎立：
- `isStateLoaded` 标志（Shadow/Reflector）—— loadState 后 setPreset 不覆盖
- `manualPreset` 标志（Light）—— 手动选择后自动预设不覆盖
- 无守卫（Sky/Fog/Environment/Postprocessing）—— 每次 setPreset 直接覆盖用户当前值

结果：用户手动调了 sky time 后选氛围预设，sky time 被静默覆盖（无守卫）；手动调了 fog 后切模型，fog 被覆盖（无守卫）；但手动调了 light 后切模型，light 不被覆盖（manualPreset 守卫）—— **行为不可预测**。

### 1.2 根因：预设没有单一事实源 + 菜单-状态断裂

AGENTS.md 已建立 `resource_types.json` 作为**资源类型**的单一事实源（Go 扫描 + JSON 派生前端 tab/preview/resourcepack 归类），但**预设体系**没跟上——各 cap 各自定义预设表、各自实现守卫、各自被 `applyPreset` 硬编码调用。

更深层根因：YSM 搬运了 MikuMikuAR 的**菜单壳**（MenuNode + renderMenu + folder/slider/toggle），但没搬运**菜单魂**（StatePath + setEnvState + dispatchEnvChange）。cap 参数私有封装在 cap 内部，声明式菜单接触不到，只能以 cap 控件（`MenuControlDef`）的闭包形式绑定。壳与魂分离，导致声明式菜单是空壳，cap 控件才是干活的。

### 1.3 MikuMikuAR 参照：统一状态 Schema + 声明式预设

MikuMikuAR 用单一 `ENV_STATE_SCHEMA`（`env-state-schema.ts`）统管全部场景参数（sky/ground/water/fog/lighting/particle/cloud/reflection/mirror/collision 共 80+ 字段），每个字段声明 `type` + `default` + `dispatch group`。预设 = 完整状态快照（`SCENE_PRESETS`），应用 = `setEnvState(snapshot)` + `transitionLighting()` + `transitionRenderState()` 三函数落地，无硬编码联动。地面样式由 `groundType` + `groundStyle` + `groundPattern` 独立字段控制，`groundPreset` 纯 UI 标记不驱动渲染——从架构上杜绝了"线条样式与地板纯色冲突"。

MikuMikuAR 的菜单控件**不持有 cap 引用**，只认 StatePath 字符串（`bind: 'env.skyColorTop'`）。`envState` 是**可变单例**，所有写入经中央入口 `setEnvState()`，派发由 `dispatchEnvChange()` 回调注册表完成。菜单是"状态驱动"，状态是"能力驱动"。

### 1.4 为何 YSM 长出三轴

YSM cap 是**能力自治**模式——每个 cap 封装 Three 节点创建、shader 注入、动画循环、PMREM 管线等**行为**，参数只是行为的附属。MikuMikuAR 是**状态驱动**模式——参数是状态，渲染是状态的投影。YSM 的 caps/ 行为层不可删除（Three 装配/渲染逻辑必须封装），但 caps/ 的**状态层**（参数管理）可以且应该收口到统一 Schema。

## 2. 决策（Decision）

**方向：全局 `envState` 单例 + cap 退化为「状态 → Three.js」渲染适配器；菜单控件经 StatePath 绑定写状态，cap 订阅状态变更回调更新 Three.js。**

**选「激进路线」而非「保留 cap 参数封装 + 加 getState/setState 接口」**——后者是渐进补魂，但 cap 参数仍私有，菜单仍需闭包绑定，三轴问题只治标。激进路线把 cap 参数彻底外移到全局 `envState`，菜单-状态绑定从根上打通，三轴自然合一。

### 与 ADR-195 的衔接裁决（2026-09-07 补）

ADR-195（cap 控件单类型化）与 ADR-196 同属菜单/状态体系收口，二者**先后衔接而非打架**：

- ADR-195 完成的是**声明类型统一**：10 cap 从 `getMenuControls(): MenuControlDef[]` 迁到 `getMenuNodes(): PreviewMenuNode[]`，渲染走 renderMenu 单链。此步已全量落地。
- ADR-196 刀 0 落地后，cap setter/getter **已全部直通 envState**（`setFogDensity`→`setEnvState({fogDensity})` + registerEnvCallback 触发渲染）。这意味着 ADR-196 的**实质目标「cap 参数外移全局 envState + 菜单经统一写入口落状态」已由刀 2 达成**——菜单控件 `{ get:()=>cap.getXxx(), set:(v)=>cap.setXxx(v) }` 闭包背后就是 envState 单例，只差一层字面转发。
- 2026-09-07 决策（ADR-195 刀 3 之后复核）：**ADR-196 刀 3 字面 StatePath 化不放行**，改为「状态驱动已达成、形式统一不做」。理由：① 菜单闭包绑的 cap setter 语义化清晰、可读、可测，逐一换成 `getStateValue('skyTimeOfDay')` 扁平字符串会丢类型安全与 setter 内部的守卫逻辑（light manual 双入口、reflector isStateLoaded 守卫）；② 泛化统一已有 cap setter 直通 envState 兜底，服务端/装配链均已验证，纯 UI 层字面改写是「用更脆写法换形式上一致」，违背长治久安。ADR-196 刀 3 相应水印为「已由刀 0/2 实质达成，字面部分不采纳」。此决策不改动 `setEnvState` 作为唯一写入口的地位——cap setter 与装配链（applyModelDefaults/applyPostProcDefaults）仍全部经它落状态，StatePath 只作为**可选项**预留，不作为菜单绑定必选。

### 当前实施进度（2026-09-07 v2 快照，详细见知识卡 preview_env_state）

- 刀 0：**3/4，第 4 项明确不做**（`env-state-schema.ts`/`env-state.ts`/`env-dispatcher.ts` 已建；`env-state-persist.ts` 取消——持久化由各 cap saveState 承担，envState 层持久化会双写双恢复冲突，空壳 schedulePersistEnvState 已删，2026-09-07 决断）
- 刀 1：Sky 参数写入已走 setEnvState，旧 `MODEL_SKY_PRESETS` 已删（3aeb60913）；setter 仍双写 uniforms（残留，不影响预设体系）
- 刀 2：10/10（全部 cap 参数迁入 envState，schema 全量拍平 ~90 字段）
- 刀 4：`MODEL_DEFAULTS`（7 源合并）+ `ATMOSPHERE_PRESETS`（完整氛围快照）已建；`applyPreset` 硬编码 `if(link.sky)` → `setEnvState(ATMOSPHERE_PRESETS[id], {source:'auto-atmosphere'})`
- 刀 5：**旧预设表清理完成度 6/7**——`MODEL_SKY_PRESETS`/`ENV_PRESET_BY_MODEL`/`ENV_PRESET_LINKAGE`（3aeb60913）/`SHADOW_PRESETS`+`SHADOW_PRESET_BY_MODEL`/`LIGHT_PRESETS`（本次）/`SceneCapability.setPreset` 接口（13b8b4e5f）均已删除；`POSTPROC_PRESETS` **收口为正确保留**（2026-09-07 决断）——其只额外携带 `enabled` 键（per-type 门禁，属能力级 enabled 不入 schema 红线），非刀5 遗漏
- 刀 3：**已由刀 0/2 实质达成，字面 StatePath 化不采纳**（2026-09-07 决策，见「衔接裁决」）——cap setter/getter 全直通 envState，菜单控件闭包即状态驱动；StatePath 留作可选实现细节。

### 刀序（实施见知识卡，ADR 不记进度）

1. **刀 0：建统一状态层**：
   - `state/env-state-schema.ts`：仿 `ENV_STATE_SCHEMA` 模式，收口全部 cap 参数声明。每个字段 `{ type, default, group }`，group 对应 cap 的 dispatch 消费方。Schema 派生 `getPresetKeys(group)` 自动收录 key 列表。地面样式字段**独立声明**（`groundType` / `groundColor` / `groundLineColor` / `groundMatSource`），从架构上消灭"10 功能塞一个预设"。
   - `state/env-state.ts`：可变单例 `envState` + `setEnvState(partial, opts?)` 中央入口 + `getStateValue(path)` / `setStateValue(path, value)` StatePath 读写。写入带 `lastWriteSource` 来源标记（`auto-model` / `auto-atmosphere` / `manual`），守卫决策：`manual > auto-atmosphere > auto-model`。
   - `state/env-dispatcher.ts`：`registerEnvCallback(cap, cb)` 回调注册表 + `dispatchEnvChange(changedKeys, state)` 派发。
   - `state/env-state-persist.ts`：防抖持久化到 localStorage。

2. **刀 1：SkyCapability 试点迁移**（先啃最复杂的）：
   - 删 `SkyParams` 类型 + `MODEL_SKY_PRESETS` + `DEFAULT_SKY_PARAMS`（迁到 `env-state-schema.ts`）
   - 构造时注册 `registerEnvCallback(this, (changed, state) => { ... })`，回调内读 `state.skyXxx` → 写 Three.js uniforms
   - `setTime(h)` 改调 `setEnvState({ skyTimeOfDay: h }, { source: 'manual' })`，dispatch 自动触发回调
   - `getMenuNodes()` 改返回 `{ control: { bind: 'skyTimeOfDay' } }`（StatePath 替换闭包）

3. **刀 2：其余 9 cap 逐一迁移**：
   - 每个 cap 的 `params` 类型 + 预设表迁到 `env-state-schema.ts`
   - 构造时注册回调，析构时取消订阅
   - setter 改调 `setEnvState`，getter 改读 `envState`
   - 菜单控件改 StatePath 绑定

4. **刀 3：菜单-状态桥接（2026-09-07 修订 x2：状态驱动已实质达成，字面 StatePath 化不采纳）**：

   **本刀状态：由刀 0/2 实质达成（cap setter 全直通 envState），字面 StatePath 化不做。** 本节保留作决策记录，不再作为待办。

   - **原方案**（cap-to-node 桥接层替换闭包）已被 ADR-195 取代：ADR-195 刀 2 让 10 个 cap 全部直产 `PreviewMenuNode[]`（`getMenuNodes()`），cap 不再经 `getMenuControls` 桥接，原「在桥接层替换」无落点。
   - **刀 2 后**：cap setter/getter 已全部 `setEnvState(...)` 直通 envState（刀 0 统一状态层），菜单控件闭包 `cap.setXxx(v)` 背后即 envState 单例。→ 菜单是**状态驱动**了。
   - **2026-09-07 复核决策**：不采纳「控件直绑 `getStateValue('skyTimeOfDay')`」的字面 StatePath 化——语义化 setter + setter 内守卫（light manual 双入口、reflector isStateLoaded）不可丢；StatePath 保留为实现细节可选，非菜单绑定要求。

5. **刀 4：预设体系收口**：
   - 删 `MODEL_SKY_PRESETS` / `FOG_PRESETS` / `ENV_PRESET_BY_MODEL` / `ENV_PRESET_LINKAGE` / `LIGHT_PRESETS` / `POSTPROC_PRESETS` 的模型类别维度，收口到 `MODEL_DEFAULTS`（Schema 派生的模型默认值，`auto-model` source）
   - 删 `ENV_PRESET_LINKAGE`，收口到 `ATMOSPHERE_PRESETS`（完整快照，每个氛围 = 所有 cap 参数的 partial，`auto-atmosphere` source）
   - `menu/env.ts` 的 `applyPreset` 硬编码 `if (link.sky)` / `if (link.fog)` → `setEnvState(ATMOSPHERE_PRESETS[presetId], { source: 'auto-atmosphere' })`
   - 各 cap `setPreset(modelType)` 改为 `setEnvState(MODEL_DEFAULTS[modelType], { source: 'auto-model' })`（或删 setPreset 由 shared-infra 直接写）

6. **刀 5：删除旧体系**：
   - 删 `MenuControlDef` / `MenuControlKind` / `cap-controls.ts`（ADR-195 刀 3 范畴，与 ADR-196 刀 5 收口重叠时以 ADR-195 刀序为准）
   - 删各 cap 的 `MODEL_*_PRESETS` 常量（刀 4 后无引用）
   - 删 `SceneCapability.setPreset` 接口（不再需要，模型预设统一走 `MODEL_DEFAULTS` + `setEnvState`）

### 关键映射

| 现状 | 终态 |
|------|------|
| 7 个 `MODEL_*_PRESETS` 各自为政 | 单一 `ENV_STATE_SCHEMA` 派生模型类型联合 |
| cap 参数私有封装在 `this.params` | 全局 `envState` 可变单例 |
| 菜单控件 → `cap.setXxx(v)` 闭包 | 菜单控件 → `setStateValue('skyTimeOfDay', v)` StatePath |
| `applyPreset` 硬编码 `if (link.sky)` | `setEnvState(ATMOSPHERE_PRESETS[snapshot])` + dispatch |
| 守卫三足鼎立 | `lastWriteSource` 三来源优先级统一决策 |
| 氛围只联动 3 cap 的 5 字段 | 氛围 = 完整 snapshot，所有 cap 按 group 分发 |
| 地面样式冲突（10 功能塞一个预设） | Schema 字段独立声明（`groundType` + `groundColor` + `groundLineColor`） |
| cap 控件（MenuControlDef）是干活的 | 声明式菜单（MenuNode）直接写状态 |

### 兼容与红线

- `SceneCapability` 接口：删 `setPreset` / `getMenuControls` / `getMasterToggle`；新增 `applyState?(changed: Set<string>, state: EnvState): void`（可选，无此方法的 cap 由 dispatch 层直接写 params）。
- `visibleWhen` 铁律不动。
- 中间态有界：Schema 存在期间新旧双形制并存，最后一刀删除旧预设表。
- Ground/Water 补 `applyState` 方法（当前无，刀 2 补齐）。

**拒绝的替代方案**：cap 暴露 `getState/setState` 接口（渐进补魂但参数仍私有，菜单仍需闭包绑定，三轴只治标）；保留 `applyPreset` 硬编码 + 只扩展联动字段（联动表随 cap 增加持续膨胀）；保持 cap 控件不动 + 只加 Schema（Schema 成空壳，实际写入仍走 cap 闭包）。

## 3. 后果（Consequences）

**正面**：
- 预设体系单一事实源落地，三轴自然合一
- 菜单-状态绑定打通，声明式菜单"真干活"，cap 控件（MenuControlDef）可退役
- 氛围预设可完整联动所有 cap，地面样式冲突从架构上根治
- 用户手动调参后不再被静默覆盖（统一守卫）
- 与 MikuMikuAR 的 `ENV_STATE_SCHEMA` 模式同构，未来生态对齐成本归零

**负面 / 代价**：
- 激进改动：10 个 cap 全部要改造（参数外移 + 注册回调 + setter 改调 `setEnvState`）
- 测试面大：90+ 测试断言需改写（`cap.setXxx()` → `setEnvState({ xxx: v })`）
- 中间态有界但长：Schema 与旧 params 双形制并存期间，调试复杂度上升
- cap 从"自治能力"退化为"状态适配器"，架构范式切换需要团队适应

**已知遗留**：Sky 缺 `resourcepack` key、Shadow 缺 `resourcepack` 映射需在刀 0 补齐；Shadow 旧 key 命名（`character/prop/...`）可保留为别名映射到 Schema 统一 key，避免破坏既有存档。

## 4. 数据溯源

- AGENTS.md（2026-09 更新）：`resource_types.json` 作为资源类型单一事实源 → 本 ADR 将同一哲学扩展到预设体系
- MikuMikuAR `frontend/src/core/env-state-schema.ts`（`ENV_STATE_SCHEMA` 80+ 字段 + `getEnvKeys(group)` 派生 + `satisfies` 类型互锁）→ §1.3 参照与 §2 刀序
- MikuMikuAR `frontend/src/menus/env-preset-levels.ts`（`SCENE_PRESETS` 完整快照 + `setEnvState`/`transitionLighting`/`transitionRenderState` 三函数落地）→ §1.3 参照
- MikuMikuAR `frontend/src/menus/env-sky-levels.ts`（`bind: 'light.dirIntensity'` StatePath 绑定）→ §1.2 菜单-状态断裂
- YSM 架构审计（子代理全仓实证 14 项技术债务：E1-E14）→ §1.1 三轴问题
- `environment-state.ts` `ENV_PRESET_LINKAGE` + `env.ts` `applyPreset` 硬编码 → §1.1 轴 2 问题
- `sky-capability.ts` `setPreset` / `fog-capability.ts` `setPreset` / `light-capability.ts` `setPreset({ manual })` / `shadow-capability.ts` `setPreset` + `isStateLoaded` → §1.1 轴 3 问题
- ADR-195（cap 控件单类型化，并列）→ 本 ADR 同属菜单/状态体系收口

<!-- 文件名: presets-three-axis-unification.md → 实际文件 ADR-196-presets-three-axis-unification.md -->
