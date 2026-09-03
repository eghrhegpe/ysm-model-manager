---
title: 架构
description: YSM 模型管理器系统架构说明 — Wails v3 桌面壳 + Go 后端 + Three.js/YSMParser WASM 前端，附渲染管线标准、资源类型系统与关键数据流
---

# 架构

> 本文是 **ysm-model-manager** 的**系统架构说明（单一权威视图 / 基石文档）**。历史架构（组件级拆分快照）已冻结于 `docs/archive/architecture.md`。本文自洽承载全部架构事实，**不依赖外部决策文档**：3D 渲染坐标系/旋转/UV/顶点公式内联于 §4，资源类型系统内联于 §5。本文件由早期 `.github/copilot-instructions.md` 的渲染片段迁移归位并扩充为全系统视图。
>
> 样式参考：`MikuMikuAR/docs/architecture.md`（同属 Wails + 前端 3D 渲染类项目，仅作结构借鉴；两项目技术栈不同，本文以本仓库源码为准）。

## 1. 总览

YSM 模型管理器是一个跨平台桌面 + 移动 + 网页应用，用于管理 Minecraft **YSM（Yet Another Skin Model）自定义玩家模型**及其周边资源（资源包、光影包、litematic  schematic、MMD 皮肤、VRChat avatar 等）。核心能力：拖拽导入/安装、3D 实时预览、仓库树浏览、创作者/工坊生态聚合、版本同步。

| 平台 | 状态 | 架构模式 | 说明 |
|------|------|----------|------|
| **桌面** | ✅ 生产 | Wails v3 Service 绑定 | Windows / macOS / Linux |
| **Android** | ✅ 生产 | Wails v3 + Java 桥 | 查看器模式（授权访问公共目录） |
| **网页版** | 🔄 部分 | browser-adapter + IndexedDB | 纯静态托管（GitHub Pages），查看器模式 |
| iOS | ⏸ 待立项 | — | (ADR-046 P3) |

> Android 与网页版统一「查看器模式」（`isViewerMode()` 判定）：无本地文件系统写能力、无整合包/自更新/资源管理器等桌面专属功能；完整编辑/管理仍以桌面为准。

### 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 桌面壳 | **Wails v3**（Go + WebView2 / Android WebView / WebKitGTK） | `main.go` 注册单一 Service；Android 通过 Java 桥 + Gradle APK |
| 后端语言 | **Go 1.25** | 模块名 `ysm-model-manager`（`go.mod:1`）；Android 用 `-buildmode=c-shared` 编译 `libwails.so` |
| 前端 | **Vite + TypeScript**（Web Components + Shadow DOM） | `frontend/index.html` → `js/app-modules.ts`；源码全 `.ts`，仅 `*.test.js` 与生成态 `wasm/*-data.js` 为 `.js` |
| 3D 渲染 | **Three.js** + 内嵌 **YSMParser WASM** | WebView/浏览器/Android WebView 内内存直解 `.ysm`，无 exe sidecar |
| 平台抽象 | **build tags** + PathManager | `pathmgr_{desktop,android}.go`、`screen_{windows,other}.go`、`app_config_{windows,other,android}.go` 等 |
| Web 后端 | **backend adapter** | `backend/browser-adapter.ts` Proxy 同形状绑定；`backend/platform.ts` Tier 分层判定 |
| 数据 | `resource_types.json` 单一事实来源 + `creators.json` / `workshop_sites.json` / `workshop-github.json` | 资源类型/创作者/工坊站点/镜像仓库 |
| 脚本 | Node（`.mjs` 零依赖治理工具链） | `scripts/` 下 40+ 个校验/生成脚本 |
| 测试 | Go 单测 + Node 契约测试（`tests/*.mjs`）+ Vitest | 三层防护 |

### 分层职责

```
桌面/Web WebView2:                            Android:
┌────────────────────────────────────┐    ┌────────────────────────────────────┐
│  前端 (Vite/TS Web Components)       │    │  前端 (WebView + JS Bridge)          │
│   components/ · core/ · features/    │    │   components/ · android-bridge.ts    │
│   utils/ · backend/{app,platform}      │    │   features/android-events.ts          │
└────────┬──────────────────────────┘    └──────┬───────────────────────────────┘
         │ Wails Service 反射绑定                │  Java↔JS (WailsJSBridge)
         │ EventsOn / Event.Emit (反向)           │  System events (back/network/battery)
┌────────▼──────────────────────────┐    ┌──────▼──────────────────────────────┐
│  internal/app/ (绑定门面层, 29 文件)  │    │  internal/app/ (Go shared lib)       │
│   编排 Wails 生命周期 + 参数校验       │    │   libwails.so (c-shared, android tag) │
│   + PathManager 平台抽象 + Guard      │    │   PathManager(android) + Guard      │
├─────────────────────────────────────┤    ├─────────────────────────────────────┤
│  go/ (业务逻辑包, 23 个)               │    │  go/ (业务逻辑包, 23 个, build tags)  │
│   ysm · threejs · types · sync ...    │    │   ysm · threejs · types · sync ...    │
└─────────────────────────────────────┘    └─────────────────────────────────────┘
         │                                     │
  ┌──────┴────────┐                      CGO → Java (NDK)
  │ 文件系统/下载  │   embed.go               Android Java 层 (build/android/)
  │ 嵌入式资源      │                      MainActivity / WailsJSBridge / WailsBridge
```

```
Web 版 (GitHub Pages):
┌────────────────────────────────────┐
│  前端 (Vite/TS, MODE=web)            │
│   browser-adapter.ts (Proxy)          │
│   idb.ts (IndexedDB) + File API       │
│   ysm-parser.ts (WASM 内存解析)        │
└────────┬──────────────────────────┘
         │ resolveWebMode() 路由
         ├─ IDB (dir:/file: 前缀) → 虚拟根 /web/<type>/<name>/<rel>
         ├─ localStorage (配置)
         └─ 未实现 binding → WebUnsupportedError (fail-fast)
```

---

## 2. Wails 应用骨架

- **技术**：Wails v3 alpha2.105（Go 1.25 + WebView2/Android WebView/WebKitGTK），模块 `ysm-model-manager`（`go.mod:1`）。桌面四平台共享 `*app.App` Service 绑定面；Android 在此之上套 Java 宿主层 + Gradle APK。
- **入口** `main.go`（`//go:build !cli`）：
  - `//go:embed all:frontend/dist` 嵌入前端产物（:13）。
  - `app.NewApp()` 注册为单一 `application.Service`（:20-22）。
  - `SetApp(app)` / `SetMainWindow(wnd)` 注入运行时引用，避免启动期 `Window.Current()` 返回 nil（:28, :37）。
  - 窗口 **1280×800**，URL `/`（:30-35）。
- **Android 入口**：Wails v3 自动生成 Android 工程资产（`build/android/`），Go 以 `-buildmode=c-shared -tags android` 编译 `libwails.so` → `build/android/app/src/main/jniLibs/{arm64-v8a,x86_64}/libwails.so`，Gradle `assembleDebug`/`assembleRelease` 打包 APK。Java 宿主层详见 §2.2。
- **Web 版入口**：`frontend/web.html`（Tier 0 声明 `globalThis.__YSM_BACKEND__ = "browser"`） + `frontend/vite.web.config.ts`（`mode: "web"`, 输出 `dist-web`）。纯静态托管，无 Go 编译、无 Wails 壳，所有 binding 走 `browserAdapter` Proxy。详见 §6.6。
- **资源注入** `embed.go`（`//go:build` 无限制，双构建均编译）：`//go:embed creators.json resource_types.json workshop-github.json workshop_sites.json` + `frontend/dist/wasm/YSMParser.wasm` + `frontend/public/wasm/YSMParser.js`，经 `init()` → `app.SetEmbedded(...)`（:21-23）。

### 绑定模式

Wails v3 **Service 反射绑定**：`*app.App` 的所有导出方法自动暴露给前端，**无 `//export` 注解**。`wails3 generate bindings` 产出 `frontend/bindings/ysm-model-manager/internal/app/app.ts`（`scripts/build-release.ps1:37-46`）；Android 构建时加 `-tags android`（`build/android/Taskfile.yml:198`），前端以 `.js` 后缀 import，由 `vite.config.js` 的 `wailsBindingsResolve` 插件重定向到 `.ts`。

> **🔒 硬性契约（2026-08-05 回归后固化）**：bindings **必须**以 TypeScript 生成（`-ts`，产出 `.ts`）；**禁止**无 `-ts` 调用——会生成 `.js` 并 `-clean` 清掉跟踪的 `.ts`，破坏上方 import 重定向契约。**统一入口**：`npm run generate:bindings`（`frontend/package.json`，内部 `cd .. && wails3 generate bindings -clean=true -ts -i`，在仓库根执行）；`scripts/build-release.ps1` / `scripts/build-release.sh` 均调该脚本；`build/Taskfile.yml:160` 的 `generate:bindings` 任务保留 `-f`/`-obfuscated` 透传且带 `-ts`（默认 flags 下与 npm 脚本等效）。若误跑无 `-ts` 生成导致 `.ts` 被删，立即 `npm run generate:bindings` 恢复。

反向通道（Go → 前端事件）：`a.app.Event.Emit(...)`，例如 `app.go:101` 的 `config-loaded`、`app_download.go:62` 的 `queue:status`。

### 2.1 平台判定与能力门控

前端通过 `backend/platform.ts` Tier 分层判定运行环境：

| Tier | 判定 | 说明 |
|------|------|------|
| 0 | `globalThis.__YSM_BACKEND__` | 权威信号：`'go'`=桌面/Android，`'browser'`=网页版 |
| 1 | `__YSM_WEB__ === true` / `MODE === 'web'` | vite web 构建判定 |
| 2 | `window.go` / `window.wails` | 桌面 Wails 桥 / Android Java 桥 |

`isViewerMode()`（`android-bridge.ts:24`）统一判定「查看器模式」：`__YSM_BACKEND__=browser`（网页版）或 Android 桥存在 → 隐藏自更新/资源管理器/游戏目录等桌面专属 UI，写操作降级为只读/浏览器下载。

### 2.2 Android Java 宿主层

`build/android/app/src/main/java/com/wails/app/`：

| 文件 | 职责 |
|------|------|
| `MainActivity.java` | WebView + WailsBridge 生命周期管理，`WebViewAssetLoader` 本地资产服务，`onShowFileChooser` 文件选择，`MANAGE_EXTERNAL_STORAGE` 授权流程，系统事件 BroadcastReceiver |
| `WailsJSBridge.java` | Go binding 方法调用桥（`@JavascriptInterface`），事件 emit 到 JS |
| `WailsBridge.java` | 原生库加载、桥接初始化 |
| `WailsPathHandler.java` | WebView 资产请求处理 |

Java → JS 事件通过 `bridge.emitEvent` → Wails CustomEvent 通道（**勿用 `emitSystemEvent`**，后者仅达 Go 侧）转发，前端 `Events.On("android:*")` 消费。详见 `docs/knowledge/android-bridge.md`。

### 2.3 Web 版 backend adapter

`frontend/src/backend/browser-adapter.ts`：Proxy 生成与 `AppBindings` 同形状的浏览器后端。Phase 2 实现了 `ScanModelEntries`/`ScanModelEntriesWithLabel`/`ReadFileBytes`/`GetRepoRoot`/`GetDefaultRepoRoot`/`LoadAppConfig`/`SaveAppConfig`/`GetModel3DSpec`/`Build3DSpecFromGeometryJSON`，数据层为 IndexedDB（`idb.ts`，`dir:`/`file:` 前缀模拟目录）+ localStorage（配置）。

- 虚拟根 `/web`：路径语义与桌面一致，业务调用零改动
- 未实现 binding → `WebUnsupportedError` (fail-fast，禁止 undefined 穿透)
- `importWebFiles(files, type)`：File API/拖拽 → IndexedDB (Phase 3 UI 入口)
- `then` 特判防 thenable 探测陷阱，`has` 陷阏供 Phase 3 能力门控探测
- 3D spec 回退：`GetModel3DSpec → "{}"`，走 WASM 兜底守卫（P2-2 遗留：`Build3DSpecFromGeometryJSON` 需移植到 WASM 才能真正渲染）

---

## 3. Go 后端架构

后端分两层：**`internal/app/` 绑定门面层**（编排 Wails 生命周期、参数校验、调用业务包）+ **`go/` 业务逻辑包**（纯逻辑，可单测）。

### 3.1 `internal/app/`（29 文件，~5700 行）— 绑定门面

| 文件 | 行数 | 职责 / 代表绑定 |
|------|------|----------------|
| `app.go` | 135 | `App` 结构体、`ServiceStartup`/`ServiceShutdown` 生命周期（含 Android watcher 守卫）、`OpenInBrowser`、`GetAppVersion` |
| `app_install.go` | 1255 | 最大文件。导入/安装/同步：`ImportModelFile*`、`SyncResources`、`Push/PullResourceFromInstance`、`RelinkCustomDir`、回收站 `MoveToRecycle*`/`RestoreFromRecycle` |
| `app_scan.go` | 578 | `ScanModelEntries`、`SearchModels`、`GenerateRepoIndex`、`ListVersionInstances`、`ScanLocalAuthors` |
| `app_config.go` | 462 | `LoadAppConfig`/`SaveAppConfig`、窗口位置、`CheckUpdate`/`DoUpdate`、`SelectDirectory` |
| `resource_bindings.go` | 405 | `LoadResourceTypes`（读 `resource_types.json`，:21）、`GetRepoRoot`、`DetectResourceType`、`ImportByType`、litematic/nbt voxel 读取 |
| `app_files.go` | 337 | 文件 CRUD、`ToggleModelEnable`（`.ban` 后缀）、`ExtractPreviewTexture`、`RevealInExplorer`/`OpenFolder` 平台守卫 |
| `app_workshop.go` | 318 | 工坊站点/创作者 CRUD、CSV/JSON 导入导出、`atomicWrite`（:19 临时文件 + rename） |
| `app_download.go` | 317 | `DownloadQueue` 串行队列、`EnqueueDownloads`、`DownloadFromGitHub`（镜像回退） |
| `app_model.go` | 253 | `AnalyzeYSMModel`、`ExtractYSMHeader`、`GetModel3DSpec`、`ReadFileBytes`（base64） |
| `proxy.go` | 204 | `StartProxy`/`StopProxy`/`IsProxyRunning` |
| `plaza_window.go` | 180 | 模型广场 Wails 第二窗口：`prewarmPlazaWindow`/`NavigatePlazaWindow`（ADR-050） |
| `wasm_decoder.go` | 191 | Node.js 兜底解码 `decodeYSMViaNodeJS`（:48），Android 守卫 `findNodeJS` 恒空串 |
| `app_avatar.go` | 126 | 创作者头像提取缓存 |
| `app_tags.go` | 46 | `GetModelTags`/`SetModelTags`/`AllTags` |
| `bundled_data.go` | 27 | **三级解析**：exe 同级 → exe 上级 → 嵌入基线（:13-27） |
| `pathmgr.go` | 45 | **PathManager 接口 + 单例**（ADR-046 P2）：`appDataRoot()`/`defaultRepoRoot()` 委托平台实现 |
| `app_config_windows.go` | — | Windows 专属：`scanMinecraftDirsPlatform`（Java 启动器路径） |
| `app_config_other.go` | 26 | macOS/Linux 专属：`scanMinecraftDirsPlatform`（PrismLauncher/XDG/传统 .minecraft） |
| `app_config_android.go` | 7 | Android 专属：`scanMinecraftDirsPlatform` 空实现（查看器模式无启动器扫描） |
| `go/executil/hidewindow_windows.go` / `hidewindow_other.go` | — | 窗口隐藏（Wails Dialog 创建时 `SW_HIDE`，原 internal/app 副本已收敛） |
| `screen_windows.go` / `screen_other.go` | 28/11 | 虚拟屏幕坐标（窗口位置恢复） |
| `texture_order.go` | — | 纹理序口径统一：ysm.json 声明序优先 / 尺寸降序 |
| `assets.go` / `wasm_embed.go` | 20/17 | `SetEmbedded` 注入点；`GetWasmBinary` |

| 平台隔离文件（build tags） | build tag | 职责 |
|--------------------------|-----------|------|
| `pathmgr_desktop.go` | `!android` | `desktopPathManager`：`AppDataRoot()`→`os.UserConfigDir()`，`DefaultRepoRoot()`→`""` |
| `pathmgr_android.go` | `android` | `androidPathManager`：沙盒私有目录 + `MANAGE_EXTERNAL_STORAGE` 公共仓库根 |
| `screen_windows.go` | `windows` | `getVirtualScreen()`→`user32.dll` 虚拟屏幕 API |
| `screen_other.go` | `!windows` | `getVirtualScreen()`→零值（窗口位置退化为默认） |
| `go/executil/hidewindow_windows.go` | `windows` | `HideWindow()`→`ShowWindow`（原 internal/app、go/avatar、go/fileops 三处副本已收敛至此） |
| `go/executil/hidewindow_other.go` | `!windows` | `HideWindow()`→Noop（原 internal/app、go/avatar、go/fileops 三处副本已收敛至此） |
| `app_config_windows.go` | `windows` | Minecraft 启动器扫描（Java） |
| `app_config_other.go` | `!windows && !android` | Minecraft 启动器扫描（PrismLauncher/XDG） |
| `app_config_android.go` | `android` | Minecraft 启动器扫描（空实现） |
| `go/updater/updater_windows.go` | `windows` | 自更新 |
| `go/updater/updater_other.go` | `!windows` | 自更新（拒绝，非 Windows 不支持） |
| `go/fsutil/hardlink_windows.go` | `windows` | 硬链接检测（收敛自原 sync/checkHardLink + recycle/isHardLink） |
| `go/fsutil/hardlink_other.go` | `!windows` | 硬链接检测（含目录排除 ADR-038） |
| `go/recycle/crossdevice_windows.go` / `_other.go` | `windows` / `!windows` | 跨设备判断 |

约 **150 个导出方法**构成绑定面。

### 3.2 `go/`（23 包）— 业务逻辑

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
| `tags` / `logs` / `paths` / `fsutil` / `executil` / `version` | 标签 / 日志 / 路径 / 文件工具 / 外部进程工具 / 版本号 |
| `fileops` | 文件 CRUD + 文件夹导入 |
| `instance` | Minecraft 版本实例发现 + 同步 |
| `scanner` | 仓库扫描/索引（`go/scanner`） |

### 3.3 平台隔离层（Platform Isolation）

由 `internal/app/pathmgr_*.go` + 散布在 `internal/app/` 和 `go/*` 的 build-tag 双文件共同构成。参照 MikuMikuAR ADR-018 的 `PathManager` 模式，收敛平台差异点：

| 差异点 | desktop（`pathmgr_desktop.go`, `!android`) | Android (`pathmgr_android.go`, `android`) |
|--------|------------------------------------------|-------------------------------------------|
| AppDataRoot | `os.UserConfigDir()` | 沙盒私有目录 `/data/data/<pkg>/files`（候选回退 HOME/UserConfigDir/CWD） |
| DefaultRepoRoot | `""`（用户在设置页配置） | `/storage/emulated/0/YSM-Model-Manager`（`EXTERNAL_STORAGE` env，授权后 `os.*` 直读） |
| 文件选择 | Wails Dialog | 授权 + 手动输入路径（Wails 官方拒绝 Android 目录对话框） |
| 扫 Minecraft 启动器 | scanMinecraftDirsPlatform（Java/Prism/XDG） | 空实现 |
| 自动更新 | `go/updater` (Windows) / 拒绝 (`updater_other.go`) | 跳过 |
| `RevealInExplorer`/`OpenFolder` | `explorer`/`open`/`xdg-open` | 显式拒绝 |
| `RestartApplication` | `os.Executable` + `exec.Command` | 显式拒绝 |
| 文件监听 watcher | fsnotify | 启动时跳过（sdistFUSE 事件不完整） |
| Node.js sidecar 解码 | `decodeYSMViaNodeJS` | `findNodeJS` 恒空串（走 WASM 内嵌） |
| 屏幕边界 | `getVirtualScreen()` → user32 API | 零值（窗口位置退化为默认） |

### 3.4 命令行

`cmd/`：`updater/`（编译为 `go/updater/ysm-updater-helper.exe` 被 embed）；构建脚本在 `scripts/`（`build-release.ps1`/`build-release.sh`、`build-darwin.sh`、`build-linux.sh`、`build-android.ps1` / `build-android-so.ps1`）。

### 3.5 CLI 与 GUI 双入口解耦（`go/cli/` 注册表 ≠ Wails 绑定）

> **核心命题**：项目存在**两条互不依赖的命令执行路径**，共用底层业务包但入口完全不同。新 AI 接手时最容易混淆这两条路径，误以为 `go/cli` 注册表是前端可消费的 API 契约。**此节即为此画红线。**

**路径对照**：

| 维度 | CLI 路径 | GUI 路径 |
|------|----------|----------|
| 入口文件 | `main.go`（`//go:build cli`，`RunCLI`） | `main.go`（`//go:build !cli`，`wails.Run`） |
| 分发机制 | `go/cli/registry.go` 的 `CliCommand` map + `DispatchCommand` | Wails v3 Service 反射绑定（`*app.App` 导出方法自动暴露） |
| 命令来源 | 22 个 `.go` 文件各 `init()` → `RegisterCommandC(name, category, desc, run)` | `internal/app/*.go` 中 `func (a *App) MethodName(...)` 签名即契约 |
| 参数解析 | 各命令内 `flag` / `strconv` 手动解析，无统一 schema | Wails 自动 JSON 序列化，前端按绑定签名传参 |
| 前端可达性 | **不可达**（`Run` 字段是 Go 闭包，无 JSON 序列化） | **可达**（`npm run generate:bindings` 产出 `.ts`，前端 import） |
| 共享层 | 共用 `go/` 业务包（`scanner`、`installer`、`tags`、`texture_cache` 等） | 同左 |

**`CliCommand` 结构体的能力边界**（`go/cli/registry.go:18`）：

```go
type CliCommand struct {
    Name        string   // 命令名
    Category    string   // 分类（CatModel/CatPerf/CatCache/CatResource/CatConfig/CatOther）
    Description string   // 帮助文本
    Run         func(ctx *CmdContext) error  // 执行闭包
}
```

**注册表不携带的元数据**（新 AI 勿据此推断功能）：
- ❌ **Flags 列表**：`--format json`、`--model`、`--iterations` 等选项描述写在各自 `print*Usage()` 函数的字符串里，`gen-cli-doc.mjs` 用正则提取——**加 flag 必须同步改 `print*Usage` 和 `parse*Flags` 两处**，否则文档过期/解析失效。
- ❌ **子命令结构**：无结构化子命令描述，靠 `printSubcommands()` 打印。
- ❌ **版本/废弃标记**：无 `deprecated` / `since` 字段。
- ❌ **权限/前置条件**：是否必须 `--files-root` 由 `DispatchCommand` 全局判断，不区分命令。
- ❌ **JSON schema 导出**：注册表无对外 schema，前端无法通过绑定消费。

**前端消费/不消费的判断依据**：

`internal/app` 绑定注册表（~610 行）中包含一个 `get_all_commands` 绑定方法，但**前端 `main.ts` 中零引用**。这不是遗漏，而是设计如此：
1. `CliCommand.Run` 是 `func(*CmdContext) error`——Go 闭包，无法序列化过 Wails JSON 桥
2. 前端需要的模型查询操作（`ListModels`、`SearchModels`、`AnalyzeYSMModel`）已有独立绑定，不需要走 CLI 注册表
3. `get_all_commands` 的存在仅供 CLI 自检/自动化脚本使用，不在前端消费范围内

**新 AI 高危误判清单**（踩坑预警）：

| 误判 | 真相 | 后果 |
|------|------|------|
| 看到 `get_all_commands` 绑定 → 以为前端有 CLI 面板 | `main.ts` 零引用，是预留未用 | 白做，写一套从未被调用的前端面板 |
| 看到 `GetAllCommands()` → 试图把注册表暴露给前端 | `Run` 字段无法序列化，整表无 flags 元数据 | 违反绑定契约，编译报错 |
| 看到 `print*Usage()` 里的 flag 描述 → 以为改这里就够 | 还要同步改 `parse*Flags()` | CLI 加了 flag 但解析不到，静默失败 |
| 看到 CLI 和 GUI 共享业务包 → 以为"一个修好另一个就好" | 入口参数校验/错误处理/输出格式各自独立 | 漏修入口层，GUI 仍挂 |

**注册表 ↔ 文档的自动同步**：`scripts/gen-cli-doc.mjs` 消费 `RegisterCommandC` 调用 + `print*Usage` 正则，生成 `docs/cli-commands.md`；`tests/test_cli_doc_parity.mjs` 锁双向一致；pre-commit 阶段 `--check` 守护。新增 CLI 命令只需改 `go/cli/*.go` 源码 + 重跑 `node scripts/gen-cli-doc.mjs`，文档自动跟上。

---

## 4. YSM 模型解析与渲染（Three.js + YSMParser WASM）

### 4.1 YSMParser WASM 内嵌（单一资产，两个消费端）

上游 [YSMParser](https://github.com/OpenYSM/YSMParser)（C++）经 Emscripten 编译为 WASM 后 base64 内嵌，**取代 exe sidecar**。2026-08-08 起**统一为单一 web 产物**（此前「前端版 / Go 版」两份不同二进制——导出面不同导致维护与重出负担，统一方向：Node 能 require web glue（实测 callMain 解码成功），WebView2 反之不行（NODERAWFS 依赖 Node fs），故保留 web、弃 node）：

| 资产 | 位置 | Emscripten 导出面 | 消费端 |
|------|------|-------------------|--------|
| 统一 web 产物（编译自 `upstream/YesSteveModel-Parser`，产物暂存 `build-unified/`） | 前端 base64：`frontend/src/wasm/ysm-wasm-data.js` + `ysm-glue-data.js`；Go embed：`frontend/public/wasm/YSMParser.{js,wasm}`（`embed.go` 经 `frontend/dist/wasm/` 内嵌） | `_main`（callMain）/ `ysm_decode_from_memory` / `_malloc` / `ccall` / `cwrap` / `FS` | 桌面 WebView2 / Android WebView / 纯浏览器网页版 内存直解 + Go 端 Node.js 子进程 callMain |

- **重建脚本**：`node scripts/build-ysm-wasm.mjs`（em++ 一次编译 → 前端 base64 打包 → Go embed 拷贝 → glue 锚点校验），上游更新后只需重跑一次，两端同步生效，不再有「两份资产不同步」问题。
- exe sidecar 仅作开发调试的 Go CLI fallback；**发版时不打包 YSMParser.exe**。
- 调试 CLI fallback 可从 `build/ysmparser-cache/` 恢复（`wails3 build -clean` 会清空 `build/bin/`，但 WASM 已内嵌，无需强制恢复 exe）。

### 4.2 解码运行时：两条路径，同一份 C++ 能力

**路径 A — 前端 WebView2 / Android WebView / 纯浏览器**（`frontend/src/wasm/ysm-parser.ts`，加载统一 web 产物）：

1. 动态 `import()` 两个 data 文件 → 补丁胶水代码追加 `Module["HEAPU8"]=HEAPU8`（:75-78）；
2. 设 `window.Module = { wasmBinary, noInitialRun: true }`（:81-86）；
3. **间接 `eval`** `(0,eval)(patchedGlue)`（:89）→ 调 `YSMParserModule` 工厂；绕开 WebView2/fetch 的 CORS 限制；
4. 双解码路径：`decodeYsmFileFromMemory`（`ccall("ysm_decode_from_memory")` + `_malloc`）优先；`decodeYsmFile`（`callMain` + MEMFS）回退。

> 历史注记：早期版本 `ysm-glue-data.js` 的 `_getGlueCode` 引用未声明 `_cachedWasm` 且返回 `ArrayBuffer`，导致前端 WASM 路径静默失败回退 Go 解析；审计核实（2026-08-08）该 bug 已随数据文件更新（现用 `_cachedGlue` 且返回 string）修复，「WASM 路径必回退 Go」的假设已失效。

**路径 B — Go 端 Node.js 子进程（生产主路径，发版时 `.ysm` 解码的唯一路径）**（`internal/app/wasm_decoder.go` `decodeYSMViaNodeJS`、`go/avatar/avatar.go` `DecodeYSMFiles`，加载同一统一 web 产物）：

1. `findNodeJS()` 在 PATH 找 `node`/`node.exe`（`wasm_decoder.go:25`），找不到则路径 B 不可用；
2. 内嵌 glue + wasm 写到临时目录，拼 `decode.cjs` 脚本：
   - `const YSMParser = require(glueFile)` → `await YSMParser({ wasmBinary, noInitialRun: true })` 实例化 Emscripten 模块；
   - `FS.writeFile('/input/model.ysm', ys)` 写入 MEMFS；
   - **`mod.callMain(['-i','/input','-o','/output'])`** —— 参数与 CLI exe 一致，等于在 Node 运行时里执行原版 C++ 解析器；
   - 递归收集 `/output` 文件，打 `FILES_JSON:` 标记输出（:88）；
3. 子进程带超时护栏 + `HideWindow` 防黑框；输出经 `geometry.ParseBedrockGeometry` 合并多骨骼、填纹理 base64 → `types.BedrockModel`（:127-180）；
4. **纯 Node 即可解码，不依赖浏览器/WebView2**（已实测：`upstream/` 下 10 个 .ysm 全部可用此路径解码出骨骼/动画/纹理/头像）。`go/avatar/avatar.go` 的 `DecodeYSMFiles` 是同一套机制的复用（头像提取），两处脚本逻辑近似。

> ✅ **前后端共用同一份 web 产物**（2026-08-08 统一）。若未来更新 YSMParser 上游，重跑 `node scripts/build-ysm-wasm.mjs` 即可同步重出两处（前端 base64 data + Go embed），不再需要两套编译参数。

**解码优先级链（现状总表）**：

| 输入 | 第一优先级 | 第二优先级 | 最终 |
|------|-----------|-----------|------|
| `.ysm`（加密 V2/V3 / 开放） | `runYSMParserOnFile` → `FindCLI()`（exe，仅开发态存在） | `decodeYSMViaNodeJS`（Node.js + WASM `callMain`） | 空 `BedrockModel{}` |
| `.zip` / `.7z`（开放 OYSM） | Go 原生 `geometry.ParseFromZip/7z` | `runYSMParserOnFile`（同 `.ysm`） | 空 |
| `.json`（已解压目录） | `ysm.FindGeometryInExtractedYSM` | — | 空 |
| 前端/Android/Web 预览 `.ysm` | WebView/浏览器 WASM（内存直解 → `callMain`） | Go `AnalyzeBedrockModel`（→ Node.js + WASM / exe） | 空 |

- **发版场景（不打包 exe）**：`.ysm` 实际解码主路径就是 **Node.js + WASM `callMain`**——Go 自己零解密代码，能力全部继承自原版 C++ 解析器（认识 YSGP V2 / YSGP V3 / OYSM 全变体），这就是「支持所有版本」的来源。
- **无 node 场景**：路径 B 不可用，加密 `.ysm` 无法解码（仅开放 zip/7z 走 Go 原生），这是 ADR-029 保留 exe 回退的初衷。

消费方 `preview-3d/decoder/wasm-decode.ts:25-160` 完整链（前端，ADR-137 归位）：
```
ReadFileBytes(Go, base64) → atob → Uint8Array
  → (.json 走 parseYsmJsonDirect 直解)
  → initYSMParser → 内存解码 → MEMFS
  → stripYsgpTextHeader 剥文本头重试 (V2/V3)
  → 全失败回退 Go AnalyzeBedrockModel（app_model.go，其内部再走 Node.js + WASM / exe）
```

`views/app-preview/model3d-loader.ts` — `fetchSpec` 优先调 Go `GetModel3DSpec`，失败回退 `buildSpecFromModel`（JS 几何），LRU 20 条 spec 缓存。

### 4.2.x 解码器 vs Go 原生解析差异（2026-08-09 摸查结论）

`.ysm` 走 wasm 解码（YSMParser 输出标准 json 再解析）与 `.zip/.7z/.json` 走 Go 原生 `ParseBedrockGeometry` 曾存在**口径分叉**，已逐项对齐：

| 差异点 | 表现 | 处置 |
|--------|------|------|
| cube `inflate`/`mirror` 字段 | YSMParser 解码时已把 inflate 烘焙进几何尺寸、输出 json 无此字段；Go 原生解析 zip/7z/json 的**原始 json** 含这些字段但被丢弃 → 老模型（1.10+ Blockbench 导出，如 `inflate:0.01/-0.35`）尺寸偏小/纹理方向错 | `parse.go`+`types.Cube2D` 解析，`buildCubeMeshData` 消费（inflate 几何 origin-i/size+2i、mirror UV 水平翻转），对齐 Java GeoCube/GeoQuad 口径 |
| box UV 尺寸基准 | Go 曾用**膨胀后**尺寸展开 box UV，C# 黄金参考（`csharp-builder.mjs`）先 `expandBoxUV(原始 sz)` 再 inflate → UV 范围漂移、贴图拉伸/塌缩 | `parseUV` 改传原始 `c.Size`；负 inflate 各轴 clamp 到 `thicknessEpsilon` 防面翻转 |
| JS 兜底同步 | `model3d-spec.ts`（历史兜底，双边锁定测试）曾无 inflate/mirror 字段，与 Go 漂移 | SpecCube 补字段 + JS 构建应用同口径几何/UV 行为 + 镜像测试 |

**已验证无差异的部分**（无需改）：负 `uv_size` 占比 48%（16472/34068 face 条目）——Go `parseFaceUV` 与 C# `getFaceUV` 逐行一致（负值直接参与计算产生镜像，不翻转 V）；M 前缀镜像骨骼（75/836，YSM 命名如 `MLeftArm→Arm`）——YSMParser 解码已输出完整独立骨骼链，Go 按普通骨骼处理即正确，无需特判；texSlot——两条路径均按组件序全局化。

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

- 当前稳定版为 `frontend/src/preview-3d/model3d.ts`（旧 `docs/model3d.js` / `docs/model3d-ysm-attempt.js` 备份已随文档治理删除）。
- 旧版 `applyBoxUV`/`applyFaceUV` + `BoxGeometry` 方案永久废弃，不允许再提及或恢复。

---

## 5. 资源类型系统（`resource_types.json` 单一事实来源）

位于**仓库根**（约 3.4KB），顶层唯一键 `resourceTypes`（数组，15 项）：`resourcepack / shaderpack / ysm / blueprint / litematic / EntityPlayer / SceneModel / CustomAnim / CustomMorph / StageAnim / mmd-shader / DefaultAnim / DefaultMorph / fbx / maid-model`。

每项字段：`id, name, icon, extensions[], storageSubDir, configField, configFallback?, installDir, scanDir, instanceLevel, preview(3d|thumbnail|none), detector(mcmeta|shader|ysm|zipentry|extension), isDir?, actions[]`。

### installDir vs scanDir 语义（ADR-095 澄清）

| 字段 | 语义 | 消费方 |
|------|------|--------|
| `installDir` | 资源**存储目录模板**（相对 mcRoot，如 `versions/{instance}/ysm/`、`resourcepacks/`、`tlm_custom_pack/`）。Go 逻辑层仅 `resolveInstDirTarget`（打开文件夹候选 A/B）消费，前端 resource-manager 实例模式推导 `_rpRoot` 亦用 | 展示 / 导航 |
| `scanDir` | 模组**加载 / 扫描目录**（相对版本目录，如 `config/yes_steve_model/custom`）。**安装 / 同步 / 统计 / 哈希的锚点**（`FindInstDir` 探测）| 写入 / 数据链路 |

**警示**（ADR-095 教训）：整合包「打开文件夹」曾误用 `scanDir`（模组加载目录）导致打开 `config` 而非资源包目录。「打开」应指向存储 / 模型真身目录。新增类型需两者都给：`installDir` 管「打开给用户看」，`scanDir` 管「模型装哪、模组从哪读」——两者通常不同（ysm 是典型：存储 `versions/{instance}/ysm/`，加载 `config/yes_steve_model/custom`）。

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
| `workshop_sites.json` | 8.9KB | 工坊站点 + `searchUrl` 模板（`&#123;&#123;q&#125;&#125;`）+ `presetSearches` |
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

> 组件与文件全量清单、规模、函数映射以自动生成物 `docs/project-map.md`（`scripts/gen-project-map.mjs`）为准；下表为概览快照，以生成物为最新。

| 组件 | 规模 | 关键文件 |
|------|------|----------|
| `app-content/` | ~185KB，多文件 | 主页面路由 `index.ts:133-149` switch（repository/instances/workshop/github/diagnostics/oldest/settings）；`content-css.ts` 65KB；`community/` 子模块（`site-view.ts` 49KB、`settings.ts` 28KB、`diagnostics.ts` 17.5KB、`core.ts`、`workshop-data.ts`、`workshop-icons.ts`） |
| `app-preview/` | ~160KB，16 文件 | `skeleton.ts` 36.8KB、`wasm.ts` 22.9KB、`litematic-3d.ts` 21.7KB、`css.ts`、`pack.ts`、`detail.ts` |
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
- **`js/core/page-store.ts`**（759B）：页面状态唯一来源，`registerPageStore` 的 `nav:changed` listener 单向同步（过 `sanitizePage` 白名单）；无公开 setter（旧 `setCurrentPage` 已删除——幽灵路径历史本体，禁止复活）。
- **`js/services/registry.ts`**（1.6KB）：`Map<string, unknown>`，仅注册"有替换价值"的依赖（数据加载函数）；渲染/纯函数直接 import。

### 6.5 其他前端目录

`core/`（context-menus 13.7KB、handler-dnd 10.6KB、handler-sync 10.8KB、handler-upload、theme、page-store、menu-defs）、`features/`（import-queue 30.8KB、community/download-queue 21.4KB、oldest-models、recycle-bin、version-updater、dnd-state）、`utils/`（3d/ 含 adapters 适配器层 + caps 能力层 + perception 感知层共 138 文件、model2d 19.4KB、animation、summarize、display、extensions、resource-types 等 20+ 模块）、`utils/dom/`（android-bridge、directory-picker、esc、dom 等）、`dialogs/`（modal/rename/batch-rename/tag-editor/adv-filter）、`services/registry.ts`、`backend/`（app.ts / platform.ts / browser-adapter.ts / idb.ts / types.ts）、`wasm/`、`css/`、`web-spike/`（ADR-049 Phase 0 调试页）、`views/`（app-content/app-preview/app-tree/app-sidebar/app-resource-manager/app-sync-manager/app-nav/app-toast）。

### 6.6 网页版架构（Web Edition / 查看器模式）

参见 [ADR-049](./adr/ADR-049-web-edition-bridge.md)。网页版是纯静态托管（GitHub Pages），无 Wails 壳、无 Go 编译。

**入口与判定**：
- `frontend/web.html` — Spike 调试页，声明 `globalThis.__YSM_BACKEND__ = "browser"`（Tier 0 权威信号）
- `frontend/vite.web.config.ts` — `mode: "web"`, 输出 `dist-web`；复用 `wails-bindings-resolve` 插件
- `frontend/src/backend/platform.ts` — Tier 分层判定：Tier 0 `__YSM_BACKEND__` > Tier 1 `MODE=web` > Tier 2 `window.go`/`window.wails`
- `frontend/src/backend/app.ts:22` — `resolveWebMode()` 为真 → 返回 `browserAdapter`（跳过 Wails binding import）

**backend adapter**（`frontend/src/backend/browser-adapter.ts`）：
- Proxy 生成与 `AppBindings` 同形状后端
- Phase 2 实现：`ScanModelEntries`/`ScanModelEntriesWithLabel`（IDB `dir:` 前缀 → `ModelEntry`）、`ReadFileBytes`（`/web/` 路由 → IDB → base64）、`GetRepoRoot`/`GetDefaultRepoRoot`（虚拟根 `/web`）、`LoadAppConfig`/`SaveAppConfig`（localStorage）、`GetModel3DSpec`（`"{}"`，走 WASM 兜底）、`Build3DSpecFromGeometryJSON`（`"{}"` 桩，P2-2 遗留）
- 未实现 binding → `WebUnsupportedError`（fail-fast，`isViewerMode()` 隐藏对应 UI）
- `importWebFiles(files, type)`：File API/拖拽 → IndexedDB，UI 入口由 Phase 3 接入

**数据层**（`frontend/src/backend/idb.ts`）：
- `openDB()` 惰性单例，`idbGet`/`idbSet`/`idbDel`/`idbKeys` 前缀扫描
- key 规约（对齐 MikuMikuAR ADR-177）：`dir:<type>/<name>:`（目录标记）、`file:<type>/<name>/<rel>`（文件内容）、`cfg:<key>`（配置）
- IndexedDB 不可用（非浏览器/隐私模式/open 失败） → 自动降级内存 Map，应用不崩

**查看器模式守卫**（`isViewerMode()`）：网页版或 Android → 隐藏自更新/资源管理器/游戏目录/链接模式卡片，写操作降级为浏览器下载。

**遗留**：网页版 3D 预览当前走 `GetModel3DSpec → "{}"` → WASM 兜底守卫（spec 空 → 降级提示），`Build3DSpecFromGeometryJSON` 需移植到 WASM 才能真正渲染模型。

---

## 7. 预览系统（3D + 2D）

### 7.1 统一预览核心（ADR-066）

`frontend/src/preview-3d/adapters/mount-preview-core.ts`（928 行）是**所有富格式 3D 预览的单一事实来源外壳**，持有单实例 renderer / scene / camera / OrbitControls / rAF 循环 / 灯光 / 场景能力。内容差异经 `PreviewAdapter.build(ctx, path)` 挂进同一 `ctx.scene`：

```
mount3D(adapter, path, opts?)
  ├── cleanupPreview()          ← 旧会话清理
  ├── sceneCapabilityRegistry.createAll({scene, renderer, camera})  ← 8 个能力
  ├── adapter.build(ctx, path)  ← 内容层挂进 ctx.scene
  ├── fitCameraToRoots()        ← 相机取景
  └── requestAnimationFrame 循环 ← 每帧 update(dt) 驱动动态部分
```

**契约接口**：`PreviewBuildCtx`（外壳句柄 + `menu: PreviewMenuHandle` 注册通道）、`PreviewScene`（`update`/`dispose`/`resetCamera`/`extraControls`…）、`PreviewAdapter`（`id`/`mode`/`build`/`onClose`）、`PreviewHandle`。

**会话内切换**：`switchPreview(path)` 复用外壳重建内容层（ADR-066 §5.6）；`switchPreview(path, { keepInScene: true })` 同台追加多模型。

### 7.2 适配器矩阵（6 种格式）

| 适配器 | 文件 | 底层库 | 特殊能力 |
|--------|------|--------|----------|
| YSM | `ysm-adapter.ts`（475 行） | Go `GetModel3DSpec` binding | 骨骼组树 + cube mesh + 感知层（呼吸/注视） |
| VRM | `vrm-adapter.ts`（585 行） | `@pixiv/three-vrm` + `GLTFLoader` | SpringBone / lookAt / 表情 / VRMA 动画 / 感知层（呼吸/眨眼/注视） |
| MMD | `mmd-adapter.ts`（1242 行） | `@moeru/three-mmd` + `MMDAmmoPlugin` | PMX 物理（Ammo.js）/ VMD 动画 / VPD 姿势 / KTX2 纹理 / 感知层全开 |
| Litematic | `litematic-adapter.ts`（401 行） | 自研 voxel mesh | 分层控制 / 方块统计 |
| FBX | `fbx-adapter.ts`（173 行） | `FBXLoader` | 静态模型预览 |
| 资源包模型 | `pack-model-adapter.ts`（246 行） | `TextureLoader` | MC 资源包内模型预览 |

### 7.3 场景能力注册表（ADR-073）

`caps/scene-capability-registry.ts`：8 个能力按注册顺序创建，工厂模式，生命周期由框架驱动：

| # | 能力 | 文件 | 规模 | 底层 Three 扩展 |
|---|------|------|------|----------------|
| 1 | 天空 | `sky-capability.ts` | 674 行 | `Sky`（Preetham 散射） |
| 2 | 地面 | `ground-capability.ts` | 356 行 | — |
| 3 | 环境 | `environment-capability.ts` | 898 行 | `RGBELoader`（HDR IBL）+ PMREMGenerator |
| 4 | 雾效 | `fog-capability.ts` | 282 行 | `THREE.FogExp2` |
| 5 | 阴影 | `shadow-capability.ts` | 549 行 | `PCFSoftShadowMap` |
| 6 | 反射 | `reflector-capability.ts` | 304 行 | `Reflector` |
| 7 | 后处理 | `postprocessing-capability.ts` | 775 行 | `EffectComposer` + Bloom/SSAO/SSR |
| 8 | 灯光 | `light-capability.ts` | 790 行 | 环境光 + 方向光 + 体积光 |

**关键收益**：新增能力只需实现 `SceneCapability` 接口 + 注册一行；所有适配器零改动继承全部能力（共用同一 `ctx.scene`）。

### 7.4 多模型同框（ADR-093）

同一 scene 内叠加多个模型（上限 `MAX_MODELS=8`）：

- **场景注册表** `scene-registry.ts`：每模型存 `roots`/`visible`/`content`/`boneMaps`/`menuItems` 元数据
- **相机累加** `fitCameraToRoots(registry.visibleRoots(), ...)`：只框可见注册模型
- **拾取 dispatch**：统一拾取器（仅 `count >= 2` 激活）→ `pickModelByObject` 沿父链反查归属 → `setActive` 切活跃模型 + 换菜单
- **统一路由** `openModel3DFullscreen(path, { cooperate? })`：跨类型追加入口

### 7.5 感知层（程序化生命力）

`preview-3d/perception/`：让模型「活起来」的自主行为子系统，纯逻辑零 DOM：

| 层级 | 模块 | 驱动目标 |
|------|------|----------|
| L1 | `breath.ts` | 躯干正弦微位移（chest/spine/shoulders） |
| L1.5 | `blink.ts` | 周期性 morph 权重（眼睛闭合） |
| L2 | `gaze.ts` | 头部/眼球追踪相机 |
| L2 | `lipsync.ts` | 音频能量 → 嘴部 morph viseme |
| L3 | `autodance.ts` | BPM 节拍 → 12 根骨骼律动（hips/spine/arms/shoulders） |

**跨格式统一**：`semantic-bones.ts`（324 行）提供 23 个语义骨骼 id（对齐 VRM humanoid），VRM 零匹配直接产映射、MMD 经候选名表匹配（日/英/全半角变体）、YSM 经 Blockbench 命名候选表。宽容缺省：匹配不到直接缺省，消费方优雅降级。

### 7.6 KTX2 纹理压缩管线

`mmd-ktx2-encoder.ts` + `mmd-ktx2-basis.ts` + `mmd-ktx2-worker.ts`：

- PNG → WASM `BasisEncoder` → KTX2 → base64 → Go `SaveCachedTexture` 缓存
- 3 个 Web Worker 异步编码（Transferable 零拷贝）+ 信号量并发控制（MAX=3）+ 幂等去重
- 超大纹理跳过、Worker 不可用降级同步、编码失败静默降级
- 下次加载直接命中 Go 缓存，跳过 PNG 解码

### 7.7 物理引擎（Ammo.js）

MMD 适配器通过 `MMDAmmoPlugin` 一行注册：`new MMDLoader(manager).register(MMDAmmoPlugin)`。PMX 模型的刚体/布料/头发物理全部保留。

### 7.8 骨骼工具链

| 模块 | 职责 |
|------|------|
| `bone-tools.ts` | 跨格式骨骼抽象（BoneTree / BoneNode） |
| `semantic-bones.ts` | 语义骨骼映射（VRM/MMD/YSM 三格式统一） |
| `ik-solver.ts` | CCD IK 求解器（关节约束 + 极向量 + 阻尼） |
| `mmd-foot-ik.ts` | MMD 待机态双足锚地（防悬空/穿模） |
| `bone-raycast.ts` | 骨骼射线拾取 + 层级路径组装 |
| `model-group-builder.ts` | 骨骼组树构建（YSM spec → Group 层级） |

### 7.9 2D 预览 + 缓存 + 截图

- **2D 预览**：`views/app-preview/model2d/model2d.ts`（~19.4KB）处理平铺/网格 2D 缩略图（Canvas 2D 正交投影）。
- **缓存**：`utils/preview-cache.ts` 预览缓存 FIFO；`model3d-loader.ts` LRU 20 条 spec 缓存；`texture-cache.ts` 纹理引用计数池（跨模型复用，session 结束统一释放）。
- **截图**：`preview-3d/screenshot.ts` 纯函数（接收 renderer+scene+camera）+ `screenshot-render.ts` 离屏多角度（ADR-136 归位）+ `screenshot-lights.ts` toScreenshotLights（预览灯光提取）；Go 端 `app_files.go:ExtractPreviewTexture` 提取预览纹理。

---

## 8. 导入 / 安装 / 同步 / 回收站

> Android / Web 统一「查看器模式」（`isViewerMode()`）：完整的安装/同步/回收站仍以桌面为准；移动/网页端仅走导入（Android）或 IndexedDB 导入（Web）+ 3D 预览。

| 能力 | 前端 | Go 绑定 | 业务包 |
|------|------|---------|--------|
| 拖拽导入 | `core/handler-dnd.ts`、`features/import-queue.ts`（30.8KB）；Web 版 `importWebFiles` → IndexedDB | `ImportModelFile*`（app_install.go） | `go/importer`（策略接口）、`go/installer` |
| 安装/同步 | `core/handler-sync.ts` | `SyncResources`、`Push/PullResourceFromInstance`（app_install.go） | `go/sync`（硬/软链接）、`go/installer` |
| 回厂站 | `features/recycle-bin.ts` | `MoveToRecycle*`/`RestoreFromRecycle`（app_install.go） | `go/recycle` |
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

- `wails.json` — frontend dir `./frontend`，devServerUrl `:9245`（与 `Taskfile.yml` 的 VITE_PORT 默认值统一，消除历史残留的 `:5173` 占位）。
- `frontend/vite.config.js` — `wailsBindingsResolve` 插件；`frontend/vitest.config.ts` — Vitest（happy-dom，`src/**/*.test.{js,ts}`，`setupFiles: ./test-setup.ts`，覆盖率阈值 **statements 40 / branches 31 / functions 40 / lines 40**，排除 `src/wasm/**`）。
- `frontend/vite.web.config.ts` — Web 版独立构建配置（`mode: "web"`, 输出 `dist-web`），复用 `wailsBindingsResolve`。
- `Taskfile.yml` — 委派 `build/Taskfile.yml` + `build/{windows,darwin,linux,android}/Taskfile.yml`（ADR-046 P1/P2，四平台矩阵）；`task dev` = `wails3 dev -port 9245`；版本经 `APP_VERSION` 变量注入。
- `build/android/` — Wails v3 官方 Android 工程模板（Gradle + Java 桥 + `overlay.json` Go 构建覆盖）。
- `reasonix.toml`（~7.9KB）— AI 助手工具链配置（模型/agent/tools/lsp），非应用构建产物。

### 10.2 发布流水线

**桌面（Windows）**：`scripts/build-release.ps1`：
1. `wails3 generate bindings` → 2. `npm run build`（vite）→ 3. 构建 `ysm-updater-helper.exe`（embed 前置）→ 4. `go generate`（litematic block_ids）→ 5. `go build -ldflags "-X ysm-model-manager/go/version.Version=$VerTag"` → 6. 生成 SHA256SUMS → GitHub Release 上传裸 exe（v1.13.0 起，不再打包 zip）。

**桌面（macOS/Linux）**：`scripts/build-release.sh` → `scripts/build-darwin.sh` / `scripts/build-linux.sh`（NSIS/fpm 打包）。

**Android**：`node scripts/android-build.mjs`（一键）或 `Taskfile.yml` `android` include：
1. `wails3 android overlay:gen` → 2. `npm run build` → 3. `go build -buildmode=c-shared -tags android -overlay overlay.json` → 4. Gradle `assembleRelease` → APK（keystore 经 GitHub Secrets 注入）。

### 10.3 CI（`.github/workflows/release.yml`）

四平台打包矩阵 + test job：`tests/*.mjs` → 构建 updater helper → `go vet ./go/...` → `go test ./go/...` → `npm ci` → `tsc --noEmit` → `vitest run` → `vite build` → `task` 安装。另有 `pages-deploy.yml`（网页版 GitHub Pages）。

### 10.4 治理脚本（`scripts/`，40+ `.mjs`）

`binding-check` / `adr-check` / `event-audit` / `check-circular` / `check-doc-drift` / `check-knowledge-drift` / `doctor` / `link-checker` / `new-adr` / `android-build` / `android-install` 等。改完文档跑 `node scripts/doctor.mjs` 一键全量自检。

---

## 11. 目录结构

> 更新于 2026-08-10。*: 行数为约数（来自 `wc -l` 抽样）。

```
ysm-model-manager/
├── main.go                      # ★ Wails 入口
├── embed.go                     # 嵌入前端 + 数据 JSON + WASM
├── go.mod / go.sum              # Go 依赖 (模块 ysm-model-manager, Go 1.25)
├── wails.json                   # Wails v3 配置
├── Taskfile.yml / reasonix.toml
├── resource_types.json          # ★ 资源类型单一事实来源 (根目录)
├── creators.json / workshop_sites.json / workshop-github.json
├── cmd/
│   ├── build-release.ps1        # Windows 发布流水线
│   ├── build-release.sh         # Linux/macOS 发布流水线
│   ├── build-darwin.sh          # macOS 专用构建
│   ├── build-linux.sh           # Linux 专用构建
│   ├── build-android.ps1        # Android 构建链路 (NDK + Gradle)
│   ├── build-android-so.ps1     # Android Go shared lib 编译
│   ├── updater/                 # 编译为 ysm-updater-helper.exe (embed)
├── internal/
│   └── app/                    # ★ 绑定门面层 (29 文件, ~5700 行)
│       ├── app.go               # App 结构体 + 生命周期 + Android watcher 守卫
│       ├── app_install.go       # 导入/安装/同步/回收站 (最大, 1255 行)
│       ├── app_scan.go          # 扫描/搜索/索引
│       ├── app_config.go        # 配置持久化 + 更新 + PathManager
│       ├── resource_bindings.go # LoadResourceTypes + DetectResourceType
│       ├── app_model.go         # AnalyzeYSMModel / GetModel3DSpec
│       ├── app_download.go      # 下载队列
│       ├── app_workshop.go      # 工坊/创作者 CRUD + atomicWrite
│       ├── app_files.go         # 文件 CRUD + RevealInExplorer/OpenFolder 平台守卫
│       ├── app_tags.go / app_avatar.go / app_config_*.go
│       ├── proxy.go wasm_decoder.go wasm_embed.go assets.go
│       ├── plaza_window.go      # 模型广场 Wails 第二窗口 (ADR-050)
│       ├── pathmgr.go           # ★ PathManager 接口 + 单例 (ADR-046)
│       ├── pathmgr_desktop.go   # desktop 实现 (!android)
│       ├── pathmgr_android.go   # Android 实现 (android)
│       ├── screen_windows.go / screen_other.go  # 虚拟屏幕
│       ├── bundled_data.go cli.go
├── go/                         # ★ 业务逻辑包 (23 包)
│   ├── ysm/ threejs/ geometry/ litematic/ types/ sync/ installer/
│   ├── importer/ recycle/ dedup/ packs/ avatar/ download/ updater/
│   ├── watcher/ tags/ logs/ paths/ fsutil/ version/
│   ├── executil/              # 外部进程工具（hidewindow 平台双实现，收敛自三处副本）
│   ├── fileops/               # 文件操作（ADR-003 下沉）
│   ├── instance/               # Minecraft 实例管理
├── frontend/
│   ├── index.html               # 桌面/Android 入口 → js/app-modules.ts
│   ├── web.html                 # ★ Web 版 Spike 入口 (Tier 0 __YSM_BACKEND__=browser)
│   ├── vite.config.js           # wailsBindingsResolve + vitest (桌面)
│   ├── vite.web.config.ts       # ★ Web 版构建 (mode=web, dist-web)
│   ├── bindings/                # wails3 generate bindings 产物
│   ├── dist/                    # 桌面构建产物 (embed 源)
│   ├── dist-web/                # Web 版构建产物 (静态托管)
│   └── js/
│       ├── app-modules.ts       # 组件注册 + 初始化
│       ├── bus.ts               # 事件总线 (~50 事件)
│       ├── backend/               # ★ 跨平台桥接层
│       │   ├── app.ts           # getApp() + resolveWebMode 路由
│       │   ├── platform.ts      # Tier 分层判定 (Tier 0/1/2)
│       │   ├── browser-adapter.ts  # ★ Web 版 backend adapter (Proxy + IndexedDB)
│       │   ├── idb.ts           # Web 版 IndexedDB 封装
│       │   └── types.ts         # AppBindings 类型定义
│       ├── utils/dom/           # android-bridge / directory-picker / esc / dom
│       ├── components/          # app-content / app-preview / app-tree /
│       │                        #   app-sidebar / app-resource-manager /
│       │                        #   app-sync-manager / app-nav / app-toast /
│       │                        #   context-menu
│       ├── core/ features/ utils/ dialogs/ services/ css/ wasm/ web-spike/
├── build/
│   ├── Taskfile.yml / common/ windows/ darwin/ linux/ android/  # 平台构建
│   ├── android/                 # ★ Android 工程 (Gradle + Java + overlay.json)
│   │   └── app/src/main/java/com/wails/app/
│   │       ├── MainActivity.java
│   │       ├── WailsBridge.java
│   │       ├── WailsJSBridge.java
│   │       ├── WailsPathHandler.java
│   │       └── WailsForegroundService.java
│   └── config.yml               # Wails v3 多平台配置
├── tests/                      # ★ 契约测试 (8 个 .mjs, CI 禁改)
│   ├── test_resource_schema.mjs test_creators_schema.mjs
│   ├── test_workshop_schema.mjs test_config_*.mjs
│   └── test_html_integrity.mjs test_scripts_*.mjs
├── docs/                        # ADR / guide / knowledge / archive / 根文档
│   ├── architecture.md          # 本文 (单一权威视图)
│   ├── android-dev.md           # ★ Android 开发手册
│   ├── adr/                     # ADR-001~049
│   └── knowledge/               # 74 张知识卡 (自动生成索引)
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
  → preview-3d/decoder/wasm-decode.ts decodeYsmViaWasm (§4.2，ADR-137 归位)
  → preview-3d/model3d.ts + Three.js 渲染
```

### (b) 模型树 / 仓库页填充

```
app-modules.ts 注册 loadEntries
  → app-tree/loader.ts
     getApp() → resolveBackend() 路由：
        桌面/Android → GetRepoRoot(rtype) → ScanModelEntries(repoRoot) (Go app_scan.go:325)
        Web 版 → browserAdapter（Path /web/<type>）→ ScanModelEntries → IDB dir: 前缀扫描
     → 按 getExts(rtype) 过滤 (先剥 .ban)
     → 并发 IsFileBanned → 相对路径归一 → TreeEntry[]
  → app-tree/render.ts + virtual-scroll.ts
  Go 侧 watcher 监听变更回调 ScanModelEntries/ClearScanCache (app.go:105)
  Android/Web: 手动刷新（isViewerMode() 隐藏自动监听能力）
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
| **2026-08-31** | **平台 shim 收敛 + Go 重复治理**（ADR-139 / ADR-140） | `rustbridge`/`scanner` 四 OS 平台 shim 合并（`rust_backend.go` 单文件）；Go 文件内自重复三层判定与变体层不强制合并 |
| **2026-08-31** | **3D 子系统归位 src/preview-3d**（ADR-136 / ADR-137 / ADR-138） | 截图/离屏渲染、YSM 解码子系统归位 + `features/preview-3d` 中间层上提 `frontend/src/preview-3d/`（第五刀收尾） |
| **2026-08-30** | **测试消费性校验 + 缓存组件化 + Go jscpd**（ADR-133 / ADR-134 / ADR-135） | 契约测试从存在性门禁升级为消费性校验；`containerTypeCache` 包级全局收进组件；Go 端 jscpd 重复检测增量门禁 |
| **2026-08-29** | **拖拽直推仓库 + 统计提取 + 多模型选择原语**（ADR-130 / ADR-131 / ADR-132） | 整合包卡片拖拽先入仓库再推送；3D 渲染期统计提取与类型判定解耦；跨资源类型统一多模型选择菜单原语 |
| **2026-08-18** | **多模型同框引擎**（ADR-093） | `scene-registry.ts` 场景注册表（每模型 roots/visible/boneMaps/menuItems 元数据）；`fitCameraToRoots` 多包围盒累加取景；`pickModelByObject` 统一拾取 dispatch；`openModel3DFullscreen({ cooperate })` 统一路由入口；`MAX_MODELS=8` GPU 上限 |
| **2026-08-16** | **联邦 3D 渲染能力**（ADR-073） | `caps/` 8 个场景能力（Sky/Ground/Environment/Fog/Shadow/Reflector/Postprocessing/Light）由 `scene-capability-registry.ts` 工厂注册表驱动；所有适配器零改动继承；程序化天空（Preetham 散射）+ HDR IBL + Bloom/SSAO/SSR 后处理 + 镜面反射落地 |
| **2026-08-15** | **统一预览核心**（ADR-066 P3） | `mount-preview-core.ts`（928 行）收缴 vrm/litematic 复制脚手架，成为所有富格式 3D 预览的单一外壳；`PreviewAdapter` 适配器模式（ysm/vrm/mmd/litematic/fbx/pack-model 6 种格式）；声明式根菜单（ADR-076）+ 感知层开关面板 |
| **2026-08-11** | **感知层 + 语义骨骼** | `perception/` 自主行为子系统（呼吸 L1 / 眨眼 L1.5 / 注视 L2 / 口型 L2 / 自动跳舞 L3）；`semantic-bones.ts` 跨格式语义骨骼映射（VRM 零匹配 / MMD 候选名表 / YSM 候选名表）；CCD IK 求解器 + MMD 足部锚地 |
| **2026-08-11** | **RenderSession 对象化 → 删除**（ADR-052 P2 收尾） | render-session.ts 470 行生产无调用方，已删除；「实例字段封装、显式 dispose」思想由 ADR-066 统一核心继承；`model3d.ts` 缩为 Spec 类型枢纽（70 行） |
| **2026-08-09** | **v1.11.0：Android 全平台支持**（ADR-046 P1+P2 / ADR-047） | 构建管线扩展为四平台矩阵（Windows / macOS / Linux / Android arm64）；`PathManager` 平台抽象层（`pathmgr_{desktop,android}.go`）；Android Java 宿主层（`MainActivity.java` + `WailsJSBridge.java`）；`MANAGE_EXTERNAL_STORAGE` 授权闭环 + 系统事件（back/网络/battery/屏幕/主题）；Pointer Events 统一触屏交互；查看器模式能力门控 (`isViewerMode()`) |
| **2026-08-10** | **网页版 backend adapter**（ADR-049） | `browser-adapter.ts` Proxy 同形状绑定 + `idb.ts` IndexedDB 模型库；`platform.ts` Tier 分层判定；`web.html` + `vite.web.config.ts` 纯静态托管；`resolveWebMode()` 路由业务调用零改动 |
| 2026-08-04 | 前端文档/架构归位 | 渲染片段从 copilot-instructions 迁移；前端路线图/计划类文档收归架构与设计规范体系 |
| 2026-08-03 | 契约测试 Python → `.mjs` 迁移 | `tests/python/` 仅剩 `__pycache__` |
| 2026-08-03 | 前端文档归位（本文扩充） | 渲染片段从 copilot-instructions 迁移；前端路线图/计划类文档收归架构与设计规范体系 |
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
- Vite 构建：`frontend/vite.config.js` / `frontend/vite.web.config.ts`（Web 版）
- 发版脚本：`scripts/build-release.ps1` / `scripts/build-release.sh` / `scripts/build-darwin.sh` / `scripts/build-linux.sh` / `scripts/build-android.ps1`
- Android 开发手册：`docs/android-dev.md`
- 治理自检：`scripts/doctor.mjs`、`scripts/link-checker.mjs`
- 组件规范（冻结快照）：`docs/archive/architecture.md`
- 设计规范（前端交互/动画标准权威）：`docs/Design.md`（§1 设计原则、§7 动画系统）
- 样式借鉴（不同项目）：`MikuMikuAR/docs/architecture.md`
- ADR-046（全平台化可行性）、ADR-047（Android 可用性规划）、ADR-049（网页版桥接）
- 架构演进摘要：`docs/architecture-evolution-summary.md`
- ADR-129（预览域根升格）、ADR-159（容器语义）、ADR-160（组件口径统一）、ADR-161（渲染词汇章程）
