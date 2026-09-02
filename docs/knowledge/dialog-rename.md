---
kind: dialog-rename
name: 重命名弹窗 rename
tier: architecture
category: ui
source_files:
  - frontend/src/utils/dom/dialogs/rename.ts
  - frontend/src/utils/dom/dialogs/rename-format.ts
tests:
  - frontend/src/utils/dom/dialogs/rename-format.test.ts
  - frontend/src/utils/dom/dialogs/rename.test.ts
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - 重命名、改名、命名规范
  - 读取 YSM 头部（作者 / 介绍）
  - rename-format、showRenameDialog
quick_risk_lines:
  - rename 弹窗必须复用 modal.ts 的 Promise API，非法字符与长度校验在弹窗内完成
pitfalls:
  - 重命名不校验非法字符 → 后端 RenameFile 报错 / 文件名含控制字符；必须在校验阶段拦截
  - 读取 YSM 头部后按钮 loading 态未 finally 恢复 → 用户卡死；必须在 finally 恢复按钮态

use_when:
  - 重命名
  - 改名
  - 命名规范
  - 作者 品牌 角色
  - rename
  - 读取头部
invariant_anchors:
  - frontend/src/utils/dom/dialogs/rename-format.ts|buildRenameName
  - frontend/src/utils/dom/dialogs/rename-format.ts|validateRenameFields
status: active
---

# 重命名弹窗 rename

## 概览

`rename.ts` 提供单个模型的结构化重命名弹窗：把文件名按 `[作者]【品牌】角色-变体 (年月).ext` 规范拆成五个输入框，实时预览新文件名，可选「📖 读取头部」从 YSM 文件头提取作者/介绍。弹窗只负责产出新文件名，实际落盘由调用方调 `RenameFile`（或在导入流程中作为命名确认）。

## 核心职责

- `showRenameDialog(filePath, currentName)`：Promise 化弹窗，`parseModelName` 解析现有名预填作者/品牌/角色/日期
- 实时预览：任一输入框 `input` 事件触发 `update()`，按命名规范拼出新名显示在「旧名 → 新名」预览区
- 读取 YSM 头部：`getApp().ExtractYSMHeader(filePath)`，仅当作者为空时填入第一位作者、介绍展示为只读提示；按钮 loading 态在 `finally` 恢复（致命陷阱 #3 的解法）；`filePath` 为 null（未导入）时提示无法读取
- 提交校验：作者与角色必填；非法字符拦截（`/[<>:"\\|?*\/\u0000-\u001f]/`）；新名长度 ≤255 字符；错误显示在 `#rn-err`
- 关闭路径：Esc / 点遮罩 / 取消按钮 → resolve(null)；确认 → resolve(newName)

## 对外 API / 入口

- 导出：`showRenameDialog(filePath: string | null, currentName: string): Promise<string | null>`
- 监听/派发 bus：无
- getApp() 调用：`ExtractYSMHeader`
- 依赖：`parseModelName`（utils/display.ts）、`closeDlg`/`registerDlg`/`esc`（dialogs/modal.ts）
- 调用方：app-tree 右键重命名、[import_queue](./import-queue.md)（导入命名确认与已导入项改名后调 `RenameFile`）

## 与其他子系统关系

- 弹窗生命周期原语与样式复用 [dialog_modal](./dialog-modal.md)
- 命名解析/拼接与 `parseModelName`/`renderDisplayName` 同一套口径（utils/display.ts）
- 头部元数据解析后端见 [go_ysm_parser](./go-ysm-parser.md)
- 实际重命名 binding `RenameFile` 见 [wails_bindings](./wails-bindings.md)

## 不变量

- 作者、角色名为空禁止提交（焦点定位到首个空缺输入框）
- 文件名非法字符与 255 长度上限在前端先行拦截，不等 Go 端报错
- 「读取头部」按钮的文案/disabled 必须在 `finally` 恢复，防读取失败后卡死
- 弹窗必须经 `registerDlg` 登记，关闭统一走 `closeDlg`（退场动画 + 单次结算）
- **Enter 键已接线**（P3 修复）：overlay keydown 的 Enter 触发 `#rn-ok` click，与按钮共享校验/关闭路径（原按钮文案「重命名 (Enter)」虚标，键盘 Enter 无法提交）；Esc 走取消
- 弹窗未做 `trapFocus`（modal 家族其余成员有，此处一致性缺口 P3 观察）；`esc` 从 modal.ts 再导出引入（与 html.ts 等价，P4 约定性）

## 相关

- [dialog_modal](./dialog-modal.md) — 弹窗基座
- [import_queue](./import-queue.md) — 导入命名确认调用方
- [app_tree](./app-tree.md) — 右键重命名调用方
- [go_ysm_parser](./go-ysm-parser.md) — ExtractYSMHeader 后端
