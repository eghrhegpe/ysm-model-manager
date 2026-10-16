# 整合包（Minecraft 实例）同步 Go 后端 架构锐评

评审范围：`go/instance/`（4 文件）、`go/sync/`（15 文件）、`go/packs/`、`go/installer/`、`go/watcher/watcher.go`、`go/scanner/scanner.go`（缓存/失效/ScanFunc）、`internal/app/app_install_instance.go`、`go/types/registry/`（resource.go / findinst.go / extensions.go）。
性质：纯设计审查，未改任何代码、未提交。

总体判断：这套同步架构的**分层与失效收敛做得很扎实**（ADR-064/065/310/347/351/056 落地度高），没有发现当前生产路径上会立即炸的 P0 缺陷；但存在几处**结构性缺口会持续孕育 bug**（尤其是"改了 A 忘了清 B"与一套未接线的冲突子系统），值得近期处置。

---

## P0（结构性缺陷，会持续产生 bug）

### P0-1　sync 包内部变更只清自身扫盘缓存，绕过 scanner 单漏斗 → instance 侧 `syncItemsCache` 不失效
- **文件:行**：`go/sync/sync_push.go:41/107/225/282/384`、`go/sync/sync_relink.go:63`、`go/sync/conflict.go:199`、`go/sync/sync.go:80` —— 全部只 `defer InvalidateSyncScanCaches()`；而 `go/sync/sync_cache.go:74-87` 的实现只 `Range+Delete` 清空三个 sync 内 map，**不会触碰 instance 的 `syncItemsCache`**。
- 对照：`go/instance/sync_items_cache.go` 的 `InvalidateSyncItemsCache()` 只在 `internal/app/app.go:220-221` 经 `scanner.OnCacheInvalidated` 注册，与 `ysmsync.RegisterInvalidationHook()` 一起挂在 scanner 上；app 层每个写入口还要**成对手动调两次**（`app_install_instance.go:237/238、309/310、322/323、428/429、453/454、492/493、513/514`、`app_install_import.go:98/99、107/108、334/335`、`app_sync.go:134/135`、`resource_bindings.go:534/535`）。
- **问题**：三方失效来源（scanner 钩子 / app 层显式成对调用 / sync 内部自清）里，**只有 sync 内部自清是不对称的**——它绕过了 scanner 漏斗，因此 sync 内任何新增/修改的变更点只要漏了 app 层那一对调用，整合包树就会停留在 30s TTL 内的陈旧数据（正是"内容变化漏报/树不刷新"那一族历史 bug 的土壤）。
- **根因**：失效职责按**包边界**划分（sync 只管 sync 的缓存），而数据依赖是**跨包**的（sync 变更直接影响 instance 的派生结果）；又因为分层纪律 sync 不能 import instance（`go/sync` 生产代码零 import `go/instance`，已 grep 确认），所以"让 sync 顺带清 instance 缓存"这条最直接的路径被堵死，只能在 app 层用 30 个调用点人肉配对。
- **建议方向**：让 sync 内部变更改走 scanner 漏斗——`defer scanner.InvalidateCache()` 或 `scanner.InvalidatePath(...)`，instance 的 `InvalidateSyncItemsCache` 由钩子级联触发（现在 `scanner.InvalidateCache`/`InvalidatePath` 末尾已调 `notifyCacheInvalidated()`，`scanner.go:237-245`、`scanner.go:315`）。这样"改了 A 忘了清 B"从"30 个调用点的人肉义务"降为"一个钩子注册"，新增同步操作不再有配对负担。
- **✅ 已修复（2026-10-16，commit `bbce4353a`）**：八处 `defer InvalidateSyncScanCaches()` 全部改 `defer scanner.InvalidateCache()`，经 `scanner.OnCacheInvalidated` 级联同时清 sync 扫盘 + instance 同步结果；app 层配对保留作防御纵深（`tests/test_sync_write_cache_pairing.ts` 强制保留）。相关失效入口注释（`app_install_instance.go` / `app_install_import.go` / `go/instance/instance.go` / `go/sync/sync_cache.go`）同步更新（`6fc3e892e`）。

### P0-2　push/pull 执行链 scanFn=nil：同尺寸异内容被静默判 Synced 不推送，与展示链答案相反
- **文件:行**：`go/sync/sync_push.go` `PushResources`（两分支）与 `PullResources` 直调 `SyncResources`/`SyncResourcesDirLevel`（scanFn=nil）→ 条目恒无哈希；判定单点 `go/sync/verdict.go:44-58` `ContentVerdict` 任一侧无哈希则回退 Size。
- **问题**：同尺寸异内容的文件被判 Synced 而不推送。受影响的是**执行链**——CLI `ysm instances push/pull` 经 `internal/app/app_install_instance.go:425` `PushResourceToInstance` → `ysmsync.PushResources` 中招；而展示链 `go/instance/instance.go:326/328` 早已注入 `scanner.ScanEntriesWithHit`/`scanner.ScanEntries`（hashed），**两条路对同一事实给出相反答案**。GUI 推送碰巧正确（FE `features/sync|downloadMissing` 逐文件直推 `InstallResourceToInstance`），掩盖了缺口。
- **根因**：哈希注入是**调用点义务**而非差集函数默认行为；展示链履行了、执行链没履行，且没有不变量闸钉住两者一致。
- **建议方向**：把 scanner 哈希注入下沉到 push/pull 执行链自身（同一成本模型：30s TTL 命中零哈希，哈希在 scanner 侧并行预算内现算），让「两路对同一事实答案相反」无土壤。
- **✅ 已修复（2026-10-16，commit 见 `git log --oneline --grep=pushPullDiff`）**：`sync_push.go` 新增包级 helper `pushPullDiff`，dirLevel 注 `scanner.ScanEntriesWithHit`、file-level 注 `scanner.ScanEntries`，`PushResources` 两分支与 `PullResources` 全部改走它。空哈希只剩「非 hashable 扩展」（`registry.ShouldHashExt` 之外）一类，非新降级。回归锁 `go/sync/sync_push_test.go|TestPushResources_SameSizeDifferentContent`（突变验证：退回 size-only → 计数 0，红灯）。pull 的 Extra 是键存在性，哈希对 pull 行为上无变化，但共用同一差集函数消分歧。

---

## P1（明显债务，值得近期修）

### P1-1　`go/sync` 单包 16 文件承担十种职责，已按文件拆但未拆包
- **文件:行**：`go/sync/` 目录下 sync.go / sync_resource.go / sync_push.go / sync_diff.go / sync_dirlevel*.go / sync_discovery.go / sync_relink.go / sync_walk.go / sync_hash.go / sync_cache.go / sync_targets.go / conflict.go / verdict.go，覆盖 diff/push/pull/relink/toggle/dirlevel/discovery/cache/conflict/verdict。
- **问题**：一个包内并存两个不同的一致性语义族（文件级 vs 目录级对比）、两套失效协议、一套独立冲突解决子系统，包内测试 ~30 个文件互相依赖共享的 `InstallLocker`/`hashFileForEntries`/`registerHookOnce` 等包级全局。
- **根因**：AGENTS.md 明确"新文件放对应包，不按行数机械切包"，因此历史上靠文件拆分替代包拆分；但 `go/sync` 的 3000+ 行已经超过"一个包"的认知边界，包级全局（`sync_cache.go:60-69` 三个 sync.Map、`conflict.go:294` `hashFileForEntries`）把本可独立的子系统（冲突解决）焊死在同步包上。
- **建议方向**：不必激进拆包，优先做两个子包：`sync/conflict`（DetectConflicts/Resolve*，见 P1-2）与 `sync/cache`（三层扫盘缓存 + 失效协议），其余留在 `sync`。这能立刻切断"冲突测试必须共享同步包的全局锁/全局 seam"的耦合。
  - **处置结果（2026-10-16 复核）**：**接受现状，不拆包**。证据：① 审查自身结论即为"不必激进拆包"，本轮不把可选优化当必改项；② 拆包的真实成本在**包级全局的迁移**——`installer.InstallLock`（`installer.go:59-63`）、`hashFileForEntries`（`conflict.go:295`）、`registerHookOnce` 等被包内 ~30 个测试文件共享，而冲突解决**必须与安装互斥**（`conflict.go:185-186` 整段持锁、`:199` `ResolveConflictsLocked` 供已持锁调用方），`sync/conflict` 子包若要保持同一把锁就仍需依赖 `installer`——耦合只是换位置，没有切断；③ `go/sync` 已按一致性语义族分文件（`sync_dirlevel_*` vs `sync_*.go` + `verdict.go`），认知负担的主因是"两套一致性语义并存"，而这正是 ADR-351 D1 刻意统一后的结果，不因拆包消失；④ 本项与 P1-2 的联动理由已随下条复核失效（"冲突子系统焊死在同步包上"的实证不成立：它经 app 层接入且本就必须与安装互斥）。**触发条件**：若将来冲突子系统被独立接线成批量后台任务、需要按变更频率独立评审，再按 `sync/conflict` + `sync/cache` 切分。

### P1-2　`conflict.go` 整套冲突子系统在生产调用图上不可达（死代码/未接线）
- **文件:行**：`go/types/config.go:179` 定义 `SyncConfig.ConflictPolicy`；唯一入口 `go/sync/sync_resource.go:196` `if config == nil || config.ConflictPolicy == "" { return }`。grep 全部 `SyncResourcesWithConfig(` 调用点：`app_install_instance.go:406`、`go/instance/instance.go:327`、`go/sync/sync_resource.go:26` **全部传 `nil`**；只有 `go/sync/sync_lockassert_test.go:33/41` 传了非 nil config。
- **问题**：386 行的 `conflict.go`（DetectConflicts / ResolveConflict(s) / conflictFromVerdict / collectFileEntries）在生产路径上一次都不执行，全靠一个从未被生产的配置字段守卫。这意味着：①冲突检测的用户价值为零却保留全部复杂度；②一旦未来某入口传了 config，`DetectConflicts` 的**全树 `filepath.Walk` + 逐文件 SHA256**（`conflict.go:305-361`，且**无任何缓存**）就会在 `installer.InstallLock` 临界区内跑——`sync_resource.go:206-233` 明确允许"已持锁时走 `ResolveConflictsLocked`"，注释自述 `PushResources/PullResources → SyncResources 在 InstallLock 临界区内运行`。
- **根因**：子系统按"防御性能力"开发，但接入点（SyncConfig）没有生产者；同时它复用了全局单锁却把最重的 I/O（全树哈希）留在锁内，与 `SyncToggleStatus`/`RelinkDir` 已完成的"锁外哈希"（`sync.go:103-245`、`sync_relink.go:44-63`）口径不一致。
- **建议方向**：二选一，别留中间态——要么把 config 从 UI/薄壳接通（`app_sync.go` 等），要么删除 `conflict.go` 与 `handleSyncConflicts` 整段；若保留，必须把 `collectFileEntries` 挪到锁外（对齐 SyncToggleStatus 阶段 1+2 锁外哈希），并让 `collectFileEntries` 复用 `sync_cache.go` 的 30s 扫盘缓存，否则大仓库全树哈希会卡死所有安装。
  - **处置结果（2026-10-16 复核）**：**判定部分推翻——"整套冲突子系统在生产调用图上不可达（死代码）"不成立**。`DetectConflicts`/`ResolveConflicts` 有**活的 App 层入口且已被前端消费**：`internal/app/app_sync.go:89 func (a *App) DetectConflicts(rtype, instanceName string) (*ysmsync.ConflictReport, error)`（`:95` 调 `ysmsync.DetectConflicts`）、`:112 func (a *App) ResolveConflicts(conflicts []ysmsync.FileConflict, defaultStrategy, rtype, instanceName string) (*types.SyncResolveResult, error)`（`:123` 调 `ysmsync.ResolveConflicts`；`:134` 配对 `instance.InvalidateSyncItemsCache()`，注释自述为 2026-10-10 配对审计的唯一漏网项）。Wails 具名方法自动绑定 → 前端 `frontend/src/views/app-content/diagnostics/conflicts.ts:174/:176` `DetectConflicts(target.rtype, target.instance)`、`:302/:305` `ResolveConflicts(conflicts, strategy, target.rtype, target.instance)`；界面在诊断页 sync-conflict tab（`frontend/src/views/app-content/tpl.ts:425` `id="diag-scan-sync-conflict"`、`:431` `id="diag-sync-conflict-list"`，结构由 `frontend/src/views/app-content/tpl.test.ts:469` 锁定），测试 `frontend/src/views/app-content/diagnostics/conflicts.test.ts`（16+ 例）与 `conflicts-rtype-label.test.ts`。**故"要么接通 config、要么删除 `conflict.go` 与 `handleSyncConflicts` 整段"的建议不采纳**——`conflict.go`（380 行）是活代码，"用户价值为零"的判断与事实相反。
  - **真正未接线的只有配置驱动那一条**：`go/sync/sync_resource.go:197 func handleSyncConflicts(config *types.SyncConfig, instanceDir, globalDir, rtypeID string)`（`:212` `DetectConflicts`、`:231` `ResolveConflictsLocked` / `:234` `ResolveConflicts`），由 `:256` 从 `SyncResourcesWithConfig` 调用，而 `config` 的生产调用点全传 `nil`（`internal/app/app_install_instance.go:406`、`go/instance/instance.go:327`、`go/sync/sync_resource.go:26`），仅 `go/sync/sync_lockassert_test.go:33/41` 传非 nil。**处置：保留**——它是"同步操作内联解决冲突"的预留能力，守卫式早退（`config == nil || config.ConflictPolicy == ""` → `return`）零成本；删除反而要动 `go/types/config.go:179` 的 `SyncConfig.ConflictPolicy` 与锁断言测试。
  - **"锁内全树哈希"隐患的准确归属**：`collectFileEntries`（`conflict.go:306`，全树 `filepath.Walk` + 逐文件 SHA256、无缓存）**只被 `DetectConflicts` 调用**（`conflict.go:79`/`:84` 两侧各一次），`ResolveConflict`（`:134`）不调它。因此落进 `InstallLock` 临界区的只有**配置驱动分支**：`handleSyncConflicts` 在 `PushResources/PullResources → SyncResources` 的持锁区内调 `DetectConflicts`。`App.DetectConflicts`（`app_sync.go:89`）自身不取锁（诊断页用户主动触发的只读全树扫描），`ResolveConflicts`（`conflict.go:184`）虽持锁但只按调用方给定的路径写文件、不做遍历。**处置：不改**——写路径与安装互斥是正确性要求；给 `collectFileEntries` 复用 30s 扫盘缓存属后续优化（与 P2-1 同族的粗粒度/细粒度权衡），非本轮范围。

### P1-3　硬编码 `.pmx` / `.pmd` 扩展名分支，ADR-065 唯一残留
- **文件:行**：`go/sync/sync_push.go:288` `ext == ".pmx" || ext == ".pmd"`（文件级安装路由 → `installDirUnitLocked(parent)`）；紧邻的 L292 已是 `registry.IsYsmEntryJSON(base)`（注释 L262 说明原 `ext==".json"` 会误判 readme.json）。
- **问题**：同一条路由分支里，一处已收敛到注册表、一处仍是字面量。`.pmx/.pmd` 属 `registry.IsDirLevelSync`/`ShouldHashExt` 同族语义，注册表有 `installExts` 字段却未在安装路由消费。
- **根因**：ADR-065 收敛时改了 `.json` 这条，`.pmx/.pmd` 因"MMD 特例"被留在分支里，缺乏"同函数内相邻分支同源化"的审计点。
- **建议方向**：把"该扩展名是否按父目录安装"下沉为注册表查询（如 `registry.IsDirEntryInstall(ext, rtype)`），消费 `installExts` 或新增布尔字段；`sync_push.go:288` 改调之。
  - **处置结果（2026-10-16 复核）**：**接受现状，暂不改**（行号因 P0-② 新增 `pushPullDiff` helper 下移，现为 `go/sync/sync_push.go:301`）。现存形态：`:300` 注释「.pmx/.pmd 一律视为 MMD 文件夹级安装（整个父目录）」+ `:301 if ext == ".pmx" || ext == ".pmd" {`，紧邻的 `:305` 已是 `if ext == ".json" && registry.IsYsmEntryJSON(filepath.Base(filePath)) {`。**不采纳的立因**：① 注册表当前**没有"文件夹级入口扩展"这一谓词**——`installExts` 是"可否安装"集合、`IsDirLevelSync` 是"按类型整体走目录级"、`ShouldHashExt` 是"是否哈希"，三者语义与"该扩展名是否按父目录安装"都不同，新增字段会是第四个正交维度；② 落地要同时改 `resource_types.json` schema + Go 注册表字段 + `scripts/` 的 schema 守卫测试（FE 侧 `schema.ts` 构建期内联同一份 JSON），属跨三层改动；③ 收益低——MMD 的文件夹级安装是 ADR-344 D3b 明确的特例语义，`.pmx/.pmd` 字面量出现且仅出现在这一处路由，`registry.IsDirLevelSync("mmd")` 已覆盖类型级判断。**触发条件**：若将来再有第三种"按父目录安装"的扩展名族，或 `resource_types.json` 因别的原因需要新增扩展谓词字段，则一并下沉为 `registry.IsDirEntryInstall(ext, rtype)`。

### P1-4　派生缓存复用了 scanner 的 TTL，却没复用它的 cacheGen 代际护栏
- **文件:行**：`go/scanner/scanner.go:31` `cacheGen atomic.Uint64`（防在途扫描把旧结果 Store 进已失效缓存）；`go/sync/sync_cache.go:74-87` `InvalidateSyncScanCaches` 只清 map，无代际；`go/instance/sync_items_cache.go` `clear()` 同样无代际。
- **问题**：`instance.BuildSyncItems`（`go/instance/instance_tree.go:15`）与 `instance.go:325/327` 的读取是**锁外**的（UI 树路径），可在一次 push 持锁失效期间并行读到失效前起算的旧条目，最坏到 30s TTL 才刷新。scanner 用 `cacheGen` 消除了同类问题，但这一护栏没下沉到三层派生缓存。
- **根因**：派生缓存通过 `scanner.EffectiveCacheTTL()`（`scanner.go:185-187`）只继承了"刷新周期"这一半协议，没继承"失效代际"那一半。
- **建议方向**：派生缓存 key 里带上 `scanner.EffectiveCacheGen()`，或在 `Invalidate*` 时递增共享 token，使"失效前在途的 Store"落地即被视为过期。
- ✅ **已修**（本提交）：派生缓存各自持代际 token——`go/sync/sync_cache.go` 增 `var syncCacheEpoch atomic.Uint64`，`InvalidateSyncScanCaches()` 首行递增，`storeSyncScanCache[T](…, epoch)` 写前比对；三个 collect 入口（`collectResourceEntries` / `collectEntries` 闭包 / `collectEntriesWalkCached` / `collectFolderFiles`）在 load-miss 后立即捕获、store 前比对。`go/instance/sync_items_cache.go` 的 `syncCache` 结构体加 `epoch atomic.Uint64`，`clear()` 末尾递增，`put/putAt` 写前比对；`BuildSyncItems` load-miss 后捕获。因 `InvalidateCache` 与 `InvalidatePath` 都经 `notifyCacheInvalidated()` 级联清全部派生缓存，单一 token 即可覆盖两类失效。回归锁：`TestSyncScanCache_StaleEpochRejected` / `TestSyncItemsCache_StaleEpochRejected`（突变禁用守卫→红，恢复→绿）。

### P1-5　`IsSupportedExt` 每次调用都走 `LoadRegistry()` 的全局 Mutex
- **文件:行**：`go/types/registry/extensions.go:151-154` `IsSupportedExt` 每调必 `LoadRegistry()`；`LoadRegistry()` 在 `resource.go:179-181` 用 `registryMu.Lock()`（刻意弃 sync.Once 以避免 SetRegistryPath 竞态）。
- **问题**：这是 sync 的**热路径**——`IsResourceAllowed`（`extensions.go:249-256`）在 `sync.go` 的 `WalkDir` 里逐文件调用，千级文件扫描 = 千次全局 Mutex lock/unlock，多核下产生缓存行乒乓。虽然非竞争时 Mutex 很快，但"每文件一次全局锁"是明显的设计摩擦。
- **根因**：`LoadRegistry` 用 Mutex 而非 `sync.Once` 是为了 `SetRegistryPath` 可重置；但只读查询路径（`IsSupportedExt`）也被迫每次都取锁。
- **建议方向**：把 `registry` 指针用 `atomic.Pointer[ResourceTypeRegistry]` 缓存，`LoadRegistry` 只负责首次填充，`IsSupportedExt` 走无锁读；`SetRegistryPath` 仍可重置（写路径持 Mutex + Store 新指针）。
- ✅ **已修**（本提交）：`resource.go` 的 `registry` 由 `*ResourceTypeRegistry`（裸指针 + Mutex）改为 `atomic.Pointer[ResourceTypeRegistry]`。`LoadRegistry` 首行快路径 `if reg := registry.Load(); reg != nil { return reg }` 无锁读，慢路径持 `registryMu` 双检后构建、`registry.Store(&reg)` 发布（Store 具 release、Load 具 acquire 语义，读者看到的是完整构造的注册表，不会读到半初始化对象）；`SetRegistryPath` 写路径仍持 Mutex 并 `registry.Store(nil)`，可重置语义不变。`IsSupportedExt`/`IsContainerExt`/`ShouldHashExt` 等所有 `LoadRegistry` 消费方在首次加载后全部走无锁读——千级文件扫描不再产生千次全局 Mutex lock/unlock。`types_desc_test.go` 的 `registry != nil` 断言同步改为 `registry.Load() != nil`。

### P1-6　`syncDirectoryScanKey.hashed` 的"folder 恒 false"零值陷阱
- **文件:行**：`go/sync/sync_cache.go:43-53` 注释自述 `"folder" kind 恒 false 因字段默认零值`——`kind: "folder"` 的 key 永远落在 hashed=false 那一格，即使将来 folder 扫描支持哈希，也会与未哈希结果互相污染。
- **问题**：这不是 bug（当前 folder 扫描确实无哈希），但它是**埋点**——任何未来"给 folder 加哈希"的改动会静默复用错误缓存桶。`hashed` 作为区分维度本身是对的（注释 D2′-a 已说明其立因），错在把"某 kind 恒 false"当作约定记在注释里而非编码进 key 构造。
- **建议方向**：把 `hashed` 从字段改为由 `kind` + 显式 bool 组合派生，或给 `syncDirectoryScanKey` 增加 `NewScanKey(kind, root, rtype, hashed)` 构造器，禁止零值直构。
  - **处置结果（2026-10-16 复核）**：**接受现状**（保留注释约定，不引入构造器）。核查生产构造点共三处，需要 `hashed` 的两处**都已显式传值**：`go/sync/sync_resource.go:159 syncDirectoryScanKey{kind: "resources", root: rootDir, rtype: rtypeID, hashed: scanFn != nil}`、`go/sync/sync_dirlevel_sync.go:50 syncDirectoryScanKey{kind: "dirlevel", root: rootDir, rtype: rtype, hashed: hashed}`；第三处 `go/sync/sync_dirlevel_diff.go:201 syncDirectoryScanKey{kind: "folder", root: folder, rtype: rtype}` 是唯一零值直构点，而 `"folder"` 扫描确实**从无哈希通道**（`sync_cache.go:43-53` 注释自述一致）。即"某 kind 恒 false"当前是**事实**而非隐患：没有任何生产路径需要它非 false，故新增 `NewScanKey` 构造器属零行为变更的纯重构。测试侧 `go/sync/sync_cache_test.go:16/30/56/73/110/120` 亦刻意零值直构以覆盖 hashed=false 桶。**触发条件（记入待办而非现在改）**：一旦给 `"folder"` 扫描加上哈希能力，必须同时引入 `NewScanKey(kind, root, rtype, hashed)` 并禁止零值直构，否则新旧结果会互相污染同一缓存桶。

### P1-7　`loadSyncScanCache` 返回缓存内 map 的共享引用，正确性靠注释记忆
- **文件:行**：`go/sync/sync_cache.go:10-13` 铁律注释"返回缓存内 map 共享引用，消费方只读，禁止写虚拟条目"。
- **问题**：`collectResourceEntries`（`sync_resource.go:160-161`）把缓存的 map 直接返回给 `ResourceDiff`、`dirLevelResult` 等；这些调用方只读目前成立，但任何一处误写（例如未来某收集器想就地补 `FoldDigest`）会污染所有并发的 BuildSyncItems 读。`sync_resource.go:178-184` 现在是在**入缓存之前**回填 FoldDigest，说明开发者清楚风险，但该风险只靠注释约束。
- **建议方向**：`storeSyncScanCache` 前返回**不可变视图**（如把 map 换成 `map` + 只读接口，或入缓存前 `clone`）；至少给 `loadSyncScanCache` 返回类型加"只读"命名约定并配一个契约测试断言消费方未写。
  - **处置结果（2026-10-16 复核）**：**接受现状（保留注释铁律），不加 clone、不加只读包装**。证据：① 契约已双重成文——`go/sync/sync_cache.go:10-13` 注释铁律「返回缓存内 map 共享引用，消费方只读，禁止写虚拟条目」+ `:98-99` 函数头「命中时直接返回缓存内 map/MAP 引用；调用方按包级契约只读使用」；② 已知的唯一真实风险点**已从设计上消除**——FoldDigest 是**入缓存之前**回填的（`go/sync/sync_resource.go:178-184`），不是命中后就地补写，说明开发者清楚该风险并选了正确顺序；③ 消费方（`ResourceDiff`、`dirLevelResult`）逐条只读；④ 换取的代价不划算：Go 的 `map` 无只读视图类型，浅拷贝返回会在**每次缓存命中**（UI 树热路径）付 O(n) 复制，正好抵消缓存的意义；只读包装类型要改所有调用点签名且仍挡不住类型断言。**触发条件**：若将来出现**第二处**"命中后就地写缓存 map"的需求（例如把 FoldDigest 挪到 `ResourceDiff` 侧），则必须先在本包落地 `cloneSyncScanCache` 或在 `loadSyncScanCache` 内统一浅拷贝，并为该路径补契约测试——届时"注释约束"即失效，不能再靠记忆。

---

## P2（优化建议）

- **P2-1　`InvalidatePath` 单文件变更全量清空三层派生缓存**：`go/scanner/scanner.go:315` 末尾 `notifyCacheInvalidated()`，任何单文件 toggle 都会把 sync 三个 scan cache + instance syncItemsCache 全部清掉，下次读取全部重扫。调用点 `app_files.go:417/438`（单文件 toggle）。方向：给派生缓存做**路径级**失效（sync/instance 缓存 key 若可映射到 root 前缀，则只清命中 root 的条目），当前"粗粒度正确、性能代价大"的设计可作为后续优化。
  - **处置结果（2026-10-16 复核）**：**接受现状，不改**。证据：① 两个触发点都是**用户主动单文件启禁**（`app_files.go:417 ToggleModelEnable`——已 Deprecated、仅 browser-adapter；`:438 ToggleEnable`——唯一活跃入口），非热路径；② **scanner 自身的 scanCache/browseCache 已经是路径级细粒度失效**（`keyVersions.Range` 前缀递增 + `scanCache.Range` 按 `isInvalidationRelated` 选择性删除 + `InvalidateBrowsePath`），只有**派生缓存**（sync/instance）粗粒度——而它们只在级联 `notifyCacheInvalidated()` 时清空，属"保守正确"（宁多清不少清，绝不给陈旧数据）；③ 正确性不受影响；④ 细粒度化需要改 `OnCacheInvalidated` 钩子签名 `func() → func(string)`（或新增一个带路径的钩子），涉及 go/scanner + go/instance + go/sync 三处，为一次用户启禁的边际收益付出中等改动，性价比不成立；⑤ 锐评本身已自陈"可作为后续优化"，非必改。若未来出现批量启禁热路径，再回头做路径级失效。
- **P2-2　`syncItemsCache` 用 `sync.Mutex` 而非 `RWMutex`**：`go/instance/sync_items_cache.go` 读多写少，`get`/`put` 全走独占锁。方向：改 `sync.RWMutex`（`get` 读锁）。
  - **处置结果（2026-10-16 复核）**：**接受现状，不改**。关键否决理由是 `get` 的**过期惰性删除**（`go/instance/sync_items_cache.go:54-58`：命中但已过期则 `delete(c.items, key)` 后返回未命中）——读路径带写操作，而 `sync.RWMutex` **不支持读锁升级为写锁**，直接改会把每次可能的过期命中变成"RLock 判定 → 放弃 → Lock 重来"的二段式，或需 `TryLock` 兜底，复杂度换来的收益只是少数并发读。次级证据：① `BuildSyncItems`（`go/instance/instance_tree.go:15-41`）**单次调用只触及缓存一次**（命中即 return，未命中则一次 `put`），不存在反复加解锁的循环热点；② 锁内主要成本是命中路径的 `cloneSyncItems` O(n) 复制，不是临界区争用；③ 组件自己已把该取舍写在代码里（`:45-46` 注释「读写同一把锁：BuildSyncItems 单次调用只触及一次缓存，无并发热点，从简」），非遗漏；④ 同一把 `mu` 还仲裁 P1-4 新增的 `epoch` 比对（`putAt` 在锁内比对），拆成读写双锁会让"代际校验 + 写入"的原子性更难论证。**触发条件**：若将来 `peek` 之外出现按路径批量查询的读热点、或惰性删除被改为后台清扫，再评估 RWMutex。
- **P2-3　`LockTracker.currentGoroutineID` 解析 `runtime.Stack`**：`go/installer/lock_tracker.go:59-91` 主路径靠 `runtime.Stack` 前缀 `"goroutine N [state]"` 提取 goroutine id，是公认的脆弱依赖（runtime 内部格式可变）；已有降级路径（栈帧 PC + 全局单调 token）。方向：直接采用降级路径为主，去掉字符串解析。
  - **处置结果（2026-10-16 实证复核）**：**建议方向有害，不采纳**。降级路径 `goroutineIdentity()`（`lock_tracker.go:42-54`）用 `runtime.Callers(4, pc[:])` 后取 `pc[nf-2]`（2 元素缓冲区下恒为 `pc[0]` = skip=4 的那一帧）作为身份 key。**该 PC 随调用深度变化**：`Lock()` 直调 `currentGoroutineID` 时 skip=4 落在调用者帧（如 `funcX`）；`HasLock()` 经 `funcX → someLockedFunc → assertInstallLockHeld` 链间接调用时 skip=4 落在中间帧（`assertInstallLockHeld`）。两者 key 不同 → 分配的单调 token 不同 → 同一 goroutine `Lock` 后 `HasLock` 恒 false → `assertInstallLockHeld` 必 panic。**主路径才是跨调用深度恒定的那个**（`runtime.Stack` 返回真实 goroutine id，与调用深度无关）。实证探针（临时测试，已删）：`Lock深度=0x…dba3  HasLock深度=0x…6d6b 相等=false`；主路径两次取 `currentGoroutineID` 均返回 `35`。锁持有时长毫秒级、ID 复用风险可忽略，`runtime.Stack` 前缀格式自 Go 1.0 起稳定（大量工具依赖），且解析失败已有优雅降级——**保留主路径是正确的**。唯一可做的无害小改进是修 `goroutineIdentity` 的 `pc[nf-2]` 越界隐患（nf=1 时 `pc[-1]` panic），但那属降级路径本身，不改主路径。
- **P2-4　测试隔离靠约定**：`go/sync/conflict.go:294` 包级 `var hashFileForEntries = fsutil.SHA256File` 注释明示"非并发安全，测试注入时禁 t.Parallel"；`go/sync/sync_cache.go:23-25` `registerHookOnce` 由测试注入。依赖关系只能靠注释记忆（`sync_targets.go:1` 注释自述"正确性靠注释复述本包行为"）。方向：为这些 seam 引入显式的 `reset` helper + `t.Cleanup`，把"禁 t.Parallel"从约定变为 `testing.TB` 检查。
  - **处置结果（2026-10-16 已修一半）**：复核发现三个调用点都是 `restore := inject...()` + `defer restore()`（恢复正确），注释的「禁 t.Parallel」也被遵守——**无现存活 bug**。只落地廉价且严格更稳的半：`injectHashFailure` / `injectFixedHash`（`go/sync/conflict_test.go:429-459`）改为 **`t.Cleanup` 注册自动恢复**，去掉调用方手工 `defer restore()`（三个调用点 475/499/529 同步简化）。`t.Cleanup` 从「约定」变「保证」——忘 `defer` 即把注入残留到后续测试的 bug 类被结构性消除，且子测试结束后必恢复（顺序由 Go 保证）。**另一半未做**：把「禁 t.Parallel」变成 `testing.TB` 检查——Go 无公开 API 检测 `t.Parallel()` 是否已被调用（`t.Setenv`/`t.TempDir` 是仅有的内置禁并行机制，语义不适用包级 seam 注入），强行自造检查只能靠反射读私有字段，脆弱且不值得。约定注释保留、且 `hashFileForEntries` seam 仅在 `go/sync` 包测试内注入（`registerHookOnce` 是 `sync.Once` 幂等、无污染风险），风险面已收窄。验证：`go vet ./go/sync/...` 干净；`go test ./go/sync/... -count=1` 全绿。
- **P2-5　`FindInstDir` 兜底默认关闭，`ScanInstance` 字段仅 1 类型消费**：`go/types/registry/findinst.go:101-103` 门控仅 `blueprint` 开启；`ScanInstance`/`FallbackDir` 成为"为单一类型服务的配置"（`findinst.go:161-166`）。方向：若长期只有 blueprint 使用，考虑把该特殊逻辑下沉为 blueprint 类型专用查询，而非挂在通用 `ResourceType` 字段上。
  - **处置结果（2026-10-16 复核）**：**接受现状，不改**。证据：① `ScanInstance`/`FallbackDir` 是 `resource_types.json` 的**数据驱动字段**（`ResourceType` 结构体 `resource.go:62-63` `json:"scanInstance"` / `json:"fallbackDir,omitempty"`），单一事实源正确；② **schema 守卫已到位**——守卫 6 `guardScanInstanceFallbackDir`（`resource_guard.go:188-195`）强制 `scanInstance=true` 必须声明 `fallbackDir`，否则加载告警；③ `FindInstDir` 的**默认关闭门控**（`rt == nil || !rt.ScanInstance → 返回标准路径`）是**刻意且正确的安全设计**（`findinst.go:94-105` 注释：类型未知即无权越界扫描，防同步/回收站对错误目录做删改），非债；④ "只有 blueprint 用"正是**opt-in 数据驱动字段的正确结果**——任何未来类型只需在 `resource_types.json` 加 `scanInstance`+`fallbackDir` 即可接入，无需改 Go；⑤ 下沉为 blueprint 专用会**要么硬编码**（违背 schema 驱动）、**要么另建查找表**（重复 schema 已有信息），两种都是倒退。已有测试：`TestSchemaGuard_ScanInstanceRequiresFallbackDir_Warns` / `TestSchemaGuard_ScanInstanceWithFallbackDir_NoWarn`（`registry_schema_guard_test.go:339-351`）。
- **P2-6　`resourceTypesForSync` 切片副本的潜在陷阱**：`internal/app/app_install_instance.go:598-609` 已用注释警告"就地 `[:0]` 截断会把共享注册表单例永久裁剪"，说明该函数历史上出过这类坑。方向：把 `registry.AllTypes()` 改为总是返回副本，消除消费方责任。
  - **处置结果（2026-10-16 已修）**：方向名有误——`registry.AllTypes()` **不存在**（grep 全 go 源码无此函数），但"总是返回副本"的精神有效且廉价，按精神落到了 `resourceTypesForSync` 上：rtype=="" 分支由 `return all`（直接返回入参，极可能是 `reg.ResourceTypes` 共享单例）改为 `return append([]registry.ResourceType(nil), all...)`。当前两个消费方（`buildInstanceStatusCounts` 与 `GetInstanceSyncStatus`）对返回值**仅只读**（grep 实证 `go/instance` 的 `sort.Strings` 只作用于输出 string 切片 st.Missing/Extra 等，不作用于 `filtered []registry.ResourceType`），故原代码**无现存活 bug**，本改动是把"消费方不得就地截断"的隐性责任前移到本函数，调用点零风险。测试补强：`app_install_instance_test.go|TestResourceTypesForSync` 新增 `&gotAll[0] == &all[0]` 断言（返回值与入参共享底层数组即 fail）。语义不变（副本内容与全集相同），回归锁有效。
- **P2-7　30s TTL 三层同周期，UI 刷新延迟与操作延迟同源**：push/pull 后树更新依赖 app 层显式失效，漏一处即 30s 陈旧（与 P0-1 同源）。方向：P0-1 落地后本项自动消解。
  - **处置结果（2026-10-16 复核）**：**已随 P0-① 消解（`bbce4353a`），无需单独动作**。原判定"push/pull 后树更新依赖 app 层显式失效、漏一处即 30s 陈旧"的前提是 go/sync 内部写入口绕过钩子级联（只清自己的三层缓存、不通知 scanner）——P0-① 落地后 `go/sync` 内部所有写入口统一改走 `scanner.InvalidateCache()`，经 `notifyCacheInvalidated()` 级联清空全部派生缓存，"漏一处"的失效面已从 13 处显式配对收敛为单一漏斗；app 层配对调用保留为纵深防御。三层 TTL 同为 30s（`scanner.EffectiveCacheTTL()`，`scanner.go:185`）则仍是刻意的单源设计：TTL 是"没有失效事件时的兜底刷新周期"，不是"失效传播机制"，故"同周期"本身不构成缺陷。

---

## 按审查轴逐项评价

**1. 分层与依赖方向 —— 干净**
`go/instance` → `ysmsync "go/sync"` → `go/scanner`，单向；`go/sync` 生产代码零 import `go/instance`（已 grep，仅注释/测试提及）。失效钩子注册点唯一且显式：`internal/app/app.go:220-221`，不在包 `init`（`sync_cache.go:23-34`、`instance.go:34-49` 的 `registerHookOnce` 注释明确是从"隐式 init"改过来的）。无循环依赖、无隐式副作用。

**2. 缓存设计 —— 收敛好，但代际护栏缺失**
三层（scanner 30s → sync 三个 scan cache 30s → instance syncItemsCache 30s）的 TTL 同源 `scanner.EffectiveCacheTTL()`；失效已收敛为"scanner 单漏斗 + app 层显式成对失效"双保险，**没有**"改了 A 忘了清 B"的全局缺口。但 P0-1（sync 内部变更绕过漏斗）与 P1-4（cacheGen 未下沉）是两个结构性残余。

**3. 锁设计 —— 上乘，但冲突路径是例外**
`installer.InstallLock` 全局单锁被 sync/conflict/app/watcher 复用（`installer.go:23/30`，ADR-056/202）。`SyncToggleStatus`（`sync.go:59-89`：阶段 1+2 锁外扫描与哈希、阶段 3+4 持锁改名）与 `RelinkDir`（`sync_relink.go:44-63`）都完成了"重 I/O 锁外化"。`HasLock()` 用 owner-tracked goroutine id（`lock_tracker.go:131-134`）替代 TryLock 探测，消除了"他人持锁被误判为已持锁"的窗口。**唯一例外**是 P1-2 的冲突路径：`collectFileEntries` 的全树 SHA256 无缓存且在锁内可跑。

**4. 一致性模型 —— ADR-064/065 收敛度高**
对比判定已收敛到 `verdict.go:44-58` `ContentVerdict` 单点（ADR-347，替代原 `sync_diff.go|contentDiffers` 与 `sync_dirlevel_diff.go|contentStatus` 两份同义实现）；名称归一/允许集收敛到 `registry.NormalizeResourceName`/`IsResourceAllowed`（ADR-064）；推送目标三路推导收敛到 `sync_targets.go` `PushTargetsForUnit`（ADR-351 D4，从 `go/instance/status_counts.go` 下沉）。残留字面量仅 `sync_push.go:288` 的 `.pmx/.pmd`（P1-3）。`go/packs/classify.go` 的 `case "ysm"` 属分类职责本身，不计入违规。

**5. 包边界 —— 未拆包（P1-1）**

**6. 错误处理与路径安全 —— 系统性到位**
AppError 体系 + `paths.RelInside` 双路防穿越（`sync_push.go:479-485`、`conflict.go:133-180`）；实例侧 `installDirUnitLocked` 的根级目录拒绝（`sync_push.go:315-340`，"整仓推送会污染整合包"）；`validateInstallPaths` 四道守卫含 EvalSymlinks 归一化防 8.3 短名（`installer.go:77-111`）；`isFileLocked` 按 GOOS 分支错误码 + `errors.Is` 链（`sync_resource.go:304-318`，Windows ERROR_SHARING_VIOLATION 32/33）。

**7. 可测性 —— 中等**
大量 `*Locked` 内部函数 + 包级全局锁 + 单例缓存；测试靠 `InstallLocker` stub 注入（ADR-202 刀3，测试 stub 无 `HasLock` 时 `assertInstallLockHeld` 放行，`sync_resource.go:270-276`）与 `hashFileForEntries` seam 隔离。但 seam 非并发安全（禁 t.Parallel）、依赖关系靠注释记忆（P2-4）。

**8. rtype 注册表驱动 —— 基本成真**
grep 全 `go/sync`、`go/instance`、`go/packs` 生产代码：无 `=="ysm"`/`=="mmd-skin"` 硬编码分支。sync/instance 全部走 `registry.IsDirLevelSync`/`NestedPatternsFor`/`IsDisableSuffix`/`IsYsmEntryJSON`/`IsResourceAllowed`/`packs.IsTypeModelFile`。唯一硬编码残留 P1-3。

---

## 处置状态总览（2026-10-16）

16 条发现全部有结论，无悬空项。

| 状态 | 条目 | 备注 |
|---|---|---|
| **已修** | P0-1 `bbce4353a`、P0-2 `b09094e1c`、P1-4 `8f2a8b1a1`、P1-5 `bcc598130`、P2-6 `2d7b38f39` | 均带回归锁 |
| **已随他项消解** | P2-7 | P0-1 落地后失效传播收敛到单漏斗，无独立动作 |
| **半修** | P2-4 `12b6cd392` | 测试 seam 注入改 `t.Cleanup` 自动恢复；"禁 t.Parallel"因 Go 无公开检测 API 保留注释约定 |
| **判定推翻（不删不改）** | P1-2 | `conflict.go` 是活代码（app 层 + 诊断页在用）；仅配置驱动的 `handleSyncConflicts` 分支未接线，保留 |
| **接受现状** | P1-1（不拆包）、P1-3（`.pmx/.pmd` 暂留）、P1-6（零值陷阱为事实非隐患）、P1-7（注释铁律）、P2-1（粗粒度失效）、P2-2（`Mutex` 因 `get` 惰性删除不宜 `RWMutex`）、P2-5（schema 数据驱动正确） | 各条已记触发条件 |
| **建议有害不采纳** | P2-3 | 降级路径有真实 bug，字符串解析仍是主路径 |

**复核口径**：P1-2 与 P2-2 的原判定在本轮被推翻/降级——前者把"活代码"判成死代码，后者把"有据的取舍"判成遗漏。两篇锐评的后续引用应以本总览为准。

## 整体设计评价

| 维度 | 得分（/10） | 一句话 |
|---|---|---|
| 分层 | **9** | instance→sync→scanner 单向、无循环、钩子显式注册无 init 副作用 |
| 缓存 | **8** | 单漏斗 + 成对失效是亮点；~~sync 内部变更绕过漏斗、cacheGen 未下沉~~（P0-1/P1-4 已修）→ 余下仅粗粒度全清 |
| 锁 | **8** | 全局单锁 + 阶段化锁外哈希 + HasLock 精确判定属上乘；冲突路径锁内全树哈希是例外（仅未接线分支） |
| 一致性 | **9** | ContentVerdict 单点 + 注册表驱动收敛度高；~~未接线的 conflict 拖分~~（P1-2 判定推翻）→ 余下仅 `.pmx/.pmd` 字面量 |

**最值得先动手的两件事（2026-10-16 更新）：**
1. ~~消除失效不对称（P0-1）~~ **已完成**（`bbce4353a`）：sync 内部变更改走 `scanner.InvalidateCache/InvalidatePath` 漏斗，instance 的 `syncItemsCache` 经钩子级联失效——"漏报族 bug"的结构土壤已关闭。
2. ~~处置 conflict 子系统（P1-2）~~ **判定推翻，无需动手**：`conflict.go` 是活代码（`App.DetectConflicts`/`App.ResolveConflicts` → 诊断页 sync-conflict tab，16+ 测试）；唯一未接线的是配置驱动的 `handleSyncConflicts` 分支，守卫式早退零成本，保留。**遗留的真动作**（触发条件式）：若将来把该分支接线，必须同时把 `collectFileEntries` 挪到锁外并复用 30s 扫盘缓存——否则它一上线就会把全树 SHA256 塞进全局单锁。

**分数复核（2026-10-16）**：缓存 7 → **8**（P0-1 单漏斗 + P1-4 代际护栏双双落地；余下扣分是粗粒度全清 P2-1）；一致性 8 → **9**（P0-2 消除执行链/展示链答案相反；余下扣分仅 `.pmx/.pmd` 字面量）。锁 8 不变（冲突路径锁内全树哈希的隐患仍在，只是仅限未接线的配置分支）。

---

*本报告所有判断均锚定具体文件:行号；`go/sync` 是否进一步拆子包、conflict 子系统的接入路径为设计取舍，未做运行验证。**处置记录更新于 2026-10-16**：16 条发现逐条复核并落地或记录触发条件（见「处置状态总览」），其中 P1-2/P2-2 的原判定经代码复核被推翻或降级。*