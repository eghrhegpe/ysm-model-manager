# ADR-118：面级透明分类：mesh 级 alpha 误判数据与分阶段落地

- **状态**：已采纳（Accepted）——Phase A 已实施（2026-08-23）；Phase B 已实施（2026-08-24，AlphaIndex 面级路由落地，见 §6）
- **日期**：2026-08-23
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/translucency-probe.ts`; `frontend/src/utils/3d/texture-alpha.ts`; `frontend/src/utils/3d/ysm-object.ts`; upstream/ModernYSM-1.20.1-forge `YSMClientMapper.TranslucencyScanner`

---

## 1. 背景（Context）

### 1.1 现状：mesh 级（整纹理）alpha 分类

前端管线对每张纹理跑一次 `classifyRgba` 全纹素扫描：任一半透明像素 → 整纹理判 **blend**（`transparent:true + depthWrite:false`）；仅全透明像素 → **cutout**（`alphaTest:0.1`）；否则 **opaque**。一个模型的全部 mesh 共享主纹理的单一判定结果。

### 1.2 危害机制

真实 YSM 纹理的半透明像素多为**孤立杂点**。skin.png 含任意一个杂点 → 整模型判 blend → 全部面进透明管线：排序敏感、深度写关闭、易穿透伪影。这正是用户长期体感「透明度一直损坏」的候选根因之一。

### 1.3 体感与数据的反差（本 ADR 的关键张力）

- **数据侧**：探针实测 wine_fox 22 模型 80.9% 的面在 mesh 级分类下走错管线（见 §4）。
- **体感侧**：单女仆、单 YSM 模型场景的渲染问题实测**很轻**；兄弟会话正在摸排**纹理竞争**问题，可能是单模型场景的主要可见病灶。

即：mesh 级误判普遍存在但单场景危害有限，当前优先级让位于纹理竞争排查。

### 1.4 参照实现

ModernYSM（upstream vendor）用 **TranslucencyScanner**：加载时逐像素打三 flag（F_VISIBLE/F_HOLE/F_TRANSLUCENT），8×8 tile 聚合 + 前缀和构成 **AlphaIndex**，O(1) 查询任意 UV 矩形的特征组合；`IGeoRenderer.getRenderType` 按 flag 做 **per-face** RenderType 路由。MC 逐面提交 buffer 无烘焙合并，不存在我们的烘焙塌陷形态，但其算法可直接移植为查询层。

## 2. 决策（Decision）

**采纳分阶段路线，本轮只固化事实与方案，不实施代码改动：**

| 阶段 | 内容 | 规模 | 触发条件 |
|------|------|------|----------|
| **A 快赢版** ✅ 已实施 | `classifyRgba` 加阈值守卫：半透明像素占比 < ~0.5% 判 cutout（杂点免疫） | 十行级 + 测试 | 2026-08-23 纹理竞争排查落地后实施，实测见 §5 |
| **B 完整面级版** | AlphaIndex 移植进前端管线（buildYsmObject / mesh-builder / mesh-baker），按面拆分几何分组路由材质 | 重活，跨渲染核心 | A 后仍有真混合模型渲染质量问题（如 18_wedding 类），或需要面级精度做排序优化 |

配套决策：

- **探针脚本转正**：`scripts/translucency-probe.ts`（零依赖 PNG 解码 + AlphaIndex 复刻 + 面级统计）保留为度量工具，作为后续任何透明改动的基线出处。
- **危害方向共识**：`blend`（`depthWrite:false`）不得作为整模型默认值——它是数据上最差的全局选择（§4）。
- **实施纪律**：两阶段均 TDD；Phase B 动烘焙前先出 draw call / 性能基准。

## 3. 后果（Consequences）

**正面**

- 80.9% 错路率成为量化基线，后续渲染改动可对照验证收益。
- Phase A 低风险随时可启动；Phase B 有 ModernYSM 参照 + 探针已验证的算法。
- 「体感轻 ≠ 无病」被数据钉死，避免未来误判为「透明度没问题」。

**负面 / 遗留**

- 本轮不改代码：用户可见问题疑似由纹理竞争主导，本 ADR 不解决竞争。
- 探针将所有面映射到主纹理（忽略 arm/arrow 等次纹理绑定），错路率为近似上界。
- Phase B 按面拆分会增加 draw call 与烘焙复杂度，未做性能评估。

## 4. 数据溯源

探针：`node scripts/translucency-probe.ts "upstream/[YSM模型]官方开源wine_fox_json"`（2026-08-23 实测）

| 指标 | 数值 |
|------|------|
| 模型数 / 总面数 | 22 / 133,318 |
| mesh 级分类错路面数 | **107,825（80.9%）** |
| 真 blend 面占比 | ~1.2%（真实纹理几乎全二值 alpha） |

典型个案：

| 模型 | 错路率 | 说明 |
|------|--------|------|
| 14_momo / 19_nine_tailed | 100% | 杂点 → 全局 blend |
| 01_taisho | 99.7% | 同上 |
| 08_sta | 99.3% | 同上 |
| 22_elf | 98.1% | 同上 |
| 18_wedding | 93.9% | 含 1219 真 blend 面，是真混合案例——blend 路径有价值但不可全局化 |

方法学：零依赖 Node zlib 解 PNG（colorType 0/2/3/4/6，bitDepth 8，非隔行）；AlphaIndex 复刻 TranslucencyScanner（像素 flags + TILE=8 前缀和网格）；globalMode 与前端 `classifyRgba` 同口径（any-translucent→blend / only-hole→cutout）；boxUvFaces 兼容 box-UV 数组与 per-face uv 对象（负 uv_size 归一化）。扫描 `models/*.json` 的 `bones[].cubes[]`。

## 5. Phase A 落地实测（2026-08-23）

实现：`texture-alpha.ts classifyRgba` 改为统计半透明像素占比，`> BLEND_MIN_RATIO` 才判 blend（当前 **0.05 = 5%**，初值 0.005 = 0.5% 的收敛依据见 §5 末尾）；测试 `texture-alpha.test.ts` 6 用例（含杂点免疫与超阈保持 blend 双向锁定）。

探针新旧口径对比（同 wine_fox 语料）：

| 指标 | 旧口径（任一半透明→blend） | 新口径（阈值 0.5%） |
|------|------|------|
| 错路总面数 | 107,825（80.9%） | **47,405（35.6%）** |
| blend→cutout 翻正模型 | — | 8 个（01_taisho / 08_sta / 13_matured / 14_momo / 15_kluonoa / 19_nine_tailed / 20_survivor / 22_elf） |
| 真混合模型 | 18_wedding 判 blend（对） | 18_wedding 保持 blend（对） |

剩余 35.6% 为 cutout 全局模型拖 opaque 面白跑 alphaTest——纯性能/纯度问题而非 depthWrite 正确性危害，归 Phase B 面级拆分范畴。

**阈值收敛（`BLEND_MIN_RATIO`: 0.005 → 0.05，2026-08-25）**：上表实测沿用初值 0.005（0.5%）。对真实长效材质 0.5% 仍过松——车漆抗锯齿、窗玻璃边缘的半透明像素常占整图 0.5%~5%，会把整 mesh 误判为 blend 导致透明排序错乱。收紧至 `BLEND_MIN_RATIO=0.05`（5%）后，此类噪声边缘纹理判 cutout/opaque，仅具大面积半透明本体（如真实玻璃）的纹理才进 blend 管线。前端纹理入口 `classifyRgba` 已同步。

## 6. Phase B 落地实测（2026-08-24）

实现（TDD，全绿：3d 域 67 文件 / 904 测试 + typecheck + vite build）：

| 模块 | 职责 |
|------|------|
| `alpha-index.ts` | AlphaIndex 移植：像素三态 flags + TILE=8 前缀和；**改进**——小矩形（≤128px²）精确逐像素扫描，不继承 Java tile 近似的邻域污染（前端面矩形普遍几十像素），大矩形才走 tile 加速 |
| `texture-alpha.ts` | 新增 `getTextureAlphaInfo(texture)`：一次像素读取同时产出全局 mode + AlphaIndex + 尺寸，缓存 `userData.ysmAlphaInfo`；`getTextureAlphaMode` 变为包装不破坏旧 API；顺带修复 canvas 采样高度误用 width 的复制粘贴 bug |
| `face-split.ts` | `splitMeshByFaceAlpha(md, texture)`：逐三角形 UV 包围盒 → 像素矩形 → query → mode 分桶；flipY=true 或无索引纹理回退 null（调用方走整图模式） |
| `mesh-baker.ts` | `bakeMeshFragments({md,mode}[])`：批次 key 加 mode 维度（防混材质），id 后缀 mode |
| `mesh-builder.ts` | `addMeshToBoneGroup` 加 `modeOverride` 参数：碎片模式优先于整纹理判定 |
| `ysm-object.ts` | 统一碎片流：能拆分的按面路由，不能拆分的回退单碎片整图模式；**blend 碎片保持独立 mesh 不烘合**（维持逐 mesh 深度排序契约），cutout/opaque 碎片烘合 |

关键决策与理由：

- **面级 mode 严格 flags 口径**（any translucent→blend / hole→cutout / else opaque）：同探针 ground truth 与 ModernYSM。Phase A 阈值守卫已在纹理入口挡掉杂点噪声，进入面级的纹理都是真混合，无需再设阈值。
- **blend 不烘合**：初版把 blend 碎片也烘进批，被既有测试「keeps partial-alpha cubes separate for transparent depth sorting」当场拦下——透明排序粒度从 mesh 级粗化到批级是语义回退。修正后 blend 碎片透传保 transform。
- **UV 方向**：YSM 主链路 `model3d-loader.ts:62` 统一 `tex.flipY=false`，spec 的 v 直接映射图像行域，像素查询 `y=v*h` 无需翻转；flipY=true 纹理保守回退。

效果口径（对照 §5 探针）：面级路由即探针的 ground truth 本身——错路面数按定义归零；剩余收益为 cutout 全局模型的 opaque 面不再白跑 alphaTest、真 blend 面（如 18_wedding 1219 面）精确隔离。已知近似不变：探针/前端均以主纹理代表全部绑定。
