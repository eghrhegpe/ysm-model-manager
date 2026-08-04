---
kind: utils_export
name: 截图与导出 export
tier: architecture
category: utils
source_files:
  - frontend/js/components/app-preview/screenshot-renderer.ts
  - frontend/js/components/app-preview/preview-cache.ts
use_when:
  - 截图
  - 导出 PNG
  - 多角度截图
  - 预览缓存
  - 缩略图
  - blob URL 释放
---

# 截图与导出 export

## 概览

预览产物的导出与缓存层：`screenshot-renderer.ts` 用离屏 Three.js 渲染器做透明背景多角度截图；`preview-cache.ts` 是模型预览数据的模块级持久缓存（组件卸载/重挂不丢失）。当前画面的单帧截图入口 `screenshotPreview()` 位于 [model3d](./model3d.md)。

## 核心职责

- 离屏多角度截图（front / 45° / side / back45° 四角度，透明背景 PNG base64）
- 预览数据缓存（FIFO 淘汰 + evict 回调释放 blob URL）

## 对外 API / 入口

`screenshot-renderer.ts`：
- `renderMultiAngle(modelPath: string, texUrls: string[], opts?: { size? }): Promise<AngleShot[] | null>` — 经 `GetModel3DSpec` 取 spec + `loadTextures` 加载纹理，离屏 WebGLRenderer（alpha 透明背景，默认 512×512）渲染四角度，返回 `[{ name, base64 }]`（PNG base64 无 data: 前缀）；结束 traverse dispose 全部 geometry/material + renderer
- `AngleShot` 接口：`{ name: "front" | "45" | "side" | "back45", base64 }`

`preview-cache.ts`：
- `cacheGet(path: string): CacheValue | null` / `cacheSet(path, data)` — key 为模型绝对路径；上限 MAX_CACHE=50，超出时 FIFO 淘汰最旧条目并触发 evict 回调
- `cacheSetEvictHandler(fn)` — 注册淘汰回调（释放 blob URL 等资源）
- `CacheValue` 接口：texture/geometry/animations/authors/avatars/_decodedBy 等

## 与其他子系统关系

- 消费方：`app-preview/preview-skeleton.ts`（renderMultiAngle 多角度截图 + model3d.screenshotPreview 当前画面截图）、`app-preview/index.ts` + `preview-loader.ts` + `preview-wasm.ts`（preview-cache 读写与 evict 注册）
- 依赖 [model3d](./model3d.md) 的 buildSceneMesh、model3d-loader 的 loadTextures；Go binding：GetModel3DSpec

## 不变量

- 离屏渲染器必须 `preserveDrawingBuffer: true` 才能 toDataURL 截图；用完必须 dispose（geometry/material/renderer），否则 WebGL 上下文泄漏
- preview-cache 淘汰必须走 evict 回调释放 blob URL，绕过回调直接删 Map 会泄漏对象 URL
- 缓存是模块级单例：组件 disconnectedCallback 不得清空（跨页复用），淘汰只由 FIFO 上限驱动
- Canvas 手动导出 PNG 按钮（原 canvas-export.ts）与仓库批量截图（batchRepoScreenshots）因长期无消费方已在死代码清理中移除；如需恢复以本卡与 git 历史为准

## 相关

- [model3d](./model3d.md) — 场景构建与 screenshotPreview
- [app_preview](./app_preview.md) — 预览面板消费方
- [wails_bindings](./wails_bindings.md) — GetModel3DSpec 等 Go binding
