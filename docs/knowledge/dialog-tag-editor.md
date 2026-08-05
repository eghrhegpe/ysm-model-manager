---
kind: dialog-tag-editor
name: 标签编辑器 tag-editor
tier: architecture
category: ui
source_files:
  - frontend/src/views/dialogs/tag-editor.ts
use_when:
  - 标签
  - 打标签
  - 编辑标签
  - tag
  - 标签弹窗
  - 分类标记
---

# 标签编辑器 tag-editor

## 概览

`tag-editor.ts` 提供单个模型的标签编辑弹窗：加载该模型已有标签与全库已有标签，支持手工输入新标签（Enter 或「+ 添加」）与从建议列表点选，删除标签用标签内 ✕ 按钮。保存时把最终标签列表写回后端 go/tags Store，返回保存后的列表；取消返回 null。

## 核心职责

- `modalTagEditor(modelPath)`：Promise 化弹窗，打开即异步加载——`GetModelTags(modelPath)` 取当前标签、`AllTags()` 取全库标签渲染建议区（`<details>` 折叠展示未使用标签）
- 标签增删：输入添加（去重、长度 ≤20 字符校验，错误显示 `#te-err`）；建议点选添加（自动排序）；标签 ✕ 删除
- 保存：`SetModelTags(modelPath, tags)` 写回成功后 `close(tags)`；失败在弹窗内显示错误不关闭
- 关闭路径：Esc / 点遮罩 / 取消 → resolve(null)；保存成功 → resolve(tags)

## 对外 API / 入口

- 导出：`modalTagEditor(modelPath: string): Promise<string[] | null>`
- 监听/派发 bus：无（`bus` 仅被 import 引用）
- getApp() 调用：`GetModelTags`、`AllTags`、`SetModelTags`
- 依赖：`esc`（utils/dom/html.ts）、`closeDlg`/`registerDlg`（dialogs/modal.js）
- 调用方：app-tree 文件右键「编辑标签」等入口

## 与其他子系统关系

- 后端存储为 go/tags Store（tags.json，路径→标签列表），见 [go_tags](./go-tags.md)；binding 经 [wails_bindings](./wails-bindings.md) 暴露
- 标签反查与高级筛选的标签条件联动 [dialog_adv_filter](./dialog-adv-filter.md)（同样消费 `AllTags`）
- 弹窗基座与样式复用 [dialog_modal](./dialog-modal.md)

## 不变量

- 标签去重与 20 字符上限在前端校验，重复/超长只显示行内错误不静默吞掉
- 保存必须经 `SetModelTags` 成功后才关闭弹窗；失败保留弹窗并展示错误，允许重试
- 标签列表写入前保持排序（`[...tags, t].sort()`），与后端 SetTags 的排序口径一致
- 弹窗内经 `registerDlg` 登记、`closeDlg` 关闭；动态文本过 `esc` 转义

## 相关

- [go_tags](./go-tags.md) — 后端标签存储
- [dialog_adv_filter](./dialog-adv-filter.md) — 按标签筛选
- [dialog_modal](./dialog-modal.md) — 弹窗基座
- [app_tree](./app-tree.md) — 右键编辑标签入口
