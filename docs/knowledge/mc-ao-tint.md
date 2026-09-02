---
kind: mc-ao-tint
name: MC 环境光遮蔽(AO) 权重 + biome 配色 参考实现
tier: leaf
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/pack-model-adapter.ts
  - frontend/src/preview-3d/mc-tints.ts
auto_fields:
  symbols_with_lines:
    - buildPackScene:341
    - getTintColorSync:56
    - loadMcTints:29
    - makePackAdapter:66
    - PackAdapterOpts:34
    - PackDeps:27
    - packTextureLabel:52
  reference_files:
    - PrismarineJS/prismarine-viewer viewer/lib/models.js (getSectionGeometry)  # 仅只读参考，不引入其渲染器
  use_when:
    - MC 方块模型 AO / 平滑光照
    - biome tint / 草叶水配色 / 4 类 tint
    - pack-model-adapter 材质升级后续（ADR-080）
    - 顶点色遮蔽权重
  perf:
    - cpu-bound
  invariant_anchors:
    - frontend/src/preview-3d/adapters/pack-model-adapter.ts|tintCategoryForPath
    - frontend/src/preview-3d/mc-tints.ts|getTintColorSync
reference_files:
  - PrismarineJS/prismarine-viewer viewer/lib/models.js (getSectionGeometry)  # 仅只读参考，不引入其渲染器
use_when:
  - MC 方块模型 AO / 平滑光照
  - biome tint / 草叶水配色 / 4 类 tint
  - pack-model-adapter 材质升级后续（ADR-080）
  - 顶点色遮蔽权重
perf:
  - cpu-bound
invariant_anchors:
  - frontend/src/preview-3d/adapters/pack-model-adapter.ts|tintCategoryForPath
  - frontend/src/preview-3d/mc-tints.ts|getTintColorSync
status: active
---

# MC 环境光遮蔽(AO) 权重 + biome 配色 参考实现

> **性质**：定向参考卡（read-only）。抄算法，**不引入** prismarine-viewer 的 chunk/worker/section 渲染体系。
> **来源**：`PrismarineJS/prismarine-viewer` → `viewer/lib/models.js` 的 `getSectionGeometry()`（AO 在 301–360 行；biome tint 在 3–30、135–142、261–273 行）。其 AO 与 biome 解析全在 Web Worker 内调用此函数，强耦合 `world.getBlock(邻居)`。
> **归属 ADR**：材质/tint 工作属 **ADR-080**（pack-model 适配器），非 ADR-084（ADR-084 是三点布光/体积光）。提交 `0e5a7f63` 的「ADR-084 L3」为误标。

## 1. MC AO 权重算法（"4 段阴影"的真身）

MC 平滑光照把每个面顶点的遮蔽量化为 **4 档亮度**，由 3 个邻居遮挡状态（side1、side2、corner）算出：

```js
// prismarine-viewer viewer/lib/models.js AO 计算（逐字参考）
const side1Block = (side1 && side1.isCube) ? 1 : 0
const side2Block = (side2 && side2.isCube) ? 1 : 0
const cornerBlock = (corner && corner.isCube) ? 1 : 0

const ao = (side1Block && side2Block) ? 0 : (3 - (side1Block + side2Block + cornerBlock))
const light = (ao + 1) / 4   // → 0.25 / 0.5 / 0.75 / 1.0  ← 正是用户所说的"4 段"
```

- **邻居判定**：仅 `isCube`（实心方块）记 1，空气/非实心记 0。
- **4 档亮度映射**：`ao=0→0.25, 1→0.5, 2→0.75, 3→1.0`。这就是 MC "4 段阴影" 的数学本质——不是 shader，是**逐顶点 0..3 权重乘到顶点色上**（`attr.colors.push(tint[0]*light, tint[1]*light, tint[2]*light)`）。

### 各向异性翻转（anisotropy flip）

MC 为防止 quad 在对角遮蔽不均时出斜缝，按对角 ao 和决定三角化方向：

```js
// viewer/lib/models.js anisotropy flip
if (doAO && aos[0] + aos[3] >= aos[1] + aos[2]) {
  // 分割方向 A： (0,3,2) + (0,1,3)
} else {
  // 分割方向 B： (0,1,2) + (2,1,3)
}
```

### ⚠️ 关键约束（决定本工具是否值得做）

AO 依赖 `world.getBlock(cursor.offset(...sideDir/cornerDir))` 取**相邻方块**。本预览器（`pack-model-adapter`）只渲染单个资源包模型，**没有邻居块** → 所有 side/corner 均为空气（`isCube=false → 0`）→ 每顶点 `ao=3 → light=1.0` → **AO 完全无效（全亮，无遮蔽）**。

**结论**：单模型预览下，真·MC AO 收益为 0，除非先在 adapter 内**合成一个 3×3×3 邻域**（用空气或同模型克隆填充），或接受"无遮蔽全亮"。这正是上轮判定"AO 在单模型语境收益有限"的代码级依据。

## 2. biome 配色（tint）解析机制

### prismarine-viewer 的实际做法（重要，非直觉）

它**不实时采样 `grass.png`/`foliage.png` colormap**，而是消费预计算的 **biome→RGB 表**：

```js
// viewer/lib/models.js tints 加载
const tints = require('minecraft-data')('1.16.2').tints
// tints.grass[biome] / tints.foliage[biome] / tints.water[biome]
// tints.redstone[`${power}`] / tints.constant[blockName]
```

`tints` 经 `prepareTints()` 预处理为 `biome 名 → [r/255, g/255, b/255]` 的查表（带 default 兜底，见 9–30 行）。着色时直接 `tint = tints.grass[biome]`（261–273 行），再乘 `light` 写入顶点色。

**含义**：若要 biome 正确 tint，务实路径是**消费 `minecraft-data` 的 `tints` 表（或打包其 JSON）**，而不是自己解析 colormap PNG。数据表已把 MC 的 temp/humidity→颜色烘焙好。

### 备选：MC 原生 colormap 采样公式（走 PNG 路线时用）

若坚持从 `assets/minecraft/textures/colormap/grass.png` / `foliage.png` 实时采样：

```
输入: temperature t ∈ [0,1], humidity h ∈ [0,1]（来自 biome 定义）
    纹理尺寸 W×H（MC 为 256×256）
u = (1 - t) * (W - 1)
v = (1 - h * t) * (H - 1)      // 注意是 h*t，非 h
对 (u,v) 邻域做 2×2 双线性插值 → RGB
```

### tintindex 语义澄清（避免误用）

MC 的 `tintindex` 是**自由整数索引**，最终颜色由**方块类型 + biome** 经 `BlockColors`/`FoliageColors` 解析，**并非 index 值直接映射颜色**。prismarine-viewer 仅用 `eFace.tintindex === 0` 作为"该面需要 tint"的布尔开关（0 = 草/叶/水通用），**没有 4 类按 index 查表**。

→ `pack-model-adapter.ts` 已按此语义修正（TDD，全绿）：tintindex 仅作"需染色"布尔，**不再按 index 查表**；类别改由 `texEntry` 路径启发式（`tintCategoryForPath`：`*_leaves`→foliage、`*water*`→water、其余默认 grass，覆盖 vanilla 多数染色面——grass_block 顶面/overlay 无后缀即默认草地绿）；tint 面**保留纹理**（材质 `color×map` 相乘，替代早期"纯色平板"错误简化，"同 tint 不同纹理"按 key 含纹理路径分开材质，避免错贴）。该启发式即 ADR-080 §5.4 方案 a；"方块身份 → tint 类别"精确映射（手工小表）仍为未来改进，与 biome 正确解正交。

## 3. 与本项目的落地映射（供 L4）

| 目标 | 前置条件 | 务实路径 |
|------|----------|----------|
| AO（4 段） | 邻居块查询能力（本预览器无） | 先合成 3×3×3 邻域或接受全亮；权重算法直接照搬 §1（~5 行，无外部依赖） |
| biome 正确 tint | 数据依赖：`minecraft-data` 或打包 `tints.json` | 已消费 `tints` 表按 biome 查（`getTintColorSync`）；类别经 `tintCategoryForPath` 启发式，已替代早期按 `tintindex` 查表近似 |
| NormalMap / Emissive | — | 确认放弃：MC Java block model 格式几乎不用，无实际效果 |

## 4. 风险 / 红线

- **不引入 prismarine-viewer 渲染器**：其 AO 与 `getSectionGeometry` / `world.getBlock` / Worker 强耦合，是完整 chunk 渲染管线的一部分。直接抄 = 推倒重来红线。本卡**只借算法**（§1 公式、§2 数据表思路）。
- 这是"参考"不是"依赖"：知识卡不向项目添加任何 import。
