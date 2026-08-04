---
kind: app_preview
name: 预览面板 app-preview
tier: architecture
category: ui
source_files:
  - frontend/js/components/app-preview/index.ts
  - frontend/js/components/app-preview/tpl.ts
  - frontend/js/components/app-preview/preview-loader.ts
  - frontend/js/components/app-preview/preview-detail.ts
  - frontend/js/components/app-preview/preview-skeleton.ts
  - frontend/js/components/app-preview/preview-zoom.ts
  - frontend/js/components/app-preview/preview-wasm.ts
  - frontend/js/components/app-preview/preview-litematic-3d.ts
  - frontend/js/components/app-preview/preview-litematic-meta.ts
  - frontend/js/components/app-preview/preview-utils.ts
  - frontend/js/components/app-preview/preview-css.ts
  - frontend/js/components/app-preview/utils.ts
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

`app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），负责 YSM 模型的详情/2D 骨骼/3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展示。它按 `model:select` 事件驱动，解码链路为「缓存 → 前端 WASM → Go 兜底」，整个组件由 `app-content` 在渲染仓库页时按需动态 import（懒加载，避免 Three.js 等重型依赖提前加载）。

## 核心职责

- `index.ts` — `<app-preview>` 生命周期编排：监听 `model:select`、按 `DetectResourceType` 结果分流（pack → `showResourcePack`；ysm/空 → `showModelDetail`；litematic/blueprint → `showLitematic`；其他 → `showShaderPack`）、`_loadPreviewImage` 缩略图三级加载、`cacheSetEvictHandler` 注册缓存淘汰时回收 blob URL
- `preview-loader.ts` — `loadModelData`：统一模型加载（缓存 → WASM → Go 兜底）
- `preview-detail.ts` — `showModelDetail` / `showResourcePack` / `showShaderPack`：详情面板渲染（摘要卡片走 `utils/summarize.ts`）
- `preview-skeleton.ts` — `loadModel2D`：2D 骨骼线条图渲染编排；window 级拖拽监听存 `_prevWindowMove` / `_prevWindowUp` 槽位，先移除上一轮再绑定防累积泄漏
- `preview-zoom.ts` — `openFullPreview`：全屏放大预览
- `preview-wasm.ts` — `decodeYsmViaWasm`：前端 WASM 解码 .ysm（含 YSGP 变体处理，走 `utils/preview-cache.ts` 缓存）
- `preview-litematic-3d.ts` — `createLitematic3D`：动态 `import("three")` + OrbitControls，InstancedMesh 渲染蓝图方块
- `preview-litematic-meta.ts` — `showLitematic`：Litematic 元数据面板（调 Go 读取后转 3D 视图）
- `preview-utils.ts` — 共享类型与工具：`PreviewCtx` 接口、`DecodedYsm`、`getPrefer3D` / `setPrefer3D`（跨模型保留 3D 偏好）、`buildStdYsgpFromTextVariant` / `stripYsgpTextHeader`、`devLog`
- `utils.ts` — 纯函数层：`BedrockCube` / `BedrockBone` / `BedrockGeometry` 类型 + `parseBedrockGeometryFromJSON`
- `tpl.ts` — `modelDetailHTML`（详情面板）/ `statsCardHTML`（模型概览卡片）
- `preview-css.ts` — Shadow DOM 样式表（adoptedStyleSheets）

## 对外 API / 入口

- 自定义元素：`<app-preview>`
- 监听 bus：`model:select`（`{ path, isDir }`；目录走整合包信息 `GetPackInfo`，文件走类型分流）
- 派发 bus：无（纯消费方，反馈经父级 toast 体系）
- Go 调用（动态 import bindings）：`DetectResourceType`、`FindPreviewImage`、`ExtractPreviewTexture`、`LoadResourceTypes`、`GetPackInfo`
- 子模块入口：`loadModelData` / `loadModel2D` / `openFullPreview` / `decodeYsmViaWasm` / `createLitematic3D` / `showLitematic` / `showModelDetail` / `showResourcePack` / `showShaderPack`

## 与其他子系统关系

- 由 `app-content` 仓库页 `_render()` 动态 `import("../app-preview/index.ts")` 懒加载注册（见知识卡 `app_content`）
- `model:select` 派发方为 `app-tree` 节点点击与诊断页去重定位（见知识卡 `app_tree`）
- 2D/3D 骨骼计算委托 `frontend/js/utils/model2d.ts` / `utils/model3d.ts`，动画解析走 `utils/animation.ts`
- WASM 解析口径与 Go 端 `go/ysm` 一致（YSMViewer 算法口径）；缓存层为 `frontend/js/utils/preview-cache.ts`
- 组件实例实现 `PreviewCtx` 最小接口，子模块只依赖该接口，不反向引用组件全貌

## 不变量

- `_unsubs` 中的 `bus.on` 订阅必须在 `disconnectedCallback` 清理；拖拽 window 监听经 `PreviewCtx._unsubs` 挂销毁清理；Litematic 3D 经 `cleanupLitematic3D`（转发 `cleanupVoxel3D`）终止 WebGL renderer + rAF 循环（防切页 GPU 残留）
- 2D 拖拽的 window 监听先移除上一轮再绑定（模块级槽位 `_prevWindowMove` / `_prevWindowUp`），禁止累积
- 预览缓存淘汰时必须 `URL.revokeObjectURL` 释放 blob URL（`cacheSetEvictHandler`）
- Three.js 仅在 Litematic 3D 视图按需 `await import("three")`，不进入首屏 bundle
- 坐标变换遵循 ysmview 口径（陷阱 #11：改 model2d/model3d 前先 grep bug-chronicle）

## 相关

- `frontend/js/utils/model2d.ts` / `utils/model3d.ts` — 2D/3D 骨骼渲染与计算
- `frontend/js/utils/preview-cache.ts` — 模块级预览缓存（跨组件生命周期持久）
- `frontend/js/wasm/` — WASM 生成数据（base64 豁免文件）
- 知识卡：`app_content`、`app_tree`、`go_ysm_parser`、`event_bus`
