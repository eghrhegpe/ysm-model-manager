---
kind: go-sync-resource-diff
name: 资源/文件夹级同步 diff（go/sync 拆分）
tier: leaf
category: go
status: active
source_files:
  - go/sync/sync_resource.go
  - go/sync/sync_dirlevel_diff.go
  - go/sync/sync_dirlevel_sync.go
auto_fields:
  symbols_with_lines:
    - DiffFolderContents
    - DiffFolderContentsScan
    - FileDiffEntry
    - GetLinkType
    - ScanEntriesFn
    - SyncResources
    - SyncResourcesDirLevel
    - SyncResourcesDirLevelScan
    - SyncResourcesWithConfig
use_when:
  - SyncResources
  - SyncResourcesWithConfig
  - SyncResourcesDirLevel
  - DiffFolderContents
  - 折叠指纹 FoldDigest
  - 资源包文件夹
  - dirLevel 单元内容判定
  - 推送保层级
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - SyncResources / SyncResourcesWithConfig 资源级 diff
  - SyncResourcesDirLevel / DirLevelScan 文件夹级同步
  - DiffFolderContents / DiffFolderContentsScan 夹级内容判定
  - dirLevel 文件单元内容级判定与祖先键去重
quick_risk_lines:
  - 同步判定必须经 go/sync 的 diff+hash 双阶段，app 层禁手写同步逻辑
pitfalls:
  - pack 目录折叠指纹（D2′-b）累积须在 IsResourceAllowed 过滤之前——被过滤的纹理/mcmeta 子文件也要计入所属 pack 目录
  - 缓存只收完整 Walk 结果：rootFailed/partialFail 的残缺 entries 不入 30s 扫描缓存，否则残缺结果在 TTL 内当权威
  - resources kind 缓存键的 hashed 维度隔离「带哈希 collect」与「Size-only collect」，nil 版先 populate 会污染带 scanFn 版的内容级判定；dirlevel kind 同款（ADR-344 D1）
  - dirLevel 单元内容判定只在两侧原始相对路径相等时生效：跨格式（B.zip vs B.ysm）同身份键而比字节恒不相等，照比会造出「点了推送也不收敛」的假待推送
last_verified: 2026-10-14
---

# 资源/文件夹级同步 diff（go/sync 拆分）

## 概览

`go/sync` 资源级/文件夹级同步 diff 主流程的三个分片文件，系 2026-10 文件行数治理拆出：`sync_resource.go`（原 sync.go）持资源级 diff + 冲突处理 + 链接类型判定入口；`sync_dirlevel_sync.go` 与 `sync_dirlevel_diff.go`（原 sync_dirlevel.go）持文件夹级同步主流程与文件夹内容 diff。包级总览、推送/拉取执行循环与红线见 [go-sync](./go-sync.md)。三文件构成「入口 → 两侧收集 → 单点对比 → 冲突处理/内容级判定」，判定口径与 scanner 对齐（`.recycle` 排除、30s 目录扫描缓存、哈希优先 / Size 兜底）。

## 核心职责

- `sync_resource.go` — 资源级同步入口：
  - `SyncResources`（薄壳转发，scanFn=nil 恒无哈希回退 Size）/ `SyncResourcesWithConfig`（主入口）：`collectResourceEntries` 两侧收集 → `ResourceDiff` 单点对比 → `handleSyncConflicts` 冲突处理
  - `collectResourceEntries` + `walkEntryState` / `walkFn` / `handleDir`：全树 Walk 收集；资源包文件夹（含 `pack.mcmeta`）自身成条目但不递归（仅资源包类型或空 rtype 收集——P5 修复：原实现不分类型一律收集，蓝图仓库误放的资源包文件夹被当蓝图 missing「推送」）；pack 目录**结构折叠指纹**（`walkFoldState.addFile`：子文件 `fnv64a("<rel>:<size>")` 顺序无关之和 + 计数，Walk 结束回填该目录条目的 `DiffEntry.FoldDigest`，形如 `hex:count`）
  - `collectScanHashes` 旁挂 scanner 缓存哈希（以 `relKey(rootDir, e.Path)` 归一为键，与 entries 的 key 同源，规避 scanner 与裸 Walk 两套 path 字面不一致；nil → 空表 → 回退 Size）
  - `handleSyncConflicts` + `assertInstallLockHeld`：锁契约软断言（owner-tracked `HasLock()`，消除旧 TryLock 探测「他人 goroutine 持锁被误判为已持」的误判窗口）；持锁走 `*Locked` 变体（重入自锁会 self-deadlock），未持锁走自锁公开入口（不裸奔无锁并发写目录），断言失败仅记日志不 panic（fail-soft，分段持锁场景下 panic 设计已废弃）
  - `GetLinkType`（Lstat 判符号链接；Windows 硬链接统一走 `fsutil.IsHardLink`）、`isFileLocked`（errno 按 GOOS 分支：Windows 32/33，Unix EBUSY；`errors.Is` 链式穿透包装，禁文本匹配错误分类）、`hasRecycleSegment`（逐段 EqualFold 判 `.recycle`，不误伤文件名含该串的正常模型）
- `sync_dirlevel_sync.go` — 文件夹级同步主流程：
  - `SyncResourcesDirLevel`（Walk 版，行为不变供测试/旧调用）/ `SyncResourcesDirLevelScan`（注入 scanFn 复用扫描缓存）→ `syncResourcesDirLevel`：collectEntries（sync 缓存 → scanFn 反推 → Walk 回退叠缓存，两者都产出带 `Size/Hash` 的 `map[string]dirLevelUnit`）→ `dirLevelResult`（归成 `map[string]DiffEntry` 后委托 `ResourceDiff`，relKeyDirLevel key 保留完整目录层级）→ synced/missing/extra 三列表排序（ADR-344 D1 换掉原先的「键存在即 Synced」手写判定）
  - `dirLevelDiffEntries` / `dirLevelRel` / `dirLevelHashByPath`：单元 → `DiffEntry` 投影（跨格式清内容字段）、原始相对路径（保留扩展名/禁用后缀，专用于格式同一性）、scanner 摘要按绝对路径索引（供 Walk 回退信道旁挂）
  - `collectEntriesWalk`（语义权威基准：平铺模型文件任意深度收集；叶子模型夹 SkipDir 整体收编；容器夹——既含平铺模型文件又含子模型夹——下钻保留层级并注册自身目录 marker 键；`nestedDirMemo` 消除 `patternFind` 重复子树扫描）；`collectEntriesWalkCached`（完整 Walk 才入缓存）；collect 族额外返回**键碰撞清单**（同键不同 Rel 的 last-write-wins 覆盖事件，`upsertDirLevelUnit` 单点记录，2026-10-14 fail-loud）
  - `collectEntriesFromScan` 从 scanner 已扫描的扁平文件列表反推目录级同步条目（仅「无嵌套模式」类型 MMD/YSM 可精确重建；含嵌套模式如 maid-model 返回 nil 回退 Walk；`directChildModelDirs` 反向索引使父目录查询 O(1)；单元直接带 `e.Size` / `e.Hash`）
- `sync_dirlevel_diff.go` — 文件夹内容 diff：
  - `diffFolderContentsCore` 两侧文件映射 → `[]FileDiffEntry`（synced/missing/optional/diverged）：两侧均命中哈希比哈希（异哈希 → Diverged，消除「改内容不改大小」假绿，D2′-c），任一侧缺哈希回退比 Size；nil,nil 退化为纯 Size 对比
  - `DiffFolderContents`（Walk 版，无 scanFn 公共入口）/ `DiffFolderContentsScan`（scanner 反推版：全局侧从组根全量条目按 folder 前缀过滤——零 Walk；实例侧优先 scanFn 单夹扫描取哈希，未命中回退 `collectFolderFiles` Walk）
  - `collectFolderFiles`（Walk 收集模型文件 + 30s 缓存）/ `collectFolderFilesFromScan`（scan 反推，第二返回值旁挂 relKey→哈希）

## 对外 API / 入口

- `SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult` — 资源级 diff（空 rtype = 旧行为兼容，逻辑等价资源包类型）。返回值自 ADR-340-d2 起多一维 `Diverged`（⊂ `Missing`：两侧同键而内容不同）——`Missing` 归属**刻意不变**（仍是并集，旧消费者零影响）
- `SyncResourcesWithConfig(..., config *types.SyncConfig, scanFn ScanFunc, rtype ...)` — 带冲突策略 + 内容级哈希的完整入口；生产注入方 = `internal/app.App.SyncResources`（CLI/推送门禁链，注 `a.scanModelEntries`）与 `go/instance|processOneResourceType` fileLevel 分支（面板链，注 `scanner.ScanEntries`，2026-10-15 补齐，两路同强度判定）
- `SyncResourcesDirLevel(globalDir, instanceDir, rtype string)` / `SyncResourcesDirLevelScan(..., scanFn ScanEntriesFn)` — 文件夹级同步；Scan 版消除 8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树的重复 Walk（scanner 30s TTL + single-flight 之下实际只走盘一次）。单元带内容字段（ADR-344 D1）：文件单元按同格式哈希/Size 判待推送，目录单元存在性判
- `DiffFolderContents` / `DiffFolderContentsScan` — 文件夹级同步单元内的子文件级内容 diff（前端子文件列表全量展示，差异判定按 Status 区分）
- `GetLinkType` / `isFileLocked` / `hasRecycleSegment` — 链接类型判定与错误分类辅助（入口文档以 [go-sync](./go-sync.md) 为准）

## 与其他子系统关系

- 调用方：`internal/app/app_install.go`（同步/推送/拉取/实例状态面板链）、`go/instance`（BuildSyncItems 消费夹级 diff 做父夹聚合，[go-instance](./go-instance.md)）
- 依赖：`go/fsutil`（`IsRecycleDir` / `IsResourcePackFolder` / `IsHardLink`）、`go/types` + `go/types/registry`（`IsResourceAllowed` / `NestedPatternsFor`）、`go/packs`（`IsTypeModelFile`）、`go/installer`（冲突解决的 `InstallLock` 锁契约与 `*Locked` 变体，[go-installer](./go-installer.md)）
- 缓存基础设施在 `sync_cache.go`（[go-sync](./go-sync.md) 认领）：`syncResourcesScanCache` / `syncDirLevelScanCache` / `syncFolderScanCache` 共用 `loadSyncScanCache` / `storeSyncScanCache` 泛型模板；缓存返回值共享只读，消费方禁写

## 不变量

- pack 目录折叠指纹（D2′-b）：累积须在 `IsResourceAllowed` 过滤**之前**——被过滤掉的纹理/mcmeta 子文件正是盲区②的载荷，也要计入所属 pack 目录指纹；零新 I/O（`os.FileInfo` 是目录枚举本就产出的），`scanFn=nil` 的 UI 路径同样生效；对比时两侧 `FoldDigest` 均非空才比指纹，任一侧空回退恒一致（不回归）
- 缓存准入双守卫：`rootFailed` / `partialFail`（Walk 中途子树读失败/目录消失）的残缺结果**不入** 30s 扫描缓存——根目录存在 ≠ 子树扫完整；`collectEntriesFromScan` 返回 nil（须走 Walk）时同样不缓存，否则会把「须走 Walk」误判为命中而永久跳过 Walk
- `resources` kind 缓存键的 `hashed` 维度（D2′-a）：`{kind,root,rtype,hashed}`，`hashed = scanFn != nil`——隔离「带哈希版 collect」与「Size-only 版 collect」两种结果，否则 nil 版先 populate 缓存后，带 scanFn 入口命中它会让内容级判定静默失效 30s；`dirlevel` kind 同款（ADR-344 D1 起 `hashed = scanFn != nil`，两条信道都带摘要故读写信道同槽），`folder` kind 恒 false
- **dirLevel 单元判定两层**（ADR-344 D1/D2）：文件单元比内容（`dirLevelDiffEntries` 填 Size/Hash/Oversize → 判定表 `ContentVerdict`（verdict.go，ADR-347）哈希优先 / 无哈希 Size 兜底 / 任一侧超限保守判 Missing）；目录单元**不**比内容——scan 条目只含受支持扩展名的模型文件，目录折叠指纹无从累积，只在 Walk 侧加指纹会让两条信道劈裂（违反推等价契约），故目录单元保持存在性语义、夹内分叉由展开层（`diffFolderContentsCore`）承担。内容字段仅在两侧**原始相对路径相等**时填（`dirLevelRel` 不剥扩展名/禁用后缀）：跨格式同身份键比字节恒不相等，照比会造出永不收敛的假待推送
- `collectEntriesFromScan` 与 `collectEntriesWalk` 必须语义等价（回归测试 `sync_dirlevel_scan_test.go` 锁定逐夹对比，比较前抹掉 scan 侧独有的 `Hash` 旁挂字段）；含嵌套模式类型不可反推，调用方须先判 `NestedPatternsFor` 为空。**碰撞清单不参与等价比较**（诊断输出，非单元表内容），但两信道碰撞记录口径必须一致（回归锁 `sync_dirlevel_collision_test.go`：Walk / scan 各一例 + 零碰撞负例）；碰撞经 `syncResourcesDirLevel` 汇入 `ResourceSyncResult.Warnings`（omitempty 诊断信道；**缓存命中同样返回**——2026-10-15 清单随 `dirLevelCacheValue` 与单元表同存，跨 30s TTL 稳定，回归 `TestSyncResultsDirLevelScan_CacheHitCarriesCollisions`）
- `diffFolderContentsCore` 判定口径：委托判定表单点 `ContentVerdict`（verdict.go，ADR-347；原 contentStatus 内联实现与 sync_diff.go|contentDiffers 是**同义两份散落**——加新信道要人肉核对每份、漏一份即静默判定退化，P3 收敛为单点）：哈希优先、Size 兜底与 `ResourceDiff` 同口径；两侧无哈希（Walk 版 `DiffFolderContents`）时 Size 相等即 Synced，与旧「存在即 Synced」相比收紧了大小口径但无回归。信道元数据边界：夹内文件信道不设 Oversize/FoldDigest（collect 不置位）→ 判定表如实降级 hash/size 腿
- `.recycle` 排除与 scanner 对齐：Walk 侧 `SkipDir`（带 `path != rootDir` 守卫），scan 反推侧 `IsRecycleDir(filepath.Dir(p))` 逐文件剔除（回收站目录内文件跳过，与 Walk 的 SkipDir 对齐）
- **`.relink-bak-*` 备份尸体同样要排除，且必须**双通道**都排**（ADR-342 D4）：Walk 侧 `SkipDir`（`collectEntriesWalk` / `handleDir` / `collectFolderFiles`），scan 反推侧逐条 `isRelinkBackupPath` 剔除（`collectEntriesFromScan` / `collectFolderFilesFromScan`）——生产链走 scanner 命中，只修 Walk 通道等于没修；不豁免则恢复点被判「实例独有（可拉取）」，一键拉取把整个恢复点复制进仓库（回归测试 `sync_corpse_exempt_test.go` 四条通道各一例）
- 容器夹下钻时注册自身键（目录 marker）——与对侧（pre-fix 安装）同名叶子目录键集一致，避免键集不相交产生幻影 Missing+Extra；marker 的展示层合并（`absorbSelfMarker`）归 `go/instance`

## 相关

- [go-sync](./go-sync.md) — 包级总览：推送/拉取/重链接/实例发现、已知限制与待治理清单（单一事实源）
- [go-instance](./go-instance.md) — 面板链 BuildSyncItems 消费与夹级聚合
- [go-scanner](./go-scanner.md) — 30s 扫描缓存 + 哈希旁挂的源头与失效联动
- [fe-go-boundary](./fe-go-boundary.md) — 同步判定归 Go、前端只读不判的边界口径
