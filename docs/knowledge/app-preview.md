---
kind: app-preview
name: 预览面板 app-preview
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-preview/index.ts
  - frontend/src/views/app-preview/tpl.ts
  - frontend/src/views/app-preview/loader.ts
  - frontend/src/views/app-preview/detail.ts
  - frontend/src/views/app-preview/skeleton.ts
  - frontend/src/views/app-preview/zoom.ts
  - frontend/src/views/app-preview/wasm.ts
  - frontend/src/views/app-preview/litematic-3d.ts
  - frontend/src/views/app-preview/litematic-meta.ts
  - frontend/src/views/app-preview/cache.ts
  - frontend/src/views/app-preview/model3d-loader.ts
  - frontend/src/views/app-preview/screenshot-renderer.ts
  - frontend/src/views/app-preview/geometry.ts
  - frontend/src/views/app-preview/utils.ts
  - frontend/src/views/app-preview/css.ts
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-preview/utils.test.ts
  - frontend/src/views/app-resource-manager/index.test.ts
  - frontend/src/views/app-sidebar/loader.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/app-tree/utils.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 预览
  - 模型预览
  - 2D 骨骼
  - 3D 预览
  - Litematic
  - 蓝图
  - 缩略图
  - WASM 解码
  - 放大预览
---

# 预览面板 app-preview

## 概览

`app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），负责 YSM 模型的详情/2D 骨骼/3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展示。它按 `model:select` 事件驱动，解码链路为「缓存 → 前端 WASM → Go 兜底」。组件由 `app-content` 顶部副作用**静态**导入完成注册（`app-content/index.ts:34`，原动态 import 预加载方案已废弃）。

## 核心职责

- `index.ts` — `<app-preview>` 生命周期编排：监听 `model:select`（回调开头 `++this._previewGen`）、目录走 `_showPackInfo`、文件走 `_showModelDetail` 并按 `DetectResourceType` 结果分流（pack → `showResourcePack`；ysm/空 → `showModelDetail`；litematic/blueprint → `showLitematic`；其他 → `showShaderPack`，类型元信息经 `_typeMeta` 查 `LoadResourceTypes` 预载表）、`_loadPreviewImage` 缩略图三级加载、`cacheSetEvictHandler` 注册缓存淘汰时回收 blob URL（含 `geometry.textures` / `authors[].avatarUrl` / `avatars` 去重后 revoke）
- `loader.ts` — `loadModelData`：统一模型加载（缓存 → WASM → Go `AnalyzeBedrockModel` 兜底）
- `detail.ts` — `showModelDetail` / `showResourcePack` / `showShaderPack`：详情面板渲染（Go 侧 `ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta`）
- `skeleton.ts` — `loadModel2D`：2D/3D 骨骼渲染编排，委托 `utils/3d/model2d.ts` 的 `renderModel2D` 与 `utils/3d/model3d.ts` 的 `renderModel3D`；window 级拖拽监听存模块级 `_prevWindowMove` / `_prevWindowUp` 槽位（`skeleton.ts:20`、`:193`），先移除上一轮再绑定并把移除逻辑 push 进 `ctx._unsubs`（`skeleton.ts:211`）；`_model3dGen` 作废在途 3D 渲染；截图走 `SaveScreenshotFile`
- `zoom.ts` — `openFullPreview`：全屏放大预览
- `wasm.ts` — `decodeYsmViaWasm`：前端 WASM 解码 .ysm（经 Go `ReadFileBytes` 取字节，走 `cache.ts` 缓存）
- `litematic-3d.ts` — `createLitematic3D` / `cleanupVoxel3D`：静态 `import * as THREE from "three"` + OrbitControls，按空间分块用 InstancedMesh 渲染体素；体素数据由 `GetLitematicVoxelData` 等 Go 函数名动态派发（`voxelFn`）；失败经 `friendlyError` 派发 `toast:show`
- `litematic-meta.ts` — `showLitematic`（Go `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`）与 `cleanupLitematic3D`（转发 `cleanupVoxel3D`）
- `utils.ts` — 共享类型与工具：`PreviewCtx` 接口、`DecodedYsm`、`getPrefer3D` / `setPrefer3D`（跨模型保留 3D 偏好）、`stripYsgpTextHeader`（YSGP 文本变体转标准头，内部私有 `buildStdYsgpFromTextVariant`）、`devLog`
- `geometry.ts` — 纯函数层：`BedrockCube` / `BedrockBone` / `BedrockGeometry` 类型 + `parseBedrockGeometryFromJSON`
- `model3d-loader.ts` / `screenshot-renderer.ts` — 3D 规格加载（Go `GetModel3DSpec`）与多角度截图渲染（`renderMultiAngle`），均静态依赖 three
- `cache.ts` — 模块级预览缓存：`cacheGet` / `cacheSet` / `cacheSetEvictHandler` + `CacheValue`
- `tpl.ts` — `modelDetailHTML`（详情面板）/ `statsCardHTML`（模型概览卡片）
- `css.ts` — Shadow DOM 样式表 `previewCSS`（adoptedStyleSheets）

## 对外 API / 入口

- 自定义元素：`<app-preview>`
- 监听 bus：`model:select`（`{ path, isDir }`；目录走整合包信息 `GetPackInfo`，文件走类型分流）
- 派发 bus：`toast:show`（仅子模块的加载失败路径：`litematic-3d.ts:580` 体素 3D 加载失败、`skeleton.ts:812` 3D 预览加载失败）；`index.ts` 本身不 emit
- Go 调用（经 `getApp()`）：`index.ts` 的 `DetectResourceType` / `FindPreviewImage` / `ExtractPreviewTexture` / `LoadResourceTypes` / `GetPackInfo`；子模块的 `AnalyzeBedrockModel`（loader）、`ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta`（detail）、`ReadFileBytes`（wasm）、`ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`（litematic-meta）、`GetLitematicVoxelData` 等体素函数（litematic-3d）、`GetModel3DSpec`（model3d-loader / screenshot-renderer）、`SaveScreenshotFile`（skeleton）
- 子模块入口：`loadModelData` / `loadModel2D` / `openFullPreview` / `decodeYsmViaWasm` / `createLitematic3D` / `cleanupVoxel3D` / `showLitematic` / `cleanupLitematic3D` / `showModelDetail` / `showResourcePack` / `showShaderPack` / `preloadModel` / `renderMultiAngle`

## 与其他子系统关系

- 由 `app-content/index.ts:34` 顶部副作用静态导入完成注册，仓库页模板直接放置 `<app-preview>` 元素（见知识卡 `app_content`）
- `model:select` 派发方为 `app-tree` 节点点击与诊断页去重定位（见知识卡 `app_tree`）
- 2D/3D 骨骼计算委托 `frontend/src/utils/3d/model2d.ts` / `utils/3d/model3d.ts`，动画解析走 `utils/animation/animation.ts`
- Litematic/schematic 解析对应 Go 端 `go/litematic`；该包的 `extractBits` 对损坏或截断文件已加 `longIdx` 越界守卫（`go/litematic/nbt.go`，42d1839），前端 `litematic-3d.ts` 只做「体素数据为空」的空态兜底，不重复校验位宽（见知识卡 `go_litematic`）
- WASM 解析口径与 Go 端 `go/ysm` 一致（YSMViewer 算法口径）；缓存层为 `frontend/src/views/app-preview/cache.ts`
- 组件实例实现 `PreviewCtx` 最小接口，子模块只依赖该接口，不反向引用组件全貌

## 不变量

- `model:select` 回调进入即 `++_previewGen`；`_showModelDetail` / `_showPackInfo` 在每个 `await` 之后必须 `if (gen !== this._previewGen) return`（`index.ts:163`、`:202`），否则慢条目 A 的迟到结果会覆盖已切换的 B 的预览（与 `app-sidebar._reloadGen`、`app-sync-manager._gen` 同模式）
- `_unsubs` 中的 `bus.on` 订阅必须在 `disconnectedCallback` 清理；拖拽 window 监听经 `PreviewCtx._unsubs` 挂销毁清理；Litematic 3D 经 `cleanupLitematic3D`（转发 `cleanupVoxel3D`）终止 WebGL renderer + rAF 循环（防切页 GPU 残留）
- 2D 拖拽的 window 监听先移除上一轮再绑定（模块级槽位 `_prevWindowMove` / `_prevWindowUp`），禁止累积
- 预览缓存淘汰时必须 `URL.revokeObjectURL` 释放 blob URL（`cacheSetEvictHandler`）
- Three.js 现为静态依赖（`litematic-3d.ts` / `model3d-loader.ts` / `screenshot-renderer.ts` / `utils/3d/model3d.ts` 均 `import * as THREE from "three"`），且 `app-preview` 已被 `app-content` 静态导入，因此 three 进入主 chunk；vite 未配 `manualChunks`，若要恢复懒加载需同时改回动态 import 与分包配置
- 坐标变换遵循 ysmview 口径（陷阱 #11：改 model2d/model3d 前先 grep bug-chronicle）

## 相关

- `frontend/src/utils/3d/model2d.ts` / `utils/3d/model3d.ts` — 2D/3D 骨骼渲染与计算
- `frontend/src/views/app-preview/cache.ts` — 模块级预览缓存（跨组件生命周期持久）
- `frontend/src/wasm/` — WASM 生成数据（base64 豁免文件）
- 知识卡：`app_content`、`app_tree`、`go_ysm_parser`、`go_litematic`、`event_bus`
