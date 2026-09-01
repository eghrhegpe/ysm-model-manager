---
kind: android-bridge
name: Android 桥接层：存储授权 + 目录选择器
tier: architecture
category: core
source_files:
  - frontend/src/utils/dom/android-bridge.ts
  - frontend/src/utils/dom/directory-picker.ts
tests:
  - frontend/src/features/version-updater.test.ts
  - tests/test_android_bridge_contract.mjs
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - Android 存储授权、目录选择器
  - MANAGE_EXTERNAL_STORAGE、SAF、权限
quick_risk_lines:
  - Android 存储授权必须走 android-bridge 的 SAF 授权流程，禁止直接请求 MANAGE_EXTERNAL_STORAGE
pitfalls:
  - 直接请求 MANAGE_EXTERNAL_STORAGE → 新版 Android 拒绝、Google Play 下架；必须走 SAF
  - 目录选择未回传 URI → 后续访问失败；必须经 android-bridge 持久化 URI

use_when:
  - Android
  - 存储授权
  - 目录选择
  - MANAGE_EXTERNAL_STORAGE
  - SAF
invariant_anchors:
  - frontend/src/backend/platform.ts|requestStoragePermission
---

# Android 桥接层：存储授权 + 目录选择器

## 概览

Android 专属的 Java ↔ 前端桥（`WailsJSBridge` 以 `wails` 名注册到 WebView，桌面端无此桥返回 `null`）与跨平台目录选择器。解决 Android 上 Wails 官方**拒绝目录选择**（`dialogs_android.go` 硬编码不支持）与外部存储访问授权两大问题——**不采用 SAF document-tree URI**（MikuMikuAR ADR-194 已弃用，返回 content:// URI 而 Go `os.*` 不可读），改走 **MANAGE_EXTERNAL_STORAGE 全盘授权 + 自动定位公共仓库目录**（查看器模式固定路径）。

## 核心职责

- **`getAndroidBridge()`**（原语已下沉 backend/platform.ts，ADR-123 P3；android-bridge.ts 仅 re-export，消费路径不变）：类型安全返回 Java 桥（`hasStoragePermission` / `requestStoragePermission`），桌面端返回 `null`。类型断言用 `unknown` 收窄，无 `as any`（ADR-014）。
- **`resolveAndroidRepoDir()`**（directory-picker.ts）：Android 目录路径解析专用入口——未授权时 warn toast + `requestStoragePermission` 引导授权并返回 `null`；已授权时 `GetDefaultRepoRoot` 定位公共仓库目录 + info toast 返回路径。设置页路径卡片与树「导入文件夹」统一复用。
- **`pickDirectory()`**（directory-picker.ts）：跨平台统一入口——桌面走 Wails Dialog（`SelectDirectory`）；Android 有桥时委托 `resolveAndroidRepoDir()`。
- **共享复用**：`loader.ts` 库加载失败引导授权、`version-updater.ts` 平台门控、`toolbar-events.ts` 导入文件夹均引用此桥，避免重复实现。
- **`registerAndroidBackHandler`**（android-bridge.ts，ADR-057 新增）：返回键注册表，对齐 MikuMikuAR `handleAndroidBack`。实际链路：`MainActivity.handleBackPressed()` → `bridge.emitEvent("android:back")` → `android-events.ts` 的 `Events.On("android:back")` → `emitAndroidBack()`；注册的 handler 按栈顶优先询问，返回 `true`（已消费）即短路。3D 预览 overlay 打开时注册消费返回键关层，否则透传。

## 对外 API / 入口

- `getAndroidBridge(): WailsAndroidBridge | null` — 返回桥或 null（Android 判定手段，全前端统一用它做平台门控）
- `WailsAndroidBridge`（定义于 platform.ts）— `hasStoragePermission?()` / `requestStoragePermission?()` 可选方法（桌面端不存在）
- `resolveAndroidRepoDir(): Promise<string | null>` — Android 目录解析：授权引导 → 定位公共仓库目录（未授权返回 null）
- `pickDirectory(): Promise<string | null>` — 跨平台选择目录；桌面 Wails Dialog，Android 委托 resolveAndroidRepoDir
- `registerAndroidBackHandler(handler: () => boolean | void): () => void` — 注册返回键消费回调，返回注销函数（ADR-057）
- `emitAndroidBack(): boolean` — 触发返回键处理链，返回是否已被消费（由 android-events.ts 在收到 `android:back` 事件时调用）

## 与其他子系统关系

- **Java 层**：`build/android/app/src/main/java/com/wails/app/MainActivity.java`（`hasStoragePermission`/`requestStoragePermission` 实现 + `MANAGE_STORAGE_REQUEST` 请求码）
- **目录选择调用方**：`app-content/settings/init.ts`（设置页路径卡片）、`app-tree/toolbar-events.ts`（导入文件夹）——统一复用 `resolveAndroidRepoDir`，禁止各调用方复制授权逻辑
- **平台门控消费**：`features/version-updater.ts` 用 `getAndroidBridge()` 判断 Android 跳过自动更新（ADR-047）
- **PathManager**（Go 侧）：`pathmgr_android.go` 的 `DefaultRepoRoot()` 返回 `/storage/emulated/0/YSM-Model-Manager`，授权后 `os.*` 直读

## 不变量

- **桌面端零影响**：无 `wails` 桥时 `getAndroidBridge()` 恒 `null`，所有门控/兜底路径不触发
- **不碰 SAF**：禁止引入 `DocumentFile` / `content://` URI 读写（历史踩坑，MikuMikuAR ADR-194 废弃）
- **isViewerMode ≠ 网页版**：`isViewerMode()`（有 Java 桥或 `resolveWebMode()`）与 `resolveWebMode()`（仅网页版）语义不同，**不可互换**。设置页 FSA 授权卡(`stg-web-repo-card`/`web-repo-auth-btn`)只该由 `resolveWebMode()` 渲染——它依赖 `showDirectoryPicker`(仅浏览器)。Android 虽为 viewer(mcRoot 缺位等),但走 Java 桥 `requestStoragePermission` + `resolveAndroidRepoDir`(本地路径卡),渲染 FSA 卡会报「浏览器不支持 FSA」(Android WebView 无 `showDirectoryPicker`)。tpl-settings 的 `isViewer`(游戏根/链接卡)与 `isWebViewer`(FSA 卡)两层判断即此约定(2026-08 修)
- **类型安全**：桥访问不得用 `as any`（用 `unknown` 收窄）
- **Java↔JS 桥契约（tests/test_android_bridge_contract.mjs 锁定）**：① MainActivity `addJavascriptInterface` 必须先于 `loadUrl`——页面首行 JS 起桥已可见，无冷启动竞态（桌面 WebView2 异步注入才有此问题）；调换顺序 → 前端启动期探测假阴性。② 被 JS 探测的方法必须带 `@JavascriptInterface`（API 17+ 未注解 public 方法不暴露，静默失败）。③ ProGuard keep WailsJSBridge/WailsBridge，防 release 剥离。④ 注册名 `"wails"` 与前端探测目标一致（上游 runtime_android.go 对齐：window.wails.invoke）。重构注入方式须同步该测试并重新论证首帧可用性
- **目录解析唯一入口**：Android「需要目录路径」场景统一走 `resolveAndroidRepoDir`，禁止各调用方自行实现授权引导
- **返回键注册表（ADR-057）**：handler 按栈顶优先（后注册先询问）；返回 `true` 即视为已消费并短路后续；桌面端无 `android:back` 事件，返回键逻辑恒不触发（零影响）；Android 端由 `MainActivity → android:back → emitAndroidBack()` 接通，注册表不再依赖原生桥直接调用

## 相关

- ADR-046（全平台化可行性）、ADR-047（Android 可用性落地规划）、ADR-057（3D 预览悬浮触发按钮与双端响应式控制层，返回键钩子）
- `docs/knowledge/android-events.md`、`docs/knowledge/go-android-platform-guard.md`、`docs/knowledge/pathmgr`（若存在）

---

## 调研快照：安卓 MC 启动器游戏目录适配（2026-08-13）

> 缘起：设想「走获取已安装应用列表自动发现游戏目录」以适配安卓 MC 启动器。结论：**此路线不成立**，记录以备后续取用。

### 关键结论（三前提两不成立一不稳固）
1. **Wails v3 不暴露查询已安装应用的 Go API** —— 已查 `application_android.go`（master/v3）全量函数：Java 桥仅转发 `isDarkMode`/生命周期/`executeJavaScript` 等通用方法；系统事件白名单仅 `BatteryChanged`/`NetworkChanged`/`ThemeChanged`/`ScreenLocked`/`ScreenUnlocked`；无 `getInstalledPackages`/PackageManager 接口。要支持须**自改 wails Java 层 `WailsBridge`** 新增方法再经 `androidBridgeString` 暴露，非前端 binding 可绕。
2. **启动器游戏目录碎片化且高版本在私有沙盒** ——
   - PojavLauncher：Android 9- 为 `/storage/emulated/0/games/PojavLauncher/.minecraft`；Android 10+ scoped storage 后该目录被应用私有沙盒吞掉，跨应用读需 Shizuku/ZArchiver。
   - HMCL-PE / Zalith：游戏目录在各自应用内部存储，不落公共 sdcard 根，**跨应用不可读**。
3. **`MANAGE_EXTERNAL_STORAGE` 仍读不到别的包** —— Android 11+ 彻底封锁 `/Android/data/<pkg>/` 跨包访问，即便持有全盘权限也无效（除非 Shizuku/root）。

### 推荐适配路线（最小正确，非自动发现）
- **放弃 PackageManager 自动发现**（wails 不支持 + scoped storage 锁死）。
- 放开设置页 `mcRoot` 卡片：安卓 `getAndroidBridge()` 存在时重新显示（当前被刻意隐藏，见 android-dev.md 坑点表「设置页游戏根目录卡片 已修」），复用 `resolveAndroidRepoDir` 授权引导让用户指向**公共可写目录**。
- 强约定：引导用户把启动器游戏目录经其自身设置「迁移/指向」到 `/storage/emulated/0/YSM-Model-Manager/minecraft` 等公共路径，Go 端授权后 `os.*` 直读直写。
- 适配量 ≈ 数百行前端（放开卡片 + 引导文案 + 路径校验），**零 Java/wails 改动**。

### 待办（未实施）
- [ ] 查 `settings/init.ts` 与 `app_config_android.go` 中 mcRoot 卡片的 Android 隐藏守卫，出最小放开方案。
- [ ] 评估引导文案 i18n（zh-CN/en/ja）新增键。
