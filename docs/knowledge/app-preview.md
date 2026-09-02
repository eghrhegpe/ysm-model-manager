---
kind: app-preview
name: 预览面板 app-preview
tier: architecture
adr:
  - ADR-137
  - ADR-138
category: ui
source_files:
  - frontend/src/views/app-preview/
auto_fields:
  symbols_with_lines:
    - addOpLog:20
    - appendLitematicPreview:134
    - appendMmdPreview:38
    - BedrockBone:26
    - BedrockCube:16
    - BedrockModel:32
    - BoneEntry:5
    - buildBoneExportRow:168
    - buildBoneNamesText:15
    - buildDepthMap:34
    - buildStatsCard:90
    - buildToggleRow:48
    - buildYsmModelSchema:326
    - calcBoneHitZones:11
    - CameraControlBridge:19
    - cleanupEmpty3D:40
    - cleanupLitematic3D:255
    - cleanupMaid3D:88
    - cleanupMmd3D:33
    - cleanupPack3D:64
    - cleanupScene3D:38
    - cleanupVoxel3D:139
    - cleanupVrm3D:59
    - cleanupYsm3D:87
    - closeActive3DOverlay:36
    - createFbx3D:26
    - createLitematic3D:91
    - createMmd3D:28
    - createPack3D:33
    - createScene3D:33
    - createVrm3D:44
    - createYsm3D:50
    - cubeVec:11
    - detailGen:24
    - drawMiniView:360
    - drawView:360
    - fill3DPanel:18
    - fillAuthorsAsync:232
    - fillMmdModelPanel:44
    - fillMmdShotPanel:213
    - fillYsmShotPanel:74
    - GenGuard:13
    - getPrefer3D:36
    - getRegisteredRoutes:34
    - HitZone:9
    - invalidateEmptyPreview:45
    - invalidateLitematicPreview:29
    - invalidateMaidPreview:93
    - invalidateMmdPreview:43
    - invalidatePackPreview:69
    - invalidateScenePreview:43
    - invalidateVrmPreview:64
    - invalidateYsmPreview:92
    - iRow:15
    - loadModel2D:59
    - loadModelData:29
    - LoadModelOpts:11
    - MaidOpenOptions:37
    - makeMmdDataPort:11
    - makeShotAction:34
    - MaterialControlBridge:180
    - MmdBottomNavCtx:29
    - mmdModelInfoNodes:62
    - MmdPlayBridge:96
    - mmdShotNodes:197
    - Model2DOptions:37
    - modelDetailHTML:20
    - ModelDetailMeta:6
    - ModelLike:13
    - ModelSpec:25
    - openEmpty3DFullscreen:35
    - openFullPreview:7
    - openModel3DFullscreen:62
    - OpenModel3DOptions:39
    - PanelHandle:13
    - playNodes:114
    - preloadModel:115
    - previewCSS:2
    - PreviewCtx:32
    - PreviewDebugger:20
    - PreviewImageLoader:25
    - PreviewRoot:8
    - readFileBytes:14
    - registerReRoute:26
    - registerYsmModelSchema:105
    - renderModel2D:58
    - resolveFbxSiblings:7
    - resolveMmdSiblings:13
    - resolveMorphSiblings:33
    - resolveSceneSiblings:28
    - resolveSiblingsByType:13
    - resolveStageSiblings:13
    - saveScreenshot:201
    - scanModelsByType:155
    - sec:6
    - setActive3DClose:42
    - setPrefer3D:39
    - setup2DCanvas:23
    - shotButtonNodes:65
    - showFbxPreview:169
    - showLitematic:187
    - showMaidPreview:327
    - showMmdPreview:116
    - showModelDetail:27
    - showMorphPreview:229
    - showResourcePack:144
    - showScenePreview:199
    - showShaderpack:246
    - showSimplePreview:228
    - showStagePreview:296
    - showVrmMeta:29
    - statsCardHTML:88
    - StatsCardModel:58
    - VrmMaterialControlBridge:18
    - vrmModelInfoNodes:26
    - vrmShotNodes:42
    - withPreviewExtras:172
    - YsmContentHandle:33
    - YsmControlsContext:46
    - YsmDecoder:15
    - YsmModel:24
    - ysmModelStats:278
    - YsmModelStats:270
    - ysmModelTextureSlots:298
    - YsmOpenOptions:37
    - ysmShotNodes:69
  tests:
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-preview/utils.test.ts
    - frontend/src/views/app-preview/component.test.ts
    - frontend/src/views/app-preview/maid-3d.test.ts
    - frontend/src/views/app-sidebar/loader.test.ts
    - frontend/src/views/app-sync-manager/index.test.ts
    - frontend/src/views/app-toast/index.test.ts
    - frontend/src/utils/dom/feedback.test.ts
    - frontend/src/views/context-menu/index.test.ts
  quick_groups:
    - 3D 预览面板与模型追加
  quick_intents:
    - 预览面板、模型预览、2D 骨骼 / 3D 预览
    - Litematic / 蓝图、资源包 / 光影包
    - model:select、WASM 解码、放大预览
    - app-preview 组件、_previewGuard、detailGen
    - showResourcePack、showShaderpack
  quick_risk_lines:
    - 预览面板必须经 model:select 事件驱动，WASM 能力判定由 matchTypeByExt 注册表驱动，禁止内联正则
  pitfalls:
    - 手写 .(ysm|zip|json) 判定 → .7z 漏判、注册表变更不同步；必须经 matchTypeByExt(RESOURCE_TYPES.YSM)
    - async 窗口期无 container.isConnected 守卫 → 组件卸载后异步回调写已卸载 DOM；每个 await 后必须检查 isConnected
  use_when:
    - 预览
    - 模型预览
    - 3D 预览
    - Litematic
    - WASM 解码
  invariant_anchors:
    - frontend/src/views/app-preview/index.ts|_previewGuard
    - frontend/src/views/app-preview/detail.ts|detailGen
    - frontend/src/views/app-preview/gen-guard.ts|GenGuard
    - frontend/src/views/app-preview/skeleton.ts|closeActive3DOverlay
    - frontend/src/views/app-preview/loader.ts|loadModelData
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-preview/utils.test.ts
  - frontend/src/views/app-preview/component.test.ts
  - frontend/src/views/app-preview/maid-3d.test.ts
  - frontend/src/views/app-sidebar/loader.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/utils/dom/feedback.test.ts
  - frontend/src/views/context-menu/index.test.ts
quick_groups:
  - 3D 预览面板与模型追加
quick_intents:
  - 预览面板、模型预览、2D 骨骼 / 3D 预览
  - Litematic / 蓝图、资源包 / 光影包
  - model:select、WASM 解码、放大预览
  - app-preview 组件、_previewGuard、detailGen
  - showResourcePack、showShaderpack
quick_risk_lines:
  - 预览面板必须经 model:select 事件驱动，WASM 能力判定由 matchTypeByExt 注册表驱动，禁止内联正则
pitfalls:
  - 手写 .(ysm|zip|json) 判定 → .7z 漏判、注册表变更不同步；必须经 matchTypeByExt(RESOURCE_TYPES.YSM)
  - async 窗口期无 container.isConnected 守卫 → 组件卸载后异步回调写已卸载 DOM；每个 await 后必须检查 isConnected
use_when:
  - 预览
  - 模型预览
  - 3D 预览
  - Litematic
  - WASM 解码
invariant_anchors:
  - frontend/src/views/app-preview/index.ts|_previewGuard
  - frontend/src/views/app-preview/detail.ts|detailGen
  - frontend/src/views/app-preview/gen-guard.ts|GenGuard
  - frontend/src/views/app-preview/skeleton.ts|closeActive3DOverlay
  - frontend/src/views/app-preview/loader.ts|loadModelData
status: active
---

# 预览面板 app-preview

## 概览

`app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），按 `model:select` 事件驱动。负责 YSM 模型的详情 / 2D 骨骼 / 3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展示。解码链路为「缓存 → 前端 WASM → Go 兜底」。由 `app-content` 顶部副作用静态导入完成注册。

## 核心职责

- `index.ts` — `<app-preview>` 生命周期编排：监听 `model:select`（回调开头 `this._previewGuard.invalidate()`），按 `DetectResourceType` 结果分流（pack → `showResourcePack`；ysm/空 → `showModelDetail`；litematic/blueprint → `showLitematic`；shaderpack → `showShaderpack`；MMD EntityPlayer → `PREVIEW_HANDLERS` 查表按 variants 分发；其他已知类型 → `showSimplePreview`）。
- `loader.ts` — `loadModelData`：统一模型加载（缓存 → WASM → Go `AnalyzeBedrockModel` 兜底）；WASM 能力判定由 `matchTypeByExt(modelPath, RESOURCE_TYPES.YSM)`（注册表驱动，防 `.7z` 漏判）；`.zip`/`.json` 支持 `ysm.json` manifest 按声明序合并多角色 geometry 与纹理。
- `detail.ts` — `showModelDetail` / `showResourcePack` / `showShaderpack` / `showSimplePreview`：详情面板渲染（Go 侧 `ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta` / `ReadShaderpackLang`）；`showVrmMeta` / `showMmdPreview` 已迁出至 `detail-3d.ts`。
- `skeleton.ts` — `loadModel2D`：2D/3D 骨骼渲染编排，委托 `preview-3d/model2d.ts` 与 `model3d.ts`；截图走 `SaveScreenshotFile`；3D overlay 触发键 `🎨3D` 为右下角悬浮 FAB。
- `*-adapter.ts` / `*-3d.ts` — 各资源类型（YSM/MMD/VRM/Litematic/FBX/maid）的 3D 适配器，均通过 `PreviewAdapter.build` 契约挂内容层，shared 模式复用核心 renderer/rAF/controls。
- `wasm.ts` — `decodeYsmViaWasm`：前端 WASM 解码 .ysm（经 Go `ReadFileBytes` 取字节，走 `cache.ts` 缓存）；同目录 `.animation.json` 扫描驱动 `createYsmAnimPlayer`。
- `litematic-3d.ts` — `createLitematic3D` / `cleanupVoxel3D`：通用外壳归 `mount-preview-core.ts` 的 `mount3D(adapter, path)`，体素内容层归 `litematic-adapter.ts` 的 `buildLitematicScene`。
- `litematic-meta.ts` — `showLitematic`（Go `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`）。
- `maid-3d.ts` — 车万女仆详情 + 3D 预览（Bedrock generic 模式），详情卡复用 YSM `statsCardHTML` 彩色分区。**L0 清单逐角色统计并行预取**（对齐 YSM 详情「不点击即见」）：首屏渲染后 `prefetchEntryStats()` 并发上限 3 逐 entry 调 `AnalyzeBedrockModelEntry`，每完成一个渐进重绘，chip 加 `.chip-stat`（N 骨骼 · M 立方体）；当前选中角色的统计卡同步用 entry 数据覆盖聚合值（与点击切换口径一致）；失败/无 sourcePath 角色保持无统计行不阻断；`subs.length <= 1` 不预取；`detailGen.stale(gen)` 守卫丢弃在途预取。
- `utils.ts` — 共享类型与工具：`PreviewCtx`、`getPrefer3D` / `setPrefer3D`、`stripYsgpTextHeader`。
- `geometry.ts` — `BedrockCube` / `BedrockBone` / `BedrockGeometry` 类型 + `parseBedrockGeometryFromJSON`。
- `tpl.ts` — `modelDetailHTML`（详情面板）/ `statsCardHTML`（统计卡：彩色分区 + L0 清单角色 + 纹理分类）。
- `texture-order.ts` — `buildOrderedTexKeys`：纹理有序列表计算，与 Go `internal/app/texture_order.go` 口径严格对称。
- `parse-ysm-json.ts` — `parseYsmJsonDirect(json)`：解压后 YSM 的 `ysm.json` 直接解析，双格式分支（YSM 专属 / 标准 Bedrock）。
- `cache.ts` — 模块级预览缓存。

## 对外 API / 入口

- 自定义元素：`<app-preview>`
- 监听 bus：`model:select`（`{ path, isDir }`；目录走整合包信息 `GetPackInfo`，文件走类型分流）
- 派发 bus：`toast:show`（仅子模块的加载失败路径）
- Go 调用（经 `getApp()`）：`DetectResourceType` / `FindPreviewImage` / `ExtractPreviewTexture` / `LoadResourceTypes` / `GetPackInfo` / `AnalyzeBedrockModel` / `ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta` / `ReadShaderpackLang` / `ReadFileBytes` / `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic` / `GetModel3DSpec` / `SaveScreenshotFile`。网页版 fallback 型 binding 已由 `web-fs.ts` 实现。
- 子模块入口：`loadModelData` / `loadModel2D` / `openFullPreview` / `decodeYsmViaWasm` / `createLitematic3D` / `cleanupVoxel3D` / `showLitematic` / `showModelDetail` / `showResourcePack` / `showShaderpack` / `showSimplePreview` / `renderMultiAngle`

## 与其他子系统关系

- 由 `app-content/index.ts` 顶部副作用静态导入完成注册（见知识卡 `app_content`）
- `model:select` 派发方为 `app-tree` 节点点击与诊断页去重定位
- 2D/3D 骨骼计算委托 `model2d.ts` / `preview-3d/model3d.ts`，动画解析走 `utils/animation/animation.ts`
- Litematic/schematic 解析对应 Go 端 `go/litematic`（见知识卡 `go_litematic`）
- WASM 解析口径与 Go 端 `go/ysm` 一致；缓存层为 `preview-3d/decoder/cache.ts`
- 组件实例实现 `PreviewCtx` 最小接口，子模块只依赖该接口，不反向引用组件全貌

## 不变量

- `model:select` 回调进入即 `_previewGuard.invalidate()`；`_showModelDetail` / `_showPackInfo` 在每个 `await` 之后必须 `if (this._previewGuard.stale(gen)) return`（含 catch 分支），否则慢条目 A 的迟到结果会覆盖已切换的 B 的预览。代际守卫统一为 `gen-guard.ts` 的 `GenGuard` 类。
- `showLitematic` 有独立模块级代际 `litematicGen`
- `_unsubs` 中的 `bus.on` 订阅必须在 `disconnectedCallback` 清理；拖拽 window 监听经 `_unsubs` 挂销毁清理
- 2D 拖拽的 window 监听先移除上一轮再绑定（模块级槽位 `_prevWindowMove` / `_prevWindowUp`），禁止累积
- 预览缓存淘汰时必须 `URL.revokeObjectURL` 释放 blob URL
- mount-preview-core 拆分为 `mount3D`（shell 装配 + infra 创建 + 输入绑定 + rAF 管线）+ `cleanupPreview` / `switchPreview` / `_resetSingletons`
- Three.js 现为静态依赖（`litematic-3d.ts` / `model3d-loader.ts` / `screenshot-render.ts` / `model3d.ts` 均静态 `import * as THREE`）
- 坐标变换遵循 ysmview 口径（改 model2d/model3d 前先 grep bug-chronicle）
- **纹理口径对称**：`texture-order.ts` 与 Go `internal/app/texture_order.go` 口径严格对称，改一侧须同步另一侧
- **3D overlay 单例钩子**（`skeleton.ts` 模块级 `_active3DClose`）：全局同时只允许一个活跃 3D overlay——新开 3D 前先调上一份的 `_active3DClose`（`keepPrefer=true` 保留 `_prefer3D`）
- **3D 内模型切换**：`PreviewHandle.switchTo(path)` 复用 renderer/rAF/controls/灯光重建内容层；`mount3D` 可选 `Mount3DOptions.siblings`（同类型候选 ≥2 时 topBar 渲染切换下拉）
- **YSM 骨骼动画（ADR-100）**：动画数据优先取 `model._animClips`（loader 统一挂载），无内嵌时兜底扫同目录 `*.animation.json` → `createYsmAnimPlayer` 驱动骨骼
- **DOM 注入转义约定（XSS 防御）**：详情/骨骼/骨架面板凡向 DOM 注入外部或模型派生数据，禁止 `innerHTML` 裸拼 `${var}`；一律走 `utils/dom/html.ts` 的 `esc()` 或 `createElement` + `textContent`

## 相关

- `frontend/src/views/app-preview/model2d/model2d.ts` / `preview-3d/model3d.ts` — 2D/3D 骨骼渲染与计算
- `frontend/src/preview-3d/decoder/cache.ts` — 模块级预览缓存
- `frontend/src/wasm/` — WASM 生成数据（base64 豁免文件）
- 知识卡：`app_content`、`app_tree`、`go_ysm_parser`、`go_litematic`、`event_bus`、`pointer-events`
- ADR-057（3D 预览悬浮触发按钮与双端响应式控制层）；`utils/dom/fab.ts` — FloatingActionButton
- ADR-072（3D 归置已落地）：3D 适配器层已下沉 `preview-3d/adapters/` 与 `preview-3d/`