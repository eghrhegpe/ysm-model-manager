---
kind: global-handlers
name: 全局事件处理 global-handlers
tier: architecture
category: core
source_files:
  - frontend/src/core/handlers/global.ts
  - frontend/src/core/handlers/dnd.ts
  - frontend/src/core/handlers/instance-ops.ts
  - frontend/src/core/handlers/sync.ts
  - frontend/src/core/handlers/require-mcroot.ts
  - frontend/src/core/error-diary.ts
use_when:
  - 全局事件
  - 拖拽导入
  - 拖拽遮罩
  - 同步缺失
  - 清空整合包
  - 导出清单
---

# 全局事件处理 global-handlers

## 概览

`core/handlers/global.ts` 是全应用唯一的全局 handler 注册入口（致命陷阱 #2 的解法）：app-content 的 `connectedCallback` 调一次 `registerGlobalHandlers()`，把页面状态、右键菜单、DnD 拖拽、整合包同步、整合包操作、资源管理器六组子 handler 的 unsub 函数全部收回，`disconnectedCallback` 统一释放。页面切换时 handler 不丢、不重复累积。

## 核心职责

- `registerGlobalHandlers()`：依次调 `registerPageStore`/`registerContextMenus`/`registerDnD`/`registerSync`/`registerInstanceOps`/`registerResourceManagerGlobal`，返回 unsub 数组
- `dnd.ts`（registerDnD）：document 级 `dragenter`/`dragover`/`dragleave`/`drop`/`dragend`；隐藏状态由 `dragenter`+1/`dragleave`−1 的深度计数器唯一决定（`dragDepth===0` 才真正隐藏，子元素穿梭不再误判），`dragleave` 检测 `relatedTarget===null` 或坐标越出视口即立即隐藏（覆盖 OS 文件拖出窗口松手、dragend 不触发的卡死场景），`drop`/`dragend` 兜底归零；已废弃旧的 50ms 防抖方案（拖拽停顿会误隐藏）；仅 `PageStore.currentPage === "repository"` 且 `dataTransfer.types` 含 `"Files"` 时显示「放开以导入模型」遮罩（无模型文件变红示警）；drop 经 `webkitGetAsEntry` 递归收集文件夹（`entry.file(resolve, reject)` Promise 化，深度上限 10；readEntries 带错误回调 + 3s 超时兜底，防 WebView2 目录读取挂起 onDrop），单个文件 ≤100MB；收集到的文件经 `import-executor` 全局执行器（`directImport`）入仓，完成后广播 `import:history-changed` 驱动导入页刷新列表（致命陷阱 #10 的解法）
- `sync.ts`（registerSync）：`sync:download:missing` — 按 `GetResourceInstanceStatus` 的 Missing 列表逐文件 `InstallModelTo`/`InstallResourceToInstance`，完成后 `InvalidateScanCache`，`finally` 必发 `sync:download:done`（带 token）+ `tree:reload`；`sync:toggle:status` — 遍历整合包 `SyncModelToggleStatus` 同步启用/禁用并写 `AddImportLog`，`finally` 发 `tree:reload`（致命陷阱 #3 的解法；`_toggleBusy` 并发守卫防连点竞态）
- `instance-ops.ts`（registerInstanceOps）：`instance:export-list` — `GetSubDirMap` + `ListFileNames` 汇总清单写剪贴板；`instance:clear` — `CountInstanceResources` 统计后 `modalConfirm` 二次确认，`ClearInstanceResources` 执行（走回收站可恢复）
- `require-mcroot.ts`（`requireMcRoot()`）：读取游戏目录（`LoadAppConfig` 的 mcRoot），未配置时发 warn toast 并返回 null（配置守卫，去重 D-1）
- `error-diary.ts`（`registerErrorDiary()`）：`toast:show` 的 error/warn → `AddOpLog` 落日记，另捕获 `window.onerror`/`unhandledrejection`；注册在 app-modules 启动期，不属于 registerGlobalHandlers

## 对外 API / 入口

- 导出：`registerGlobalHandlers(): Array<() => void>`、`registerDnD(unsubs)`、`registerSync(unsubs)`、`registerInstanceOps(unsubs)`
- 监听 bus：`sync:download:missing`、`sync:toggle:status`、`instance:export-list`、`instance:clear`
- 派发 bus：`toast:show`、`stats:refresh`、`tree:reload`、`sync:download:done`
- DOM 监听：document 的 `dragenter`/`dragover`/`dragleave`/`drop`/`dragend`（registerDnD 内，unsub 配对完整）
- getApp()/binding 调用：`ImportModelFile`（经 import-executor 的 directImport 间接调用）、`LoadAppConfig`、`ListVersionInstances`、`GetResourceInstanceStatus`、`InstallModelTo`、`InstallResourceToInstance`、`GetRepoRoot`、`InvalidateScanCache`、`SyncModelToggleStatus`、`AddImportLog`、`ListFileNames`、`GetSubDirMap`、`CountInstanceResources`、`ClearInstanceResources`

## 与其他子系统关系

- 唯一调用方 [app_content](./app-content.md)：`connectedCallback` 注册、`disconnectedCallback` 逐个 unsub
- 收集到的文件经 [import_queue](./import-queue.md) 的全局执行器入仓，导入完成后经 `import:history-changed` 驱动其刷新已导入列表
- 页面判断依赖 [page_store](./page-store.md)；同步执行后端见 [go_sync](./go-sync.md)/[go_installer](./go-installer.md)；清空整合包走 [go_recycle](./go-recycle.md) 回收站
- 确认弹窗走 [dialog_modal](./dialog-modal.md)，反馈走 [app_toast](./app-toast.md)

## 不变量

- 全局 handler 只能在 app-content 单点注册一次，子模块必须以「push unsub 进数组」形式交还清理权，禁止组件内各自注册 document 级事件（致命陷阱 #2）
- `sync:download:missing` 的完成事件必须放 `finally`（含 token），保证按钮方无论成败都能解锁（致命陷阱 #3）
- DnD 收集必须走 `webkitGetAsEntry` 并在不支持时回退 `getAsFile`；`entry.file` 回调必须 Promise 化（致命陷阱 #10）
- 遮罩隐藏由 `dragenter`/`dragleave` 深度计数器唯一决定（`dragDepth===0` 才隐藏），`dragleave` 检测 `relatedTarget===null`/坐标越界立即隐藏（覆盖 OS 文件拖出窗口松手、dragend 不触发的卡死场景）；旧 50ms 防抖方案已废弃（拖拽停顿会误隐藏）

## 相关

- [app_content](./app-content.md) — 注册与清理宿主
- [import_queue](./import-queue.md) — 导入页 UI 与已导入列表刷新
- [page_store](./page-store.md) — 页面状态判断
- [go_sync](./go-sync.md) — 同步后端实现
