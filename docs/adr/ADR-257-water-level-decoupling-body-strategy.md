# ADR-257：水面/容器解耦（`waterLevel`）+ 水体形态策略表（`WaterBodyStrategy`）

- **状态**：✅ 已采纳
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理（deepseek）
- **相关**：`frontend/src/preview-3d/caps/water-capability.ts` / `water-menu.ts` / `water-state.ts` / `scene-capability.ts`（`GROUND_LAYER_OFFSETS`）；`frontend/src/preview-3d/state/env-state-schema.ts`；新增 `frontend/src/preview-3d/caps/water-body-strategies.ts`；延续 ADR-255（Gerstner + 尺寸 uniform 化）、ADR-196（envState 单一事实源）、ADR-195（cap 直产菜单节点）

---

## 1. 背景（Context）

ADR-255（commit `6a25755c1`）已把 film 的 `waterSize` 改为 scale/uniform 驱动、不再重建几何，并升级到 Gerstner 波浪。**但「调水体高度」这件事仍然是锁死的**，且由此暴露出更深的结构问题。

### 1.1 现象：只有水池能调高度

| 位置 | 事实 | 后果 |
|---|---|---|
| `scene-capability.ts:169` + `water-capability.ts:261` | film 的 y 取自**写死常量** `GROUND_LAYER_OFFSETS.waterFilm = 0.01` | film 没有任何参数可抬升水面 |
| `water-capability.ts:271,279` | pool 的 `top.position.y = h`，其中 `h = waterPoolHeight` | 只有 pool 能把水面挪动 |
| `water-menu.ts:162` | `ground-pool-height` 挂 `visibleWhen: waterPoolOn` | film 模式下**连调高度的入口都不显示** |

于是用户想抬高水面 → 唯一路径是切到 pool → 被迫接受 1 池底 + 8 面墙 + 4 个无关的 `waterPool*` 参数。

### 1.2 根因：一个参数背了三种语义

`waterPoolHeight` 在 pool 里同时驱动：

1. **水面高度** → `top.position.y = h`（`:279`）
2. **墙体几何/池深** → `PlaneGeometry(geoSizeW, h, 4, 4)`（`:351`）与墙面定位 `h/2`（`:323-346`）
3. **光学厚度** → `thickness: max(0.01, waterPoolHeight * 0.5)`（`:110`）

经典 Overloaded Parameter。由此派生两个代价：

- **抬高 0.1 的水位要付「重建 9 个 mesh + dispose 全部材质 + 重算法线缓存」的代价**——因为墙几何依赖 `h`，`needsRebuild` 把 `waterPoolHeight` 列为重建键（`:77-78`）。而抬高水面本身**只需要改一个 `position.y` 标量**。
- 概念上「水面（surface）」与「盛水的容器（vessel）」被焊成一根绳上的死结，无法单独表达任一者。

### 1.3 扩展性：新增形态的改动面是散落的

实证（`grep -nE 'mode === |waterMode'` 于 `water-capability.ts`）：`this.water.mode ===` 散落 **6 处**（`:252, :467, :477, :483, :519, :533`）、`envState.waterMode ===` 另 **4 处**（`:397, :407, :408, :446`），外加 `WaterRenderBody` 判别联合（`:34-36`）、`WaterMode` 类型、`WATER_MODES` 数组、schema enum（`env-state-schema.ts:135`）、菜单 options（`water-menu.ts:92-95`）——**约 9 处**。每加一种形态要在 9 个地方打补丁（switch-scatter）。

另有更脆的隐性契约：参数应用靠 **mesh 名字字符串寻址**（`:485` `m.name === "ysm-water-top" || m.name.endsWith("-inner")`、`:501`、`:520-522`）。拼错即静默失效，编译器不吭声。

### 1.4 形态演化方向

已确认下一目标形态为 **海洋/大水面**：无边界延展、地平线透视、LOD 分级。这要求抽象层能容纳**不同的几何构造、不同的尺寸语义（有限 vs 无边界）、不同的世界坐标映射**，而非「换个平面尺寸」。

---

## 2. 决策（Decision）

### 2.1 概念重构：水面与容器是两个正交的东西

引入 **`waterLevel`** —— 所有水体形态共有的「水面世界 y 坐标」。与之相对，`waterPool*` 系列**收窄为纯容器属性**（描述盛水的器皿，不描述水面在哪）。

这条切分是本 ADR 的地基：**「让水面挪一挪」永远只应该是一项零成本操作。**

### 2.2 A 档：`waterLevel` 接线

- **schema**（`env-state-schema.ts`）新增 `waterLevel: { type: "number", default: 0.01, group: "water" }`。schema 为零 THREE 层，故**不使用** `GROUND_LAYER_OFFSETS.waterFilm` 常量而写字面量 `0.01`，注释标注其与 `GROUND_LAYER_OFFSETS.waterFilm` 同源（保持 film 历史观感不变）。
- **film**：`root.position.y = level` —— 替代写死常量。
- **pool**：`top.position.y = level` —— 不再等于 `h`。
- **`waterPoolHeight` 只管容器**：仅驱动墙几何与容器光学厚度（`thickness = h * 0.5`，语义重述为「容器内水的光程」）。
- **`waterLevel` 变更零重建**（既不进 `needsRebuild`，也不重取法线缓存）。
- **菜单**：新增 `ground-water-level` 滑块，**不带 `visibleWhen`** —— film 与 pool 下均可见。这是本次对用户最直接的收益，也是「必须在两种模式下同时露出」的硬要求。
- **存档迁移**：旧档无 `waterLevel` 键时——pool 用户取 `waterPoolHeight` 兜底（保持原有观感），film 用户取默认值 `0.01`（与旧硬编码一致）。迁移写在 `loadState`，走既有新旧键双轨惯例。

### 2.3 B 档：`WaterBodyStrategy` 策略表

新增 `frontend/src/preview-3d/caps/water-body-strategies.ts`（渲染轴，不在 core）：

```ts
interface WaterBodyStrategy {
  readonly id: WaterMode;
  build(ctx: WaterBuildContext): WaterBody;
  getTargets(body: WaterBody, role: WaterPartRole): THREE.Mesh[];
  applyLevel(body: WaterBody, level: number): void;
  applySize(body: WaterBody, size: number, mat: WaveMaterialHandle): void;
  needsRebuild(changed: Set<string>): boolean;
  readonly wetnessGated: boolean;
}
```

收敛规则：

- `WaterRenderBody` 判别联合退化为统一的 `WaterBody`（`root` / `top` / `dispose`）+ strategy 引用。
- `rebuildWaterContainer` / `findTopWater` / `syncWaterVisibility` / `applyChangedParams` 内的 9 处 mode 判断**全部改为查表**。
- mesh-name 字符串寻址替换为 `strategy.getTargets(body, role)`，`role ∈ { surface, wallInner, wallOuter, floor }`——编译期可查、可测。
- **新增形态 = 注册一个 strategy 对象，现有实现零改动**。

### 2.4 为海洋预留的接口约束

正因为目标是海洋，`applySize` / `applyLevel` **必须由 strategy 自己实现**，而不是 cap 里统一的 `root.scale.set(size, size, 1)`。理由：海洋的「尺寸」语义是「视距/LOD 环半径」而非「平面边长」，其几何也不一定是 `PlaneGeometry`。若把 size/level 的应用逻辑留在 cap 里，等于把通用路径钉死在 film 的假设上——那正是本次要解掉的病。

### 2.5 明确不做（`YAGNI`）

**C 档（surface/vessel 完全正交，各自工厂化）本次不做。** 在第三种形态真正落地之前抽象出独立的 `WaterVessel` 概念是凭空建模，无从验证接口是否被真正需要。本 ADR 记录该缺口及判断依据：待 `oceanStrategy` 落地时，若发现容器与水面确实需要独立组合（如「喷泉 = 水柱 + 圆形池」），再评估升级为 C 档。

---

## 3. 后果（Consequences）

### 正面

- 「调水位」在 film 下首次可用，且两种模式共享同一语义。
- 抬升水面从「重建 9 mesh」降为「改一个 `position.y`」，交互零卡顿。
- 新增形态的改动面从约 9 处降为 1 处注册。
- 参数寻址从字符串契约升级为可枚举的 `role`，消除静默失效。

### 负面 / 代价

- **自由组合可能产生视觉异常**：解耦后 `level` 与容器参数不再联动，理论上可把水面抬到墙顶之上、或压到池底之下。此为**刻意保留的自由度**（钳制会把两者重新焊回去）。若后续需要，应通过 preset 而非内联钳制解决。
- `waterPoolHeight` 语义变更，依赖旧档迁移保观感；若用户手改过存档可能出现一次性的水面位置偏移。
- B 档是一次结构性重构，触及 `water-capability.ts` 核心， risks: 中等。以 ADR-255 的既有测试（41 例）为回归基线，红线——**不得出现行为变更**。

### 兼容性

- 旧存档：由 §2.2 迁移规则兜底，不丢参数。
- 公开 API：`WaterMode` / `WATER_MODES` 保持原样，本次不新增模式（ocean 为后续 RFC）。

---

## 4. 验证（Verification）

测试（`water-capability.test.ts`）必须覆盖：

1. `film` 下改 `waterLevel` → mesh 实例不变（不重建）且 `position.y` 跟随。
2. `pool` 下改 `waterLevel` → 不重建，且**墙体/池底几何不受影响**。
3. `waterPoolHeight` 变更后**不再改变顶层水面的 y**（语义分离的核心断言）。
4. 菜单节点 `ground-water-level` 在 film 与 pool 两种快照下**均可见**。
5. 策略表：两种 strategy 的 `getTargets(role)` 结果与旧的 name 寻址结果等价（防行为漂移）。
6. ADR-255 既有 assert（Gerstner 注入、`vFoam`、`uSize`、`uChoppiness`、film size 不重建）**全部保持通过**。

门禁：`cd frontend && npx vitest run` + `npm run typecheck` + `npx vite build`；根目录 `node scripts/check-biome.ts --files <改动文件>`、`node scripts/check-doc-drift.ts`、`node scripts/gen-docs-index.ts`（ADR 登记）。

---

## 5. 备选方案（Alternatives Considered）

| 方案 | 为何否决 |
|---|---|
| **只给 film 加一个 `waterFilmHeight` 独立参数** | 治标。pool 下「抬水面仍会改墙几何」的根因没解，且两个 near-identical 参数会让 `saveState`/迁移长期双轨，比统一 `waterLevel` 更难维护。 |
| **把 pool 也改成 scale 驱动高度（墙体用 texture/顶点位移）** | 过度设计。墙几何本就低频变更，为省一次重建引入 shader 复杂度不划算；且 pool 用户本就需要真几何来界定容器。 |
| **直接上 C 档（surface/vessel 完全正交）** | 无第三种形态验证接口，凭空建模。`YAGNI`——见 §2.5。 |
| **保留 name 字符串寻址，仅加注释约束** | 字符串契约无法被类型系统或 lint 校验，历史已证明属于「能跑但脆」的债。本次随 B 档一并消除。 |

---

## 6. 补记（2026-09-18）：§2.3 的两处「声称已达成、实际未达成」收口

### 6.1 `getTargets` 的字符串寻址只搬了家，未消除（本次修复）

- 事实核对：落地后 `poolStrategy.getTargets` 内部仍是 `m.name === "ysm-water-top"` /
  `m.name.endsWith("-inner" | "-outer")` 过滤——mesh-name 契约从 cap 搬进 strategy，脆弱性原样保留；
  且每次参数变更（拖滑块）都要 `traverse` 整棵树做 9 次字符串比较。测试当时以
  「与旧 name 寻址口径完全等价」为断言，等于把这个契约**固化**下来而非消除。
- 本次收口：`WaterBody` 新增 `parts: Record<WaterPartRole, THREE.Mesh[]>`，形态在 **build 期预捕获**
  各 role 的 mesh 引用（`top` 早已预捕获，floor/内壁/外壁补齐同款待遇）；`getTargets` 退化为
  `return body.parts[role]` —— 运行时零遍历、零字符串匹配（`name` 现在只服务调试可读性）。
  不支持的 role 由形态给空数组，cap 侧「颜色作用于 surface + wallInner」的一行表达式语义保持不变。
- 测试反证改写为「把全树 mesh 改名后仍能取出」，使该契约**无法**再退化回 name 依赖。

### 6.2 `GROUND_LAYER_OFFSETS.waterFilm` 成为零消费者常量（本次删除）

- film 水膜 y 改由 `envState.waterLevel` 驱动后，`waterFilm: 0.01` 再无任何渲染消费者，
  只剩注释声称「与 schema 默认值同源」。本次按不变量「零消费者字段即时删除」移除，
  schema 的 `waterLevel: 0.01` 就此成为唯一事实源（知识卡 `ground_surface_spec.md` 同步改口径）。

### 6.3 登记遗留（本次未处理）

- **`waterSize` 在 UI 无入口**：全仓唯一写入点是 `loadState` 的 `size` 恢复（+ 测试直写）。
  即 ADR-255 改造 A 的「size 零重建」优化目前服务的是一条用户不可达路径。
- **放开 size 入口前须先解决法线重算**：film 改 size 会同步触发 `getNormalMap()` 全量重算
  256²（65536 像素 × 每像素 3 个 `Vector2` + 3 次 `cos` + 归一化）并阻塞主线程——拖滑块必掉帧。
  可选方向：降采样、按 tile 生成、或把微细节法线整体搬到 shader 程序化（省掉 CPU 侧整条链路）。
- **`max(0.5)` 自由度**：`waterLevel` 与容器参数解耦后的自由组合仍可产生「水面高于墙顶」等异常观感，
  维持 §3「刻意保留自由度，如需约束应走 preset」的既有结论。

