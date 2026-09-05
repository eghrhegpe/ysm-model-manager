---
kind: dnd-shared
name: 拖拽平台适配 dnd-shared
tier: leaf
category: feature
source_files:
  - frontend/src/features/dnd/shared.ts
  - frontend/src/features/dnd/collector.ts
  - frontend/src/utils/resource/extensions.ts
auto_fields:
  symbols_with_lines:
    - ALL_EXTS
    - buildFolderItems
    - collectDropFiles
    - CollectedEntry
    - collectFiles
    - extBelongsTo
    - fileToBase64
    - FolderGroup
    - getExt
    - getExts
    - groupCollected
    - isImportableFile
    - isSupportedExt
    - isSupportedFile
    - RESOURCE_EXTS
    - shouldEnterForm
quick_groups:
  - 拖拽导入与平台适配
quick_intents:
  - DnD 文件收集
  - import-dnd 拖拽导入
  - pack-dnd 整合包拖拽
  - WebView2 拖拽坑
  - fileToBase64 文件编码
pitfalls:
  - WebView2 特殊性：dragover 读不到文件名；drop 用 webkitGetAsEntry；entry.file Promise 化；DataTransferItem 无 name
  - FileReader 无超时兜底 → 大文件读取卡死（已修复：10s 超时 abort）
  - base64 为空（0 字节文件）时跳过，不落库
  - isImportableFile：.json 仅放行 ysm.json 入口清单（与 go/scanner/scanner.go 白名单对齐）
  - readEntries 分页：Web 标准 API 单次最多返回 100 条 FileSystemEntry，必须循环调用直到返回空数组才读完目录——单次调用会静默漏掉第 101+ 个文件（`dnd-collector.ts` 已收敛为 `readAllDirEntries` 循环读取，`1cd8e305`）
use_when:
  - 拖拽导入
  - DnD 文件收集
  - 文件夹整组分组
  - File → base64 编码
  - 导入支持文件判定
status: active
---

# 拖拽平台适配 dnd-shared

## 概览

拖拽导入共享逻辑层。解决 WebView2 特殊性（dragover 读不到文件名、drop 用 webkitGetAsEntry、entry.file Promise 化、DataTransferItem 无 name）的同时，为 `import-dnd` / `pack-dnd` / `import-executor` 提供统一的文件收集、扩展名判定、文件夹分组、File → base64 编码等共享能力。

## 核心职责

- **`isSupportedFile(name: string): boolean`** — 扩展名是否在支持列表（`utils/resource/extensions.ts` 的 `ALL_EXTS`）。
- **`isImportableFile(name: string): boolean`** — 是否可作为独立文件导入：`.json` 仅放行 `ysm.json` 入口清单（与 `go/scanner/scanner.go` 的 ysm.json 白名单对齐，base name 级判断，任意子目录均适用）；其他走 `isSupportedFile`。
- **`shouldEnterForm(name: string): boolean`** — 是否需要进入命名表单：`.json` + `ysm.json`（整组导入走文件夹路由，单文件保留表单提示）。
- **`groupCollected(collected: CollectedEntry[]): { folders, singles }`** — 文件夹整组分组：有目录前缀的条目按顶层目录整组（组内保留完整 relPath，支持多层嵌套）；无前缀散落文件 → 单文件队列（`isImportableFile` 过滤）；组内至少 1 个支持文件才整组导入（防杂物）。
- **`fileToBase64(file: File): Promise<string>`** — File → base64（10s 超时兜底，防 FileReader 悬挂卡死导入；0 字节文件返回空字符串）。
- **`buildFolderItems(dir, files): Promise<{ items, skipped }>`** — 文件夹整组导入条目：relPath 去 dir 前缀 + per-file base64（单文件读取失败计入 skipped 跳过，不拖垮整组）。
- **`collectDropFiles(e: DragEvent): Promise<CollectedEntry[]>`** — drop 事件文件收集（桌面端）：优先 `dataTransfer.files`（WebView2 可靠），再 `items → webkitGetAsEntry` 补充目录条目，按 `name:size:lastModified` 去重合并。

## 对外 API / 入口

- `isSupportedFile(name: string): boolean`
- `isImportableFile(name: string): boolean`
- `shouldEnterForm(name: string): boolean`
- `getExt(name: string): string`（小写扩展名，含点）
- `groupCollected(collected: CollectedEntry[]): { folders: FolderGroup[]; singles: CollectedEntry[] }`
- `fileToBase64(file: File): Promise<string>`
- `buildFolderItems(dir: string, files: CollectedEntry[]): Promise<{ items: Array<{ RelPath: string; Base64: string }>; skipped: number }>`
- `collectDropFiles(e: DragEvent): Promise<CollectedEntry[]>`
- `CollectedEntry` / `FolderGroup` 接口

## 与其他子系统关系

- **`features/import-dnd.ts`** — 仓库页拖拽导入：消费 `collectDropFiles` + `isImportableFile`。
- **`features/pack-dnd.ts`** — 整合包卡片拖拽导入：消费 `groupCollected` + `buildFolderItems` + `fileToBase64` + `collectDropFiles`。
- **`features/import-executor.ts`** — 导入执行器：消费 `CollectedEntry` 类型 + `buildFolderItems` + `fileToBase64` + `groupCollected`。
- **`features/dnd-collector.ts`** — 递归文件收集器（`collectFiles`）：`collectDropFiles` 委托它处理 `webkitGetAsEntry` 目录遍历。
- **`utils/resource/extensions.ts`** — `ALL_EXTS` 扩展名白名单。

## 不变量

- **WebView2 特殊性统一收口**：dragover 阶段无法读文件名（只能 preventDefault + 遮罩）；drop 阶段优先 `webkitGetAsEntry`，兜底 `dataTransfer.files`。
- **entry.file Promise 化**：`FileSystemEntry.file(callback)` 是回调，必须 `new Promise(resolve => entry.file(resolve))` 转 Promise。
- **DataTransferItem 无 name**：`File` 才有 `.name`，`DataTransferItem` 没有。
- **FileReader 10s 超时兜底**：防止大文件读取既不走 onload 也不走 onerror 导致 Promise 永久 pending。
- **0 字节文件跳过**：base64 为空时不落库（与 importFolder 旧行为一致）。
- **ysm.json 白名单对齐 Go 端**：`go/scanner/scanner.go` 的 ysm.json 判定与前端 `isImportableFile` 一致。

## 相关

- `docs/knowledge/import-queue.md`（导入队列）
- `docs/knowledge/features_dialogs.md`（导入对话框）
- frontend/AGENTS.md（WebView2 DnD 特殊性）
