---
kind: android_bridge
name: Android 桥接层：存储授权 + 目录选择器
tier: architecture
category: core
source_files:
  - frontend/src/utils/dom/android-bridge.ts
  - frontend/src/utils/dom/directory-picker.ts
tests:
  - frontend/src/features/version-updater.test.ts
use_when:
  - Android
  - 存储授权
  - 目录选择
  - MANAGE_EXTERNAL_STORAGE
  - 权限
  - 选择目录
  - SAF
  - android-bridge
  - pickDirectory
invariant_anchors:
  - frontend/src/utils/dom/android-bridge.ts|requestStoragePermission
---

# Android 桥接层：存储授权 + 目录选择器

## 概览

Android 专属的 Java ↔ 前端桥（`WailsJSBridge` 以 `wails` 名注册到 WebView，桌面端无此桥返回 `null`）与跨平台目录选择器。解决 Android 上 Wails 官方**拒绝目录选择**（`dialogs_android.go` 硬编码不支持）与外部存储访问授权两大问题——**不采用 SAF document-tree URI**（MikuMikuAR ADR-194 已弃用，返回 content:// URI 而 Go `os.*` 不可读），改走 **MANAGE_EXTERNAL_STORAGE 全盘授权 + 手动输入绝对路径**。

## 核心职责

- **`getAndroidBridge()`**（android-bridge.ts）：类型安全返回 Java 桥（`hasStoragePermission` / `requestStoragePermission`），桌面端返回 `null`。类型断言用 `unknown` 收窄，无 `as any`（ADR-014）。
- **`pickDirectory()`**（directory-picker.ts）：统一目录选择入口——桌面走 Wails Dialog（`CanChooseDirectories`），Android 走「授权检查 → `modalPrompt` 输入绝对路径」（授权后 `os.*` 可直读任意路径）。
- **共享复用**：`loader.ts` 库加载失败引导授权、`version-updater.ts` 平台门控、`directory-picker.ts` 均引用此桥，避免重复实现。

## 对外 API / 入口

- `getAndroidBridge(): WailsAndroidBridge | null` — 返回桥或 null（Android 判定手段，全前端统一用它做平台门控）
- `WailsAndroidBridge` — `hasStoragePermission?()` / `requestStoragePermission?()` 可选方法（桌面端不存在）
- `pickDirectory(): Promise<string | null>` — 选择目录；Android 未授权时引导授权并返回 `null`

## 与其他子系统关系

- **Java 层**：`build/android/app/src/main/java/com/wails/app/MainActivity.java`（`hasStoragePermission`/`requestStoragePermission` 实现 + `MANAGE_STORAGE_REQUEST` 请求码）
- **目录选择调用方**：`app-content/settings/community.ts`（设置页路径卡片）——替代原 `SelectDirectory` 直调
- **平台门控消费**：`features/version-updater.ts` 用 `getAndroidBridge()` 判断 Android 跳过自动更新（ADR-047）
- **PathManager**（Go 侧）：`pathmgr_android.go` 的 `DefaultRepoRoot()` 返回 `/storage/emulated/0/YSM-Model-Manager`，授权后 `os.*` 直读

## 不变量

- **桌面端零影响**：无 `wails` 桥时 `getAndroidBridge()` 恒 `null`，所有门控/兜底路径不触发
- **不碰 SAF**：禁止引入 `DocumentFile` / `content://` URI 读写（历史踩坑，MikuMikuAR ADR-194 废弃）
- **类型安全**：桥访问不得用 `as any`（用 `unknown` 收窄）

## 相关

- ADR-046（全平台化可行性）、ADR-047（Android 可用性落地规划）
- `docs/knowledge/android_events.md`、`docs/knowledge/android_platform_guard.md`、`docs/knowledge/pathmgr`（若存在）
