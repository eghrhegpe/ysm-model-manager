# Android 开发手册（ADR-046 P2）

> 面向在 ysm-model-manager 上做 Android 适配的开发者（人类 + AI）。本手册是 Android 开发的**枢纽总览**：
> 决策看 [ADR-046](adr/ADR-046-cross-platform-feasibility.md)，实现细节看知识卡
> （[android-bridge](knowledge/android-bridge.md) / [android-events](knowledge/android-events.md) /
> [go-android-platform-guard](knowledge/go-android-platform-guard.md) / [wails-bridge](knowledge/wails-bridge.md)），
> 本页收拢**现状快照、双端桥机制、按钮适配清单、构建链路、坑点速查**。

## 平台定位（查看器模式）

Android 端模型仓库 = **公共目录固定路径**（`internal/app/pathmgr_android.go` `DefaultRepoRoot()`）：
外部存储根 + `YSM-Model-Manager`（兜底 `/storage/emulated/0/YSM-Model-Manager`）。授权
`MANAGE_EXTERNAL_STORAGE`（Android 11+）后 Go `os.*` 直读，用户把模型放入该目录即自动出现在仓库
列表——**目录选择器在 Android 被有意放弃**（见「为什么没有目录选择器」）。

## 双端桥机制

| 方向 | 通道 | 实现 |
|------|------|------|
| JS → Java | `window.wails.*`（`addJavascriptInterface` 注册） | `WailsJSBridge.java`；前端唯一入口 `getAndroidBridge()`（`frontend/src/backend/platform.ts`，ADR-203 D2 并入；桌面无桥返回 null） |
| Java → JS | `bridge.emitEvent` → JNI `nativeEmitEvent` → Wails **CustomEvent** 通道（**勿用 `emitSystemEvent`，后者仅达 Go 侧、永不到前端**） | 前端 `Events.On(...)`（`@wailsio/runtime`），集中消费在 `frontend/src/core/handlers/android-events.ts` |

「目录/路径类」按钮的 Android 分支**统一复用** `resolveAndroidRepoDir()`（`frontend/src/utils/dom/directory-picker.ts`）——
授权引导 + 定位公共仓库目录 + toast 提示路径，禁止各调用方自行复制该逻辑。

## 按钮级适配清单

| 按钮 | 桌面 | Android | 实现位置 |
|------|------|---------|---------|
| 设置页「选择目录」 | Wails Dialog | `resolveAndroidRepoDir`（授权引导 → 定位公共仓库） | `directory-picker.ts` / `settings/init.ts` |
| 树「📁 导入文件夹」 | `SelectDirectory` + `ImportByType` | `resolveAndroidRepoDir`（查看器模式公共目录即仓库） | `toolbar-events.ts` |
| 树「📂 打开文件夹」 | `OpenFolder` | `resolveAndroidRepoDir`（提示路径，不调 Go 守卫报错） | `toolbar-events.ts` |
| 树「📁 导入文件」 | `SelectImportFile` | **官方桥可用**（`launchFilePicker` → `ACTION_OPEN_DOCUMENT` 多选 → 复制到缓存 → Go 读真实路径） | — |
| 导入 tab 文件选择（`<input type="file">`） | 浏览器原生 | `WebChromeClient.onShowFileChooser`（`MainActivity`）→ `ACTION_GET_CONTENT` 多选 | 前端 `FileReader`→base64 流不变 |
| 版本更新 | Windows 自更新 | `getAndroidBridge()` 守卫跳过 + 提示 Windows 专属 | `version-updater.ts` |

## 存储授权闭环

```
按钮点击 → requestStoragePermission()（JS→Java 桥）
  → MainActivity AlertDialog → 系统授权页（ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION）
  → 授权返回 → onResume / onActivityResult 检测新授予
  → storage:permissionGranted（Java→JS 事件）
  → 前端 tree:reload + stats:refresh（android-events.ts）
```

## 系统事件（Java → JS）

| 事件 | 触发 | 消费 |
|------|------|------|
| `android:back` | 返回键（首按提示、2s 内再按退出） | 先关活动弹窗（`closeActiveDialog`），无弹窗再提示 |
| `android:ScreenLocked` / `android:BatteryChanged` / `android:ThemeChanged` | 预留扩展点 | 空消费（注册即未来可消费） |
| `android:NetworkChanged` | 网络状态变化 | 断连提示（下载/工坊依赖网络） |
| `storage:permissionGranted` | 存储授权新授予 | 重扫模型库（tree:reload + stats:refresh） |

## 构建（一键脚本 + Windows 宿主实测链路）

> ✅ **一键**：`node scripts/android-build.mjs`（前端 vite build → NDK 交叉编译 libwails.so
> → gradle assembleDebug 全链路；`--arch all` fat APK / `--arch amd64` 模拟器 / `--production`
> 生产版 / `--skip-frontend` 只重编 Go+gradle）。Windows/macOS/Linux 宿主通用，NDK 自动探测。
> 装到设备：`node scripts/android-install.mjs`（adb installDebug + 拉起；⚠️ 它不重编 Go，
> 装前先跑 android-build）。
>
> ⚠️ `build/android/Taskfile.yml` 的 `compile:go:shared` 只支持 Darwin/Linux 宿主
> （Windows 报 `Unsupported host OS`），Windows 手动链路（android-build.mjs 内部等价）如下
> （2026-08 实测通过）：

```bash
# 1. Go 交叉编译 arm64（NDK clang 无后缀可执行文件直接作 CC）
CC="C:/Android/Sdk/ndk/<VER>/toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android21-clang" \
CGO_ENABLED=1 GOOS=android GOARCH=arm64 \
go build -buildmode=c-shared -overlay build/android/overlay.json -tags android,debug \
  -o build/android/app/src/main/jniLibs/arm64-v8a/libwails.so

# 2. 打包 APK（Java 17+；本机 JDK 21 可用）
cd build/android && ./gradlew.bat assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

前置：`ANDROID_HOME`（本机 `C:\Android\Sdk`）+ NDK 26.3 + platform android-34 + Java 17+。

## 为什么没有目录选择器

Wails v3 官方 `dialogs_android.go` **明确拒绝 Android 目录选择**（SAF 返回 `content://` URI 而非文件
系统路径，Go `os.*` 不可读；姊妹项目 MikuMikuAR ADR-194 亦废弃 SAF）。故 Android 采用「授权 +
自动定位公共目录」的查看器模式（ADR-046 决策），而不是 SAF 目录选择。

## 坑点速查

| 坑 | 说明 |
|----|------|
| `FileChooserParams.MODE_OPEN_DIRECTORY` **不存在** | android-34 API 仅 `MODE_OPEN` / `MODE_OPEN_MULTIPLE` / `MODE_SAVE`，引用即编译失败 |
| 平台数据根缺失时 `configDir()`/`configPath()` 退化相对路径 | **已修**：`appDataRoot()` 为空 → 返回空串 + `saveConfig` fail-fast（曾导致 `mkdir YSM-Model-Manager: read-only file system`——CWD=/ 只读）；守卫见 `TestConfigDir_NoRelativeFallback` |
| 设置页游戏根目录/链接模式卡片 | **已修**：Android（`getAndroidBridge()` 存在）`settingsHTML` 隐藏两卡片（无 Minecraft Java 版/无整合包概念，查看器模式）；相关绑定均有 null 守卫 |
| 平台数据根缺失时 `configDir()`/`configPath()` 退化相对路径 | **已修**：`appDataRoot()` 为空 → 返回空串 + `saveConfig` fail-fast（曾导致 `mkdir YSM-Model-Manager: read-only file system`——CWD=/ 只读）；守卫见 `TestConfigDir_NoRelativeFallback` |
| 设置页游戏根目录/链接模式卡片 | **已修**：Android（`getAndroidBridge()` 存在）`settingsHTML` 隐藏两卡片（无 Minecraft Java 版/无整合包概念，查看器模式）；相关绑定均有 null 守卫 |
| WebView 默认无 `onShowFileChooser` | `<input type="file">` 点击静默无反应（已修：MainActivity 自制，`onActivityResult` 单例回调防悬挂） |
| `webkitdirectory` 不生效 | Android WebView 不支持目录选择；`dl-folder-input` 在触屏不可达（Ctrl+点击），无需处理 |
| 外链导航被 WebView 吞掉 | 已修：`shouldOverrideUrlLoading` → 非 wails.localhost 抛系统浏览器 `ACTION_VIEW` |
| Android 13+ 返回键弃用 `onBackPressed` | 预测性返回：manifest `enableOnBackInvokedCallback="true"` + `OnBackInvokedDispatcher`（低版本仍走 `onBackPressed` 覆写） |
| 配置/标签落盘 | `AppDataRoot` 优先沙盒私有目录（Android 上唯一可靠落点），禁止退化为文件系统根 `/` |
| Java→JS 系统事件必须走 `emitEvent`（CustomEvent）而非 `emitSystemEvent`（ApplicationEvent） | wails v3.0.0-alpha2.105 中 `emitSystemEvent` 仅投 Go 侧 `applicationEvents` 通道、永不到达 WebView；白名单 `androidSystemEventTypes` 也不含 `android:back`/`storage:permissionGranted`（命中即被丢弃）。**后果（P1-1，已修）**：返回键提示/存储授权重扫/断网提示全部失效。修复：`MainActivity.java` 9 处 `emitSystemEvent` 全改 `emitEvent`；回归测试 `frontend/src/core/handlers/android-events.test.ts` |

## 相关

- [ADR-046 全平台化可行性调查](adr/ADR-046-cross-platform-feasibility.md)
- 知识卡：[android-bridge](knowledge/android-bridge.md) / [android-events](knowledge/android-events.md) / [go-android-platform-guard](knowledge/go-android-platform-guard.md) / [wails-bridge](knowledge/wails-bridge.md)
- Go 平台隔离：`internal/app/pathmgr_*.go`（build tags：desktop / android 双实现）
- Android 工程：`build/android/`（gradle + Java 源码 + Taskfile）
