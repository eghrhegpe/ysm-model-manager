# ADR-131：3D 渲染期统计提取（预览期统计与类型判定解耦）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-29
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/utils/3d/adapters/mount-preview-core.ts:124 (PreviewAdapter.build), frontend/src/views/app-preview/tpl.ts:79 (statsCardHTML / StatsCardModel), frontend/src/utils/3d/adapters/vrm-adapter.ts:106 (readVrmMeta), internal/app/resourcepack_models.go:49 (ListPackModels), ADR-080 (pack-model-adapter)`

---

## 1. 背景（Context）

### 1.1 统计卡缺数据源

`statsCardHTML(StatsCardModel)`（`frontend/src/views/app-preview/tpl.ts:79`）是统一统计卡渲染器，YSM 车万女仆已复用（`maid-3d.ts` 的 `toStatsCardModel`）。但 3D 格式里只有 YSM/车万女仆有完整统计；**VRM / MMD / Litematic / FBX / 资源包**打开 3D 预览时没有统计卡——缺的不是渲染器，是从 three.js 场景图提取统计的数据源。

### 1.2 所有 3D 格式已过一个汇聚点

`mount-preview-core.ts:124` 的 `PreviewAdapter.build(ctx, path) → PreviewScene` 是全部富格式 3D 预览的统一入口（YSM/VRM/MMD/FBX/Litematic/资源包全走这里）。在此挂钩子，所有格式自动受益，无需逐格式改。

### 1.3 重复解析已存在

VRM 详情卡为了取 meta 已在 `vrm-adapter.ts:106` 的 `readVrmMeta` 单独 parse 了一遍 GLTF。骨骼/网格/纹理统计应顺带产出，零额外成本。

### 1.4 资源包模型无统计

Go `ListPackModels`（`internal/app/resourcepack_models.go:49`）只返回路径 `string[]`，无立方体数。JSON 模型 `elements`/`cubes` 结构简单，Go 解析成本极低，但当前详情页只显示 pack.mcmeta + png + 版本。

---

## 2. 决策（Decision）

**3D 统计在渲染期从场景图提取（「能渲染就能出统计」），与扫描期类型判定完全解耦。** 核心是两条：

### 2.1 扫描期分类不动，预览期统计换源（红线）

- **扫描期**：tab / 分类 / 筛选仍由 `resource_types.json` + Go 判定，前端只读不判。「3D 能渲染」只作为**预览期**的统计来源，不参与归类——否则每次扫描要解析全量文件，O(N) 成本不可接受。
- **预览期**：统计从已渲染的 three.js 场景图提取，一次 traverse 产出，比渲染本身便宜几个量级；严禁放进每帧 `update`。

### 2.2 通用统计提取器（P0 方向）

新建纯函数 `collectSceneStats(scene | roots): SceneStats`：一次 traverse 出骨骼数 / 网格数 / 三角面 / 材质数 / 纹理数 / 表情数（morph），映射进既有 `StatsCardModel`（**新增可选字段**，不破坏 maid-3d/skeleton 既有复用）。

实现陷阱：`texture.image` 在异步加载完成前是 null——统计必须在纹理 onLoad 后或首帧渲染后采集，否则纹理尺寸全为 0×0。提取器本身只计数量，纹理尺寸由调用方在 onLoad 后补。

### 2.3 核心 post-build 挂点 + 声明式菜单面板（P1 方向）

- 挂点：`adapter.build` 返回后，用 sceneBaseline 差量定位内容层 roots → `collectSceneStats`。
- 统计面板走既有声明式菜单 `PreviewMenuNode`（`preview-menu/node-types.ts` 的 `panel` / `field` 类型正合统计展示），`visibleWhen: (s) => stats 非空` 才显示——**不手写 3D 菜单，可被所有数组类菜单调用**（铁律）。
- **合并注入**：核心层统计面板必须与 `built.menuItems` 合并后**一次** `setAdapterItems`，避免互相覆盖（`mount-preview-core.ts:760` 已有一次注入）。

### 2.4 详情卡补行（P2 方向）

VRM 复用 `readVrmMeta` 那次 GLTF parse 顺带出统计；MMD 从 `mmd-pmx-parser` 解析结果取（头部本有顶点/材质/骨骼数）。填进现有 meta 卡，不新增重复卡（沿用去重约定）。

### 2.5 资源包模型清单（P3 方向）

Go 侧扩展模型枚举带立方体数（Go 解析 JSON `elements`，封顶前 N 条防大包）；前端详情页加「🧊 模型清单 (N)」区，点击单模型直达 `pack-model-adapter` 3D。`web-fs.ts` 镜像同构（网页版无 Go，web-fs 就是网页的 backend）。倾向**新增绑定**而非改 `ListPackModels` 返回类型，最小破坏面（现有 4 处消费者）。

---

## 3. 后果（Consequences）

### 正面

- 一次挂点，所有格式自动获得统计——YSM/VRM/MMD/Litematic/资源包全覆盖。
- 统计与类型判定解耦：扫描 O(N) 成本不变，统计只在预览期按需产出。
- 复用既有 `StatsCardModel` / `statsCardHTML` / 声明式菜单，不新增平行渲染器。

### 负面

- 统计面板只对「能渲染」的模型可见（`visibleWhen` 守卫），不能渲染的格式无统计——语义上正确，但面板项入口分布不均。
- 资源包大包（数百+模型）清单需 Go 侧封顶 + 前端懒加载，超限只显示 total。

### 已知遗留

- 纹理尺寸时序：异步纹理 onLoad 前统计拿不到尺寸，需调用方在 onLoad 后补采（P0 实现陷阱）。
- 类型判定红线不动：统计换源不改变 `resource_types.json` + Go 的归类结果。

---

## 4. 数据溯源

来源 → 结果：

- `mount-preview-core.ts:124`（PreviewAdapter.build 汇聚点）→ post-build 挂点位置
- `tpl.ts:79`（StatsCardModel 字段现状）→ 新增可选字段的兼容基线
- `vrm-adapter.ts:106`（readVrmMeta 重复 parse）→ P2 零额外成本的依据
- `resourcepack_models.go:49`（ListPackModels 返回 string[]）→ P3 扩展点

<!-- 文件名: preview-stats-extraction.md → 实际文件 ADR-131-preview-stats-extraction.md -->
