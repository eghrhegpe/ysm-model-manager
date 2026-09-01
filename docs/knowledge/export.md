---
kind: export
name: 截图导出 export
tier: architecture
adr:
  - ADR-127
category: feature
source_files:
  - frontend/src/preview-3d/screenshot.ts
  - frontend/src/preview-3d/screenshot-render.ts
  - frontend/src/preview-3d/screenshot-lights.ts
  - frontend/src/preview-3d/texture-loader.ts
  - frontend/src/preview-3d/texture-cache.ts
  - frontend/src/preview-3d/decoder/cache.ts
  - frontend/src/views/app-preview/skeleton-render.ts
  - frontend/src/views/app-preview/shot-panel-shared.ts
  - frontend/src/preview-3d/adapters/ysm-adapter.ts
tests:
  - frontend/src/preview-3d/screenshot-render.test.ts
  - frontend/src/preview-3d/decoder/cache.test.ts
  - frontend/src/preview-3d/texture-loader.test.ts
  - frontend/src/views/app-preview/skeleton-render.test.ts
  - frontend/src/views/app-preview/mmd-controls.test.ts
use_when:
  - 截图
  - 导出 PNG
  - 多角度截图
  - 透明背景
  - 预览缓存
  - blob URL
  - saveScreenshot
  - renderMultiAngle
invariant_anchors:
  - frontend/src/preview-3d/screenshot.ts|screenshotFromRenderer
  - frontend/src/preview-3d/screenshot-render.ts|renderMultiAngle
  - frontend/src/views/app-preview/skeleton-render.ts|saveScreenshot
  - frontend/src/preview-3d/decoder/cache.ts|cacheSet
---

# 截图导出 export

## 概览

> **差异化定位**：`utils-export.md`（utils 分类）回答"截图/缓存**怎么写**"（API 签名、淘汰策略、dispose 顺序）；本 feature 卡回答"用户点截图按钮后**发生了什么**"——从触发入口到 PNG 落盘的端到端链路。

> ⚠️ **`screenshotPreview` 已不存在**（ADR-052 P3 删除）—— `utils-export.md` 的"当前画面单帧截图入口 `screenshotPreview()` 位于 model3d"描述已过时，current 路径现走 `screenshotFn`（适配器注入的 `screenshotFromRenderer`）或 `renderMultiAngle` front 帧 fallback。

## 端到端链路

用户点击 3D 预览面板截图按钮 → 6 角度菜单（`current/front/45/side/back45/all`）→ `shotButtonNodes` → `makeShotAction` → `saveScreenshot` → 两条路径之一 → Go `SaveScreenshotFile` 落盘。

### 链路一：current + 活跃渲染器存在

```
shotButton action → makeShotAction → saveScreenshot(key="current")
  → screenshotFn()（适配器注入的截图能力）
  → screenshotFromRenderer(ctx.renderer, ctx.scene, ctx.camera)
  → 临时 setPreserveDrawingBuffer(true) + render + toDataURL → base64
  → SaveScreenshotFile("name_2025-xx-xxT…png", base64)
```

### 链路二：指定角度（front/45/side/back45/all）+ current 无 screenshotFn

```
shotButton action → saveScreenshot(key="front/45/side/back45/all")
  → renderFrame → renderMultiAngle(modelPath, texUrls, opts)
  → GetModel3DSpec(modelPath) [Go binding] → Spec3D
  → 兜底 decodeYsmViaWasm + buildSpecFromGeometryJSON（ADR-071）
  → loadTextures(texUrls) + Promise.all(componentTextures) → THREE.Texture[]
  → new WebGLRenderer({alpha:true,preserveDrawingBuffer:true,antialias:true})
  → setClearColor(0x000000, 0) [透明背景]
  → applyLights → toScreenshotLights() [三点布光] 或标准灯 fallback
  → buildYsmObject(spec, texArr, componentTexMap) → rootGroup → scene.add
  → updateMatrixWorld + Box3 居中 → 四角度循环（theta=0,π/4,π/2,-π/4）
  → screenshotFromRenderer(renderer, scene, camera, {width:512,height:512})
  → finally: ysmObject.removeFromScene + renderer.dispose + forceContextLoss
  → 按 key 匹配 name → base64 → SaveScreenshotFile("name_45.png", b64)
```

`all` 键：`for (const k of ["front","45","side","back45"]) await saveScreenshot(model, k, …)` **串行**保存 4 张（避免并发写文件冲突）。

## 关键文件清单

| 文件 | 职责 |
|------|------|
| `screenshot.ts` | 纯函数 `screenshotFromRenderer`：对任意活跃 renderer/scene/camera 截图（PNG/JPEG base64），临时开 `preserveDrawingBuffer`，空/异常静默返回 null |
| `screenshot-render.ts` | 离屏多角度渲染器：`renderMultiAngle` 自建 WebGLRenderer（透明背景）+ 四角度循环 + 灯光/纹理/YSM 对象构建 + finally 释放 |
| `screenshot-lights.ts` | `toScreenshotLights()` 从 `LightCapability` 读三点布光 + PMREM 环境光衰减，缺 cap 回退标准灯 |
| `texture-loader.ts` | `loadTextures(urls)` 并行从 `textureCache` acquire，polling 等图片 complete，失败 invalidate 缓存 |
| `texture-cache.ts` | 纹理缓存池：引用计数 + LRU 淘汰零引用条目（上限 200），`disposeAll` 由 `mount-preview-core fullCleanup` 统一释放 |
| `decoder/cache.ts` | 模型预览数据持久缓存：模块级 Map，FIFO 上限 50，覆盖/淘汰走 `onEvict` 回调释放 blob URL（覆盖时新旧 blob URL 差集判定，防误 revoke） |
| `skeleton-render.ts` | 截图保存入口：`saveScreenshot` 六角度分支 + 活跃渲染器 vs 离屏重建两条路径 |
| `shot-panel-shared.ts` | 截图面板共享层：`shotButtonNodes` 6 角度按钮 + `makeShotAction` 防连点副作用 |
| `ysm-adapter.ts` | YSM 适配器注入 `screenshot` 能力（`screenshotFromRenderer` 共享活跃渲染器）；6 适配器统一走 `screenshotFromRenderer`（ADR-052 P3） |

## 核心 API / 函数

| 导出 | 文件 | 职责 |
|------|------|------|
| `screenshotFromRenderer(renderer, scene, camera, opts?): string \| null` | screenshot.ts | 活跃渲染器截图 |
| `renderMultiAngle(modelPath, texUrls, opts?): Promise<AngleShot[] \| null>` | screenshot-render.ts | 离屏四角度渲染 |
| `toScreenshotLights(): ScreenshotLights \| undefined` | screenshot-lights.ts | 三点布光提取 + PMREM 衰减 |
| `loadTextures(urls?): Promise<(THREE.Texture \| null)[]>` | texture-loader.ts | 纹理加载（含 invalidate） |
| `saveScreenshot(model, key, setShotState, screenshotFn?)` | skeleton-render.ts | 六角度分支 + 两条路径选择 |
| `makeShotAction(modelForSave, screenshotFn)` | shot-panel-shared.ts | 防连点副作用 |
| `shotButtonNodes(modelForSave, screenshotFn)` | shot-panel-shared.ts | 6 角度声明式按钮 |

**Go binding**：`GetModel3DSpec(modelPath)`（取 Spec3D，web 端桩无效时需 WASM 兜底）、`SaveScreenshotFile(filename, base64)`（落盘，web 模式走浏览器下载）

## 链路细节

### 透明背景多角度截图
- `WebGLRenderer({alpha:true, preserveDrawingBuffer:true, antialias:true})` + `setClearColor(0x000000, 0)`
- 四角度 `theta ∈ [0, π/4, π/2, -π/4]`，相机在 `center + [sinθ·dist, 0, -cosθ·dist]`
- `dist = (maxDim / (2·tan(22.5°)) / 0.85) · 1.2`（Box3 最大维度算出）
- FOV=45°，纵横比 1，近/远 0.1/1000，`lookAt(center)`

### 灯光提取
- `toScreenshotLights()` 从 `LightCapability` 取三点布光 + `attenuateAmbientForSky` PMREM 衰减（所见即所得）
- **三点全关是用户刻意暗场景** → 截图保持暗（不 fallback 标准灯）；cap 缺失才 fallback（ADR-126-P5）
- `lightDirToPosition(d, 5)` 将方向向量转位置（radius=5 对齐预览 `createDirectional`）

### Blob URL 释放
- `decoder/cache.ts`：覆盖同 key 时新旧 blob URL 差集判定，仅差集 URL 才 revoke（P1 修复，防同对象 re-set 误 revoke）
- `collectBlobUrls` 收集：`geometry.textures[]` / `geometry.texture` / `v.texture` / `authors[].avatarUrl` / `avatars[]` 所有 `startsWith("blob:")` 值
- 离屏渲染器 `finally` 块：`ysmObject.removeFromScene` → `renderer.dispose()` → `forceContextLoss?.()`（强制释放 GL 上下文，防延迟到 GC）

## 与其他子系统关系

- 消费者：`preview-controls.md`（六角度截图按钮 `mmdShotNodes`/`ysmShotNodes`）+ `dom-fab`（FAB 触发）
- 依赖：`model3d.md`（`Spec3D` 类型）、`utils-export.md`（工具函数，已覆盖 `screenshotFromRenderer`/`loadTextures` 实现细节）
- 上游：`screenshotPreview` 已不存在（ADR-052 P3）—— 当前路径全部经 `screenshotFn` 或 `renderMultiAngle`
- 下游：Go `SaveScreenshotFile` 落盘

## 不变量

- **`preserveDrawingBuffer: true` 是截图前提**：关闭时 canvas 下帧被清空，`toDataURL` 返回空。三步原子（临时开启 → render → toDataURL → 还原）
- **离屏渲染器必须 try/finally 全程**：创建→场景构建→四角度循环全程在 try/finally 内（P2 修复：原 try 起点在角度循环，buildYsmObject 抛错时 renderer 永不 dispose）
- **失败统一返回 `null` 不 reject**（P2）；`saveScreenshot` 对 `current` 空值抛错以便消费者统一 catch + toast
- **`AngleShot` 结果集剔除空 base64**（GPU 异常防御，P3）；`maxDim` 非有限或 ≤0 提前返回 null（Box3 为空时相机位置 NaN）
- **cache 覆盖同 key 不无条件 evict**：新旧 blob URL 差集判定，防同对象 re-set 时 revoke 仍在用的 URL（P1）
- **cache 是模块级单例**：组件 `disconnectedCallback` 不得清空（跨页复用），淘汰仅由 FIFO 上限驱动
- **WASM 兜底由视图层注入**：`screenshot-render.ts` 不 import views 类型（保边界），`decodeYsm` 通过 `opts.decodeYsm` 依赖注入（ADR-136 第四刀）
- **离屏 renderer dispose 后必须 `forceContextLoss()`**（P3）：否则上下文延迟到 GC 才释放，长会话累积
- **纹理加载失败要 invalidate**：`loadTextures` 检测到 `userData.loadError` 时 `textureCache.invalidate(url)` 清除损坏条目
- **`all` 键串行保存**：`for (const k of ["front","45","side","back45"]) await saveScreenshot(model, k, …)`

## 相关

- [utils-export](./utils-export.md) — 工具函数层（已覆盖实现细节，本卡互补用户视角链路）
- [preview-controls](./preview-controls.md) — 六角度截图按钮 `mmdShotNodes`/`ysmShotNodes`
- [model3d](./model3d.md) — `Spec3D` 类型 + 渲染核心
- [dom-fab](./dom-fab.md) — FAB 触发截图
- [preview_core](./preview_core.md) — `mount-preview-core fullCleanup` 统一释放 `texture-cache`
