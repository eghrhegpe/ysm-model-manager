---
kind: android-events
name: Android 系统事件消费（back/网络/存储授权）
tier: architecture
category: core
source_files:
  - frontend/src/core/handlers/android-events.ts
auto_fields:
  symbols_with_lines:
    - registerAndroidEvents
  tests:
    - frontend/src/features/dialogs/modal.test.ts
  quick_groups:
    - 后端桥接与数据存储
  quick_intents:
    - android:back 返回键、弹窗退出
    - ScreenLocked、NetworkChanged、permissionGranted
    - closeActiveDialog、registerAndroidEvents
  quick_risk_lines:
    - Android 系统事件必须经 android-events 的 registerAndroidEvents 单点注册，禁止各组件各自注册
  pitfalls:
    - 各组件各自注册 → 重复监听、返回键冲突；必须经 registerAndroidEvents
    - 返回键未消费 → 直接退出应用；必须在有弹窗时 consume back 事件
  use_when:
    - android:back
    - 返回键
    - 弹窗
    - 系统事件
    - ScreenLocked
    - NetworkChanged
  invariant_anchors:
    - frontend/src/core/handlers/android-events.ts|registerAndroidEvents
tests:
  - frontend/src/features/dialogs/modal.test.ts
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - android:back 返回键、弹窗退出
  - ScreenLocked、NetworkChanged、permissionGranted
  - closeActiveDialog、registerAndroidEvents
quick_risk_lines:
  - Android 系统事件必须经 android-events 的 registerAndroidEvents 单点注册，禁止各组件各自注册
pitfalls:
  - 各组件各自注册 → 重复监听、返回键冲突；必须经 registerAndroidEvents
  - 返回键未消费 → 直接退出应用；必须在有弹窗时 consume back 事件

use_when:
  - android:back
  - 返回键
  - 弹窗
  - 系统事件
  - ScreenLocked
  - NetworkChanged
invariant_anchors:
  - frontend/src/core/handlers/android-events.ts|registerAndroidEvents
status: active
---

# Android 系统事件消费（back/网络/存储授权）

## 概览

前端消费 Java 层经 Wails 事件总线转发的 `android:*` 系统事件（ADR-046 P2，参照 MikuMikuAR ADR-017 A3-04）。桌面端无 Java 层，这些事件永不触发，注册无害。生命周期由 `registerGlobalHandlers` 聚合，随 app-content 卸载清理。

## 核心职责

- **`android:back` 返回键**（ADR-047 核心）：先关活动弹窗再提示退出——触屏无 Esc，由 back 事件桥接。`closeActiveDialog()` 关闭成功则本次返回被消费（不提示退出）；无弹窗时才 toast「再按一次返回退出应用」。Java 侧双击返回（2s 内）真正退出（`MainActivity.handleBackPressed`，API 33+ 经 OnBackInvokedDispatcher 预测性返回，低版本走 onBackPressed 覆写）。
- **`storage:permissionGranted`**：用户在设置页开启「所有文件访问」后返回，重扫模型库（`tree:reload` + `stats:refresh`）。
- **`android:NetworkChanged`**：断连提示（社区下载/工坊加载依赖网络）。
- **`android:ScreenLocked/Unlocked`、`android:BatteryChanged`、`android:ThemeChanged`**：预留扩展点（与 MikuMikuAR A3-04 对齐）。

## 对外 API / 入口

- `registerAndroidEvents(unsubs: Array<() => void>): void` — 注册全部消费，push 取消订阅函数到 unsubs

## 与其他子系统关系

- **Java 层**：`MainActivity.java` `emitEvent("android:back", "{}")`（首次按下时发，走 CustomEvent 通道；**勿用 `emitSystemEvent`，不到前端**）/ `handleBackPressed` 双击退出逻辑（API 33+ OnBackInvokedDispatcher，低版本 onBackPressed）/ `onResume` 检测新授权发 `storage:permissionGranted`
- **modal.ts**：`closeActiveDialog()` 关闭活动弹窗（`closable` 语义——进度弹窗 `closable=false` 时 back 不强关）
- **app-content**：`_registerGlobalHandlers()` 聚合注册，unsubs 随组件卸载清理（非顶层豁免）

## 不变量

- **返回键优先关弹窗**：有活动可关闭弹窗时，back 绝不触发退出提示（弹窗消费优先）
- **进度弹窗不可被 back 强关**：`closable=false`（下载/更新进度）时 `closeActiveDialog()` 返回 false
- **桌面零影响**：无 Java 层事件，消费注册无害且不触发

## 相关

- ADR-047（`android:back` 先关活动弹窗再退出）
- `docs/knowledge/android-bridge.md`、`docs/knowledge/dialog-modal.md`（closeActiveDialog 单例槽位）
