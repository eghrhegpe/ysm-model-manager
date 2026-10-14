---
kind: go-sync
name: 整合包同步 go/sync
tier: architecture
last_verified: 2026-10-14
adr:
  - ADR-064
  - ADR-296
  - ADR-342
  - ADR-344
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
  - go/fsutil/hardlink_windows.go
  - go/fsutil/hardlink_other.go
auto_fields:
  symbols_with_lines:
    - ConflictContentModified
    - ConflictReport
    - ConflictSizeMismatch
    - ConflictType
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
- `SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error)` — 把仓库的启禁状态同步到实例（**文件级**：哈希 → 相对路径 → 纯文件名三级匹配，重命名加/去 `.disabled`；**目录级**：见下条不变量），返回禁用数、启用数
- `ListVersions(mcRoot string) []types.VersionInstance` — 枚举实例，三种布局：目录本身是 instances（子目录含 `.minecraft`/`minecraft`）、PrismLauncher `{mcRoot}/instances/{name}/.minecraft/`、标准 `{mcRoot}/versions/{name}/`
- `HasDotMinecraftSubdirs(path string) bool` / `FindMinecraftDir(parentDir string) string` — 实例布局探测辅助
- `SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult` — **ADR-064 阶段二：全树递归 + 相对路径（relKey）对比**全局 ↔ 整合包资源；嵌套文件天然区分、无同名冲突，原「只扫顶层」深度守卫已取消。含 `pack.mcmeta` 的文件夹作为整体单元（仅资源包类型收集）；过滤/归一化统一走 `types.IsResourceAllowed` / `types.NormalizeResourceName`，归并走 `ResourceDiff`（sync_diff.go）。薄壳转发 `SyncResourcesWithConfig` 且 `scanFn=nil`（恒无哈希、回退 Size）
- `SyncResourcesWithConfig(globalDir, instanceDir string, config *types.SyncConfig, scanFn ScanFunc, rtype ...string) types.ResourceSyncResult` — 带冲突策略 + **内容级哈希**的完整入口（D2′-a / ADR-269）。`scanFn` 提供 scanner 已缓存化的文件哈希，`collect` 以 `relKey(rootDir, e.Path)` 同源键旁挂到 `DiffEntry.Hash`，让 `ResourceDiff` 对**同大小异内容**的资源包文件判出 Missing（盲区1）。scanFn 命中 scanner 30s 缓存、哈希在其侧并行预算内——不在 sync 热路径 / `InstallLock` 下现算（不触 hashlock 红线）。传 nil（push/pull 及旧调用）→ 条目恒无哈希 → 行为与 Size-only 现状完全一致。生产入口 `internal/app.App.SyncResources` 注入 `a.scanModelEntries`
- `SyncResourcesDirLevel(globalDir, instanceDir, rtype string)` / 优化版 `SyncResourcesDirLevelScan(globalDir, instanceDir, rtype string, scanFn ScanEntriesFn)` — 按文件夹名对比（YSM 的 ysm.json 文件夹 / MMD 的 .pmx/.pmd 文件夹 / 蓝图 .nbt 文件夹），同名时文件夹优先于平铺文件。`SyncResourcesDirLevel` 走 filepath.Walk（测试/旧调用方，行为不变）；`SyncResourcesDirLevelScan` 注入 scanner 已缓存扫描结果，命中时从 ModelEntry 列表反推同步条目（无嵌套模式类型 MMD/YSM 与原 Walk 精确等价；含嵌套模式 maid-model 回退 Walk），消除 8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树的重复 Walk。**单元带内容字段并复用 `ResourceDiff` 做内容级判定（ADR-344 D1）**：平铺文件单元两侧同格式时比哈希（scan 信道）/ Size（Walk 信道），仓库侧改过内容的平铺 `.ysm` 不再被判 Synced；目录单元仍为存在性语义（见不变量「dirLevel 单元判定分两层」）。**结果携 `Warnings` 诊断信道（2026-10-14 fail-loud 裁定，非四桶判定成员）**：dirLevel 键碰撞（同级同身份不同扩展名文件共存、last-write-wins 覆盖事件）经 `sync_dirlevel_sync.go|upsertDirLevelUnit` 逐条点名（被覆盖方 + 覆盖方），汇入 `ResourceSyncResult.Warnings` 并落日志；零碰撞恒空（`omitempty` 保持旧 JSON 载荷洁净）。缓存命中时不重产（首次走盘已记录，防日志刷屏）
- `ResourceDiff(global, instance map[string]DiffEntry) types.ResourceSyncResult` — **单点对比归并**（sync_diff.go，ADR-064 阶段一）：内容判定统一走 `contentDiffers`——两侧均带哈希则比哈希（哈希不同→Missing 待更新，捕获同大小异内容），任一侧无哈希则回退比大小（D2′-a / ADR-269）；同名内容一致 Synced / 仅单侧 Extra，结果排序确定性；**两侧同键而内容不同时同时进 `Missing` 与新增 `Diverged`**（ADR-340-d2：Diverged 是 Missing 的**子集**而非第四桶——把「待推送更新」与「仅全局有」被合并掉的那一维补回来，供面板分状态、侧栏如实报「覆盖了 N 处实例侧手改」）；`SyncResources` 消费，key 由调用方决定（统一为 `relKey` 相对路径）。注：`CompareGlobalInstanceHashes`（旧非 YSM 实例状态对比）已随死代码清理删除；实例状态对比的**侧栏消费端**（旧 `GetInstanceStatusWith` 哈希/relKey 双模集合运算）亦于 ADR-310 退役，统一折面板链产物（见上「实例状态对比（旧链）已退役」条）
- `GetLinkType(path string) types.LinkType` — 判定 `symlink` / `hardlink` / `copy` / `unknown`
- `PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error)` — 推送缺失资源；**`types.IsDirLevelSync(rtype)` 注册表驱动**（YSM/MMD 等 `dirLevelSync` 类型）走文件夹级（`SyncResourcesDirLevel` + `installer.InstallDir`），其余走文件级（`SyncResources` + `installer.Install`）；部分失败返回 `ErrPartialSync`（2026-09-05 锐评 P1 刀加 sentinel，调用方可 `errors.Is(err, ErrPartialSync)` 区分「前置不满足」vs「可重试部分失败」）。dirLevel 清单先过 `dropAncestorUnits`（ADR-344 D4）
- `PullResources(rtype, globalDir, targetDir string, logger Logger) types.PullSyncResult` — 把实例侧 Extra 拉回仓库（纯复制，不建链接）；返回**结构化结果** `{OK, Failed, FirstError}`（ADR-340-d1：**不再用 `(int, error)`**——绑定层以 reject 交付 error 时会丢掉成功计数，侧栏曾因此谎报「拉取 0 个文件，N 个失败」）；无 error 返回值（本函数没有可前置失败的路径），dirLevel 类型先过 `dropAncestorUnits`（与推送侧对称）
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
- **`.ban` 剥离/判断现状分布（2026-08-23 审计）**：sync.go 内 5 处——3 处已委托 `types.StripBanSuffix`（Disabled/Extra/status.Name）+ 2 处内联判断（`strings.HasSuffix(strings.ToLower(name), ".ban")`）+ 1 处内联剥离（`strings.TrimSuffix(strings.ToLower(e.Name), ".ban")`——repoName 匹配 key，供「同名不同文件夹」的复制/重命名/匹配消费，sync.go banned 记录段）。**警告（勿擅自归一）**：内联剥离与 `types.NormalizeResourceName` **语义不等价**（后者额外剥 `.disabled`）——直接替换会改变 repoName key 与 banned 匹配行为；若要归一，先加单测锁定 repoName key 语义（含 `.disabled` 文件的 banned 记录行为）再动。ADR-064 归口声明（归一化归 types 管）见 [ADR-064](../adr/ADR-064-sync-convergence-scanner-single-source.md)，该内联是落地后的漏网
- 哈希全量计算（`scanner.ComputeFileHash`，`sync.go computeHash` 委托）；文件 >500MB（`types.MaxImportSize`）返回空串跳过哈希（同步对空哈希跳过匹配），读错误同样返回空
- **所有扫描路径都必须排除 `.recycle`**，与 `scanner.ScanEntries` 口径对齐：`SyncResources` 的 collect（`sync.go`，统一 collect 闭包内 `fsutil.IsRecycleDir` SkipDir）、`SyncResourcesDirLevel` 的 `collectEntries`（sync_dirlevel.go）均跳过；`SyncToggleStatus` 用 `strings.Contains(strings.ToLower(p), ".recycle")` 检查整个路径（sync.go），非路径前缀匹配——漏排会把回收站里的模型当成仓库活跃模型，同步管理器显示 missing 且可被推送回实例（回归测试 `TestSyncResources_IgnoresRecycleDir`）
- 跳过回收站时带 `path != 根目录` 守卫：若用户把仓库根/实例根本身命名为 `.recycle` 则不跳过，否则整次扫描会直接空掉
- 实例状态对比类入口现居 `go/instance.BuildInstanceStatusCounts`（面板链 fold），本包不再自带实例级集合运算；`.recycle` 的排除仍由注入的 scanFn（`scanner.ScanEntries*`）与被面板链复用的 `SyncResources*` 承担——换用不排 `.recycle` 的 scanFn 会重新引入误判
- `SyncResources` 对比 key 为**相对路径**（`relKey`：小写 + 正斜杠 + 去 `.disabled`/`.ban`，ADR-064 阶段二）；同名文件**内容判定走哈希优先、Size 兜底**（D2′-a / ADR-269，归一在 `contentDiffers`，sync_diff.go）：两侧均带 scanner 哈希时比哈希——捕获「同大小但内容已变」的资源包文件（旧盲区1，纯 Size 会漏判 Synced），任一侧无哈希分两种——`DiffEntry.Oversize`（collect 按 `info.Size() > MaxImportSize` 置位，即 >500MB 被刻意跳过哈希）保守判「可能不同」→ Missing（P0-2 诚实化：同尺寸不足以证明内容一致，不再谎报 Synced）；其余空哈希（非 hashable 扩展 / `scanFn=nil` 的 push/pull/旧调用）仍回退比大小（复制会改 mtime 不可靠，故不用 mtime）。目录条目走**结构折叠指纹对比**（D2′-b / ADR-269，见下「pack 目录折叠指纹」条）：两侧均带 `FoldDigest` 则比指纹、异指纹→Missing，任一侧无指纹（未折叠/旧数据）回退恒一致（不回归）。三个结果列表返回前均 `sort.Strings` 排序
- 扩展名过滤统一走 `types.IsResourceAllowed`（`types.AllExts()` + `.json` 仅 `ysm.json`）与 `packs.IsTypeModelFile`（单类型扩展集 + `ysm.json`，ADR-144 下沉），原 `isSyncAllowed` / `isModelFile` / `instance.extMatch` 三处同义实现已收敛（ADR-064 阶段一）
- **`SyncResourcesDirLevel` 容器 vs 叶子模型夹判定**（`collectEntries`，sync_dirlevel.go）：目录被 `isDirTypeModelFolder` 判真（直接含 .ysm/.ysm.json）后，若还直接含子模型文件夹（`containsModelSubfolder` 为真），则是「容器」而非「叶子模型夹」——**不下钻整体收编 SkipDir**，而继续下钻保留各子夹层级，由 `go/instance` 的 `nestDirLevelTree` 重建容器树。收发场景：`嵌套1/` 内含直接平铺 `动力臂.ysm` + `01_taisho_maid/` + `嵌套2/` 深层子夹，若被整体收编会把子夹层级吞掉，前端退化成摊平的 `01_taisho_maid/ysm.json` 文件行（违背仓库层级镜像）；只有「叶子模型夹」（含模型文件但无子模型夹）才 SkipDir 收编为单同步单元。**注意：容器下钻时还会把「自身」也登记成一条目录条目**（`entries[relKeyDirLevel(rootDir, path, true)] = path`，即**目录 marker**）——目的是与对侧（pre-fix 安装）同名叶子目录的键集一致，避免键集不相交产生幻影 Missing+Extra。这条 marker 落到展示层会渲染成「同名目录嵌在自己里面」（实测 `2.大学学姐 > 2.大学学姐`），须由 `go/instance` 的 `absorbSelfMarker` 按 Path 相等合并掉（见 [go-instance](./go-instance.md)）
- **目录粒度启禁同步的真值取文件系统，不取 scanner 索引（ADR-345 D1）**：目录级禁用（模型夹 `X/` ↔ `X.disabled/`）的载体是**目录**，而 `scanner_scan.go|processScanDirEntry` 按 ADR-038 D3.7 对禁用目录 `SkipDir` → toggle 的仓库索引（建在同一个 scanFn 上）里**根本没有禁用夹**；实例侧原先又只收文件、`IsDisableSuffix` 只看尾段（`X.disabled/ysm.json` 尾段是 `ysm.json`）→ 载体在两条边都不可见，两方向均 `0/0/nil` 静默失效（探针 P1/P2 实证；文件级对照正常）。现：`collectToggleFileInfos` 把**目录**也作为候选（载体标 banned 并 `SkipDir`，不下钻——改名搬走整棵子树，下钻候选路径当场失效；目录候选不进阶段 2 哈希预算）；`planToggleRenames` 的目录分支走 `sync.go|dirToggleDecision`，用 `fsutil|DisabledTwinForms` 探仓库侧同一路径的活跃/载体**两种目录形态**——**恰好一侧存在**才判 matched，据此整目录改名；两侧**并存**或都不存在 → 保守不动（并存必须真 no-op：早前借 `DisabledDirCounterpart` 的活跃短路判载体 → 并存走进「应活跃」分支，把用户既有禁用载体**强制启用**，复核 P1-1 实证 禁用 0 启用 1）。另外 `collectToggleRepoIndex` 的空索引早退补 `hasDisabledDirCarrier` 豁免（仓库只有禁用夹时索引必空，否则禁用方向永远失效，复核 P2-2）。回归 `sync_toggle_dirlevel_test.go`（禁用/启用方向、整目录改名不退化成夹内逐文件、**并存不动作且夹具用实例侧载体**、杂散文件不误改、仓库只有禁用夹仍生效、目录不进哈希预算、文件级回归）
- **实例侧禁用载体识别（ADR-345 D2/D3/D4）**：`fsutil|DisabledTwinForms` / `DisabledDirCounterpart` / `DisabledAncestorPath` 三件套（目录限定，后缀表走 `registry|DisableSuffixes` 副本）。`go/instance|appendOneItem` 的实例侧路径（原为**盲 join** `instDir/<rel>`）过 `DisabledAncestorPath`：实例把整夹**或其祖先容器夹**改名后，子项以载体为基准 diff、单元标 ⛔ 进中立桶（不进待推送/一键清单），斩断「误判待推送 → 推送另建活跃副本 = 模型复活 + 同模型两份」。`installDirUnitLocked` 在落位前对**目标链**做同一探测，命中即**拒绝**（宁可报错也不静默复制第二份）。配套：`relKeyDirLevel` 改**逐段**去禁用后缀（`registry|StripDisableSuffixSegments`）——载体可在任意祖先层级，只剥尾段会让 `X.disabled/sub/` 与 `x/sub/` 成两个键，产生幻影 Missing+Extra（Extra 可拉取，一拉就把 `.disabled` 载体名复制进仓库）。**信道口径**：生产 scan 信道里 scanner 已 SkipDir 掉载体 → 单元 raw status 是 `missing`；Walk 信道因键归一判 `synced`——**面板显示经 D3 统一为 ⛔**，但断言 raw status 的测试必须分信道写
- **dirLevel 单元判定分两层（ADR-344 D1/D2）**：**文件单元**（仓库/实例任意深度的平铺模型文件）走内容级判定——单元表 `map[string]dirLevelUnit` 携带 `Size/Hash/Oversize`，两侧归成 `map[string]DiffEntry` 后委托 `ResourceDiff`，三条腿与文件级信道一致：两侧均有哈希比哈希、无哈希回退 Size、**任一侧超 MaxImportSize（>500MB）则保守判 Missing**（超限文件哈希被刻意跳过，同尺寸不足以证明内容一致；代价是推完也不转 Synced，与文件级信道现存行为一致）。哈希来自 scan 条目，Walk 回退信道由同一次 scanFn 结果旁挂，两条信道判定强度一致；**目录单元**仍是存在性语义——scan 信道只承载受支持扩展名的模型文件，纹理/mcmeta 不在条目里，`FoldDigest` 无从累积，只在 Walk 侧加指纹会让两条信道劈裂（违 `TestSyncResourcesDirLevelScanMatchesWalk` 的等价契约，而该契约正是 scan 快路径的前提）。故「目录单元 Synced」只表示该夹存在，**不表示夹内每个字节一致**；夹内分叉由展开层（`DiffFolderContentsScan` → 子文件 missing/diverged → 容器聚合）承担。**跨格式不比内容**：`relKeyDirLevel` 按模型身份剥扩展名/禁用后缀（`B.zip` 与 `B.ysm` 同键），仅当两侧原始相对路径（`dirLevelRel`，小写 slash）相等时才填内容字段——跨格式比字节恒不相等，照比会造出「点了推送也不收敛」的假待推送；此规则顺带把 `.disabled` 与活跃文件的差异挡在内容比较之外（留给批 C 的裁决）。`dirlevel` 缓存键因此新增 `hashed` 维度（与 `resources` 同款隔离；`folder` kind 恒 false）。回归 `sync_dirlevel_content_test.go`（内容异→Missing / 同→Synced / 跨格式→Synced / scan 同尺寸异内容→Missing / Walk 无摘要同尺寸→Synced 边界 / 超限同尺寸→Missing（diff 层 + 稀疏文件端到端两信道 wiring））
- **目录单元的祖先键不整体安装（ADR-344 D4）**：容器键是「键对齐 marker」（与对侧同名叶子目录对齐键集，防幻影 Missing+Extra），不是模型单元；`PushResources` / `PullResources` 的清单先过 `sync_push.go|dropAncestorUnits` 剔除「其下有更深条目」的祖先（判据 = 前缀 + 分隔符边界 + 大小写不敏感）。不剔则容器与其子单元重复拷贝同一批文件（计数膨胀，实测 3→2）+ 双倍 IO，且与面板链 `go/instance` 的 `pushTargets`「只递归子单元、从不整体推容器」口径相反。剔除后容器目录由子单元落位自然创建。**诚实残余**：容器根下既非模型单元、又不属于任何子夹的散文件（如 `tex/common.png`）不随推——面板链现状相同，本刀只把两路对齐
- **单条推送与批量推送保同一层级口径（ADR-344 D3/D3b/D3c）**：`sync_push.go|installDirUnitLocked` 用 `paths.RelInside(globalDir, dir)` + `installer.InstallDirRelLocked` 落位 `customDir/<仓库相对层级>`；越界（`relErr`）回退 `InstallDir` basename 语义（installer 自身的 `IsInside(filesRoot, srcDir)` 守会挡下）。这是面板行内推送与一键安装 `MissingDirs` 的消费端（`internal/app|PushSingleResourceToInstance`），拍平会让 `嵌套1/01_taisho_maid` 落到实例根。**`rel == "."`（源夹就是仓库根）必须显式拒绝**（AppError `ErrInvalidPath`「根级目录级安装入口被拒绝」）：basename 回退 = `InstallDirLocked(仓库根)` = **整座仓库复制进整合包**——根级 `ysm.json` 是合法 dirLevel 文件单元、面板 missing 行有推送按钮，而面板调用点**没有**导入链的根级兜底守（复核探针实证：修复前 `err=nil` 且 `customDir/ysm/其他模型/B.ysm` 落地）。同刀修掉一个死分支：`registry.IsYsmEntryJSON` 做裸名全等比较，原传全路径**恒 false** → ysm.json 的文件夹级分支从未触发（只落单个 json、同夹纹理全丢），改传 `filepath.Base` 后与两处已有同口径调用点对齐，`internal/app|pushRepoPathToInstance` 的根级兜底守随之成为真防线。回归锁 `sync_push_hierarchy_test.go`（嵌套夹/父目录层级/pmx/根级拒绝/根级 ysm.json 整仓防线；ysm.json 那条**必须断言配套纹理同落**，否则该分支退回死分支时测试仍绿）
- **两阶段遍历-执行模式**（`SyncToggleStatus`，sync.go）：`filepath.WalkDir` 回调中**不直接执行** `os.Rename`，而是先收集 `[]renameOp`，遍历完成后再批量执行。在 WalkDir 过程中修改目录结构会导致后续条目被跳过或重复处理。
- **`SyncToggleStatus` 与 `go/installer` 共用包级 `installer.InstallLock`**（`sync.Mutex`），防止与安装操作并发写同一文件
- `RelinkDir` / `PushSingleResource` 整段持 `InstallLock`，内部对 `installer.Install/InstallDir/CopyFile` 改用 `*Locked` 变体，避免同 goroutine 重入非重入 mutex 死锁；`SyncToggleStatus` 采分段持锁（阶段 1 收集与阶段 3+4 执行各为独立持锁段，中间锁外算哈希）——锁生命周期由段内 defer 保证，锁外 panic 不会触发对已释放锁的二次 Unlock
- 文件被占用（如 Minecraft 锁定）时 `isFileLocked` 识别后静默跳过不阻塞
- `RelinkDir` 处理文件夹级类型时先把旧目录 rename 成 `<目录名>.relink-bak-<UnixNano>` 备份（时间戳防覆盖恢复点，与 conflict.go 的 `.bak-<ts>` 同族），重建成功才删备份、失败则回滚；根层平铺的 ysm.json/.pmx 退化为 `installer.CopyFile` 单文件路径
- **整夹替换必须保全实例独有文件（ADR-342 D1）**：替换前 `sync_relink.go|collectInstanceOnlyFiles` 记账「实例侧有、仓库侧同相对路径没有」的文件**相对路径**（递归收集使实例独有子目录整体存活；跳过回收站与 `.relink-bak` 子树），替换成功后 `sync_relink.go|restoreInstanceOnlyFiles` **从备份目录**回填到重建夹。两条踩过的坑：① 只能记相对路径——紧接着 `os.Rename` 掉旧夹，绝对源路径当场失效（首版即因此 100% 回填失败）；② 回填失败必须**整夹回滚**（本函数承诺「整目录原子替换」：要么按仓库版重建且独有文件全到位，要么原地不动），半成品态会让游戏里出现残缺模型；回滚自身失败按既有口径保留备份并记日志（恢复点仍在）。回归锁 `TestRelinkDir_RestoreFailureRollsBackWholeDir`（注入「实例侧同名目录 vs 仓库侧同名文件」使回填必失败）。触发场景是设置页「重新应用链接模式/切换链接模式」（copy 模式同样跑），旧实现成功即 `RemoveAll` 备份 → 自制贴图/额外子目录永久消失且日志为空、count 报全成功。实例侧 `.disabled/.ban` 副本按「独有文件」被保留（不静默删除也不静默转正）——禁用态跨链统一不在本 ADR 范围
- **同夹多条目共享一次替换结果，但去重键须含仓库源夹 + 做到位校验（ADR-342 D3/D5）**：`RelinkDir` 主循环按 `sync_relink.go|relinkLandingKey`（小写 `dstParent` + 仓库源夹 basename）记 `replacedDirs`，该组合本轮已整夹替换过则后续条目**先 `os.Stat` 校验落位夹内该相对路径存在**——存在才计成功，否则记日志跳过。这是身份复验修好后的**必需配套**（复验现在会正确地发现「目录已被替换」，若不承接，relink 会把自己刚做的事报成失败）；而只按实例夹去重会误判：`pickRelinkSource` 取同哈希**首个**候选，第二条目的源可能在另一个仓库夹，那种情况它既没被安装也不在新夹里，计成功＝对用户说谎（对抗复核 A2，`TestRelinkDir_SameFolderDifferentRepoFolders`）。
- **「改名搬运」只进空位（ADR-342 D5，数据丢失防线）**：仓库夹名 ≠ 实例夹名时 `newDir = dstBase/<仓库夹名>` 会指向另一个路径，而 `installer.InstallDir` 遇已存在目标会**复用并合并写入**（`dstExisted=true` 时它自己不清树）——随后任何回滚的 `RemoveAll(newDir)` 都会删掉那个**不属于本次重建的活夹**（用户既有模型全灭）。故目标已被活夹占用一律拒绝（记日志、不动盘）；这条守卫同时是「整夹回滚」删除边界安全的前提（`newDir` 必为本次新建）。`rollbackRelinkReplace` 已改成显式收 `newDir`，把删除边界写在调用点。**变异检查**：摘掉守卫 → `TestRelinkDir_RenameMoveRefusesOccupiedLanding` 立即红（实测 `modelB/keep.png` 被删）。
- **目录级 rename 前锁内身份复验（ADR-296 D4，机制已被 ADR-342 D2 修正）**：`sync_relink.go|verifyDirSnapshot`——锁外对将搬的 `dstParent` 逐条取身份快照（非全量扫描，不违 `TestRelinkDir_ScanNotHeldLock` 契约），锁内 rename 前复验「搬的仍是快照观察到的那个对象」；快照缺失（锁外取身份即失败）一律拒搬。**⚠️ 原实现直接用 `os.Lstat` 产物当快照是失效的**：Windows 的 `os.Lstat` 产出惰性 `fileStat`（只存路径不存 FileId），`os.SameFile` 才由 `loadFileId` 按路径名 `CreateFile` 取 ID（Go stdlib `os/types_windows.go`）→ 两侧都解析成「P 现在是谁」，恒真；现统一走 `sync_relink.go|dirIdentity`（`os.Open` + `f.Stat()` 句柄态，身份调用瞬间固化；Unix 等价于 fstat dev/ino）。诚实残余：内容漂移不威胁「搬对对象」、InstallLock 不互斥外部进程（窗口已收窄为两条相邻 syscall 之间）。回归测试 `TestRelinkDir_DirLevelSnapshotMissingRefusesRename`（快照缺失拒搬）/ `TestRelinkDir_DirLevelSnapshotReplacedRefusesRename`（非目录占位拒搬 + 占位物零触碰）/ `TestDirIdentity_RejectsReplacedDir`（同名重建判否 + 同一目录两次取身份相等的反向对照）
- **`.relink-bak-*` 备份尸体不参与扫描消费（ADR-296 D3，豁免面已按 ADR-342 D4/D6 扩到同步 diff 全通道 + 跨包单点）**：Go walk（`rust_backend` tag 已随 ADR-324 删除，现只有 Go 一个后端）会下钻备份目录并照常填哈希 → 尸体内条目哈希恒匹配仓库原件。谓词**已下沉** `go/fsutil/relink_backup.go|IsRelinkBackupPath`（单点事实源，`go/sync/sync_relink.go|isRelinkBackupPath` 仅为包内既有调用点保留的转发），消费方：`RelinkDir` custom 主循环、repoByHash 构建循环、`SyncToggleStatus` WalkDir（原三处，斩断「对尸体 rename→InstallDir→再生新备份」套娃与尸体被 `.disabled` 改名）、`collectEntriesWalk` / `collectEntriesFromScan`（生产链走 scan 反推，只修 Walk 等于没修）/ `handleDir`（file-level）/ `collectFolderFiles` + `collectFolderFilesFromScan`（夹内子文件），以及包外 `go/scanner`（幻影模型）/ `go/dedup`（`clean` 保尸体删活模型）/ `go/repoaudit`（统计虚高）。不豁免则尸体被判「实例独有（可拉取）」，一键拉取会把整个恢复点复制进仓库。回归测试 `TestRelinkDir_RelinkBackupCorpsesSkipped` / `TestSyncToggleStatus_RelinkBackupCorpsesSkipped` / `sync_corpse_exempt_test.go`（四条 collect 通道各一例）/ `go/fsutil/relink_backup_test.go`
- 硬链接检测跨平台分实现，系统调用失败一律降级 `LinkCopy`；`GetLinkType` 必须先 `os.Lstat` 判 `os.ModeSymlink`
- 链接类型是删除策略依据：硬链接(nlink>1)/符号链接直接删，普通文件才移回收站
- 拉取侧 `copyFile` 已修复为 **tmp+rename 原子落地**；`copyDirRecursive` 保留符号链接语义
- 冲突解决的备份/覆盖/回滚三处拷贝已收敛 `fsutil.CopyFile` 原子 tmp+rename
- 实例 custom 目录固定为 `config/yes_steve_model/custom`

## 已知限制 / 待治理（2026-08-24 审计）

> 均有单测/注释留痕，改动前先读对应源码注释；修复任一项时删除对应行并补回归测试。

- **dirLevel 同键覆盖静默丢失**（2026-10-14 已治理 fail-loud ✅）：同级「不同扩展名同名文件」（`model_a.pmx` + `model_a.pmd`）经 `relKeyDirLevel` 剥扩展名同键 → map last-write-wins 覆盖一个，被覆盖方原本从同步列表静默消失。目录 vs 文件同名碰撞早已由尾随 `/` 修复；本项治理**只加可见性、不动匹配语义**（跨格式同身份归一是设计语义）：collect 层 `sync_dirlevel_sync.go|upsertDirLevelUnit` 记录覆盖事件（两侧 Rel 都点名）→ `syncResourcesDirLevel` 汇入 `ResourceSyncResult.Warnings`（诊断信道，omitempty，不影响四桶）并落日志（CLI stderr / GUI 日志面板可见）。回归锁 `sync_dirlevel_collision_test.go`（Walk / scan 两信道 + 端到端 + 零碰撞负例 + dirLevelResult 不产警告）
- **patternFind 重复子树扫描**（2026-08-24 已治理 ✅）：`collectEntriesWalk` 内建 `nestedDirMemo`，同一 Walk 树内同一路径+pattern 只递归一次，O(N²) 降为 O(N)。
- **pack 目录结构折叠指纹（D2′-b 已治理 ✅）**：`resourcepack` 是文件级类型（非 dirLevel），其 pack 文件夹（含 `pack.mcmeta`）在 `collect` 里作为单条 `DiffEntry{IsDir:true}` 条目，子文件（`.png`/`.mcmeta` 等）被 `IsResourceAllowed` 过滤、不成独立条目 → 旧实现 `contentDiffers` 对 `IsDir` 直接 false 恒判 Synced，包内纹理/配置的增删改全盲（盲区②）。现 `collect` 的 Walk 在 `IsResourceAllowed` **过滤之前**，把每个子文件按所属 pack 目录前缀归入，累积顺序无关的 `fnv64a("<相对路径>:<大小>")` 之和 + 计数，Walk 结束回填该目录条目的 `DiffEntry.FoldDigest`（形如 `hex:count`）；`contentDiffers` 的 `IsDir` 分支改为两侧 `FoldDigest` 均非空则比指纹、异→Missing，任一侧空回退恒一致（不回归）。**零新 I/O**：`os.FileInfo` 是目录枚举本就产出的，无额外 stat；**不依赖哈希**：`scanFn=nil` 的 UI 路径（`instance.go` 走 `SyncResources`）同样生效，故 pack 内容漂移立即可见。**无需新缓存维度**：折叠无条件计算、值类型不变（仍是 `map[string]DiffEntry`），不与 D2′-a 的 `hashed` 维度冲突、不污染。**诚实局限**：仅改字节不改大小（同尺寸重编码纹理）不在指纹内——逐文件内容哈希属热路径现算、触 `sync_toggle_hashlock` 红线，D2′-b 刻意不做（此点与 D2′-a 靠 scanner 缓存哈希不同：pack 子文件多为非模型扩展、scanner 按 rtype 不哈希）。回归测试 `TestResourceDiff_DirFoldComparison`（异指纹 Missing / 同指纹 Synced / 单侧空回退）+ `TestSyncResourcesWithConfig_PackFoldDetectsContentChange`（纹理改大小经指纹判 Missing / 结构一致 Synced / scanFn=nil 亦生效）
- **DiffFolderContents 内容级判定（D2′-c 已治理 ✅）**：旧实现两侧同名同相对路径的文件一律标 synced（纯存在性、连 Size 都不看）→ 实例侧模型文件被改/损坏后仍显 ✅ 已同步（盲区③）。现 `diffFolderContentsCore` 走**哈希优先、Size 兜底**（与 `contentDiffers`/`ResourceDiff` 同口径）：两侧均有 scanner 哈希则比哈希、异哈希→`SyncStatusDiverged`；任一侧无哈希（`DiffFolderContents` 无 scanFn / 实例侧 scan 未命中回退 Walk / >`MaxImportSize`）则比大小、异大小→Diverged。`DiffFolderContentsScan` 全局侧哈希随组根条目免费带出、实例侧改走 `scanFn(instanceFolder)` 单夹扫描取哈希（未命中回退 `collectFolderFiles` Walk→无哈希→Size 兜底，语义不劣化）。Diverged 子项经 `instance.go` 父夹聚合升整夹 Diverged 🗂️、触发重推提示。回归测试 `TestDiffFolderContentsScan_HashDetectsDivergence`（异内容 Diverged / 同哈希 Synced / 实例 scan miss 回退 Synced / 公开 `DiffFolderContents` 现状不回归）
- **key 小写归一 vs 路径敏感操作**：`relKey` / `relKeyDirLevel` 把整个相对路径转小写做身份 key，push/pull 却用原路径——大小写敏感 FS（Linux 服务器仓库）上 `Pack/` 与 `pack/` 视为同一模型但操作各走各路，可能错配
- **状态对比 IO 放大**：`BuildSyncItems` 对 dirLevel 类型现已注入 `scanner.ScanEntriesWithHit`（`SyncResourcesDirLevelScan`），全局仓库树不再每类型重复全树 Walk——scanner 缓存 30s TTL + single-flight，8 个 MMD 子类型 ×(1+N 整合包) 对同一目录实际只走盘一次（无嵌套模式类型从缓存 ModelEntry 反推；maid-model 回退 Walk）。**全局侧夹级 diff 也已复用缓存**：`DiffFolderContentsScan` 的全局侧从组根全量条目按 folder 前缀过滤（零 Walk）。**2026-08-24 新增两层缓存**：
  - **同步结果缓存**：`BuildSyncItems` 最终结果再叠 30s TTL 缓存（key=实例+subtype+roots+rtypes），scanner 失效自动清、写入口显式清——整合包页在 30s 内反复 `stats:refresh` 不再重算。**双缓存配对契约**（锐评 2026-10-10 配对审计）：go/sync 写操作内部 `defer InvalidateSyncScanCaches()` 自带 sync 扫盘缓存一侧；但 instance 同步结果缓存一侧 **go/sync 不能清**（go/instance 导入 go/sync，反向即成环），失效归 **internal/app 层每条 `ysmsync` 写入口**成对调 `instance.InvalidateSyncItemsCache()` + `ysmsync.InvalidateSyncScanCaches()`——`SyncCustomToRepo` / `PushResources` / `PullResources` / `PushSingleResource` / `PullSingleResource` / `SyncToggleStatus` / `ResolveConflicts` 各自显式配对，`relinkDir` helper 自持配对（app 层内聚，不靠调用方经 scanner 级联兜底）。审计时七条入口独漏 `ResolveConflicts`：冲突解决经 `fsutil.CopyFile` 改实例/全局两侧文件，却不清 instance 缓存 → 整合包页展示旧同步状态 ≤TTL（与下载漏清缓存是同一族「入口不对齐」病）。**第二轮扩面（同日）**：契约不止覆盖 `go/sync` 入口——`go/installer` 的 `Install`/`InstallDir` 落地族写实例目录，sync 内部 defer 完全不覆盖，watcher 又只监听全局仓库根（实例目录写入没有任何兜底），app 层消费点 `InstallModelTo`（右键「推送到整合包」）与 `InstallResourceToInstance`（三出口，defer 统一配对）曾全部漏清，前端只有 sync.ts 批量回拉一条路径事后补 `InvalidateScanCache`——正是导入侧注释明令反对的「赌前端记得清」。结构守卫 = `tests/test_sync_write_cache_pairing.ts`，**已翻转为派生 fail-closed（同日闸审计）**：旧版人工枚举 `SYNC_WRITE_OPS`/`INSTALLER_WRITE_OPS` 清单，清单漏列即隐身（fail-open）；现与 `tests/test_fileops_write_invalidate.ts` 共用 `scripts/_lib/write-surface-gate.ts`——候选写面**从 go/sync + go/installer + go/importer 三包导出面自动派生**，app 层每个 `pkg.X(` 调用点三选一归宿：只读豁免表（`DetectConflicts`/`ListVersions`/`ResolutionStrategy`/`DetectContainerType*`，漏分类即红）∨ 所在函数体含失效签名（显式两行配对 或 `a.ClearScanCache()` 三层清）∨ 精确 `exemptSites`（`InstallModelFile→InstallToGlobal`：落点实例 custom 目录非缓存键覆盖+前端零消费者+CLI 进程缓存不驻留，查证在案；`SyncResources→SyncResourcesWithConfig`：恒传 nil config 纯读——未来传非 nil 须移除豁免补配对；僵尸条目反查防烂尾）。**接口方法值盲区由 `importer.Get` 归类为写间接收口**（枚正则抓不到 `h.Import(`，Get 调用点所在函数必须有失效——ImportByType 活 bug 即此形态）。三方向变异坐实（漏分类/僵尸豁免/空转下限各即红）。**注意**：`SyncResourcesWithConfig` 仅当 `config.ConflictPolicy` 非空才经 `handleSyncConflicts` 写盘；当前 app 层调用恒传 nil（纯读），若未来传非 nil 须入写入口清单。
  - **同步目录扫描缓存**（`go/sync` 内）：`SyncResources` 的 collect、`collectEntriesWalkCached`（maid-model 等嵌套回退）、`collectFolderFiles`（实例侧夹级 diff）叠 30s TTL，同一 root+rtype 在 TTL 内只真正 Walk 一次；失效由 `scanner.OnCacheInvalidated` 自动联动，sync 内部 Push/Pull/Toggle/Relink/SyncCustomToRepo 也会显式清。**缓存返回值为共享只读，消费方禁止写**（`sync_cache.go` 包级铁律）。**D2′-a 缓存键 `hashed` 维度**：`resources` kind 的 `syncDirectoryScanKey` 除 `{kind,root,rtype}` 外带 `hashed`（=`scanFn != nil`），隔离「带哈希版 collect」与「Size-only 版 collect」两种结果——否则二者互相污染：若 nil 版先 populate 无哈希缓存，随后 App.SyncResources（带 scanFn）命中它 → 内容级判定静默失效 30s。仅 `resources` 用该维度，`dirlevel`/`folder` kind 恒 false（字段名构造默认零值）。回归测试 `TestSyncResourcesWithConfig_HashDetectsContentChange` 钉住「带 scanFn 判 Missing / nil 回退 Synced」双分支不污染。
  - **scan-hit 衍生结果也复用 syncDirLevelScanCache（2026-09-14 落地）**：`syncResourcesDirLevel` 的 `collectEntries` 闭包对 scan-hit 路径（注入 scanFn 命中）此前每次把 scanner 已缓存的 `entries` O(entries) 重算成同步 map，而 Walk 回退路径早已叠缓存——`BuildSyncItems` 周期内 8 个 MMD 子类型 × N 个实例反复对同一全局仓库根 `(rootDir, rtype)` 重算衍生 map。现 scan-hit 与 Walk 对称复用同一 `syncDirLevelScanCache`（key=`syncDirectoryScanKey{kind:"dirlevel", root, rtype}`，命中即返回；仅 `collectEntriesFromScan` 非 nil 才存，nil 回退 Walk 不缓存防误命中）。纯缓存层、无语义变更，回归测试 `sync_dirlevel_scan_cache_test.go` 锁「二次同步 scanFn 调用不增长」。
  - **残余 IO（失效后首次重算）**：`containsModelSubfolder`/`isDirTypeModelFolder` 逐层 ReadDir 仍会发生（实例侧文件量远小于全局，非大头）；refresh 全量 `InvalidateScanCache` 会使 30s 缓存冷掉触发一次组根重扫（单次，非 8×(N+1) 遍）。
- **SyncToggleStatus 三级匹配的兜底误伤面**（观察项）：哈希 → 相对路径 → 纯文件名三级匹配的最后一级是 basename——同名不同路径的不同模型会被互相匹配启禁状态（sync.go fallback 注释自认「旧仓库特例」）；新仓库数据齐全时该兜底应可收紧


## 裁定记录

- `2026-10-14`：relink 失败信号收口（对抗复核 C1）——`RelinkDir` 统计失败条目，**零成功且有失败**返回 `ErrPartialSync`（原只记日志返回 `(0, nil)` → 前端弹「已重新链接 0 个文件」成功 toast）；app 层 `RelinkAllInstanceResources` 遇 `ErrPartialSync` 不中断类型循环、仅在**整实例零成功**时上抛，有任何成功返回 `(total, nil)`（逐条失败在导入日志面板，不用「整实例失败」盖掉计数）｜契约变化同步改了两条特征用例与两条拒搬用例的 `NoError` → `ErrorIs`（行为断言原样）｜回退 = `go/sync/sync_relink.go|ErrPartialSync`、`internal/app/app_install_instance.go|RelinkAllInstanceResources`
- `2026-10-14`：**`ErrPartialSync` 被结构化 `types.RelinkResult{OK,Failed,FirstError}` 取代（ADR-342 D7′，锐评批 D ①）**——C1 的 `(int, error)` 体裁仍有半截问题：部分成功时失败计数被丢掉，`RelinkAllInstanceResources` 返回 `(total, nil)`，设置页 toast 只能弹「已重新链接 N 个文件」，而 `settings.relinkDonePartial`（N 成功 M 失败）三语 key 长期不可达（前端 `failed` 恒为 0/1）。改法：`RelinkDir(...) (types.RelinkResult, error)`，error 仅前置不满足；条目级失败进 `Failed` + `FirstError`（经 `sink` Logger 包装闭包归集首个原因），零成功不是 error；`RelinkAllInstanceResources` 聚合各类型结果，前端据此弹「N 成功 M 失败 + 首个原因」｜既有 D7 用例的 `ErrorIs(…, ErrPartialSync)` 断言改为 `NoError` + `res.OK`/`res.Failed`/`res.FirstError`（行为等价，仅体裁变了）；`ErrPartialSync` 仍保留给 `PushResources`｜变异检查：摘掉 `sink` 的 firstErr 归集 → 四条 D7 用例的 `FirstError` 断言立即红｜回退 = `go/sync/sync_relink.go|RelinkDir`、`go/types/types.go|RelinkResult`
- `2026-10-14`：relink 加固第二刀（对抗复核 A1/A2/C3 收口）——「改名搬运只进空位」+ 去重键含仓库源夹与到位校验 + 身份复验错误分类（不存在 vs 无法读取）｜旧回滚无条件 `RemoveAll(dstBase/base(srcDir))` 在「仓库夹名≠实例夹名且目标已存在」时删掉用户既有活夹（变异检查实测 `keep.png` 被删）；旧去重只按实例夹 → 第二条目未重链却计成功（count=2、零日志）｜回退 = `go/sync/sync_relink.go|relinkLandingKey`、`go/sync/sync_relink.go|rollbackRelinkReplace`
- `2026-10-14`：relink 整夹替换改为「保全实例独有文件 + 句柄态目录身份 + 同夹条目去重 + 备份尸体同步豁免」四件套（ADR-342）｜旧实现成功即 `RemoveAll` 备份 → 实例独有文件不可逆静默消失（探针实证 `count=1 err=nil logs=[]`）；ADR-296 D4 的 `os.SameFile` 在 Windows 上因惰性 `fileStat` 按名重开而恒真（探针实证同名重建仍判 same）｜回退 = `go/sync/sync_relink.go|collectInstanceOnlyFiles`、`go/sync/sync_relink.go|dirIdentity`、`go/sync/sync_relink.go|isRelinkBackupPath`
- `2026-10-14`：contentDiffers 对 Oversize（>MaxImportSize 被跳过哈希）文件不再回退 Size 判 Synced，保守判 Missing（待推送）——P0-2 诚实化，消灭 >500MB 静默假绿｜超限文件因 bug-chronicle #36 刻意跳过哈希，同尺寸不足以证明内容一致；非 hashable / scanFn=nil 的空哈希仍走 Size 兜底（误判面窄、不回归），故只翻转 Oversize 一类｜回退 = `go/sync/sync_diff.go|DiffEntry.Oversize`
- `2026-10-14`：dirLevel 同键纯文件/文件碰撞（同级同身份不同扩展名共存）治理为 fail-loud：collect 层 upsertDirLevelUnit 记录 last-write-wins 覆盖事件（两侧 Rel 点名）→ syncResourcesDirLevel 汇入 ResourceSyncResult.Warnings（omitempty 诊断信道，不影响四桶判定）并分侧落日志；匹配语义（跨格式同身份归一）不动｜原实现在覆盖方静默消失——同步面板从此看不见被丢的物理模型；用户裁定方向为可见性而非改键语义（跨格式同身份是设计语义）｜回退 = `go/sync/sync_dirlevel_sync.go|upsertDirLevelUnit`

## 相关

- [go_installer](./go-installer.md) — 按 LinkMode 实际落地复制/硬链接/符号链接
- [go_recycle](./go-recycle.md) — 删除时按链接类型分流
- [go_watcher](./go-watcher.md) — 文件监听触发自动同步
- AGENTS.md 致命陷阱 §二 #8（硬链接误删）
