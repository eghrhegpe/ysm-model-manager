---
kind: go-threejs
name: 3D 骨骼 spec go/threejs
tier: architecture
category: go
source_files:
  - go/threejs/spec.go
  - go/threejs/
use_when:
  - 3D 预览
  - 骨骼
  - three.js
  - spec
  - 顶点
  - UV
  - 四元数
  - 模型渲染
invariant_anchors:
  - go/threejs/spec.go|PivotSet
---

# 3D 骨骼 spec go/threejs

## 概览

`go/threejs/` 包根据 YSMViewer 的 `ThreeJsPayloadBuilder.cs` 移植，把已解析的 `types.BedrockModel` 转换为 Three.js 可直接消费的 JSON spec：顶点、法线、UV、骨骼层级与旋转四元数全部在 Go 端预计算，前端 `model3d.ts` 只负责渲染，不做几何计算。

## 核心职责

- `spec.go` — 骨骼层级构建（pivot 差值求局部坐标）、cube 网格生成（box UV 展开 / per-face UV）、同名骨骼去重合并、欧拉角转四元数

## 对外 API / 入口

- `Build(model types.BedrockModel) (string, error)` — 唯一构建入口，输入解析好的 BedrockModel，输出 JSON 字符串；无骨骼时返回 `"{}"`
- 输出结构类型：`Model3DSpec`（models 列表）、`ModelGroup`（纹理尺寸/骨骼/网格组）、`BoneData`（localPosition + localRotation 四元数 [x,y,z,w] + parentId）、`MeshData`（positions/normals/uvs/indices/texIdx 纹理槽）

## 与其他子系统关系

- 被 `internal/app/app_model.go` 调用（`threejs.Build` 生成 spec → Wails binding 下发前端）
- 上游输入来自 [go_geometry](./go-geometry.md) / [go_ysm_parser](./go-ysm-parser.md) 解析出的 `types.BedrockModel`
- 前端消费方：`frontend/src/utils/3d/model3d.ts`（Three.js 渲染）

## 不变量

- 骨骼局部坐标 = `bone.pivot - parent.pivot`；Blockbench 欧拉角取反后转四元数（`eulerToQuaternion(-rx, -ry, -rz)`），口径对齐 YSMViewer
- 纹理尺寸为 0 时兜底 64×64
- **cube inflate/mirror 消费**（2026-08-09 补齐，对齐 Java GeoCube/GeoQuad 口径）：`inflate` 时几何 origin 各轴 -i、size 各轴 +2i（Go 端像素坐标直接算，无需 /16）；`mirror` 时 UV 水平翻转（u 交换，几何不翻转）。box UV 展开（`parseUV`/`expandBoxUV`）**必须基于未膨胀的原始尺寸 `c.Size`**——对齐 C# 黄金参考 `csharp-builder.mjs`（先 `expandBoxUV(原始 sz)` 再 inflate 几何），若用膨胀后尺寸 UV 范围漂移 → 贴图拉伸/塌缩成色块（P2）
- **负 inflate 下限防护**：inflate 超过半尺寸会把 cube 缩成负宽 → `hx2<0` 面翻转（法线反、正面剔除后不可见）；各轴 clamp 到 `thicknessEpsilon`（C# 黄金参考同缺陷，此为改进不背离）
- **cube pivot 缺席 fallback（PivotSet 语义，2026-08-09 code_review P2）**：cube 未显式声明 pivot（Blockbench 缺省）时，spec 用 cube 中心作为旋转中心（对齐 YSMViewer，修复 fox 解压目录模型 main 手臂消失 P1）；**判定必须用 `types.Cube2D.PivotSet`（解析层 `*[3]float64` nil=缺席）而非 `cp==[0,0,0]`**——显式 `pivot:[0,0,0]` 是绕模型原点旋转的合法铰接件，误判会漂移旋转中心。手工构造 Cube2D 的测试 fixture 须同步设 `PivotSet: true`（致命陷阱 #17）
- 同名骨骼合并：优先保留有 parent/有旋转的完整层级（main.json 覆盖 arm.json 的扁平版），cube 用 `mergeCubes` 重叠替换、非重叠保留
- 坐标变换是高危区：前端 model3d.ts 历史 fix 次数全项目第一（致命陷阱 #11），改本包坐标/UV 前先 grep `bug-chronicle`，改完用自由相机近距验证

## 相关

- [go_geometry](./go-geometry.md) — BedrockModel 来源（ZIP/7z/JSON 解析）
- [go_ysm_parser](./go-ysm-parser.md) — YSM 格式解析
- AGENTS.md 致命陷阱 §二 #11（3D 坐标变换）
