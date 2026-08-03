---
kind: import_queue
name: 导入队列 import-queue
tier: architecture
category: feature
source_files:
  - frontend/js/features/import-queue.ts
use_when:
  - 导入
  - 导入队列
  - 拖拽导入
  - 命名表单
  - 文件夹导入
  - 覆盖导入
  - import
---

# 导入队列 import-queue

## 概览

`import-queue.ts` 实现仓库页「导入」tab 的完整导入流程：拖拽区/文件选择/文件夹选择收文件 → 按扩展名与内容分流（YSM 进命名表单，其他注册扩展名直接导入）→ 队列逐个编辑命名 → 调 Go 端落盘。由 app-content 在首次切到 import tab 时懒加载调用 `initImportQueue(this)`，返回的清理函数收进 `_unsubs`。

## 核心职责

- 拖拽区内独立的 `dragover`/`dragleave`/`drop` 处理（`stopPropagation` 阻止冒泡到全局 DnD handler），`webkitGetAsEntry` 递归读取文件夹（`readEntry`，`readEntries` 单批 100 条循环读空为止），回调式 `entry.file()` 包在回调里处理
- `shouldEnterForm(name, base64)`：`.ysm` / `ysm.json` 恒进表单；`.zip`/`.7z` 调 `DetectZipType` 检测内容决定；其他注册扩展名（`ALL_EXTS`）直接导入
- 命名表单：`parseModelName` 预填作者/作品/角色/日期，实时预览，勾选「读取作者」时调 `ExtractYSMHeader` 自动填作者；`SavePreviewTempFile` 存临时文件后 `bus.emit("model:select")` 驱动右侧预览
- 队列状态：`fileQueue`（待处理）与 `imported`（已导入）双列表，`enqueueFile` 有重名去重守卫；仓库已有文件名缓存 `repoFiles`（`ScanModelEntries` 加载）用于队列行 ⚠️ 重名预警
- 导入落盘：`ImportModelFileTo(finalName, subpath, base64)`，捕获 `FILE_EXISTS`/「文件已存在」后 `modalConfirm` 二次确认走 `ImportModelFileOverwriteTo` 覆盖分支；非 YSM 走 `directImport` → `ImportModelFile`
- 已导入项 ✂️ 按钮 → `showRenameDialog` + `RenameFile` 重命名
- 消费全局拖拽遗留文件：`bus.on("import:pending-files")` 处理从其他页面拖入的文件，先 `DnDLock.acquire()` 成功才 `PendingImport.clear()`

## 对外 API / 入口

- 导出：`initImportQueue(app: ImportQueueHost): () => void`（返回清理函数，内部 unsub `import:pending-files`）、`interface ImportQueueHost`（依赖宿主 `_root`/`_esc`）
- 监听 bus：`import:pending-files`
- 派发 bus：`model:select`、`toast:show`、`stats:refresh`、`tree:reload`
- getApp() 调用：`DetectZipType`、`SavePreviewTempFile`、`ExtractYSMHeader`、`LoadAppConfig`、`ImportModelFileTo`、`ImportModelFileOverwriteTo`、`ImportModelFile`、`ScanModelEntries`、`GetRepoRoot`、`RenameFile`
- 依赖弹窗：`showRenameDialog`（dialogs/rename.ts）、`modalConfirm`（dialogs/modal.ts）

## 与其他子系统关系

- 由 [app_content](./app_content.md) 懒加载初始化；清理函数收进组件 `_unsubs` 统一在 `disconnectedCallback` 释放
- 与 [global_handlers](./global_handlers.md) 分工：全局 DnD 在仓库页内把 YSM 文件写入 `PendingImport` 并发 `import:pending-files`/`repo:switch-tab`，本模块消费
- `DnDLock` / `PendingImport` 状态来自 `features/dnd-state.ts`（见 [global_handlers](./global_handlers.md)）
- 导入成功后发 `stats:refresh` + `tree:reload` 联动 [app_tree](./app_tree.md) 与统计；落盘策略见 [go_importer](./go_importer.md)

## 不变量

- 消费 `PendingImport` 必须先 `DnDLock.acquire()` 成功才清空队列，锁被占时直接返回，避免文件静默丢失
- 拖拽区内事件必须 `stopPropagation`，否则与全局 DnD 遮罩双重触发
- `enqueueFile` 重名去重：`fileQueue` 与 `imported` 中已有同名文件则跳过
- 覆盖分支仅在 Go 返回 `FILE_EXISTS`/「文件已存在」时经 `modalConfirm` 确认后执行，且 `finalName` 在 try 外声明保证 catch 可见
- 拖拽区点击有 500ms `clickLocked` 节流，防抖出双开文件选择器

## 相关

- [global_handlers](./global_handlers.md) — 全局拖拽入口与 DnD 锁
- [dialog_rename](./dialog_rename.md) — 导入确认与重命名弹窗
- [dialog_modal](./dialog_modal.md) — 覆盖确认 modalConfirm
- [app_content](./app_content.md) — 宿主组件与 tab 懒加载
