# R27 审核：go/sync + go/dedup（两模块并行）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 2 explore 子代理｜状态：⏳ 修复闭环中
> 前置：R19 watcher / R20 avatar / R21 dedup / R22 app_workshop / R23 app_install / R24 go/recycle / R25 go/installer / R26 installer+recycle+download

## 范围与岔开依据

**审核**（两模块并行，single 深度，只读）：

| 模块 | 非测试文件 | 规模 | 前置审核 |
|---|---|---|---|
| sync | 9 个（sync.go/sync_dirlevel.go/sync_push.go/conflict.go/sync_relink.go/sync_discovery.go/sync_cache.go/sync_hash.go/sync_diff.go） | 2528 行 | 无 R 级系统审核 |
| dedup | 2 个（dedup.go/strategy.go） | 383 行 | R21（删闲置 CleanEmptyDirs、入口收敛） |

**岔开**：R26 完结 installer/recycle/download 三模块。sync 包复用 installer.InstallLock 共享单锁（ADR-056），与 R25/R26 审过的 installer 耦合紧密，自然延伸。dedup 包 R21 审过但本次复核 R21 修复后的残留风险。两包同属「同步/去重」域，一次性过。

## 总体结论：通过（4 项 P2 + 5 项 P3 + 7 项 P4）

两包代码质量较高：sync 的锁契约、原子写、路径穿越防御都有显式处理和注释；dedup 的并发管道（idx 槽位零竞争）、size 预分组零语义损失、sentinel 错误分类均有测试锁定。残留风险集中在 **conflict 检测的 hash 失败静默漏报**、**relink 备份覆盖恢复点**、**不完整 Walk 结果入缓存**（3 处同型）三类。

## 发现项汇总

| 模块 | P2 | P3 | P4 | deep 复审 |
|---|---|---|---|---|
| sync | 4 | 5 | 4 | 是（conflict.go + sync_relink.go 错误恢复路径完整性） |
| dedup | 0 | 3 | 3 | 是（P2-1 WalkDir 错误吞掉致假绿） |
| **合计** | **4** | **8** | **7** | — |

## sync 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | conflict.go:238-242 | `collectFileEntries` 中 `computeFileHash` 失败时 `hash` 为空但仍记录条目，`DetectConflicts` 的冲突判定 `localInfo.Hash != remoteInfo.Hash && localInfo.Hash != "" && remoteInfo.Hash != ""` 在 hash 空时跳过——**哈希失败的真实冲突文件被静默漏报** | hash 失败的条目应标记为「需手动审查」或至少不与正常条目混在同一无 hash 池里 |
| P2-2 | conflict.go:147-153 | `ResolveForceRemote` 分支：`fsutil.CopyFile(remotePath, localPath)` 失败后做 `fsutil.CopyFile(backupPath, localPath)` 恢复，但此时 `localPath` 可能已被 CopyFile 的 tmp+rename 中间步骤损坏，恢复备份的 CopyFile 本身也可能失败，错误被 `_ =` 吞掉——**原文件与备份同时丢失风险** | 恢复失败时返回带备份路径的 error，让调用方知悉恢复点位置 |
| P2-3 | sync.go:468 vs sync_push.go:32-33 | `SyncResourcesWithConfig` 在 config != nil 且有冲突时调用 `ResolveConflictsLocked`（约定调用方持锁）。注释说「config 恒为 nil 走不到此处」，但 `SyncResourcesWithConfig` 是公开函数，外部可直接传入 config + 不持锁调用，触发 `ResolveConflictsLocked` 在无锁状态运行——**注释与代码的锁契约依赖隐式调用链，易被后续改动打破** | `ResolveConflictsLocked` 内部加 `assertLocked` 或在文档中明确标注前置条件为硬约束 |
| P2-4 | sync_relink.go:113-114 | `backup := dstParent + ".relink-bak"; _ = os.RemoveAll(backup)` 在 Rename 前**无条件删除已有 .relink-bak**。若上一次 relink 失败留有备份目录，本次 RemoveAll 删掉的是上次失败的数据恢复点——**并发或残留场景下恢复点丢失** | 备份名带时间戳（与 conflict.go:143 的 `.bak-<ts>` 口径对齐），或检测已存在时 abort |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | sync.go:295 | `SyncToggleStatus` 在 Walk 回调中对每个文件调 `computeHash(p)`，大仓库下**逐文件同步计算 SHA256**，且持 InstallLock 全程——长时间持锁阻塞安装 | 哈希计算移到锁外预处理阶段，或对 >阈值大文件跳过哈希走 relKey 匹配 |
| P3-2 | sync_cache.go:98-103 + sync.go:457 | `storeSyncScanCache` 在 `collect` 返回 entries 后无条件存储（仅 rootFailed 时跳过）。但 `filepath.Walk` 的错误回调只 `log.Printf` 后 `return nil`——**Walk 部分子树失败时仍缓存不完整结果**，30s TTL 内后续调用拿到残缺 entries | Walk 出现非根错误时设 `partialFail=true`，失败结果不入缓存 |
| P3-3 | sync_dirlevel.go:489-499 | `collectEntriesWalkCached` 在 `os.Stat(rootDir)` 成功时缓存结果，但 `collectEntriesWalk` 内部 Walk 错误同样被 `log.Printf` 吞掉——与 P3-2 同型问题，**不完整 Walk 结果被缓存 30s** | 同 P3-2 |
| P3-4 | sync.go:317-322 | `SyncToggleStatus` 禁用分支：`newPath := p + types.DisableSuffixes[0]`，硬编码取数组第一个后缀。若 `DisableSuffixes` 有多个值（`.disabled`/`.ban`），只永远加第一个——**用户用 `.ban` 禁用的文件，toggle 后变成 `.disabled`，原 `.ban` 文件的禁用语义丢失** | 禁用时保留文件已有的禁用后缀类型，或明确文档化「统一收敛到第一个后缀」 |
| P3-5 | sync_push.go:289-290 | `SyncCustomToRepo` 的 `repoNames` 以 `e.Name`（basename）去重，但 `srcEntries` 的 `e.Name` 可能含子目录前缀——**同名不同子目录的文件被误判为重复而跳过** | 去重 key 改为 relKey（相对路径），与 `SyncResources` 口径对齐 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | sync.go:371-380 | `isMcmetaDetectorType` 函数定义前有一大段注释描述 `SyncResources` 的行为和 P3 修复历史，**注释归属与函数不匹配** | 注释移到 `SyncResourcesWithConfig` 上方，或拆分为独立 doc block |
| P4-2 | sync_dirlevel.go:23-28 | 文件头注释列出「已知限制」：同级目录 `模型包/` 与文件 `模型包.zip` 的 key 冲突导致静默丢失。这是**已确认的 P3 数据丢失 bug 被标注为「待治理」留在注释里** | 创建 issue 并在注释中引用 issue 号 |
| P4-3 | sync_hash.go:43 | `collect` 闭包内 `key := relKey(root, e.Path)` 用 `e.Path`（绝对路径）做 relKey，但 `ResourceDiff` 的 `DiffEntry.Path` 存的也是绝对路径——**key 是相对路径、value.Path 是绝对路径**，混用语义在 `CompareGlobalInstanceHashes` 的跨实例循环中容易让后续维护者困惑 | 在 DiffEntry 中增加 `RelKey` 字段显式区分 |
| P4-4 | sync.go:262-265 | `renameOp` 结构体定义在 `SyncToggleStatus` 函数体中间（L262），紧跟在阶段 1 注释后——**局部类型定义位置反直觉** | 移到函数开头或提升为包级私有类型 |

## dedup 发现项

### P2（正确性）

无。R21 已修删闲置 CleanEmptyDirs、入口收敛，本次复核未发现新 P2。

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | dedup.go:136 | 无缓冲 channel `jobs` 在 worker panic 时会死锁。`jobs := make(chan fileInfo)` 是无缓冲的，主 goroutine 在 `jobs <- f` 处阻塞发送。若 worker goroutine panic，`wg` 永不 Done、`close(jobs)` 永不执行，主 goroutine 死锁 | worker 内 `recover()` 并标记失败槽位，或用 buffered channel + `runtime.GOMAXPROCS` 容量降低阻塞窗口 |
| P3-2 | dedup.go:152-156 | size 预分组在并行管道中对「读失败」的可见性不对称。唯一 size 文件不进 job（有意跳过哈希、不记日志），而同 size 文件读失败会 `log-and-skip`。但如果一个 size 恰好唯一的文件**因为读失败而本应被标注**，它会被静默归入「唯一 size 跳过」类别而非「读失败」——两种跳过原因不可区分 | 在 `hashFilesParallel` 注释中显式记录此不对称是已知取舍 |
| P3-3 | strategy.go:51-63 | `QuickHash` 使用 MD5 存在构造性碰撞风险。去重结果直接驱动 `recycle.Move`（删除文件），MD5 碰撞虽概率极低但非零，且对抗场景下可构造。`NameSizeHash` 已标注「不精确」，但 `QuickHash` 注释仅说「速度较快，适合大文件」未警告碰撞风险 | 在 `QuickHash` 文档注释中显式标注「MD5 非抗碰撞，不适用于对抗环境」；或对 QuickHash 组增加二次 size 校验（已隐含但未显式） |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | dedup.go:61-63 | `computeHash` 注入变量注释提到 `dedup_parallel_test.go` 但未提及 `strategy.go` 的 `HashAlgorithm` 签名演进。注释解释了恢复注入点的原因，但未注明 `algo` 参数是 `HashAlgorithm` 接口实例 | 注释补「`algo` 为 `HashAlgorithm` 接口实例，见 strategy.go」 |
| P4-2 | strategy.go:92 | switch 的 `"deep_hash", "hash", ""` fallthrough 到 default 分支命名歧义。`"hash"` 和 `""` 都映射到 `DeepHash`，但 `DedupConfig.Strategy` 的合法值文档（`types/config.go:85`）仅列 `"hash"` 和 `"name_size"`，未提及 `"deep_hash"` 和 `"quick_hash"`——**配置枚举与策略工厂的映射关系分散在两处且不完全对齐** | 在 `types/config.go` 的 `DedupConfig.Strategy` 注释中补全所有合法值，与 `NewHashAlgorithm` 的 switch 对齐 |
| P4-3 | dedup.go:208-209 | 注释「使用 map 保持插入顺序」表述误导。插入顺序由 `orderedKeys []string` 切片保持，`hashGroups map[string]*Group` 仅做查找；注释将「map」与「保持插入顺序」关联易误读为 Go map 有序 | 改为「`orderedKeys` 切片保持首次出现序，`hashGroups` map 仅做 O(1) 查找」 |

## 修复状态注记（2026-08-31 闭环进行中）

| 级别 | 位置 | 状态 |
|---|---|---|
| sync P2-1 (hash 失败静默漏报) | conflict.go:238-242 | ⏳ 待修 |
| sync P2-2 (ResolveForceRemote 恢复失败吞错) | conflict.go:147-153 | ⏳ 待修 |
| sync P2-3 (ResolveConflictsLocked 锁契约) | sync.go:468 | ⏳ 待修 |
| sync P2-4 (relink 备份覆盖恢复点) | sync_relink.go:113-114 | ⏳ 待修 |
| sync P3-1 (SyncToggleStatus 逐文件哈希持锁) | sync.go:295 | ⏳ 待修 |
| sync P3-2 (不完整 Walk 结果入缓存) | sync_cache.go:98-103 | ⏳ 待修 |
| sync P3-3 (collectEntriesWalkCached 同型) | sync_dirlevel.go:489-499 | ⏳ 待修 |
| sync P3-4 (SyncToggleStatus 硬编码禁用后缀) | sync.go:317-322 | ⏳ 待修 |
| sync P3-5 (SyncCustomToRepo 去重 key) | sync_push.go:289-290 | ⏳ 待修 |
| sync P4-1~P4-4 | 多处 | ⏳ 待修 |
| dedup P3-1 (worker panic 死锁) | dedup.go:136 | ⏳ 待修 |
| dedup P3-2 (size 预分组读失败可见性) | dedup.go:152-156 | ⏳ 待修 |
| dedup P3-3 (QuickHash MD5 碰撞风险) | strategy.go:51-63 | ⏳ 待修 |
| dedup P4-1~P4-3 | 多处 | ⏳ 待修 |
