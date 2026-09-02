---
kind: go-fileops
name: 文件操作 go/fileops
tier: architecture
category: go
source_files:
  - go/fileops/
use_when:
  - 移动
  - 复制
  - 重命名
  - 删除
  - fileops
  - 启用禁用
  - .ban
  - ysm.json 整组操作
perf:
  - io-bound
invariant_anchors:
  - go/fileops/folder_import.go|IsYsmEntryJSON
  - go/fileops/folder_import.go|WriteModelFolder
quick_groups:
  - 文件操作与标签
quick_intents:
  - 移动 / 复制 / 删除 / 重命名文件 / 文件夹导入
quick_risk_lines:
  - 文件 CRUD 必须走 go/fileops，internal/app 薄壳仅转发
status: active
---

# 文件操作 go/fileops

## 概览

`go/fileops/` 包实现文件 CRUD + 移动/复制/删除 + 文件夹整组导入 + 预览提取 + 启用禁用（ADR-003 P3 下沉，薄壳 `internal/app/app_files.go` 仅转发）。

## 核心职责

- 目录/文件创建、重命名、删除（含非法字符校验）
- 模型移动/复制（**目录感知**：`ysm.json` 提升为父目录整组操作，ADR-038 D3）
- 模型删除（目录感知：`ysm.json` 整组删父目录，守卫拒绝时回退单文件）
- **文件夹整组导入统一**（`folder_import.go` / `WriteModelFolder`）：不区分 YSM 解压目录与普通文件夹，只要组内含至少 1 个支持文件即整体入仓，**保留嵌套子目录层级**
- 启用/禁用（`fileops_enable.go`，新标准 **`.disabled`** 是文件名重命名约定：`ToggleModelEnable` 把 `path` 重命名为 `path+".disabled"`，目录级 `.disabled` 整组禁用，兼容历史 `.ban`——`StripDisableSuffix` 单源识别，ADR-038 D3.7）
- 预览图/纹理提取（zip/7z/ysm/json 容器）
- **跨设备移动 fallback**：`MoveModelFile` 在 `os.Rename` 返回 EXDEV 时自动回退到 copy+delete（`renameForMove` 可注入，供测试强制触发）

## 文件夹整组导入（folder_import.go）

`WriteModelFolder(repoRoot, subpath, folderName string, files []types.ImportFileItem) error`，写入目标 `repoRoot/subpath/folderName`：

| 校验 | 行为 |
|------|------|
| `folderName` 含 `\/:*?"<>\|` | 拒绝（非法字符） |
| `subpath` Clean 后为 `..`/`..` 前缀/绝对路径 | 拒绝（防穿越） |
| 目标目录已存在 | 报「目标已存在」（与单文件导入 `FILE_EXISTS` 语义一致，不覆盖） |
| `files` 为空 | 报「文件列表为空」 |
| 无任何支持文件 | 拒绝入仓（防杂物文件夹） |
| 单个 `RelPath` 绝对/含 `..`，或 Join 后逃出 `dstRoot` | 拒绝（逐条校验 + `filepath.Rel` 复查） |

「支持文件」判定 `isSupportedEntryFile`：扩展名在 `types.IsSupportedExt` 白名单，且 `.json` 仅放行 `ysm.json`（`types.IsYsmEntryJSON`，与 scanner 白名单对齐）。包内资源（`main.json`/`*.animation.json`/`textures/*.png`）**不计入支持文件但照常随组写入**。前端 `dnd-shared.groupCollected` 的分组判定与此对齐。

## 目录感知契约（ADR-038 D3.1/D3.6/D3.7）

| 操作 | `src` 为 ysm.json 时 | 守卫 |
|------|---------------------|------|
| `MoveModelFile` | 提升父目录整组移动（EXDEV 时 copy+delete fallback） | — |
| `CopyModelFile` | 提升父目录整组复制（递归；嵌套 `.ban` 随树复制） | root 路径安全校验 |
| `DeleteModelFile(root, path)` | 提升父目录整组删除 | 父目录必须严格深于仓库根；根级回退单文件、仓库外显式拒绝 |
| `ToggleModelEnable(root, path)` | 提升父目录级 .ban | 根级回退文件级 .ban；父目录 .ban 识别对称 |

## 对外 API / 入口

- `CreateDir` / `RenameDir` / `RemoveDir` / `RenameFile` — 基础 CRUD（`RenameFile` 对 `ysm.json` 特判禁止改名）
- `MoveModelFile(root, src, dstDir)` — 模型移动（目录感知）；`os.Rename` 跨设备（EXDEV）时自动回退 copy+delete（`renameForMove` 可注入供测试强制触发，见不变量）
- `CopyModelFile(root, src, dstDir)` — 模型复制（目录递归、防覆盖）；`.ban` 禁用态随文件名/目录名自然携带，不处理兄弟 `<src>.ban`
- `WriteModelFolder(repoRoot, subpath, folderName, files)` — 文件夹整组导入（薄壳 `App.ImportModelFolder` 转发，成功后 `scanner.InvalidateCache()`）
- `DeleteModelFile(root, path)` — 目录感知删除（D3.6 单入口）
- `ToggleModelEnable(root, path)` / `IsFileBanned(path)` — 启用禁用（D3.7 目录级 .ban）
- `FindPreviewImage` / `ExtractPreviewTexture` / `GetPackInfo` — 预览与包信息

## 与其他子系统关系

- `internal/app/app_files.go` / `resource_bindings.go`：薄壳转发（`DeleteResourcePack` 传 `a.ysmRoot()`、`ImportModelFolder` 传 `GetRepoRoot("ysm")`）
- **统一启禁入口 `App.ToggleEnable(path)`**（app_files.go，2026-08-24 修复）：**无 rtype，纯路径包含判定**——root 归属由「哪个已知根包含此路径」决定（`toggleAllowedRoots` = FilesRoot + McRoot + ysmRoot(`GetRepoRoot("ysm")`) + CustomRoots 值），取最具体（最深）匹配根后复用 `fileops.ToggleModelEnable(root, path)`；成功 rename 后内部 `scanner.InvalidatePath`，缓存失效收进绑定。修复「资源包/整合包内路径被旧 `ToggleModelEnable` 的 `a.ysmRoot()` 单根守卫拒绝」（ysmRoot 是单类型时代化石，多类型扩展后各类型根统一走 `GetRepoRoot(rtype)`，写死它的旧守卫是本 bug 病灶）。`ToggleResourcePack` 的根集合同步复用 `toggleAllowedRoots`
- **禁用态显示连带修复**（`ScanModelEntriesFiltered`，app_scan.go，2026-08-24）：类型扩展名白名单过滤改用 scanner 已恢复禁用后缀的 `e.Ext`（不能用 `filepath.Ext(e.Path)`——对 `xxx.zip.disabled` 返回 `.disabled` 不在白名单 → 禁用文件被丢弃 → 仓库树看不到、无法再启用）；禁用态容器跳过指纹核验（`DetectResourceType` 对 `.disabled` 路径判不出容器类型）
- `go/scanner/`：扫描缓存失效（`InvalidatePath` / 整组导入后 `InvalidateCache`）
- `go/types/`：`IsYsmEntryJSON` 辅助（`ysm.json` 识别）、`IsSupportedExt`、`ImportFileItem`、`ModelEntry`
- 前端拖拽整组入口见 [import_queue](./import-queue.md)（`import-executor.importFolder` → `ImportModelFolder`）

## 不变量

- `ysm.json` 是模型目录清单，单文件改名/删除/禁用会散架 → 一律整组操作（ADR-038 D3）
- 目录提升必须带 root 守卫：父目录 = 仓库根 → 回退文件级；父目录在仓库外 → 显式拒绝
- `WriteModelFolder` 不覆盖已存在目录；组内至少 1 个支持文件；每个 `RelPath` 必须落在 `dstRoot` 内
- `.ban` 检测大小写不敏感（Windows `.BAN` 兼容）
- **`.ban` 是文件名重命名约定**（`ToggleModelEnable` 把 `path` 重命名为 `path+".ban"`），后缀随文件/目录名自然携带——`MoveModelFile` / `CopyModelFile` **不再处理兄弟 `<src>.ban`**（那属于撞名的无关被禁模型，复制/失败回滚均会误伤）
- **`CopyModelFile` 拒绝目录自嵌套复制**（P2 修复：`dstDir` 位于 `src` 子树内时原实现 WalkDir 递归自嵌套无限膨胀至 ENAMETOOLONG——复制前校验 `filepath.Rel(src, dstDir)` 无 `..` 前缀即拒绝）
- **`MoveModelFile` 跨设备 fallback**：`os.Rename` 返回 EXDEV 时自动 copy+delete，`renameForMove` 可注入供测试
- **R33 修复链（2026-08-31）**：
  - P3-1 目录级启用半启用态：旧顺序先 Rename 文件名再 Rename 父目录，若第二步失败，文件名已去后缀但父目录仍禁用。修复：先 Rename 父目录（决定性步骤），再 Rename 文件名。
  - P3-2 MoveModelFile 空目录残留：`prepareModelDest` 在 `MkdirAll(dstDir)` 后若 `renameForMove` 失败，`dstDir` 空目录残留。修复：仅当 `dstDir` 由本次 `MkdirAll` 新建（`created bool`）时才 `RemoveAll`。
  - P3-3 MoveModelFile symlink 不对称：非 EXDEV 路径直接 `renameForMove` 不检查 src 是否 symlink。修复：Rename 前对 src 补 Lstat symlink 检查（与 `copyFile` 对齐）。
  - code_review P0/P1：`prepareModelDest` 返回 `created bool`，`MoveModelFile` 仅当 `created` 时才 `RemoveAll(dstDir)`，避免删除预存在的目标目录及其内容（静默数据破坏）。`CopyModelFile` 用 `_` 忽略 `created`。

## 相关

- ADR-003（逻辑下沉）、ADR-038（YSM 文件夹模型契约 D3.1/D3.6/D3.7）
