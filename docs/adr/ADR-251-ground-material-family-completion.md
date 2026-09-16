# ADR-251：地面材质家族补全：噪声材质与非几何图案分工

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/caps/ground-surface-spec.ts`、`frontend/src/preview-3d/caps/ground-menu.ts`、`frontend/src/preview-3d/caps/ground-capability.ts`、`docs/adr/ADR-249-ground-material-axis-split-layer-overlay.md`、`docs/ADR-249-ground-material-effect-matrix.md`

---

## 1. 背景（Context）

### 1.1 用户提出的分类质疑

ADR-249 落地三轴（来源轴 × 样式轴 × 叠加层）后，用户复查菜单提出：

> 「好奇程序化贴图与叠加层的区别，为啥程序化还会承担部分预设呢，我以为这个部分是负责处理沙子、草地噪点图的」

该质疑经源码核实**成立**，且指向 ADR-249 只切分了一层所留下的残余。

### 1.2 事实：`canvasStyle` 混居三个家族

`GroundCanvasStyle` 当时 6 个取值，但代码语义分属三类：

| canvasStyle | `generateSurfacePixels` 实际行为 | 真实家族 |
|-------------|--------------------------------|----------|
| `plain` | 均匀填 `color`，无图案 | **底色**（不是图案） |
| `grid` | cell 首行/首列为 `lineColor` | **装饰线型** |
| `checker` | `color`/`lineColor` 交替填格 | **装饰线型** |
| `diamond` | `\|rx\|+\|ry\|=k·t` 菱形等距线 | **装饰线型** |
| `stripes` | 旋转坐标系下的条带填充 | **装饰图案** |
| `marble` | 三倍频 `valueNoise` + 正弦带，`color↔color2` lerp | **材质纹理** |

用户预期「程序化 = 沙/草噪点」对应的正是 `marble` 所在的**材质纹理**家族，而该家族当时只有 `marble` 一个成员，被夹在几何图案之间。

### 1.3 事实：`grid`/`checker` 两处实现

`overlay` 独立实现了 `grid`/`checker`（透明底）。与 `canvasStyle` 的同名值对照：

| | `canvasStyle=grid` | `overlay=grid` |
|---|---|---|
| 背景 | 不透明（填满 `matColor`） | **透明** |
| 贴图 | 底+线烘焙进同一张 | 独立贴图 |
| 可见条件 | **仅 `sourceKind=canvas`** | **任意来源** |
| 独立开关 | ✗ | ✓ |
| 线色/密度/透明度 | 与底色共享参数 | **独立** |
| 叠在用户贴图上 | ✗ 不可能 | ✓ **可以** |

二者**视觉等价**（当 `overlayColor` 取 `matLineColor` 时），差别仅在于叠加层多一个 mesh。故这不是"错误"，而是"同一效果的两种组合路径"。

### 1.4 事实：ADR-249 §2.3 与 §2.7 的范围约束

- ADR-249 §2.3 明确：「本 ADR 仅决策**架构方向**。叠加层首期落地的具体样式集合由实施时确定，不在本 ADR 锁定」。
- ADR-249 §2.7 明确：不合并旧网格层与表面层（病例 C），避免范围蔓延。

故 `canvasStyle` 的家族混居属**继承自 ADR-117 预设设计的历史残余**，未被 ADR-249 覆盖。

---

## 2. 决策（Decision）

### 2.1 补全两个家族，不做第三轴拆分

**决策**：保持 `canvasStyle` 单一字段（不拆为「材质选择 + 图案选择」两个字段），但**补全其家族成员**，使两个家族各自完整：

1. `canvasStyle` 补入噪声材质 `sand` / `grass`（与 `marble` 同族，复用既有 `valueNoise` 基建）。
2. `overlay` 补入几何图案 `stripes` / `diamond`（与既有 `grid` / `checker` 同族），使其成为**完整的装饰线型轴**。

### 2.2 拒绝的方案：把 `grid`/`checker`/`stripes`/`diamond` 从 `canvasStyle` 迁出

**评估过但拒绝**（用户在其他选项中否决）。理由：

- **收益仅为命名洁净**：迁移后 `canvasStyle=grid` → `canvasStyle=plain` + `overlay=grid`，视觉**完全等价**（当 `overlayColor` 取 `matLineColor`）。
- **代价是真金白银**：
  1. 需**旧存档迁移**（用户存档 `canvasStyle=grid` 必须仍能渲染）——ADR-249 §2.5 那套迁移工程。
  2. 需**重构 ADR-249 的生效矩阵**：`matLineColor`/`matGridSize` 的归属从「surface mode」改为「overlay 状态」，即矩阵输入从单值变为 值对。
  3. 单 mesh → 双 mesh（地为单一平面，成本可忽略但非零）。
- **两者并非冗余**：`canvasStyle=grid` 是「地面**就是**一块网格材质」（单层、不透明）；`overlay=grid` 是「格线**叠在**某底层之上」。二者是两种组合意图，共存有正当性。

故本 ADR 判定：**保留共存，补全家族**。第三轴拆分若日后确需，另立 ADR（届时须含迁移契约测试与矩阵重构）。

### 2.3 菜单不加上下文前缀

**决策**：`canvasStyle` 下拉仅按家族排序（材质在前、图案在后），**不加**「材质·沙子」这类前缀。

理由：**矩阵已用行为告知用户家族归属**——选材质（`sand`/`grass`/`marble`）时「线色」控件消失，选图案（`grid`/`checker`）时「线色」出现。前缀只会重复该信号，并把内部术语暴露给用户。

（`PreviewControlSpec.options` 为扁平 `{value,label}[]`，不支持 `<optgroup>`。若日后需显式分组，应作为**共享菜单基础设施**独立提案，不夹带在本类改动中。）

### 2.4 家族成员与矩阵归属

新成员在生效矩阵中的归属（`paramIsEffective` 的集合常量）：

| 集合 | 新增 | 语义 |
|------|------|------|
| `COLOR2_MODES` | `sand` `grass` | 噪声材质的色变插值（`color ↔ color2`） |
| `NEW_PATTERN_MODES` | `sand` `grass` | 走 2D 旋转坐标系（读 `density` / `angleRad`） |
| `GRID_SIZE_MODES` | `sand` `grass` | `gridSize` 作「粒度基准」 |
| `MAP_PRODUCING_MODES` | `sand` `grass` | 产出贴图 → `matScale`/`matRotationDeg` 生效 |
| `LINE_COLOR_MODES` | **不含** | 材质无格线（用户可见信号：线色控件隐藏） |

**沙/草参数差异**（仅频率与对比度）：
- `sand`：高频细颗粒低对比（`freq` 基准 14，`contrast` 0.45）
- `grass`：中频块状高对比（`freq` 基准 5，`contrast` 0.95）

---

## 3. 后果（Consequences）

### 正面

- `canvasStyle` 兑现其名：用户预期的「沙子/草地噪点图」可达。
- `overlay` 成为完整的装饰线型轴（4 种 + 无）。
- 组合自由度提升：`canvasStyle=sand` + `overlay=grid` = **沙地 + 格线**（旧互斥枚举下不可达）。
- 无存档迁移风险，无矩阵重构风险。

### 负面 / 代价

- `grid`/`checker` 仍在两处实现（§1.3）。**接受该冗余**，理由见 §2.2。
- 家族混居的**命名**问题未根治：字段名 `canvasStyle` 仍不体现"材质 vs 图案"之分。缓解：代码注释 + 菜单排序 + 知识卡登记。

### 已知遗留

- 第三轴拆分（若需）未做，见 §2.2。
- `PreviewControlSpec.options` 不支持分组，见 §2.3。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户质疑「为啥程序化还会承担部分预设，我以为这里处理沙/草噪点」 | §1.1 触发本 ADR |
| `ground-surface-spec.ts\|generateSurfacePixels` 各分支语义核实 | §1.2 三家族混居事实表 |
| `canvasStyle=grid` 与 `overlay=grid` 对照（视觉等价、能力差异） | §1.3 两处实现事实；§2.2 拒绝迁移的理由 |
| ADR-249 §2.3「仅决策架构方向」+ §2.7「不合并」范围约束 | §1.4 本 ADR 承接的边界 |
| `ground-menu.ts` 中 ADR-249 §2.4 矩阵驱动的 `paramVisible` | §2.3 前缀冗余的依据（行为已传达家族） |
| `valueNoise` 既有基建（`marble` 分支在用） | §2.1 沙/草复用同基建，零新依赖 |
| 用户选择「A 补齐材质轴」 | §2.1–§2.2 决策边界 |

<!-- 文件名: ground-material-family-completion.md → 实际文件 ADR-251-ground-material-family-completion.md -->
