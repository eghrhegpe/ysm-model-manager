---
kind: dialog-tag-editor
name: 标签编辑器 tag-editor
tier: architecture
category: ui
source_files:
  - frontend/src/utils/dom/dialogs/tag-editor.ts
  - frontend/src/utils/dom/dialogs/tag-set.ts
auto_fields:
  symbols_with_lines:
    - addTagToSet
    - MAX_TAG_LENGTH
    - modalTagEditor
    - TagSetResult
  tests:
    - frontend/src/utils/dom/dialogs/tag-editor.test.ts
  quick_groups:
    - UI 交互与弹窗
  quick_intents:
    - 打标签、编辑标签、tag-editor
    - 分类标记、全库标签建议
    - modalTagEditor
  quick_risk_lines:
    - tag-editor 弹窗必须复用 modal.ts 的 Promise API，标签写回走 go/tags Store 的原子替换
  pitfalls:
    - 手写 tag-editor 弹窗 → 弹窗样式 / 焦点陷阱与全局不一致；必须复用 modal.ts
    - 标签写回用直写 tags.json → 并发写破坏文件；必须经 go/tags Store 的 tmp+os.Rename 原子替换
  use_when:
    - 标签
    - 打标签
    - 编辑标签
    - tag
    - 标签弹窗
    - 分类标记
  invariant_anchors:
    - frontend/src/utils/dom/dialogs/tag-editor.ts|modalTagEditor
    - frontend/src/utils/dom/dialogs/tag-set.ts|addTagToSet
tests:
  - frontend/src/utils/dom/dialogs/tag-editor.test.ts
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - 打标签、编辑标签、tag-editor
  - 分类标记、全库标签建议
  - modalTagEditor
quick_risk_lines:
  - tag-editor 弹窗必须复用 modal.ts 的 Promise API，标签写回走 go/tags Store 的原子替换
pitfalls:
  - 手写 tag-editor 弹窗 → 弹窗样式 / 焦点陷阱与全局不一致；必须复用 modal.ts
  - 标签写回用直写 tags.json → 并发写破坏文件；必须经 go/tags Store 的 tmp+os.Rename 原子替换

use_when:
  - 标签
  - 打标签
  - 编辑标签
  - tag
  - 标签弹窗
  - 分类标记
invariant_anchors:
  - frontend/src/utils/dom/dialogs/tag-editor.ts|modalTagEditor
  - frontend/src/utils/dom/dialogs/tag-set.ts|addTagToSet
status: active
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
- 依赖：`esc`（utils/dom/html.ts）、`closeDlg`/`registerDlg`（dialogs/modal.ts）
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
- **加载期间禁用输入/添加控件**（P3 修复）：GetModelTags/AllTags 异步返回晚于用户输入时 `tags = [...]` 会覆写已编辑内容（竞态），`finally` 恢复并聚焦
- 建议区不随增删刷新（已加标签仍残留在建议列表，P4 观察）；`esc` 直引 html.ts 合规（本文件与其他 dialog 不同，已按陷阱 #15 直引）

## 相关

- [go_tags](./go-tags.md) — 后端标签存储
- [dialog_adv_filter](./dialog-adv-filter.md) — 按标签筛选
- [dialog_modal](./dialog-modal.md) — 弹窗基座
- [app_tree](./app-tree.md) — 右键编辑标签入口
