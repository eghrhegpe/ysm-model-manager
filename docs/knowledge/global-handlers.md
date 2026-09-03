---
kind: global-handlers
name: 全局事件处理 global-handlers
tier: architecture
category: core
source_files:
  - frontend/src/core/handlers/global.ts
  - frontend/src/features/import-dnd.ts
  - frontend/src/core/handlers/instance-ops.ts
  - frontend/src/core/handlers/sync.ts
  - frontend/src/core/handlers/require-mcroot.ts
  - frontend/src/core/error-diary.ts
auto_fields:
  symbols_with_lines:
    - __TEST__resetDiary
    - bindTreeDnD
    - handleTreeDrop
    - registerErrorDiary
    - registerGlobalHandlers
    - registerInstanceOps
    - registerSync
    - requireMcRoot
  tests:
    - frontend/src/core/error-diary.test.ts
    - frontend/src/features/import-dnd.test.ts
    - frontend/src/core/handlers/instance-ops.test.ts
    - frontend/src/core/handlers/sync.test.ts
    - frontend/src/features/dnd-shared.test.ts
tests:
  - frontend/src/core/error-diary.test.ts
  - frontend/src/features/import-dnd.test.ts
  - frontend/src/core/handlers/instance-ops.test.ts
  - frontend/src/core/handlers/sync.test.ts
  - frontend/src/features/dnd-shared.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 全局事件、拖拽导入、拖拽提示
  - 同步缺失、清空整合包、导出清单
  - registerGlobalHandlers、instance-ops
quick_risk_lines:
  - 全局事件必须经 global-handlers 单点注册，禁止各页面各自 bindGlobalHandler
pitfalls:
  - 各页面各自注册全局事件 → 重复绑定、冲突处理；必须经 global-handlers 单点
  - 拖拽导入未进 import-dnd → 与全局拖拽状态冲突；必须经 features/import-dnd.ts

use_when:
  - 全局事件
  - 拖拽导入
  - 拖拽提示
  - 同步缺失
  - 清空整合包
  - 导出清单
invariant_anchors:
  - frontend/src/core/handlers/global.ts|registerGlobalHandlers
status: active
---

# 全局事件处理 global-handlers

## 概览

`core/handlers/global.ts` 是全应用唯一的 core 全局 handler 注册入口（致命陷阱 #2 的解法）：app-content 的 `connectedCallback` 调一次 `registerGlobalHandlers()`，把页面状态、右键菜单、同步、实例操作、Android 事件五组 core handler 的 unsub 函数收回，另单独调用 `registerResourceManagerGlobal()` 收资源管理器全局 handler，`disconnectedCallback` 统一释放。页面切换时 handler 不丢、不重复累积。仓库页 DnD（ADR-060）已收敛为 `app-tree` 组件级绑定，不再注册 document 级全局 DnD。

## 核心职责

- `registerGlobalHandlers()`：**实际注册 5 组**（registerPageStore/registerContextMenus/registerSync/registerInstanceOps/registerAndroidEvents），返回 unsub 数组；`registerResourceManagerGlobal` 由 app-content 单独编排（index.ts registerResourceManagerGlobal 调用点，文件头注释自述「features/views 层注册由 app-content 编排」）——功能单点注册不变量仍成立（app-content 单点注册/单点释放）
- **`sync:download:missing` busy 命中必须回 `done` 带 `skipped: true`**（P1 修复：原 `_downloadBusy` 命中直接 return 不发 done，app-sidebar 推送多实例/全类型时后续请求 30s 超时或经 instanceName fallback 误判成功）
- `import-dnd.ts`（bindTreeDnD，ADR-060）：组件级绑定，不再 document 监听；`<app-tree>` 的 `connectedCallback` 对 `#tree` 容器调用 `bindTreeDnD(treeEl)`，监听 `dragover`/`dragleave`/`drop` 并返回 cleanup；`dragover` 命中 Files 时显示 `#tree-drop-hint`（`.tree-drop-hint`）显式提示，drop/dragleave 隐藏；drop 经 `features/dnd-collector.ts` 的 `collectFiles` 递归收集文件夹（`entry.file` Promise 化，深度上限 10；readEntries 带错误回调 + 3s 超时兜底，防 WebView2 目录读取挂起 onDrop；不支持 `webkitGetAsEntry` 时回退 `getAsFile`），单个文件 ≤100MB；收集到的文件经 `import-executor` 全局执行器（`directImport`）入仓，完成后广播 `import:history-changed` 驱动导入页刷新列表（致命陷阱 #10 的解法）
- `sync.ts`（registerSync）：`sync:download:missing` — 按 `GetResourceInstanceStatus` 的 Missing 列表逐文件 `InstallModelTo`/`InstallResourceToInstance`，完成后 `InvalidateScanCache`，`finally` 必发 `sync:download:done`（带 token）；`tree:reload` 仅在实际完成安装时广播（P2 审核修复：配置缺失短路无写操作不触发全树重扫）；`sync:toggle:status` — 遍历整合包 `SyncModelToggleStatus` 同步启用/禁用并写 `AddImportLog`，`finally` 发 `tree:reload`（致命陷阱 #3 的解法；`_toggleBusy` 并发守卫防连点竞态）
- `instance-ops.ts`（registerInstanceOps）：`instance:export-list` — `GetSubDirMap` + `ListFileNames` 汇总清单写剪贴板；`instance:clear` — `CountInstanceResources` 统计后 `modalConfirm` 二次确认，`ClearInstanceResources` 执行（走回收站可恢复）
- `require-mcroot.ts`（`requireMcRoot()`）：读取游戏目录（`LoadAppConfig` 的 mcRoot），未配置时发 warn toast 并返回 null（配置守卫，去重 D-1）
- `error-diary.ts`（`registerErrorDiary()`）：`toast:show` 的 error/warn → `AddOpLog` 落日记，另捕获 `window.onerror`/`unhandledrejection`；注册在 app-modules 启动期，不属于 registerGlobalHandlers

## 对外 API / 入口

- 导出：`registerGlobalHandlers(): Array<() => void>`、`registerSync(unsubs)`、`registerInstanceOps(unsubs)`；`registerResourceManagerGlobal(unsubs)` 由 app-content 单独调用
- DnD 导出：`features/import-dnd.ts` 的 `bindTreeDnD(container): () => void`，由 `<app-tree>` 内部绑定
- 监听 bus：`sync:download:missing`、`sync:toggle:status`、`instance:export-list`、`instance:clear`
- 派发 bus：`toast:show`、`stats:refresh`、`tree:reload`、`sync:download:done`
- DOM 监听：仓库页 DnD 为组件容器 `#tree` 上的 `dragover`/`dragleave`/`drop`（bindTreeDnD 内，cleanup 配对完整）；不再有 document 级 DnD 监听
- getApp()/binding 调用：`ImportModelFile`（经 import-executor 的 directImport 间接调用）、`LoadAppConfig`、`ListVersionInstances`、`GetResourceInstanceStatus`、`InstallModelTo`、`InstallResourceToInstance`、`GetRepoRoot`、`InvalidateScanCache`、`SyncModelToggleStatus`、`AddImportLog`、`ListFileNames`、`GetSubDirMap`、`CountInstanceResources`、`ClearInstanceResources`

## 与其他子系统关系

- `registerGlobalHandlers()` 唯一调用方 [app_content](./app-content.md)：`connectedCallback` 注册、`disconnectedCallback` 逐个 unsub；`bindTreeDnD` 唯一调用方 [app_tree](./app-tree.md)
- 收集到的文件经 [import_queue](./import-queue.md) 的全局执行器入仓，导入完成后经 `import:history-changed` 驱动其刷新已导入列表
- 页面判断依赖 [page_store](./page-store.md)；同步执行后端见 [go_sync](./go-sync.md)/[go_installer](./go-installer.md)；清空整合包走 [go_recycle](./go-recycle.md) 回收站
- 确认弹窗走 [dialog_modal](./dialog-modal.md)，反馈走 [app_toast](./app-toast.md)

## 不变量

- 全局 handler 只能在 app-content 单点注册一次；features/views 层事件（如仓库页 DnD）按 ADR-060 在组件内绑定，必须以 cleanup 函数交还清理权，禁止再注册 document 级全局 DnD/遮罩（致命陷阱 #2）
- `sync:download:missing` 的完成事件必须放 `finally`（含 token），保证按钮方无论成败都能解锁（致命陷阱 #3）
- DnD 收集必须走 `webkitGetAsEntry` 并在不支持时回退 `getAsFile`；`entry.file` 回调必须 Promise 化（致命陷阱 #10）
- DnD 提示显隐由 `bindTreeDnD` 的 `dragover`/`dragleave`/`drop` 驱动：`dragover` 命中 Files 时显示 `#tree-drop-hint`，`drop`/真正离开容器时隐藏；不再依赖 `dragDepth` 深度计数器或 `#global-drop-overlay`（ADR-060）
- **类型安全事件处理器模式**（审计发现）：存储 `EventListener` 时使用具体类型（`EventListener`）而非 `unknown as () => void`。`removeEventListener` 要求传入的函数与 `addEventListener` 时传入的函数是**同一个引用**，类型转换会破坏引用相等性导致无法移除（P3）。`error-diary.ts` 已修复：`_unsubError`/`_unsubRejection` 改为 `EventListener` 类型。

## 相关

- [app_content](./app-content.md) — 注册与清理宿主
- [import_queue](./import-queue.md) — 导入页 UI 与已导入列表刷新
- [page_store](./page-store.md) — 页面状态判断
- [go_sync](./go-sync.md) — 同步后端实现
