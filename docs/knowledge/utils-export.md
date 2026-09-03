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
auto_fields:
  symbols_with_lines:
    - AngleShot
    - cacheGet
    - cacheSet
    - cacheSetEvictHandler
    - CacheValue
    - collectBlobUrls
    - loadTextures
    - releaseTextureUrls
    - renderMultiAngle
    - RenderMultiAngleOptions
    - screenshotFromRenderer
    - ScreenshotLights
    - ScreenshotOpts
    - toScreenshotLights
  tests:
    - frontend/src/preview-3d/decoder/cache.test.ts
    - frontend/src/preview-3d/screenshot-render.test.ts
    - frontend/src/preview-3d/texture-loader.test.ts
tests:
  - frontend/src/preview-3d/decoder/cache.test.ts
  - frontend/src/preview-3d/screenshot-render.test.ts
  - frontend/src/preview-3d/texture-loader.test.ts
use_when:
  - 截图
  - 导出 PNG
  - 多角度截图
  - 预览缓存淘汰
  - blob URL 释放
perf:
  - memory-heavy
  - gpu-bound
invariant_anchors:
  - frontend/src/preview-3d/decoder/cache.ts|cacheSet
  - frontend/src/preview-3d/decoder/cache.ts|collectBlobUrls
quick_groups:
  - 截图导出与缓存
quick_intents:
  - 截图 / 导出 PNG / 多角度四角度截图
  - renderMultiAngle / AngleShot
  - 预览缓存 cacheGet / cacheSet / cacheSetEvictHandler
  - 透明背景截图 / preserveDrawingBuffer
quick_risk_lines:
  - 离屏截图渲染器资源与 blob URL 必须释放，防内存泄漏
pitfalls:
  - 离屏 renderer 未 dispose / blob URL 未通过 evict 回调释放 → WebGL 上下文 + 内存泄漏；整个「renderer 创建 → 场景构建 → 四角度循环」必须都在 try/finally 内
  - cacheSet 覆盖同 key 旧值不触发 evict → WASM 解码产物的旧 blob URL 泄漏；淘汰与覆盖都必须走 evict 回调
  - GetModel3DSpec / JSON.parse 失败直接 reject → 消费者无 catch → unhandled rejection；失败应统一返回 null（P2 修复）
  - try 起点在角度循环而非场景构建段 → 场景构建抛错时 renderer 永不 dispose（P2 修复）
status: active
---

# 截图与导出 export

## 概览

预览产物的导出与缓存层：`screenshot-render.ts` 用离屏 Three.js 渲染器做透明背景多角度截图；`preview-3d/decoder/cache.ts` 是模型预览数据的模块级持久缓存（组件卸载/重挂不丢失）。当前画面单帧截图经适配器的 `screenshotFn` 注入（非 `screenshotPreview`，已随 ADR-052 P3 移除）。截图灯光提取（`toScreenshotLights`）与纹理加载（`loadTextures`）已随 ADR-136 第四刀归位 preview-3d（`screenshot-lights.ts` / `texture-loader.ts`）。

## 核心职责

- 离屏多角度截图（front / 45° / side / back45° 四角度，透明背景 PNG base64）
- 预览数据缓存（FIFO 淘汰 + evict 回调释放 blob URL）

## 对外 API / 入口

`screenshot-render.ts`：
- `renderMultiAngle(modelPath: string, texUrls: string[], opts?: { size? }): Promise<AngleShot[] | null>` — 经 `GetModel3DSpec` 取 spec + `loadTextures` 加载纹理，离屏 WebGLRenderer（alpha 透明背景，默认 512×512）渲染四角度，返回 `[{ name, base64 }]`（PNG base64 无 data: 前缀）；结束 traverse dispose 全部 geometry/material + renderer
- `AngleShot` 接口：`{ name: "front" | "45" | "side" | "back45", base64 }`

`preview-3d/decoder/cache.ts`（preview-cache）：
- `cacheGet(path: string): CacheValue | null` / `cacheSet(path, data)` — key 为模型绝对路径；上限 MAX_CACHE=50，超出时 FIFO 淘汰最旧条目并触发 evict 回调
- `cacheSetEvictHandler(fn)` — 注册淘汰回调（释放 blob URL 等资源）
- `CacheValue` 接口：texture/geometry/animations/authors/avatars/_decodedBy 等

## 与其他子系统关系

- 消费方：`app-preview/skeleton-render.ts`（renderMultiAngle 多角度截图）、`app-preview/index.ts`（preview-cache 读写与 evict 注册）
- 依赖 [model3d](./model3d.md) 的 buildSceneMesh、`texture-loader.ts` 的 loadTextures；Go binding：GetModel3DSpec

## 不变量

- 离屏渲染器必须 `preserveDrawingBuffer: true` 才能 toDataURL 截图；用完必须 dispose（geometry/material/renderer），否则 WebGL 上下文泄漏。**整个「renderer 创建 → 场景构建 → 四角度循环」都在 try/finally 内**（P2 修复：原 try 起点在角度循环，场景构建段抛错 renderer 永不 dispose），且失败统一返回 `null` 不 reject（P2 修复：原 spec 获取/JSON.parse 失败直接 reject，消费者无 catch → unhandled rejection）；dispose 后追加 `forceContextLoss()` 强制释放上下文（P3）
- preview-cache 淘汰**与覆盖**都必须走 evict 回调释放 blob URL（P2 修复：原同 key `cacheSet` 覆盖旧值不触发 evict，WASM 解码产物的旧 URL 泄漏）
- 缓存是模块级单例：组件 disconnectedCallback 不得清空（跨页复用），淘汰只由 FIFO 上限驱动
- Canvas 手动导出 PNG 按钮（原 canvas-export.ts）与仓库批量截图（batchRepoScreenshots）因长期无消费方已在死代码清理中移除；如需恢复以本卡与 git 历史为准
- `AngleShot.name` 实现为 `string`（知识卡声明联合类型，运行时只产出四角度，类型收紧留待后续）

## 相关

- [model3d](./model3d.md) — 场景构建（screenshotPreview 已移除，截图经 adapter.screenshotFn 注入）
- [app_preview](./app-preview.md) — 预览面板消费方
- [wails_bindings](./wails-bindings.md) — GetModel3DSpec 等 Go binding
