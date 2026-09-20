# ADR-283：参数值域描述符：schema 承载 range/uiRange，钳制收口 setEnvState 唯一写入口

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理（deepseek）
- **相关**：`frontend/src/preview-3d/state/env-state-schema.ts`（`NumericRange` / `range` / `uiRange` / `clampFieldValue` / `getParamRange` / `RangedKey`）、`env-state.ts`（唯一写入口钳制）、`caps/water-menu.ts`（滑杆取值域）、`caps/water-capability.ts`（setter 去手写 clamp）、`caps/water-body-strategies.ts`（`clampPoolRoundness` 归一）；延续 **ADR-196**（envState 单一事实源）、**ADR-249 §2.6**（默认值单一事实源——本次把同一判例延伸到值域）、**ADR-272 §5**（接线收口第一批）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

一个 envState 参数，从「声明」到「落地」要经过六处接线：schema 默认值 → 菜单控件字面量 → setter 钳制 → 派发分支 → 持久化写键 → 持久化读别名。ADR-272 §5 已收口其中三处（键域类型化 / 持久化派生化 / uniform 写口），**值域**是剩下的最典型一族——它同时散在三个地方：

1. **菜单 slider 的 `min` / `max` / `step` 字面量**（每个 cap 的 menu 文件各写一份）；
2. **setter 里的手写 clamp**（`Math.max(0, Math.min(1, v))`、`Math.max(0.01, v)`、`Number.isFinite(v) ? … : 1`……形态各异）；
3. **cap 内部的域常量**（`water-body-strategies.ts` 的 `POOL_ROUNDNESS_MAX = 0.5`）。

数量实证：`min:|max:|step:` 在 `frontend/src/preview-3d/` 下 **287 处命中，散在 8 个 menu/controls 文件**（water / ground / fog / environment / light / postprocessing / reflector）。

`water-menu.ts` 的注释甚至为这一重复**写过自辩**：「菜单侧的同名域刻意以字面量重复，因为 `water-menu.ts` 是零 THREE 依赖的纯声明层，从本文件取值会把 THREE 拖进声明层」——该顾虑经本次核实**不成立**（见 §4），于是这条自辩从「设计」退化为「债的遮羞布」。

后果有二：改一处值域要改三处，漏改即产生「菜单给得出、写入被钳掉」的静默错位；且实际渲染读哪一份取决于路径（setter 与菜单各读各的），与 **ADR-249 §2.6** 记录的地面默认值双源事故（`matGridSize` schema 写 10、spec 写 8，实际渲染读 spec → schema 侧成死值）**是同一种病**。本仓对该族已有既定法度，值域只是尚未收编的下一族。

## 2. 决策（Decision）

### 2.1 schema 成为值域的唯一事实源（`NumericRange`）

`env-state-schema.ts` 的字段描述符在 `{ type, default, group }` 之外新增：

- `range: { min, max, step, unit? }`——**合法域**；
- `uiRange?: { min, max, step, unit? }`——**展示域**（缺省 = `range`）。

只声明在 `type: "number"` 字段上（类型层面用条件交叉约束，与既有 `enum → values` 同款）；**颜色虽是 number 但不声明**（无值域语义，钳它即错）。`step` 设为**必填**——值域的实际消费者是滑杆，给缺省步长等于再埋一个隐藏事实源。

### 2.2 合法域与展示域分离（ergonomic ≠ legal）

两者是不同语义，合并会二选一亏：

- `range` 是**写入钳制边界**（物理/不变量保护）；
- `uiRange` 是**滑杆行程的手感设计**。

`waterSize` 是标本：合法下界 **1**（0/负数会让水面退化成一个点），但滑杆展示域是 **10–300**（默认 80 居中，`step=1` 拖满 290 步）。合并成一个域就得在「299 步行程、常用区挤在 3%」与「放开 1 让用户能把水面缩成一个点」之间二选一。

### 2.3 钳制收口 `setEnvState` 唯一写入口

`clampFieldValue(key, value)` 在**唯一写入口**对每个待写键取值域钳制。于是 setter / 存档恢复 / 预设套用 / 中间件产物**四条路径一次性就范**，各 cap 不再自备 clamp（`water-capability.ts` 的 11 个 setter 因此各自退化为一行 `setEnvState({...}, { source: "manual" })`）。

`clampPoolRoundness` 不再持有自己的常量，改为 `clampFieldValue("waterPoolRoundness", v)` 的读口——它服务的「构建期与运行期必须共用同一钳制」由此从「两处手抄同一数字」升级为「两处调用同一事实源」。`applyTransformLinks` 里的 `Math.max(0.01, h/t)` 同款归一。

### 2.4 读口类型化，让「没声明值域」编译期就红

- `getParamRange(key: RangedKey)`——`RangedKey` 是「声明了 `range` 的键」的派生联合，**未声明值域的键根本传不进这个函数**；
- 守卫测试三条：描述符自洽（`min ≤ default ≤ max`）、water 组滑杆字段全覆盖、**菜单滑杆值域 === schema 值域**（这条是「菜单不再是第二事实源」的结构证据）。

### 2.5 范围：机制通用，本次只迁 water 组

机制做成全局能力；本次只把 water 组的 11 个滑杆字段填满。其余 9 组遵守「只减不增」，顺手迁移——避免一次性 ~15 文件的大改动。

### 2.6 明确不做：apply 分派表

`applyChangedParams` 的逐键 `if` 链（→ 表 + 编译期完备检查）是**另一个病灶**，与值域无耦合，拆独立 ADR。

## 3. 后果（Consequences）

### 正面

- **改值域一处生效**：schema 改 `waterPoolHeight.range.max`，滑杆行程与写入钳制同时跟着走。
- **菜单文件里再没有一个数值字面量**：11 个 `wSliderNode` 的第 3 参全部是 `getParamRange("…")`。
- **「绕不过去」是结构性的**：非 setter 路径（存档 / 预设 / 中间件 / `setStateValue`）曾被逐个补钳，如今由写入口统一承接，不再依赖调用方自觉。
- **两处历史自辩清零**：`water-menu.ts`「刻意重复字面量」的注释与 `POOL_ROUNDNESS_MAX` 的私有常量一并退场。

### 负面

- 每次写入多一次 schema 查表 + 类型判断（O(1)，可忽略）。
- `step` 必填：未来若出现「有值域但无滑杆」的字段，也得给步长——有意为之（避免隐藏默认值）。
- menu 新增一条对 `state/` 的运行时依赖边（此前只有 `menu/panels/env.ts` 等零星几处）。已核实分层放行（§4）。

### 风险

- **裸改绕过**：`envState.waterX = v` 这种直接改对象的写法仍绕过钳制。已知旁路（`applyTransformLinks`、`clampPoolRoundness`）保留兜底钳制；其余靠"setter 是唯一写路径"的既有约定。
- **上界首次真正生效**：`waterLevel`(5) / `waterWaveSpeed`(3) / `waterSize`(300) 此前 setter 只管下界。脏存档里超过上界的值会被钳到上界——属「合法域」语义，观感影响可忽略。

### 已知遗留

- 其余 9 组的值域尚未收编（只减不增，顺手迁移）。
- 菜单 `unit` 文案与 i18n、`min`/`max` 的语义化标签（如「池深」范围）尚未关联。
- apply 分派表待独立 ADR。

## 4. 数据溯源

- **起点**：2026-09 锐评「一处参数六处接线」→ ADR-272 §5 收口第一批（键域类型化 / 持久化派生化 / uniform 写口）→ 本次收口**值域**族。
- **推翻顾虑的依据**（本次关键核实）：`water-menu.ts` 自称「取 schema 会把 THREE 拖进声明层」不成立——`env-state-schema.ts` 运行时 THREE-free：其依赖 `caps/ground-surface-spec.ts` 的 three 是 `import type * as THREE`（运行时擦除），且 `caps/surface-pixels/` 零 three 命中。
- **分层依据**：`check-layering` R7 只约束 `preview-3d/menu/` **内部子层**排序；menu → state 的运行时边既有且合法（`menu/panels/env.ts` 已 import `state/env-state.ts`）。
- **判例依据**：ADR-249 §2.6 默认值双源事故（地面默认值两处声明且不一致，渲染读 spec、schema 侧成死值）——同一法度延伸到值域。
- **数量实证**：`min:|max:|step:` 在 `frontend/src/preview-3d/` 下 287 处命中 / 8 文件。
- **验证**：`env-state.test.ts` + `env-state-schema.test.ts` + `water-capability.test.ts` 共 **141 例全绿**（新增 12）；改动文件 `tsc --noEmit` 零错；`npx vite build` ✅；`check-biome --files … --write` ✅。
