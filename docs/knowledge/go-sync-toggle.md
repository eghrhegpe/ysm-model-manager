---
kind: go-sync-toggle
name: 启禁状态同步 go/sync SyncToggleStatus（ADR-345 载体识别）
tier: leaf
category: go
status: active
source_files:
  - go/sync/sync.go
  - go/fsutil/disabled_counterpart.go
  - go/types/registry/extensions.go
auto_fields:
  symbols_with_lines:
    - AllExts
    - AllSubDirs
    - ContainerExts
    - DisabledAncestorPath
    - DisabledDirCounterpart
    - DisabledSuffix
    - DisabledTwinForms
    - DisableSuffixes
    - ExtBelongsTo
    - ExtBelongsToBy
    - GroupIcon
    - GroupLabel
    - GroupOf
    - GroupStorageRoot
    - InstallExtsFor
    - IsContainerExt
    - IsDirLevelSync
    - IsDisableSuffix
    - IsNestedModelDir
    - IsResourceAllowed
    - IsScanInstance
    - IsSupportedExt
    - IsYsmEntryJSON
    - MatchZipEntry
    - MaxImportSize
    - MaxImportSizeMB
    - MaxReadLimit
    - NestedPatternsFor
    - NormalizeResourceName
    - ScanFunc
    - ShouldHashExt
    - StorageSubDir
    - StripBanSuffix
    - StripDisableSuffix
    - StripDisableSuffixSegments
    - SubDirAll
    - SubDirEntry
    - SubDirMap
    - SupportedExtsForSubtype
    - SupportedExtsForType
    - SyncToggleStatus
use_when:
  - SyncToggleStatus
  - 启用禁用同步
  - .disabled
  - .ban
  - 载体
  - ADR-345
pitfalls:
  - 目录级禁用载体（模型夹 X ↔ X.disabled）在两条边都不可见：scanner 对禁用夹 SkipDir → 仓库索引根本没有禁用夹；实例侧原只收文件且 IsDisableSuffix 只看尾段（X.disabled/ysm.json 尾段是 ysm.json）→ 两方向均 0/0/nil 静默失效（ADR-345 前探针 P1/P2 实证）
  - 禁用/启用载体并存时借活跃短路判载体 → 走进「应活跃」分支把用户既有禁用载体强制启用（复核 P1-1 实证 禁用 0 启用 1）——并存必须真 no-op
  - 实例侧整夹或其祖先容器夹改名后，子项盲 join 实例路径 → 误判待推送 → 推送另建活跃副本 = 模型复活 + 同模型两份；必须经 DisabledAncestorPath 以载体为基准 diff
  - 载体可在任意祖先层级：relKeyDirLevel 只剥尾段会让 X.disabled/sub/ 与 x/sub/ 成两个键，产生幻影 Missing+Extra（Extra 一拉就把 .disabled 载体名复制进仓库）
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - SyncToggleStatus 启禁同步
  - 目录级禁用 载体识别
  - DisabledTwinForms 双形态探测
quick_risk_lines:
  - 启禁状态同步必须走 go/sync SyncToggleStatus，app 层禁止手写 rename 循环
invariant_anchors:
  - go/sync/sync.go|collectToggleFileInfos
  - go/sync/sync.go|planToggleRenames
  - go/sync/sync.go|dirToggleDecision
  - go/sync/sync.go|collectToggleRepoIndex
  - go/sync/sync.go|hasDisabledDirCarrier
  - go/fsutil/disabled_counterpart.go|DisabledTwinForms
  - go/fsutil/disabled_counterpart.go|DisabledDirCounterpart
  - go/fsutil/disabled_counterpart.go|DisabledAncestorPath
  - go/types/registry/extensions.go|StripDisableSuffixSegments
---

# 启禁状态同步 go/sync SyncToggleStatus（ADR-345 载体识别）

## 概览

`sync.go|SyncToggleStatus` 把仓库的启用/禁用状态同步到整合包实例（文件级：哈希 → 相对路径 → 纯文件名三级匹配，重命名加/去 `.disabled`；目录级见下）。载体是**文件系统上的目录改名**（`X/` ↔ `X.disabled/`），不是索引状态——这是 ADR-345 全部机制的起点。包级总览见 [go-sync](./go-sync.md)。

## 核心职责

- **`SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error)`**：返回禁用数、启用数。两阶段遍历-执行：WalkDir 回调**不直接** `os.Rename`，先收集 `[]renameOp`，遍历完成后批量执行（遍历中改目录结构会让后续条目被跳过或重复处理）。与 `go/installer` 共用包级 `installer.InstallLock`（防与安装并发写同一文件），分段持锁（阶段 1 收集与阶段 3+4 执行各为独立持锁段，中间锁外算哈希）——锁生命周期由段内 defer 保证，锁外 panic 不会触发对已释放锁的二次 Unlock
- **文件级三级匹配**：哈希（SHA256 内容）→ 相对路径 → 纯文件名 basename（最后一级同名不同路径互匹配，「旧仓库特例」兜底，观察项：新仓库数据齐全时该兜底应可收紧）
- **目录级真值取文件系统，不取 scanner 索引（ADR-345 D1）**：`collectToggleFileInfos` 把**目录**也作为候选（载体标 banned 并 `SkipDir`，不下钻——改名搬走整棵子树，下钻候选路径当场失效；目录候选不进阶段 2 哈希预算）；`planToggleRenames` 的目录分支走 `sync.go|dirToggleDecision`，用 `fsutil|DisabledTwinForms` 探仓库侧同一路径的活跃/载体**两种目录形态**——**恰好一侧存在**才判 matched 据此整目录改名；两侧**并存**或都不存在 → 保守不动

## 不变量

- **`collectToggleRepoIndex` 空索引早退须补 `hasDisabledDirCarrier` 豁免**（ADR-345 D1，复核 P2-2）：仓库只有禁用夹时索引必空（scanner 对禁用夹 SkipDir），豁免缺失则禁用方向永远失效
- **实例侧禁用载体识别三件套（ADR-345 D2/D3/D4）**：`fsutil|DisabledTwinForms`（双形态探测）/ `DisabledDirCounterpart`（活跃↔载体互算）/ `DisabledAncestorPath`（祖先链载体探测；目录限定，后缀表走 `registry|DisableSuffixes` 副本）。`go/instance|appendOneItem` 的实例侧路径（原为**盲 join** `instDir/<rel>`）过 `DisabledAncestorPath`：实例把整夹或其祖先容器夹改名后，子项以载体为基准 diff、单元标 ⛔ 进中立桶（不进待推送/一键清单），斩断「误判待推送 → 推送另建活跃副本 = 模型复活 + 同模型两份」；`installDirUnitLocked` 在落位前对**目标链**做同一探测，命中即**拒绝**（宁可报错也不静默复制第二份）
- **`relKeyDirLevel` 逐段去禁用后缀（`registry|StripDisableSuffixSegments`，ADR-345 复核 P1-2）**：载体可在任意祖先层级，只剥尾段会让 `x.disabled/sub/` 与 `x/sub/` 成两个键
- **信道口径劈裂（ADR-345 D3）**：生产 scan 信道里 scanner 已 SkipDir 掉载体 → 单元 raw status 是 `missing`；Walk 信道因键归一判 `synced`——面板显示经 D3 统一为 ⛔，但断言 raw status 的测试必须分信道写
- **`.ban` 剥离/判断现状分布（2026-08-23 审计，勿擅自归一）**：sync.go 内 5 处——3 处已委托 `types.StripBanSuffix` + 2 处内联判断 + 1 处内联剥离（`strings.TrimSuffix(strings.ToLower(e.Name), ".ban")`，repoName 匹配 key 供「同名不同文件夹」消费）。内联剥离与 `types.NormalizeResourceName` **语义不等价**（后者额外剥 `.disabled`）——直接替换会改变 repoName key 与 banned 匹配行为；若要归一，先加单测锁定 repoName key 语义（含 `.disabled` 文件的 banned 记录行为）再动
- **文件被占用（如 Minecraft 锁定）时 `isFileLocked` 识别后静默跳过不阻塞**

## 与其他子系统关系

- 被 `go/watcher` 调用（文件变更时自动同步启禁）；`internal/app` 的 `ToggleModelEnable` 包装层调用成功后 `scanner.InvalidatePath(filepath.Dir(path))`（祖先链覆盖仓库根，无 30s 陈旧窗口）
- 依赖 `go/instance|appendOneItem`（实例侧载体基准 diff）、`go/installer`（`installDirUnitLocked` 目标链探测 + InstallLock）
- 回归锁：`go/sync/sync_toggle_dirlevel_test.go`（禁用/启用方向、整目录改名不退化成夹内逐文件、**并存不动作且夹具用实例侧载体**、杂散文件不误改、仓库只有禁用夹仍生效、目录不进哈希预算、文件级回归）
