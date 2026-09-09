---
kind: directory_picker
name: 跨平台目录选择器
tier: leaf
category: utils
status: active
source_files:
  - frontend/src/backend/directory-picker.ts
auto_fields:
  symbols_with_lines:
    - DirPickResult
    - pickDirectory
    - resolveAndroidRepoDir
use_when:
  - 目录选择
  - 选择文件夹
  - Android 公共仓库目录
  - 网页版虚拟根
  - 授权引导
  - viewer 模式
pitfalls:
  - Android 无目录选择器（Wails V3 dialogs_android.go 拒绝、SAF 亦废弃）→ 只能授权检查 + 自动定位公共仓库目录，勿指望对话框
  - 网页版无系统目录对话框（browser adapter 的 SelectDirectory fail-fast 抛 WebUnsupportedError）→ 只定位虚拟根，勿调用桌面专属对话框
quick_groups:
  - 跨平台目录选择与路径解析
quick_intents:
  - 选择目录、SelectDirectory、Wails 对话框
  - 打开文件夹、导入文件夹、目录路径
  - Android 公共仓库目录、GetDefaultRepoRoot
  - 网页版虚拟根 /web
  - 存储授权、requestStoragePermission
quick_risk_lines:
  - 需要目录路径的场景必须经 directory-picker 统一入口（pickDirectory / resolveAndroidRepoDir），禁止各调用方自行实现授权引导或裸调桌面对话框
invariant_anchors:
  - frontend/src/backend/directory-picker.ts|pickDirectory
  - frontend/src/backend/directory-picker.ts|resolveAndroidRepoDir
---

# 跨平台目录选择器

## 概览

`frontend/src/backend/directory-picker.ts`（2026-09 自 `utils/dom/` 迁至 `backend/`，消除 utils→backend 反向依赖）：跨平台「要一个目录路径」的统一入口（ADR-046 P2、ADR-049 Phase 3）。三端三分支——桌面走 Wails 系统目录对话框（`SelectDirectory`）；Android 无选择器（Wails 官方拒绝 + SAF 废弃），走「授权检查 → 自动定位公共仓库目录」（`GetDefaultRepoRoot`）；网页版无对话框（browser adapter fail-fast），走定位虚拟根 `/web`。

**归位结论（2026-09 评估 + 迁移收口）**：本模块本质是 **Wails 绑定适配器**（import `backend/app.ts`/`backend/platform.ts`），永久不纳入 `src/core`（ADR-189 D4 准入逐条否决，详见下文「不变量」）；归宿 = `backend/`（与 platform 桥同目录），原「留守 utils/dom」结论随反向依赖治理作废。

## 核心职责

- **`pickDirectory()`**——统一门控入口：`isViewerMode()` 时委托 `resolveAndroidRepoDir()`（Android/网页版共用一条路径）；否则桌面走 `SelectDirectory()`（Wails Dialog）。
- **`resolveAndroidRepoDir()`**——查看器模式（Android/网页）目录解析专用入口：Android 未授权 → warn toast + `requestStoragePermission` 引导并返回 `null`；已授权 → `GetDefaultRepoRoot` 定位公共仓库目录 + info toast 返回路径；网页版 → 直接定位虚拟根 `/web`。
- 消费两枚 Wails 绑定：`SelectDirectory`（桌面对话框）、`GetDefaultRepoRoot`（Android/网页定位）。

## 对外 API / 入口

- `pickDirectory(): Promise<string | null>` — 跨平台选择目录：桌面 Wails Dialog；查看器模式委托 resolveAndroidRepoDir
- `resolveAndroidRepoDir(): Promise<string | null>` — Android 授权引导 → 定位公共仓库目录 / 网页版定位虚拟根 / 桌面返回 null（调用方自行走 Wails Dialog）

## 与其他子系统关系

- **调用方**（三处）：`app-content/settings/path-cards.ts`（设置页路径卡片）、`app-tree/toolbar-events.ts`（树「打开/导入文件夹」）、`app-sidebar/launcher-detect.ts`（启动器目录检测）
- **平台依赖**：`backend/app.ts`（`getApp` → `SelectDirectory`/`GetDefaultRepoRoot`）、`backend/platform.ts`（`getAndroidBridge`/`isViewerMode`）、`backend/platform-web.ts`（`isWebPlatform`）
- **UI 依赖**：`bus`（toast 反馈）、`core/i18n/t.ts`（文案）、`utils/dom/toast-ms.ts`（时长档）
- `docs/android-dev.md` 明示：目录/路径类按钮的 Android 分支统一复用 `resolveAndroidRepoDir()`

## 不变量

- **D4 不入 core（ADR-189 准入三条件逐条否决）**：①引擎无关 ✗——直接 `import { getApp } from "@/backend/app.ts"`（Wails 绑定）+ `getAndroidBridge`（平台桥）；②不依赖上层 ✗——`backend/` 恰是 D4 禁止直连的形状；③无 Wails 可单测 ✗——测试全靠 `vi.mock("@/backend/app.ts")`。它本质是平台适配 + 用户交互（弹系统框、发 toast、引导授权），强塞 core 需同时注入 getApp/toast/桥三依赖，收益为零；调用方（views 层）本应直调平台适配器。
- **现状合规（迁移后）**：D4 只约束 `core/`；directory-picker 现居 `backend/`（与 platform 桥同目录，ADR-203 D2 自 `utils/dom/android-bridge.ts` 并入的同层），静态 import `backend/*` 属同层内部引用，`utils/` 的「0 backend import」纯净边界随之不再被本文件触碰（该边界约束对象 = utils/3d，本就无涉）。
- 需要目录路径场景必须经本卡统一入口，禁止各调用方复制授权逻辑或裸调桌面对话框（web 端 fail-fast 即因绕过统一门控而炸过，ADR-049 Phase 3 收口）。

## 相关

- ADR-046（全平台化可行性）、ADR-049（网页版桥接 Phase 3 统一门控）、ADR-189 D4（core 准入准则）、ADR-203 D2（android-bridge 并入 platform.ts）
- 姊妹卡：[android-bridge](./android-bridge.md)（存储授权 + 返回键注册表）