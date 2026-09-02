---
kind: go-sync
name: 整合包同步 go/sync
tier: architecture
adr:
  - ADR-064
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
- `sync_relink.go` — 重链接执行（`RelinkDir`）：按哈希把实例文件重新指向仓库版本，文件夹级类型用「备份→重建→失败回滚」保证不丢目录
- `conflict.go` — 冲突检测与解决（`DetectConflicts` 比较本地/远端同名文件 SHA256，哈希不同→内容冲突；`ResolveConflict` 单文件 + `ResolveConflicts` 批量，三种策略 force_remote/force_local/manual；`suggestStrategy` 按修改时间推荐策略）
- `go/fsutil/hardlink_windows.go` — Windows 硬链接检测（`syscall.GetFileInformationByHandle` → `NumberOfLinks`，收敛自原 link_windows.go）
- `go/fsutil/hardlink_other.go` — Unix/macOS 硬链接检测（`syscall.Stat_t.Nlink`，含目录排除 ADR-038，收敛自原 link_unix.go）

## 对外 API / 入口

- `GetInstanceStatus(mcRoot, repoDir string, scanFn ScanFunc) []types.InstanceStatus` — 哈希对比模型仓库与各实例 custom 目录，产出 Missing/Extra/Disabled/Files（链接类型）
- `GetInstanceStatusWith(mcRoot, repoDir string, scanFn ScanFunc, listFn ListVersionsFunc)` — 可注入 listFn 的测试变体
- `SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error)` — 把仓库 `.ban` 启禁状态同步到实例文件（哈希 → 相对路径 → 纯文件名三级匹配，重命名加/去 `.ban` 后缀），返回禁用数、启用数
- `ListVersions(mcRoot string) []types.VersionInstance` — 枚举实例，三种布局：目录本身是 instances（子目录含 `.minecraft`/`minecraft`）、PrismLauncher `{mcRoot}/instances/{name}/.minecraft/`、标准 `{mcRoot}/versions/{name}/`
- `HasDotMinecraftSubdirs(path string) bool` / `FindMinecraftDir(parentDir string) string` — 实例布局探测辅助
- `SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult` — **ADR-064 阶段二：全树递归 + 相对路径（relKey）对比**全局 ↔ 整合包资源；嵌套文件天然区分、无同名冲突，原「只扫顶层」深度守卫已取消。含 `pack.mcmeta` 的文件夹作为整体单元（仅资源包类型收集）；过滤/归一化统一走 `types.IsResourceAllowed` / `types.NormalizeResourceName`，归并走 `ResourceDiff`（sync_diff.go）
- `SyncResourcesDirLevel(globalDir, instanceDir, rtype string)` / 优化版 `SyncResourcesDirLevelScan(globalDir, instanceDir, rtype string, scanFn ScanEntriesFn)` — 按文件夹名对比（YSM 的 ysm.json 文件夹 / MMD 的 .pmx/.pmd 文件夹 / 蓝图 .nbt 文件夹），同名时文件夹优先于平铺文件。`SyncResourcesDirLevel` 走 filepath.Walk（测试/旧调用方，行为不变）；`SyncResourcesDirLevelScan` 注入 scanner 已缓存扫描结果，命中时从 ModelEntry 列表反推同步条目（无嵌套模式类型 MMD/YSM 与原 Walk 精确等价；含嵌套模式 maid-model 回退 Walk），消除 8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树的重复 Walk
- `CompareGlobalInstanceHashes(mcRoot, globalDir, subDir, rtype string, scanFn ScanFunc, listFn ListVersionsFunc, hasModFn HasModInDirFn) []types.InstanceStatus` — 非 YSM 资源类型的通用实例状态对比，**ADR-064 与 `SyncResources` 同口径**（`relKey` 相对路径 + 大小 + `ResourceDiff` 单点归并，消除手工对齐漂移）；实例目录经 `types.FindInstDir` 解析（标准目录不存在时兜底扫描）。修复 MMD（`.pmx/.pmd` 不计算 SHA256，旧哈希比对恒 0）与蓝图（实例目录非标准路径）在侧栏不显示的问题
- `ResourceDiff(global, instance map[string]DiffEntry) types.ResourceSyncResult` — **单点对比归并**（sync_diff.go，ADR-064 阶段一）：同名同大小 Synced / 同名不同大小 Missing / 仅单侧 Extra，结果排序确定性；`SyncResources` 与 `CompareGlobalInstanceHashes` 共享，key 由调用方决定（统一为 `relKey` 相对路径）
- `GetLinkType(path string) types.LinkType` — 判定 `symlink` / `hardlink` / `copy` / `unknown`
- `SortEntries(entries []types.ModelEntry)` — 按名称排序
- `PushResources(rtype, globalDir, targetDir, linkMode string, logger Logger) (int, error)` — 推送缺失资源；**`types.IsDirLevelSync(rtype)` 注册表驱动**（YSM/MMD 等 `dirLevelSync` 类型）走文件夹级（`SyncResourcesDirLevel` + `installer.InstallDir`），其余走文件级（`SyncResources` + `installer.Install`）
- `PullResources(rtype, globalDir, targetDir string, logger Logger) (int, error)` — 把实例侧 Extra 拉回仓库（纯复制，不建链接）
- `PushSingleResource(filePath, customDir, globalDir, linkMode, rtype string) error` / `PullSingleResource(globalDir, targetDir, srcPath string) error` — 单条推送/拉取；`.json`/`.pmx`/`.pmd` 与目录按整文件夹处理
- `SyncCustomToRepo(customDir, repoDir string, scanFn, logger) (int, error)` — 把实例 custom 目录的模型收编回仓库，同哈希/同名跳过
- `RelinkDir(customDir, repoRoot, rtype, linkMode string, scanFn, logger) (int, error)` — 按哈希重链接实例目录到仓库版本
- `DetectConflicts(localDir, remoteDir, rtype string) (*ConflictReport, error)` — 冲突检测（conflict.go）：收集两端文件 SHA256，哈希不同→`ConflictContentModified`，大小不同→`ConflictSizeMismatch`（防御分支）
- `ResolveConflict(conflict FileConflict, strategy ResolutionStrategy, localDir, remoteDir string) error` — 单文件冲突解决：`force_remote` 先备份本地再用远端覆盖（失败回滚备份），`force_local` 不操作，`manual` 返回错误
- `ResolveConflicts(conflicts []FileConflict, defaultStrategy ResolutionStrategy, localDir, remoteDir string) (resolved, failed, manual int)` — 批量解决，`SuggestedStrategy==manual` 时回退到 `defaultStrategy`
- `suggestStrategy(localTime, remoteTime time.Time) ResolutionStrategy` — 按修改时间推荐：远端新→`force_remote`，本地新→`force_local`，相同→`manual`
- 函数类型：`ScanFunc`（扫描注入，由 internal/app 提供）、`ListVersionsFunc`、`HasModInDirFn`、`Logger`（导入日志回调，薄壳注入 `App.logger.Add`）

## 与其他子系统关系

- 被 `internal/app/app_install.go` 调用（状态对比、推送/拉取、启禁同步、`GetLinkType` 决定删除策略）
- 被 `internal/app/app_scan.go` 调用（`ListVersions`）、`internal/app/app_config.go` 引用
- 被 [go_watcher](./go-watcher.md) 调用（文件变更时 `ListVersions` + `SyncToggleStatus` 自动同步启禁）
- 依赖 `go/types`（ModelEntry/InstanceStatus/LinkType 等）、`go/ysm`（`ysm.HasYSMMod` 检测实例 mod）
- `sync_push.go` / `sync_relink.go` 反向依赖 [go_installer](./go-installer.md)（`Install` / `InstallDir` / `CopyFile`）——本包→installer 是单向的，installer 不得回调本包

## 不变量

- `.ban` 后缀 = 禁用模型：仓库侧 `.ban` 文件不进缺失列表；实例中对应哈希的文件标记 Disabled 而非 Extra
- **`.ban` 剥离/判断现状分布（2026-08-23 审计）**：sync.go 内 5 处——3 处已委托 `types.StripBanSuffix`（Disabled/Extra/status.Name）+ 2 处内联判断（`strings.HasSuffix(strings.ToLower(name), ".ban")`）+ 1 处内联剥离（`strings.TrimSuffix(strings.ToLower(e.Name), ".ban")`——repoName 匹配 key，供「同名不同文件夹」的复制/重命名/匹配消费，sync.go banned 记录段）。**警告（勿擅自归一）**：内联剥离与 `types.NormalizeResourceName` **语义不等价**（后者额外剥 `.disabled`）——直接替换会改变 repoName key 与 banned 匹配行为；若要归一，先加单测锁定 repoName key 语义（含 `.disabled` 文件的 banned 记录行为）再动。ADR-064 归口声明（归一化归 types 管）见 [ADR-064](../adr/ADR-064-sync-convergence-scanner-single-source.md)，该内联是落地后的漏网
- 哈希全量计算（`scanner.ComputeFileHash`，`sync.go computeHash` 委托）；文件 >500MB（`types.MaxImportSize`）返回空串跳过哈希（同步对空哈希跳过匹配），读错误同样返回空
- **所有扫描路径都必须排除 `.recycle`**，与 `scanner.ScanEntries` 口径对齐：`SyncResources` 的 collect（`sync.go`，统一 collect 闭包内 `fsutil.IsRecycleDir` SkipDir）、`SyncResourcesDirLevel` 的 `collectEntries`（sync_dirlevel.go）均跳过；`SyncToggleStatus` 用 `strings.Contains(strings.ToLower(p), ".recycle")` 检查整个路径（sync.go），非路径前缀匹配——漏排会把回收站里的模型当成仓库活跃模型，同步管理器显示 missing 且可被推送回实例（回归测试 `TestSyncResources_IgnoresRecycleDir`）
- 跳过回收站时带 `path != 根目录` 守卫：若用户把仓库根/实例根本身命名为 `.recycle` 则不跳过，否则整次扫描会直接空掉
- 状态对比类入口（`GetInstanceStatus` / `CompareGlobalInstanceHashes`）自身不 Walk 仓库，`.recycle` 的排除依赖注入的 `scanFn`（即 `scanner.ScanEntries`）——换用不排 `.recycle` 的 scanFn 会重新引入误判
- `SyncResources` 对比 key 为**相对路径**（`relKey`：小写 + 正斜杠 + 去 `.disabled`/`.ban`，ADR-064 阶段二），同名文件按**大小**判定内容是否变化（复制会改 mtime，mtime 不可靠），大小不同归入 Missing 视为待更新；三个结果列表返回前均 `sort.Strings` 排序
- 扩展名过滤统一走 `types.IsResourceAllowed`（`types.AllExts()` + `.json` 仅 `ysm.json`）与 `packs.IsTypeModelFile`（单类型扩展集 + `ysm.json`，ADR-144 下沉），原 `isSyncAllowed` / `isModelFile` / `instance.extMatch` 三处同义实现已收敛（ADR-064 阶段一）
- **`SyncResourcesDirLevel` 容器 vs 叶子模型夹判定**（`collectEntries`，sync_dirlevel.go）：目录被 `isDirTypeModelFolder` 判真（直接含 .ysm/.ysm.json）后，若还直接含子模型文件夹（`containsModelSubfolder` 为真），则是「容器」而非「叶子模型夹」——**不下钻整体收编 SkipDir**，而继续下钻保留各子夹层级，由 `go/instance` 的 `nestDirLevelTree` 重建容器树。收发场景：`嵌套1/` 内含直接平铺 `动力臂.ysm` + `01_taisho_maid/` + `嵌套2/` 深层子夹，若被整体收编会把子夹层级吞掉，前端退化成摊平的 `01_taisho_maid/ysm.json` 文件行（违背仓库层级镜像）；只有「叶子模型夹」（含模型文件但无子模型夹）才 SkipDir 收编为单同步单元
- **两阶段遍历-执行模式**（`SyncToggleStatus`，sync.go）：`filepath.WalkDir` 回调中**不直接执行** `os.Rename`，而是先收集 `[]renameOp`（含源路径、目标路径、操作类型），遍历完成后再批量执行。原因：`filepath.WalkDir` 在遍历过程中修改目录结构（如重命名文件）会导致后续条目被跳过或重复处理——文件丢失/重复/损坏风险。这是本包最重要的设计模式，所有在 WalkDir 回调中修改文件系统的操作都必须遵循此模式
- `SyncToggleStatus` 与 `go/installer` 共用包级 `installer.InstallLock`（`sync.Mutex`，统一单锁——[ADR-056](../adr/ADR-056-shared-install-lock.md) 成文：2026-08-12 起原两包各自 `installLock`/`syncLock` 互不感知的并发竞态收敛为共享同一把锁，sync.go `InstallLock.Lock()`；2026-08-13 补齐回收/去重入口），防止与安装操作并发写同一文件
- `RelinkDir`（sync_relink.go）整段持 `InstallLock`：自身对 custom 目录的 `os.Rename`/`os.RemoveAll`（目录级分支备份/回滚）纳锁，内部对 `installer.Install/InstallDir/CopyFile` 改用 **`*Locked` 变体**（`InstallLocked`/`InstallDirLocked`/`CopyFileLocked`，installer.go 新增导出）——避免同 goroutine 重入非重入 mutex 死锁（曾踩：整段持锁 + 调公开函数 → sync 测试挂起 119s）
- 文件被占用（如 Minecraft 锁定）时 `isFileLocked` 识别后静默跳过不阻塞（errno 优先：Win ERROR_SHARING_VIOLATION(32) / Unix EBUSY(16)，再按消息兜底）
- `RelinkDir` 处理文件夹级类型时先把旧目录 rename 成 `.relink-bak`，重建成功才删备份、失败则回滚恢复——不能先 `RemoveAll` 再重建，否则失败即整目录丢失。**根层平铺的 ysm.json/.pmx 退化为 `installer.Install` 单文件路径**（P1 修复：`dstParent == customDir` 时原逻辑会把整个实例目录 rename 走、同目录其他模型随备份 RemoveAll 丢失）
- 硬链接检测跨平台分实现，系统调用失败一律降级 `LinkCopy`；`GetLinkType` 必须先 `os.Lstat` 判 `os.ModeSymlink`——用 `os.Stat` 会跟随链接、把符号链接误判成普通文件，进而按「复制」策略走回收站
- 链接类型是删除策略依据：硬链接(nlink>1)/符号链接直接删，普通文件才移回收站（致命陷阱 #8）
- 拉取侧 `copyFile`（sync_push.go）已修复为 **tmp+rename 原子落地**（P3 修复）：带 defer 清理半截文件，失败不清理残留；`copyDirRecursive`（sync_push.go）递归复制时保留符号链接语义（`os.Readlink` + `os.Symlink`），不跟随复制——与 [go_recycle](./go-recycle.md) 的 `copyDirRecursive` 口径已对齐
- 冲突解决（conflict.go）的备份/覆盖/回滚三处拷贝已收敛 `fsutil.CopyFile` 原子 tmp+rename（ADR-044 收尾，原 `copyFileSafe` 直写壳已删）；失败路径契约（本地完好 + .bak 清理）由 `TestResolveConflict_ForceRemote_CopyFail_LocalIntact` 锁定
- 实例 custom 目录固定为 `config/yes_steve_model/custom`
- **R27 修复链（2026-08-31）**：
  - `DetectConflicts` hash 失败静默漏报（P2-1）：两端 size 相同但任一端 hash 为空时，标记 `HashFailed=true` + `ResolveManual` 冲突；`ResolveConflictsLocked` 检测到 `HashFailed` 时**不覆盖 SuggestedStrategy、直接计入 manual**（此类条目须人工审查，不随 defaultStrategy 自动处置）。旧实现 hash 空时跳过，哈希失败的真实冲突文件被漏报。
  - `ResolveForceRemote` 恢复失败吞错（P2-2）：`CopyFile(remotePath, localPath)` 失败后恢复备份，恢复失败时返回带备份路径的复合错误，让调用方知悉恢复点位置。旧实现 `_ =` 吞掉恢复失败错误。
  - `ResolveConflictsLocked` 锁契约收敛为文档约束（P2-3 修正）：初版 `assertInstallLock()` 运行时 panic 硬约束被 R27 code_review 否决——`TryLock` 在他人持锁时返回 false 不可靠，且生产环境 panic 不可接受；改为注释文档约束，调用方须自行确保持锁（`ResolveConflicts` 公开入口负责持锁）。
  - `RelinkDir` 备份名带时间戳（P2-4）：`backup := fmt.Sprintf("%s.relink-bak-%d", dstParent, time.Now().UnixNano())`，与 conflict.go 的 `.bak-<ts>` 口径对齐，避免上一次 relink 失败留有的备份目录被本次无条件删除——恢复点丢失。
  - 不完整 Walk 结果不入缓存（P3-2 + P3-3）：`collect` 闭包加 `partialFail` 标志，Walk 出现非根错误时设 true，`storeSyncScanCache` 仅在 `!rootFailed && !partialFail` 时存储，避免 30s TTL 内后续调用拿到残缺 entries。
  - `SyncToggleStatus` 哈希计算持锁是有意设计（P3-1 确认）：修改文件系统（rename 加/去 .disabled 后缀）必须持锁防止与安装并发，把哈希移到锁外会引入 TOCTOU。>500MB 文件 `computeHash` 返回空，自动跳过哈希走 relKey 匹配。
  - `SyncToggleStatus` 禁用统一收敛到 `.disabled`（P3-4 确认）：历史 `.ban` 文件 toggle 启用→再禁用时变成 `.disabled`，有意收敛非 bug。
  - `SyncCustomToRepo` basename 去重是有意保守策略（P3-5 确认）：同名不同子目录的文件也会被跳过，避免仓库内同名文件被覆盖。哈希去重（`repoHashes`）已覆盖「同名同内容」场景，此处仅挡「同名不同内容」。

## 已知限制 / 待治理（2026-08-24 审计）

> 均有单测/注释留痕，改动前先读对应源码注释；修复任一项时删除对应行并补回归测试。

- **目录级 key 冲突静默丢失**：同级目录 `模型包/` 与文件 `模型包.zip` 的 `relKeyDirLevel` 都归一为 `<parent>/模型包`（目录键仅加尾随 `/` 区分叶子文件，但 zip 与目录同名剥扩展名后仍同段）→ map last-write-wins 丢一个。头注释已声明的已知限制（sync_dirlevel.go L24-25），待治理方向：key 保留扩展名或冲突时报错可见
- **patternFind 重复子树扫描**（2026-08-24 已治理 ✅）：`collectEntriesWalk` 内建 `nestedDirMemo`，同一 Walk 树内同一路径+pattern 只递归一次，O(N²) 降为 O(N)。
- **DiffFolderContents 只比存在性不比内容**（正确性）：两侧同名同相对路径的文件一律标 synced，**不做哈希对比**（sync_dirlevel.go 注释明示）→ 实例侧文件被修改/损坏后仍显示 ✅ 已同步。若治理：对 size 不同即可判 diverged（与 `ResourceDiff` 同名不同大小口径对齐），不必全量 SHA256
- **key 小写归一 vs 路径敏感操作**：`relKey` / `relKeyDirLevel` 把整个相对路径转小写做身份 key，push/pull 却用原路径——大小写敏感 FS（Linux 服务器仓库）上 `Pack/` 与 `pack/` 视为同一模型但操作各走各路，可能错配
- **状态对比 IO 放大**：`BuildSyncItems` 对 dirLevel 类型现已注入 `scanner.ScanEntriesWithHit`（`SyncResourcesDirLevelScan`），全局仓库树不再每类型重复全树 Walk——scanner 缓存 30s TTL + single-flight，8 个 MMD 子类型 ×(1+N 整合包) 对同一目录实际只走盘一次（无嵌套模式类型从缓存 ModelEntry 反推；maid-model 回退 Walk）。**全局侧夹级 diff 也已复用缓存**：`DiffFolderContentsScan` 的全局侧从组根全量条目按 folder 前缀过滤（零 Walk）。**2026-08-24 新增两层缓存**：
  - **同步结果缓存**：`BuildSyncItems` 最终结果再叠 30s TTL 缓存（key=实例+subtype+roots+rtypes），scanner 失效自动清、Push/Pull/Toggle/SyncCustomToRepo 等显式清——整合包页在 30s 内反复 `stats:refresh` 不再重算。
  - **同步目录扫描缓存**（`go/sync` 内）：`SyncResources` 的 collect、`collectEntriesWalkCached`（maid-model 等嵌套回退）、`collectFolderFiles`（实例侧夹级 diff）叠 30s TTL，同一 root+rtype 在 TTL 内只真正 Walk 一次；失效由 `scanner.OnCacheInvalidated` 自动联动，sync 内部 Push/Pull/Toggle/Relink/SyncCustomToRepo 也会显式清。**缓存返回值为共享只读，消费方禁止写**（`sync_cache.go` 包级铁律）。
  - **残余 IO（失效后首次重算）**：`containsModelSubfolder`/`isDirTypeModelFolder` 逐层 ReadDir 仍会发生（实例侧文件量远小于全局，非大头）；refresh 全量 `InvalidateScanCache` 会使 30s 缓存冷掉触发一次组根重扫（单次，非 8×(N+1) 遍）。
- **SyncToggleStatus 三级匹配的兜底误伤面**（观察项）：哈希 → 相对路径 → 纯文件名三级匹配的最后一级是 basename——同名不同路径的不同模型会被互相匹配启禁状态（sync.go fallback 注释自认「旧仓库特例」）；新仓库数据齐全时该兜底应可收紧

## 相关

- [go_installer](./go-installer.md) — 按 LinkMode 实际落地复制/硬链接/符号链接
- [go_recycle](./go-recycle.md) — 删除时按链接类型分流
- [go_watcher](./go-watcher.md) — 文件监听触发自动同步
- AGENTS.md 致命陷阱 §二 #8（硬链接误删）
