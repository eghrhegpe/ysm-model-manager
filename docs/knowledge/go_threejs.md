---
kind: go_threejs
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
- 上游输入来自 [go_geometry](./go_geometry.md) / [go_ysm_parser](./go_ysm_parser.md) 解析出的 `types.BedrockModel`
- 前端消费方：`frontend/js/utils/3d/model3d.ts`（Three.js 渲染）

## 不变量

- 骨骼局部坐标 = `bone.pivot - parent.pivot`；Blockbench 欧拉角取反后转四元数（`eulerToQuaternion(-rx, -ry, -rz)`），口径对齐 YSMViewer
- 纹理尺寸为 0 时兜底 64×64
- 同名骨骼合并：优先保留有 parent/有旋转的完整层级（main.json 覆盖 arm.json 的扁平版），cube 用 `mergeCubes` 重叠替换、非重叠保留
- 坐标变换是高危区：前端 model3d.ts 历史 fix 次数全项目第一（致命陷阱 #11），改本包坐标/UV 前先 grep `bug-chronicle`，改完用自由相机近距验证

## 相关

- [go_geometry](./go_geometry.md) — BedrockModel 来源（ZIP/7z/JSON 解析）
- [go_ysm_parser](./go_ysm_parser.md) — YSM 格式解析
- AGENTS.md 致命陷阱 §二 #11（3D 坐标变换）
