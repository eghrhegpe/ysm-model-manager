# 3D 预览环境系统锐评（2026-10-09）

> **审计对象**：`frontend/src/preview-3d/state/`（envState 统一状态层）× `caps/`（10 cap）× 持久化/菜单接线。
> **方法**：主模型直读源码 + 3 子代理分域取证（① 状态层健康度 → ② caps 能力层 → ③ 测试盲区与文档漂移），
> 主模型对子代理结论**逐条直读源码甄别**，纠正 2 处误判、订正 1 处定性。
> **基线**：本次全部结论锚定当前 HEAD 源码（`git status` 干净，行号为当次实测）。
> **与既有锐评的关系**：不重复历史结论。既有病历见 `docs/audit-env-coupling-review.md`（10-08 env×caps）、
> `docs/audit-host-env-coupling-review.md`（10-08 宿主环境层）、知识卡 `preview-env-state.md`（ADR-196/250/292/293/326 全链）。
> **本报告只记本轮新发现 + 既有结论的"仍活"复核 + 子代理误判订正。**

## 一、总判

**环境域已是全仓治理最狠的域——它的风险不在"治得慢"，在"扫不全"。**

- 判据单源化已基本完成：`isSsrRenderActive` / `effectiveToneMappingExposure` / `envShouldYieldSlot` /
  `attenuateAmbientForSky` 均下沉纯函数，消费方走出口、零旁路内联。
- 槽位所有权治理到位：`scene.environment` 唯一写者收敛到 `env-ibl.ts`，`scene.fog`/`shadowMap` 单写者。
- 私有门退役收尾完成 9/10（pp/light 用 getter、env/fog/shadow/reflector/sky 收编 schema 键）。
- **但**：既有锐评两轮反复提出、始终零落地的两个 meta 闸**依然不存在**；本轮又扫出
  "11 个数值键无钳制"这一**从未被记录**的面。**机器闸缺位是这个域反复复发的同一根因。**

## 二、正面确认（亲验，非既有结论照抄）

| 项 | 证据 | 判定 |
|---|---|---|
| `scene.environment` 唯一写者 | `env-ibl.ts:142/226/317` 写、`environment-ownership.ts` 让权纯函数、`sky-capability.ts:939` dispose 占有权守卫 | ✅ 双写者已消（env + sky 自持路径被守卫钉死） |
| `scene.fog` / `shadowMap` 单写者 | `fog-capability.ts:102/124/315`、`shadow-capability.ts:293/377` | ✅ |
| pp 私有门已收口 | `postprocessing-capability.ts:147-149` `get enabled()` 直读 `envState.ppEnabled`——注释与代码**一致**（主模型初疑"读写分叉"，读字段声明后证伪） | ✅ 非分叉 |
| pp tone 还原有逐字段归属判定 | `postprocessing-capability.ts:581-599`：`:587 skyOwns 让位 + :591 toneMapping 归属 + :598 outputColorSpace 归属` | ✅ **薄弱侧在 sky 不在 pp** |
| dispose 复位 5/5 实闭 | `env:580` / `fog:319` / `pp:948` / `reflector:333` / `shadow:415` 各 `isStateLoaded=false`，且各有行为锁测试 | ✅ 既有锐评 10-09 声称"已修"**属实** |
| 值域覆盖接近完整 | 101 个 number 键中 77 有 `range` + 8 有 `uiRange` | ✅ 优于既有锐评印象 |
| env 持久化对称派生 | `env-persist.ts:32/45-47/67-69` 读写两侧同源 `ENV_KEYS` + `getArchiveKey`，漏登记结构性不可能 | ✅ ADR-326 落地 |
| 手抄判据归零 | `water-reflect.ts:54` 消费 `isSsrRenderActive`，无第三份手抄 | ✅ |

## 三、本轮新发现

### P1｜10 个非颜色 number 键无 range，`clampFieldValue` 原样透传

- **病症**：既有锐评只提过"3 个无钳制"（`skyExposure`/`envUseAsBackground`/`lightVolumetricBaseStrength`），
  实测 **10 个**——`skyTimeOfDay`/`skyTurbidity`/`skyRayleigh`/`skyMieCoefficient`/`skyMieDirectionalG`/
  `skyExposure`/`envResolution`/`reflectorClipBias`/`lightVolumetricBaseStrength`/
  `lightVolumetricTipStrength`（`env-state-schema.ts:67/79/80/81/82/99/411/504/819/820`）。
- **⚠️ 初判订正**：原判"11 个"含 `shadowMapSize`——**错误**。`shadow-capability.ts:32` 注释明写
  "值域语义是**离散档位而非区间**，故 schema 不声明 `range`"，且 `normalizeShadowMapSize`（:442 setter /
  :557 恢复侧双侧同装）已是白名单守卫。**该键无 range 是有意豁免，非缺陷。**
- **证据**：`clampFieldValue`（`env-state-schema.ts:946-947`）对无 `range` 键 `return value` 原样透传；
  `clamp(NaN) → range.min`（`utils/base/pure/clamp.ts:12`）——补 range 后 NaN 脏档会钳到下界。
- **硬依据（非纯理论）**：`skyMieDirectionalG` 走 three 官方 `hgPhase`
  （`three 0.186.1/examples/jsm/objects/Sky.js`：`ONE_OVER_FOURPI * (1-g²) * 1/pow(1-2g·cosθ+g², 1.5)`），
  three 对该参数**无任何 range**、shader 内 clamp 只用于太阳角几何量 ⇒ **|g|>1 时 `1-g²` 变负 →
  天空出负光强/NaN**。这是补钳制的实锤，不是理论防御。
- **已处置（本批 P1 刀）**：10 键全部补 `range`，域取 three 官方物理语义 + 容纳本项目生产写入值
  （各默认值均在域内，零行为漂移）；`shadowMapSize` 在 schema 处**显式登记豁免理由**（防后人误补区间）。
  新增专项锁 `env-state-schema.test.ts`「值域补钳制（锐评 2026-10-09）」6 例，含 `skyMieDirectionalG`
  钳到 [-1,1] / NaN 落 min / `shadowMapSize` 豁免不被误补。
- **遗留**：`envResolution` 语义为 2 的幂档位，本批只补区间防超域，**完整枚举化另议**（不改 schema 类型）。

### P1｜两个 meta 闸两轮"拟议"后依然零落地

- **证据**：glob 全搜 `*contract*.test.ts` 无 `persist-roundtrip-contract` / `cap-dispose-reset-contract`；
  grep 全仓仅 4 处命中，全在既有锐评散文里标"待拍板/零实施"。
- **这是跨两轮、跨两域（caps ↔ 宿主）反复出现却始终未收口的治理欠账**：`check-dom-boundary.ts` 同样不存在（已决策不落，另说）。
- **建议**：二选一——落地（枚举 registry cap id × 契约存在性，基线只减不增）或**显式书面豁免**；
  **维持"拟议中"漂浮是第三种成本**（既有锐评原话，本轮仍成立）。

### P2｜`registerEnvStateMiddleware` 退订返回被丢弃，`unregister` 生产侧从未使用

- **证据**：唯一生产注册点 `ground-capability.ts:92`（模块顶层），返回值（退订闭包）**被丢弃**；
  `clearEnvStateMiddlewares`/`unregister` 生产零调用（仅 `env-state.test.ts`）。
- **定性**：`unregister` API 形同虚设——**机制已提供，接线未发生**。与"立法无机器闸"同根。
- **建议**：要么 ground 保存句柄并在 dispose 调用，要么文档化"模块级单次注册不可卸载"。
  ⚠️ 地面中间件为模块级单次注册，无运行时重复注册路径，故**非现症**，属 API 与使用脱节。

### P2｜`WAVE_STEEP_SIZE_REF=80` 硬编码，与 `waterSize.default=80` 双源

- **证据**：`water-state.ts:51` 硬编码 `80`，注释自陈"必须与 schema 同值（守卫 = 测试断言两者相等）"；
  对照 `env-state-schema.ts:342 waterSize.default=80`。
- **定性**：靠**测试**而非**派生**守卫——正是 `bd65c02f` 常量双源病。测试绿 ≠ 单一事实源。
- **建议**：改为派生 `ENV_STATE_SCHEMA.waterSize.default`，删口头契约。
  同族：`water-state.ts:64 FILM_WETNESS_ALPHA_BASE=0.25` 与 `waterOpacity` 默认数值重合（隐藏数值耦合）。

### P2｜fog/reflector 残留冗余双写口（死 API）

- **证据**：`fog-capability.ts:133 setEnabled` 与 `:165 setEnabledFog` **写完全相同**的 `{fogEnabled:v}`、
  source 同为 manual；生产菜单走 `setEnabled`（`fog-menu.ts:25`），`setEnabledFog` 仅 `fog-capability.test.ts` 消费。
  reflector 同型（`:180 setEnabled` vs `:213 setEnabledReflector`）。
- **定性**：命名别名残留。无害但会让后来者困惑"两个 setEnabled 有何区别"——答案是没有。
- **建议**：删冗余别名，测试迁移到主 API。

### P2｜`lightVolumetricBaseStrength/TipStrength` 无 range + 无 UI 直写出口 + 测试显式 EXEMPT

- **证据**：两键在 schema（`:819-820`）无 `range`（故 `RangedKey` 编译期守卫让菜单**无法合法引用**）；
  菜单用**派生** `setVolumetricTipRatio`（`light-controls.ts:351`）；测试显式豁免
  `EXEMPT = new Set(["lightVolumetricBaseStrength"])`（`light-capability.test.ts:910`）。
- **定性**：显式挂账的中间态，注释与测试均论证充分，**非病**——但"base 用户永远改不了、恒 0.9"这一
  事实未在 UI 明示，属"参数面 ⊋ 控件面"的已豁免残留。

### P2｜`RESTORE_SOURCE = {source:"auto-model"}` 四处手抄

- **证据**：`env-persist.ts:29` / `ground-capability.ts:117` / `sky-capability.ts:836`（本地名 `RESTORE`）/
  `water-persist.ts:23`——四处字面量相同。
- **定性**：常量双源。语义恒等仍各写一份，改一处漏四处即静默漂移。
- **建议**：下沉 `persist-utils.ts` 公共叶（water-persist 已导出，ground/sky 仍本地抄）。

### P2｜ground 是唯一"写侧派生、读侧手写"的 cap

- **证据**：`saveState:799` 用 `getPresetKeys("ground")` 派生；`loadState:816-888` 却是手写 `restoreFields` 27 键 spec。
- **定性**：卡文自陈"写侧自动、读侧不自动"（`:786-787`）且"留作后续"（`:190`）——**已登记但未兑现**。
  现有 `[G-8]` 契约锁兜底，非现症。
- **建议**：对齐 `water-persist.ts|restoreWaterSchemaKeys` 下沉为 `restoreGroundSchemaKeys`，消结构性不对称。

### P2｜`applyModelPreset` 契约不齐

- **证据**：有 `applyModelPreset`：sky/fog/shadow/reflector/environment/pp（6 cap）；
  **无**：light（测试显式断言 `toBeUndefined`，`light-capability.test.ts:334`，ADR-282 已退役）/
  ground/water（**无论证注释**）。`shared-infra.ts:58-75 applyModelDefaults` 只编排 5 cap（pp 在装配链另调）。
- **定性**：light 退役有注释论证（"灯光是场景属性，Three 层无模型类别"），**该理由同样适用于 ground/water**——
  故缺席可能是**有意但缺注释**，非硬 bug。若 `MODEL_DEFAULTS` 日后加 ground/water 键则无落点。
- **建议**：补一条注释论证"ground/water 按 ADR-282 同法解耦"，或立项纳入。

### P2｜4 个 >900 行主 cap，ground 混职最重

- **证据**：sky 951 / light 952 / pp 953 / ground 942；ground 含渲染 + 像素生成 + 材质预设表 +
  **DOM 文件选择器** `openTexturePicker`（`ground-capability.ts:563-583`，`createElement("input")` + `URL.createObjectURL`）+ 持久化 + 迁移。
- **建议**：ground 优先拆（DOM 选择器移菜单/control 层、像素与预设表下沉），对齐 light/water 已完成的
  `*-persist.ts`/`*-params.ts` 先例。

## 四、既有锐评"仍活"复核（亲验）

| 条目 | 现源码锚点 | 状态 |
|---|---|---|
| P2-1 tone 不对称 | `sky-capability.ts:906-921 releaseTone` 盲还原（仅靠 `toneRefCount cnt<=1`）；`pp:581-599` 反而有逐字段归属判定 | ⚠️ **仍活**，且**薄弱侧是 sky 不是 pp**（既有锐评未点明方向） |
| P3-2 StatePath 双模块同名符号陷阱 | `env-state.ts:131/138` 的 `getStateValue/setStateValue` 生产零调用，仅 `env-state.test.ts` 消费；生产走 `preview-state.ts` 同名函数 | ⚠️ **仍活** |
| ground 私有 `this.enabled` 僵尸门 | `ground-capability.ts:164 this.enabled = opts.enabled ?? true`（真字段，非 getter），8 处使用，`:400 setEnabled` 生产零调用（仅测试） | ⚠️ **中间态**：`:788-796` 已删持久化、`:795` 明示"另立 ADR"——**有意挂账，不夸大** |
| `renderer.toneMapping` 多写者 | sky:369/910 + pp:569/592 + `screenshot-render.ts:167` | ⚠️ sky 有 refCount 回滚、pp 有归属判定、截图走离屏 Scene——**各自闭环，靠守卫而非单一属主** |

## 五、子代理误判订正（主模型直读仲裁）

1. **②号（caps）报"pp 无守卫直写 toneMapping"** → ❌ 驳回。`postprocessing-capability.ts:591-598` 有逐字段归属判定
   （toneMapping 与 outputColorSpace 各自 `===` 判断才归还）。**薄弱侧在 sky**，与 pp 无关。
2. **①号（状态层）报"`getStateValue/setStateValue` 有 5/6 个生产消费文件"** → ❌ 驳回。所列消费方
   （settings.ts / perf-presets.ts / rows.ts）import 的是 **`preview-state.ts`** 的同名函数；
   `env-state.ts:131/138` 版本**仅测试消费**——正是既有锐评 P3-2 描述的陷阱，①号自己也踩了。
3. **②号（caps）"ground `this.enabled` 僵尸门"** → ⚠️ 定性从"新病"下调为"已登记中间态"。
   `ground-capability.ts:788-796` 注释明确"已删持久化 + 有意为之 + 真根治另立 ADR"，
   与既存知识卡一致。**不列为新 P1**。

## 六、知识卡漂移（③号发现，主模型亲验）

1. **`restoreFields` 归属错挂**：`preview-env-state.md:178/:198` 称"`scene-capability.ts` 三件套
   `persistState/restoreState/restoreFields`"。实测 `persistState:194`/`restoreState:208` 确在
   `scene-capability.ts`，但 **`restoreFields` 在 `persist-utils.ts:97`**（`persist-utils.ts:5-6` 自陈
   scene-capability 只留接口 + localStorage IO）。
2. **"仍留旧键形：ground/environment"过时**：`preview-env-state.md:183` 列 environment 为"仍留私有态/旧键形"，
   实测 env 已随 ADR-292/326 收口（`environment-capability.ts:13/:171/:298` 三处注释 + 代码无 `this.enabled`）。
   ⚠️ ③号另称"sky 被漏列进已收编名单"——**不成立**，卡 :183 明写"sky 亦已收口"。卡文滞后限 ground。

## 七、最该改的优先级

| # | 条目 | 定级 | 理由 |
|---|---|---|---|
| 1 | 10 个非颜色 number 键补 `range`（`shadowMapSize` 豁免并显式登记） | **P1 · 已处置** | `skyMieDirectionalG` 走 hgPhase，\|g\|>1 出 NaN（硬依据）；NaN 脏档 `clamp→min` |
| 2 | 两个 meta 闸二选一（落地 / 显式豁免） | **P1** | 跨两轮反复"拟议"却零实施，漂浮成本最高；fogColor 漏键即活靶 |
| 3 | `RESTORE_SOURCE` 四处手抄下沉 `persist-utils.ts` | P2 | 常量双源，改一处漏四处即静默漂移 |
| 4 | `WAVE_STEEP_SIZE_REF=80` 改派生 + 删测试守卫 | P2 | 测试绿 ≠ 单一事实源 |
| 5 | ground `saveState/loadState` 读侧下沉为 `restoreGroundSchemaKeys` | P2 | 对齐 water-persist 先例，消结构性不对称 |
| 6 | 删 fog/reflector 冗余 `setEnabledFog`/`setEnabledReflector` 死 API | P2 | 低风险去噪 |
| 7 | ground `openTexturePicker` 移出 cap + 主 cap 继续拆 | P2 | >900 行 + DOM 文件选择器混职 |

## 八、方法论补录

1. **子代理结论必须主模型直读仲裁**——本轮两处误判（pp tone 归属、`getStateValue` 消费方）均被直读纠正，
   若直接采信会把"薄弱侧在 pp"和"死导出已清理"两个错误结论写进档案。
2. **同名函数是陷阱**：`env-state.ts` 与 `preview-state.ts` 各有 `getStateValue/setStateValue`，
   grep 计数合并即误判——**判别式 = 看 import 来源，不看函数名**。
3. **"已修"也要亲验**：既有锐评自己承认过"自始失真"（P2-3），故本轮对 dispose 复位逐行亲验，
   确认 5/5 实闭后才采信。
4. **既有锐评未点名的面仍值得扫**：无 range 数值键既有锐评从未提及（本轮实测 10 个真缺陷 + 1 个
    `shadowMapSize` 豁免），说明"治得狠"不等于"扫得全"。

## 九、落地与改判（2026-10-09 收敛，落地前置）

> **本节是执行真相**。§三的判定是审计快照，本节记录落地时逐条直读源码+知识卡后的最终结论——
> **多条"应改"在落地前置被源码/知识卡否决**，这是审计的价值（避免把设计当缺陷改掉）。

### ✅ 已落地（1 条，commit `ba5cbdc5c`）

| 条目 | 证据 / 处置 |
|---|---|
| P1 补钳制 | 10 个原无 range 数值键补 `range`（`skyTimeOfDay`/`skyTurbidity`/`skyRayleigh`/`skyMieCoefficient`/`skyMieDirectionalG`/`skyExposure`/`envResolution`/`reflectorClipBias`/`lightVolumetricBaseStrength`/`lightVolumetricTipStrength`），域取 three 官方物理语义 + 容纳本项目生产写入值；`shadowMapSize` 豁免理由显式登记；新增专项锁 6 例。**门禁全绿，零行为漂移**（各默认值均在域内）。 |

### 🔄 改判（撤销"应改"，落地前置发现为有意设计）

| 原判 | 改判理由（源码+知识卡实证） |
|---|---|
| P2 删 `setEnabledFog`/`setEnabledReflector` 死 API | ❌ **撤销**。`preview-env-state.md:257` 明写"`setEnabledReflector` 保留，与 fog `setEnabledFog` 双件同法"——**知识卡登记的有意保留**（F-1 收口时保留的命名对称）。删会违背已采纳设计 + 触发 drift。源码侧缺本地注释是轻度文档-代码不对称，非删的理由。 |
| P2 `RESTORE_SOURCE` 四处手抄下沉 `persist-utils.ts` | ❌ **撤销**。知识卡 `:200` 明写"`ground-capability.ts|RESTORE_SOURCE` 把恢复来源收敛成**单一常量**"——是各 persist 叶**自持范式**。且 `persist-utils.ts` 曾被"暗特化"污染除名（P3-1：`startsWith("water")` 后门类），下沉会重蹈覆辙。 |
| P2 `WAVE_STEEP_SIZE_REF=80` 改派生 | ❌ **撤销**。`water.md:111/:287` 详细论证它是**水波水平摆动反归一的有意基准**（基准必须固定为 schema 默认 80，不能随用户 waterSize 变），`:111` 还警告"别为让两端完全相等去突破自交上界"。`routes-quick.md:1222` 同述。改派生违背设计意图。 |
| P2 ground 读侧手写 27 键 | ⏸️ 知识卡 `preview-env-state.md:190` 已**显式登记"留作后续"**（"改造收益小风险不小"）——是有意挂账，非漏判。 |
| `envResolution` 枚举化 | ⏸️ 本批只补区间防超域；**完整枚举收编另议**（不改 schema 类型，避免污染 `_FieldDef`）。 |

### 🔍 需要评估结论（2026-10-09 二轮：落地前置判断"是否需要"）

**两个 meta 闸：不需要**——这是既有锐评两轮的建议，但经落地前置直读源码后否决。

**反证（决定性）**：`fog-capability.test.ts:154` 已有"saveState / loadState 完整周期"例，
meta 闸（枚举 registry cap id × 断言"有无 round-trip 例"）会判定 fog"有契约"而**放行**。
但该例是**手写枚举** 6 键（:155），注释 :168 自陈"手写枚举漏键活证据收口"——**schema 加新
fog 键必漏**（fogColor 已实证漏过）。**meta 闸在此完全无判别力**（假绿），只会让后人误以为
"有闸罩着"而松懈。

**真防线是逐键 schema 派生锁**（对齐 ground [G-8] :1265 / water [D3] / env [P1-5]）：
用 `getPresetKeys("fog")` 派生键集 + `missing = schemaKeys.filter(未登记偏离值)`——**加键即红
并点名**。已变异实证（临时注入未登记 fog 键 → missing 点名）。

- ✅ **已落地**：`[G-fog]` 派生锁（`fog-capability.test.ts`），48 例全绿，变异实证通过。
- ⏳ **待补**：reflector / shadow / light / render-mode 仍只有**手写枚举**完整周期例（各自 test 的
  "saveState / loadState 完整周期"），**加键会漏**——同法补派生锁即可，改动小、低风险。
- ❌ **`cap-dispose-reset` meta 闸**：价值更低——dispose 复位已 5/5 实闭 + 各家有锁，仅防"未来新
  cap 漏复位"，收益低、判别力同受"存在性"局限。

### ⏳ 仍待拍板（架构级，不在本批动）

ground 主 cap 拆分（>900 行 + DOM `openTexturePicker`）、`applyModelPreset` 契约补齐（light 已退役、
ground/water 缺注释论证）、`registerEnvStateMiddleware` 退订句柄接线。

### 📌 执行教训

1. **"看起来该改" ≠ "真的该改"**——本轮 4 条 P2 建议在落地前置全部被源码+知识卡否决。
   若直接改，会**违背已采纳设计 + 触发 `check-knowledge-drift` 红**，把审计从"治病"变成"引入病"。
2. **锐评的价值是"改对了多少"不是"改了多少"**——只落地 P1（有 hgPhase NaN 硬依据、知识卡未登记豁免）
   是比"改 5 条"更负责任的执行。
3. **知识卡是"有意设计"的登记簿**——凡知识卡写明"保留/自持/留作后续"的，落地前置必须核对，
   不能只凭"字面重复"就判为缺陷。本报告 §三 的多条 P2 即因此误判，已在 §九 订正。