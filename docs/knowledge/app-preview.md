---
kind: app-preview
name: 预览面板 app-preview
tier: architecture
adr:
  - ADR-137
  - ADR-138
  - ADR-253
category: ui
source_files:
  - frontend/src/views/app-preview/
auto_fields:
  symbols_with_lines:
    - addOpLog
    - appendLitematicPreview
    - BedrockBone
    - BedrockCube
    - BedrockModel
    - bigIconHTML
    - bindPreviewTabs
    - BoneBounds
    - BoneEntry
    - BoundsOpts
    - buildBoneExportRow
    - buildBoneNamesText
    - buildStatsCard
    - buildToggleRow
    - buildYsmModelSchema
    - calcBoneHitZones
    - CardShowConfig
    - cleanupEmpty3D
    - cleanupLitematic3D
    - cleanupMaid3D
    - cleanupMmd3D
    - cleanupPack3D
    - cleanupScene3D
    - cleanupVoxel3D
    - cleanupVrm3D
    - cleanupYsm3D
    - closeActive3DOverlay
    - collectBoneBounds
    - componentCountsFromSpec
    - createFbx3D
    - createLitematic3D
    - createMmd3D
    - createPack3D
    - createScene3D
    - createVrm3D
    - createYsm3D
    - cubeVec
    - DetailGenGuard
    - drawMiniView
    - drawView
    - errorPlaceholderHTML
    - fillAuthorsAsync
    - getRegisteredRoutes
    - HitZone
    - invalidateEmptyPreview
    - invalidateLitematicPreview
    - invalidateMaidPreview
    - invalidateMmdPreview
    - invalidatePackPreview
    - invalidateScenePreview
    - invalidateVrmPreview
    - invalidateYsmPreview
    - loadModel2D
    - loadModelData
    - LoadModelOpts
    - MaidOpenOptions
    - makeMmdDataPort
    - MmdBottomNavCtx
    - mmdModelInfoNodes
    - MmdPlayBridge
    - mmdShotNodes
    - Model2DOptions
    - modelDetailHTML
    - ModelDetailMeta
    - ModelLike
    - openEmpty3DFullscreen
    - OpenerOptions
    - openFullPreview
    - openModel3DFullscreen
    - OpenModel3DOptions
    - pageShellHTML
    - PlaceholderHint
    - placeholderHTML
    - playNodes
    - Prefer3DState
    - preloadModel
    - PREVIEW_CLEANUP
    - PREVIEW_HANDLERS
    - PREVIEW_INVALIDATE
    - previewCSS
    - PreviewCtx
    - PreviewDebugger
    - PreviewImageLoader
    - PreviewRoot
    - PreviewRouterCtx
    - PreviewShowFn
    - PreviewTabSpec
    - readFileBytes
    - registerReRoute
    - registerYsmModelSchema
    - renderModel2D
    - resolveFbxSiblings
    - resolveMmdSiblings
    - resolveMorphSiblings
    - resolveSceneSiblings
    - resolveSiblingsByType
    - resolveSiblingsForRoute
    - resolveStageSiblings
    - routeModelPreview
    - routePackInfo
    - routeTypeMeta
    - safeUrl
    - saveScreenshot
    - scanModelsByType
    - setActive3DClose
    - setup2DCanvas
    - shotButtonNodes
    - showCard
    - showFbxPreview
    - showLitematic
    - showMaidPreview
    - showMmdPreview
    - showModelDetail
    - showMorphPreview
    - showResourcePack
    - showScenePreview
    - showShaderpack
    - showSimplePreview
    - showStagePreview
    - showVrmMeta
    - statsCardHTML
    - StatsCardModel
    - SummaryAnimGroup
    - SummaryAuthor
    - summaryCardHTML
    - SummaryConfigMenu
    - tabbedShellHTML
    - VrmMaterialControlBridge
    - vrmModelInfoNodes
    - vrmShotNodes
    - withPreviewExtras
    - YsmControlsContext
    - YsmDecoder
    - YSMHeader
    - ysmModelStats
    - YsmModelStats
    - ysmModelTextureSlots
    - YsmOpenOptions
    - ysmShotNodes
    - YsmSummary
  tests:
    - frontend/src/views/app-nav/index.test.ts
    - frontend/src/views/app-preview/utils.test.ts
    - frontend/src/views/app-preview/app-preview.component.test.ts
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
  - 详情卡 3D 入口、nav-fab、card-shell 统一壳
quick_risk_lines:
  - 预览面板必须经 model:select 事件驱动，WASM 能力判定由 matchTypeByExt 注册表驱动，禁止内联正则
pitfalls:
  - 手写 .(ysm|zip|json) 判定 → .7z 漏判、注册表变更不同步；必须经 matchTypeByExt(RESOURCE_TYPES.YSM)
  - async 窗口期无 container.isConnected 守卫 → 组件卸载后异步回调写已卸载 DOM；每个 await 后必须检查 isConnected
  - 找「详情卡里的 3D 按钮」→ ADR-253 D7 已全部删除；3D 入口唯一为左下角 nav-fab（app-nav 的 .nav-viewer-fab）
use_when:
  - 预览
  - 模型预览
  - 3D 预览
  - 3D 入口
  - nav-fab
  - 详情卡
  - Litematic
  - WASM 解码
invariant_anchors:
  - frontend/src/views/app-preview/index.ts|_previewGuard
  - frontend/src/views/app-preview/detail.ts|detailGen
  - frontend/src/utils/async/load-guard.ts|createLoadGuard
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
- `card-shell.ts` — **统一详情卡壳**（ADR-253 D4 自 `detail-3d.ts` 迁出的叶子模块）：`showCard(ctx, path, CardShowConfig)`，`fetchMeta` / `renderCard` / `wireFab` / `postRender` 四件套；**7 张卡全部经它渲染**（6 种格式卡 + 资源包）。`wireFab` 槽位保留但**当前各卡均为 no-op**（ADR-253 D7 删除详情卡 3D 入口 FAB 后无按钮可绑）；有 `fetchMeta` 时壳预写加载占位，**错误态只渲染错误占位、不渲染 FAB**。`showModelDetail`（YSM）因需「详情/骨骼」tab 行**尚未收编**。
- `siblings.ts` — `resolveSiblingsByType` 统一底座 + 各格式 `resolve*` 薄封装 + **`resolveSiblingsForRoute`（ADR-253 D1 路由层单一出口）**：`openModel3DFullscreen` 在调用方未传 `siblings` 时按 routeKey 自算，空结果归一为 `undefined`。
- `skeleton.ts` — `loadModel2D`：**纯 2D 骨骼渲染编排**（ADR-253 D7 起 `_toggle3D`/`_prefer3D` 整块已随 FAB 删除退役），委托 `views/app-preview/model2d/model2d.ts` 与 `preview-3d/mesh/model3d.ts`；截图走 `SaveScreenshotFile`。**3D 入口统一为左下角 nav-fab**（`app-nav` 的 `.nav-viewer-fab` → `openModel3DFullscreen`），详情卡内已无 3D 按钮。
- `*-adapter.ts` / `*-3d.ts` — 各资源类型（YSM/MMD/VRM/Litematic/FBX/maid）的 3D 适配器，均通过 `PreviewAdapter.build` 契约挂内容层，shared 模式复用核心 renderer/rAF/controls。
- `wasm-decode.ts`（`preview-3d/decoder/`）— `decodeYsmViaWasm`：前端 WASM 解码 .ysm（经 Go `ReadFileBytes` 取字节，走 `decoder/cache.ts` 缓存）；同目录 `.animation.json` 扫描驱动 `createYsmAnimPlayer`。
- `litematic-3d.ts` — `createLitematic3D` / `cleanupVoxel3D`：通用外壳归 `mount-preview-core.ts` 的 `mount3D(adapter, path)`，体素内容层归 `litematic-adapter.ts` 的 `buildLitematicScene`。
- `litematic-meta.ts` — `showLitematic`（Go `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`）。
- `maid-3d.ts` — 车万女仆详情 + 3D 预览（Bedrock generic 模式），详情卡复用 YSM `statsCardHTML` 彩色分区。**GetModel3DSpec 单视图（ADR-160）**：详情数据 = `AnalyzeBedrockModel`（聚合纹理/尺寸/metadata/格式）+ `GetModel3DSpec`（逐组件统计唯一源）；蓝卡逐组件行 = `componentCountsFromSpec(spec)` 投影（与 YSM 详情、3D「组件」下拉同构），纯静态无选中态；大字 = 组件合计，spec 失败回落聚合口径；FAB = 整包 3D（不再传 `subModelIdx`/`subPath`，角色切换收敛在 3D 组件下拉）。交互式 L0 清单（dp-submodels/chip）与 `AnalyzeBedrockModelEntry` 逐角色预取已退役。
- `utils.ts` — 共享类型与工具：`PreviewCtx`、`getPrefer3D` / `setPrefer3D`、`stripYsgpTextHeader`。
- `decoder/geometry.ts`（`preview-3d/decoder/`）— `BedrockCube` / `BedrockBone` / `BedrockGeometry` 类型 + `parseBedrockGeometryFromJSON`。
- `tpl.ts` — `modelDetailHTML`（详情面板）/ `statsCardHTML`（统计卡：彩色分区 + 逐组件行 componentCounts + 纹理分类）。「文件信息」橙卡 = 格式后缀（`extOf` 派生）+ 解码器来源徽标 `ysm-badge`：值取 `model._decodedBy`（`DECODE_SOURCE` 来源码），`decodeBadgeHTML()` 映射 SVG 图标（`parser`/`package`）+ i18n 文案（`preview.decodedBy.*`），未识别的码不渲染（2026-09-18，徽标从 `summaryCardHTML` 的 `h3` 标题行迁入）。
- `decoder/texture-order.ts`（`preview-3d/decoder/`）— `buildOrderedTexKeys`：纹理有序列表计算，与 Go `internal/app/texture_order.go` 口径严格对称。
- `decoder/parse-ysm-json.ts`（`preview-3d/decoder/`）— `parseYsmJsonDirect(json)`：解压后 YSM 的 `ysm.json` 直接解析，双格式分支（YSM 专属 / 标准 Bedrock）。
- `decoder/cache.ts`（`preview-3d/decoder/`）— 模块级预览缓存（FIFO 上限 50，与 `export.md` 口径一致）。

### maid 详情数据源与子实体词汇（ADR-160）

**数据源分工（详情两调用各司其职，不重复口径）**：

| 用途 | 数据源 | 说明 |
|------|--------|------|
| 蓝卡逐组件行（骨骼/立方体） | `GetModel3DSpec(zip).models` → `componentCountsFromSpec` | 与 3D「组件」下拉同一 spec 视图；骨骼 = `bones.length`、立方体 = Σ `bones[]._cubeCount` |
| 大字合计（骨/立方体） | 上者 reduce | spec 不可得（解析失败）时回落 `AnalyzeBedrockModel` 聚合 `boneCount`/`cubeCount` |
| 纹理/尺寸/metadata/格式 | `AnalyzeBedrockModel` | 纹理尺寸优先 spec 首组件声明值（对齐 3D 面板口径） |

**子实体词汇映射（一物一名；跨层搜索命中表）**：maid「角色」= 容器内一个组件 = zip 内一个 geo 文件 = `spec.models[i]`。

| 旧名 / 曾用层名 | 统一词 | 现状 |
|-----------------|--------|------|
| `spec.models[i]` / `ModelGroup`（Go） | **组件** | 唯一权威视图：详情蓝卡行 + 3D「组件」下拉共用 |
| `BedrockSubModel` / `subModels[]` | 组件 | 概念并入 spec.models，前端不再消费 |
| `subPath` / `subModelIdx` | — | 已从 `MaidOpenOptions` / adapter 参数退役（整包加载） |
| `Entry` / `AnalyzeBedrockModelEntry` | — | 逐角色预取退役，3D 整包 spec 替代 |
| `L0` / `dp-submodels` / chip 清单 | — | 交互清单退役；「角色数」= 蓝卡组件行数 |
| 菜单「组件」/ `comps` | 组件 | 3D 内角色切换通道（ADR-132 `multiModelSelectNode`） |

**搜索提示**：找 maid 角色级统计 → 入口 `GetModel3DSpec` / `componentCountsFromSpec` / `spec.models`；
「🧩 L0 清单角色 (10)」等旧 UI 术语代码内已不存在，对应物 = 蓝卡静态组件行 + 3D 组件下拉。


## 对外 API / 入口

- 自定义元素：`<app-preview>`
- 监听 bus：`model:select`（`{ path, isDir }`；目录走整合包信息 `GetPackInfo`，文件走类型分流）
- 派发 bus：`toast:show`（仅子模块的加载失败路径）
- Go 调用（经 `getApp()`）：`DetectResourceType` / `FindPreviewImage` / `ExtractPreviewTexture` / `GetPackInfo` / `AnalyzeBedrockModel` / `ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta` / `ReadShaderpackLang` / `ReadFileBytes` / `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic` / `GetModel3DSpec` / `SaveScreenshotFile`。网页版 fallback 型 binding 已由 `web-fs.ts` 实现。类型图标/元数据自 ADR-269 D3 起改同步读 `utils/resource/schema.ts`，不再走 `LoadResourceTypes` RPC。
- 子模块入口：`loadModelData` / `loadModel2D` / `openFullPreview` / `decodeYsmViaWasm` / `createLitematic3D` / `cleanupVoxel3D` / `showLitematic` / `showModelDetail` / `showResourcePack` / `showShaderpack` / `showSimplePreview` / `renderMultiAngle`

## 与其他子系统关系

- 由 `app-content/index.ts` 顶部副作用静态导入完成注册（见知识卡 `app_content`）
- `model:select` 派发方为 `app-tree` 节点点击与诊断页去重定位
- 2D/3D 骨骼计算委托 `model2d.ts` / `preview-3d/mesh/model3d.ts`，动画解析走 `utils/animation/animation.ts`
- Litematic/schematic 解析对应 Go 端 `go/litematic`（见知识卡 `go_litematic`）
- WASM 解析口径与 Go 端 `go/ysm` 一致；缓存层为 `preview-3d/decoder/cache.ts`
- 组件实例实现 `PreviewCtx` 最小接口，子模块只依赖该接口，不反向引用组件全貌

## 不变量

- `model:select` 回调进入即 `_previewGuard.invalidate()`；`_showModelDetail` / `_showPackInfo` 在每个 `await` 之后必须 `if (this._previewGuard.stale(gen)) return`（含 catch 分支），否则慢条目 A 的迟到结果会覆盖已切换的 B 的预览。代际守卫统一为 `utils/async/load-guard.ts` 的 `createLoadGuard`（ADR-230 收口，原 `gen-guard.ts` 的 `GenGuard` 类已删除，测试并入 `load-guard.test.ts`）。
- `showLitematic` 有独立模块级代际 `litematicGen`
- `_unsubs` 中的 `bus.on` 订阅必须在 `disconnectedCallback` 清理；拖拽 window 监听经 `_unsubs` 挂销毁清理
- 2D 拖拽的 window 监听先移除上一轮再绑定——用 `AbortController`（**`ctx.dragAbortCtrl` 挂组件实例**，原模块级 `_prevAbort` 已迁移至实例——多实例互不串扰，P3 修复）：`ctx.dragAbortCtrl?.abort()` → `new AbortController()` → 监听带 `signal`，`ctx.unsubs` 注册 abort 清理，替代旧的手动 `_prevWindowMove`/`_prevWindowUp` 产消模式，无竞态
- ~~**`loadModel2D` 挂载守卫（P1 修复 2026-09）**：rAF 自动弹 3D（`_prefer3D` 路径）回调内必须先查 `ctx.root.isConnected`……~~
  **ADR-253 D7 已随 `_prefer3D` 自动弹整块移除**（无 rAF 回调 → 无需该守卫）。
- 预览缓存淘汰时必须 `URL.revokeObjectURL` 释放 blob URL
- mount-preview-core 拆分为 `mount3D`（shell 装配 + infra 创建 + 输入绑定 + rAF 管线）+ `cleanupPreview` / `switchPreview` / `_resetSingletons`
- Three.js 现为静态依赖（`litematic-3d.ts` / `model3d-loader.ts` / `screenshot-render.ts` / `model3d.ts` 均静态 `import * as THREE`）
- 坐标变换遵循 ysmview 口径（改 model2d/model3d 前先 grep bug-chronicle）
- **纹理口径对称**：`decoder/texture-order.ts` 与 Go `internal/app/texture_order.go` 口径严格对称，改一侧须同步另一侧
- **3D overlay 单例钩子**（`ctx.active3DClose` 挂组件实例，原模块级 `_active3DClose` 已迁移至实例——P1 修复，多实例互不串扰）：全局同时只允许一个活跃 3D overlay——新开 3D 前先调上一份的 `ctx.active3DClose` 关掉旧层（`app-preview/index.ts` 在 `model:select` 时调用 `closeActive3DOverlay`）
- **3D 内模型切换**：`PreviewHandle.switchTo(path)` 复用 renderer/rAF/controls/灯光重建内容层；`mount3D` 可选 `Mount3DOptions.siblings`（同类型候选 ≥2 时 topBar 渲染切换下拉）
- **siblings / entry 归路由层（ADR-253 D1+D6）**：`openModel3DFullscreen` 在调用方未传 `siblings` 时按 routeKey 自算（`siblings.ts` `resolveSiblingsForRoute`，空结果归一为 `undefined`）；详情卡 FAB 与导航栏 FAB 因此行为一致。opener 签名已升格为 `(path, opts?: OpenerOptions)`（`OpenerOptions extends Mount3DOptions { entry? }`），**必须转发 opts** `(path, opts) => createXxx3D(path, opts)`——否则候选与 entry 在 opener 处被静默丢弃。`entry` 由资源包 opener 映射为 `createPack3D` 的 `startEntry`
- **YSM 骨骼动画（ADR-100）**：动画数据优先取 `model._animClips`（loader 统一挂载），无内嵌时兜底扫同目录 `*.animation.json` → `createYsmAnimPlayer` 驱动骨骼
- **`openModel3DFullscreen` 自洽兜底（P2 修复 2026-09）**：入口 `getApp()` 若后端不可用会 reject——函数内 try-catch + toast（`preview.backendUnavailable`）后 return，不依赖所有调用方各自 catch（app-nav FAB 有兜底，但 litematic-3d 裸调用无）
- **DOM 注入转义约定（XSS 防御）**：详情/骨骼/骨架面板凡向 DOM 注入外部或模型派生数据，禁止 `innerHTML` 裸拼 `${var}`；一律走 `utils/dom/html.ts` 的 `esc()` 或 `createElement` + `textContent`
- **自建全屏 overlay 的对话框语义（P2 补齐 2026-09-13）**：`zoom.ts` 的 `.zoom-overlay` 本质是模态，必须与 `features/dialogs/modal.ts` 基座同口径——`role="dialog"` + `aria-modal="true"` + `aria-label` + `tabIndex=-1`，打开时 `overlay.focus()` 移入焦点、关闭时归还触发元素（WCAG 2.4.3）。**只挂 Esc 关闭不算收口**（同轮整改曾漏 `app-content/site/events.ts` 之外的这一处）
- **litematic 元数据面板样式（2026-09 补）**：`.lt-*` 全族（`.lt-material-list` / `.lt-block-row` / `.lt-color-swatch` / `.lt-block-name` / `.lt-block-count` / `.lt-meta-row` / `.lt-meta-label`）此前**全仓零 CSS 规则**——`litematic-meta.ts` 的方块颜色色块是**空 inline span**（只有内联 `background`、没有任何尺寸）⇒ **恒不可见**，方块颜色根本没渲染；元数据行无 flex ⇒ label/value 挤成一行、label 不弱化。规则现落 `css.ts` 的 `previewCSS`，与同文件第 121 行那行全内联（`display:flex;justify-content:space-between;padding:4px 0;…`）同口径收口为类。**闸为何曾看不见**：`lt-` 命名空间在本域从未被定义过，检查 3 的自推导域结构上不含它——由 `css-layer-check` **检查 6「跨层存在性」**现形（ADR-275）。

## 相关

- `frontend/src/views/app-preview/model2d/model2d.ts` / `preview-3d/mesh/model3d.ts` — 2D/3D 骨骼渲染与计算
- `frontend/src/preview-3d/decoder/cache.ts` — 模块级预览缓存
- `frontend/src/wasm/` — WASM 生成数据（base64 豁免文件）
- 知识卡：`app_content`、`app_tree`、`go_ysm_parser`、`go_litematic`、`event_bus`、`pointer-events`
- ADR-057（3D 预览悬浮触发按钮与双端响应式控制层）；`utils/dom/fab.ts` — FloatingActionButton
- ADR-072（3D 归置已落地）：3D 适配器层已下沉 `preview-3d/adapters/` 与 `preview-3d/`