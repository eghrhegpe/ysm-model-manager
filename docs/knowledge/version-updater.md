---
kind: version-updater
name: 版本更新 version-updater
tier: architecture
category: feature
source_files:
  - frontend/src/features/version-updater.ts
auto_fields:
  symbols_with_lines:
    - checkUpdateSilent:171
    - initVersionUpdater:210
    - UpdateInfo:15
  tests:
    - frontend/src/features/version-updater.test.ts
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - 更新检查、升级、新版本
    - 静默检查、canCheck、markChecked
    - updater
  quick_risk_lines:
    - 版本更新必须经 version-updater 的 canCheck/markChecked 节流，禁止高频轮询 GitHub API
  pitfalls:
    - 高频轮询 GitHub API → 触发限流、浪费带宽；必须经 canCheck 节流
    - check 未 markChecked → 重启后重复检查；必须在检查完成后 markChecked 记录时间戳
  use_when:
    - 更新
    - 升级
    - 检查更新
    - 新版本
    - 静默检查
    - updater
    - 版本
  perf:
    - io-bound
  invariant_anchors:
    - frontend/src/features/version-updater.ts|canCheck
    - frontend/src/features/version-updater.ts|markChecked
tests:
  - frontend/src/features/version-updater.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 更新检查、升级、新版本
  - 静默检查、canCheck、markChecked
  - updater
quick_risk_lines:
  - 版本更新必须经 version-updater 的 canCheck/markChecked 节流，禁止高频轮询 GitHub API
pitfalls:
  - 高频轮询 GitHub API → 触发限流、浪费带宽；必须经 canCheck 节流
  - check 未 markChecked → 重启后重复检查；必须在检查完成后 markChecked 记录时间戳

use_when:
  - 更新
  - 升级
  - 检查更新
  - 新版本
  - 静默检查
  - updater
  - 版本
perf:
  - io-bound
invariant_anchors:
  - frontend/src/features/version-updater.ts|canCheck
  - frontend/src/features/version-updater.ts|markChecked
status: active
---

# 版本更新 version-updater

## 概览

`version-updater.ts` 是应用自更新的前端入口：启动时静默检查（受 6 小时频次限制）→ 发现新版本以可点击 toast 通知；设置页按钮手动检查 → 弹出带更新日志的 `modalConfirm` → 调 `DoUpdate` 下载安装，随后由 Go 侧/更新助手接管进程替换与重启。后端检查/下载/校验/替换逻辑在 Go 端 go/updater，本文件只做 UI 与调用编排。

## 核心职责

- 频次限制：`CHECK_KEY = "ysm_lastUpdateCheck"` + `CHECK_INTERVAL = 6h`，`canCheck()`/`markChecked()` 基于 localStorage 实现
- `checkUpdateSilent()`：静默检查，先过 `canCheck()` 闸门；**`markChecked()` 在 `CheckUpdate()` 成功返回之后才写**（网络/API 失败不计入频次，下次启动仍会重试）；`info.available` 时发 `TOAST_MS.persist`（10000ms）可点击 toast（`click` 回调打开 `promptUpdate`）；下载中（静默路径 `statusEl` 为 null）发 `TOAST_MS.sticky`（60000ms）toast 覆盖整个下载窗口（P3 由 10s 拉到 60s），与 `modalProgress` 进度弹窗并存；任何异常静默吞掉不阻塞启动
- `promptUpdate(info, statusEl)`：复用 `modalConfirm`（dialogs/modal.ts）而非手工构建遮罩，传 `title/icon/message/okText/width:"480px"` 与 `bodyHTML`；`bodyHTML` 内联样式用 CSS 变量适配主题，展示版本号与更新日志（`slice(0, 2000).trim()`，经 `textContent → innerHTML` 转义后 `white-space:pre-wrap` 保留换行；trim 后为空则不渲染日志块）
- `doUpdate(info, statusEl)`：置 statusEl 文案「⬇️ 下载+安装中...」→ 打开只读进度弹窗 `modalProgress`（**`closable:false`**——下载中禁止 Esc/点遮罩关闭，防误关丢进度，P3 修复）+ 瞬态注册 `update:progress` 事件（Go 侧 `DoUpdate` 经 `Emit("update:progress", done, total)` 推送，payload 经 Array.isArray + 数值守卫降级 0）驱动弹窗进度；同时 **`Window.SetTitle` 同步窗口标题**（已知长度显示「⬇️ N%」，分块传输显示「⬇️ X MB」，标题栏永远可见作全局兜底），`finally` 注销监听 + 关闭弹窗 + 恢复原标题；`DoUpdate(url, expectedHash)` 返回非 `"success"` 即抛错；其后的 `RestartApplication()` 实际不可达（Go 侧 `InstallUpdate` 替换完成即 `os.Exit(0)`，由 `ysm-updater-helper.exe` 替换 exe 并拉起新进程），保留作防御
- `initVersionUpdater(root)`：绑定设置页 `#set-check-update` 按钮，检查中置文案与 `disabled`，`finally` 恢复「🔄 检查更新」与可用态（致命陷阱 #3 的解法）；`!info.available` 时提示「✅ 已是最新版本」并 return
- 错误文案统一经 `friendlyError`（utils/dom/errors.ts）转换后再进 toast

## 对外 API / 入口

- 导出：`checkUpdateSilent(): Promise<void>`、`initVersionUpdater(root: Document | ShadowRoot): void`、`interface UpdateInfo`（available/latest/current/url/expectedHash/releaseNotes）
- 派发 bus：`toast:show`（静默通知带 `click` 回调；失败/已是最新用对应 type）
- Wails binding（经 `getApp()`，frontend/src/backend/app.ts 统一入口）：`CheckUpdate`、`DoUpdate`、`RestartApplication`
- 依赖：`modalConfirm`/`modalProgress`/`esc`（utils/dom/dialogs/modal.ts）、`fmtMB`（经 modal.ts re-export，实现已下沉 utils/format/fmt-mb.ts）、`Events`/`Window`（@wailsio/runtime——update:progress 瞬态监听 + SetTitle 标题进度）、`friendlyError`（utils/dom/errors.ts）、`bus`
- 调用方：`frontend/src/app-modules.ts` 启动序列（`checkUpdateSilent().catch(console.warn)`，fire-and-forget 不阻塞界面）；`frontend/src/views/app-content/settings/init.ts`（`initVersionUpdater(root)`）

## 与其他子系统关系

- 后端更新流水线见 [go_updater](./go-updater.md)（版本比对/下载/hash 校验/替换）
- 启动挂载点见 [app_modules](./app-modules.md)（`registerErrorDiary` → `initTheme` → `applyUIPrefs` 之后 fire-and-forget 静默检查，不阻塞界面）
- toast 通知（含 `click` 回调支持）由 [app_toast](./app-toast.md) 渲染；确认弹窗直接复用 [dialog_modal](./dialog-modal.md) 的 `modalConfirm`（含其 Esc / 点遮罩关闭行为），本文件不再自建 `dlg-overlay`
- 转义复用 `dialogs/modal.ts` 导出的 `esc`；错误文案复用 `utils/dom/errors.ts` 的 `friendlyError`

## 不变量

- 静默检查必须先过 `canCheck()` 频次闸门；`markChecked()` 只在 `CheckUpdate()` 成功后写，失败不占用 6h 窗口
- 静默路径异常一律静默捕获，绝不向启动流程抛错（**`canCheck()` 已移入 try**——P3 修复：原在 try 外，隐私模式 localStorage 抛错时 promise reject 靠调用方 `.catch` 兜底而非模块内静默）
- 手动检查按钮的文案/disabled 必须在 `finally` 中恢复，防止异步失败后按钮卡死（致命陷阱 #3）
- `promptUpdate` 内部捕获 `doUpdate` 异常转 toast，不再向外抛（由外层 finally 恢复按钮）
- 更新日志展示前必须经 textContent 转义（先写 `textContent` 再取 `innerHTML`），长度截断 2000 字符
- `DoUpdate` 返回值非 `"success"` 一律视为失败抛错，不做部分成功假设（**此分支与 releaseNotes 转义截断零测试覆盖**，P3 观察）
- `doUpdate` 末尾的 `RestartApplication()` 是防御性死代码（Go 侧已 `os.Exit(0)`），不得据此假设前端能拿到「更新完成」后续控制权（测试断言该路径属锁防御行为）
- 下载中进度弹窗 `closable:false`（Esc/点遮罩不可关），配合窗口标题进度（`Window.SetTitle`）双保险——弹窗被挤兑/异常关闭时标题栏仍显示下载状态；`finally` 必须恢复原标题
- `update:progress` payload 防御：Array.isArray + `Number.isFinite` 守卫，畸形事件降级 (0,0)，不抛 TypeError 不渲染 NaN（ADR-044 ② 数值守卫）

## 相关

- [go_updater](./go-updater.md) — 后端检查/下载/应用更新
- [app_modules](./app-modules.md) — 启动时调用 checkUpdateSilent
- [app_toast](./app-toast.md) — 可点击更新通知
- [dialog_modal](./dialog-modal.md) — 弹窗样式与 esc 来源
