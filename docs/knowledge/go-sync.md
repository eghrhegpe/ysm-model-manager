---
kind: go-sync
name: 整合包同步 go/sync
tier: architecture
last_verified: 2026-10-15
adr:
  - ADR-064
  - ADR-296
  - ADR-340
  - ADR-342
  - ADR-344
  - ADR-345
  - ADR-347
category: go
source_files:
  - go/sync/sync.go
  - go/sync/sync_diff.go
  - go/sync/sync_hash.go
  - go/sync/sync_dirlevel.go
  - go/sync/sync_discovery.go
  - go/sync/sync_push.go
  - go/sync/sync_relink.go
  - go/sync/conflict.go
  - go/sync/sync_cache.go
  - go/sync/verdict.go
  - go/fsutil/hardlink_windows.go
  - go/fsutil/hardlink_other.go
auto_fields:
  symbols_with_lines:
    - ConflictContentModified
    - ConflictReport
    - ConflictSizeMismatch
    - ConflictType
    - ContentVerdict
    - DetectConflicts
    - DiffEntry
    - ErrPartialSync
    - FileConflict
    - FindMinecraftDir
    - HasDotMinecraftSubdirs
    - InvalidateSyncScanCaches
    - IsHardLink
    - ListVersions
    - Logger
    - PullResources
    - PullSingleResource
    - PushResources
    - PushSingleResource
    - RegisterInvalidationHook
    - RelinkDir
    - ResolutionStrategy
    - ResolveConflict
    - ResolveConflicts
    - ResolveConflictsLocked
    - ResolveForceLocal
    - ResolveForceRemote
    - ResolveManual
    - ResourceDiff
    - ScanFunc
    - SyncCustomToRepo
    - SyncToggleStatus
    - VerdictChannelFold
    - VerdictChannelHash
    - VerdictChannelNone
    - VerdictChannelOversize
    - VerdictChannelSize
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 整合包同步、推送 / 拉取
  - sync_diff / sync_hash / sync_push / sync_relink
  - 冲突处理 conflict.go
quick_risk_lines:
  - 整合包同步必须走 go/sync 的 diff+hash 双阶段，禁止在 app 层手写同步逻辑
pitfalls:
  - app 层手写同步 → 与 go/sync 判定不一致、冲突未处理；必须经 go/sync
  - 同步不做 hash 校验 → 文件变更未检测；必须经 sync_hash 校验

use_when:
  - 整合包
  - 同步
  - 硬链接
  - 缺失
  - 多余
perf:
  - io-bound
invariant_anchors:
  - go/sync/sync.go|fsutil.IsRecycleDir
  - go/sync/sync_relink.go|installer.CopyFile
  - go/sync/verdict.go|ContentVerdict
status: active
---

# 整合包同步 go/sync

## 概览

`go/sync/` 包负责模型库（全局仓库）与 Minecraft 整合包实例之间的同步：发现实例（原版 / PrismLauncher 布局）、按 SHA256 哈希对比出缺失/多余/禁用文件、按文件名或文件夹对比资源包差异、检测目标文件的链接类型（符号链接/硬链接/复制），并**编排推送/拉取/重链接的执行循环**（ADR-003 补充下沉，从 `internal/app/app_install.go` 提取）。单文件的实际落地（复制/硬链接/符号链接）仍由 [go_installer](./go-installer.md) 按 `LinkMode` 完成，本包只负责「算差异 + 决定对哪些条目调用 installer + 计数与失败上报」。

## 核心职责

- `sync.go` — 实例枚举、哈希差异对比、启禁状态同步、资源差异对比、链接类型判定
- `sync_push.go` — 推送/拉取执行循环（`PushResources` / `PullResources` 及单条变体、`SyncCustomToRepo`），失败逐条经注入的 `Logger` 记账、聚合成一条错误返回
- `sync_relink.go` — 重链接执行（`RelinkDir`）：按哈希把实例文件重新指向仓库版本，文件夹级类型用「备份→重建→回填实例独有文件→失败回滚」保证不丢目录，也不丢夹内用户文件（ADR-342）
- `conflict.go` — 冲突检测与解决（`DetectConflicts` 比较本地/远端同名文件 SHA256，哈希不同→内容冲突；`ResolveConflict` 单文件 + `ResolveConflicts` 批量，三种策略 force_remote/force_local/manual；`suggestStrategy` 按修改时间推荐策略）
- `go/fsutil/hardlink_windows.go` — Windows 硬链接检测（`syscall.GetFileInformationByHandle` → `NumberOfLinks`，收敛自原 link_windows.go）
- `go/fsutil/hardlink_other.go` — Unix/macOS 硬链接检测（`syscall.Stat_t.Nlink`，含目录排除 ADR-038，收敛自原 link_unix.go）

## 对外 API / 入口

- **实例状态对比（旧链）已退役（ADR-310，2026-09）**：`GetInstanceStatus` / `GetInstanceStatusWith` / `compareHashMode` / `compareRelKeyMode` / `buildRepoIndex` / `resolveInstanceScanDir` / `repoIndex` / `ListVersionsFunc` 全部删除——侧栏计数改走面板链薄入口 `go/instance.BuildInstanceStatusCounts`（折 `BuildSyncItems` 产物），`internal/app` 的 `GetInstanceStatus` / `GetResourceInstanceStatus` 绑定签名不变、内部换线。本包仍保留 `SyncResources` / `SyncResourcesDirLevel*` / `ResourceDiff`（面板链的地基）与 `ListVersions`（实例发现）。
  > ⚠️ **同名歧义防坑**：本包 `sync_push.go` 内另有 `buildRepoIndex` / `copyCustomEntryToRepo` 两个顶层函数，是 `SyncCustomToRepo` 的**本地 helper（仍在用）**，与上述旧链同名函数**同名不同义**——勿因本行「已退役」误删活代码。grep 消费者：`SyncCustomToRepo`（sync_push.go:393-397）调用二者。
- `SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error)` — 把仓库的启禁状态同步到实例（**文件级**：relKey 相对路径 → 哈希 → 纯文件名三级匹配——末级正常布局不可达，见「已知限制」条；重命名加/去 `.disabled`；**目录级**：见下条不变量），返回禁用数、启用数
- `ListVersions(mcRoot string) []types.VersionInstance` — 枚举实例，三种布局：目录本身是 instances（子目录含 `.minecraft`/`minecraft`）、PrismLauncher `{mcRoot}/instances/{name}/.minecraft/`、标准 `{mcRoot}/versions/{name}/`
- `HasDotMinecraftSubdirs(path string) bool` / `FindMinecraftDir(parentDir string) string` — 实例布局探测辅助
- `SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult` — **ADR-064 阶段二：全树递归 + 相对路径（relKey）对比**全局 ↔ 整合包资源；嵌套文件天然区分、无同名冲突，原「只扫顶层」深度守卫已取消。含 `pack.mcmeta` 的文件夹作为整体单元（仅资源包类型收集）；过滤/归一化统一走 `types.IsResourceAllowed` / `types.NormalizeResourceName`，归并走 `ResourceDiff`（sync_diff.go）。薄壳转发 `SyncResourcesWithConfig` 且 `scanFn=nil`（恒无哈希、回退 Size）
- `SyncResourcesWithConfig(globalDir, instanceDir string, config *types.SyncConfig, scanFn ScanFunc, rtype ...string) types.ResourceSyncResult` — 带冲突策略 + **内容级哈希**的完整入口（D2′-a / ADR-269）。`scanFn` 提供 scanner 已缓存化的文件哈希，`collect` 以 `relKey(rootDir, e.Path)` 同源键旁挂到 `DiffEntry.Hash`，让 `ResourceDiff` 对**同大小异内容**的资源包文件判出 Missing（盲区1）。scanFn 命中 scanner 30s 缓存、哈希在其侧并行预算内——不在 sync 热路径 / `InstallLock` 下现算（不触 hashlock 红线）。传 nil（push/pull 及旧调用）→ 条目恒无哈希 → 行为与 Size-only 现状完全一致。生产入口 `internal/app.App.SyncResources` 注入 `a.scanModelEntries`
- `SyncResourcesDirLevel(globalDir, instanceDir, rtype string)` / 优化版 `SyncResourcesDirLevelScan(globalDir, instanceDir, rtype string, scanFn ScanEntriesFn)` — 按文件夹名对比（YSM 的 ysm.json 文件夹 / MMD 的 .pmx/.pmd 文件夹 / 蓝图 .nbt 文件夹），同名时文件夹优先于平铺文件。`SyncResourcesDirLevel` 走 filepath.Walk（测试/旧调用方，行为不变）；`SyncResourcesDirLevelScan` 注入 scanner 已缓存扫描结果，命中时从 ModelEntry 列表反推同步条目（无嵌套模式类型 MMD/YSM 与原 Walk 精确等价；含嵌套模式 maid-model 回退 Walk），消除 8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树的重复 Walk。**单元带内容字段并复用 `ResourceDiff` 做内容级判定（ADR-344 D1）**：平铺文件单元两侧同格式时比哈希（scan 信道）/ Size（Walk 信道），仓库侧改过内容的平铺 `.ysm` 不再被判 Synced；目录单元仍为存在性语义（见不变量「dirLevel 单元判定分两层」）。**结果携 `Warnings` 诊断信道（2026-10-14 fail-loud 裁定，非四桶判定成员）**：dirLevel 键碰撞（同级同身份不同扩展名文件共存、last-write-wins 覆盖事件）经 `sync_dirlevel_sync.go|upsertDirLevelUnit` 逐条点名（被覆盖方 + 覆盖方），汇入 `ResourceSyncResult.Warnings` 并落日志；零碰撞恒空（`omitempty` 保持旧 JSON 载荷洁净）。**缓存命中同样返回**（2026-10-15 P0 面板接线：碰撞清单随 `dirLevelCacheValue` 与单元表同存，诊断信道跨 30s TTL 稳定；回归 `TestSyncResultsDirLevelScan_CacheHitCarriesCollisions`）；**日志只在首次新计算时打一次**（缓存命中不重打，防 TTL 窗口内反复刷新刷屏——`collectEntries` 返回 fresh 标志，仅 fresh 侧落日志，Warnings 两种情况都挂）。仓库级孪生/同键碰撞的常驻可见 = 体检页告警（`go/repoaudit` 键碰撞双检测器，2026-10-15 面板接线）
- `ResourceDiff(global, instance map[string]DiffEntry) types.ResourceSyncResult` — **单点对比归并**（sync_diff.go，ADR-064 阶段一）：内容判定统一走判定表 `verdict.go|ContentVerdict`（ADR-347）——两侧均带哈希则比哈希（哈希不同→Missing 待更新，捕获同大小异内容），任一侧无哈希则回退比大小（D2′-a / ADR-269）；同名内容一致 Synced / 仅单侧 Extra，结果排序确定性；**两侧同键而内容不同时同时进 `Missing` 与新增 `Diverged`**（ADR-340-d2：Diverged 是 Missing 的**子集**而非第四桶——把「待推送更新」与「仅全局有」被合并掉的那一维补回来，供面板分状态、侧栏如实报「覆盖了 N 处实例侧手改」）；`SyncResources` 消费，key 由调用方决定（统一为 `relKey` 相对路径）。注：`CompareGlobalInstanceHashes`（旧非 YSM 实例状态对比）已随死代码清理删除；实例状态对比的**侧栏消费端**（旧 `GetInstanceStatusWith` 哈希/relKey 双模集合运算）亦于 ADR-310 退役，统一折面板链产物（见上「实例状态对比（旧链）已退役」条）
- `ContentVerdict(g, i DiffEntry) (differs bool, channel string)` — **内容判定单点（ADR-347 D1/D4，verdict.go）**：两侧同键条目内容是否不同 + 实际所用判定信道（`VerdictChannelFold/Hash/Oversize/Size/None` 五常量）。规则单源：目录比折叠指纹（双有）→ 双有哈希比哈希 → 任一侧 Oversize 保守判「可能不同」→ 回退比 Size；分支序 = 信道优先级（IsDir 先于 Oversize）。**全信道语义锁 = `verdict_matrix_test.go`**（A 文件级 9 行 / B 目录 4 行 / C dirLevel 4 行 / D 夹内逐文件 4 行，2026-10-15 先打旧实现钉基线、重构后复跑全绿）；**新增信道 = 加判定输入字段 + 信道常量 + 矩阵加一行**（签名层面挡静默退化）。旧两份同义实现（sync_diff.go|contentDiffers、diffFolderContentsCore 的 contentStatus 闭包）已删——「加信道要人肉核对每份实现」的假绿温床（ADR-344 D1 先例）结构性消除
- `GetLinkType(path string) types.LinkType` — 判定 `symlink` / `hardlink` / `copy` / `unknown`
- `PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error)` — 推送缺失资源；**`types.IsDirLevelSync(rtype)` 注册表驱动**（YSM/MMD 等 `dirLevelSync` 类型）走文件夹级（`SyncResourcesDirLevel` + `installer.InstallDir`），其余走文件级（`SyncResources` + `installer.Install`）；部分失败返回 `ErrPartialSync`（2026-09-05 锐评 P1 刀加 sentinel，调用方可 `errors.Is(err, ErrPartialSync)` 区分「前置不满足」vs「可重试部分失败」）。dirLevel 清单先过 `dropAncestorUnits`（ADR-344 D4）
- `PullResources(rtype, globalDir, targetDir string, logger Logger) types.PullSyncResult` — 把实例侧 Extra 拉回仓库（纯复制，不建链接）；返回**结构化结果** `{OK, Failed, FirstError, Files}`（ADR-340-d1：**不再用 `(int, error)`**——绑定层以 reject 交付 error 时会丢掉成功计数，侧栏曾因此谎报「拉取 0 个文件，N 个失败」）；`Files` 为成功拉取的相对实例目录路径清单（保留层级），供前端「同步变更明细」逐条点名（2026-10-15 UX 补，侧栏拉取后不再只剩计数摘要）；无 error 返回值（本函数没有可前置失败的路径），dirLevel 类型先过 `dropAncestorUnits`（与推送侧对称）
- `PushSingleResource(filePath, customDir, globalDir, linkMode, rtype string) error` / `PullSingleResource(globalDir, targetDir, srcPath string) error` — 单条推送/拉取；`.json`/`.pmx`/`.pmd` 与目录按整文件夹处理，且**保留仓库相对层级**（`installDirUnitLocked`：`RelInside` + `InstallDirRelLocked`，越界/`rel=="."` 回退 basename；ADR-344 D3/D3b）
- `SyncCustomToRepo(customDir, repoDir string, scanFn, logger) (int, error)` — 把实例 custom 目录的模型收编回仓库，同哈希/同名跳过
- `RelinkDir(customDir, repoRoot, rtype, linkMode string, scanFn, logger) (types.RelinkResult, error)` — 按哈希重链接实例目录到仓库版本；返回结构化 `RelinkResult{OK,Failed,FirstError}`（ADR-342 D7′，替代原 `(int, error)` + `ErrPartialSync` 抬升），error 仅前置不满足（参数/scanFn 空），条目级失败进 `Failed` + `FirstError`（经 Logger 包装闭包归集首个原因），零成功不是 error
- `DetectConflicts(localDir, remoteDir, rtype string) (*ConflictReport, error)` — 冲突检测（conflict.go）：收集两端文件 SHA256，哈希不同→`ConflictContentModified`，大小不同→`ConflictSizeMismatch`（防御分支）
- `ResolveConflict(conflict FileConflict, strategy ResolutionStrategy, localDir, remoteDir string) error` — 单文件冲突解决：`force_remote` 先备份本地再用远端覆盖（失败回滚备份），`force_local` 不操作，`manual` 返回错误；**路径守卫**：入口用 `paths.RelInside` 校验 conflict.Path 不穿越 localDir/remoteDir（2026-09-05 锐评 P0 刀，原裸 `filepath.Join` 无越界守卫，与 sync_push.go 同款防线不对齐）
- `ResolveConflicts(conflicts []FileConflict, defaultStrategy ResolutionStrategy, localDir, remoteDir string) (resolved, failed, manual int)` — 批量解决，`SuggestedStrategy==manual` 时回退到 `defaultStrategy`
- `suggestStrategy(localTime, remoteTime time.Time) ResolutionStrategy` — 按修改时间推荐：远端新→`force_remote`，本地新→`force_local`，相同→`manual`
- **`collectFileEntries` 错误通道分离（2026-09 收口）**：返回的 `error` **仅表示结构性失败**（root 不存在 / Walk 顶层错误），此时结果不可用；条目级错误有两条且口径一致——① 单文件哈希失败（`hashErr`）：仅 log，条目保留 `Hash==""` 返回，`DetectConflicts` 据此标记 `HashFailed=true` 走人工审查；② 单条无法求相对路径（`relErr`，2026-09 降级）：同样仅 log 并跳过该条。**二者都不升级为整次 `DetectConflicts` 失败**——旧实现分别把 `hashErr` 混入 `walkErr`、把 `relErr` 直接赋 `walkErr`，导致单个被占用/超限文件或单条路径异常就让整次冲突检测不可用，`HashFailed` 分支永不可达。新增条目级错误须沿用「log + 跳过」形态，勿写入返回 error（护栏 `TestCollectFileEntries_HashFailureIsEntryLevel`、`TestDetectConflicts_HashFailedReportedNotAborted`）
- 函数类型：`ScanFunc`（扫描注入，由 internal/app 提供）、`Logger`（导入日志回调，薄壳注入 `App.logger.Add`）

## 与其他子系统关系

- 被 `internal/app/app_install.go` 调用（状态对比、推送/拉取、启禁同步、`GetLinkType` 决定删除策略）
- 被 `internal/app/app_scan.go` 调用（`ListVersions`）、`internal/app/app_config.go` 引用
- 被 [go_watcher](./go-watcher.md) 调用（文件变更时 `ListVersions` + `SyncToggleStatus` 自动同步启禁）
- 依赖 `go/types`（ModelEntry/InstanceStatus/LinkType 等）；本包不依赖 `go/ysm`（原 `HasYSMMod` 硬编码已收编删除，`InstanceStatus.HasYSM` 死字段同步删，mod 检测归 App 层 `HasModInDir` 注册表驱动）
- `sync_push.go` / `sync_relink.go` 反向依赖 [go_installer](./go-installer.md)（`Install` / `InstallDir` / `CopyFile`）——本包→installer 是单向的，installer 不得回调本包

## 不变量

- `.ban` 后缀 = 禁用模型：仓库侧 `.ban` 文件不进缺失列表；实例中对应哈希的文件标记 Disabled 而非 Extra
- **禁用后缀判断/剥离全仓委托 registry 单点（现状）**：sync.go 内所有 banned 判断与后缀剥离均走 `registry|IsDisableSuffix` / `registry|StripDisableSuffix`（后缀表含新标准 `.disabled` 与历史 `.ban`，见 sync.go 复核 P2-1 注「后缀表归 registry」）；dirLevel 信道因载体可在任意祖先层级另走逐段剥离 `registry|StripDisableSuffixSegments`（`relKeyDirLevel`）。⚠️ 勿把 `StripDisableSuffix`（尾段）与 `StripDisableSuffixSegments`（逐段）互换——键语义不同。原「2026-08-23 审计：sync.go 内 5 处内联 `.ban` 判断/剥离待归一」已收编（ADR-345 前后）：grep 复核 sync.go 无内联 `HasSuffix(".ban")`/`TrimSuffix(".ban")` 残留，`.ban` 字面量仅存于 `relKey` 注释（说明键语义）。若未来重新出现内联判断，按 ADR-064 归口声明（归一化归 registry/types 管）改走委托，勿反向「保留内联」
- 哈希全量计算（`scanner.ComputeFileHash`，`sync.go computeHash` 委托）；文件 >500MB（`types.MaxImportSize`）返回空串跳过哈希（同步对空哈希跳过匹配），读错误同样返回空
- **所有扫描路径都必须排除 `.recycle`**，与 `scanner.ScanEntries` 口径对齐，两条判据同族：**目录侧** `fsutil.IsRecycleDir` SkipDir（`SyncResources` collect 的 `handleDir`、`SyncResourcesDirLevel` 的 `collectEntries`、`collectFolderFiles`），**文件侧逐段** `sync_resource.go|hasRecycleSegment`（段名 `EqualFold(".recycle")`，覆盖 walk 进入子树后列出的文件、且不误伤文件名含该串的正常模型如 `my.recycle.backup.ysm`——`SyncToggleStatus` 的 `collectToggleFileInfos` 与 `hasDisabledDirCarrier` 用此；原 `strings.Contains(strings.ToLower(p), ".recycle")` 整串匹配已收敛为该逐段判据）——漏排会把回收站里的模型当成仓库活跃模型，同步管理器显示 missing 且可被推送回实例（回归 `TestSyncResources_IgnoresRecycleDir`、`TestHasRecycleSegment`、`TestSyncToggleStatus_RecycleSubtreeSkipped`）
- 跳过回收站时带 `path != 根目录` 守卫：若用户把仓库根/实例根本身命名为 `.recycle` 则不跳过，否则整次扫描会直接空掉
- 实例状态对比类入口现居 `go/instance.BuildInstanceStatusCounts`（面板链 fold），本包不再自带实例级集合运算；`.recycle` 的排除仍由注入的 scanFn（`scanner.ScanEntries*`）与被面板链复用的 `SyncResources*` 承担——换用不排 `.recycle` 的 scanFn 会重新引入误判
- `SyncResources` 对比 key 为**相对路径**（`relKey`：小写 + 正斜杠 + 去 `.disabled`/`.ban`，ADR-064 阶段二）；同名文件**内容判定走哈希优先、Size 兜底**（D2′-a / ADR-269，归一在判定表 `ContentVerdict`，verdict.go，ADR-347 单点）：两侧均带 scanner 哈希时比哈希——捕获「同大小但内容已变」的资源包文件（旧盲区1，纯 Size 会漏判 Synced），任一侧无哈希分两种——`DiffEntry.Oversize`（collect 按 `info.Size() > MaxImportSize` 置位，即 >500MB 被刻意跳过哈希）保守判「可能不同」→ Missing（P0-2 诚实化：同尺寸不足以证明内容一致，不再谎报 Synced）；其余空哈希（非 hashable 扩展 / `scanFn=nil` 的 push/pull/旧调用）仍回退比大小（复制会改 mtime 不可靠，故不用 mtime）。目录条目走**结构折叠指纹对比**（D2′-b / ADR-269，机制全文归 leaf 卡 [go-sync-resource-diff](./go-sync-resource-diff.md) 不变量「pack 目录折叠指纹」条）：两侧均带 `FoldDigest` 则比指纹、异指纹→Missing，任一侧无指纹（未折叠/旧数据）回退恒一致（不回归）。三个结果列表返回前均 `sort.Strings` 排序
- 扩展名过滤统一走 `types.IsResourceAllowed`（`types.AllExts()` + `.json` 仅 `ysm.json`）与 `packs.IsTypeModelFile`（单类型扩展集 + `ysm.json`，ADR-144 下沉），原 `isSyncAllowed` / `isModelFile` / `instance.extMatch` 三处同义实现已收敛（ADR-064 阶段一）
- **`SyncResourcesDirLevel` 容器 vs 叶子模型夹判定**（`collectEntries`，sync_dirlevel.go）：目录被 `isDirTypeModelFolder` 判真（直接含 .ysm/.ysm.json）后，若还直接含子模型文件夹（`containsModelSubfolder` 为真），则是「容器」而非「叶子模型夹」——**不下钻整体收编 SkipDir**，而继续下钻保留各子夹层级，由 `go/instance` 的 `nestDirLevelTree` 重建容器树。收发场景：`嵌套1/` 内含直接平铺 `动力臂.ysm` + `01_taisho_maid/` + `嵌套2/` 深层子夹，若被整体收编会把子夹层级吞掉，前端退化成摊平的 `01_taisho_maid/ysm.json` 文件行（违背仓库层级镜像）；只有「叶子模型夹」（含模型文件但无子模型夹）才 SkipDir 收编为单同步单元。**注意：容器下钻时还会把「自身」也登记成一条目录条目**（`entries[relKeyDirLevel(rootDir, path, true)] = path`，即**目录 marker**）——目的是与对侧（pre-fix 安装）同名叶子目录的键集一致，避免键集不相交产生幻影 Missing+Extra。这条 marker 落到展示层会渲染成「同名目录嵌在自己里面」（实测 `2.大学学姐 > 2.大学学姐`），须由 `go/instance` 的 `absorbSelfMarker` 按 Path 相等合并掉（见 [go-instance](./go-instance.md)）
- **目录级启禁同步 ADR-345 D1–D4（载体识别）** → 深挖归 leaf 卡 [go-sync-toggle](./go-sync-toggle.md)（枢纽只留不变量摘要：真值取文件系统不取 scanner 索引——禁用夹被 scanner SkipDir，载体目录须作候选且 `DisabledTwinForms` 双形态**恰好一侧存在**才改名、并存真 no-op；实例侧 `DisabledAncestorPath` 祖先链载体基准 diff，`installDirUnitLocked` 目标链探测命中即拒绝；`relKeyDirLevel` 逐段剥禁用后缀）
- **dirLevel 单元判定分两层（ADR-344 D1/D2）**：**文件单元**（仓库/实例任意深度的平铺模型文件）走内容级判定——单元表 `map[string]dirLevelUnit` 携带 `Size/Hash/Oversize`，两侧归成 `map[string]DiffEntry` 后委托 `ResourceDiff`，三条腿与文件级信道一致：两侧均有哈希比哈希、无哈希回退 Size、**任一侧超 MaxImportSize（>500MB）则保守判 Missing**（超限文件哈希被刻意跳过，同尺寸不足以证明内容一致；代价是推完也不转 Synced，与文件级信道现存行为一致）。哈希来自 scan 条目，Walk 回退信道由同一次 scanFn 结果旁挂，两条信道判定强度一致；**目录单元**仍是存在性语义——scan 信道只承载受支持扩展名的模型文件，纹理/mcmeta 不在条目里，`FoldDigest` 无从累积，只在 Walk 侧加指纹会让两条信道劈裂（违 `TestSyncResourcesDirLevelScanMatchesWalk` 的等价契约，而该契约正是 scan 快路径的前提）。故「目录单元 Synced」只表示该夹存在，**不表示夹内每个字节一致**；夹内分叉由展开层（`DiffFolderContentsScan` → 子文件 missing/diverged → 容器聚合）承担。**跨格式不比内容**：`relKeyDirLevel` 按模型身份剥扩展名/禁用后缀（`B.zip` 与 `B.ysm` 同键），仅当两侧原始相对路径（`dirLevelRel`，小写 slash）相等时才填内容字段——跨格式比字节恒不相等，照比会造出「点了推送也不收敛」的假待推送；此规则顺带把 `.disabled` 与活跃文件的差异挡在内容比较之外（留给批 C 的裁决）。`dirlevel` 缓存键因此新增 `hashed` 维度（与 `resources` 同款隔离；`folder` kind 恒 false）。回归 `sync_dirlevel_content_test.go`（内容异→Missing / 同→Synced / 跨格式→Synced / scan 同尺寸异内容→Missing / Walk 无摘要同尺寸→Synced 边界 / 超限同尺寸→Missing（diff 层 + 稀疏文件端到端两信道 wiring））
- **目录单元的祖先键不整体安装（ADR-344 D4）**：容器键是「键对齐 marker」（与对侧同名叶子目录对齐键集，防幻影 Missing+Extra），不是模型单元；`PushResources` / `PullResources` 的清单先过 `sync_push.go|dropAncestorUnits` 剔除「其下有更深条目」的祖先（判据 = 前缀 + 分隔符边界 + 大小写不敏感）。不剔则容器与其子单元重复拷贝同一批文件（计数膨胀，实测 3→2）+ 双倍 IO，且与面板链 `go/instance` 的 `pushTargets`「只递归子单元、从不整体推容器」口径相反。剔除后容器目录由子单元落位自然创建。**诚实残余**：容器根下既非模型单元、又不属于任何子夹的散文件（如 `tex/common.png`）不随推——面板链现状相同，本刀只把两路对齐
- **单条推送与批量推送保同一层级口径（ADR-344 D3/D3b/D3c）**：`sync_push.go|installDirUnitLocked` 用 `paths.RelInside(globalDir, dir)` + `installer.InstallDirRelLocked` 落位 `customDir/<仓库相对层级>`；越界（`relErr`）回退 `InstallDir` basename 语义（installer 自身的 `IsInside(filesRoot, srcDir)` 守会挡下）。这是面板行内推送与一键安装 `MissingDirs` 的消费端（`internal/app|PushSingleResourceToInstance`），拍平会让 `嵌套1/01_taisho_maid` 落到实例根。**`rel == "."`（源夹就是仓库根）必须显式拒绝**（AppError `ErrInvalidPath`「根级目录级安装入口被拒绝」）：basename 回退 = `InstallDirLocked(仓库根)` = **整座仓库复制进整合包**——根级 `ysm.json` 是合法 dirLevel 文件单元、面板 missing 行有推送按钮，而面板调用点**没有**导入链的根级兜底守（复核探针实证：修复前 `err=nil` 且 `customDir/ysm/其他模型/B.ysm` 落地）。同刀修掉一个死分支：`registry.IsYsmEntryJSON` 做裸名全等比较，原传全路径**恒 false** → ysm.json 的文件夹级分支从未触发（只落单个 json、同夹纹理全丢），改传 `filepath.Base` 后与两处已有同口径调用点对齐，`internal/app|pushRepoPathToInstance` 的根级兜底守随之成为真防线。回归锁 `sync_push_hierarchy_test.go`（嵌套夹/父目录层级/pmx/根级拒绝/根级 ysm.json 整仓防线；ysm.json 那条**必须断言配套纹理同落**，否则该分支退回死分支时测试仍绿）
- **两阶段遍历-执行模式**（`SyncToggleStatus`，sync.go）：`filepath.WalkDir` 回调中**不直接执行** `os.Rename`，而是先收集 `[]renameOp`，遍历完成后再批量执行。在 WalkDir 过程中修改目录结构会导致后续条目被跳过或重复处理。
- 同步/安装共享包级 `installer.InstallLock`（防与安装并发写同一文件），**锁范围分两派**：① 读+写一个函数内完成的整段持锁——`PushSingleResource` / `SyncCustomToRepo`；② **锁外扫描 + 锁内仅覆盖操作段**——`RelinkDir`（scanFn 扫描与目录身份快照锁外，仅 rename/回滚段持锁）与 `SyncToggleStatus`（阶段 1 仓库索引 + 实例目录遍历、阶段 2 哈希均锁外，仅阶段 3+4 计划 + rename 持锁，2026-10-14 锐评 ②）。第 ② 派的存在理由：仓库全量扫描在 scanner 缓存冷启动时整段走盘，而 watcher 触发的 syncAll 恰是冷启动路径（文件变更后 scanner 缓存刚失效，下一次 toggle 必冷扫），持锁期间会阻塞所有并发同步/安装/推送；两派内部对 `installer.Install/InstallDir/CopyFile` 均改用 `*Locked` 变体，避免同 goroutine 重入非重入 mutex 死锁｜第 ② 派的 TOCTOU 容忍理由见各自函数注释（索引快照到执行之间目录可能被外部改动，但 rename 前 os.Stat 预检 + rename 失败计入 failures 随 error 返回，不会静默搬错对象）｜回归锁 `sync_toggle_lockscope_test.go|TestSyncToggleStatus_ScanNotHeldLock`、`sync_relink_test.go|TestRelinkDir_ScanNotHeldLock`（探针 `IsLocked()`）
- 文件被占用（如 Minecraft 锁定）时 `isFileLocked` 识别后静默跳过不阻塞
- **`RelinkDir` 整夹替换四件套（ADR-342 D1/D2/D3/D5 + ADR-296 D4 身份复验）** → 深挖归 leaf 卡 [go-sync-relink](./go-sync-relink.md)（枢纽只留不变量摘要：旧夹备份后**从备份**回填实例独有文件、回填失败整夹回滚；目录身份走句柄态 `dirIdentity`（Windows `os.Lstat` 惰性 `fileStat` 恒真陷阱），快照缺失拒搬；同夹去重键含仓库源夹 + 落位校验；「改名搬运」只进空位——`newDir` 被活夹占用一律拒绝，这是整夹回滚删除边界安全的前提）
- **`.relink-bak-*` 备份尸体不参与扫描消费（ADR-296 D3，豁免面已按 ADR-342 D4/D6 扩到同步 diff 全通道 + 跨包单点）**：Go walk（`rust_backend` tag 已随 ADR-324 删除，现只有 Go 一个后端）会下钻备份目录并照常填哈希 → 尸体内条目哈希恒匹配仓库原件。谓词**已下沉** `go/fsutil/relink_backup.go|IsRelinkBackupPath`（单点事实源，`go/sync/sync_relink.go|isRelinkBackupPath` 仅为包内既有调用点保留的转发），消费方：`RelinkDir` custom 主循环、repoByHash 构建循环、`SyncToggleStatus` WalkDir（原三处，斩断「对尸体 rename→InstallDir→再生新备份」套娃与尸体被 `.disabled` 改名）、`collectEntriesWalk` / `collectEntriesFromScan`（生产链走 scan 反推，只修 Walk 等于没修）/ `handleDir`（file-level）/ `collectFolderFiles` + `collectFolderFilesFromScan`（夹内子文件），以及包外 `go/scanner`（幻影模型）/ `go/dedup`（`clean` 保尸体删活模型）/ `go/repoaudit`（统计虚高）。不豁免则尸体被判「实例独有（可拉取）」，一键拉取会把整个恢复点复制进仓库。回归测试 `TestRelinkDir_RelinkBackupCorpsesSkipped` / `TestSyncToggleStatus_RelinkBackupCorpsesSkipped` / `sync_corpse_exempt_test.go`（四条 collect 通道各一例）/ `go/fsutil/relink_backup_test.go`
- 硬链接检测跨平台分实现，系统调用失败一律降级 `LinkCopy`；`GetLinkType` 必须先 `os.Lstat` 判 `os.ModeSymlink`
- 链接类型是删除策略依据：硬链接(nlink>1)/符号链接直接删，普通文件才移回收站
- 拉取侧 `copyFile` 已修复为 **tmp+rename 原子落地**；`copyDirRecursive` 保留符号链接语义
- 冲突解决的备份/覆盖/回滚三处拷贝已收敛 `fsutil.CopyFile` 原子 tmp+rename
- 实例 custom 目录固定为 `config/yes_steve_model/custom`

## 已知限制 / 待治理（2026-08-24 审计）

> 均有单测/注释留痕，改动前先读对应源码注释；修复任一项时删除对应行并补回归测试（2026-10-15 清账：已治理 ✅ 四项——dirLevel 同键覆盖 fail-loud、patternFind memo、pack 折叠指纹 D2′-b、DiffFolderContents D2′-c——按其自纪律移除，现行机制全文在「不变量」段与 leaf 卡 [go-sync-resource-diff](./go-sync-resource-diff.md)，治理过程在裁定记录，本清单只留**未收口**项）。

- **key 小写归一 vs 路径敏感操作**：`relKey` / `relKeyDirLevel` 把整个相对路径转小写做身份 key，push/pull 却用原路径——大小写敏感 FS（Linux 服务器仓库）上 `Pack/` 与 `pack/` 视为同一模型但操作各走各路，可能错配。**可见性已治理（2026-10-14 P2，同日扩面）**：`go/repoaudit|caseSiblingWarnings` 按**小写相对路径折叠面**（与 sync key 同构，覆盖同级与祖先目录大小写分叉两形态）把孪生路径进体检 `Warnings`（诊断信道不扣分；Windows/NTFS 物理无法创建孪生故主战场零告警，回归 `repoaudit_casesib_test.go`）。**行为未改**（小写归一是跨格式匹配设计语义，修行为反引入 Windows 风险）——若未来要根治（key 保留大小写 / 操作前归一）须另立 ADR
- **状态对比 IO 放大已三层缓存治理**（`BuildSyncItems` 注入 `scanner.ScanEntriesWithHit` + sync 扫盘缓存 + instance 结果缓存，8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树实际只走盘一次）——缓存机制、失效配对契约、`hashed` 维度、写面派生 fail-closed 闸（`tests/test_sync_write_cache_pairing.ts` × `scripts/_lib/write-surface-gate.ts`）的深挖全文归 leaf 卡 [go-sync-cache-pairing](./go-sync-cache-pairing.md)（枢纽只留红线：**app 层每条写入口成对调 `instance.InvalidateSyncItemsCache()` + `ysmsync.InvalidateSyncScanCaches()` 或等价三层清，新写点漏归类派生闸当场红**；sync 包内写操作 `defer InvalidateSyncScanCaches()` 自清一侧）
- **SyncToggleStatus basename 兜底已实证非误伤**（2026-10-14 锐评 ③，防再误判条目）：匹配顺序 relKey → hash → basename；basename 查 `repoName[纯文件名]`，而该键只在仓库条目 Path 越出 filesRoot 前缀时才写入——正常布局恒 miss，「同名不同路径互传染」不可达，勿再列「待收紧」（实证 `sync_toggle_basename_reach_test.go` 三例 + `TestChar_…_BaseNameFallback` 正反闭环）


## 裁定记录

- `2026-10-14`：relink 失败信号收口（对抗复核 C1）——`RelinkDir` 统计失败条目，**零成功且有失败**返回 `ErrPartialSync`（原只记日志返回 `(0, nil)` → 前端弹「已重新链接 0 个文件」成功 toast）；app 层 `RelinkAllInstanceResources` 遇 `ErrPartialSync` 不中断类型循环、仅在**整实例零成功**时上抛，有任何成功返回 `(total, nil)`（逐条失败在导入日志面板，不用「整实例失败」盖掉计数）｜契约变化同步改了两条特征用例与两条拒搬用例的 `NoError` → `ErrorIs`（行为断言原样）｜回退 = `go/sync/sync_relink.go|ErrPartialSync`、`internal/app/app_install_instance.go|RelinkAllInstanceResources`
- `2026-10-14`：**`ErrPartialSync` 被结构化 `types.RelinkResult{OK,Failed,FirstError}` 取代（ADR-342 D7′，锐评批 D ①）**——C1 的 `(int, error)` 体裁仍有半截问题：部分成功时失败计数被丢掉，`RelinkAllInstanceResources` 返回 `(total, nil)`，设置页 toast 只能弹「已重新链接 N 个文件」，而 `settings.relinkDonePartial`（N 成功 M 失败）三语 key 长期不可达（前端 `failed` 恒为 0/1）。改法：`RelinkDir(...) (types.RelinkResult, error)`，error 仅前置不满足；条目级失败进 `Failed` + `FirstError`（经 `sink` Logger 包装闭包归集首个原因），零成功不是 error；`RelinkAllInstanceResources` 聚合各类型结果，前端据此弹「N 成功 M 失败 + 首个原因」｜既有 D7 用例的 `ErrorIs(…, ErrPartialSync)` 断言改为 `NoError` + `res.OK`/`res.Failed`/`res.FirstError`（行为等价，仅体裁变了）；`ErrPartialSync` 仍保留给 `PushResources`｜变异检查：摘掉 `sink` 的 firstErr 归集 → 四条 D7 用例的 `FirstError` 断言立即红｜回退 = `go/sync/sync_relink.go|RelinkDir`、`go/types/types.go|RelinkResult`
- `2026-10-14`：relink 加固第二刀（对抗复核 A1/A2/C3 收口）——「改名搬运只进空位」+ 去重键含仓库源夹与到位校验 + 身份复验错误分类（不存在 vs 无法读取）｜旧回滚无条件 `RemoveAll(dstBase/base(srcDir))` 在「仓库夹名≠实例夹名且目标已存在」时删掉用户既有活夹（变异检查实测 `keep.png` 被删）；旧去重只按实例夹 → 第二条目未重链却计成功（count=2、零日志）｜回退 = `go/sync/sync_relink.go|relinkLandingKey`、`go/sync/sync_relink.go|rollbackRelinkReplace`
- `2026-10-14`：relink 整夹替换改为「保全实例独有文件 + 句柄态目录身份 + 同夹条目去重 + 备份尸体同步豁免」四件套（ADR-342）｜旧实现成功即 `RemoveAll` 备份 → 实例独有文件不可逆静默消失（探针实证 `count=1 err=nil logs=[]`）；ADR-296 D4 的 `os.SameFile` 在 Windows 上因惰性 `fileStat` 按名重开而恒真（探针实证同名重建仍判 same）｜回退 = `go/sync/sync_relink.go|collectInstanceOnlyFiles`、`go/sync/sync_relink.go|dirIdentity`、`go/sync/sync_relink.go|isRelinkBackupPath`
- `2026-10-14`：contentDiffers 对 Oversize（>MaxImportSize 被跳过哈希）文件不再回退 Size 判 Synced，保守判 Missing（待推送）——P0-2 诚实化，消灭 >500MB 静默假绿｜超限文件因 bug-chronicle #36 刻意跳过哈希，同尺寸不足以证明内容一致；非 hashable / scanFn=nil 的空哈希仍走 Size 兜底（误判面窄、不回归），故只翻转 Oversize 一类｜回退 = `go/sync/sync_diff.go|DiffEntry.Oversize`
- `2026-10-14`：dirLevel 同键纯文件/文件碰撞（同级同身份不同扩展名共存）治理为 fail-loud：collect 层 upsertDirLevelUnit 记录 last-write-wins 覆盖事件（两侧 Rel 点名）→ syncResourcesDirLevel 汇入 ResourceSyncResult.Warnings（omitempty 诊断信道，不影响四桶判定）并分侧落日志；匹配语义（跨格式同身份归一）不动｜原实现在覆盖方静默消失——同步面板从此看不见被丢的物理模型；用户裁定方向为可见性而非改键语义（跨格式同身份是设计语义）｜回退 = `go/sync/sync_dirlevel_sync.go|upsertDirLevelUnit`
- `2026-10-14`：**`SyncToggleStatus` 阶段 1 移出 `InstallLock`（锐评 ②，锁范围与 `RelinkDir` 对齐）**——`collectToggleRepoIndex` 原在临界区内做仓库全量扫描（scanFn 含 SHA256 哈希）+ 索引构建 + 禁用载体 Walk + 实例目录 Walk，四步全是纯读、持锁却不保护任何写操作；而 scanFn 在 scanner 缓存冷启动时整段走盘，watcher 触发的 syncAll 恰是冷启动路径（文件变更后 scanner 缓存刚失效，下一次 toggle 必冷扫）→ 持锁期间阻塞所有并发同步/安装/推送。现：阶段 1 与阶段 2（哈希）均锁外，仅阶段 3+4（计划 + rename 操作段）持锁，与 `RelinkDir` 既有范式对齐（其注释明写「持锁执行会阻塞所有其他同步/安装操作」）。TOCTOU 容忍：索引快照到执行之间目录可能被外部改动，但 `planToggleRenames` 执行前对目标 os.Stat 预检、`applyToggleRenames` 的 rename 失败即计入 failures 随 error 返回——不会静默搬错对象（相对 `RelinkDir` 的 dstSnapshots 身份复验粒度更弱，但 rename 本身原子，同风险模型已被同包接受）｜**不改签名、不改匹配语义、不改计数语义**，对外契约零变化，仅锁范围收窄｜回归锁 `go/sync/sync_toggle_lockscope_test.go|TestSyncToggleStatus_ScanNotHeldLock`（探针 `IsLocked()`；另设两道防空转/防退化断言：scanFn 未被调用即 fail、`LockTracker` 类型断言失败即 fail）｜回退 = `go/sync/sync.go|collectToggleRepoIndex`
- `2026-10-14`：**basename 兜底误伤面被实证为不可达，裁定不改代码（锐评 ③）**——原观察项称「三级匹配最后一级是 basename，同名不同路径的不同模型会被互相匹配启禁状态，新仓库数据齐全时该兜底应可收紧」，实为静态阅读的推断而非实证。实证推翻：basename 兜底查 `repoName[纯文件名]`，而 `collectToggleRepoIndex` 只在仓库条目 `e.Path` 越出 filesRoot 前缀时才写纯文件名键——正常仓库布局下纯文件名键恒不存在，兜底恒 miss，误伤面不可达。且收紧的收益为负：该兜底是异构 scanFn 注入越界条目的**唯一**关联通道，砍掉即断该路径。原观察项还写错了匹配顺序（实为 relKey → hash → basename，非「哈希 → 相对路径 → 纯文件名」）｜**产出：实证锁 + 文档修正，零代码变更**——`go/sync/sync_toggle_basename_reach_test.go` 三例闭环（正常布局不命中 / 越界布局命中 / `repoName` 键形态直断言无纯文件名键），与既有 `TestChar_SyncToggleStatus_RepoOutsideFilesRoot_BaseNameFallback` 反向互证；两张知识卡的顺序描述与「观察项」一并修正｜教训：观察项若只凭代码推断而不实证，会把「条件不可达的兜底」误记为「待收紧的误伤面」，导致下一轮读者误判收益

- `2026-10-15`：**锐评「整合包同步功能改进」四项中三项被代码实证证伪，裁定零代码变更（仅固化为本记录）**——对同步功能做改进锐评后逐项实证：①「同步缓存 key 不含 `hashed` 维度」已证伪——`sync_cache.go|syncDirectoryScanKey` 自 ADR-269/ADR-344 起已含 `hashed bool` 字段，`collectResourceEntries`（`sync_resource.go:160`）与 `dirLevelCacheKey`（`sync_dirlevel_sync.go:49`）均按 `scanFn != nil` 正确赋值，测试 `TestSyncResourcesWithConfig_HashDetectsContentChange` 锁死；②「中间状态 `_reload` 去重」已证伪——`app-sidebar/index.ts|_reload` 已有 300ms 防抖 + `_reloadInFlight` 单飞 + `_reloadPending` 尾随补跑 + 代际守卫 `_guard` + `app-sidebar.component.test.ts` 守护；③「repo audit 大小写孪生升阻塞级」裁定不改——`caseSiblingWarnings` 属只读分析层，升级阻塞级越界其职责，且 Windows 主战场物理无法创建孪生（零误报、覆盖面窄），维持诊断信道 Warnings + 另立 ADR 路径。④「同步面板变更明细」为真实 UX 空白但非缺陷，留作 UX 议题。教训：对高强度锐评修复后的成熟模块，先做代码实证再下「待改进」结论，避免把已落地的不变量误记为缺口（与 2026-10-14 basename 兜底同型）
- `2026-10-16`：**整合包域全链锐评收口 → [ADR-351](../adr/architecture/ADR-351-sync-domain-review-consolidation.md)（提议中）**——三类结构性病立项四刀：D1 六 Walk 收集器统一过滤框架（合并 `hasRecycleSegment`/`fsutil.IsRecycleDir` 两套谓词；conflict.go|collectFileEntries 现完全缺回收站过滤）、D2 冲突通道并入 verdict 判定表（conflict.go 三分支与 verdict.go 平行）、D3 扫描侧混合夹单登记（下游 `instance_tree.go|absorbSelfMarker` + `status_counts.go|dedupeSorted` 双层补偿随根因退役）、D4 pushTargets 三路推导下沉本包 + 目录参数命名收敛（globalDir/instDir）。实施进度记各 leaf 卡，本条只记方向与验收不变量（新增收集器生而带过滤 / 新增判定信道冲突通道自动跟进 / 同一物理文件至多登记一次）
- `2026-10-16`：**「16 处 `log.Printf` 违反日志铁律」系锐评误判，裁定零变更（ADR-351「明确不做」记录在案）**——实证：`internal/app/app.go` 启动即 `log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))`，`go/logs/runtime.go|RuntimeBuffer` 明文「捕获标准库 log 输出（watcher/sync 等）」——标准库 log 就是运行时调试日志指定出口（全仓 190+ 处同惯例：geometry 27 / avatar 19 / sync 16），环形面板可见。`go/AGENTS.md`「日志用统一 logs 包」铁律治理的是**业务操作日志**（`logs.Logger` ImportLog，用户侧操作流水）与 `fmt.Println` 散打，与运行时调试日志分工不同。教训：评审者引 AGENTS.md 铁律前先查目标包语义分工，勿把「同名不同物」当违规（与 2026-10-15 ①同型：静态阅读未实证）

## 深挖拆分索引（2026-10-14 P1a）

本卡为 go/sync 包级枢纽（职责 + 入口 + 不变量索引）。三块子机制的深挖已拆 leaf 卡，改对应源码优先查 leaf 卡：

- [go-sync-relink](./go-sync-relink.md) — `RelinkDir` 整夹原子替换 + ADR-342 四件套（保全实例独有文件 / 句柄态目录身份 / 同夹去重 / 备份尸体豁免）
- [go-sync-toggle](./go-sync-toggle.md) — `SyncToggleStatus` 启禁同步 + ADR-345 目录级禁用载体识别三件套（`DisabledTwinForms`/`DisabledDirCounterpart`/`DisabledAncestorPath`）
- [go-sync-cache-pairing](./go-sync-cache-pairing.md) — 双缓存失效配对契约 + 写面派生 fail-closed 闸（`write-surface-gate.ts`）
- [go-sync-resource-diff](./go-sync-resource-diff.md) — 资源/文件夹级 diff 与 dirLevel 内容判定（既有 leaf 卡）

## 相关

- [go_installer](./go-installer.md) — 按 LinkMode 实际落地复制/硬链接/符号链接
- [go_recycle](./go-recycle.md) — 删除时按链接类型分流
- [go_watcher](./go-watcher.md) — 文件监听触发自动同步
- AGENTS.md 致命陷阱 §二 #8（硬链接误删）
