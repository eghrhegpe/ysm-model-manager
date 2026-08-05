---
kind: dialog_batch_rename
name: 批量重命名 batch-rename
tier: architecture
category: ui
source_files:
  - frontend/src/views/dialogs/batch-rename.ts
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
- 解析模式：`updateAll()` 按 `[作者]【作品】角色 (日期).ext` 重建新名；统一作者/作品输入 200ms 防抖后批量套用并保留勾选状态
- 替换模式：`applyReplace(find, replace, isRegex)` 分离扩展名、只对文件名主体替换；正则无效时保持原名并 toast 提示（`dataset.regexErr` 去重，每次调用前重置）；预设含「去除年份」「去除版本 -v2」「【】→[]」「拍平为 作者-作品」「空格→下划线」
- 预览与勾选：`renderPreview` 渲染全选/单行复选框（事件委托），`updateCount` 统计「选中且有变更」数量
- 应用：过滤 `selected && changed` 条目，空变更 toast 提示；按钮置「⏳ 执行中...」+ disabled 后 `await onApply(changes)`，完成再 `close()`
- 关闭：Esc / 点遮罩 / 取消按钮 → `close()` 结算 pending Promise 并 120ms 退场移除 DOM

## 对外 API / 入口

- 导出：`showBatchRenameDialog(dir: string, entries: BatchEntry[], onApply: (changes: BatchRenameChange[]) => Promise<void>): Promise<void>`、`interface BatchRenameChange`（oldPath/oldName/newName）
- 派发 bus：`toast:show`（正则无效警告、无变更提示）
- 监听 bus：无
- 依赖：`parseModelName`（utils/display.ts）、`stagger`（utils/stagger.ts）、`registerDlg`（dialogs/modal.ts）
- 调用方：app-tree 目录右键「批量重命名」（经 `dir:batch-rename` / `batch:rename` 流程）

## 与其他子系统关系

- 弹窗登记复用 [dialog_modal](./dialog_modal.md) 的 `registerDlg` 与 dlg-* 样式类（本文件自带局部 `esc` 与 `close`）
- 实际批量改名执行（逐个 `RenameFile` + 失败汇总）在调用方（app-tree/core/context-menus 的批量流程）
- 命名解析口径与 [dialog_rename](./dialog_rename.md) 一致（parseModelName）

## 不变量

- 模块级 `dialogEl` 单例：新弹窗打开前必须先 `close()` 结算旧 `_pendingResolve`，杜绝悬挂 Promise 与双弹窗
- 替换只作用于文件名主体，扩展名分离保护（`/(\.[^.]+)$/`）
- 应用按钮必须先 disabled 再 `await onApply`，完成后才 `close()`——防止执行中二次点击与提前关闭
- 变更判定以 `newName !== Name` 为准，未变化条目不进 `onApply` 载荷
- 预览行动态文本一律过局部 `esc` 转义

## 相关

- [dialog_modal](./dialog_modal.md) — 弹窗基座与样式
- [dialog_rename](./dialog_rename.md) — 单文件重命名（同构命名规范）
- [app_tree](./app_tree.md) — 目录右键批量重命名入口
- [context_menu](./context_menu.md) — 右键菜单映射
