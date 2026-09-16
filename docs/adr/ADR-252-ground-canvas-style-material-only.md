# ADR-252：地面材质第三轴拆分：canvasStyle 收敛为纯材质轴

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/ground-surface-spec.ts`、`frontend/src/preview-3d/caps/ground-menu.ts`、`frontend/src/preview-3d/caps/ground-capability.ts`、`frontend/src/preview-3d/state/env-state-schema.ts`、[ADR-249](ADR-249-ground-material-axis-split-layer-overlay.md)（**本 ADR 取代其 §2.2**）、[ADR-251](ADR-251-ground-material-family-completion.md)

---

## 1. 背景（Context）

### 1.1 用户在看到实际界面后提出的缺陷报告

ADR-251 落地「补全家族」方案（保留 `canvasStyle` 的图案成员）后，用户在实际渲染的 DOM 上复查并报告：

> 程序化画布异常样式：棋盘、菱格、网格、条纹
> 预期：素面、沙子、草地、大理石

即：**「程序化画布」这一来源轴下，样式下拉不该出现几何图案**。用户的预期始终是「程序化 = 材质（沙/草/大理石）」。

### 1.2 ADR-251 §2.2 的决策被推翻

ADR-251 §2.2 曾**显式拒绝**把图案迁出 `canvasStyle`，理由：

1. 收益仅为命名洁净（迁移后视觉完全等价）；
2. 代价包括旧存档迁移 + ADR-249 生效矩阵重构（矩阵输入从单值变值对）+ 单 mesh 变双 mesh。

**该成本核算的方向错了**：迁移与矩阵重构是**实现方承担的一次性成本**，而分类混乱是**用户持续承担的认知成本**。当用户在真实界面上确认后者不可接受时，前者不应成为拒绝理由。

故本 ADR 推翻 ADR-251 §2.2，执行第三轴拆分。ADR-251 的其余部分（补 sand/grass、overlay 补图案、不加前缀）继续有效。

### 1.3 拆分后的分类（事实基线）

| 轴 | 成员 | 语义 |
|----|------|------|
| `sourceKind`（来源） | none / solid / canvas / texture | 颜色从哪来 |
| `canvasStyle`（**材质**） | plain / marble / sand / grass | 程序化**噪声材质** |
| `overlay`（**装饰**） | none / grid / checker / stripes / diamond | 透明底装饰线型，可叠任意来源 |

`GridHelper`（y=0 旧网格层）与本拆分无关，仍属 ADR-249 §2.7 登记的遗留。

---

## 2. 决策（Decision）

### 2.1 `canvasStyle` 收敛为纯材质轴

`GroundCanvasStyle` 由 8 值收敛为 4 值：`plain | marble | sand | grass`。
几何图案（`grid`/`checker`/`stripes`/`diamond`）从该类型与 `GROUND_CANVAS_STYLES` 中移除。

**理由**：字段名 `canvasStyle` 的语义是「程序化画布长什么样」，而噪声材质才是「长什么样」；几何图案是**叠加在其上的装饰**，不是材质本身。

### 2.2 `GroundSurfaceMode` 同步收敛；legacy 枚举独立成类型

- `GroundSurfaceMode`（运行时派生的表面模式）= `none | solid | plain | marble | sand | grass | texture`。
- **新增** `LegacyGroundMatSource`（旧 9 值扁平枚举）+ `LEGACY_GROUND_MAT_SOURCES`，**仅作迁移输入**。

**关键约束**：legacy 类型与运行时类型分离——迁移函数接受 legacy，运行时永不出现图案值。这使 `generateSurfacePixels` 的图案分支（cell 逐格 + 旋转坐标系中的图案分支）可以安全删除。

### 2.3 迁移映射（视觉等价）

`migrateGroundMatSource` 的图案分支改为进位叠加层：

| 旧 `groundMatSource` / `groundCanvasStyle` | 新 `canvasStyle` | 新 `overlay` |
|---|---|---|
| `none` / `solid` / `texture` | （不适用） | `none` |
| `plain` | `plain` | `none` |
| `marble` | `marble` | `none` |
| `grid` | `plain` | **`grid`** |
| `checker` | `plain` | **`checker`** |
| `stripes` | `plain` | **`stripes`** |
| `diamond` | `plain` | **`diamond`** |

**并须搬运样式参数**（否则视觉不等价）：
- `matLineColor` → `groundOverlayColor`
- `matGridSize` → `groundOverlaySize`

**两条迁移路径都要覆盖**（`loadState` 内）：
1. ADR-249 **之前**的扁平枚举存档（`matSource: "grid"`）→ 三级映射；
2. ADR-249 **时代**的存档（`groundCanvasStyle: "grid"`，当时合法、现已非法）→ 拆为 `plain` + `overlay`。

两条路径均须**契约测试覆盖**（用户存档不可丢）。

### 2.4 删除 `matLineColor`（零消费者）

图案是唯一读线色的分支。图案迁出后，`matLineColor` 在表面层**无任何消费者**，故一并删除：

- `GroundMaterialParams.matLineColor` / `DEFAULT_GROUND_SURFACE_PARAMS.matLineColor` / `GroundSurfaceStructuralSpec.lineColor` / `buildGroundSurfaceSpec` 赋值 全部移除；
- `GROUND_MAT_PARAMS` 移除该行（菜单控件随之消失）；
- `env-state-schema.groundMatLineColor` 移除；
- `GroundCapability.getMatLineColor/setMatLineColor` 移除。

其值仅由迁移路径从原始存档对象读取，写入 `groundOverlayColor`。

**不再留作死字段**——这是本项目对「零消费者字段」的一贯处置（同 ADR-249 §2.6 的常量双源收敛精神）。

### 2.5 生效矩阵简化

图案离场后矩阵集合收敛：

| 集合 | 成员 | 语义 |
|------|------|------|
| `COLOR2_MODES` | marble / sand / grass | 色变插值 |
| `NOISE_MODES`（原 `NEW_PATTERN_MODES`） | marble / sand / grass | 走 2D 旋转坐标系，读 density / angleRad |
| `GRID_SIZE_MODES` | marble / sand / grass | gridSize 作粒度基准 |
| `MAP_PRODUCING_MODES` | plain / marble / sand / grass | 产出贴图 → matScale/matRotationDeg 生效 |
| ~~`LINE_COLOR_MODES`~~ | **删除** | 无表面模式读线色 |

矩阵输入仍是**单值**（`GroundSurfaceMode`），**未**变成值对——因为图案职责整体移交 overlay，而 overlay 有自己的 `overlayColor/Size/Opacity` 参数与独立的菜单控件，不参与表面矩阵。

> 注：ADR-251 §2.2 曾预估「矩阵输入从单值变值对」。该预估**未成真**——因为 overlay 自带参数，表面矩阵无需感知 overlay 状态。这是本 ADR 的实际成本低于预估的原因。

### 2.6 不做什么

- **不改 Go**（同 ADR-249 §2.7）。
- **不合并旧网格层与表面层**（ADR-249 §2.7 遗留，仍不展开）。
- **不为分组引入 `<optgroup>`**：拆分后 `canvasStyle` 下拉只剩材质，`overlay` 下拉只剩图案，**分组需求自然消失**（这是 ADR-251 §2.3「不加前缀」的最终解法——不是标注分类，而是让每个轴只装一类）。

---

## 3. 后果（Consequences）

### 正面

- 用户预期达成：`canvasStyle` 下拉恰为「素面/大理石/沙子/草地」。
- 每个轴只装一个家族，**分类在数据结构层成立**，无需靠命名或排序传达。
- `generateSurfacePixels` 删除全部图案分支，只剩纯色与噪声两族，函数显著简化。
- 删掉零消费者的 `matLineColor`，减少一个死字段与一个死控件。
- 矩阵因图案离场而简化（少一个集合、少一个 case）。

### 负面 / 代价

- **存档迁移**：两条路径（扁平枚举 / ADR-249 时代图案值）都需正确，须契约测试锁定。已覆盖。
- **旧图案变为叠加层**：多一个 mesh 与一次 draw call（地为单一平面，成本可忽略）。
- **模式集合变更**：`GROUND_SURFACE_MODES` 语义从「全部外观模式」变为「运行时模式」；迁移测试须改用 `LEGACY_GROUND_MAT_SOURCES`。

### 已知遗留

- 旧网格层（y=0）与表面层（y=0.005）字段语义重叠（ADR-249 病例 C），未合并。
- 地面 y 位置固定不可调。
- 叠加层样式集仍可扩展（scan/glowEdge 等）。
- **性能观察**：噪声材质（marble/sand/grass）的 `density` 属 structural，每次变更触发 512² × 3 次 `valueNoise` 重建。测试已因此触及 5s 超时（改用廉价材质规避）。真实交互中拖动密度滑杆可能卡顿——**留待后续优化**（如降采样或增大重建节流），非本 ADR 范围。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户实机 DOM 报告「程序化画布异常样式：棋盘、菱格、网格、条纹 / 预期：素面、沙子、草地、大理石」 | §1.1 触发本 ADR |
| ADR-251 §2.2 的拒绝理由（迁移 + 矩阵重构 + 多 mesh） | §1.2 成本核算方向错误（实现成本 vs 用户认知成本） |
| `generateSurfacePixels` 各分支语义（噪声 vs 几何图案） | §2.1 材质轴收敛判据 |
| `matLineColor` 消费者检索（图案是唯一读线色者） | §2.4 零消费者字段删除 |
| `overlay` 自带 `overlayColor/Size/Opacity` | §2.5 矩阵输入未变值对（成本低于 ADR-251 §2.2 预估） |
| `GroundCapability.loadState` 两条迁移路径 | §2.3 契约测试要求 |
| 用户既有存档（`groundCanvasStyle=grid` 等） | §2.3 视觉等价迁移（线色/格数搬运） |
| ADR-249 §2.7 不改 Go / 不合并旧网格层 | §2.6 范围边界 |

<!-- 文件名: ground-canvas-style-material-only.md → 实际文件 ADR-252-ground-canvas-style-material-only.md -->
