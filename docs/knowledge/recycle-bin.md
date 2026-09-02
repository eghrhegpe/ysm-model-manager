---
kind: recycle-bin
name: 回收站界面 recycle-bin
tier: architecture
category: feature
source_files:
  - frontend/src/features/recycle-bin.ts
tests:
  - frontend/src/features/recycle-bin.test.ts
quick_groups:
  - 文件操作与标签
quick_intents:
  - 回收站、恢复文件、清空回收站
  - 软删除、recycle、还原
  - initRecycleBin / GetRepoRoot / createLoadGuard
quick_risk_lines:
  - 删除必须走 .recycle 软删除（go/recycle 实现），前端禁止直接 os.Remove
pitfalls:
  - 前端直调 os.Remove → 无法恢复、跳过 ADR-038 合并规则；必须经 go/recycle
  - initRecycleBin 不返回清理函数 → 监听泄漏；必须在 app-content 切换页时调用返回的清理函数

use_when:
  - 回收站
  - 恢复文件
  - 清空回收站
  - 软删除
  - recycle
  - 还原
perf:
  - io-bound
invariant_anchors:
  - frontend/src/features/recycle-bin.ts|GetRepoRoot
  - frontend/src/utils/async/load-guard.ts|createLoadGuard
status: active
---

# 回收站界面 recycle-bin

## 概览

`recycle-bin.ts` 实现仓库页「回收站」tab 的界面逻辑：列出 `.recycle` 中属于当前资源类型的已删除条目，提供单条恢复/永久删除、一键清空。由 app-content 首次切到 recycle tab 时懒加载调用 `initRecycleBin(this)`，返回清理函数。后端删除/恢复策略（符号链接/硬链接直接删、普通文件优先 `rename` 移入 `.recycle`、仅跨设备 EXDEV 时复制后删）在 Go 端 go/recycle 实现，本文件只做展示与调用。

条目粒度按 ADR-038 D3.4：**文件夹型模型（含 `ysm.json` 的目录）在后端 `List` 已整组合并为单一条目**（`Path` 指向目录、`Ext` 为空、`Size` 为目录递归总和），前端无需再做合并，恢复/删除按钮直接作用于整个目录。

## 核心职责

- `loadRecycleBin()`：`ListRecycleBin("")` 取全部条目 → `GetRepoRoot(currentType)` 按当前资源类型根目录前缀过滤 → 渲染条目（名称走 `renderDisplayName`、大小走宿主 `_fmtSize`、完整路径展示）；类型图标取自 `loadResourceRegistry()`
- generation 守卫：`createLoadGuard()`（utils/async/load-guard.ts，与 oldest-models 共用）每次加载自增代数，`await` 后比对 `guard.isStale()`，过期请求的结果直接丢弃，不覆盖新列表；重载入口先 `guard.invalidate()`（含 catch 分支）
- 单条恢复：按钮 `disabled` 自锁 + `leaving` 离场动画（150ms）后 `RestoreFromRecycle(path, "")`，成功后重载列表并广播刷新；失败回滚 `leaving` 类并解锁按钮
- 单条删除：`modalConfirm` 二次确认后同样自锁 + 动画 → `DeleteFromRecycle(path)`
- 清空回收站：`modalConfirm`（danger）确认后 `EmptyRecycleBin("")`，toast 回报数量
- 监听 `repo:rtype-changed`：资源类型切换时更新 `currentType` 并重载列表
- 条目名称区点击 → `bus.emit("model:select", { path })` 查看详情：**在 init 阶段对列表容器做一次事件委托**（`onListClick`，命中 `.recy-restore`/`.recy-del` 时短路），不在每次渲染时逐元素绑定，避免监听泄漏

## 对外 API / 入口

- 导出：`initRecycleBin(app: RecycleHost): () => void`、`interface RecycleHost`（依赖宿主 `_root`/`_esc`/`_fmtSize`）
- 清理函数：unsub `repo:rtype-changed` + 成对 `removeEventListener` 列表委托 `onListClick`、`recy-refresh` 的 `onRefreshClick`、`recy-empty` 的 `onEmptyClick`
- 监听 bus：`repo:rtype-changed`
- 派发 bus：`toast:show`、`stats:refresh`、`tree:reload`、`model:select`
- Wails binding（动态 import bindings）：`ListRecycleBin`、`RestoreFromRecycle`、`DeleteFromRecycle`、`EmptyRecycleBin`、`GetRepoRoot`
- 依赖弹窗：`modalConfirm`（dialogs/modal.ts）

## 与其他子系统关系

- 由 [app_content](./app-content.md) 懒加载初始化，清理函数收进 `_unsubs`
- 后端删除/恢复实现见 [go_recycle](./go-recycle.md)（删除策略表：符号链接→直接删、硬链接 nlink>1→直接删、普通→优先 `rename` 移入 `.recycle`、仅 EXDEV 跨设备→复制后删，即致命陷阱 #8）
- 条目整组合并（ADR-038 D3.4）由后端 `recycle.List` 完成，前端一条即一个模型（目录或单文件）
- 恢复/删除/清空后发 `stats:refresh` + `tree:reload` 联动 [app_tree](./app-tree.md) 与统计（删除路径已补发，P2 修复）
- 确认弹窗走 [dialog_modal](./dialog-modal.md)，反馈走 [app_toast](./app-toast.md)

## 不变量

- load-guard generation 守卫：`createLoadGuard()` 每个 `await` 后比对代数，过期即弃，防止快速切换资源类型时旧结果覆盖新列表（首个守卫在 GetRepoRoot/ListRecycleBin await 后；getApp await 前无守卫，语义成立）
- 清空回收站与单条永久删除必须先过 `modalConfirm`（danger 样式）二次确认，不可直接执行
- 列表仅显示路径前缀匹配当前类型 `GetRepoRoot` 根目录的条目（**带路径分隔符边界**：`path === root || path.startsWith(root + "/")`，防 `ysm2/` 误入 `ysm/`，P3 修复），路径分隔符统一转 `/` 再比较；`GetRepoRoot` 返回空时回退显示全量条目（回退语义属设计取舍）；**空 `Path` 条目一律排除**（P3 修复：防回退全量时渲染 `data-path=""` 点击发 `model:select {path:""}`）
- 显示名需剥离 `.ban` 后缀（`replace(/\.(ysm|zip|7z)\.ban$/i, ".$1")`）后走 `renderDisplayName`
- 列表点击监听只在 init 绑一次并在 cleanup 成对移除；渲染时 `innerHTML` 重建的按钮用 `btn.onclick` 赋值（覆盖式，不累积）。**⚠️ 技术债（P2，见 ADR-034 §5.1）**：列表容器已用 `onListClick` 事件委托（第 119 行），但条目按钮仍走 `btn.onclick` 逐元素直接绑定（第 184 行），双范式并存导致 cleanup 仅撤委托监听、未撤 `onclick`，组件销毁后悬空按钮可能触发后端。第 8 批 `listEl.innerHTML=""` 是对症止血，根治需把 `btn.onclick` 收编进 `onListClick` 委托分发。
- 所有异常路径必须 toast 反馈（`friendlyError` 包装，`loadRecycleBin` 失败分支走列表内联错误渲染属例外——用户仍可见错误但非 toast，知识卡措辞已限定），恢复/删除失败需回滚条目 `leaving` 类并把按钮 `disabled` 解锁

## 相关

- [go_recycle](./go-recycle.md) — 后端软删除/恢复实现与删除策略
- [dialog_modal](./dialog-modal.md) — modalConfirm 确认弹窗
- [app_content](./app-content.md) — 宿主组件与 tab 懒加载
- [app_tree](./app-tree.md) — 恢复后联动刷新的资源树
