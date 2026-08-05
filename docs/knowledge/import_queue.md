---
kind: import_queue
name: 导入队列 import-queue
tier: architecture
category: feature
source_files:
  - frontend/src/features/import-queue.ts
  - frontend/src/features/dnd-shared.ts
  - frontend/src/features/import-executor.ts
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

导入分两层：**全局导入执行器 `import-executor.ts`（一等公民）** 负责真正的落盘（`directImport` 单文件直导 / `importFolder` 文件夹整组 / `executeCollected` 批量路由）与内存导入历史 `ImportHistory`；**`import-queue.ts`** 只是仓库页「导入」tab 的界面层：拖拽区/文件选择/文件夹选择收文件 → `shouldEnterForm` 分流（仅 `ysm.json` 进命名表单，其余全部转发执行器直导）→ 渲染队列与已导入列表。由 app-content 在首次切到 import tab 时懒加载调用 `initImportQueue(this)`，返回的清理函数收进 `_unsubs`。

全局拖拽（handlers/dnd.ts）**不再切到导入 tab、不再弹表单**，直接调 `executeCollected` 静默入仓，完成后经 `import:history-changed` 驱动本 tab 刷新。

## 核心职责

### import-executor.ts（全局执行器）

- `directImport(file)`：`FileReader` 读 base64 → `ImportModelFile(name, base64)`（保留原文件名，类型路由/冲突判定全在 Go 端）→ 写 `ImportHistory` → `stats:refresh`+`tree:reload`+toast
- `importFolder(dir, files)`：按顶层目录名为模型名、`dir` 前缀之前的路径为 `subpath`，逐个文件转 base64 后调 `ImportModelFolder(folderName, subpath, items)`（保留嵌套层级）；捕获 `FILE_EXISTS`/「目标已存在」时提示改名重导
- `executeCollected(collected)`：`groupCollected` 分组后先整组文件夹、后散落单文件，返回 `{ folders, singles }` 计数供调用方判空
- `ImportHistory`：模块级内存历史（`records` / `push` / `rename` / `clear`），每次变更 `bus.emit("import:history-changed")`

### import-queue.ts（导入 tab 界面）

- 拖拽区内独立的 `dragover`/`dragleave`/`drop` 处理（`stopPropagation` 阻止冒泡到全局 DnD handler），`webkitGetAsEntry` 递归读取文件夹（`collectEntry`，`readEntries` 单批 100 条循环读空为止）
- `shouldEnterForm(name, base64)`（dnd-shared.ts）：**仅 `ysm.json` 返回 true**；`.ysm`/`.zip`/`.7z` 及其他注册扩展名一律 false → 走 `directImport` 保留原名，ZIP 内容类型检测下沉 Go 端 `importer.DetectZipType`
- 命名表单：`parseModelName` 预填作者/作品/角色/日期，实时预览；勾选「读取作者」调 `ExtractYSMHeaderFromBase64` 自动填作者与 tips；`SavePreviewTempFile` 存临时文件后 `bus.emit("model:select")` 驱动右侧预览
- 队列状态：本地 `fileQueue`（待处理）+ 全局 `ImportHistory.records`（已导入，渲染数据源）；`enqueueFile` 对两者做重名去重；仓库已有文件名缓存 `repoFiles`（`ScanModelEntries` 加载）用于队列行 ⚠️ 重名预警
- 表单落盘：`showRenameDialog(null, newName)` 确认最终名 → `ImportModelFileTo(finalName, subpath, base64)`；捕获 `FILE_EXISTS`/「文件已存在」后 `modalConfirm` 二次确认走 `ImportModelFileOverwriteTo` 覆盖分支
- 已导入项 ✂️ 按钮 → `showRenameDialog` + `RenameFile`，成功后 `ImportHistory.rename` 同步历史

## 对外 API / 入口

- import-queue.ts 导出：`initImportQueue(app: ImportQueueHost): () => void`（清理函数：清 `conflictTimer`、成对 remove 全部 `on()` 注册的监听、unsub `import:history-changed`）、`interface ImportQueueHost`（依赖宿主 `_root`/`_esc`）
- import-executor.ts 导出：`directImport`、`importFolder`、`executeCollected`、`ImportHistory`、`isImportableFile`（透传 dnd-shared）、类型 `ImportFile`/`ImportRecord`/`CollectedEntry`
- dnd-shared.ts 导出：`isSupportedFile`、`isImportableFile`、`shouldEnterForm`、`getExt`、`groupCollected`、类型 `CollectedEntry`/`FolderGroup`
- 监听 bus：`import:history-changed`
- 派发 bus：`model:select`、`toast:show`、`stats:refresh`、`tree:reload`
- getApp() 调用：import-queue → `SavePreviewTempFile`、`ExtractYSMHeaderFromBase64`、`CheckFileExists`、`LoadAppConfig`、`ImportModelFileTo`、`ImportModelFileOverwriteTo`、`ScanModelEntries`、`GetRepoRoot`、`RenameFile`；import-executor → `ImportModelFile`、`ImportModelFolder`
- 依赖弹窗：`showRenameDialog`（dialogs/rename.ts）、`modalConfirm`（dialogs/modal.ts）

## 关键机制

- **静默直导**：`readAndRouteFile` 读完 base64 后，非表单文件直接 `await execDirectImport(file)`（执行器内部重新读一次 base64，历史/去重/toast 单点）；`routeCollected` 与执行器 `executeCollected` 语义一致（文件夹整组 → 散落单文件）
- **并发/重复守卫**：执行器持 per-file `_inFlight: Set<string>`，同名文件在途时 `directImport` 直接返回（拦重复与并发重导），不同文件仍可并行；导入 tab 另有 `_importing` 布尔守卫，`dl-import` 与 ✂️ 重命名共用槽位防连点
- **ysm.json 单文件拦截**：`directImport` 遇 `ysm.json` 单文件（光杆清单）不导入，toast 引导拖入整个模型文件夹走整组路径
- **队列顺序流转**：落盘成功后 `findIndex` + `splice` 摘掉已导入项，`advanceQueue()` 若队列非空则 `showForm(fileQueue[0])`，否则 `toggleForm(false)` 回到拖拽区
- **命名解析**：`parseModelName` 按 `[作者]作品-角色` 命名模式预填 author/work/chara 字段（来自 utils/dom/display.ts）；未填角色名则沿用原文件名
- **冲突提示两条线**：表单内 `checkConflictDebounced`（400ms 防抖 → `CheckFileExists` → 显隐 `dl-conflict`）；队列行 ⚠️ 来自 `repoFiles` 名称缓存比对
- **异步 fail-soft**：`collectEntry` 把回调式 `entry.file()` Promise 化并补 rejection handler（executor 同步异常不会让 Promise 永不 resolve）；`processDropItems` 的 `Promise.all` 链补 `.catch`；`showForm` 内 `setTimeout(async …)` 包 try/catch——三处缺一都会导致拖拽导入静默卡死
- **导入反馈**：成功后 `stats:refresh` + `tree:reload` 双事件联动；失败统一 `toast:show`（error 类型 4~5s）

## 与其他子系统关系

- 由 [app_content](./app_content.md) 懒加载初始化；清理函数收进组件 `_unsubs` 统一在 `disconnectedCallback` 释放
- 与 [global_handlers](./global_handlers.md) 分工：全局 DnD 收集完（含 100MB 上限拦截）直接 `await executeCollected` 静默入仓，**不切 tab、不弹表单**；导入完成后经 `import:history-changed` 驱动本模块刷新已导入列表——导入 tab 未挂载时导入照常生效，挂载后从 `ImportHistory` 补渲染
- 导入成功后发 `stats:refresh` + `tree:reload` 联动 [app_tree](./app_tree.md) 与统计；单文件落盘策略见 [go_importer](./go_importer.md)，文件夹整组写入见 `go/fileops.WriteModelFolder`（[go_fileops](./go_fileops.md)）

## 不变量

- 拖拽区内事件必须 `stopPropagation`，否则与全局 DnD 遮罩双重触发
- `enqueueFile` 重名去重：`fileQueue` 与 `ImportHistory.records` 中已有同名文件则跳过
- `directImport` 的 `_inFlight` 去重键为文件名，`finally` 中必须删除，否则该文件后续再也导不进来
- 覆盖分支仅在 Go 返回 `FILE_EXISTS`/「文件已存在」时经 `modalConfirm` 确认后执行，且 `finalName` 在 try 外声明保证 catch 可见
- 文件夹整组要求组内至少 1 个支持文件（`groupCollected` 前端判定与后端 `isSupportedEntryFile` 对齐），否则整组丢弃
- 拖拽区点击有 500ms `clickLocked` 节流，防抖出双开文件选择器

## 相关

- [global_handlers](./global_handlers.md) — 全局拖拽入口与遮罩状态机
- [dialog_rename](./dialog_rename.md) — 导入确认与重命名弹窗
- [dialog_modal](./dialog_modal.md) — 覆盖确认 modalConfirm
- [app_content](./app_content.md) — 宿主组件与 tab 懒加载
