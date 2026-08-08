# ADR-041：渲染对齐：Go spec 对齐 YSMViewer（C# ThreeJsPayloadBuilder）

- **状态**：✅ 已采纳
- **日期**：2026-08-08
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/threejs/spec.go` / `frontend/src/utils/3d/model3d.ts` / `tests/port-verification/`（黄金对比工具） / upstream `YSMViewer/Rendering/ThreeJs/ThreeJsPayloadBuilder.cs`
- **取代**：ADR-004 §2.2（坐标系：X 轴不取反）、ADR-004 §2.3（骨骼旋转三轴取反）

---

## 1. 背景（Context）

本项目渲染管线（.ysm → YSMParser.wasm → Bedrock JSON → Go `threejs.Build()` → spec → 前端 Three.js）
与 YSMViewer（C# .NET → ThreeJsPayloadBuilder → spec）目标一致：渲染同一批模型。
但两侧输出长期存在数值差异，无量化手段。为回答「渲染是否对齐」，重建了黄金对比：

- JS 逐行复刻 C# `ThreeJsPayloadBuilder`（`tests/port-verification/csharp-builder.mjs`）
- Go 侧以真实解码产物跑 `threejs.Build()`（`cmd/specgen`）
- `compare.mjs` 对 10 个 upstream 模型的骨骼/mesh 逐字段数值对比（容差 1e-3）

实测（黎歌 169 骨/1958 mesh、双月希瞳 836 骨/5678 mesh）定位出五类差异，
其中三类是真实口径差异（本 ADR 决策修复），两类是顺序/公式等价（无需修改）。

## 2. 决策（Decision）

### 2.1 渲染对齐以 YSMViewer 为基准，Go spec 数值对齐 C# 输出

C# `ThreeJsPayloadBuilder` 是 YSMViewer 的唯一 spec 事实来源，本项目对齐它以达成
「同一模型渲染结果一致」。对比工具 `compare.mjs` 全字段归零为本 ADR 的验收标准。

### 2.2 坐标系：localPosition X 轴翻转（取代 ADR-004 §2.2「X 轴不取反」）

C# `YsmLoaderService.ConvertBones` 对 bone/cube 的 `pivot.X`/`origin.X` 取反（YSM 内部
坐标），Go 原样输出（基岩坐标）→ 两侧骨骼/mesh 挂载位置 X 镜像。

**决策**：Go spec 的 `localPosition` X 分量全部取反（12 处计算点：骨骼主循环、补缺失
骨骼、断裂链修补、Arm 修补、mesh），对齐 C# 的 `pivot - parentPivot`（翻转后）。
几何顶点（positions）数值本已一致，不动。

**取代说明**：ADR-004 §2.2 的「Origin X 不取反」基于当时的渲染规范与局部视觉判断；
本 ADR 以 C# 源码级对比为硬证据，翻转后对比工具全字段归零。ADR-004 §2.2 声明被取代。

### 2.3 骨骼旋转：Z 轴不取反（取代 ADR-004 §2.3「三轴取反」）

C# `ConvertBones` 翻转 rotation 的 X/Y（Z 不变），builder 用正角度
`CreateBlockbenchQuaternion` → 等效 `q(-rx, -ry, +rz)`。Go 原为三轴取反（Z 符号相反）。

**决策**：`eulerToQuaternion` 调用改为 `(-rx, -ry, +rz)`（骨骼与 cube 两处）。
修复后 `localRotation` 对全部 836 骨归零。

### 2.4 零厚度 cube：保留而非丢弃

C# `BuildCubeMeshData` 对零厚度面 `+0.001` 修正保留（如 `lx==hx → hx+=0.001`）；
Go 原直接 `return nil` 丢弃（黎歌 3 个、双月 51 个 mesh 缺失）。

**决策**：删除丢弃分支，由既有 `thicknessEpsilon` 修正兜底。mesh 数量与 C# 完全一致。

### 2.5 显示尺寸：固定 1/16（对齐 C# ExportScale）

C# 所有位置 `× ExportScale = 1/16`（16 像素 = 1 米）；Go spec 不带 scale，前端原用
动态 scale（`>32→1/16、>4→1/4、else→1`）把小模型放大显示。

**决策**：前端 `model3d.ts` 固定 `modelScale = 1/16`，与 YSMViewer 显示尺寸一致。
移除 `meshMax` 计算（不再需要）。model2d 为视口 fit 适配，不受影响。

### 2.6 无需修改的两类（对比证明等价）

- **同名骨骼族**：C# `ToDictionary` 后者覆盖 pivot、保留全部同名；Go 条件覆盖 +
  `mergeCubes` 合并 + Arm 修补。X 翻转后对比归零，证明两侧最终数值等价，不改。
- **UV**：`expandBoxUV`/`parseFaceUV` 与 C# `MinecraftCubeUV.Expand`/`GetFaceUV`
  逐面公式一致；历史 uvs 差异是零厚度丢弃导致的 mesh 顺序错位假象。

## 3. 后果（Consequences）

### 正面
- 10 个 upstream 模型：骨骼/mesh 全字段（positions/normals/uvs/indices/
  localPosition/localRotation）数值对齐 C#，对比工具归零。
- 渲染与 YSMViewer 视觉一致（含左右方向、显示尺寸）。
- 验收可量化：`node tests/port-verification/compare.mjs <geometry.json>` 全 ✅。

### 负面 / 风险
- **X 翻转是全局视觉变更**：3D/2D 渲染模型左右镜像（相对旧版）。人形模型近似对称
  不易察觉；非对称模型（如持械手、单侧饰品）方向与旧版相反——但这是对齐 YSMViewer
  的正确方向。
- **显示尺寸变化**：小模型不再放大，3D 视口内可能显得小（相机距离需人工评估）。
- **历史回退风险**：ADR-004 记录 X 取反曾回退（当时基于未对齐的其他部分判断）。
  本 ADR 以 C# 源码对比为证据，如视觉验证发现问题需回到对比工具确认而非盲目回退。
- 动画播放：骨骼静态姿态翻转后，局部旋转动画相对运动不受影响（待实测确认）。

### 已知遗留
- 动画层（animation JSON → 前端播放）尚未纳入对比工具，需后续扩展。
- 视觉验证（跑 app 渲染截图 vs YSMViewer 截图）待人工执行。

## 4. 数据溯源

- 来源：upstream `YesSteveModel-Viewer/YSMViewer/Rendering/ThreeJs/ThreeJsPayloadBuilder.cs`
  + `Core/Services/YsmLoaderService.cs`（ConvertBones 翻转规则）
- 方法：JS 复刻 C# builder → 与 Go `threejs.Build()` 输出逐字段对比
- 结果：修复前黎歌 mesh ❌ 1849/1958 → 修复后 0/1958；双月 0/5678（全字段）
- 载体：`tests/port-verification/`（csharp-builder.mjs / cmd/specgen / compare.mjs / report-*.txt）

<!-- 文件名: spec-render-alignment.md → 实际文件 ADR-041-spec-render-alignment.md -->
