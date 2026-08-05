---
kind: version_updater
name: 版本更新 version-updater
tier: architecture
category: feature
source_files:
  - frontend/src/features/version-updater.ts
use_when:
  - 更新
  - 升级
  - 检查更新
  - 新版本
  - 静默检查
  - updater
  - 版本
---

# 版本更新 version-updater

## 概览

`version-updater.ts` 是应用自更新的前端入口：启动时静默检查（受 6 小时频次限制）→ 发现新版本以可点击 toast 通知；设置页按钮手动检查 → 弹出带更新日志的 `modalConfirm` → 调 `DoUpdate` 下载安装，随后由 Go 侧/更新助手接管进程替换与重启。后端检查/下载/校验/替换逻辑在 Go 端 go/updater，本文件只做 UI 与调用编排。

## 核心职责

- 频次限制：`CHECK_KEY = "ysm_lastUpdateCheck"` + `CHECK_INTERVAL = 6h`，`canCheck()`/`markChecked()` 基于 localStorage 实现
- `checkUpdateSilent()`：静默检查，先过 `canCheck()` 闸门；**`markChecked()` 在 `CheckUpdate()` 成功返回之后才写**（网络/API 失败不计入频次，下次启动仍会重试）；`info.available` 时发 10 秒可点击 toast（`click` 回调打开 `promptUpdate`）；任何异常静默吞掉不阻塞启动
- `promptUpdate(info, statusEl)`：复用 `modalConfirm`（dialogs/modal.ts）而非手工构建遮罩，传 `title/icon/message/okText/width:"480px"` 与 `bodyHTML`；`bodyHTML` 内联样式用 CSS 变量适配主题，展示版本号与更新日志（`slice(0, 2000).trim()`，经 `textContent → innerHTML` 转义后 `white-space:pre-wrap` 保留换行；trim 后为空则不渲染日志块）
- `doUpdate(info, statusEl)`：置 statusEl 文案「⬇️ 下载+安装中...」→ `DoUpdate(url, expectedHash)` 返回非 `"success"` 即抛错；其后的 `RestartApplication()` 实际不可达（Go 侧 `InstallUpdate` 替换完成即 `os.Exit(0)`，由 `ysm-updater-helper.exe` 替换 exe 并拉起新进程），保留作防御
- `initVersionUpdater(root)`：绑定设置页 `#set-check-update` 按钮，检查中置文案与 `disabled`，`finally` 恢复「🔄 检查更新」与可用态（致命陷阱 #3 的解法）；`!info.available` 时提示「✅ 已是最新版本」并 return
- 错误文案统一经 `friendlyError`（utils/dom/errors.ts）转换后再进 toast

## 对外 API / 入口

- 导出：`checkUpdateSilent(): Promise<void>`、`initVersionUpdater(root: Document | ShadowRoot): void`、`interface UpdateInfo`（available/latest/current/url/expectedHash/releaseNotes）
- 派发 bus：`toast:show`（静默通知带 `click` 回调；失败/已是最新用对应 type）
- Wails binding（经 `getApp()`，frontend/src/wails/app.ts 统一入口）：`CheckUpdate`、`DoUpdate`、`RestartApplication`
- 依赖：`modalConfirm`/`esc`（views/dialogs/modal.ts）、`friendlyError`（utils/dom/errors.ts）、`bus`
- 调用方：`frontend/src/app-modules.ts:135` 启动序列（`checkUpdateSilent().catch(console.warn)`，fire-and-forget 不阻塞界面）；`frontend/src/views/app-content/settings/community.ts:607`（`initVersionUpdater(root)`）

## 与其他子系统关系

- 后端更新流水线见 [go_updater](./go_updater.md)（版本比对/下载/hash 校验/替换）
- 启动挂载点见 [app_modules](./app_modules.md)（`registerErrorDiary` → `initTheme` → `applyUIPrefs` 之后 fire-and-forget 静默检查，不阻塞界面）
- toast 通知（含 `click` 回调支持）由 [app_toast](./app_toast.md) 渲染；确认弹窗直接复用 [dialog_modal](./dialog_modal.md) 的 `modalConfirm`（含其 Esc / 点遮罩关闭行为），本文件不再自建 `dlg-overlay`
- 转义复用 `dialogs/modal.ts` 导出的 `esc`；错误文案复用 `utils/dom/errors.ts` 的 `friendlyError`

## 不变量

- 静默检查必须先过 `canCheck()` 频次闸门；`markChecked()` 只在 `CheckUpdate()` 成功后写，失败不占用 6h 窗口
- 静默路径异常一律静默捕获，绝不向启动流程抛错
- 手动检查按钮的文案/disabled 必须在 `finally` 中恢复，防止异步失败后按钮卡死（致命陷阱 #3）
- `promptUpdate` 内部捕获 `doUpdate` 异常转 toast，不再向外抛（由外层 finally 恢复按钮）
- 更新日志展示前必须经 textContent 转义（先写 `textContent` 再取 `innerHTML`），长度截断 2000 字符
- `DoUpdate` 返回值非 `"success"` 一律视为失败抛错，不做部分成功假设
- `doUpdate` 末尾的 `RestartApplication()` 是防御性死代码（Go 侧已 `os.Exit(0)`），不得据此假设前端能拿到「更新完成」后续控制权

## 相关

- [go_updater](./go_updater.md) — 后端检查/下载/应用更新
- [app_modules](./app_modules.md) — 启动时调用 checkUpdateSilent
- [app_toast](./app_toast.md) — 可点击更新通知
- [dialog_modal](./dialog_modal.md) — 弹窗样式与 esc 来源
