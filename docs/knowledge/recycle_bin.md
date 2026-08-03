---
kind: recycle_bin
name: 回收站界面 recycle-bin
tier: architecture
category: feature
source_files:
  - frontend/js/features/recycle-bin.ts
use_when:
  - 回收站
  - 恢复文件
  - 清空回收站
  - 软删除
  - recycle
  - 还原
---

# 回收站界面 recycle-bin

## 概览

`recycle-bin.ts` 实现仓库页「回收站」tab 的界面逻辑：列出 `.recycle` 中属于当前资源类型的已删除文件，提供单条恢复/永久删除、一键清空。由 app-content 首次切到 recycle tab 时懒加载调用 `initRecycleBin(this)`，返回清理函数。后端删除/恢复策略（符号链接/硬链接直接删、普通文件移 `.recycle`、跨分区复制后删）在 Go 端 go/recycle 实现，本文件只做展示与调用。

## 核心职责

- `loadRecycleBin()`：`ListRecycleBin("")` 取全部条目 → `GetRepoRoot(currentType)` 按当前资源类型根目录前缀过滤 → 渲染条目（名称走 `renderDisplayName`、大小走宿主 `_fmtSize`、完整路径展示）
- generation 守卫：模块内 `_loadGen` 每次加载自增，`await` 后比对，过期请求的结果直接丢弃，不覆盖新列表
- 单条恢复：`RestoreFromRecycle(path, "")`，成功后重载列表并广播刷新；失败回滚条目 `leaving` 动画状态
- 单条删除：`modalConfirm` 二次确认后 `DeleteFromRecycle(path)`
- 清空回收站：`modalConfirm`（danger）确认后 `EmptyRecycleBin("")`，toast 回报数量
- 监听 `repo:rtype-changed`：资源类型切换时更新 `currentType` 并重载列表
- 条目名称区点击 → `bus.emit("model:select", { path })` 查看详情

## 对外 API / 入口

- 导出：`initRecycleBin(app: RecycleHost): () => void`（返回清理函数，unsub `repo:rtype-changed`）、`interface RecycleHost`（依赖宿主 `_root`/`_esc`/`_fmtSize`）
- 监听 bus：`repo:rtype-changed`
- 派发 bus：`toast:show`、`stats:refresh`、`tree:reload`、`model:select`
- Wails binding（动态 import bindings）：`ListRecycleBin`、`RestoreFromRecycle`、`DeleteFromRecycle`、`EmptyRecycleBin`、`GetRepoRoot`
- 依赖弹窗：`modalConfirm`（dialogs/modal.ts）

## 与其他子系统关系

- 由 [app_content](./app_content.md) 懒加载初始化，清理函数收进 `_unsubs`
- 后端删除/恢复实现见 [go_recycle](./go_recycle.md)（删除策略表：符号链接→直接删、硬链接 nlink>1→直接删、普通→移 `.recycle`、跨分区→复制后删，即致命陷阱 #8）
- 恢复/删除/清空后发 `stats:refresh` + `tree:reload` 联动 [app_tree](./app_tree.md) 与统计
- 确认弹窗走 [dialog_modal](./dialog_modal.md)，反馈走 [app_toast](./app_toast.md)

## 不变量

- `_loadGen` generation 守卫：每个 `await` 后 `if (gen !== _loadGen) return`，防止快速切换资源类型时旧结果覆盖新列表
- 清空回收站与单条永久删除必须先过 `modalConfirm`（danger 样式）二次确认，不可直接执行
- 列表仅显示路径前缀匹配当前类型 `GetRepoRoot` 根目录的条目，路径分隔符统一转 `/` 再比较
- 显示名需剥离 `.ban` 后缀（`replace(/\.(ysm|zip|7z)\.ban$/i, ".$1")`）后走 `renderDisplayName`
- 所有异常路径必须 toast 反馈（`friendlyError` 包装），恢复失败需回滚条目动画类

## 相关

- [go_recycle](./go_recycle.md) — 后端软删除/恢复实现与删除策略
- [dialog_modal](./dialog_modal.md) — modalConfirm 确认弹窗
- [app_content](./app_content.md) — 宿主组件与 tab 懒加载
- [app_tree](./app_tree.md) — 恢复后联动刷新的资源树
