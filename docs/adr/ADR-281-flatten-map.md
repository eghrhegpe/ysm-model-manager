# ADR-281：灯光字段全集单一真相源：FLATTEN_MAP 派生读/变更集/预设挑参/持久化

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：
  - `frontend/src/preview-3d/caps/light-presets.ts`（真相源 `FLATTEN_MAP` + 派生出入口）
  - `frontend/src/preview-3d/caps/light-capability.ts`（消费：变更集 / 读参数 / 预设挑参）
  - `frontend/src/preview-3d/caps/light-persist.ts`（消费：持久化字段表）
  - `frontend/src/preview-3d/caps/light-presets.test.ts`（契约测试：往返 + 直读双向锁定）
  - ADR-196（参数真值源迁 envState——本 ADR 是其在**映射层**的收尾）
  - ADR-280（三灯统一实例——本 ADR 的直接前置：统一后字段集才真正同构，派生才有可能）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

ADR-280 把 key/fill/rim 统一成同构的三盏灯实例（`LightInstanceParams` 10 字段）之后，
暴露出一个 ADR-177 拆分时就埋下、被「三灯不统一」掩盖的债：

**同一个字段全集（10 字段 × 3 槽位 = 30 条 envState 键）在 5 处被独立复述，其中只有 1 处有编译期锁。**

| # | 位置 | 形态 | 编译期锁 |
|---|------|------|----------|
| 1 | `light-presets.ts` `FLATTEN_MAP` | 嵌套 → 扁平映射表 | ✅ `as const satisfies {…: keyof EnvState}` |
| 2 | `light-capability.ts` `LIGHT_FIELDS` + `lightChangeSet` | 后缀数组拼 `${prefix}${suffix}` | ❌ 裸 `as const`，拼串键不入 `keyof` 检查 |
| 3 | `light-capability.ts` `applyModelPreset` | 36 行手写键字面量喂 `pickModelDefaultFields` | ❌ 裸字面量 |
| 4 | `light-persist.ts` `LIGHT_FIELDS` | 持久化短名 → 后缀 + typeof 守卫 | ⚠️ `satisfies Record<string, …>` 值域太宽 |
| 5 | `light-capability.ts` `readLightParams` | 10 行 `${prefix}${X}` 拼串 + **两层 `as`** | ❌❌ 类型系统全程缺席 |

新增一个灯光字段需要同时改 4 处，且**三处失守都是静默 bug**：

- #3 漏配 → `applyModelPreset` 切模型时该字段不更新（用户看不到任何报错）。
- #5 漏读 → `createLight` 收到 `undefined`，运行时 NaN 或崩。
- #2 漏集 → 该字段的变更不触发 `syncLight`，滑块拖了没反应。

而 #5 最不可接受：`state[\`${prefix}Type\` as keyof EnvState] as LightInstanceParams["type"]`
是第一层 `as` 让 TS 闭嘴（拼串键天然不是 `keyof`）、第二层 `as` 把 `EnvState[keyof]`
（number/string/boolean 并集）强行当成具体类型。**两层 `as` 叠加后，schema 放宽
`lightKeyType` 也不会在此报错，但 `createLight` 会当场收到非法 type。**

讽刺的是：`FLATTEN_MAP` 本身就是「字段全集 × envState 键」的穷尽真相源，它已经用
`satisfies` 锁死了拼写与穷尽性，其余四处全是它的可派生副本——模块头注释高喊「单一事实源」，
却只对其中一处身体力行。

## 2. 决策（Decision）

### D1：`FLATTEN_MAP` 升格为灯光字段全集的唯一真相源，其余四处改为派生

在 `light-presets.ts` 增设派生出口（全部由 `FLATTEN_MAP` 计算，零手抄）：

```ts
export const LIGHT_SLOTS = ["key", "fill", "rim"] as const;
export type LightSlot = (typeof LIGHT_SLOTS)[number];

/** 槽位 → 该槽位全部 envState 键 */
export function lightEnvKeys(which: LightSlot): (keyof EnvState)[];

/** 三盏灯全部 envState 键（预设挑参范围） */
export const LIGHT_ENV_KEYS: (keyof EnvState)[];

/** 体积光全部 envState 键 */
export const VOLUMETRIC_ENV_KEYS: (keyof EnvState)[];

/** envState → 单盏灯参数（flattenLightParams 的逆方向） */
export function readLightParams(state: EnvState, which: LightSlot): LightInstanceParams;
```

### D2：`readLightParams` 去掉双层 `as`——字段名取自映射、类型由返回类型反向校验

```ts
export function readLightParams(state: EnvState, which: LightSlot): LightInstanceParams {
  const m = FLATTEN_MAP[which];
  return {
    type: state[m.type],
    enabled: state[m.enabled],
    // …10 字段
  };
}
```

为什么这比「动态遍历 `Object.entries` + 末尾 `as`」更好：

- `m.type` 的类型是 `"lightKeyType" | "lightFillType" | "lightRimType"`（映射的**字面量**
  类型），它必须是 `keyof EnvState`——由 `FLATTEN_MAP` 的 `satisfies` 保证。**键拼写有锁。**
- 返回值标注 `LightInstanceParams`：任一字段值类型不符即编译报错。**值类型有锁。**
- `LightInstanceParams` 新增字段而此处漏写 → 返回值不完整 → 编译报错。**穷尽性有锁。**

动态遍历看似「更 DRY」，但索引结果只能退化为 `EnvState[keyof EnvState]` 并集，
必须靠末尾 `as LightInstanceParams` 强转——那正是要被消灭的东西。
**「10 行显式但三重编译期锁」胜过「3 行遍历 + 1 层 as」。**

### D3：变更集 = `lightEnvKeys`，不再拼串

`lightChangeSet(which)` 由「后缀数组 + `${prefix}${f}` 拼串」改为
`new Set(lightEnvKeys(which))`——变更集直接是映射的值集合。

### D4：`applyModelPreset` 挑参范围由映射派生

<!-- ⚠️ 本节已被 ADR-282 取代（2026-09-20）：applyModelPreset 整体退役，灯光与模型类别解耦；
     LIGHT_ENV_KEYS / VOLUMETRIC_ENV_KEYS 随之删除。以下为决策当时记录。 -->

36 行手写键字面量 → `[...LIGHT_ENV_KEYS, ...VOLUMETRIC_ENV_KEYS]`。
「不含 ambient」的既有契约（切模型不静默重置用户 ambient 微调）由
`LIGHT_ENV_KEYS` 只覆盖 `LIGHT_SLOTS` 天然保证，并有测试锚定。

### D5：`light-persist.ts` 字段表收紧到 `keyof LightInstanceParams`

`LIGHT_FIELDS` 的 `satisfies Record<string, …>` → `satisfies Record<keyof LightInstanceParams, …>`：
持久化结构用的是短字段名（`type`/`angle`…）而非 envState 键，无法从 `FLATTEN_MAP` 直接派生，
但可以**锁死到同一个字段全集**——`LightInstanceParams` 加字段而表未补即编译报错。

### D6：三槽位字面量数组统一走 `LIGHT_SLOTS`

`setTarget` / `setTargetHeight` / `getSpotLightForCone` / `loadState` 四处
`["key","fill","rim"] as LightKey[]` 收敛为 `for (const which of LIGHT_SLOTS)`；
`LightKey` 保留为 `LightSlot` 的别名（本模块历史名，减少调用面改动）。

### D7：契约测试双向锁定

- **正向**：`flattenLightParams` 30 条映射逐键断言（既有）。
- **反向**：`readLightParams` 直读锁定——逐键写唯一值后断言读回值，任何「读错键」表现为串位。
- **往返**：三槽位取互不相同值，`flatten → setEnvState → read` 逐字段等价。
- **覆盖度**：`lightEnvKeys` 每槽位 10 键；`LIGHT_ENV_KEYS` = 30；不含 ambient。

> 只做往返是不够的：若 `flatten` 与 `read` 有**同一处**错接线，往返仍会通过。
> 因此必须另有「直读 vs 字面量 envState 键」与「flatten vs 字面量键名」两条独立断言。

## 3. 后果（Consequences）

### 正面

- **新增灯光字段改一处**：只在 `FLATTEN_MAP` 与 `LightInstanceParams` 各加一行，
  读参数 / 变更集 / 预设挑参 / 往返测试全部自动跟上；漏改会编译报错而非静默失效。
- **双层 `as` 退场**：`readLightParams` 现在是全链路类型安全的（键拼写、值类型、穷尽性三重锁）。
- **变更集不再可能漂移**：与读方向同源，不存在「读了能生效但不触发同步」的失配。
- **`FLATTEN_MAP` 的 `satisfies` 从「单点自律」升级为「全局宪法」**——它现在真的唯一。

### 负面 / 代价

- **`applyModelPreset` 的挑参顺序改变**：由「手写键序」变为「`FLATTEN_MAP` 声明序」。
  写入的键集合不变，但 `setEnvState` 的 change-set 迭代顺序随之变化——
  对逐键独立生效的灯光参数无影响，但若有新增消费者依赖顺序需复核。
- **`readLightParams` 仍显式列出 10 个字段**：这是刻意的（见 D2 理由），
  代价是该函数在字段数增长时行数线性增长。三盏灯共用同一函数，故总成本仍是一份。
- **导出面扩张**：`light-presets.ts` 新增 5 个导出（`LIGHT_SLOTS` / `LightSlot` /
  `lightEnvKeys` / `LIGHT_ENV_KEYS` / `VOLUMETRIC_ENV_KEYS`）+ 1 个函数迁移
  （`readLightParams` 从 `light-capability.ts` 迁出，由该处薄包装转发）。经
  `light-capability.ts` 的 `export *` 对外仍零改动。
- **持久化字段表无法完全派生**：它映射的是持久化短名（存档契约，跨版本稳定）而非
  envState 键，只能做「字段全集一致」的锁，不能复用 `FLATTEN_MAP`。

### 已知遗留

- `light-capability.ts` 的 `export * from "./light-presets.ts"` 仍是转发桶
  （同一符号两处合法入口）。ADR-177 拆分早已落地，其中转历史使命已完成；
  清理需先把 `screenshot-lights.ts` 的 `DirectionalLightParams` / `attenuateAmbientForSky`
  import 改指具体叶，再确认无其他消费者。
- `applyModelPreset` 的 `manualPreset` 字段与 `source: "manual"|"auto-model"`
  双重表达「手动优先」的问题不属本 ADR 范围（属 ADR-126 P5 的语义面）。
- `loadState` 步骤②`restoreLightParams` 内部 `setEnvState` 会**同步重入** `onEnvChanged`，
  使步骤③的 `syncLight` 对同一盏灯跑两遍（第二遍走「类型已对上 → 原地更新」分支，
  幂等但浪费）。理想修法是 loadState 期间挂起 callback，末尾统一应用一次；
  本 ADR 只要求注释显式说明该重入，不改变行为。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| ADR-177 拆分（light-presets / light-controls / light-persist / light-cone 四面拆出） | 字段全集随之在四处复述——本债的结构性成因 |
| ADR-280 三灯统一实例 | 三盏灯字段真正同构，派生才在类型上成立（D1 的前提） |
| AGENTS.md「通用化、统一、复用既有函数；引导用户走长治久安的方案」 | 选择全量派生而非只收 #5 单点 |
| 代码锐评（2026-09-20）：字段全集表达五遍、只有 `FLATTEN_MAP` 有 `satisfies` 锁 | D1–D5 的病灶清单 |
| `FLATTEN_MAP` 既有 `satisfies { [G in LightGroupKey]: { [F in keyof LightParams[G]]-?: keyof EnvState } }` | 升格为唯一真相源（D1 的合法性依据） |
| `applyModelPreset` 既有契约「不含 ambient，切模型不静默重置用户 ambient 微调」 | D4 用 `LIGHT_ENV_KEYS` 只覆盖 `LIGHT_SLOTS` 天然满足 + 测试锚定 |
| 持久化短名是**存档契约**（跨版本稳定），非 envState 键 | D5 只锁字段全集、不强求复用 `FLATTEN_MAP` |

<!-- 文件名: flatten-map.md → 实际文件 ADR-281-flatten-map.md -->
