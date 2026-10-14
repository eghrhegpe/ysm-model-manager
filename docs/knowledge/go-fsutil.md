---
kind: go-fsutil
name: 文件基础设施 go/fsutil
tier: leaf
category: go
source_files:
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
    - DirSize
    - DisabledAncestorPath
    - DisabledDirCounterpart
    - DisabledTwinForms
    - ErrB64TooLarge
    - ErrChmodFailed
    - ErrCloseFailed
    - ErrFileTooLarge
    - ErrRenameFailed
    - ErrSyncFailed
    - ErrTempCreateFailed
    - ErrWriteFailed
    - FilePerms
    - FileSize
    - FormatSize
    - IsCrossDeviceErr
    - IsHardLink
    - IsRecycleDir
    - IsRelinkBackupPath
    - IsResourcePackFolder
    - ReadFileLimited
    - ReadLimitedEntry
    - RecoverAtomicRename
    - SafeWalk
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
    - TruncateLimit
    - TruncateWidth
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
  - 把 `IsRelinkBackupPath` 改写成「基名精确匹配」（照抄 IsRecycleDir 形态）→ 备份目录**内部**文件漏判，各消费方重新把尸体当模型；它是**段级中缀**判定，不是段名等值判定

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
  - go/fsutil/relink_backup.go|IsRelinkBackupPath
  - go/fsutil/write.go|WriteFileAtomic
  - go/fsutil/b64.go|DecodeBase64Limited
status: active
---

# 文件基础设施 go/fsutil

## 概览

`go/fsutil/` 是 Go 侧文件系统基础设施包，按 ADR-044 策略 A 收敛自多包重复实现。覆盖 7 大职能：文件/目录遍历、原子写入、原子复制、权限常量、硬链接判定、跨设备错误判定、UTF-8 BOM 剥离、zip/7z 单条目受限读取。

## 核心职责

- `walk.go` — 文件/目录遍历、目录后序遍历、计数、空目录清理，内置 `.recycle` 回收站跳过开关
- `relink_backup.go` — `IsRelinkBackupPath`（relink 备份目录 `<夹名>.relink-bak-<ts>` 的**唯一**识别谓词，ADR-342 D6 下沉自 go/sync 私有实现）：判「任一路径段含 `.relink-bak-`」而非基名精确匹配（备份目录内部文件同样要命中）、大小写不敏感；消费方 = go/sync（relink/toggle/同步 diff 四通道豁免）、go/scanner（不得把尸体内模型扫成活跃条目）、go/dedup（`clean` 保留 Path 排序首个，尸体排前会「保尸体删活模型」）、go/repoaudit（统计不计尸体）
- `disabled_counterpart.go` — `DisabledCounterpart(path)`（ADR-345 D2）：「活跃形态不存在、而禁用孪生存在」的**唯一**谓词——`path` 存在时恒不命中（活跃是当前真值），否则按 `registry|DisableSuffixes` 的副本逐个试 `.disabled`（新标准优先）/`.ban`（历史兼容），命中返回孪生路径。与 `relink_backup.go` 同族（路径形态判定收在 fsutil，两包共用禁内联拼后缀）。消费方 = `go/instance|appendOneItem`（dirLevel 单元的实例侧路径解析：盲 join 会把「实例已禁用」误判成「缺失待推送」→ 推送复活并残留）、`go/sync|planToggleRenames`+`dirToggleDecision`（目录粒度启禁的仓库侧真值探测）、`go/sync|installDirUnitLocked`（目标侧禁用孪生存在即拒绝推送）
- `copy.go` — `CopyFile`（同目录 tmp+rename 原子复制 + Sync + `Chmod FilePerms` + MkdirAll + **目录源前置拒绝 + 读毕早关 src**）；`CopyDirRecursive`（参数化 symlink 策略 / 防覆盖 / 失败回滚，`AtomicRename` 分支通过 tmpDir → rename 原子替换）；`RecoverAtomicRename(dir)` 启动自愈扫描 `.bak-*` 备份目录（上次 AtomicRename 崩溃残留）；`StepError` 步骤类型化错误（中性步骤名 `StepStat/Open/CreateTmp/Copy/Sync/Close/Chmod/Rename/...`，经 `errors.As` 取步骤，`Error()` 透传内层、`errors.Is` 穿透——ADR-044 策略 A：机制归 fsutil、UX 文案归调用方如 installer.mapStepToAppError）
- `perms.go` — `DirPerms`(0755) / `FilePerms`(0644) 全仓权限单点（os.MkdirAll/os.WriteFile 全仓 27 处手写字面量已收敛至此）
- `bom.go` — `UTF8BOM` / `StripBOM`（PowerShell 等工具写出的 JSON/文本 BOM 剥离单点，ysm/fileops/packs/internal-app 共 7 处已收敛）
- `hardlink_other.go` / `hardlink_windows.go` — `IsHardLink`（nlink>1 判定，目录排除防 ADR-038 D3.4 误删）
- `crossdevice_other.go` / `crossdevice_windows.go` — `IsCrossDeviceErr`（EXDEV / ERROR_NOT_SAME_DEVICE，recycle 跨设备回退与 installer errnoIs 共用）

## 对外 API / 入口

- `WalkAllFiles(dir, skipRecycle) []string` / `WalkAllDirs(dir, skipRecycle) []string` — 递归遍历（后序：子在前父在后）
- `CountFiles(dir, skipRecycle) int` / `CleanEmptyDirs(dir, skipRecycle) int` — 计数与空目录清理
- `WriteFileAtomic(destPath, data) error` — tmp+rename 原子写
- `DisabledCounterpart(path) (string, bool)` — 活跃路径不存在时的禁用孪生路径（后缀表走 registry；供实例侧单元解析与目录粒度启禁探测）
- `ReadLimitedEntry(rc, limit) []byte` — zip/7z 单条目 limit+1 探测截断读取
- `CopyFile(src, dst) error` / `CopyDirRecursive(src, dst, opts) error` — 原子单文件/目录复制
- `RecoverAtomicRename(dir) (int, error)` — 启动自愈：扫描 `.bak-*` 备份目录，恢复未完成的 AtomicRename（返回恢复数量）
- `DirPerms` / `FilePerms` / `UTF8BOM` / `StripBOM(data)` — 权限/BOM 单点
- `IsHardLink(path) bool` / `IsCrossDeviceErr(err) bool` — 硬链接/跨设备判定
- `SafeWalk(root, fn fs.WalkDirFunc) error` — `filepath.WalkDir` 的失败可见包装（ADR-030）：回调对访问失败的条目返回 nil（静默跳过）时补记一条 `[fsutil] SafeWalk 跳过访问失败的条目` 日志，恢复失败可见性；回调返回非 nil 时原样透传。仅服务此前纯吞 err 的站点（ysm 纹理查找、launcher 实例探测），已被调用方自行 log 的站点（watcher/recycle/sync）不要改走它以免重复记录

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
- **`IsHardLink` Windows 用 `access=0`（仅查询属性）打开**（ADR-296 D7 根治）：`GENERIC_READ` 会被游戏的 `FileShare.None` 独占句柄挡出 ERROR_SHARING_VIOLATION → 静默 false → 硬链接误判为普通文件；NumberOfLinks 是内核实时元数据，0 access + OPEN_EXISTING 照样读到（探针实证：独占下真硬链接仍=2、普通文件仍=1，独占句柄不计入 nlink、无用户态缓存）。share 含 R|W|DELETE 放宽兼容面；**勿加 `FILE_FLAG_BACKUP_SEMANTICS`**（仅目录需要且本函数已排除目录，且以备份语义打开文件要求 SE_BACKUP_NAME 特权，普通权限反咬 ERROR_PRIVILEGE_NOT_HELD）
- **`.relink-bak-*`（relink 备份族）与 `.bak-*`（AtomicRename 备份族）命名互不认领**：`RecoverAtomicRename` 用 `LastIndex(".bak-")` 分组，`.relink-bak-` 中 `b` 前是连字符非点号天然不匹配（回归测试 `TestRecoverAtomicRename_IgnoresRelinkBakFamily` 钉死，防将来放宽匹配时静默误搬恢复点）
- `IsCrossDeviceErr` 分平台：POSIX EXDEV(18) / Windows ERROR_NOT_SAME_DEVICE(17)，语义不同不可混用
- `StripBOM` 只剥文件头 BOM（前 3 字节 `0xEF 0xBB 0xBF`），中间字节不变
- `DecodeBase64Limited(s, max)`（2026-08-30 审核修复）：binding 层 base64 输入统一受限解码入口——`len*3/4` 预检（不解码即拒绝，防超大字符串解码内存尖刺）→ 解码 → 复检，超限归哨兵 `ErrB64TooLarge`（`errors.Is` 分类）。`MaxImportSize`（500MB）/`MaxReadLimit`（50MB）由调用方按语义选择；importer / app_install_import / app_model 三处已收敛，勿再手写裸 `base64.DecodeString` + 事后查大小

## 相关

- [go_recycle](./go-recycle.md) / [go_importer](./go-importer.md) / [go_installer](./go-installer.md) — 消费方
- [go_types](./go-types.md) — `MaxReadLimit` 单点上限
- ADR-044（原子写/复制原语收敛策略 A）、ADR-033（limit+1 探测截断）