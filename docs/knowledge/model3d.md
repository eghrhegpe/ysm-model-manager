---
kind: model3d
name: 3D 预览渲染 model3d
tier: architecture
category: utils
source_files:
  - frontend/src/utils/3d/model3d.ts
  - frontend/src/views/app-preview/model3d-loader.ts
  - frontend/src/utils/3d/model3d-spec.ts
tests:
  - frontend/src/utils/3d/model3d-spec.test.ts
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
invariant_anchors:
  - frontend/src/utils/3d/model3d.ts|modelGroups
  - frontend/src/views/app-preview/model3d-loader.ts|specCache
---

# 3D 预览渲染 model3d

## 概览

前端 Three.js 3D 渲染层，由三个文件组成：`model3d.ts` 负责场景搭建/相机/渲染循环，`model3d-loader.ts` 负责纹理与 spec 加载（**Go binding 为唯一事实来源，不再降级 JS 兜底**），`model3d-spec.ts` 是历史 JS 端兜底 spec 构建算法（已废弃、无消费方，仅测试保留作口径参考）。几何数据（顶点/法线/UV/骨骼四元数）全部由 Go 端 [go_threejs](./go-threejs.md) 预计算，本层只渲染、不做几何计算。

## 核心职责

- Three.js 场景搭建：PerspectiveCamera(45°) + OrbitControls + 环境光/双方向光 + GridHelper/AxesHelper
- 骨骼层级组树构建（buildSceneMesh）、mesh 合并与纹理槽分配、渲染循环、骨骼拾取回调
- 纹理并行加载（NearestFilter 像素风采样、低分辨率纹理过滤）、spec 获取（Go binding 唯一事实来源，模块级 specCache LRU 缓存上限 20，**空 models 直接 throw 不再 JS 兜底**；`loadTextures` 返回 `(Texture|null)[]`，null 占位不压缩索引，无「像素量阈值过滤」逻辑——知识卡旧文幽灵特性已删）
- `model3d-spec.ts`：历史 JS 兜底 spec 构建（同名骨骼合并、box UV / faceUV 解析）——**已废弃不消费**（fetchSpec 空 models throw，buildSpecFromModel 全项目无调用方）。注意其 cubePivot/cubeOrigin **不做 X 取反**、与 Go 口径不一致（黄金样本测试注释 `[1,0,0]` vs Go 实际 `[-1,0,0]` 矛盾），因废弃无运行时影响，仅测试作参考

## 对外 API / 入口

`model3d.ts`：
- 类型：`Spec3D` / `SpecModelGroup3D` / `SpecBone3D`（localPosition/localRotation 四元数 [x,y,z,w]/parentId）/ `SpecMeshGroup3D`（positions/normals/uvs/indices/texIdx）/ `BoneSelectInfo` / `RenderModel3DHandle`
- `buildSceneMesh(spec: Spec3D)` — 构建骨骼 Group 树，返回 `{ boneGroupMap, rootGroup, modelScale, modelGroups }`（**返回 `modelGroups`，知识卡旧文 `meshMax` 为幽灵字段已删**）；modelScale **固定 1/16**（旧文「>32→1/16、>4→1/4 动态缩放」已被移除，定值后不再随顶点缩放）
- `renderModel3D(container, texArr, spec, texIdx=0): Promise<RenderModel3DHandle>` — 渲染主入口；**入口复用守卫**（P1 修复：若上一场景未 cleanup，先主动 cancelAnimationFrame + dispose renderer + 移除 DOM + 置空模块状态，防僵尸 rAF 循环）；句柄含 resetCamera / setSpeed / setRotationMode（轨道/自由相机切换）/ setBoneVisible / getBoneList / toggleBone / showModelGroup / getModelGroupCount / onBoneSelect（骨骼选中回调）/ setDebugMode("normal"|"pivot"|"bone") / cleanup
- `screenshotPreview(): string | null` — 截取当前画面为 PNG base64（无 data: 前缀），依赖 renderer 的 `preserveDrawingBuffer: true`

`model3d-loader.ts`：
- `loadTextures(urls?): Promise<(THREE.Texture | null)[]>` — 并行加载，flipY=false + NearestFilter + SRGB；**null 占位不压缩索引**（全失败时返回 null 占位数组而非空数组，fallback 颜色由渲染侧处理）
- `preloadModel(model): Promise<{ texArr, spec }>` — 纹理 + spec 并行预加载；内部 fetchSpec（未导出）走 Go `GetModel3DSpec` binding（模块级 specCache，**LRU** 淘汰上限 20，命中重插刷新访问序——旧文 FIFO 漂移已修正），空 models 时抛错由上层 toast（不再降级 JS 兜底）
- `ModelLike` / `ModelSpec` 接口 — 轻量模型对象与 spec 结构

`model3d-spec.ts`：
- `buildSpecFromModel(model: SpecModelInput): SpecBuildResult` — JS 兜底算法，与 Go `threejs.Build()` 一致：同名骨骼去重（首次无 parent、后续带 parent → cube 整体替换；否则 mergeCubes 重叠替换/非重叠保留）、cube 坐标转骨骼局部系、box UV / faceUV JSON 解析
- **inflate/mirror 已同步**（2026-08-09，对齐 Go buildCubeMeshData）：SpecCube 含 inflate/mirror 字段，JS 构建几何膨胀（origin -i、size +2i）、UV 用原始尺寸、mirror u 交换——与 Go 双边锁定（model3d-spec.test.ts 有镜像用例）

## 渲染循环与交互

- **渲染循环**：`requestAnimationFrame(loop)` 启动（`_rafId` 保存，cleanup 时 `cancelAnimationFrame`），每帧 `renderer.render(scene, camera)`；默认 OrbitControls 轨道模式，`setRotationMode(false)` 切自由相机（WASD 平移 + 空格/Shift 升降，`_keys` 按键状态机驱动，`_camSpeed` 可调）
- **骨骼拾取**：`Raycaster.setFromCamera(pointer, camera)` + `intersectObjects(scene.children, true)` 反投影；pointermove 更新 `_hoveredBone`/`_hoveredMesh` 与 cursor（命中 pointer / 未命中 default）；click 命中时经 `_boneNameMap`/`_boneParentMap`/`_boneChildrenMap` 组装 `BoneSelectInfo`（name/path/parent/children/meshCount/localPos/worldPos/cube 四元数）调 `handle.onBoneSelect`——boneId 先局部收窄再传参（TS 对闭包捕获变量不做控制流收窄）
- **调试模式**：`setDebugMode("normal"|"pivot"|"bone")` 循环切换，`rebuildDebug()` 重建叠加层（pivot 标记 / 骨骼线框）
- **mesh 合并**：同一骨骼下按 `boneId + ":" + texIdx` 分组，同组多个 MeshGroup 合并顶点/法线/UV/索引，减少 draw call；`thicknessEpsilon` 避免零厚度面

## 与其他子系统关系

- 消费方：`app-preview/preview-skeleton.ts`（动态 import renderModel3D / preloadModel / screenshotPreview）、`utils/screenshot-renderer.ts`（复用 buildSceneMesh + loadTextures 做离屏多角度截图）
- 上游数据：Go `GetModel3DSpec` binding ← [go_threejs](./go-threejs.md) `threejs.Build()`；纹理/模型对象来自 [go_geometry](./go-geometry.md)
- 相机/调试状态存于模块级 `_scene3d/_camera3d/_renderer3d/_rootGroup3d`（供 screenshotPreview 使用，cleanup 时置空，不挂 window 全局）

## 不变量

- **致命陷阱 #11**：3D 坐标变换是全项目 fix 次数最多的区域（model3d.ts 历史 fix 第一）。坐标口径必须对齐 YSMViewer：pivot X 取反、`from.x = origin.x - size.x`（Go go/threejs 实现，见 spec.go:444-449 顶点 origin..origin+size + spec.go:530 `bonePivot.x - cp[0]` X 取反经 localPos 公式实现）。**消费侧（buildSceneMesh/renderModel3D）直接透传 Go 坐标，不再二次翻转**；JS 兜底 model3d-spec.ts 的 cubePivot/cubeOrigin **不做 X 取反、与 Go 口径不一致**（已废弃无运行时影响）。改 model2d/model3d/threejs spec 前先 grep `docs/archive/bug-chronicle.md`，改完用自由相机近距验证
- cleanup() 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/mouse/resize/fullscreenchange 全部监听、dispose controls/renderer/geometry/material、清空容器 —— 缺一即泄漏
- **Three.js 资源 dispose 模式**（审计发现）：移除 `Object3D` 时，`Object3D.remove()` 只从场景图移除引用，**不释放底层 WebGL 资源**。必须遍历子对象并调用 `geometry?.dispose()`、`material?.dispose()`、`texture?.dispose()`。`rebuildDebug`（model3d.ts:644-736）和 `makeTextTexture`（model3d.ts:739-759）是典型场景——频繁切换 debug 模式或 pivot 模式每骨骼一个标签，不 dispose 会持续累积 GPU 内存泄漏（P1 已修，行号随实现演进）
- 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径；JS 兜底算法（model3d-spec.ts）已废弃，不再承担降级职责
- 治理红线 R1：模块级状态不挂 `window.__*`

## 相关

- [go_threejs](./go-threejs.md) — spec 生成（Go 端）
- [model2d](./model2d.md) — 2D 预览（同一坐标口径约束）
- [app_preview](./app-preview.md) — 预览面板消费方
- [utils_export](./utils-export.md) — 截图与导出
- `frontend/src/utils/3d/model3d-spec.test.ts` — JS 兜底 ↔ Go 口径黄金样本测试（验证入口；注意 UV 归一化/面序尚未与 Go 对齐，见测试自述）
- AGENTS.md 致命陷阱 §二 #11
