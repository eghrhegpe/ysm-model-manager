---
kind: go-fsutil
name: 文件基础设施 go/fsutil
tier: leaf
category: go
source_files:
  - go/fsutil/walk.go
  - go/fsutil/write.go
  - go/fsutil/copy.go
  - go/fsutil/perms.go
  - go/fsutil/bom.go
  - go/fsutil/b64.go
  - go/fsutil/hardlink_other.go
  - go/fsutil/crossdevice_other.go
  - go/fsutil/
auto_fields:
  symbols_with_lines:
    - CleanEmptyDirs
    - ContainsIllegalNameChar
    - CopyDirOptions
    - CopyDirRecursive
    - CopyFile
    - CountFiles
    - DecodeBase64Limited
    - DirPerms
    - ErrB64TooLarge
    - ErrChmodFailed
    - ErrCloseFailed
    - ErrRenameFailed
    - ErrSyncFailed
    - ErrTempCreateFailed
    - ErrWriteFailed
    - FilePerms
    - FormatSize
    - IsCrossDeviceErr
    - IsHardLink
    - IsRecycleDir
    - IsResourcePackFolder
    - ReadLimitedEntry
    - SHA256File
    - StepChmod
    - StepClose
    - StepCloseSrc
    - StepCopy
    - StepCreateTmp
    - StepError
    - StepError.Error
    - StepError.Unwrap
    - StepMkdir
    - StepOpen
    - StepRename
    - StepStat
    - StepSync
    - StripBOM
    - UTF8BOM
    - WalkAllDirs
    - WalkAllFiles
    - WriteFileAtomic
  quick_groups:
    - 文件操作与标签
  quick_intents:
    - 文件遍历 / walk、原子写、复制
    - 硬链接、跨设备、权限常量
    - BOM、base64 受限解码、读取上限
  quick_risk_lines:
    - 文件系统操作必须走 go/fsutil 的 walk/write/copy 封装，禁止在业务代码里直接 os.Open/os.WriteFile
  pitfalls:
    - 业务代码直调 os.WriteFile → 并发写破坏文件、缺 BOM 处理；必须经 fsutil.AtomicWrite
    - filepath.Walk 跟符号链接 → 目录遍历循环 / 越权；必须用 fsutil.walk 的 IsRecycleDir 守卫
  use_when:
    - 遍历
    - walk
    - 原子写
    - 复制
    - 硬链接
    - 跨设备
  perf:
    - io-bound
  invariant_anchors:
    - go/fsutil/walk.go|IsRecycleDir
    - go/fsutil/write.go|WriteFileAtomic
    - go/fsutil/b64.go|DecodeBase64Limited
quick_groups:
  - 文件操作与标签
quick_intents:
  - 文件遍历 / walk、原子写、复制
  - 硬链接、跨设备、权限常量
  - BOM、base64 受限解码、读取上限
quick_risk_lines:
  - 文件系统操作必须走 go/fsutil 的 walk/write/copy 封装，禁止在业务代码里直接 os.Open/os.WriteFile
pitfalls:
  - 业务代码直调 os.WriteFile → 并发写破坏文件、缺 BOM 处理；必须经 fsutil.AtomicWrite
  - filepath.Walk 跟符号链接 → 目录遍历循环 / 越权；必须用 fsutil.walk 的 IsRecycleDir 守卫

use_when:
  - 遍历
  - walk
  - 原子写
  - 复制
  - 硬链接
  - 跨设备
perf:
  - io-bound
invariant_anchors:
  - go/fsutil/walk.go|IsRecycleDir
  - go/fsutil/write.go|WriteFileAtomic
  - go/fsutil/b64.go|DecodeBase64Limited
status: active
---

# 文件基础设施 go/fsutil

## 概览

`go/fsutil/` 是 Go 侧文件系统基础设施包，按 ADR-044 策略 A 收敛自多包重复实现。覆盖 7 大职能：文件/目录遍历、原子写入、原子复制、权限常量、硬链接判定、跨设备错误判定、UTF-8 BOM 剥离、zip/7z 单条目受限读取。

## 核心职责

- `walk.go` — 文件/目录遍历、目录后序遍历、计数、空目录清理，内置 `.recycle` 回收站跳过开关
- `write.go` — `WriteFileAtomic`（tmp+rename 原子落地 + Sync 落盘检查 + `Chmod FilePerms`）；`ReadLimitedEntry`（limit+1 探测截断，ADR-033 修复）
- `copy.go` — `CopyFile`（同目录 tmp+rename 原子复制 + Sync + `Chmod FilePerms` + MkdirAll + **目录源前置拒绝 + 读毕早关 src**）；`CopyDirRecursive`（参数化 symlink 策略 / 防覆盖 / 失败回滚）；`StepError` 步骤类型化错误（中性步骤名 `StepStat/Open/CreateTmp/Copy/Sync/Close/Chmod/Rename/...`，经 `errors.As` 取步骤，`Error()` 透传内层、`errors.Is` 穿透——ADR-044 策略 A：机制归 fsutil、UX 文案归调用方如 installer.mapStepToAppError）
- `perms.go` — `DirPerms`(0755) / `FilePerms`(0644) 全仓权限单点（os.MkdirAll/os.WriteFile 全仓 27 处手写字面量已收敛至此）
- `bom.go` — `UTF8BOM` / `StripBOM`（PowerShell 等工具写出的 JSON/文本 BOM 剥离单点，ysm/fileops/packs/internal-app 共 7 处已收敛）
- `hardlink_other.go` / `hardlink_windows.go` — `IsHardLink`（nlink>1 判定，目录排除防 ADR-038 D3.4 误删）
- `crossdevice_other.go` / `crossdevice_windows.go` — `IsCrossDeviceErr`（EXDEV / ERROR_NOT_SAME_DEVICE，recycle 跨设备回退与 installer errnoIs 共用）

## 对外 API / 入口

- `WalkAllFiles(dir, skipRecycle) []string` / `WalkAllDirs(dir, skipRecycle) []string` — 递归遍历（后序：子在前父在后）
- `CountFiles(dir, skipRecycle) int` / `CleanEmptyDirs(dir, skipRecycle) int` — 计数与空目录清理
- `WriteFileAtomic(destPath, data) error` — tmp+rename 原子写
- `ReadLimitedEntry(rc, limit) []byte` — zip/7z 单条目 limit+1 探测截断读取
- `CopyFile(src, dst) error` / `CopyDirRecursive(src, dst, opts) error` — 原子单文件/目录复制
- `DirPerms` / `FilePerms` / `UTF8BOM` / `StripBOM(data)` — 权限/BOM 单点
- `IsHardLink(path) bool` / `IsCrossDeviceErr(err) bool` — 硬链接/跨设备判定

## 与其他子系统关系

- 被 `internal/app/`、`go/avatar/`、`go/fileops/`、`go/importer/`、`go/installer/`、`go/logs/`、`go/recycle/`、`go/scanner/`、`go/ysm/`、`go/geometry/` 等广泛引用
- 与 [go_recycle](./go-recycle.md) 协作：`IsCrossDeviceErr` 供 recycle `moveEx` 跨设备回退判定；`IsHardLink` 供 recycle 判定硬链接
- 与 [go_importer](./go-importer.md) / [go_installer](./go-installer.md) / [go_recycle](./go-recycle.md) 的 copyFile 系列收敛关系：原四包各手写 copyFile 已收敛至 `CopyFile`/`CopyDirRecursive`
- 与 [go_types](./go-types.md) 的 `MaxReadLimit`（50MB）协作：`ReadLimitedEntry` 由 `geometry/ysm` 等用 `MaxReadLimit` 传入调用

## 不变量

- `WriteFileAtomic`/`CopyFile` 落盘模式：tmp+rename 原子替换，失败清理 tmp 不留残渣；落地前 `Sync` 防崩溃丢数据；`Chmod FilePerms`(0644)
- `CopyFile` 各失败点均包 `*StepError`：`Error()` 透传内层文本、`errors.Is` 命中 sentinel（既有调用方文本断言零影响）；需区分步骤的调用方经 `errors.As` 取 `Step`（STATE 归 installer 等上层映射为 `AppError`）
- `ReadLimitedEntry` limit<=0 或 ==MaxInt64 一律 nil；limit+1 溢出为负时 `io.ReadAll` 读 0 字节静默返回空切片，统一判 nil；读取错误同样返回 nil（调用方跳过该条目）
- `walk.go` skipRecycle 大小写不敏感；单文件/目录读取失败不中断整体，WalkDir 错误打日志后跳过
- `CopyDirRecursive` 遇符号链接按参数决定复制/跳过，不默认跟随
- `IsHardLink` 目录恒返回 false（目录 nlink 恒 >1，误判会导致文件夹模型 Move 被当硬链接直接删除）
- `IsCrossDeviceErr` 分平台：POSIX EXDEV(18) / Windows ERROR_NOT_SAME_DEVICE(17)，语义不同不可混用
- `StripBOM` 只剥文件头 BOM（前 3 字节 `0xEF 0xBB 0xBF`），中间字节不变
- `DecodeBase64Limited(s, max)`（2026-08-30 审核修复）：binding 层 base64 输入统一受限解码入口——`len*3/4` 预检（不解码即拒绝，防超大字符串解码内存尖刺）→ 解码 → 复检，超限归哨兵 `ErrB64TooLarge`（`errors.Is` 分类）。`MaxImportSize`（500MB）/`MaxReadLimit`（50MB）由调用方按语义选择；importer / app_install_import / app_model 三处已收敛，勿再手写裸 `base64.DecodeString` + 事后查大小

## 相关

- [go_recycle](./go-recycle.md) / [go_importer](./go-importer.md) / [go_installer](./go-installer.md) — 消费方
- [go_types](./go-types.md) — `MaxReadLimit` 单点上限
- ADR-044（原子写/复制原语收敛策略 A）、ADR-033（limit+1 探测截断）