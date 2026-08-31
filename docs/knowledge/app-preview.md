---
kind: app-preview
name: 预览面板 app-preview
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-preview/
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
invariant_anchors:
  - frontend/src/views/app-preview/index.ts|_previewGuard
  - frontend/src/views/app-preview/detail.ts|detailGen
  - frontend/src/views/app-preview/gen-guard.ts|GenGuard
  - frontend/src/views/app-preview/skeleton.ts|closeActive3DOverlay
  - frontend/src/views/app-preview/loader.ts|loadModelData
---

# 预览面板 app-preview

## 概览

`app-preview` 是仓库页右侧的预览面板组件（Shadow DOM），负责 YSM 模型的详情/2D 骨骼/3D 预览、Litematic 蓝图 3D 预览、资源包与光影包信息展示。它按 `model:select` 事件驱动，解码链路为「缓存 → 前端 WASM → Go 兜底」。组件由 `app-content` 顶部副作用**静态**导入完成注册（`app-content/index.ts` 顶部副作用 import，原动态 import 预加载方案已废弃）。

## 核心职责

- `index.ts` — `<app-preview>` 生命周期编排：监听 `model:select`（回调开头 `this._previewGuard.invalidate()`）、目录走 `_showPackInfo`、文件走 `_showModelDetail` 并按 `DetectResourceType` 结果分流（pack → `showResourcePack`；ysm/空 → `showModelDetail`；litematic/blueprint → `showLitematic`；**MMD 角色模型 EntityPlayer → `PREVIEW_HANDLERS` 查表注册，按 variants 分发（ADR-111）**：`.vrm` → `showVrmMeta`（meta 卡 + FAB 进 3D，对齐 YSM 模式）、`.pmx/.pmd` → `showMmdPreview`（ADR-072 D2）；SceneModel/CustomMorph/StageAnim 等 MMD 子类型 → 各自 preview handler；shaderpack → `showShaderpack`（`ReadShaderpackLang` 提显示名+配置简介）；其他已知类型 → `showSimplePreview`）；类型元信息经 `_typeMeta` 查 `LoadResourceTypes` 预载表；`_loadPreviewImage` 缩略图三级加载；`cacheSetEvictHandler` 注册缓存淘汰时回收 blob URL（含 `geometry.textures` / `authors[].avatarUrl` / `avatars` 去重后 revoke）
- `loader.ts` — `loadModelData`：统一模型加载（缓存 → WASM → Go `AnalyzeBedrockModel` 兜底）；**ADR-066 P0 解硬编码墙**：WASM 能力判定由内联正则 `/\.(ysm|zip|json)$/i` 改为 `matchTypeByExt(modelPath, RESOURCE_TYPES.YSM)`（注册表驱动，附带修复原正则漏判 `.7z`）。**网页版（2026）**：`AnalyzeBedrockModel` / `AnalyzeBedrockModelEntry` 已由 `web-fs.ts` 接管；`.zip`/`.json` 支持 `ysm.json` manifest 按声明序合并多角色 geometry 与纹理（`default_texture` 置首）
- `detail.ts` — `showModelDetail` / `showResourcePack` / `showShaderpack` / `showSimplePreview`：详情面板渲染（Go 侧 `ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta` / `ReadShaderpackLang`）——**ADR-072 D3 按资源域拆分**：`showVrmMeta`（VRM meta 卡 + FAB 进 3D，`vrm-adapter.readVrmMeta` 取 three-vrm `vrm.meta`：VRM0 `title/author/licenseName` ↔ VRM1 `name/authors/licenseUrl` 归一化）与 `showMmdPreview`（MMD 专属详情入口）已迁出至 `detail-3d.ts`，`detail.ts` 现仅 4 个 show 函数
- `skeleton.ts` — `loadModel2D`：2D/3D 骨骼渲染编排，委托 `features/preview-3d/model2d.ts` 的 `renderModel2D` 与 `features/preview-3d/model3d.ts` 的 `renderModel3D`；window 级拖拽监听存模块级 `_prevWindowMove` / `_prevWindowUp` 槽位（`skeleton.ts` 模块级变量），先移除上一轮再绑定并把移除逻辑 push 进 `ctx._unsubs`（`skeleton.ts` 绑定逻辑）；`model3dGuard`（GenGuard）作废在途 3D 渲染；截图走 `SaveScreenshotFile`。**ADR-057 控制层重构**：3D overlay 顶/底控制栏原内联 `style.cssText` 抽为全局 CSS 类（`utils/dom/fab.ts` 的 `ensureFabStyles()` 注入 head——overlay 挂 `document.body` 为 light DOM，全局 CSS 直接生效）；触发键 `🎨3D` 由面板内普通 tab 改为右下角悬浮 FAB（`.ysm-fab`，Shadow DOM 内样式在 `css.ts`，隔离不继承 head）；并接入 `registerAndroidBackHandler` 在 overlay 打开时消费安卓返回键关层。**async 窗口期守卫约定**（P2 修复）：每个 `await` 前后及 DOM 创建后立即检查 `container.isConnected`，防组件卸载后异步回调写入已卸载 DOM（`skeleton.ts` 三处守卫）。**方案 A 统计卡迁移（2026-08-28）**：`loadModel2D` 增可选 `statsContainer` 参数——传入时统计卡（`buildStatsCard` 彩色分区 + 头像作者）渲染到该容器（详情卡 `#preview-stats`），骨架 tab 只留骨骼线条图；不传保持原状挂骨架区（兼容既有调用/测试）。**详情卡去重（2026-08-28）**：`summaryCardHTML`（`utils/format/summarize.ts`）不再渲染作者行（含文件名 `[作者]` 回退）与纹理尺寸行——作者/纹理由统计卡统一承载（头像 + 角色列表 + `pv-section-green` 彩色分区），摘要卡保留名称/描述/许可/资源/动画组/配置/链接，消除「作者出现两遍、纹理两遍」的信息重复。**顶部头像行移除（2026-08-28）**：`ysm-author-avatars` 容器（detail.ts 注入）与 `buildStatsCard` 的容器填充逻辑（skeleton-render.ts）一并删除——作者头像/角色在统计卡作者列表内统一承载，详情页顶部不再重复渲染 24px 小头像行。**统计卡按 L0 清单角色维度展示（2026-08-28）**：`statsCardHTML`（tpl.ts）增 `scale` 可选参数（来自 `summary.preview` 模型级缩放）+ 三块新内容——① `textureCategories` 分类统计行（`preview.roleTexCount`：「角色纹理 N · 独立模型 M」）——修复「额外纹理」口径把独立模型组件（projectile/vehicle/arrow）纹理混进角色纹理的误导；② 🎭 `subModels` L0 清单角色区块（`preview.rolesList`：每角色纹理标题 `textureNames[texSlot]` + 尺寸 + 缩放行）——区分「角色用纹理」与「独立模型纹理」（BedrockModel.TextureCategories 是现成字段，前端 `BedrockGeometry` 已透传 `subModels/textureNames/textureCategories`，无需改 Go）；③ 📐 缩放橙色分区（`preview.scaleLabel`）。数据链路：`detail.ts` 从 `showSummary.preview` 取缩放 → `loadModel2D` → `buildStatsCard` → `statsCardHTML`（均新增可选 scale 参数，缺省不渲染缩放行）。**作者 bilibili 链路修复（2026-08-28）**：`loader.ts fillAuthorsAsync` 映射 `_authors` 时原丢弃 `bilibili` 字段（只留 name/role/avatarUrl/avatarPath），统计卡 `buildStatsCard` 作者列表也从未渲染链接——修复：`geometry.ts` `_authors` 类型加 `bilibili?: string`、`fillAuthorsAsync` 保留 `a.bilibili`、作者行渲染 📺 链接（`safeUrl` 从 `summarize.ts` 导出复用，仅放行 http/https）；「链接 主页·赞助」是**模型级** `metadata.Link`（`summary.go:164`，一个模型一条），与作者级 `Contact.Bilibili`（`summary.go:159`，每作者一条）是两个数据源，不冲突
- `zoom.ts` — `openFullPreview`：全屏放大预览
- `mmd-adapter.ts` — **MMD 3D 预览适配器（ADR-066 P2，2026-08-16 落地）**：`ReadFileBytes` 读 PMX/PMD 字节 + `ScanModelEntries` 同目录纹理预读 → `LoadingManager.setURLModifier` 把模型/纹理 URL 映射为 blob URL（WebView2 读不了磁盘路径）→ 挂场景 + 灯光 + 包围盒定相机；`MMD.update` 每帧驱动 IK/追加变换，`dispose` 回收 GPU + blob URL；**shared 模式**（复用核心 renderer/rAF/controls），33 项测试全过
- `mmd-controls.ts` / `mmd-siblings.ts` / `mmd-3d.ts` — **MMD 根菜单两级层级导航（ADR-077 落地）**：旧 `buildMmdBottomNav` / slide-menu 弹窗删除，改 `fillMmdModelPanel` / `fillMmdPlayPanel` / `buildMaterialControls`，经 `ctx.menu.setAdapterItems` 收编进根菜单（模型 / 材质 / 播放 / 骨骼四面板）；`mmd-siblings.ts` 的 `resolveMmdSiblings` 归位 views 层防与 `mmd-adapter` 循环依赖；`mmd-3d.ts` 的 `createMmd3D` 为薄包装（同构 YSM/VRM/Litematic 模式）。**表情拆独立面板（2026-08-28）**：morph 列表原平铺在模型面板（84+ 行 slide-sublabel + ysm-preview-menu/row 撑爆面板），拆出 `fillMmdMorphPanel` 为独立菜单项（`id: "morph"` / 😀 / `legacyTestId: "mmd-morph-entry"`，`dockGroup: "model"`，对齐材质折叠模式）；`MmdPanelHooks` 增 `fillMorphPanel` 字段（mmd-3d / scene-3d hooks 同步注入，测试桩同步补齐）
- `fbx-3d.ts` / `fbx-siblings.ts` / `fbx-adapter.ts` — **FBX 预览 + 同类型切换（ADR-112 地基 + P0-1）**：`fbx-adapter.ts`（`features/preview-3d/adapters`）的 `buildFbxScene` 经 `PreviewAdapter.build` 挂内容层——动态 import `FBXLoader`，Go RPC `ReadFileBytes` 取字节 → blob URL → 解析，内嵌 `AnimationMixer` 播动画，shared 模式复用核心 renderer/rAF/controls，`0 backend import` 守 ADR-072 边界；`fbx-3d.ts` 的 `createFbx3D(path, opts?)` 为薄包装（同构 MMD/VRM/Litematic）。**P0-1（2026-08-21 `a0b4e9eb`）**：`siblings.ts` 抽通用底座 `resolveSiblingsByType(rtype, extRe)`（`GetRepoRoot`→`ScanModelEntries`→扩展名过滤→降级 `[]`，全类型复用），`fbx-siblings.ts` 的 `resolveFbxSiblings` 委托之按 `.fbx`（含大写）过滤；`showFbxPreview` FAB 点击传 `siblings` 进 `createFbx3D`，复用核心 `Mount3DOptions.siblings` 实现 3D 内同类型切换，与 MMD 对齐。**P2 骨骼面板（ADR-074 S2 扩展，2026-08-28）**：`features/preview-3d/fbx-bones.ts` 新增 `fbxBonesToBoneNodes(group)`（收拢全场景 SkinnedMesh 骨骼 → `BoneNode[]`，id=索引/parentId=父索引，对齐 mmd-bones 索引模式；无 SkinnedMesh → 空数组），`buildFbxScene` 经 `buildBoneTree` + `makeBonePanelRenderer` 注入 🦴 bones 菜单项（`legacyTestId: "fbx-bones-entry"`，`dockGroup: "model"`），与 YSM/MMD/VRM 同款通用骨骼面板——ADR-112 推迟的 FBX 骨骼能力补齐，复用零新增面板代码
- `vrm-3d.ts` / `vrm-adapter.ts` — **VRM 预览 + 动画播放（VRMA）**：`createVrm3D(path, opts?)` 为薄包装（同构 YSM/MMD/Litematic 模式，配套 `switchVrmPreview` / `appendVrmPreview` / `cleanupVrm3D` / `invalidateVrmPreview`）；`buildVrmScene` 经 `PreviewAdapter.build` 挂内容层，`vrm-3d.ts` 注入 `listAllFilePaths` 端口（数据经端口注入、0 backend import）供同目录 `.vrma` 发现；`vrm-adapter` 注册 `VRMAnimationLoaderPlugin`，`createVRMAnimationClip` → `AnimationMixer`，每帧 `mixer.update(dt)` → `vrm.update(dt)`，播放时暂停呼吸 / 视线 / 眨眼；复用 MMD 播放面板（`fillMmdPlayPanel` / `MmdPlayBridge`）渲染播放 / 暂停 / 选片，无 `.vrma` 时优雅降级（面板不显示）
- `wasm.ts` — `decodeYsmViaWasm`：前端 WASM 解码 .ysm（经 Go `ReadFileBytes` 取字节，走 `cache.ts` 缓存）；**加密模型详情增强**（P2 修复链：`decodeYsmViaWasm` 解码后把 `properties.extra_animation*` 经 `utils/format/ysm-anim-config.ts` 的 `extractAnimGroupsAndConfigs` 抽出「其他动画 / 模型配置 / 自定义表情」，与 Go `summary.go:appendAnimGroupsAndConfigs` 口径对齐，供详情卡渲染；`.zip`/裸 `ysm.json` 共用同一提取逻辑）；**ADR-100 L1：同目录 `.animation.json` 扫描 → `parseBedrockAnimationJSON` 解析 → `createYsmAnimPlayer` 驱动骨骼**
- `litematic-3d.ts` — `createLitematic3D` / `cleanupVoxel3D`：**ADR-066 P3 脚手架收缴**——原 627 行内联实现抽为 26 行薄包装：通用外壳（overlay/renderer/rAF 循环/相机控制/资源释放）归 `mount-preview-core.ts` 的 `mount3D(adapter, path)`（PreviewAdapter 契约），体素内容层归 `litematic-adapter.ts` 的 `buildLitematicScene`；`voxelFn` 经适配器工厂传入决定走哪条 Go RPC；vrm 预览同构迁移（`vrm-adapter.ts`）
- `litematic-meta.ts` — `showLitematic`（Go `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`）与 `cleanupLitematic3D`（转发 `cleanupVoxel3D`）
- `maid-3d.ts` — **车万女仆详情 + 3D 预览（Bedrock generic 模式）**：`showMaidPreview`（`PREVIEW_HANDLERS[MAID]` → `AnalyzeBedrockModel`）详情卡**复用 YSM `statsCardHTML` 彩色分区**（模型结构蓝卡 / 纹理尺寸绿卡 / 文件信息橙卡）——数据源与 YSM 同一 `types.BedrockModel`（Go `AnalyzeBedrockModel` 对 .ysm/.zip/.json 统一返回，字段含 `textureNames/textureCategories/textures`），前端 `toStatsCardModel` 映射喂 `statsCardHTML`（**subModels 不传**——maid 用交互式 `dpRenderSubList` 角色清单可点击切换，避免与 statsCardHTML 静态 subBlock 重复）；补充详情 `dpRenderDetail` 只留 format 版本 / 选中角色 / ysm.json metadata（name/license/tips/authors），骨骼立方体纹理行已由彩色分区承载；**封面缩略图（2026-09 补）**：`dpRenderPanel` 占位符有图时渲染 `<img>` 替换 🧸 大图标（96px 圆角边框 pixelated，样式对齐资源包详情 `detail.ts:171`），无图回退 🧸——`showMaidPreview` 先 `render()` 无图态（统计卡立即可见），异步 `loadPreviewImage`（缓存 → WASM → Go 兜底统一入口）命中后重绘替换，`detailGen.stale(gen)` 防切文件后旧封面画回；`createMaid3D` 复用 YSM 适配器 `mode:"generic"` 跳过 YSM 专属特性，`registerReRoute(RESOURCE_TYPES.MAID, openMaidFullscreen)` 注册 3D 跨类型路由
- `utils.ts` — 共享类型与工具：`PreviewCtx` 接口、`DecodedYsm`、`getPrefer3D` / `setPrefer3D`（跨模型保留 3D 偏好）、`stripYsgpTextHeader`（YSGP 文本变体转标准头，内部私有 `buildStdYsgpFromTextVariant`）、`devLog`
- `geometry.ts` — 纯函数层：`BedrockCube` / `BedrockBone` / `BedrockGeometry` 类型 + `parseBedrockGeometryFromJSON`
- `model3d-loader.ts` / `features/preview-3d/screenshot-render.ts` — 3D 规格加载（Go `GetModel3DSpec`）与多角度截图渲染（`renderMultiAngle`，ADR-136 归位 features），均静态依赖 three
- `cache.ts` — 模块级预览缓存：`cacheGet` / `cacheSet` / `cacheSetEvictHandler` + `CacheValue`
- `tpl.ts` — `modelDetailHTML`（详情面板）/ `statsCardHTML`（统计卡：彩色分区 + L0 清单角色 + 纹理分类；**顶部「📊 模型概览」标题已移除（2026-08-28，与 tab 层级去重），badge（Go 原生解析）保留**）
- `css.ts` — Shadow DOM 样式表 `previewCSS`（adoptedStyleSheets）；**h3 顶格约定（2026-08-28）**：`h3` 用 `margin: 0 0 8px`（上 0）——移除 `model-detail-title` 冗余标题后浏览器默认 `margin-top: 1em` 会让模型名顶格空一行，故显式清零
- `bone-names.ts` — `buildBoneNamesText(modelPath, boneCount, bones)`：构建「📋 导出骨骼名」文本行；`interface BoneEntry` 兼容 `DecodedYsm.bones` 元素（纯函数层，ADR-023 L3）
- `parse-ysm-json.ts` — `parseYsmJsonDirect(json)`：解压后 YSM 的 `ysm.json` 直接解析，不依赖 WASM/IO；双格式分支——YSM 专属格式（`spec`+`files`）提取模型/纹理清单并将 `default_texture` 置首（R1 契约），标准 Bedrock 格式映射 bones/cubes 字段；向量/数值守卫防畸形 JSON（ADR-044 ②）
- `texture-order.ts` — `buildOrderedTexKeys(input)`：纹理有序列表计算；有 `ysmTexOrder` 按声明序匹配 `matchTexKey`，`ysmDefaultTex` 置首；无声明序按 `areaOf` 降序；三处消费方（本文件、`wasm.ts orderedTexKeys`、Go `AnalyzeBedrockModel`），口径与 `internal/app/texture_order.go` 严格对称

## 对外 API / 入口

- 自定义元素：`<app-preview>`
- 监听 bus：`model:select`（`{ path, isDir }`；目录走整合包信息 `GetPackInfo`，文件走类型分流）
- 派发 bus：`toast:show`（仅子模块的加载失败路径：`litematic-3d.ts` 体素 3D 加载失败、`skeleton.ts` 3D 预览加载失败）；`index.ts` 本身不 emit
- Go 调用（经 `getApp()`）：`index.ts` 的 `DetectResourceType` / `FindPreviewImage` / `ExtractPreviewTexture` / `LoadResourceTypes` / `GetPackInfo`；子模块的 `AnalyzeBedrockModel`（loader）、`ExtractYsmSummary` / `ExtractYSMHeader` / `ReadPackMeta` / `ReadShaderpackLang`（detail）、`ReadFileBytes`（wasm）、`ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic`（litematic-meta）、`GetLitematicVoxelData` 等体素函数（litematic-3d）、`GetModel3DSpec`（model3d-loader / features/preview-3d/screenshot-render）、`SaveScreenshotFile`（skeleton）；**网页版上述 fallback 型 binding 已由 `web-fs.ts` 实现**（`FindPreviewImage` / `ExtractPreviewTexture` / `GetPackInfo` / `AnalyzeBedrockModel` / `SaveScreenshotFile`）。**类型化直调约定（2026-09-02 起，`45393d06`）**：`getApp()` 返回类型化 `AppBindings`（`backend/types.ts`），Wails 绑定方法**必须直调** `App.ReadFileBytes(path)` / `await App.ListAllFilePaths(dir)` 等——**禁止** `(App as unknown as Record<string, ...>)["Xxx"]` 手写签名断言（Go 绑定签名变更时编译期不报错，运行时才炸）。browserAdapter 缺方法场景用 try/catch 或 `in` 存在性检查保留守卫语义（参考 `view-shell.ts` / `pack-3d.ts`）
- 子模块入口：`loadModelData` / `loadModel2D` / `openFullPreview` / `decodeYsmViaWasm` / `createLitematic3D` / `cleanupVoxel3D` / `showLitematic` / `cleanupLitematic3D` / `showModelDetail` / `showResourcePack` / `showShaderpack` / `showSimplePreview` / `preloadModel` / `renderMultiAngle`

## 与其他子系统关系

- 由 `app-content/index.ts` 顶部副作用静态导入完成注册，仓库页模板直接放置 `<app-preview>` 元素（见知识卡 `app_content`）
- `model:select` 派发方为 `app-tree` 节点点击与诊断页去重定位（见知识卡 `app_tree`）
- 2D/3D 骨骼计算委托 `frontend/src/features/preview-3d/model2d.ts` / `features/preview-3d/model3d.ts`，动画解析走 `utils/animation/animation.ts`
- Litematic/schematic 解析对应 Go 端 `go/litematic`；该包的 `extractBits` 对损坏或截断文件已加 `longIdx` 越界守卫（`go/litematic/nbt.go`，42d1839），前端 `litematic-3d.ts` 只做「体素数据为空」的空态兜底，不重复校验位宽（见知识卡 `go_litematic`）
- WASM 解析口径与 Go 端 `go/ysm` 一致（YSMViewer 算法口径）；缓存层为 `frontend/src/features/preview-3d/decoder/cache.ts`（ADR-137 归位）
- 组件实例实现 `PreviewCtx` 最小接口，子模块只依赖该接口，不反向引用组件全貌

## 不变量

- `model:select` 回调进入即 `_previewGuard.invalidate()`；`_showModelDetail` / `_showPackInfo` 在每个 `await` 之后必须 `if (this._previewGuard.stale(gen)) return`（`index.ts` 两处守卫），**catch 分支同样必须比对**——P2 修复：`_showPackInfo` 的 catch 原无守卫，A 目录失败迟到会覆盖已切换的 B 预览），否则慢条目 A 的迟到结果会覆盖已切换的 B 的预览（与 `app-sidebar._reloadGen`、`app-sync-manager._gen` 同模式）。**代际守卫统一为 `gen-guard.ts` 的 `GenGuard` 类**（bug-chronicle #18 治理）：`next()` 捕获 / `stale(gen)` 检查点 / `invalidate()` 跨域作废；detail.ts 导出共享单例 `detailGen`（detail-3d 复用，**maid-3d 2026-09 起也复用**——`showMaidPreview` 的异步封面续体靠它防切文件后旧面板画回），litematic/skeleton 各持独立实例
- **`showLitematic` 有独立模块级代际 `litematicGen`**（P2 修复：原无任何守卫，await Go 解析期间切模型时慢结果写进新模型的 `#preview-detail` 跨污染；现 await 后与 catch 分支均比对）
- `_unsubs` 中的 `bus.on` 订阅必须在 `disconnectedCallback` 清理；拖拽 window 监听经 `PreviewCtx._unsubs` 挂销毁清理；Litematic 3D 经 `cleanupLitematic3D`（转发 `cleanupVoxel3D`）终止 WebGL renderer + rAF 循环（防切页 GPU 残留）
- 2D 拖拽的 window 监听先移除上一轮再绑定（模块级槽位 `_prevWindowMove` / `_prevWindowUp`），禁止累积
- 预览缓存淘汰时必须 `URL.revokeObjectURL` 释放 blob URL（`cacheSetEvictHandler`）
- **mount-preview-core 拆分（ADR-091 D5，2026-08-17）**：原 707 行拆为 537 行主文件 + `cleanup-3d.ts`（118 行，fullCleanup + safeDisposeMat）/ `switch-preview.ts`（178 行，switchToSession + syncLightTarget）/ `input-and-animation.ts`（120 行，bindInputHandlers）/ `postprocessing.ts`（67 行，PostprocessingManager）；animate 循环因状态耦合深暂留主函数
- Three.js 现为静态依赖（`litematic-3d.ts` / `model3d-loader.ts` / `features/preview-3d/screenshot-render.ts` / `features/preview-3d/model3d.ts` 均 `import * as THREE from "three"`），且 `app-preview` 已被 `app-content` 静态导入，因此 three 进入主 chunk；vite 未配 `manualChunks`，若要恢复懒加载需同时改回动态 import 与分包配置
- 坐标变换遵循 ysmview 口径（陷阱 #11：改 model2d/model3d 前先 grep bug-chronicle）
- **纹理口径对称**：`texture-order.ts` 与 Go `internal/app/texture_order.go` 口径严格对称，改一侧须同步另一侧；`default_texture` 置首逻辑在 `parse-ysm-json.ts`（返回 `_ysmMeta.defaultTexture`）与 `texture-order.ts`（实际排序）两处协同处理
- **3D 预览布局**：渲染器全屏（`viewContainer` `position:absolute;inset:0`），信息面板为右侧浮层（`panel` `absolute;right:0;top:0;bottom:0`，`z-index:5`），顶部栏「◀ 隐藏 / ▶ 显示」切换显隐、左缘拖拽柄（`resizeHandle` 挂 body，`z-index:6`，`right` 随宽同步）调宽——浮层不占 flex 位，隐藏时渲染器天然填满，竖屏/窄窗口友好
- **3D overlay 单例钩子**（skeleton.ts 模块级 `_active3DClose`）：全局同时只允许一个活跃 3D overlay——新开 3D 前先调上一份的 `_active3DClose`（`keepPrefer=true` 保留 `_prefer3D`，仅切换模型路径）；用户主动关闭/ESC/组件销毁（走 `close3D` 默认 `keepPrefer=false`）才清 `_prefer3D` 并置空引用，防残留。**`model:select` 切换前同样先关闭活跃 3D overlay**（2026-08-12 修复：切模型时旧 3D 不关闭会与新渲染叠加冲突）。**onClose 区分主动关闭与切模型**（2026-08-16 回归 `b2fafea6`）：切模型路径先置 `_active3DClose=null`，onClose 据此判断——用户主动关闭（ESC/✕/返回键）清 `_prefer3D`，切模型保留（P3 曾误改统一保留导致退出 3D 后点资源仍自动弹全屏）
- **3D 控件文件层级（ADR-066 §5.6 方案 A + §5.7 查看器范式 + shared 化）**：相机控件（旋转/速度/重置）统一下沉 `mount-preview-core.ts` 的 `buildCameraControls`（shared/self 双模式复用，`camBridge` 单点构造：core topBar 控件与适配器共用同一相机状态）；YSM 专属控件集中于 `ysm-controls.ts`，**§5.7 起为「底部悬浮导航 + 分类弹窗」**（`buildYsmBottomNav`，对齐 MikuMikuAR 玻璃 HUD）：3D 全屏沉浸、无常驻侧栏——底部毛玻璃导航「🧍 模型 / 🎥 视图」按域分组，点击弹出 280px 毛玻璃弹窗（模型菜单 = 统计/纹理/骨骼列表/骨骼详情/多组件切换，复用 `fill3DPanel`；视图菜单 = `buildCameraControls` + 截图），用完即关；截图属视图域子项不当根菜单。**shared 化（§5.7 第 2 步 `4f712a89`）**：`features/preview-3d/ysm-object.ts` 的 `buildYsmObject(spec, texArr, texIdx)` 为内容层（场景图 + 显隐/切换/dispose，renderModel3D 与 ysm-adapter 共用），`ysm-adapter` 改 shared 模式（内容挂 `ctx.scene`，renderer/controls/rAF 归 core），**path 驱动**（`loader(path)` 注入，`switchTo(path)` 对 YSM 生效）。旧 `skeleton-render.ts` 的 `build3DOverlay` 死代码已删（YSM 3D 走 `createYsm3D(path)` → `mount3D`）。**overlay ✕ 关闭按钮绑定 `close3D`** 的历史修复（2026-08-16 `af260361`）仍有效——该绑定在 skeleton.ts `_toggle3D` 内，与 build3DOverlay 删除无关
- **3D 内模型切换（ADR-066 §5.6，2026-08-16 `cb23c330`）**：`PreviewHandle.switchTo(path)`（core 内复用 renderer/rAF/controls/灯光重建内容层——移除旧适配器控件 → scene 快照清残留 → dispose 旧内容 → 重新 `adapter.build` → 重挂控件/侧栏）+ 模块级 `switchPreview(path)`；`mount3D` 增可选 `Mount3DOptions.siblings`（同类型候选 ≥2 时 topBar 渲染切换下拉）；薄包装 `createVrm3D(path, opts)` / `createLitematic3D(path, voxelFn, opts)` / `createYsm3D(path, { loader, siblings })` 透传 siblings。**ysm 原为例外**（model 闭包 build 忽略 path），§5.7 第 2 步改 path 驱动后 `switchTo` 对 ysm 生效；**FBX 经 P0-1（`a0b4e9eb`，ADR-112）接入 `createFbx3D(path, { siblings })`，同类型切换对齐 MMD/VRM/Litematic**
- **跨类型浏览歧义扩展名走 ext 兜底路由（2026-08-28 `0d496a84` + `a2e...` 根治）**：`switchPreview`/`switchToSession` 复用**当前会话 adapter** 的 build、不做类型探测——因此 PMX 必须先作为首个加载资源（会话为 mmd）才能组内切换；从 YSM/蓝图/投影/车万女仆会话跨类型浏览 `.pmx` 走 `openModel3DFullscreen` → `DetectResourceType`，而 `.pmx/.pmd` 同时声明于 EntityPlayer 与 SceneModel（`resource_types.json`），Go `ClassifyExt` 对多归属扩展名保守返回 `"other"` → `resolvePreviewKey` 查表失败误报「3D 预览暂不支持该类型」。
  - **第一层（ext 兜底，`0d496a84`）**：`types.ts` 新增 `resolvePreviewKeyByExt(path)`（从 variants 派生、取首个声明者的 preview key，如 `.pmx→mmd`，只做预览适配器路由派生、不参与类型判定），`openModel3DFullscreen` 仅当 routeKey 为 `""`/`"other"` 时兜底再查 `_openers`
  - **第二层（事件传导 rtype，根治）**：根因是扫描分类在事件边界丢失——`model:select` 原只传 `{ path, isDir }`，消费端被迫重新 `DetectResourceType`（歧义扩展名撞 `"other"`）。`bus.ts` `ModelSelectPayload` 增可选 `rtype?: string`，发射点已知时带上（app-tree 行点击/键盘导航带 `atTeGetRtype(vm)`、detail-3d morph/stage 兄弟切换带 `CUSTOM_MORPH`/`STAGE`）；消费端 `_showModelDetail(path, rtypeHint?)` 与 `openModel3DFullscreen({ rtype })` 优先用传入值、缺失才探测（兼容旧发射点，行为不变）。原则：**扫描/浏览上下文已知的分类应随事件传导，消费端不做重复探测**
  - **第三层（`_lastModelPath` 统一同步，2026-08-28）**：左下角 3D 预览按钮（`app-nav` `_viewerFabClick`）的 path 来自 `getLastModelPath()`，但 `rememberModelPath` 原只在 app-tree 行点击/键盘导航更新——从仓库元老/回收站/去重/morph·stage 切换等发射点点模型后，3D 按钮仍拿**旧模型路径** → 旧类型无 opener 误报「3D 预览暂不支持该类型」。修复：`app-preview/index.ts` 的 `model:select` handler 统一 `rememberModelPath(path)`（**fire-and-forget 动态 import** `init-pages.ts` 防循环 + 防 await 阻塞预览主流程——测试实证：动态 import 挂起会吞掉后续 `_showModelDetail`），所有发射点同步，杜绝路径残留
  - **第四层（容器扩展名兜底，2026-08-28）**：`.zip` 打包的 PMX 被 Go 路径消歧归为 EntityPlayer，但 `resolvePreviewKey` 对 `.zip` 无 variants 命中 → routeKey 回退 `"EntityPlayer"` → `_openers` 无此 key 误报。修复：`types.ts` 新增 `resolveDefaultPreviewKey(rtype)`（首个 variants 的 preview，EntityPlayer→mmd）+ `isContainerExt`；`openModel3DFullscreen` 兜底链补第三级——`isContainerExt` 时按 rtype 默认预览适配器查表，与快捷 FAB 硬编码 `createMmd3D` 行为对齐。**两个 3D 预览入口的分工**：详情卡 FAB = 硬编码适配器（当前模型直接进）；左下角 nav 按钮 = 通用路由（`DetectResourceType`→`resolvePreviewKey`→`_openers` 查表，最近选中模型）——通用路由必须靠兜底链覆盖歧义/容器，否则与 FAB 行为不一致。**失败诊断**：`openModel3DFullscreen` 失败 toast 带探测现场（`探测类型/路由key/扩展名`）+ `AddOpLog("preview-3d-route", ..., "fail", reason)` 环形日志留痕，不再是无因「暂不支持」
- **YSM 骨骼动画（ADR-100 L1-L3）**：动画数据优先取 `model._animClips`（loader 统一挂载：WASM 内嵌解码 / Go 透传解析 / 缓存回填三路，单文件 .ysm 的主来源），无内嵌时兜底扫同目录 `*.animation.json`（经共享 `base64.ts` UTF-8 解码）→ `createYsmAnimPlayer` 驱动骨骼（rotation/position/scale，loop 取模；L3 三通道平滑淡入 + 未触及骨骼渐回 base + 全 clip 列表）；播放面板复用 `fillMmdPlayPanel`，菜单新增 `play` 项（dockGroup: "motion"，legacyTestId: "ysm-play-entry"）；动画播放期间暂停感知层（与 VRM VRMA 口径一致）
- **DOM 注入转义约定（XSS 防御，2026-08-26 `2fbfe5ce` + `da664cf2`）**：详情/骨骼/骨架面板凡向 DOM 注入**外部或模型派生数据**（骨骼名、模型名、文件路径、`basename`、统计值、缩略图/头像 URL 等），**禁止 `innerHTML` 裸拼 `${var}`**；一律走 `utils/dom/html.ts` 的 `esc()`（属性/URL 用 `src="${esc(url)}"`、文本用 `esc(text)`）或 `createElement` + `textContent` / `createTextNode`（范式见 `vrm-bone-ui.ts` 的 `field()`、`skeleton-fill-panel.ts` / `skeleton-utils.ts` 的 `iRow`）。**固定 i18n key（`t(...)`）与纯数字（`.length` / 计数）可直插 `innerHTML`**。`renderFormattedText()`（mc-format.ts）内部已对每段 `esc`，可安全用于含 `§` 格式码的文本。扫描基线：app-preview 域内 `innerHTML` + 变量拼接暴露面已清零（其余点均经 `esc` / `renderFormattedText` / 固定数据），后续新增面板渲染沿用同约

## 相关

- `frontend/src/features/preview-3d/model2d.ts` / `features/preview-3d/model3d.ts` — 2D/3D 骨骼渲染与计算
- `frontend/src/features/preview-3d/decoder/cache.ts` — 模块级预览缓存（跨组件生命周期持久，ADR-137 归位）
- `frontend/src/wasm/` — WASM 生成数据（base64 豁免文件）
- 知识卡：`app_content`、`app_tree`、`go_ysm_parser`、`go_litematic`、`event_bus`、`pointer-events`（双端响应式触控热区）
- ADR-057（3D 预览悬浮触发按钮与双端响应式控制层）；`frontend/src/utils/dom/fab.ts` — FloatingActionButton 组件与全局样式注入
- ADR-072（**3D 归置已落地**）：3D 适配器层（`*-adapter.ts` / `*-3d.ts` / `mount-preview-core.ts` / `preview-menu*.ts`）已下沉 `features/preview-3d/adapters/` 与 `features/preview-3d/`（保持 0 backend import 纯渲染边界），`app-preview` 只留 UI 壳 + WASM 胶水；`index.ts` 的 `_showModelDetail` if 链已改 `PREVIEW_HANDLERS` 映射表；`detail.ts` 6 个 show 函数已按资源域拆分为 `detail.ts`（4 个）+ `detail-3d.ts`（`showVrmMeta` / `showMmdPreview`）；MMD 根菜单两级层级导航（模型/材质/播放/骨骼）经 `setAdapterItems` 收编
