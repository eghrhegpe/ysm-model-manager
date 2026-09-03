---
kind: dialog-modal
name: 弹窗基座 modal
tier: architecture
category: ui
source_files:
  - frontend/src/features/dialogs/modal.ts
auto_fields:
  symbols_with_lines:
    - __resetModalStateForTest
    - closeActiveDialog
    - closeDlg
    - fmtMB
    - modalConfirm
    - ModalConfirmOptions
    - modalPicker
    - ModalPickerItem
    - ModalPickerOptions
    - ModalPickerResult
    - modalProgress
    - ModalProgressHandle
    - ModalProgressOptions
    - modalPrompt
    - ModalPromptOptions
    - modalSelect
    - ModalSelectOptions
    - registerDlg
    - trapFocus
    - VIEW_TESTIDS
  tests:
    - frontend/src/features/dialogs/modal.test.ts
  use_when:
    - 弹窗
    - 对话框
    - 确认框
    - 输入框弹窗
    - 下拉选择弹窗
    - modal
    - prompt
    - confirm
    - 弹窗
    - 对话框
    - 确认框
    - 输入框弹窗
    - 下拉选择弹窗
    - modal
    - prompt
    - confirm
  invariant_anchors:
    - frontend/src/features/dialogs/modal.ts|trapFocus
    - frontend/src/features/dialogs/modal.ts|closeDlg
    - frontend/src/features/dialogs/modal.ts|registerDlg
    - frontend/src/features/dialogs/modal.ts|modalConfirm
    - frontend/src/features/dialogs/modal.ts|modalPicker
    - frontend/src/features/dialogs/modal.ts|trapFocus
    - frontend/src/features/dialogs/modal.ts|closeDlg
    - frontend/src/features/dialogs/modal.ts|registerDlg
    - frontend/src/features/dialogs/modal.ts|modalConfirm
    - frontend/src/features/dialogs/modal.ts|modalPicker
  quick_groups:
    - UI 交互与弹窗
  quick_intents:
    - 弹确认框 / 输入框 / 下拉选择 / modal
    - 执行破坏性操作前的二次确认（danger 模式）
    - 进度弹窗（closable=false 防误关）
    - 富列表选择（picker，支持自定义 footer 表单）
  quick_risk_lines:
    - 业务弹窗必须复用 modal.ts 的 Promise API（prompt/select/confirm/picker），禁止手写弹窗
    - 破坏性操作（删除/清空/覆盖）必须用 modalConfirm，danger=true 标红按钮
  pitfalls:
    - 弹窗 Promise 只 resolve 不 reject：取消/关闭一律返回 null/false，调用方无需 catch
    - registerDlg 前必须先把 overlay append 到 document.body，顺序颠倒会导致 trapFocus 失效
    - 新弹窗打开时旧弹窗会被自动结算（cancelClose），调用方不可依赖「用户主动关闭」语义判断结果
    - modalProgress 的 closable=false 时，Esc/遮罩点击/android back 均不关闭，必须由代码显式调用 handle.close()
    - modalPicker 的 footerHTML 由调用方负责转义；bodyHTML 同理，禁止直插未 esc 的字符串
    - closeDlg 经 WeakSet(_closingOverlays) 防重复触发，同一弹窗再次调用会静默跳过
    - 测试中必须 afterEach 调用 __resetModalStateForTest() 清槽位，否则跨用例残留状态污染
tests:
  - frontend/src/features/dialogs/modal.test.ts
use_when:
  - 弹窗
  - 对话框
  - 确认框
  - 输入框弹窗
  - 下拉选择弹窗
  - modal
  - prompt
  - confirm
invariant_anchors:
  - frontend/src/features/dialogs/modal.ts|trapFocus
  - frontend/src/features/dialogs/modal.ts|closeDlg
  - frontend/src/features/dialogs/modal.ts|registerDlg
  - frontend/src/features/dialogs/modal.ts|modalConfirm
  - frontend/src/features/dialogs/modal.ts|modalPicker
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - 弹确认框 / 输入框 / 下拉选择 / modal
  - 执行破坏性操作前的二次确认（danger 模式）
  - 进度弹窗（closable=false 防误关）
  - 富列表选择（picker，支持自定义 footer 表单）
quick_risk_lines:
  - 业务弹窗必须复用 modal.ts 的 Promise API（prompt/select/confirm/picker），禁止手写弹窗
  - 破坏性操作（删除/清空/覆盖）必须用 modalConfirm，danger=true 标红按钮
pitfalls:
  - 弹窗 Promise 只 resolve 不 reject：取消/关闭一律返回 null/false，调用方无需 catch
  - registerDlg 前必须先把 overlay append 到 document.body，顺序颠倒会导致 trapFocus 失效
  - 新弹窗打开时旧弹窗会被自动结算（cancelClose），调用方不可依赖「用户主动关闭」语义判断结果
  - modalProgress 的 closable=false 时，Esc/遮罩点击/android back 均不关闭，必须由代码显式调用 handle.close()
  - modalPicker 的 footerHTML 由调用方负责转义；bodyHTML 同理，禁止直插未 esc 的字符串
  - closeDlg 经 WeakSet(_closingOverlays) 防重复触发，同一弹窗再次调用会静默跳过
  - 测试中必须 afterEach 调用 __resetModalStateForTest() 清槽位，否则跨用例残留状态污染
status: active
---

# 弹窗基座 modal

## 概览

`modal.ts` 是全应用统一的模态弹窗基座：提供 prompt（带输入框）、select（下拉选择）、confirm（确认）、picker（富列表选择）四种 Promise 化弹窗，以及共享的转义、关闭动画、活动弹窗单例管理。所有业务弹窗（rename/batch-rename/tag-editor/adv-filter 等）都复用它的 `dlg-overlay`/`dlg-box` 样式类与 `registerDlg`/`closeDlg` 生命周期原语，保证交互一致性（UX 维度「交互一致性」）。

## 核心职责

- `esc(s)`：HTML 转义（`&`/`<`/`>`/`"`），弹窗内所有动态文本必须经过
- `closeDlg(overlay, resolve, value, delay=120)`：带退场动画关闭——经模块级 `WeakSet<HTMLElement>`（`_closingOverlays`）防重复触发（不污染 HTMLElement 全局类型），加 `dlg-closing` 类，延时移除 DOM 并 resolve Promise
- `registerDlg(overlay, cancelClose)`：登记活动弹窗单例；已有活动弹窗时先调其 `cancelClose()`（按取消值结算），防止连点叠加出多个弹窗/双执行
- `modalPrompt(opts)`：输入框弹窗，空值校验（`#mp-err` 提示），Enter 确认 / Esc 取消，返回输入值或 null
- `modalSelect(opts)`：下拉选择弹窗，返回选中项或 null
- `modalConfirm(opts)`：确认弹窗，`danger` 选项切换 `dlg-btn-danger` 红样式，overlay 可聚焦并响应 Esc，返回 boolean
- `modalProgress(opts)`：长时间操作进度弹窗（`ModalProgressOptions` / `ModalProgressHandle`），暴露 `update(title, text)` / `resolve()` / `close()`；`registerDlg` 的 `closable` 参数支持用户取消
- `modalPicker(opts)`：富列表选择弹窗（行即选项，`ModalPickerItem` 渲染 label/meta/sub/hint），列表下可挂自定义表单（`footerHTML`，带 `name` 的控件按 name 聚合返回选中态/值）；复用统一 `createDialog` 脚手架（单例登记 / trapFocus / 退场动画 / Esc / 遮罩关闭），返回 `{ index, footerChecked, footerValues }` 或 null——launcher-detect 的 HMCL/PCL 实例选择用它（消旁路弹窗骨架，2026-08-29 审核修复）

## 对外 API / 入口

- 导出：`esc(s: string): string`、`closeDlg<T>(overlay, resolve, value, delay?)`、`registerDlg(overlay, cancelClose)`、`modalPrompt(opts: ModalPromptOptions): Promise<string | null>`、`modalSelect(opts: ModalSelectOptions): Promise<string | null>`、`modalConfirm(opts: ModalConfirmOptions): Promise<boolean>`、`modalPicker(opts: ModalPickerOptions): Promise<ModalPickerResult | null>`
- 选项接口：`ModalPromptOptions` / `ModalSelectOptions` / `ModalConfirmOptions` / `ModalPickerOptions` / `ModalPickerItem` / `ModalPickerResult`（title/icon/message 或 items/okText/danger/width；picker 另支持 subtitle/footerHTML，footer 控件按 name 聚合为 footerChecked/footerValues）
- 监听/派发 bus：无（弹窗为纯 DOM 层，反馈由调用方负责）
- CSS 依赖：全局样式中的 `.dlg-overlay`/`.dlg-box`/`.dlg-btn`/`.dlg-btn-primary`/`.dlg-btn-danger`/`.dlg-closing` 等类；**弹窗内部静态装饰样式（字段框/footer/title 消息区/进度条/picker 行）已外提为独立 `css/dialogs.css`（ADR-149），由 index.html `<link>` 加载、置于 `components.css` 之后；仅运行时动态值（box/fill 宽度、hint 安全色）保留 inline，禁止在 modal.ts 内联静态装饰**

## 与其他子系统关系

- 被 [dialog_rename](./dialog-rename.md)、[dialog_batch_rename](./dialog-batch-rename.md)、[dialog_tag_editor](./dialog-tag-editor.md)、[dialog_adv_filter](./dialog-adv-filter.md) 复用原语与样式类
- 被业务层大量直接调用 `modalConfirm` 做破坏性操作防呆：[recycle_bin](./recycle-bin.md)（清空/删除）、[global_handlers](./global-handlers.md)（清空整合包）、[community_feature](./community-feature.md)（大文件下载）、[import_queue](./import-queue.md)（覆盖导入）
- version-updater 复用其 `esc` 导出

## 不变量

- 活动弹窗单例槽位（`_activeOverlay`/`_closeActive`）：新弹窗 `registerDlg` 时旧弹窗必须按「取消值」结算，杜绝弹窗叠加与悬挂 Promise；`closeDlg` 结算槽位带 `_activeOverlay === overlay` 判定，旧弹窗晚到的定时器不误清新弹窗槽位
- `closeDlg` 必须经 `_closingOverlays`（WeakSet）守卫，同一弹窗只结算一次
- 弹窗内所有动态文本必须过 `esc`，禁止直拼未转义 HTML（modal.ts 从 html.ts import 并 re-export，无双源；`'` 也转义为 `&#39;`，比知识卡声明的 `& < > "` 更严格）
- 弹窗只 resolve 不 reject：取消/关闭一律 resolve 取消值（null/false），调用方无需 catch
- 弹窗 append 到 `document.body` 后必须立即 `registerDlg`，顺序不可颠倒
- trapFocus 已导出（modal.ts trapFocus）供四个内置弹窗使用；P3 观察：`FOCUSABLE_SEL` 裸 `tabindex` 会匹配 `tabindex="-1"`（当前内置弹窗无 -1 后代，静态推导未证实触发）；modalConfirm 初始焦点在 overlay 而 Enter 不触发确认（UX 缺口）；modalSelect 的 `placeholder` 选项接口保留兼容但 builder 不消费（原 `void placeholder` 墓碑已清除）。单次使用的绑定微函数已内联回各 modalXxx，`dgMo*` 匈牙利前缀已清除（2026-09-01 utils 锐评整改）

## 相关

- [dialog_rename](./dialog-rename.md) — 重命名弹窗
- [dialog_batch_rename](./dialog-batch-rename.md) — 批量重命名弹窗
- [dialog_tag_editor](./dialog-tag-editor.md) — 标签编辑器
- [dialog_adv_filter](./dialog-adv-filter.md) — 高级筛选弹窗
