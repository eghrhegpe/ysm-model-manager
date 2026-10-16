# ADR-352：两阶段扫描投影二段：持久浏览索引（稳态重扫 O(1)）

- **状态**：✅ 已采纳（2026-10-16 已落地——双子代理审查通过后实现；实现期修订一处：⑤ cap 按根分档（watched 根 15min / 未装配根回落 `scanTTL()`），见 ⑤ 与「后果」节，其余与批准稿一致）
- **日期**：2026-10-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：扫描数据管线方向性决策：稳态重扫从 O(walk 全树) 降为 O(1) 服务，落盘点文件副作用难逆转，树/搜索/watcher 跨域消费
- **相关**：ADR-348（B1 持久哈希索引，本 ADR 的表结构与原子写先例）、ADR-343（跨类型检索扩展位，本 ADR 的铺路项）、`go/scanner/hashindex.go`、`go/scanner/scanner_browse.go`、`internal/app/app_scan.go`、`go/watcher/watcher.go`

---

## 1. 背景（Context）

模型仓库锐评 2026-10-16 的 P0 病灶 = 「文件系统即数据库，无持久元数据层，止血全是加缓存」。P1 属实项已收口（搜索/头像链切无哈希入口 + 派生闸，见 1a6292093/7a7f36d02），剩余处方 ②「hashindex 升级持久投影」即本 ADR。

当前成本结构：浏览投影 walk = 逐目录 ReadDir + 逐文件 Lstat + 条目构造（哈希面已由 B1 持久索引剥离）。`scanCache`/`browseCache` 均为默认 30s（`ScanCacheTTLMs` 可配置）纯进程内缓存——**TTL 过期或重启后每次重扫都重新付整棵 walk**。稳态（无变更、仅 TTL 自然过期）下重扫是纯冗余：树/搜索在用户无操作时周期性白走全库。

既成安全面（索引可被信任的前提）：
- 应用侧写全部经 800ms 防抖 syncAll 漏斗，写操作改走 scanner 单漏斗清缓存的配对闸（`test_sync_write_cache_pairing.ts` 强制）；
- watcher 递归覆盖 **YSM 仓库根（`GetRepoRoot("ysm")`；桌面默认布局为 FilesRoot 子目录，`CustomRoots["ysm"]` 覆写时可在 FilesRoot 之外）**（Windows ReadDirectoryChangesW 无 watch 上限），会话内该根的外部变更命中 onChange 链；
- 离线窗口（跨重启）的外部变更不可检测——**重启后首次 walk 即信任收敛点**。

## 2. 决策（Decision）

**两段式扫描投影的浏览段**（与 B1 哈希段互补、同表结构先例）：

① `go/scanner/scanindex.go`（新文件，骨架照抄 `hashindex.go`——**不照抄其首行 `//go:build !rust_backend`**：ADR-324 已删 Rust 后端，该 tag 为死 tag，新文件带上等于为已不存在的构建变体埋静默排除雷）。每注册扫描根一份 `<root>/.ysm-scan-index.json`（`path → {name, size, mtime:int64 UnixMilli}`）。`name` 记 walk 期算得的显示名——ysm.json 组「父目录名」口径在记录期固化，serve 时零重推。**serve 重建 `types.ModelEntry` 的字段口径**：`Ext = strings.ToLower(filepath.Ext(stripDisableSuffix(path)))`（与 processScanDirEntry 逐字同口径：先剥禁用后缀再取小写扩展名——`x.ysm.disabled` 条目重推为 `".ysm"`，不得固为禁用后缀）；`SubDir` 不填（walk 层已停填，测试锁定）；Hash 恒空（浏览口径）；HasTags/Type/Banned 仍由 app 层 finalize 统一填充（Banned 纯字符串判定零 I/O，不破坏 O(1)），索引不越层。原子写 `fsutil.WriteFileAtomic` + 坏表空载自愈（先例同 B1）。

② 根注册：导出 `SetIndexRoots(dirs []string)`。注册清单 = `a.allAllowedRoots()`（`internal/app/app_scan.go`，含派生根 `GetRepoRoot("ysm")`）的非空项；**重注册面 = ServiceStartup / restartWatcher / `SetResourceRoot` / `ResetResourceRoot`**（两处 CustomRoots 写入口已走 saveConfig——其中 Clear allAllowedRoots 缓存，重注册处直接再调 `SetIndexRoots(a.allAllowedRoots())`；CustomRoots 变更不重启 watcher 属**继承的既有面，本刀不扩大**）。**注册键归一化**：每个根过同一 `normalizeScanKey` 存键，与快路径请求键字节级一致（配置根原始串写法差异不得让快路径静默 miss）。重注册时 Range+Delete 已出注册集的表实例（不驻留积累）。scanner 保持纯包不持业务根清单。**索引文件只对注册根写盘；快路径键 = 归一化请求目录精确等于注册根 key 才查表**，子目录浏览不查表（行为不变：walk + 30s 缓存）；后续「根表前缀服务子目录」单独立项，不混入本刀。

③ 维护：browse walk 成功收尾（owner 身份、根级 `!walkFailed`、**且本次 walk 条目级错误计数为 0**）→ upsert 本次路径集 + prune 消失路径 + dirty 门控 Save（口径全同 hashindex）。**条目级错误计数器**：`atomic.Int64`（walk 回调在 NumCPU worker 池并发执行，与同处 `walkFailed atomic.Bool`/`entriesMu` 同范式）；**计数口径 = 两类——非根 ReadDir 回调 err + `d.Info()` 失败**（后者现被 processScanDirEntry 吞错跳过，须给该函数增一个可观测出口——计数器入参；该函数为全量/浏览共签，**全量路径行为不变**）。非根目录/文件错误现仅 `emitScanError` 后继续遍历、`walkFailed` 只感知根级失败——部分失败的路径集做 prune 会误删磁盘真实条目，故计数 >0 即跳过 prune/Save/信任锚点刷新，「失败结果不得当成功固化」红线从根级扩到条目级。**信任快照在 walk 启动前捕获 `(cacheGen, keyVersions[root])`**；walk 收尾复核，**任一推进则放弃本次 upsert+prune+Save**（变更前后混合的 walk 结果不得固化入表，镜像 `tryStoreBrowseCache` 版本守卫），亦不刷新信任锚点。**信任态（trusted 位 + 代际快照）是进程内语义，不得跨重启采信**：表文件落盘只存 records（trustedAt 可留作诊断）；load 时内存 trusted 强制 false，快照在本进程首次零错误 walk 时重锚——否则新进程活体 `(cacheGen=0, kv=0)` 撞旧进程持久化的 `(0,0)+trusted` 会免 walk serve 陈旧索引。

④ 快路径：`ScanEntriesBrowseWithHit` 缓存 miss 后、**单飞 owner 分支内（赢得 owner 后、walk 前）查本根索引表**，判定
`trusted && cacheGen == 内存快照 && keyVersions[root] == 内存快照 && now - trustedAt < indexTrustCap`
→ 按 ① 字段口径重建 `[]types.ModelEntry`，结果写入 `fl.entries`——waiter 经既有航班机制取同一结果（hit=true，不重复重建），`indexServes` 仅 owner 计 1；结果**经既有 `tryStoreBrowseCache` 版本守卫回存** browseCache 刷 TTL（不新增裸 Store 路径；check→store 间插失效时守卫失配不 Store，自愈不绕路），下游统一。
**去信任零新增代码**：`InvalidateCache` 推 cacheGen、`InvalidatePath` 推自身+子孙+祖先的 keyVersions（先例代数守卫），快照失配即自动阻断——复用既有失效面，不引新失效 API。**根级 walk 失败不清除既有 trusted 位**：末次良好表继续服务至 cap（静默降级面——根持续失败时 UI 显示陈旧模型而非每请求付失败 walk，与今日 30s TTL 失败循环体感不同；诊断面经 scanErrorDedup/OpLog 可见，裁定保留良好表）。

⑤ 信任时限（**cap 按根分档——实现细化**）：包级常量 `indexTrustCap = 15 * time.Minute`（锚点 = 最近一次**零错误** walk 成功，成功 serve 不重锚——超窗即重走并刷新锚点，形成健康周期）；**根是否有 watcher 事件源决定其 cap 档**——`watcher.New` 只装配 YSM 存储根 + mcRoot（`internal/app/app.go` ServiceStartup / `restartWatcher` 单漏斗），其余注册根（类型存储根 / CustomRoots 自定义根 / Android / watcher 故障场景）无任何失效事件源：全局 15min 会把这些根的外部变更探测从今日 30s TTL 周期恶化 30 倍。裁定两档——**被 watcher 装配标记（`MarkIndexRootWatched`，仅 watcher 装配成功时标；Start 失败不标）的根 cap = `indexTrustCap`（15min，把 inotify 上限/Android 漏报等事件盲点的最坏陈旧上限压至 30× 系数）**；**未标记的根 cap = `scanTTL()`（与今日 TTL 过期重走同周期，零回归；索引表对这些根仅贡献持久化面 + 会话内免走）**。watched 标记为内存态（重启后由 app 层按 watcher 装配实况重标，不落盘）。数值为经验值，B1 式基准数据到手后可调（本刀不加配置项，同 B1 的「索引 GC 上限」推迟裁定）。

⑥ **watcher 配对补丁（一行）**：`internal/app/app.go|emitRepoFsChanged` 追加 `a.InvalidateScanPath(a.ysmRoot())`——失效 **watcher 实际监视的 YSM 根**（`app.go` ServiceStartup 装配实参 `ysmRoot := a.GetRepoRoot("ysm")`；`restartWatcher` 形参名 filesRoot 是历史误称，**勿按形参名取 `config.Get().FilesRoot`**——CustomRoots 覆写时二者无互前缀关系，按 FilesRoot 失效会漏掉被监视根的索引去信任）。祖先推进自动覆盖 FilesRoot 级索引（若注册）；补丁行置于 `a.app == nil` 守卫**之外**（失效语义不依赖 Wails，CLI/测试直构 `&App{}` 亦应生效）。病灶：syncAll 的 clearCacheFn 仅在 instances 非空时执行（ListVersions 空即 early-return）——instances 空时外部变更今日仅 onChange 刷 UI，browseCache 陈旧最多 30s；索引快路径下该盲点会从 30s 放大到信任窗。补该失效后：browseCache 条目删除 + 索引去信任，下一次 ForBrowse 立即重走——**比今日更快**，且与配对闸「写必清缓存」同方向（失效是幂等清除，非写操作，闸不涉）。**行为变更注记**：`InvalidateScanPath` 会触发 `notifyCacheInvalidated` 派生钩子（go/instance、go/sync 派生缓存注册，ADR-064/065）——今日 instances 空场景（early-return）这些钩子不跑，补丁后每 800ms 防抖批次都会跑；钩子清除幂等、该场景下缓存本就空，无害，记录在案。频率 = 每 800ms 防抖批次一次（批次末触发）；单次成本 = 纯内存（祖先 O(depth) + keyVersions 已知 key Range，零磁盘 I/O）；幂等 = 版本单调递增，重放无害。

⑦ 观测：`indexServes` / `indexWalks` 包级计数（Snapshot/Reset，同 walkCount 范式），CLI benchmark 可测稳态免走率。**既有 B1–B3 每迭代清缓存（cacheGen 推进 → 索引去信任 → 必走 walk），冷口径不变；B2（浏览投影）计时自此含索引维护成本（upsert+prune+门控 Save+快照复核），合入后重采 ADR-262 基线**。

**不做**（本刀边界）：
- 跨类型全局检索（处方 ③，FE 面需产品决策；ADR-343 的 rtype 扩展位留给它——本刀只铺索引地基，索引表结构已支持后续「按根合并免 walk 检索」）；
- watcher 事件级增量 upsert（变更不落 walk、直接 upsert 索引 = P0 病灶完全形态，事件完整性/原子性口径需独立刀，且依赖 ⑥ 的配对先行）;
- 索引文件 GC 上限 / 多机共享（照 B1 遗留清单原样推迟）。

## 3. 后果（Consequences）

**正面**：
- **请求路径稳态免走**：无变更期每次 ForBrowse 为 O(1) 服务；被 watcher 装配的根每 15 分钟至多一次健康 walk（刷新锚点与索引），未装配根与今日 30s TTL 周期同频（cap = `scanTTL()`，零回归）——对比今日 TTL 周期重走，watched 根 30× 改善；树/搜索面经 `ScanModelEntriesForBrowse` seam 自动继承；
- 重启基线不变差（信任态进程内——load 强制 trusted=false、本进程首次零错误 walk 才锚定，离线窗口变更由首走收敛，与 §1 叙事一致）；哈希面归 B1 管，本刀零耦合；
- instances 空的外部变更面：今日「最多 30s 陈旧」→ 下次 ForBrowse 即重走（更快）；
- 后续项铺路：跨类型全局检索 = 按根合并索引表（免 walk）；watcher 增量 upsert = 事件直写表（免 walk），同结构可叠。

**负面 / 已知遗留**：
- 每注册根仓库目录 +1 点文件 `.ysm-scan-index.json`（repo-audit .json 桶 +1，可忽略；可移植口径同 B1——随仓库目录走）；跨进程双实例同根写：末写者胜，与 B1 哈希索引同风险类（原子替换不留残渣）；应用自身无常驻文件句柄（读惰性 Open、写临时件 rename），无 Windows 自锁；
- **对手面**（外部改内容）：普通外部工具原地重写（mtime 前进）——geoCache/containerCache 的 live `os.Stat` 指纹与 B1 哈希指纹均自愈，关键词面不受影响（Name 未变）；**刻意保 mtime+size 的对手 = 全指纹族（B1 哈希 / geoCache / containerCache）同盲**，与 B1 对手面同类，裁定接受——本刀**不新增**该盲面；
- **本刀唯一新增残面 = 幽灵/缺失条目**：外部删除/移动目录（含 ysm.json 组改名——固化显示名同步陈旧；目录级 .disabled 判态为词法推导不受路径失效影响）在下次 walk 前仍按旧记录展示（会话内经 ⑥ 即时去信任重走；盲点场景按 ⑤ 分档 cap 兜底——watched 根 15 分钟、未装配根与今日 30s TTL 同频）；
- 索引写盘开销：仅 walked 注册根、dirty 门控，稳态近零写；
- 15 分钟信任窗为经验值（见 ⑤）。

**回退**：删索引文件 = 首走自愈；本刀无配置项（B1 的 `HashIndexDisabled` 式开关若后续需要再补）；watcher 配对补丁一行不回滚零成本。

## 4. 数据溯源

- 病灶：锐评 2026-10-16 P0「无持久元数据层」处方 ②；P1-2「按类型割据，重扫贵」（稳态面）
- 先例：`go/scanner/hashindex.go`（点文件索引 / sync.Map 懒开 / dirty 门控 / 坏表自愈 / 观测计数，骨架全照抄）；`scanner_browse.go`（browseCache hit/retry/single-flight 口径）；keyVersions+cacheGen 双代数守卫（失效即去信任的零新增代码来源）
- watcher 口径：`go/watcher/watcher.go` syncAll 序（onChange 无条件 → ListVersions 空 early-return → clearCacheFn → scanFn → 逐实例 SyncToggleStatus）；两处接线 `internal/app/app.go` ServiceStartup 与 `internal/app/app_config.go` restartWatcher
- 消费面：`internal/app/app_scan.go`（树/搜索 seam）、FE toolbar-search/adv-filter 三路交集（本面下游）
- 几何面安全性证据：`internal/app/app_geo_cache.go` Get 每次 live os.Stat 取指纹（TestGeoCache_ModTimeChangeInvalidates 同口径）

<!-- 文件名: scan-index.md → 实际文件 architecture/ADR-352-scan-index.md（ADR-320 architecture 全量模板） -->
