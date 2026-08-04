---
kind: model3d
name: 3D 预览渲染 model3d
tier: architecture
category: utils
source_files:
  - frontend/js/utils/3d/model3d.ts
  - frontend/js/components/app-preview/model3d-loader.ts
  - frontend/js/utils/3d/model3d-spec.ts
use_when:
  - 3D 预览
  - Three.js
  - 相机
  - 骨骼渲染
  - 自由相机
  - 3D 截图
  - 纹理加载
  - spec 兜底
  - OrbitControls
---

# 3D 预览渲染 model3d

## 概览

前端 Three.js 3D 渲染层，由三个文件组成：`model3d.ts` 负责场景搭建/相机/渲染循环，`model3d-loader.ts` 负责纹理与 spec 加载（Go binding 优先 + JS 兜底），`model3d-spec.ts` 是 JS 端兜底 spec 构建算法（与 Go `threejs.Build()` 口径一致）。几何数据（顶点/法线/UV/骨骼四元数）全部由 Go 端 [go_threejs](./go_threejs.md) 预计算，本层只渲染、不做几何计算。

## 核心职责

- Three.js 场景搭建：PerspectiveCamera(45°) + OrbitControls + 环境光/双方向光 + GridHelper/AxesHelper
- 骨骼层级组树构建（buildSceneMesh）、mesh 合并与纹理槽分配、渲染循环、骨骼拾取回调
- 纹理并行加载（NearestFilter 像素风采样、低分辨率纹理过滤）、spec 获取（Go 优先 + LRU 缓存 + JS 兜底）
- JS 兜底 spec 构建（同名骨骼合并、box UV / faceUV 解析）

## 对外 API / 入口

`model3d.ts`：
- 类型：`Spec3D` / `SpecModelGroup3D` / `SpecBone3D`（localPosition/localRotation 四元数 [x,y,z,w]/parentId）/ `SpecMeshGroup3D`（positions/normals/uvs/indices/texIdx）/ `BoneSelectInfo` / `RenderModel3DHandle`
- `buildSceneMesh(spec: Spec3D)` — 构建骨骼 Group 树，返回 `{ boneGroupMap, rootGroup, modelScale, meshMax }`；modelScale 按顶点最大绝对值缩放（>32 → 1/16，>4 → 1/4）
- `renderModel3D(container, texArr, spec, texIdx=0): Promise<RenderModel3DHandle>` — 渲染主入口；句柄含 resetCamera / setSpeed / setRotationMode（轨道/自由相机切换）/ setBoneVisible / getBoneList / toggleBone / showModelGroup / getModelGroupCount / onBoneSelect（骨骼选中回调）/ setDebugMode("normal"|"pivot"|"bone") / cleanup
- `screenshotPreview(): string | null` — 截取当前画面为 PNG base64（无 data: 前缀），依赖 renderer 的 `preserveDrawingBuffer: true`

`model3d-loader.ts`：
- `loadTextures(urls?): Promise<THREE.Texture[]>` — 并行加载，flipY=false + NearestFilter + SRGB；按像素量阈值过滤过小纹理；全失败时警告并返回空数组（fallback 颜色）
- `preloadModel(model): Promise<{ texArr, spec }>` — 纹理 + spec 并行预加载；内部 fetchSpec（未导出）走 Go `GetModel3DSpec` binding 优先（模块级 specCache，LRU 上限 20），失败或空 models 时用 `buildSpecFromModel` JS 兜底
- `ModelLike` / `ModelSpec` 接口 — 轻量模型对象与 spec 结构

`model3d-spec.ts`：
- `buildSpecFromModel(model: SpecModelInput): SpecBuildResult` — JS 兜底算法，与 Go `threejs.Build()` 一致：同名骨骼去重（首次无 parent、后续带 parent → cube 整体替换；否则 mergeCubes 重叠替换/非重叠保留）、cube 坐标转骨骼局部系、box UV / faceUV JSON 解析

## 渲染循环与交互

- **渲染循环**：`requestAnimationFrame(loop)` 启动（`_rafId` 保存，cleanup 时 `cancelAnimationFrame`），每帧 `renderer.render(scene, camera)`；默认 OrbitControls 轨道模式，`setRotationMode(false)` 切自由相机（WASD 平移 + 空格/Shift 升降，`_keys` 按键状态机驱动，`_camSpeed` 可调）
- **骨骼拾取**：`Raycaster.setFromCamera(pointer, camera)` + `intersectObjects(scene.children, true)` 反投影；pointermove 更新 `_hoveredBone`/`_hoveredMesh` 与 cursor（命中 pointer / 未命中 default）；click 命中时经 `_boneNameMap`/`_boneParentMap`/`_boneChildrenMap` 组装 `BoneSelectInfo`（name/path/parent/children/meshCount/localPos/worldPos/cube 四元数）调 `handle.onBoneSelect`——boneId 先局部收窄再传参（TS 对闭包捕获变量不做控制流收窄）
- **调试模式**：`setDebugMode("normal"|"pivot"|"bone")` 循环切换，`rebuildDebug()` 重建叠加层（pivot 标记 / 骨骼线框）
- **mesh 合并**：同一骨骼下按 `boneId + ":" + texIdx` 分组，同组多个 MeshGroup 合并顶点/法线/UV/索引，减少 draw call；`thicknessEpsilon` 避免零厚度面

## 与其他子系统关系

- 消费方：`app-preview/preview-skeleton.ts`（动态 import renderModel3D / preloadModel / screenshotPreview）、`utils/screenshot-renderer.ts`（复用 buildSceneMesh + loadTextures 做离屏多角度截图）
- 上游数据：Go `GetModel3DSpec` binding ← [go_threejs](./go_threejs.md) `threejs.Build()`；纹理/模型对象来自 [go_geometry](./go_geometry.md)
- 相机/调试状态存于模块级 `_scene3d/_camera3d/_renderer3d/_rootGroup3d`（供 screenshotPreview 使用，cleanup 时置空，不挂 window 全局）

## 不变量

- **致命陷阱 #11**：3D 坐标变换是全项目 fix 次数最多的区域（model3d.ts 历史 fix 第一）。坐标口径必须对齐 YSMViewer：pivot X 取反、`from.x = origin.x - size.x`（Go go/threejs 实现，JS 兜底 model3d-spec.ts 必须同口径）。改 model2d/model3d/threejs spec 前先 grep `docs/archive/bug-chronicle.md`，改完用自由相机近距验证
- cleanup() 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/mouse/resize/fullscreenchange 全部监听、dispose controls/renderer/geometry/material、清空容器 —— 缺一即泄漏
- 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径；JS 兜底仅为 Go spec 不可用时的降级
- 治理红线 R1：模块级状态不挂 `window.__*`

## 相关

- [go_threejs](./go_threejs.md) — spec 生成（Go 端）
- [model2d](./model2d.md) — 2D 预览（同一坐标口径约束）
- [app_preview](./app_preview.md) — 预览面板消费方
- [utils_export](./utils_export.md) — 截图与导出
- `frontend/js/utils/3d/model3d-spec.test.js` — JS 兜底 ↔ Go 口径黄金样本测试（验证入口）
- AGENTS.md 致命陷阱 §二 #11
