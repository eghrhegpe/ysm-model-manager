# ADR-249：地面材质菜单拆轴与图层叠加（sourceKind 轴 + canvasStyle 轴 + 装饰叠加层）

- **状态**：🔄 部分采纳（§2.2 被 [ADR-252](ADR-252-ground-canvas-style-material-only.md) 取代——canvasStyle 收敛为纯材质轴；其余拆轴/图层叠加决策继续有效）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/ground-menu.ts`、`frontend/src/preview-3d/caps/ground-surface-spec.ts`、`frontend/src/preview-3d/caps/ground-capability.ts`、`frontend/src/preview-3d/state/env-state-schema.ts`、[生效矩阵](../ADR-249-ground-material-effect-matrix.md)、`docs/adr/ADR-117-ground-material-spec.md`、`docs/adr/ADR-195-cap-control-single-type.md`、`docs/adr/ADR-196-env-state-preset-unification.md`
- **外部参照**：MikuMikuAR `docs/adr/adr-089-ground-mode-split.md`（拆轴）、`docs/adr/adr-226-ground-material-spec-single-source.md`（spec 单一事实源）

---

## 1. 背景（Context）

### 1.1 用户反馈的现象

用户实操反馈（原话）：「我选的是纯色，或者无色，但还是会显示线色，很迷的设计」。用户进一步指出参照物：「隔壁是折叠菜单总控，内部设置各值，所有叠加类图层甚至地形图都可以通过材质工厂组装，不至于出现预设纯色还有线框图」。

用户同时提出前置担忧：「隔壁的这个工厂修了很多次才把材质刷新给解决了，我怕菜单拆了以后又栽倒在同步问题上」——**该担忧已被隔壁提交史证实，见 §1.4**。

### 1.2 现象的三个确切来源（源码实证）

**来源一：`none`（无）不关闭地面，而是画纯色。**
`frontend/src/preview-3d/caps/ground-surface-spec.ts|generateSurfacePixels` 首分支：

```ts
if (st.mode === "solid" || st.mode === "none" || st.mode === "plain") {
  // 填充纯色像素后 return
}
```

`none` 与 `solid`/`plain` 归为同一支并返回不透明纯色像素。同文件 `GroundCapability.updateSurfaceVisible` 的可见性判据是 `groundMatSource !== "none"`——即 `none` 语义上被当作「不显示表面层」。两者矛盾：用户选「无」后控件全隐（`ground-menu.ts|groundSurfaceOn` 谓词），画面上却仍覆盖一层实色。

**来源二：线色等控件无差别的可见性 → 死控件。**
`ground-menu.ts` 的可见性谓词只有一条粗粒度规则：

```ts
const groundSurfaceOn = (s) => s["env.groundMatSource"] !== "none";
```

该谓词被挂在**所有**材质控件（3 个 color + 6 个 slider）上，与具体模式无关。后果：`solid` / `plain` 下「线色」控件照常显示、可拖动、可写入 envState、可触发 `refreshSurface()`，但 `generateSurfacePixels` 的纯色分支**不读** `lineColor`，画面零反馈。同理「副色」仅 `marble` 使用，却在 `solid`/`plain`/`grid`/`checker` 下均可见可调。

**来源三：`texture` 存档静默降级为 `plain`。**
`GroundCapability.loadState` 的 `groundMatSource` 恢复分支：

```ts
groundMatSource: oneOf(GROUND_SURFACE_MODES, (v) =>
  setEnvState({ groundMatSource: v === "texture" && !this.customTex ? "plain" : v }, ...),
),
```

自定义贴图二进制不持久化（设计如此），故重启后 `customTex` 为空，`texture` 被改写为 `plain`。而 `plain` 是纯色分支——用户存档里选的「自定义贴图」，重启后表现为一块**看似无关的纯色地面**。

### 1.3 根本原因：单一枚举承载两条正交轴

`groundMatSource: GroundSurfaceMode` 是 9 值扁平枚举：

```
none | solid | plain | grid | checker | texture | stripes | diamond | marble
```

该枚举混合了三个本应正交的概念：

| 概念 | 取值 | 应为 |
|------|------|------|
| **来源轴**（颜色从哪来） | `none` / `solid` / 程序化画布 / `texture` | 独立字段 `sourceKind` |
| **样式轴**（程序化长什么样） | `plain` / `grid` / `checker` / `stripes` / `diamond` / `marble` | 独立字段 `canvasStyle`（仅 canvas 来源有效） |
| **预设**（具名参数组） | 无 | 独立于上述两轴 |

「线色是否生效」是**样式轴**的属性；「有没有贴图」是**来源轴**的属性。二者被压进一个枚举后，菜单层只能做「整组显隐」的粗粒度判断，无法表达「纯色来源下不显示线色」。

**这与 MikuMikuAR ADR-089 记录的病完全同构**——该 ADR 记载其 `groundMode` 单一枚举同时承载「几何类型轴」与「外观样式轴」，用户同样反馈分类「奇怪」。该 ADR 的处置是拆为 `groundType` + `groundStyle`。

### 1.4 已知的同步风险（用户担忧的实证）

MikuMikuAR 地面材质重构的提交史显示，材质刷新同步问题反复出现，且**集中在重建/原地双路径的分岔**上：

| 提交 | 翻车形态 | 对我们的启示 |
|------|----------|--------------|
| `5af0fe78` | terrain 重建路径走 `createHeightmapGround`，**不经过** `applyGroundMaterialSpec`，重建后 emissive 被重置为黑——原地路径改了、重建路径漏了 | **拆轴后每个新参数都必须同时回答：进 specKey 吗？重建路径处理我吗？原地路径处理我吗？** |
| `907fa26b` | 重建时 `disposeGroundMaterial` 误 dispose 了归 env-water-fx 所有的涟漪纹理，水系统持已销毁引用 | 多图层后「谁拥有这张纹理」成为一等公民问题 |
| `5af0fe78`（第 2 条） | `install()` 在 apply 之前执行，捕获的初始快照是焦散纹理而非用户态 emissive，出水后残留 | 图层的「原始值」捕获时机 |
| `bd65c02f` | `INFINITE_GROUND_SIZE` 在两个文件各定义一次 2000（常量双源） | **我们已有同款现存病例**，见 §1.5 |
| `2ad47758` | 改法线纹理时未释放旧 `bumpTexture`（纹理泄漏） | 图层切换时的资源释放 |

### 1.5 我们已有的同款现存病例（拆轴前必须一并处置）

**病例 A：默认值双源。** `env-state-schema.ts` 声明 `groundMatGridSize` 默认 **10**、`groundMatRoughness` 默认 **0.8**；而 `ground-surface-spec.ts|DEFAULT_GROUND_SURFACE_PARAMS` 声明 `matGridSize: 8`、`matRoughness: 0.85`。用户实测 DOM 显示 8.00 / 0.85，证明 spec 侧胜出、schema 侧为死值。**违反单一事实源**。

**病例 B：`刀⑳ 修复` 的补丁性质。** `generateSurfacePixels` 内注释记载：

> 刀⑳ 修复：原条件漏了 `"plain"`，使其落到下方 grid 分支画出格线

该修复把 `plain` 塞进纯色分支，**只解决了「plain 不画线」，未解决「为什么用户会看到线」**——即 §1.3 的轴混压问题。这正是本 ADR 要根治的对象。

**病例 C：旧地面网格字段与表面材质字段并存。**
`env-state-schema.ts` 同时存在两套语义重叠的字段：

- 旧网格层（y=0）：`groundType`（plain/grid/checker/lines/dots）+ `groundColor`(tuple3) + `groundLineColor`(tuple3)
- 表面层（y=0.005）：`groundMatSource` + `groundMatColor`(hex) + `groundMatLineColor`(hex) + …

两套都表达「底色 / 线色 / 样式」，是历史层叠的双重实现。

### 1.6 架构红利：我们已有 spec 单源，拆轴成本低于隔壁

`ground-surface-spec.ts` 已实现 ADR-226 的核心成果（早于本 ADR 存在）：

- `buildGroundSurfaceSpec` 单一生成 spec（structural / appearance 二分）
- `surfaceSpecKey` 由 structural 排序后 JSON 序列化**自动派生**（非手拼 typeKey）
- `groundSurfaceNeedsRebuild` 经 specKey 比较判定重建或原地
- `GroundCapability.refreshSurface` 是**全部 setter 的唯一汇聚点**，内部分岔走上述判据

**关键含义**：拆轴时只要新字段正确落在 structural / appearance 二分中，重建/原地分岔**自动正确**，无需新增分岔点。这显著降低了 §1.4 类风险——但**前提是每个新字段的归属必须显式决策**，故 §2.4 强制要求生效矩阵。

---

## 2. 决策（Decision）

采用**拆轴 + 图层叠加**：把 `groundMatSource` 单枚举拆为两个正交字段，并将「线框/图案」从样式枚举中提取为可独立开关的叠加层，使「纯色 + 格线」等组合成为可能。

### 2.1 数据模型：拆为两轴

```ts
// 来源轴：颜色从哪来（决定渲染管线，属结构性）
export type GroundSourceKind = "none" | "solid" | "canvas" | "texture";

// 样式轴：程序化画布长什么样（仅 sourceKind === "canvas" 有效，属结构性）
export type GroundCanvasStyle = "plain" | "grid" | "checker" | "stripes" | "diamond" | "marble";
```

对照关系（迁移映射，见 §2.5）：

| 旧 `groundMatSource` | 新 `sourceKind` | 新 `canvasStyle` |
|----------------------|-----------------|------------------|
| `none` | `none` | （不适用） |
| `solid` | `solid` | （不适用） |
| `plain` | `canvas` | `plain` |
| `grid` | `canvas` | `grid` |
| `checker` | `canvas` | `checker` |
| `stripes` | `canvas` | `stripes` |
| `diamond` | `canvas` | `diamond` |
| `marble` | `canvas` | `marble` |
| `texture` | `texture` | （不适用） |

### 2.2 渲染语义：`none` 必须真的关闭

**决策**：`sourceKind === "none"` 时，表面层 `surface.visible = false`，`generateSurfacePixels` **不得**再为 `none` 生成像素。

即：删除 `generateSurfacePixels` 首分支中的 `st.mode === "none"`，`none` 与 `solid` 彻底分离。这消除 §1.2 来源一的矛盾。

### 2.3 图层叠加：线框升格为独立层

**决策**：把「格线 / 图案」从样式枚举中提取为**独立叠加层**，与来源轴、样式轴正交：

```
最终外观 = 底层（sourceKind 决定的颜色/贴图）
         × 样式层（canvasStyle 决定的程序化图案，仅 canvas 来源有）
         + 叠加层（overlay，独立开关，可叠加在任意底层之上）
```

对齐 MikuMikuAR `env-ground-levels.ts` 的 folder 拆分——其「装饰」（overlay）是一个独立开合组，含独立 `headerToggle`：

```ts
headerToggle: {
  bind: 'env.groundOverlay',
  get: (v) => v !== 'none',
  set: (on) => (on ? 'grid' : 'none'),
}
```

**收益**：实现用户明确期望的「纯色 + 格线」组合。旧的互斥枚举下该组合不可达。

**范围约束**：本 ADR 仅决策**架构方向**。叠加层首期落地的具体样式集合（grid / checker / scan / glowEdge 等）由实施时确定，不在本 ADR 锁定。

### 2.4 强制交付物：生效矩阵（回应用户「先写生效矩阵」的要求）

**这是本 ADR 的核心防翻车机制。** 拆轴前必须产出一张**参数 × 模式生效矩阵**，作为菜单可见性与渲染读取的**共同事实源**。

矩阵已产出并按源码逐格核实，**独立成文**：`docs/ADR-249-ground-material-effect-matrix.md`（含核实方法、9×11 生效表、当前死控件清单、拆轴后目标形态）。

摘要（完整表见上述文件）：

| 参数 | none | solid | plain | grid | checker | stripes | diamond | marble | texture |
|------|:----:|:-----:|:-----:|:----:|:-------:|:-------:|:-------:|:------:|:-------:|
| `matColor` | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `matColor2` | — | — | — | — | — | — | — | ✔ | — |
| `matLineColor` | — | — | — | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| `matGridSize` | — | — | — | ✔ | ✔ | ✔^ | ✔^ | ✔^ | — |
| `matDensity` | — | — | — | — | — | ✔ | ✔ | ✔ | — |
| `matAngleDeg` | — | — | — | — | — | ✔ | ✔ | ✔ | — |
| `matOpacity` / `matRoughness` / `matMetalness` | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `matScale` / `matRotationDeg` | — | — | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

`^` = 生效但语义改变（新三模式下 `gridSize` 是「图案周期数」而非「每边格数」）。

**核实已推翻两处初始猜测**（证明本步骤不可省）：
1. `matScale`/`matRotationDeg` 并非仅 `texture` 生效——它们在 `applyGroundSurfaceAppearance` 中对 `mat.map` 生效，故凡产出贴图的模式（`plain` 起）均被读取，属「生效但视觉不可见」。
2. `matGridSize` 在 `stripes`/`diamond`/`marble` 下**仍被读取**，但走 `periodCount = gridSize * density` 分支，语义与 `grid`/`checker` 的「每边格数」不同。

**约束**：矩阵必须**单一事实源**——由该矩阵同时派生

1. 菜单控件的 `visibleWhen` 谓词（消除死控件）
2. 渲染层的参数读取分支（消除「可调但无效」）

禁止菜单与渲染各自维护一份判断。实现形态由实施决定（数据表 + 派生函数为推荐形态），但**两处不得各写一份 if**。

### 2.5 迁移策略：一次性映射 + 不静默降级

**决策**：

1. **旧值映射**：按 §2.1 对照表一次性迁移。`groundMatSource` 旧键读取后拆写为 `sourceKind` + `canvasStyle`，随后旧键废弃。迁移在 cap 的 `loadState` 内完成（该处已有 legacy 键迁移先例，见 `GroundCapability.loadState` 的 `legacyGroundKeys` 分支）。
2. **禁止静默降级**：删除 §1.2 来源三的 `texture → plain` 改写。`texture` 来源在无贴图时的正确行为是**保留来源选择 + 提示未选贴图**（或回退 `solid`），而非静默改写为另一个语义不同的模式。
3. **持久化兼容**：`saveState` / `loadState` 的键集同步更新；旧存档经迁移路径读取，用户已调参数不丢。

### 2.6 一并处置 §1.5 的现存病例

**决策**：默认值双源（病例 A）在本次收敛中消除——`DEFAULT_GROUND_SURFACE_PARAMS` 与 `env-state-schema.ts` 的默认值必须一致，且**唯一事实源为 spec 侧**（schema 默认值改为引用 spec 常量，或反之，取一处）。具体方向由实施时择一，但**必须只剩一处字面量**。

### 2.7 不做什么（范围边界）

- **不改 Go**：`groundMatSource` 属 cap 自持久化的 `env.groundMatSource` 探针路径（见 `docs/knowledge/preview-paths.md`），不落 Go 契约，本次不含 Go 改动。
- **不引入 per-model 地面预设**：地面不参与 `MODEL_DEFAULTS`（`applyModelDefaults` 只编排 sky/light/fog/shadow/reflector/environment 六个 cap）是**刻意分工**——地面是模型承载面而非打光载体，per-model 地板颜色属噪音。本 ADR 不改此决策。
- **不合并旧网格层与表面层**（病例 C）：两套字段的合并是独立议题，本 ADR 不展开，避免范围蔓延。**但必须在知识卡中登记为已知遗留**。

---

## 3. 后果（Consequences）

### 正面

- 消除死控件：控件可见性与实际生效范围一致，「可调但无效」不再出现。
- `none` 语义自洽：选「无」真的无地面表面，不再覆盖实色。
- 组合自由度：「纯色 + 格线」等正交组合可达，菜单从「9 选 1」变为「来源 × 样式 × 叠加层」的组装模型。
- 轴分离后两个字段各自语义单一，新增样式（如 `wood`）只需改样式轴，不动来源轴。
- 默认值单一事实源，消除 schema / spec 双源分歧。
- 复用既有 spec 单源红利（§1.6），重建/原地分岔不新增分岔点。

### 负面 / 代价

- **持久化迁移风险**：旧存档键集变更，迁移路径必须正确，否则用户已调地面参数丢失。需契约测试覆盖迁移。
- **改动面较大**：schema + spec + capability + menu 四处联动，且涉及 `refreshSurface` 单路径。
- **生效矩阵的维护成本**：新增参数必须同时更新矩阵（行）与该参数在各模式的生效格，漏更新即回归死控件。缓解：矩阵为单一事实源，菜单与渲染共同派生，漏更新会同时影响两处而非静默单侧失效。
- 引入叠加层后，图层合成顺序与资源所有权（§1.4 第 2 条）成为新的一等公民问题，必须在实施时明确每层纹理的 owner 与释放责任。

### 已知遗留（不在本 ADR 范围）

- 旧网格层（y=0）与表面层（y=0.005）字段语义重叠（病例 C），未合并。
- 地面 y 位置固定（夹在网格与水面之间）不可调，与本次菜单拆轴无关。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户实操反馈「选纯色/无色仍显示线色，很迷」+ DOM 快照实证（8.00 / 0.85） | 定位 §1.2 三个来源；确认默认值双源（病例 A） |
| `ground-surface-spec.ts\|generateSurfacePixels` 首分支 `none` 与 `solid` 同支 | §2.2 `none` 必须真的关闭 |
| `ground-menu.ts\|groundSurfaceOn` 谓词被挂于全部材质控件 | §1.2 来源二（死控件）；§2.4 生效矩阵 |
| `GroundCapability.loadState` 的 `texture → plain` 改写 | §1.2 来源三；§2.5 禁止静默降级 |
| `ground-capability.ts\|refreshSurface` + `ground-surface-spec.ts\|surfaceSpecKey` | §1.6 架构红利：拆轴不新增重建/原地分岔点 |
| 用户指名参照物 MikuMikuAR + `adr-089-ground-mode-split.md` | §1.3 同构病；§2.1 拆轴方案 |
| `env-ground-levels.ts\|getGroundSchema` 的 folder 拆分与 overlay 独立开关 | §2.3 图层叠加 |
| 用户前置担忧「隔壁工厂修很多次才解决刷新同步」 | 经提交史核实为真，见 §1.4 五条翻车形态；§2.4 生效矩阵 + §2.6 默认值收敛 |
| `env-state-schema.ts` vs `DEFAULT_GROUND_SURFACE_PARAMS` 默认值分歧 | §1.5 病例 A；§2.6 一并处置 |
| `applyModelDefaults` 六 cap 编排清单（不含 ground） | §2.7 不引入 per-model 地面预设 |
| `preview-paths.md` 载 `env.groundMatSource` 为 cap 自持久化探针路径 | §2.7 不改 Go |

<!-- 文件名: ground-material-axis-split-layer-overlay.md → 实际文件 ADR-249-ground-material-axis-split-layer-overlay.md -->
