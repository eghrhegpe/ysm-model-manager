---
title: 架构
description: YSM 模型管理器系统架构说明 — Wails v3 桌面壳 + Go 后端 + Three.js/YSMParser WASM 前端，附渲染管线标准、资源类型系统与关键数据流
---

# 架构

> 本文是 **ysm-model-manager** 的**系统架构说明（单一权威视图 / 基石文档）**。历史架构（组件级拆分快照）已冻结于 `docs/archive/architecture.md`。本文自洽承载全部架构事实，**不依赖外部决策文档**：3D 渲染坐标系/旋转/UV/顶点公式内联于 §4，资源类型系统内联于 §5。本文件由早期 `.github/copilot-instructions.md` 的渲染片段迁移归位并扩充为全系统视图。
>
> 样式参考：`MikuMikuAR/docs/architecture.md`（同属 Wails + 前端 3D 渲染类项目，仅作结构借鉴；两项目技术栈不同，本文以本仓库源码为准）。

## 1. 总览

YSM 模型管理器是一个桌面端工具，用于管理 Minecraft **YSM（Yet Another Skin Model）自定义玩家模型**及其周边资源（资源包、光影包、litematic  schematic、MMD 皮肤、VRChat avatar 等）。核心能力：拖拽导入/安装、3D 实时预览、仓库树浏览、创作者/工坊生态聚合、版本同步。

### 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 桌面壳 | **Wails v3**（Go + WebView2） | `main.go` 注册单一 Service，WebView2 承载前端 |
| 后端语言 | **Go 1.25** | 模块名 `ysm-model-manager`（`go.mod:1`） |
| 前端 | **Vite + TypeScript**（Web Components + Shadow DOM） | `frontend/index.html` → `js/app-modules.ts`；源码全 `.ts`，仅 `*.test.js` 与生成态 `wasm/*-data.js` 为 `.js` |
| 3D 渲染 | **Three.js** + 内嵌 **YSMParser WASM** | 前端 WebView2 直接解码 `.ysm`，无 exe sidecar |
| 数据 | `resource_types.json` 单一事实来源 + `creators.json` / `workshop_sites.json` / `workshop-github.json` | 资源类型/创作者/工坊站点/镜像仓库 |
| 脚本 | Node（`.mjs` 零依赖治理工具链） | `scripts/` 下 40+ 个校验/生成脚本 |
| 测试 | Go 单测 + Node 契约测试（`tests/*.mjs`）+ Vitest | 三层防护 |

### 分层职责

```
┌─────────────────────────────────────────────┐
│  WebView2 (前端: Vite/TS Web Components)      │
│   components/ · core/ · features/ · utils/    │
└───────────────┬─────────────────────────────┘
                │  Wails Service 反射绑定 (调用 *app.App 导出方法)
                │  EventsOn / Event.Emit (反向通道)
┌───────────────▼─────────────────────────────┐
│  internal/app/  (绑定门面层, 17 文件)          │
│   编排 Wails 生命周期 + 参数校验 + 调用业务包   │
├─────────────────────────────────────────────┤
│  go/  (业务逻辑包, 22 个)                      │
│    ysm · threejs · types · sync · installer · │
│    importer · recycle · litematic · geometry… │
└─────────────────────────────────────────────┘
                │
        ┌───────┴────────┐
   文件系统/外部下载   嵌入式资源 (embed.go)
```

---

## 2. Wails 应用骨架

- **技术**：Wails v3（Go + WebView2），模块 `ysm-model-manager`（`go.mod:1`），Go 1.25，Wails v3 alpha2.105。
- **入口** `main.go`（`//go:build !cli`）：
  - `//go:embed all:frontend/dist` 嵌入前端产物（:13）。
  - `app.NewApp()` 注册为单一 `application.Service`（:20-22）。
  - `SetApp(app)` / `SetMainWindow(wnd)` 注入运行时引用，避免启动期 `Window.Current()` 返回 nil（:28, :37）。
  - 窗口 **1280×800**，URL `/`（:30-35）。
- **CLI 入口** `cli_export.go`（`//go:build cli`）：薄壳，仅调 `app.CLIMain()`（供 `go build -tags cli` 产出 `ysm-cli.exe`）。
- **资源注入** `embed.go`（`//go:build` 无限制，双构建均编译）：`//go:embed creators.json resource_types.json workshop-github.json workshop_sites.json` + `frontend/dist/wasm/YSMParser.wasm` + `frontend/public/wasm/YSMParser.js`，经 `init()` → `app.SetEmbedded(...)`（:21-23）。

### 绑定模式

Wails v3 **Service 反射绑定**：`*app.App` 的所有导出方法自动暴露给前端，**无 `//export` 注解**。`wails3 generate bindings` 产出 `frontend/bindings/ysm-model-manager/internal/app/app.ts`（`cmd/build-release.ps1:37-46`），前端以 `.js` 后缀 import，由 `vite.config.js` 的 `wailsBindingsResolve` 插件重定向到 `.ts`。

> **🔒 硬性契约（2026-08-05 回归后固化）**：bindings **必须**以 TypeScript 生成（`-ts`，产出 `.ts`）；**禁止**无 `-ts` 调用——会生成 `.js` 并 `-clean` 清掉跟踪的 `.ts`，破坏上方 import 重定向契约。**统一入口**：`npm run generate:bindings`（`frontend/package.json`，内部 `cd .. && wails3 generate bindings -clean=true -ts -i`，在仓库根执行）；`cmd/build-release.ps1` / `cmd/build-release.sh` 均调该脚本；`build/Taskfile.yml:160` 的 `generate:bindings` 任务保留 `-f`/`-obfuscated` 透传且带 `-ts`（默认 flags 下与 npm 脚本等效）。若误跑无 `-ts` 生成导致 `.ts` 被删，立即 `npm run generate:bindings` 恢复。

反向通道（Go → 前端事件）：`a.app.Event.Emit(...)`，例如 `app.go:101` 的 `config-loaded`、`app_download.go:62` 的 `queue:status`。

---

## 3. Go 后端架构

后端分两层：**`internal/app/` 绑定门面层**（编排 Wails 生命周期、参数校验、调用业务包）+ **`go/` 业务逻辑包**（纯逻辑，可单测、可 CLI 复用）。

### 3.1 `internal/app/`（17 文件，~5419 行）— 绑定门面

| 文件 | 行数 | 职责 / 代表绑定 |
|------|------|----------------|
| `app.go` | 135 | `App` 结构体、`ServiceStartup`/`ServiceShutdown` 生命周期、`OpenInBrowser`、`GetAppVersion` |
| `app_install.go` | 1255 | 最大文件。导入/安装/同步：`ImportModelFile*`、`SyncResources`、`Push/PullResourceFromInstance`、`RelinkCustomDir`、回收站 `MoveToRecycle*`/`RestoreFromRecycle` |
| `cli.go` | 728 | `CLIMain`、`runExport`/`runDoctor`/`runStats`、HTML/文本报告 |
| `app_scan.go` | 578 | `ScanModelEntries`、`SearchModels`、`GenerateRepoIndex`、`ListVersionInstances`、`ScanLocalAuthors` |
| `app_config.go` | 462 | `LoadAppConfig`/`SaveAppConfig`、窗口位置、`CheckUpdate`/`DoUpdate`、`SelectDirectory` |
| `resource_bindings.go` | 405 | `LoadResourceTypes`（读 `resource_types.json`，:21）、`GetRepoRoot`、`DetectResourceType`、`ImportByType`、litematic/nbt voxel 读取 |
| `app_files.go` | 337 | 文件 CRUD、`ToggleModelEnable`（`.ban` 后缀）、`ExtractPreviewTexture` |
| `app_workshop.go` | 318 | 工坊站点/创作者 CRUD、CSV/JSON 导入导出、`atomicWrite`（:19 临时文件 + rename） |
| `app_download.go` | 317 | `DownloadQueue` 串行队列、`EnqueueDownloads`、`DownloadFromGitHub`（镜像回退） |
| `app_model.go` | 253 | `AnalyzeYSMModel`、`ExtractYSMHeader`、`GetModel3DSpec`、`ReadFileBytes`（base64） |
| `proxy.go` | 204 | `StartProxy`/`StopProxy`/`IsProxyRunning` |
| `wasm_decoder.go` | 191 | Node.js 兜底解码 `decodeYSMViaNodeJS`（:48） |
| `app_avatar.go` | 126 | 创作者头像提取缓存 |
| `app_tags.go` | 46 | `GetModelTags`/`SetModelTags`/`AllTags` |
| `bundled_data.go` | 27 | **三级解析**：exe 同级 → exe 上级 → 嵌入基线（:13-27） |
| `assets.go` / `wasm_embed.go` | 20/17 | `SetEmbedded` 注入点；`GetWasmBinary` |

约 **150 个导出方法**构成绑定面。

### 3.2 `go/`（22 包，56 文件）— 业务逻辑

| 包 | 职责 |
|----|------|
| `ysm` | YSM 解析：`header.go`（文本头扫描）、`summary.go`、`extracted.go`、`texsize.go` |
| `threejs` | `spec.go`，移植自 YSMViewer `ThreeJsPayloadBuilder.cs`（坐标/旋转/UV/顶点公式） |
| `geometry` | Bedrock geometry，zip/7z |
| `litematic` | NBT/voxel 解析，`block_ids_data.go`（~140KB，`gen/` 代码生成） |
| `types` | **注册表核心**：`resource.go`（`LoadRegistry()`）、`resource_types_embed.go`（生成的兜底基线，DO NOT EDIT）、`extensions.go`（`AllExts()`/`IsSupportedExt()`/`StorageSubDir()`） |
| `sync` | 硬链接/软链接同步（~19KB） |
| `installer` / `importer` | 安装编排 / 策略接口（按资源类型分派） |
| `recycle` / `dedup` | 回收站 / 去重 |
| `packs` | mcmeta 解析 |
| `avatar` / `download` / `updater` | 头像提取 / 下载 / 自更新 |
| `watcher` | fsnotify 监听目录变更 |
| `tags` / `logs` / `paths` / `fsutil` / `errors` / `version` | 标签 / 日志 / 路径 / 文件工具 / 错误 / 版本号 |

### 3.3 命令行

`cmd/`：`build-release.ps1`（发布脚本）、`updater/`（编译为 `go/updater/ysm-updater-helper.exe` 被 embed）、`genindex/`、`modelscope/`、`diag/`。

---

## 4. YSM 模型解析与渲染（Three.js + YSMParser WASM）

### 4.1 YSMParser WASM 内嵌

- YSMParser 已内嵌 WASM：`frontend/src/wasm/ysm-wasm-data.js`（base64 编码，约 1.52MB），前端 WebView2 直接解码 `.ysm`，**无需 exe sidecar**。
- exe sidecar 仅作为开发调试的 Go CLI fallback；**发版时不打包 YSMParser.exe**。
- 调试 CLI fallback 可从 `build/ysmparser-cache/` 恢复（`wails3 build -clean` 会清空 `build/bin/`，但 WASM 已内嵌，无需强制恢复 exe）。

### 4.2 WASM 加载路径

`frontend/src/wasm/ysm-parser.ts`（~8KB）加载链：

1. 动态 `import()` 两个 data 文件 → 补丁胶水代码追加 `Module["HEAPU8"]=HEAPU8`（:75-78）；
2. 设 `window.Module = { wasmBinary, noInitialRun: true }`（:81-86）；
3. **间接 `eval`** `(0,eval)(patchedGlue)`（:89，注释称比 `<script>` 注入快 5x）→ 调用 `YSMParserModule` 工厂；绕开 WebView2 的 `fetch()` 限制；
4. 双解码路径：`decodeYsmFileFromMemory`（`ccall("ysm_decode_from_memory")` + `_malloc`，:135-168）优先；`decodeYsmFile`（`callMain` + MEMFS，:174-213）回退。

> ⚠️ 已知 bug（`ysm-parser.ts:63-65`）：`_getGlueCode` 引用未声明的 `_cachedWasm` 且返回 `ArrayBuffer` 而非 string → WASM 路径实际静默失败并回退 Go 解析。属待修项，非设计意图。

消费方 `preview-wasm.ts:25-160` 完整链：
```
ReadFileBytes(Go, base64) → atob → Uint8Array
  → (.json 走 parseYsmJsonDirect 直解)
  → initYSMParser → 内存解码 → MEMFS
  → stripYsgpTextHeader 剥文本头重试 (V2/V3)
  → 全失败回退 Go CLI (wasm_decoder.go)
```

`utils/model3d-loader.ts` — `fetchSpec` 优先调 Go `GetModel3DSpec`，失败回退 `buildSpecFromModel`（JS 几何），LRU 20 条 spec 缓存。

### 4.3 3D 渲染标准

- **只用 YSMViewer / BlockBench 的 `expandBoxUV` + 自定义 `BufferGeometry`**，禁止使用旧版 `applyBoxUV`/`applyFaceUV` + `BoxGeometry`。
- UV 坐标**不翻转 V**（`tex.flipY = false` 时，`v0 = fv / texH` 直接使用，不加 `1 -`）。
- Origin X **不取反**（匹配 YSMViewer `ThreeJsPayloadBuilder.cs` 的 `cube.Origin.X - cube.Size.X`）。
- vertex 顺序：YSMViewer 的 East/West/Up/Down/South/North。
- Mesh 位置 = `cube.pivot`（顶点已相对 pivot 偏移，Group 在原点）。

### 4.4 材质

- `transparent: true`（纹理带透明通道时），不用 `alphaTest`。
- `DoubleSide`。
- `NearestFilter` 纹理过滤。

### 4.5 骨骼层级

- 遵循 YSMViewer 的完整骨骼父子层级（`bone.parent`），不得扁平化。
- 骨骼 Group 位于骨骼的 pivot 点，子骨骼 Group 位于相对父骨骼的本地偏移。
- Cube Mesh 位置 = `cube.pivot - bone.pivot`（相对骨骼 Group 的本地坐标）。
- 不显示骨骼名标签（用户不需要）。
- 不支持动画播放（用户不需要，纯静态渲染）。

### 4.6 存档

- 当前稳定版为 `frontend/src/utils/model3d.ts`（旧 `docs/model3d.js` / `docs/model3d-ysm-attempt.js` 备份已随文档治理删除）。
- 旧版 `applyBoxUV`/`applyFaceUV` + `BoxGeometry` 方案永久废弃，不允许再提及或恢复。

---

## 5. 资源类型系统（`resource_types.json` 单一事实来源）

位于**仓库根**（约 3.4KB），顶层唯一键 `resourceTypes`（数组，7 项）：`resourcepack / shaderpack / ysm / create-blueprint / litematic / mmd-skin / vrchat-avatar`。

每项字段：`id, name, icon, extensions[], storageSubDir, configField, configFallback?, installDir, scanDir, instanceLevel, preview(3d|thumbnail|none), detector(mcmeta|shader|ysm|extension), isDir?, actions[]`。

### 三处消费链（由测试守护一致性）

1. **Go 运行时** — `go/types/resource.go` `LoadRegistry()`，`registryPath` 可测试替换；`go/types/resource_types_embed.go`（generated, DO NOT EDIT）为兜底基线。
2. **Go 派生** — `go/types/extensions.go` `AllExts()`/`IsSupportedExt()`/`StorageSubDir()` 全部注册表驱动。
3. **绑定** — `internal/app/resource_bindings.go:21` `LoadResourceTypes()` 返回原始 JSON 串。
4. **前端静态镜像** — `js/utils/extensions.ts` `RESOURCE_EXTS`（:8-16，头部注释显式声明同步流程）；`js/utils/resource-types.ts` `RESOURCE_TYPES`/`RESOURCE_TYPE_LABELS`；`js/utils/resource-registry.ts`。

> 一致性由 `tests/test_resource_schema.mjs` + `go/types/registry_test.go`（TestAllExts/IsSupportedExt/ExtBelongsTo/StorageSubDir/SubDirMap）双向守护；新增资源类型必须同步上述四处。

### 配套数据 JSON

| 文件 | 大小 | 角色 |
|------|------|------|
| `creators.json` | 29.5KB | 创作者/仓库索引（name/desc/type/role），可从 GitHub jsDelivr 拉取合并（`community/core.ts:107-166,281`） |
| `workshop_sites.json` | 8.9KB | 工坊站点 + `searchUrl` 模板（`{{q}}`）+ `presetSearches` |
| `workshop-github.json` | 666B | 5 个 GitHub 模型仓库，供 `LoadGitHubRepos` |

---

## 6. 前端架构（Web Components + 三层解耦）

### 6.1 入口与组件注册

`frontend/index.html:15` → `js/app-modules.ts`（~6.4KB）：
- 静态 `import` `app-nav` / `context-menu` / `app-toast`（:16-18）；
- 动态 `import()` 字面量加载 `app-tree`/`app-sidebar`/`app-content`/`app-resource-manager`/`app-sync-manager`（:20-34，分包按需）；
- `register("loadInstances"|"loadEntries")` 注入服务（:11-12）；
- 主题 + UI 偏好初始化（:46-132）。

### 6.2 组件清单（`js/components/`）

| 组件 | 规模 | 关键文件 |
|------|------|----------|
| `app-content/` | ~185KB，多文件 | 主页面路由 `index.ts:133-149` switch（repository/instances/workshop/github/diagnostics/oldest/settings）；`content-css.ts` 65KB；`community/` 子模块（`site-view.ts` 49KB、`settings.ts` 28KB、`diagnostics.ts` 17.5KB、`core.ts`、`workshop-data.ts`、`workshop-icons.ts`） |
| `app-preview/` | ~160KB，16 文件 | `preview-skeleton.ts` 36.8KB、`preview-wasm.ts` 22.9KB、`preview-litematic-3d.ts` 21.7KB、`preview-css.ts`、`preview-pack.ts`、`preview-detail.ts` |
| `app-tree/` | ~90KB，15 文件 | `toolbar-events.ts` 15.6KB、`bus-handlers.ts` 12.6KB、`render.ts`、`virtual-scroll.ts`、`loader.ts` |
| `app-sidebar/` | ~39KB，8 文件 | 侧栏导航 |
| `app-resource-manager/` | 21.6KB | 资源管理器 |
| `app-sync-manager/` | 18.9KB | 同步管理器 |
| 单文件 | — | `app-nav.ts` 5.4KB、`app-toast.ts` 4.4KB、`context-menu.ts` 4.7KB、`app-tree-styles.ts` 11.9KB |

### 6.3 三层解耦（每个组件目录 = 1 标签 + 1 目录 + 若干文件，每文件 ≤ 80 行理想）

```
index.ts（编排：constructor → shadow → connected→disconnected）
  ├── data.ts（纯数据，无 DOM）
  ├── render.ts（HTML 生成，无事件）
  └── events.ts（事件绑定，无模板）
       ↑ 引用
  tpl.ts / row-tpl.ts（纯 HTML 模板）
```

层间契约：`index` 不写业务逻辑；`data` 不碰 DOM；`render` 不写 `addEventListener`；`events` 不拼 HTML；`tpl` 不做事件绑定。

### 6.4 事件总线与状态

- **`js/bus.ts`**（~5.9KB）：类型化 bus，`BusEvents` 接口枚举约 **50 个事件名 → payload 类型**（:53-112）；`createBus()` 简单 listener map（:128-159）；`setBus()` 可替换；兼容挂载 `window.bus`（:178）；emit 内 `try/catch` 隔离异常（:145-148）。
- **`js/core/page-store.ts`**（759B）：页面状态唯一来源，`setCurrentPage` → emit `nav:changed` 并反向监听同步（:23-27）。
- **`js/services/registry.ts`**（1.6KB）：`Map<string, unknown>`，仅注册"有替换价值"的依赖（数据加载函数）；渲染/纯函数直接 import。

### 6.5 其他前端目录

`core/`（context-menus 13.7KB、handler-dnd 10.6KB、handler-sync 10.8KB、handler-upload、theme、page-store、menu-defs）、`features/`（import-queue 30.8KB、community/download-queue 21.4KB、oldest-models、recycle-bin、version-updater、dnd-state）、`utils/`（model3d 25.8KB、model2d 19.4KB、animation、summarize、display、extensions、resource-types 等 20+ 模块）、`dialogs/`（modal/rename/batch-rename/tag-editor/adv-filter）、`services/registry.ts`、`wails/app.ts`、`wasm/`、`css/`。

---

## 7. 预览系统（3D + 2D）

- **3D 预览**：`app-preview/preview-skeleton.ts` 调用 `utils/model3d-loader.ts` → `GetModel3DSpec`（Go）→ `model3d.ts` 构建 Three.js `BufferGeometry`（见 §4 标准）。`preview-litematic-3d.ts` 处理 voxel 预览。
- **2D 预览**：`utils/model2d.ts`（~19.4KB）处理平铺/网格 2D 缩略图。
- **缓存**：`utils/preview-cache.ts` 预览缓存 FIFO（75 行）；`model3d-loader.ts` LRU 20 条 spec 缓存。
- **截图**：`utils/screenshot-renderer.ts` 无头截图 + 批量截图（~100 行）；Go 端 `app_files.go:ExtractPreviewTexture` 提取预览纹理。

---

## 8. 导入 / 安装 / 同步 / 回收站

| 能力 | 前端 | Go 绑定 | 业务包 |
|------|------|---------|--------|
| 拖拽导入 | `core/handler-dnd.ts`、`features/import-queue.ts`（30.8KB） | `ImportModelFile*`（app_install.go） | `go/importer`（策略接口）、`go/installer` |
| 安装/同步 | `core/handler-sync.ts` | `SyncResources`、`Push/PullResourceFromInstance`（app_install.go） | `go/sync`（硬/软链接）、`go/installer` |
| 回收站 | `features/recycle-bin.ts` | `MoveToRecycle*`/`RestoreFromRecycle`（app_install.go） | `go/recycle` |
| 去重 | — | — | `go/dedup` |
| 启用开关 | — | `ToggleModelEnable`（app_files.go，`.ban` 后缀） | — |

导入流程（详见 §12 数据流 a）。

---

## 9. 社区 / 工坊（生态聚合）

- **数据加载**：`app-content/community/core.ts:35-36` 调 `LoadWorkshopSites()` + `LoadWorkshopCreators()`（Go `app_workshop.go:56,109` → `loadBundledJSON` → 三级路径解析）；`LoadGitHubRepos()` 读 `workshop-github.json`。
- **下载流**：用户选中 → `features/community/download-queue.ts:139-142` `EnqueueDownloads(tasks)` → Go `app_download.go:50-64` 入队并 `Event.Emit("queue:status")` → 串行 `process()` → `DownloadFromGitHub`（镜像回退）→ 前端 `Events.On("queue:status"/"queue:file-start"/"queue:file-done"/"download:progress")`（:167-234）更新 UI。
- **配置写回**：`atomicWrite`（tmp + rename，`app_workshop.go:19`）防中断损坏。
- 创作者头像增量刷新：`download-queue.ts` 解析 `queue:file-done` → `bus.emit("avatar:refresh")` → `app-content` 按 `dataset.name` 定点更新卡片（v1.7.7+）。

---

## 10. 构建 / 部署 / CI

### 10.1 配置

- `wails.json` — frontend dir `./frontend`，devServerUrl `:5173`。
- `frontend/vite.config.js` — `wailsBindingsResolve` 插件；Vitest（jsdom，`js/**/*.test.js`，覆盖率阈值 **statements 85 / branches 70 / functions 82 / lines 85**，排除 `js/wasm/**`）。
- `Taskfile.yml` — 委派 `build/Taskfile.yml` + `build/windows/Taskfile.yml`；`task dev` = `wails3 dev -port 9245`；版本经 `APP_VERSION` 变量注入。
- `reasonix.toml`（~7.9KB）— AI 助手工具链配置（模型/agent/tools/lsp），非应用构建产物。

### 10.2 发布流水线（`cmd/build-release.ps1`）

1. `wails3 generate bindings` → 2. `npm run build`（vite）→ 3. 构建 `ysm-updater-helper.exe`（embed 前置）→ 4. `go generate`（litematic block_ids）→ 5. `go build -ldflags "-X ysm-model-manager/go/version.Version=$VerTag"` → 6. `go build -tags cli -o ysm-cli.exe` → GitHub Release 上传。

### 10.3 CI（`.github/workflows/release.yml`，windows-latest）

`tests/*.mjs` → 构建 updater helper → `go vet ./go/...` → `go test ./go/...` → `npm ci` → `tsc --noEmit` → `vitest run` → `vite build` → `task` 安装。另有 `pages-deploy.yml`。

### 10.4 治理脚本（`scripts/`，40+ `.mjs`）

`binding-check` / `adr-check` / `event-audit` / `check-circular` / `check-doc-drift` / `check-knowledge-drift` / `doctor` / `link-checker` / `new-adr` 等。改完文档跑 `node scripts/doctor.mjs` 一键全量自检。

---

## 11. 目录结构

> 更新于 2026-08-04。*: 行数为约数（来自 `wc -l` 抽样）。

```
ysm-model-manager/
├── main.go                      # ★ Wails 入口 (!cli)
├── cli_export.go                # CLI 入口 (//go:build cli)
├── embed.go                     # 嵌入前端 + 数据 JSON + WASM (双构建)
├── go.mod / go.sum              # Go 依赖 (模块 ysm-model-manager, Go 1.25)
├── wails.json                   # Wails v3 配置
├── Taskfile.yml / reasonix.toml
├── resource_types.json          # ★ 资源类型单一事实来源 (根目录)
├── creators.json / workshop_sites.json / workshop-github.json
├── cmd/
│   ├── build-release.ps1        # 发布流水线
│   ├── updater/                 # 编译为 ysm-updater-helper.exe (embed)
│   ├── genindex/ modelscope/ diag/
├── internal/
│   └── app/                    # ★ 绑定门面层 (17 文件, ~5419 行)
│       ├── app.go               # App 结构体 + 生命周期
│       ├── app_install.go       # 导入/安装/同步/回收站 (最大)
│       ├── app_scan.go          # 扫描/搜索/索引
│       ├── app_config.go        # 配置持久化 + 更新
│       ├── resource_bindings.go # LoadResourceTypes + DetectResourceType
│       ├── app_model.go         # AnalyzeYSMModel / GetModel3DSpec
│       ├── app_download.go      # 下载队列
│       ├── app_workshop.go      # 工坊/创作者 CRUD + atomicWrite
│       ├── app_files.go app_tags.go app_avatar.go app_config.go
│       ├── proxy.go wasm_decoder.go wasm_embed.go assets.go
│       ├── bundled_data.go cli.go
├── go/                         # ★ 业务逻辑包 (22 包)
│   ├── ysm/ threejs/ geometry/ litematic/ types/ sync/ installer/
│   ├── importer/ recycle/ dedup/ packs/ avatar/ download/ updater/
│   ├── watcher/ tags/ logs/ paths/ fsutil/ errors/ version/
├── frontend/
│   ├── index.html               # 入口 → js/app-modules.ts
│   ├── vite.config.js           # wailsBindingsResolve + vitest
│   ├── bindings/                # wails3 generate bindings 产物
│   ├── dist/                    # 构建产物 (embed 源)
│   └── js/
│       ├── app-modules.ts       # 组件注册 + 初始化
│       ├── bus.ts               # 事件总线 (~50 事件)
│       ├── components/          # app-content / app-preview / app-tree /
│       │                        #   app-sidebar / app-resource-manager /
│       │                        #   app-sync-manager / app-nav / app-toast /
│       │                        #   context-menu
│       ├── core/ features/ utils/ dialogs/ services/ css/ wails/ wasm/
├── tests/                      # ★ 契约测试 (8 个 .mjs, CI 禁改)
│   ├── test_resource_schema.mjs test_creators_schema.mjs
│   ├── test_workshop_schema.mjs test_config_*.mjs
│   └── test_html_integrity.mjs test_scripts_*.mjs
├── docs/                        # ADR / guide / knowledge / archive / 根文档
└── scripts/                     # 40+ 治理 .mjs
```

---

## 12. 模块依赖与数据流

### (a) 拖拽导入 → 解析 → 预览

```
core/handler-dnd.ts 拦截 drop
  → ALL_EXTS 过滤 (extensions.ts)
  → readFileAsBase64 → shouldEnterForm
       (.ysm/ysm.json 直接进表单; .zip/.7z 调 Go DetectZipType)
  → features/import-queue.ts
  → Go ImportModelFile* (app_install.go) → go/importer 策略 → 落盘
  → emit tree:reload
  → 选中触发 model:select → app-preview
  → preview-wasm.ts decodeYsmViaWasm (§4.2)
  → utils/model3d.ts + Three.js 渲染
```

### (b) 模型树 / 仓库页填充

```
app-modules.ts 注册 loadEntries
  → app-tree/loader.ts
       GetRepoRoot(rtype) → ScanModelEntries(repoRoot) (Go app_scan.go:325)
       → 按 getExts(rtype) 过滤 (先剥 .ban)
       → 并发 IsFileBanned → 相对路径归一 → TreeEntry[]
  → app-tree/render.ts + virtual-scroll.ts
Go 侧 watcher 监听变更回调 ScanModelEntries/ClearScanCache (app.go:105)
```

### (c) 社区 / 工坊下载

```
app-content/community/core.ts:35-36
  → LoadWorkshopSites() + LoadWorkshopCreators() (Go app_workshop.go:56,109)
  → LoadGitHubRepos() (workshop-github.json)
用户选中 → features/community/download-queue.ts:139-142 EnqueueDownloads
  → Go app_download.go:50-64 入队 + Event.Emit("queue:status")
  → 串行 process() → DownloadFromGitHub (镜像回退)
  → 前端 Events.On("queue:status"/.../download:progress) 更新 UI
```

---

## 13. 测试与契约

### 13.1 三层防护

| 层 | 载体 | 守护内容 |
|----|------|----------|
| 契约测试 | `tests/*.mjs`（8 个，CI 禁改） | `test_resource_schema.mjs`（resource_types.json 必填字段 / kebab-case id / 唯一性 / extensions 以 `.` 开头 / installDir 尾斜杠 / 枚举 preview·detector·actions / configField 须 PascalCase+Root）、`test_creators_schema.mjs`、`test_workshop_schema.mjs`、`test_config_defaults/syntax.mjs`、`test_html_integrity.mjs`、`test_scripts_json/lib.mjs` |
| Go 单测 | `go/*_test.go`（12 个） | `go/types/registry_test.go`（JSON↔Go 扩展名一致性）、`go/ysm`、`go/sync`、`go/installer`、`go/recycle`、`go/threejs`、`go/updater`、`go/watcher`、`go/importer`、`go/dedup`、`go/packs`、`go/avatar`、`go/fsutil`、`go/tags` |
| 前端 Vitest | `*.test.js`（19 个） | `core/context-menus.test.js`(18.9KB)、`features/community/download-queue.test.js`(13.8KB)、`utils/model2d`、`utils/animation`、`utils/summarize`、`utils/extensions` 等 |

> 测试为**宪法基石，禁止修改**（AGENTS.md 硬约束）。改完即验：`for f in tests/*.mjs; do node "$f"; done` + `go test ./go/... -count=1` + `npm run typecheck`。

---

## 14. 近期架构变动

| 日期 | 变动 | 影响 |
|------|------|------|
| 2026-08-03 | 契约测试 Python → `.mjs` 迁移 | `tests/python/` 仅剩 `__pycache__` |
| 2026-08-03 | 前端文档/架构归位（本文扩充） | 渲染片段从 copilot-instructions 迁移；前端路线图/计划类文档收归架构与设计规范体系 |
| 2026-07 | 文档宪法 + 路径大统一 + 主题增强（v1.9.0） | `c381329` |
| 2026-06-16 | v1.7.8 头像增量刷新 | `download-queue.ts` 解析 `queue:file-done` + `bus.emit("avatar:refresh")`；`app-content` 定点更新卡片 |
| 2026-06-16 | v1.7.6/7 动画系统 | 统一 3 keyframe / stagger / 设计令牌（前端标准见 `docs/Design.md` §7 动画系统） |
| 2026-06-16 | v1.7.5 暗色自动切换 + 右键打开位置 | `matchMedia('change')` + `RevealInExplorer` binding |
| 2026-06-15 | v1.7.4 社区站点视图迁移至 Go 后端 | 前端硬编码数据移除，改 Go binding 读 JSON |
| 2026-06-11 | 👴 仓库元老降级为仓库页 Tab | 新建 `features/oldest-models.ts` |
| 2026-06-11 | 🧪 Go 测试框架 + CI | `go/*_test.go`；`.github/workflows/release.yml` |

---

## 15. 参考

- 事件总线：`frontend/src/bus.ts`（类型化，`window.bus` 兼容）
- Vite 构建：`frontend/vite.config.js`
- 发版脚本：`cmd/build-release.ps1`
- 治理自检：`scripts/doctor.mjs`、`scripts/link-checker.mjs`
- 组件规范（冻结快照）：`docs/archive/architecture.md`
- 设计规范（前端交互/动画标准权威）：`docs/Design.md`（§1 设计原则、§7 动画系统）
- 样式借鉴（不同项目）：`MikuMikuAR/docs/architecture.md`
