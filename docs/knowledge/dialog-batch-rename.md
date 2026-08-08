---
kind: dialog-batch-rename
name: 批量重命名 batch-rename
tier: architecture
category: ui
source_files:
  - frontend/src/utils/dom/dialogs/batch-rename.ts
use_when:
  - 批量重命名
  - 批量改名
  - 查找替换
  - 正则替换
  - 统一作者
  - 预设
  - batch-rename
---

# 批量重命名 batch-rename

## 概览

`batch-rename.ts` 提供目录级批量重命名弹窗：接收文件条目列表，用 `parseModelName` 逐个解析出作者/作品/角色/日期，支持两种模式——「解析格式」（统一作者/作品批量改写）与「查找替换」（字面量或正则，含 5 个内置预设）。预览区逐行展示 原名 → 新名，可勾选筛选，应用时把变更列表回调给调用方执行，弹窗负责 UI 与结算时机。

## 核心职责

- `showBatchRenameDialog(dir, entries, onApply)`：模块级单例 `dialogEl`，重复打开先 `close()` 结算上一个 Promise，调用方 `await` 永不悬挂
- 解析模式：`updateAll()` 按 `[作者]【作品】角色 (日期).ext` 重建新名（原名无扩展名时回落 `RESOURCE_TYPES.YSM`）；统一作者/作品输入 200ms 防抖后批量套用并保留勾选状态
- 替换模式：`applyReplace(find, replace, isRegex)` 分离扩展名、只对文件名主体替换；正则无效时保持原名并 toast 提示（`dataset.regexErr` 去重，每次调用前重置）；预设含「去除年份」「去除版本 -v2」「【】→[]」「拍平为 作者-作品」「空格→下划线」
- 预览与勾选：`renderPreview` 渲染全选/单行复选框（事件委托），`updateCount` 统计「选中且有变更」数量
- 应用：过滤 `selected && changed` 条目，空变更只 toast 提示并 return；按钮置「⏳ 执行中...」+ disabled 后 `try { await onApply(changes) }`，`catch` 弹「❌ 批量重命名失败: …」error toast，`finally` 恢复按钮文案/可用并 `close()`（025f4e9：onApply 抛错不再留下死按钮与不关的弹窗）
- 关闭：Esc / 点遮罩 / 取消按钮 / 被 `registerDlg` 抢占 → 局部 `close()` 先摘掉 `dialogEl` 与 `_pendingResolve` 引用，再交 `closeDlg(el, () => res?.(), undefined)` 统一走退场动画（默认 120ms）+ DOM 移除 + 清 `_activeOverlay` 单例槽位 + 结算 Promise

## 对外 API / 入口

- 导出：`showBatchRenameDialog(dir: string, entries: BatchEntry[], onApply: (changes: BatchRenameChange[]) => Promise<void>): Promise<void>`、`interface BatchRenameChange`（oldPath/oldName/newName）
- 派发 bus：`toast:show`（正则无效警告、无变更提示、onApply 失败告警）
- 监听 bus：无
- 依赖：`parseModelName`（utils/dom/display.ts）、`stagger`（utils/animation/stagger.ts）、`esc`（utils/dom/html.ts）、`registerDlg` / `closeDlg`（views/dialogs/modal.ts）、`RESOURCE_TYPES`（utils/resource/types.ts）
- 调用方：`app-tree/bus-handlers.ts` 的 `dir:batch-rename`（目录右键，先 `ScanModelEntries` 取条目）与 `batch:rename`（Ctrl/Shift 多选，由路径拼条目）；两者的 onApply 均逐个 `RenameFile` 后 `reload` + `stats:refresh` 并汇总成功/失败

## 与其他子系统关系

- 弹窗登记与结算均复用 [dialog_modal](./dialog-modal.md) 的 `registerDlg` / `closeDlg` 与 dlg-* 样式类；HTML 转义走共享 `esc`（utils/dom/html.ts），本文件仅保留薄封装的局部 `close()`
- 实际批量改名执行（逐个 `RenameFile` + 失败汇总）在调用方 `app-tree/bus-handlers.ts`；右键菜单只负责派发 `dir:batch-rename` / `batch:rename`
- 命名解析口径与 [dialog_rename](./dialog-rename.md) 一致（parseModelName）

## 不变量

- 模块级 `dialogEl` 单例：新弹窗打开前必须先 `close()` 结算旧 `_pendingResolve`，杜绝悬挂 Promise 与双弹窗；**registerDlg 的 cancelClose 捕获本次元素引用**（P1 修复：原 `() => close()` 引用模块级 dialogEl，重复打开时旧 cancelClose 在 registerDlg 抢占中被调 → 误杀新弹窗 + `dialogEl.focus()` 抛 TypeError）
- 替换只作用于文件名主体，扩展名分离保护（`/(\.[^.]+)$/`）；**空查找串守卫**（P2 修复：`replaceAll("", x)` 每两字符间插入破坏预览）
- 应用按钮必须先 disabled 再 `await onApply`，且「恢复按钮 + `close()`」只能放 `finally`——onApply 抛错时不得残留「⏳ 执行中...」死按钮或不关的弹窗（陷阱 #3）
- 变更判定以 `newName !== Name` 为准，未变化条目不进 `onApply` 载荷
- 预览行动态文本一律过共享 `esc` 转义
- **防抖 timer 挂载到 dialogEl 并在 close() 清理**（P2 修复：原 brTimer 闭包内局部，关闭后 200ms 幽灵回调若新开弹窗会跨弹窗污染）

## 相关

- [dialog_modal](./dialog-modal.md) — 弹窗基座与样式
- [dialog_rename](./dialog-rename.md) — 单文件重命名（同构命名规范）
- [app_tree](./app-tree.md) — 目录右键批量重命名入口
- [context_menu](./context-menu.md) — 右键菜单映射
