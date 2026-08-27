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
tests:
  - internal/app/app_config_test.go
use_when:
  - Android
  - 平台守卫
  - RevealInExplorer
  - OpenFolder
  - RestartApplication
  - xdg-open
  - 重启
  - Node.js
  - sidecar
  - watcher
  - 平台隔离
  - build tag
invariant_anchors:
  - internal/app/app_files.go|runtime.GOOS
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
- **前端能力门控镜像**（capabilities.ts，2026-08 修）：`can(binding)` 的 `ANDROID_UNAVAILABLE` 黑名单 = 本卡桌面专属项的**前端并行镜像**。蓝本一致：`RevealInExplorer`/`OpenFolder`/`RestartApplication`（本卡显式拒绝）+ `ListVersionInstances`（无 MC 整合包扫描）。其余 Go binding 在 Android 授权公共目录下均读写可达（`os.*` 直读），前端**不得一刀切 false**——P3 后黑名单单一事实源移至 `backend/platform-web.ts`（`ANDROID_UNAVAILABLE` 导出），`capabilities.ts` 仅委托 `canBinding()`——判定范式变为三态矩阵：desktop 全量 / web adapter has 探测 / android 查黑名单。若 Go 侧新增桌面专属拒绝项，同步 `platform-web.ts` 黑名单，反之亦然。
- **PathManager**（pathmgr.go）：build-tag 双实现（desktop `os.UserConfigDir` / android 沙盒 + 公共仓库根），ADR-046 P2 参考 MikuMikuAR ADR-018
- **updater**：`InstallUpdate` 非 Windows 拒绝（ADR-033，`updater_other.go` stub）

## 不变量

- **失败必须可见**：Android 上不支持的桌面能力返回明确错误（含原因提示），禁止静默成功/空操作
- **build-tag 优先**：平台差异大的逻辑用 build-tag 双文件（编译期保证只含正确实现）；单点方法用 `runtime.GOOS` 分支即可
- **SAF 不复活**：Android 文件访问走 MANAGE_EXTERNAL_STORAGE + `os.*` 直读，禁止引入 content:// URI

## 相关

- ADR-047（平台守卫批量）、ADR-046（全平台化）、ADR-033（更新 Windows-only）
- `docs/knowledge/android-bridge.md`（前端门控）、`docs/knowledge/go-watcher.md`、`docs/knowledge/go-updater.md`
