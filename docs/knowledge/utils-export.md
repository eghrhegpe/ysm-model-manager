---
kind: utils-export
name: 截图与导出 export
tier: architecture
category: utils
source_files:
  - frontend/src/preview-3d/screenshot-render.ts
  - frontend/src/preview-3d/screenshot-lights.ts
  - frontend/src/preview-3d/texture-loader.ts
  - frontend/src/preview-3d/decoder/cache.ts
  - frontend/src/preview-3d/screenshot.ts
tests:
  - frontend/src/preview-3d/decoder/cache.test.ts
  - frontend/src/preview-3d/screenshot-render.test.ts
  - frontend/src/preview-3d/texture-loader.test.ts
use_when:
  - 截图
  - 导出 PNG
  - 多角度截图
  - 预览缓存
  - 缩略图
  - blob URL 释放
invariant_anchors:
  - frontend/src/preview-3d/decoder/cache.ts|cacheSet
  - frontend/src/preview-3d/decoder/cache.ts|collectBlobUrls
---

# 截图与导出 export

## 概览

预览产物的导出与缓存层：`screenshot-render.ts` 用离屏 Three.js 渲染器做透明背景多角度截图；`preview-cache.ts` 是模型预览数据的模块级持久缓存（组件卸载/重挂不丢失）。当前画面的单帧截图入口 `screenshotPreview()` 位于 [model3d](./model3d.md)。截图灯光提取（`toScreenshotLights`）与纹理加载（`loadTextures`）已随 ADR-136 第四刀归位 preview-3d（`screenshot-lights.ts` / `texture-loader.ts`）。

## 核心职责

- 离屏多角度截图（front / 45° / side / back45° 四角度，透明背景 PNG base64）
- 预览数据缓存（FIFO 淘汰 + evict 回调释放 blob URL）

## 对外 API / 入口

`screenshot-render.ts`：
- `renderMultiAngle(modelPath: string, texUrls: string[], opts?: { size? }): Promise<AngleShot[] | null>` — 经 `GetModel3DSpec` 取 spec + `loadTextures` 加载纹理，离屏 WebGLRenderer（alpha 透明背景，默认 512×512）渲染四角度，返回 `[{ name, base64 }]`（PNG base64 无 data: 前缀）；结束 traverse dispose 全部 geometry/material + renderer
- `AngleShot` 接口：`{ name: "front" | "45" | "side" | "back45", base64 }`

`preview-cache.ts`：
- `cacheGet(path: string): CacheValue | null` / `cacheSet(path, data)` — key 为模型绝对路径；上限 MAX_CACHE=50，超出时 FIFO 淘汰最旧条目并触发 evict 回调
- `cacheSetEvictHandler(fn)` — 注册淘汰回调（释放 blob URL 等资源）
- `CacheValue` 接口：texture/geometry/animations/authors/avatars/_decodedBy 等

## 与其他子系统关系

- 消费方：`app-preview/skeleton-render.ts`（renderMultiAngle 多角度截图 + model3d.screenshotPreview 当前画面截图，经 `screenshot-lights.ts` toScreenshotLights 提取预览灯光）、`app-preview/index.ts` + `preview-loader.ts` + `preview-wasm.ts`（preview-cache 读写与 evict 注册）
- 依赖 [model3d](./model3d.md) 的 buildSceneMesh、`texture-loader.ts` 的 loadTextures；Go binding：GetModel3DSpec

## 不变量

- 离屏渲染器必须 `preserveDrawingBuffer: true` 才能 toDataURL 截图；用完必须 dispose（geometry/material/renderer），否则 WebGL 上下文泄漏。**整个「renderer 创建 → 场景构建 → 四角度循环」都在 try/finally 内**（P2 修复：原 try 起点在角度循环，场景构建段抛错 renderer 永不 dispose），且失败统一返回 `null` 不 reject（P2 修复：原 spec 获取/JSON.parse 失败直接 reject，消费者无 catch → unhandled rejection）；dispose 后追加 `forceContextLoss()` 强制释放上下文（P3）
- preview-cache 淘汰**与覆盖**都必须走 evict 回调释放 blob URL（P2 修复：原同 key `cacheSet` 覆盖旧值不触发 evict，WASM 解码产物的旧 URL 泄漏）
- 缓存是模块级单例：组件 disconnectedCallback 不得清空（跨页复用），淘汰只由 FIFO 上限驱动
- Canvas 手动导出 PNG 按钮（原 canvas-export.ts）与仓库批量截图（batchRepoScreenshots）因长期无消费方已在死代码清理中移除；如需恢复以本卡与 git 历史为准
- `AngleShot.name` 实现为 `string`（知识卡声明联合类型，运行时只产出四角度，类型收紧留待后续）

## 相关

- [model3d](./model3d.md) — 场景构建与 screenshotPreview
- [app_preview](./app-preview.md) — 预览面板消费方
- [wails_bindings](./wails-bindings.md) — GetModel3DSpec 等 Go binding
