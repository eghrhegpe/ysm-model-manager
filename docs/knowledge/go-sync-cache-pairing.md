---
kind: go-sync-cache-pairing
name: 同步缓存失效配对契约（go/sync × go/instance × 写面派生闸）
tier: leaf
category: go
status: active
source_files:
  - go/sync/sync_cache.go
  - go/instance/sync_items_cache.go
auto_fields:
  symbols_with_lines:
    - InvalidateSyncScanCaches
    - RegisterInvalidationHook
last_verified: 2026-10-15
adr:
  - ADR-269
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 双缓存失效配对、写入口漏清缓存
  - 写面派生 fail-closed 闸（write-surface-gate）
  - sync 扫盘缓存 hashed 维度
quick_risk_lines:
  - app 层每条写入口必须成对调 instance.InvalidateSyncItemsCache + ysmsync.InvalidateSyncScanCaches（或等价的 a.ClearScanCache 三层清）——新写点漏归类，tests/test_sync_write_cache_pairing.ts 派生闸当场红
pitfalls:
  - go/sync 写操作自 2026-10-16（锐评 P0-①）改走 scanner 单漏斗 `defer scanner.InvalidateCache()`，经 `scanner.OnCacheInvalidated` 级联同时清 instance 一侧（不必再反向 import go/instance 即不成环）；app 层配对仍**强制保留**作防御纵深——本卡 pitfalls 与 tests/test_sync_write_cache_pairing.ts 的派生闸都按「必须保留」口径
  - 人工枚举写清单 fail-open（清单漏列即隐身）——勿退回旧版；候选写面只从三包导出面自动派生
  - 缓存返回值是共享对象，消费方禁止写（loadSyncScanCache 契约）——向返回 map 写虚拟条目会跨调用串数据
use_when:
  - 缓存失效
  - 配对
  - InvalidateSyncItemsCache
  - InvalidateSyncScanCaches
  - write-surface-gate
  - hashed
  - 假同步状态
perf:
  - io-bound
---

# 同步缓存失效配对契约（go/sync × go/instance × 写面派生闸）

## 概览

整合包展示链叠了两层 30s TTL 派生缓存：**go/sync 扫盘结果缓存**（`sync_cache.go`，三类 kind）与 **go/instance 同步结果缓存**（`sync_items_cache.go`，`BuildSyncItems` 终态）。两层都靠「scanner 失效钩子自动联动 + 写入口显式清」双路保鲜。**2026-10-16（锐评 P0-①）清理责任已归并到 scanner 单漏斗**：go/sync 全部写操作（`sync_push.go` / `sync.go` / `sync_relink.go` / `conflict.go` 八处）内部 `defer scanner.InvalidateCache()`——`scanner.InvalidateCache` 清扫描缓存后经 `scanner.OnCacheInvalidated` 级联调用 `InvalidateSyncScanCaches` + `instance.InvalidateSyncItemsCache`，两侧一次清齐，go/sync 不必反向 import go/instance（即成环）即可清 instance 一侧。**internal/app 层每条写入口仍保留**成对调 `instance.InvalidateSyncItemsCache()` + `ysmsync.InvalidateSyncScanCaches()`（或等价的 `a.ClearScanCache()` 三层清）作防御纵深——本闸强制保留。包级总览见 [go-sync](./go-sync.md)，面板链消费见 [go-instance](./go-instance.md)。

## 核心职责

- `go/sync/sync_cache.go` — sync 扫盘缓存三类 kind：`resources`（`map[string]DiffEntry`）/ `dirlevel`（`map[string]dirLevelUnit`）/ `folder`（`map[string]string`），共用泛型模板 `loadSyncScanCache` / `storeSyncScanCache`；`InvalidateSyncScanCaches` 全量清空，经 `RegisterInvalidationHook` 挂 `scanner.OnCacheInvalidated` 自动联动
- `go/instance/sync_items_cache.go` — instance 结果缓存：类型化组件 `syncCache`（2026-09-14 锐评刀①从裸 `sync.Map` 收编），key = `buildSyncItemsKey` 的 xxhash 十六进制摘要（读 `ins.Name/VersionDir/subtype/filesRoots/rtypes`），`get` 命中返克隆件、惰性删过期条目
- **代际护栏（2026-10-16，锐评 P1-4）**：`storeSyncScanCache` 与 `syncCache.put/putAt` 都带 `epoch uint64` 参数——`InvalidateSyncScanCaches` / `syncCache.clear` 分别递增 `syncCacheEpoch` / `syncCache.epoch`，各 collect 入口在 load-miss 后立即捕获、写前比对；计算期间缓存被失效则丢弃陈旧结果，防「刚失效又被旧结果重新 Store」最坏 30s 读到旧数据（对齐 `scanner.cacheGen`）。因 `scanner.InvalidateCache` 与 `InvalidatePath` 都经 `notifyCacheInvalidated` 级联清全部派生缓存，单一 token 即可覆盖两类失效。回归锁：`TestSyncScanCache_StaleEpochRejected` / `TestSyncItemsCache_StaleEpochRejected`
- `tests/test_sync_write_cache_pairing.ts` + `scripts/_lib/write-surface-gate.ts` — 结构守卫：候选写面**从 go/sync + go/installer + go/importer 三包导出面自动派生**，app 层每个 `pkg.X(` 调用点三选一归宿，漏归类当场红

## 不变量（配对契约）

- **写入口配对铁律**：app 层每条写入口所在函数体必须含配对失效——七条 `ysmsync` 入口（`SyncCustomToRepo` / `PushResources` / `PullResources` / `PushSingleResource` / `PullSingleResource` / `SyncToggleStatus` / `ResolveConflicts`）显式两行配对，`relinkDir` helper 自持配对；installer 落地族（`Install`/`InstallDir`）与 importer 写族（`ImportByType`）由消费点（`InstallModelTo` / `InstallResourceToInstance` 三出口 / `app_import*`）defer 统一配对。审计史：第一轮七入口独漏 `ResolveConflicts`（冲突解决经 `fsutil.CopyFile` 改两侧文件却不清 instance 缓存 → 展示旧状态 ≤TTL）；第二轮扩面发现 `go/installer` 落地族全漏（watcher 只监听全局仓库根，实例目录写入无任何兜底）——正是导入侧注释明令反对的「赌前端记得清」
- **三选一归宿 + fail-closed 派生**：app 层调用点归宿 = ① 只读豁免表（`DetectConflicts` / `ListVersions` / `ResolutionStrategy` / `DetectContainerType*`——漏分类即红）∨ ② 所在函数体含失效签名 ∨ ③ 精确 `exemptSites`（文件+函数+调用名，带 reason；僵尸条目反查防烂尾）。旧版人工枚举 `SYNC_WRITE_OPS`/`INSTALLER_WRITE_OPS` 清单 fail-open（清单漏列一个写函数它根本不进扫描），2026-10-10 翻转为派生版；三方向变异坐实（漏分类/僵尸豁免/空转下限各即红）
- **接口方法值盲区**：`importer.Get(rtype)` 返回 Handler、经 `h.Import()` 落盘——枚正则抓不到 `h.Import(`。归类法：`importer.Get` 本身算**写**，其调用点所在函数必须有失效，间接覆盖 `ImportByType` 这条活路径（修复见 `app_import_invalidate_test.go`）
- **条件写须随口径复核**：`SyncResourcesWithConfig` 仅当 `config.ConflictPolicy` 非空才经 `handleSyncConflicts` 写盘；当前 app 层调用恒传 nil（纯读，走 `SyncResources` 薄壳），`exemptSites` 按「恒传 nil 纯读」精确豁免——**未来传非 nil 须移除豁免补配对**
- **sync 缓存内部口径**：
  - `hashed` 维度（D2′-a / ADR-269）：`resources` kind 键带 `hashed = scanFn != nil`，隔离「带哈希版 collect」与「Size-only 版 collect」——否则 nil 版先 populate 无哈希缓存，带 scanFn 入口命中它 → 内容级判定静默失效 30s；`dirlevel` kind 同款（ADR-344 D1，两条信道都带摘要故读写同槽），`folder` kind 恒 false。回归 `TestSyncResourcesWithConfig_HashDetectsContentChange`
  - **返回共享只读**：`loadSyncScanCache` 命中返回缓存内 map 引用，消费方禁止写入虚拟/临时条目（`sync_cache.go` 包级铁律）；确需修改先 clone
  - **完整 Walk 才入缓存**：`rootFailed`/`partialFail` 的残缺结果不入（残缺结果在 TTL 内当权威是新病）；`collectEntriesFromScan` 返回 nil（须走 Walk）时不缓存
  - **scan-hit 衍生 map 也复用缓存**（2026-09-14）：scan-hit 与 Walk 对称复用同一 `syncDirLevelScanCache`，消除 `BuildSyncItems` 周期内 8 个 MMD 子类型 × N 实例对同一仓库根反复 O(entries) 重算衍生 map；回归 `sync_dirlevel_scan_cache_test.go` 锁「二次同步 scanFn 调用不增长」
- **残余 IO（失效后首次重算，非缺陷）**：`containsModelSubfolder`/`isDirTypeModelFolder` 逐层 ReadDir 仍会发生（实例侧文件量远小于全局，非大头）；refresh 全量 `InvalidateScanCache` 会使 30s 缓存冷掉触发一次组根重扫（单次，非 8×(N+1) 遍）

## 与其他子系统关系

- TTL 单一事实源 = `scanner.EffectiveCacheTTL`（随 `AppConfig.ScanCacheTTLMs`），两层缓存都跟随
- 失效联动源头 = `scanner.OnCacheInvalidated`（[go-scanner](./go-scanner.md)）；两包各自的 `RegisterInvalidationHook` 由 app 层启动时显式调用（非包内 init 副作用）
- 写入口清单的完整逐条口径（哪些 defer、哪些显式两行）以 `tests/test_sync_write_cache_pairing.ts` 头注释 + 源码为准，本卡不复述清单（防漂移）

## 相关

- [go-sync](./go-sync.md) — 包级总览（「状态对比 IO 放大」枢纽摘要指向本卡）
- [go-instance](./go-instance.md) — BuildSyncItems 面板链消费
- [go-scanner](./go-scanner.md) — 30s 扫描缓存与失效钩子源头
- [go-installer](./go-installer.md) / [go-importer](./go-importer.md) — 落地族写面
