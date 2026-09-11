---
kind: go-android-platform-guard
name: Android 平台守卫（Go 侧）
tier: architecture
category: go
source_files:
  - internal/app/app_files.go
  - internal/app/app_scan.go
  - internal/app/app_config.go
  - internal/app/wasm_decoder.go
  - internal/app/app.go
  - internal/app/app_config_android.go
  - internal/app/pathmgr_android.go
auto_fields:
  symbols_with_lines:
    - App
    - App.CheckFileExists
    - App.CheckUpdate
    - App.ClearScanCache
    - App.CopyModelFile
    - App.CreateDir
    - App.CurrentVersion
    - App.DoUpdate
    - App.ExportModelStructureJSON
    - App.ExtractPreviewTexture
    - App.FindPreviewImage
    - App.GenerateRepoIndex
    - App.GetAppVersion
    - App.GetConfigPath
    - App.GetMinecraftPaths
    - App.GetPackInfo
    - App.GetSubDirMap
    - App.GetWindowPosition
    - App.GetYSMRepoRoot
    - App.ImportModelFolder
    - App.ImportModelFolderTo
    - App.IsFileBanned
    - App.ListAllFilePaths
    - App.ListFileNames
    - App.ListModelAuthors
    - App.ListVersionInstances
    - App.LoadAppConfig
    - App.MoveModelFile
    - App.OpenFolder
    - App.OpenInBrowser
    - App.OpenInstanceFolder
    - App.RemoveDir
    - App.RenameDir
    - App.RenameFile
    - App.RestartApplication
    - App.RevealInExplorer
    - App.SaveAppConfig
    - App.SaveThresholds
    - App.SaveWindowPosition
    - App.ScanLocalAuthors
    - App.ScanModelEntries
    - App.ScanModelEntriesFiltered
    - App.ScanModelEntriesWithLabel
    - App.SearchModels
    - App.SelectDirectory
    - App.ServiceShutdown
    - App.ServiceStartup
    - App.SetApp
    - App.SetDownloadMirror
    - App.SetMainWindow
    - App.SetSessionFilesRoot
    - App.ToggleEnable
    - App.ToggleModelEnable
    - App.ValidateMinecraftDir
    - AppDataRoot
    - DefaultRepoRoot
    - NewApp
  tests:
    - internal/app/app_config_test.go
quick_intents:
  - Android 平台守卫、RevealInExplorer/OpenFolder 降级、文件浏览失败处理
  - 跨平台路径处理、pathmgr
  - 平台分支差异：WASM decoder / 进程重启 / Node.js sidecar 禁用、build-tag 双文件隔离
  - watcher 监听跳过、fsnotify 平台限制
  - SAF 废弃、MANAGE_EXTERNAL_STORAGE 权限模型、前端黑名单同步（ANDROID_UNAVAILABLE）

pitfalls:
  - 「静默成功」陷阱：Android 上 xdg-open/exec 链静默失败会掩盖问题 → 必须返回含「请手动」提示的明确错误
  - 「假活」陷阱：watcher 守卫缺失时，fw.Add 逐目录失败后 loop 空转 = running=true 假活；Android 必须直接跳过
  - 「一刀切」陷阱：把 RevealInExplorer/OpenFolder 等绑定全部 false → 应仅在 ANDROID_UNAVAILABLE 黑名单内才禁
  - 「content:// URI」陷阱：误引入 SAF/URI 桥 → SAF 已弃用，禁止复活
  - 「build-tag 混用」陷阱：平台差异大的逻辑用 runtime.GOOS 分支 → 应用 build-tag 双文件保证编译期隔离
  - 「路径管理混乱」陷阱：Android 沙盒私有目录与公共仓库根混用 → androidPathManager 严格分离
  - 「前端/后端黑名单不同步」陷阱：Go 新增桌面专属拒绝项未同步 platform-web.ts → 三谓词测试 platform-parity.test.ts 会爆
  - 「重启假设」陷阱：Android 上调用 os.Executable + exec.Command → Activity 生命周期不兼容，显式拒绝
use_when:
  - Android、平台守卫
  - RevealInExplorer / OpenFolder / xdg-open
  - SAF / MANAGE_EXTERNAL_STORAGE
  - build-tag
  - pathmgr
  - RestartApplication / 重启
  - Node.js
  - watcher 守卫 / fsnotify

quick_groups:
  - 后端桥接与数据存储
status: active

invariant_anchors:
  - internal/app/app_files.go|CopyModelFile
  - internal/app/app_scan.go|CheckFileExists
  - internal/app/app_config.go|CheckUpdate
---
# Android 平台守卫（Go 侧）

## 概览

ADR-047「平台守卫批量」：Go 侧对 Android 上**无效或不适用的桌面能力**显式拒绝/降级，避免 `xdg-open`/`exec` 链静默失败（错误分类反模式——失败要可见）。结合既有的 build-tag 平台双文件（`pathmgr_desktop.go`/`pathmgr_android.go`、`app_config_other.go`/`app_config_android.go`）构成完整平台隔离面。

## 核心职责

- **`RevealInExplorer`**（app_files.go）：`runtime.GOOS == "android"` 返回明确错误（SAF 已弃用，无 content:// URI 桥）；Windows→`explorer /select,`、macOS→`open -R`、Linux→`xdg-open` 退化
- **`OpenFolder`**（app_scan.go）：Android 返回明确错误；其余同桌面 switch
- **`RestartApplication`**（app_config.go）：Android 进程模型不同（Activity 生命周期），`os.Executable` + `exec.Command` + `Quit` 链不适用，显式拒绝
- **`findNodeJS`**（wasm_decoder.go）：Android 无 Node.js 运行时，提前返回空串（`.ysm` 预览走 WASM 内嵌解码，node sidecar 解码不可用但不报错）
- **watcher 守卫**（app.go ServiceStartup）：Android 运行时直接跳过文件监听器启动（`runtime.GOOS != "android"` 守卫）——fsnotify 经 sdcardfs/FUSE 事件不完整（ADR-047 明示），`fw.Add` 逐目录失败后 loop 空转 = `running=true` 静默假活；Android 以手动刷新/重扫为准，不做轮询兜底
- **既有 build-tag 面**：`scanMinecraftDirsPlatform` Android 空实现（`.minecraft` 探测无意义）、`androidPathManager` 沙盒私有目录 + `DefaultRepoRoot()` 公共仓库根

## 对外 API / 入口

- `RevealInExplorer(path string) error` / `OpenFolder(dir string) error` / `RestartApplication() error` — Android 分支返回带「请手动」提示的明确错误
- `findNodeJS() string` — Android 恒空串

## 与其他子系统关系

- **前端**：`getAndroidBridge()` 平台门控（version-updater 跳过更新）与 Go 侧守卫互补——前端先行过滤，Go 侧兜底拒绝
- **前端能力门控镜像**（capabilities.ts，2026-08 修）：`can(binding)` 的 `ANDROID_UNAVAILABLE` 黑名单 = 本卡桌面专属项的**前端并行镜像**。蓝本一致：`RevealInExplorer`/`OpenFolder`/`RestartApplication`（本卡显式拒绝）+ `ListVersionInstances`（无 MC 整合包扫描）。其余 Go binding 在 Android 授权公共目录下均读写可达（`os.*` 直读），前端**不得一刀切 false**（P3 审核补强：黑名单迁至 `backend/platform-web.ts` 后，三谓词等价关系由 `platform-parity.test.ts` 12 组合全扫锁死——`resolveWebMode()===mode==='web'`、`isViewerMode()===mode!=='desktop'`；改任何 Tier 判定前先跑该测试）——P3 后黑名单单一事实源移至 `backend/platform-web.ts`（`ANDROID_UNAVAILABLE` 导出），`capabilities.ts` 仅委托 `canBinding()`——判定范式变为三态矩阵：desktop 全量 / web adapter has 探测 / android 查黑名单。若 Go 侧新增桌面专属拒绝项，同步 `platform-web.ts` 黑名单，反之亦然。
- **PathManager**（pathmgr.go）：build-tag 双实现（desktop `os.UserConfigDir` / android 沙盒 + 公共仓库根），ADR-046 P2 参考 MikuMikuAR ADR-018
- **updater**：`InstallUpdate` 非 Windows 拒绝（ADR-033，`updater_other.go` stub）

## 不变量

- **失败必须可见**：Android 上不支持的桌面能力返回明确错误（含原因提示），禁止静默成功/空操作
- **build-tag 优先**：平台差异大的逻辑用 build-tag 双文件（编译期保证只含正确实现）；单点方法用 `runtime.GOOS` 分支即可
- **SAF 不复活**：Android 文件访问走 MANAGE_EXTERNAL_STORAGE + `os.*` 直读，禁止引入 content:// URI
- **守卫信号即事实源**：新增桌面专属拒绝项时，Go 侧写的 `runtime.GOOS == "android"` / `case "android":` 就是机器可读的登记信号——写守卫即被 `check-android-unavailable.ts` 的 T2 自动捕获，无需另找人同步前端名单

## 黑名单同步守卫（scripts/check-android-unavailable.ts）

本卡「前端/后端黑名单不同步」陷阱的机器化防线。初版（2026-09-04）只比对脚本内硬编码
`KNOWN_DESKTOP_ONLY` 常量集合，与真实 binding 全集零交集校验 → **「新增未登记桌面 binding」
恒不可达**（条件不可达缺陷）；且 bindings 缺失时 ENOENT → exit 0 静默放行。2026-09-08
换轨为 Go 源码派生的四级事实源：

| 层 | 事实源 | 强度 |
|----|--------|------|
| T0 | `frontend/bindings/.../app.ts` 为 git 入库文件，缺失 = 异常 | 硬失败（`--allow-missing` 逃生） |
| T1 | Android GOOS 构建集与默认 GOOS 的文件差集（命令见下） → 差集内 `*App` 方法 | 硬失败 |
| T2 | desktop 构建集内 `*App` 方法体出现 `runtime.GOOS == "android"` / `case "android":`（ADR-047 守卫） | 硬失败 |
| T3 | 真实 binding 全集 × 桌面语义正则（Plaza / Select* / Minecraft / Explorer / Restart / Window* …） | 提示 |
| T4 | Stale（黑名单项已从 bindings 消失）+ `platform-web.test.ts` 硬编码副本漂移 + 基线回退 | 提示 |

T1 差集命令（fenced block 免受 Vue `{{}}` 插值影响，勿移入表格单元格）：

```sh
GOOS=android go list -f '{{.GoFiles}}' ./internal/app/
```

要点：
- **go 不可用 → 降级**（`_summary.degraded=true`，仅跑 T3/T4），**不静默 exit 0**——旧版 ENOENT 分支的教训。
- T2 只认「等于 android」的守卫，不认 `!= "android"` 的桌面正向分支（如 watcher 守卫），并跳过注释行，防误报。
- 实测：173 bindings / 19 黑名单，T2 精确命中 `RevealInExplorer`/`OpenFolder`/`RestartApplication`（与本卡三处守卫一一对应）；T3 仅 3 条合理提示（`GetWindowPosition`/`SaveWindowPosition`/`SaveScreenshotFile`）。
- 挂载：pre-commit 阻断段 + `scripts/_lib/gate-config.ts` 的 `ALL_STATIC_TOOLS`（doctor 全量）。契约测试 `tests/test_check_android_unavailable.ts`。

## 相关

- ADR-047（平台守卫批量）、ADR-046（全平台化）、ADR-033（更新 Windows-only）
- `docs/knowledge/android-bridge.md`（前端门控）、`docs/knowledge/go-watcher.md`、`docs/knowledge/go-updater.md`
- `scripts/check-android-unavailable.ts`（黑名单守卫，见上节）、`tests/test_check_android_unavailable.ts`
