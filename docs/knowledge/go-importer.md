---
kind: go-importer
name: 导入策略 go/importer
tier: architecture
category: go
source_files:
  - go/importer/
use_when:
  - 导入
  - 策略
  - 导入队列
  - importer
invariant_anchors:
  - go/importer/importer_file.go|fsutil.WriteFileAtomic
  - go/importer/importer_file.go|DetectZipType
---

# 导入策略 go/importer

## 概览

`go/importer/` 包分两块：`importer.go` 的**按资源类型注册的复制策略表**（`Handler` 接口，供本地路径导入/安装复用），以及 `importer_file.go` 的 **base64 单文件导入核心** `ImportFromBase64`（ADR-003 从 `app_install.go` 下沉，薄壳仅注入 `rootFn` 与 `logger`）。

## 核心职责

- 策略注册表：按 rtype 取复制策略（`Register` / `Get`）
- base64 单文件导入：解码 → 扩展名/路径/大小校验 → 内容类型检测 → 魔数校验 → 写盘
- ZIP 内容类型识别（`DetectZipType`）
- 目录/文件复制（临时目录 + rename 原子落地，符号链接复制链接本身）

## ImportFromBase64 校验链（顺序即拒绝优先级）

| 检查 | 失败返回 `types.AppError.Code` |
|------|------|
| 扩展名在 `types.IsSupportedExt` 白名单 | `FILE_TYPE_UNSUPPORTED` |
| `.json` 仅放行 `ysm.json`（ADR-038 D2，与 scanner 对齐） | `FILE_TYPE_UNSUPPORTED` |
| 文件名不含 `..` 与 `\` `/` | `FILENAME_INVALID` |
| base64 可解码 | `DECODE_FAILED` |
| 体积 ≤ 500MB、非空 | `FILE_TOO_LARGE` / `FILE_EMPTY` |
| 目标目录可创建 | `MKDIR_FAILED` |
| 非覆盖模式下目标不存在 | `FILE_EXISTS` |

类型路由：`.zip` 走 `DetectZipType(data)` 按 ZIP local file header 里的文件名判定（`pack.mcmeta`→resourcepack、`shaders/`→shaderpack、`ysm.json`/`models/`→ysm，默认 ysm）；其余扩展名回退 `types.ExtBelongsTo`。魔数不匹配（ZIP `PK\x03\x04` / 7z `7z¼¯`）**只记 warn 日志仍照常导入**，不阻断。

## 对外 API / 入口

- `Register` / `Get` — 导入策略注册表（`Handler` 接口：`Type() string`、`Import(srcPath, dstDir) string`，返回空串即成功）
- `NewSimpleCopy` — 单文件/目录复制策略（`SimpleCopyImporter`）
- `NewDirectoryCopy` — 以文件夹为单位的复制策略（`DirectoryCopyImporter`：mmd-skin）
- `ImportFromBase64(fileName, base64Data, ImportOptions{SkipCheck, Overwrite}, rootFn, logger)` — base64 导入核心
- `DetectZipType(data []byte) string` — ZIP 内容类型检测
- `init()` 注册：resourcepack / shaderpack / create-blueprint / mmd-skin(目录) / vrchat-avatar / ysm / litematic

## 与其他子系统关系

- `internal/app/app_install.go`：薄壳转发 `ImportFromBase64`（注入 `a.GetRepoRoot` 与 `App.logger.Add`）与 `DetectZipType`
- `internal/app/resource_bindings.go`：按 rtype `importer.Get(rtype)` 取策略执行本地路径导入
- `go/types/`：`IsSupportedExt` / `IsYsmEntryJSON` / `ExtBelongsTo` / `AppError`
- 前端调用方见 [import_queue](./import-queue.md)（`import-executor.directImport` → `ImportModelFile`）

## 不变量

- 非覆盖模式下目标已存在必须返回 `FILE_EXISTS`，由前端二次确认后再走覆盖分支
- **`io.Copy` 失败必须清理半截目标文件**（`SimpleCopyImporter` 复制失败时 `Close` + `os.Remove(dstPath)`），不得留下损坏文件误导用户；**base64 路径写盘同样原子化**（P2 修复：`ImportFromBase64` 原 `os.WriteFile` 直写目标，磁盘满/IO 中断留半截文件且非覆盖模式再次导入命中 FILE_EXISTS 死锁——现改临时文件 + `os.Rename` 原子落地，失败删临时文件）
- 复制目录时符号链接复制链接本身（`Readlink` + `Symlink`）而非跟随；`DirectoryCopyImporter.copyDir` 对 `Readlink`/`Symlink` 的错误显式返回，不静默吞掉
- 目录复制先写入 `MkdirTemp` 临时目录再 `os.Rename` 落地，保证原子性（失败 `defer RemoveAll` 清理）
- `sanitizePath` 是防御纵深：上层 `installer.Install` 已用 `paths.IsInside` 严校验，包被独立使用时仍拒绝 `..`

## 相关

- ADR-003（逻辑下沉）
- [import_queue](./import-queue.md) — 前端导入执行器与导入 tab
