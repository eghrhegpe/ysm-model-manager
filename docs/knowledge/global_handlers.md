---
kind: global_handlers
name: 全局事件处理 global-handlers
tier: architecture
category: core
source_files:
  - frontend/js/core/global-handlers.ts
  - frontend/js/core/handler-dnd.ts
  - frontend/js/core/handler-other.ts
  - frontend/js/core/handler-sync.ts
  - frontend/js/features/dnd-state.ts
use_when:
  - 全局事件
  - 拖拽导入
  - 拖拽遮罩
  - 同步缺失
  - 清空整合包
  - 导出清单
  - DnD 锁
  - 待导入队列
---

# 全局事件处理 global-handlers

## 概览

`core/global-handlers.ts` 是全应用唯一的全局 handler 注册入口（致命陷阱 #2 的解法）：app-content 的 `connectedCallback` 调一次 `registerGlobalHandlers()`，把 DnD 拖拽、整合包同步、整合包操作三组子 handler 的 unsub 函数全部收回，`disconnectedCallback` 统一释放。页面切换时 handler 不丢、不重复累积。`features/dnd-state.ts` 提供配套的 DnD 锁与待导入队列状态。

## 核心职责

- `registerGlobalHandlers()`：依次调 `registerDnD`/`registerSync`/`registerInstanceOps`，返回 unsub 数组
- `handler-dnd.ts`（registerDnD）：document 级 `dragover`/`dragleave`（隐藏遮罩防抖 50ms）/`drop`/`dragend`；仅 `PageStore.currentPage === "repository"` 且 `dataTransfer.types` 含 `"Files"` 时显示「放开以导入模型」遮罩（无模型文件变红示警）；drop 经 `webkitGetAsEntry` 递归收集文件夹（`entry.file(resolve, reject)` Promise 化，深度上限 10），限制单次 ≤50 个、单个 ≤100MB；非 YSM 直接 `ImportModelFile`，YSM/判定为 YSM 的压缩包写入 `PendingImport` 并经 `import:pending-files`/`nav:change` + `repo:switch-tab` 引到导入页（致命陷阱 #10 的解法）
- `handler-sync.ts`（registerSync）：`sync:download:missing` — 按 `GetResourceInstanceStatus` 的 Missing 列表逐文件 `InstallModelTo`/`InstallResourceToInstance`，完成后 `InvalidateScanCache`，`finally` 必发 `sync:download:done`（带 token）+ `tree:reload`；`sync:toggle:status` — 遍历整合包 `SyncModelToggleStatus` 同步启用/禁用并写 `AddImportLog`，`finally` 发 `tree:reload`（致命陷阱 #3 的解法）
- `handler-other.ts`（registerInstanceOps）：`instance:export-list` — `GetSubDirMap` + `ListFileNames` 汇总清单写剪贴板；`instance:clear` — `CountInstanceResources` 统计后 `modalConfirm` 二次确认，`ClearInstanceResources` 执行（走回收站可恢复）
- `dnd-state.ts`：`DnDLock`（`locked`/`acquire()`/`release()`，状态变化广播 `dnd:lock-changed`）与 `PendingImport`（`queue`/`setQueue()`/`clear()`，广播 `import:pending-changed`）

## 对外 API / 入口

- 导出：`registerGlobalHandlers(): Array<() => void>`、`registerDnD(unsubs)`、`registerSync(unsubs)`、`registerInstanceOps(unsubs)`、`DnDLock`、`PendingImport`
- 监听 bus：`sync:download:missing`、`sync:toggle:status`、`instance:export-list`、`instance:clear`
- 派发 bus：`toast:show`、`stats:refresh`、`tree:reload`、`sync:download:done`、`import:pending-files`、`nav:change`、`repo:switch-tab`、`dnd:lock-changed`、`import:pending-changed`
- DOM 监听：document 的 `dragover`/`dragleave`/`drop`/`dragend`（registerDnD 内，unsub 配对完整）
- getApp()/binding 调用：`DetectZipType`、`ImportModelFile`、`LoadAppConfig`、`ListVersionInstances`、`GetResourceInstanceStatus`、`InstallModelTo`、`InstallResourceToInstance`、`GetRepoRoot`、`InvalidateScanCache`、`SyncModelToggleStatus`、`AddImportLog`、`ListFileNames`、`GetSubDirMap`、`CountInstanceResources`、`ClearInstanceResources`

## 与其他子系统关系

- 唯一调用方 [app_content](./app_content.md)：`connectedCallback` 注册、`disconnectedCallback` 逐个 unsub
- YSM 文件最终交给 [import_queue](./import_queue.md) 消费（`PendingImport` + `import:pending-files`）
- 页面判断依赖 [page_store](./page_store.md)；同步执行后端见 [go_sync](./go_sync.md)/[go_installer](./go_installer.md)；清空整合包走 [go_recycle](./go_recycle.md) 回收站
- 确认弹窗走 [dialog_modal](./dialog_modal.md)，反馈走 [app_toast](./app_toast.md)

## 不变量

- 全局 handler 只能在 app-content 单点注册一次，子模块必须以「push unsub 进数组」形式交还清理权，禁止组件内各自注册 document 级事件（致命陷阱 #2）
- `sync:download:missing` 的完成事件必须放 `finally`（含 token），保证按钮方无论成败都能解锁（致命陷阱 #3）
- DnD 收集必须走 `webkitGetAsEntry` 并在不支持时回退 `getAsFile`；`entry.file` 回调必须 Promise 化（致命陷阱 #10）
- `DnDLock.locked` 为真时 drop 直接忽略，防止导入进行中二次拖入
- 遮罩隐藏有 50ms 防抖与 `dragend` 兜底，dragleave/drop 不触发时也能收起

## 相关

- [app_content](./app_content.md) — 注册与清理宿主
- [import_queue](./import_queue.md) — 待导入文件消费方
- [page_store](./page_store.md) — 页面状态判断
- [go_sync](./go_sync.md) — 同步后端实现
