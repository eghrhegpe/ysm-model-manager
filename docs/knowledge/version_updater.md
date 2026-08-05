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

`version-updater.ts` 是应用自更新的前端入口：启动时静默检查（受 6 小时频次限制）→ 发现新版本以可点击 toast 通知；设置页按钮手动检查 → 弹出带更新日志的确认框 → 下载安装 → 重启。后端检查/下载/校验/重启逻辑在 Go 端 go/updater，本文件只做 UI 与调用编排。

## 核心职责

- 频次限制：`CHECK_KEY = "ysm_lastUpdateCheck"` + `CHECK_INTERVAL = 6h`，`canCheck()`/`markChecked()` 基于 localStorage 实现
- `checkUpdateSilent()`：静默检查，`info.available` 时发 10 秒可点击 toast（`click` 回调打开 `promptUpdate`）；任何异常静默吞掉不阻塞启动
- `promptUpdate(info, statusEl)`：手工构建 `dlg-overlay` 确认框（ Esc / 点遮罩关闭），展示版本号与截断至 2000 字符的更新日志（textContent 转义后保留换行）
- `doUpdate(info, statusEl)`：`DoUpdate(url, expectedHash)` 返回非 `"success"` 即抛错；成功后 `RestartApplication()` 重启
- `initVersionUpdater(root)`：绑定设置页 `#set-check-update` 按钮，检查中置文案与 `disabled`，`finally` 恢复「🔄 检查更新」与可用态（致命陷阱 #3 的解法）

## 对外 API / 入口

- 导出：`checkUpdateSilent(): Promise<void>`、`initVersionUpdater(root: Document | ShadowRoot): void`、`interface UpdateInfo`（available/latest/current/url/expectedHash/releaseNotes）
- 派发 bus：`toast:show`（静默通知带 `click` 回调；失败/已是最新用对应 type）
- Wails binding（动态 import bindings）：`CheckUpdate`、`DoUpdate`、`RestartApplication`
- 调用方：`app-modules.ts` 启动序列（`checkUpdateSilent`）；`components/app-content/community/settings.ts`（`initVersionUpdater`）

## 与其他子系统关系

- 后端更新流水线见 [go_updater](./go_updater.md)（版本比对/下载/hash 校验/替换）
- 启动挂载点见 [app_modules](./app_modules.md)（初始化主题后立即静默检查，不阻塞界面）
- toast 通知（含 `click` 回调支持）由 [app_toast](./app_toast.md) 渲染；弹窗样式类（`dlg-overlay`/`dlg-box`/`dlg-btn`）与 [dialog_modal](./dialog_modal.md) 同源
- 转义复用 `dialogs/modal.ts` 导出的 `esc`

## 不变量

- 静默检查必须先过 `canCheck()` 频次闸门并立即 `markChecked()`；异常静默捕获，绝不向启动流程抛错
- 手动检查按钮的文案/disabled 必须在 `finally` 中恢复，防止异步失败后按钮卡死（致命陷阱 #3）
- `promptUpdate` 内部捕获 `doUpdate` 异常转 toast，不再向外抛（由外层 finally 恢复按钮）
- 更新日志展示前必须经 textContent 转义（先写 `textContent` 再取 `innerHTML`），长度截断 2000 字符
- `DoUpdate` 返回值非 `"success"` 一律视为失败抛错，不做部分成功假设

## 相关

- [go_updater](./go_updater.md) — 后端检查/下载/应用更新
- [app_modules](./app_modules.md) — 启动时调用 checkUpdateSilent
- [app_toast](./app_toast.md) — 可点击更新通知
- [dialog_modal](./dialog_modal.md) — 弹窗样式与 esc 来源
