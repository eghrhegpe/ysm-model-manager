# ADR-080：资源包 block/item 模型 JSON 解析与渲染（PackModelAdapter）

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-066`（统一预览契约/适配器地图）、`ADR-068`（ContainerReader 容器解包）、`ADR-072`（适配器下沉 utils/3d/adapters）、`ADR-041`（UV 口径对齐）、`poc/mc-java-model/`（POC 验证产物）

---

## 1. 背景（Context）

### 1.1 目标

MC Java 版资源包（.zip）本质是 `assets/` 下的文件树，其中 `models/block|item/*.json` 是**完全可渲染**的几何描述（elements 立方体 + faces + UV + display）。当前资源包走 `ThumbnailAdapter` 缩略图通道（ADR-066 适配器地图），只读 `pack.mcmeta` + `pack.png`，不进 3D 核心。ADR-066 遗留"缩略图类型是否进统一入口待拍板"。

本 ADR 拍板：**资源包内 block/item 模型 JSON 渲染进统一预览入口**（新 `PackModelAdapter`），无模型的包保持缩略图通道。

### 1.2 POC 已验证（poc/mc-java-model/，21/21 断言通过，真实 vanilla 1.21.4 样本）

| 验证点 | 结论 |
|--------|------|
| parent 链 | 3 级（stone→cube_all→cube→block），elements 继承、display 逐视角继承、子覆盖父 |
| 纹理变量 | `#all`→`block/stone`→`textures/block/stone.png` 链式 + 命名空间剥离；缺失变量→null |
| 缺省 UV | 面无显式 uv 回退全纹理 `[0,0,16,16]` |
| UV 口径 | 像素坐标→归一化 + v 翻转；"方块顶=纹理顶"由真实纹理像素断言锁定（草在顶、泥在底） |
| element rotation | 45° 顶点位移正确；face UV rotation 90° 角置换正确 |
| tintindex | grass_block 5 个染色面（overlay 4 + 顶面 1） |
| item 复用 | elements 继承 + display 覆盖 |

**关键口径结论**：`expandBoxUV`/`parseFaceUV`（ADR-041，基岩版 box UV 展开）**不可直接复用**——Java 版每面显式 `uv` 像素坐标，输入口径不同；仅"像素÷纹理尺寸"归一化模式可借鉴。顶点顺序/UV 角映射取自 prismarine-viewer（多年验证与 MC 渲染一致）。

## 2. 决策（Decision）

### D1 · 新增 Go binding：`ListPackModels` / `ReadPackEntry`

- `ListPackModels(path) string`：枚举容器内 `assets/<ns>/models/{block,item}/**/*.json` 条目路径（升序 JSON 数组），复用 `container.Reader.Entries()`（ADR-068，统一支持 zip/目录/7z）；
- `ReadPackEntry(path, entry) string`：读容器内条目内容（base64），上限 64MB；entry 须 `assets/` 前缀 + 无 `..`/反斜杠/绝对路径（防穿越守卫）；
- 归置新文件 `internal/app/resourcepack_models.go`，不污染既有 `resource_bindings.go`。

### D2 · 前端 TS 解析器：`frontend/src/utils/3d/parse-java-model.ts`

POC `parse-java-model.mjs` 纯 TS 移植（零依赖），加载抽象为 `read(entry) → base64` 回调（JSON 经 atob 解码、PNG 直接 dataURL 给 TextureLoader）；模型/纹理尺寸缓存；`parseJavaModel(entry, read)` 输出面数据（positions 像素÷16 转米 + Three 域 UV + texEntry/texColor/tintindex）。

### D3 · `PackModelAdapter`（`frontend/src/preview-3d/adapters/pack-model-adapter.ts`）

对齐 ADR-066/072 适配器模式（参考 vrm-adapter/litematic-adapter）：

- `build(ctx, path)`：`ListPackModels` → 解析**首个完整可渲染模型**（有实际纹理定义的 block 模型；纯模板如 cube/cube_all 自动跳过）→ 逐面 `BufferGeometry` + `MeshStandardMaterial`（L3 材质升级，commit `0e5a7f63`，roughness 1.0 / metalness 0，真实响应三点布光；纹理加载 / 纯色兜底 / tint 面按 `tintindex` 4 类查表 `TINT_COLORS`，详见 §5）→ 挂 `ctx.scene` → 包围盒定相机；
- 模型浏览：`extraControls(topBar)` 挂"上一个/下一个"切换（含模型序号），重挂内容层，复用外壳（贴合 ADR-066 §5.6 的 3D 内切换语义）；
- `dispose()` 释放几何/材质/纹理；`onClose()` 复位列表状态。

### D4 · 预览路由：`PACK` handler 双通道

`frontend/src/views/app-preview/index.ts` 的 `[RESOURCE_TYPES.PACK]` 改为：`ListPackModels` 非空 → `mount3D(packModelAdapter, path)`；空 → 回退 `showResourcePack`（缩略图通道）。`resource_types.json` 的 `resourcepack.preview` 保持 `"thumbnail"` **不动**（避免 Go 一致性测试与扫描链路连锁；声明语义由 handler 双通道承接）。`shaderpack` 不进 3D。

### 不纳入本次范围

- blockstate variant 选择（默认变体渲染；完整支持二期）
- biome 精确染色（L3 仅做 `tintindex`→4 类视觉近似查表；biome 正确染色待 L4，见 §5）
- display 变换应用（静态方块预览用默认视角；item 手持视角后续）
- 光影 shaders（GLSL 依赖游戏管线，明确不做）

## 3. 后果（Consequences）

**正面**：
- 资源包从"缩略图卡片"升级为"包内模型 3D 浏览"，贴合全模型预览器定位；
- 新适配器 + 注册表 handler 一行接入，零污染既有渲染核心（`mount-preview-core.ts` 不动）；
- POC 已验证解析口径，落地即复用，无算法风险。

**负面 / 风险**：
- 🟡 blockstate 未处理：贴地方块（楼梯/栅栏等）只显默认变体，观感不完整——二期按 `variants` 提供选择；
- 🟡 tint 面染色：L3 为 `tintindex`→4 类视觉近似（非 biome 语义正确）；biome 正确染色待 L4（§5.4）；
- 🟢 资源包模型量大（vanilla 数百个）：列表/切换性能需懒解析（当前仅解析当前模型）。

**已知遗留**：
- `ListPackModels` 首次枚举大包（数百 MB）耗时随条目数线性，可后续加缓存；
- 目录型资源包（解压目录）经 `container.OpenDir` 天然支持，未单独验证。

## 4. 数据溯源

- **来源**：用户对话（2026-08-16，资源包渲染可行性讨论）+ POC 实测（`poc/mc-java-model/`：真实 vanilla 1.21.4 样本 + prismarine-viewer 权威 UV 角映射 + grass_block_side 像素级方向断言）。
- **方法**：POC 解析器 21 断言全绿 → 立项落地（本 ADR）。
- **结果**：解析口径全部锁定（parent 链/变量/UV/旋转/tint/display 继承），落地改造面 = Go 2 binding + TS 1 解析器 + 1 适配器 + 路由 1 行。

## 5. 材质与 tint 演进

### 5.1 L3 材质升级（commit `0e5a7f63`，仅改 `pack-model-adapter.ts`）

| 项 | 之前 | 之后 |
|----|------|------|
| 材质类 | `MeshLambertMaterial` | `MeshStandardMaterial`（roughness 1.0, metalness 0）—— 真实响应三点布光/聚光灯 |
| tint 面颜色 | 所有面硬编码草绿 `0x7cbd4b` | 按 `tintindex` 4 类查表 `TINT_COLORS = [0x59ad47 草, 0x65b065 叶, 0x3f76e4 水, 0x7c4e08 枯枝]` |
| 释放 | 只 `dispose` material | 额外 `dispose` `material.map`（贴图引用） |

> **⚠️ 归属纠正**：提交 `0e5a7f63` 的 commit message 写「ADR-084 L3」，但 **ADR-084 是三点布光/体积光（L3 = 体积光），与材质/tint 无关**。此工作归属 **ADR-080**（适配器头部亦标注 `ADR-080 + ADR-084 L2`）。Commit message 为历史记录，不重写；此处以文档确权。

### 5.2 交叉参考

- 算法与机制参考卡：`docs/knowledge/mc-ao-tint.md`（定向只读 `prismarine-viewer`，**不引入其渲染器**）。
- 该卡含：MC AO 4 档顶点权重公式 + 各向异性翻转、biome 配色（`minecraft-data` tints 表思路 / 备选 colormap PNG 采样公式）、`tintindex` 语义澄清。

### 5.3 L4 未覆盖项（状态对账）

| 项 | 状态 | 说明 |
|----|------|------|
| MC AO（4 段阴影） | 🟡 待定 / 非阻塞 | 依赖邻居块查询，单模型预览无邻居 → 实测全亮收益为 0；算法已备（卡 §1），需先合成 3×3×3 邻域或接受全亮 |
| biome 正确 tint（默认 plains） | ✅ 已落地（L4） | 默认 plains 色取 MC Wiki biome 表常量；water 用 vendored tints 表；全 biome 选择见 §5.4 |
| NormalMap / Emissive | 🟢 确认放弃 | MC Java block model 格式几乎不用，加了无实际效果 |

### 5.4 biome 正确 tint 可行性评估（引入 `minecraft-data` tints 表）

**数据资产层面 —— 完全可行、极轻量：**

- `minecraft-data` 的 `tints.json`（1.21.4）仅 **8.1 KB**，结构为 `grass/foliage/water/redstone/constant` 各含 `data: [{keys:[biome名...], color:int24}, ...]`，即 **biome 名 → 打包 RGB（0xRRGGBB，解码 `r=(c>>16)&255, g=(c>>8)&255, b=c&255`）**。
- **结论：不要引入 `minecraft-data` 整包（多版本多 MB）作为运行时依赖**。正确做法是**仅 vendoring 目标版本的 `tints.json`（~8KB）为静态资产**（`frontend/src/assets/` 或 `docs/data/`），零依赖、可审计、可随版本切换。

> **L4 落地修正（重要发现）**：实现时证实 `tints` 表对**默认 biome 的 grass/foliage `color=0`**（哨兵：意为"需走 colormap 采样"），仅 **water 与例外 biome**（badlands/cherry_grove/dark_forest/swamp 等）存真实固定色。因此「vendoring tints.json 即得 biome 草/叶色」的假设**不成立**——tints 表本身不含默认 biome 草/叶色。
> **L4 实际取值**：grass/foliage 默认用 **MC Wiki biome 颜色表**（Plains: temperature 0.8 / downfall 0.4 → 草 `#91BD59`、叶 `#77AB2F`，等价于对 grass.png/foliage.png colormap 在 plains 坐标采样的结果）；water 用 tints 表（`0x3F76E4`，与 MC Wiki 吻合）；`tints.json` 仍 vendored 供未来例外 biome / 全 biome 路径。colormap 运行时采样（canvas）为 L5 全 biome 选项的真正落地方式。

**两个真实缺口 —— 决定能否"语义正确"（范围决策核心）：**

1. **block → tint 类别映射缺口**：`tints` 表按 **biome 名** 索引，不按方块。MC 真实链路是 `BlockColors`（Java 代码，非数据）把「方块 → 染色类别（grass/foliage/water）」注册好，再结合 biome 查表。模型 JSON 只带 `tintindex`（自由整数），**不含方块身份 → 染色类别**。补齐方式三选一：
   - (a) **纹理/模型名启发式**：`*_grass` / `*_leaves` / `*_water` 子串 → 类别（覆盖多数 vanilla，脆弱）；
   - (b) **手工策划 `blockName → tintCategory` 小表**（约 30 个常见染色方块）；
   - (c) 经 `minecraft-data` `blocks` 反查 → 但模型名 ≠ 注册方块名（资源包有命名空间），不可靠。
2. **biome 上下文缺口**：单模型预览**无世界/无 biome**。即便有了 `tints` 表，不指定 biome 就只能取单一颜色（如 `plains`）。biome 染色的真正价值是「同一草方块在不同 biome 显不同色」——这对模型预览器是**加分项而非核心**。

**推荐范围决策（按目标分档）：**

| 目标 | 方案 | 工作量 | 推荐度 |
|------|------|--------|--------|
| 让草/叶/水"看起来对"（默认 plains） | vendoring `tints.water[plains]`（0x3F76E4）+ grass/foliage 取 MC Wiki biome 表常量（#91BD59/#77AB2F，= colormap 采样） | 极小（~8KB 资产 + 数十行查表） | ✅ **已落地（L4）** |
| 用户选 biome → 模型重染色 | 加 biome 下拉（~80 项）+ block→类别启发式/小表 + 重渲 | 中等 | 🟡 可选（需 §5.4 缺口 1/2 一并解决） |
| 完整 MC biome 保真 | 引入 chunk/世界 biome 解析 | 大 | ❌ 不推荐（推倒重来红线，超出预览器定位） |

> 即：**数据表本身零障碍，障碍在"方块身份"与"biome 上下文"两个语义层**。落地默认 plains 染色属低风险、可立即纳入 L4；完整 biome 选择需另行立项评估。

<!-- 文件名: pack-model-adapter.md → 实际文件 ADR-080-pack-model-adapter.md -->
