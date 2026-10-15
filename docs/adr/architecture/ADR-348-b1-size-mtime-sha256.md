# ADR-348：两阶段扫描投影B1：持久哈希索引（size+mtime 双指纹免重读 SHA256）

- **状态**：✅ 已采纳（Adopted）
- **日期**：2026-10-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：扫描数据管线方向性决策：冷全量扫描从 O(全库字节) 降为 O(元数据)，落盘持久化副作用难逆转，sync/dedup/基准/UI 跨域消费
- **相关**：ADR-343-d1（C1 搜索收敛，同批锐评第 1 期）、ADR-003 P2（扫描下沉 go/scanner）、`go/scanner/hashindex.go`、`internal/app/app_scan.go`

---

## 1. 背景（Context）

止血三件套（2026-10-15）已把**树/UI 面**的哈希税移除（A1 浏览投影：`ScanModelEntriesForBrowse` 不算 SHA256）。残留税面：同步 / 去重 / 重链 / 基准全部消费**全量 `ScanEntries`**（含哈希）——冷缓存后（重启、30s TTL 过期、`InvalidateCache` 后）每次都要对全库逐文件重读全字节算 SHA256。万级库 + 大 `.ysm` 二进制下，同步冷启动 = 启动卡顿大头；且「文件内容没变重读全量」在语义上零收益（未变更文件的哈希恒定）。

## 2. 决策（Decision）

**两阶段扫描投影**：阶段 1 = 浏览投影（已交付 A1，无哈希、秒级）；阶段 2 = 身份投影（哈希），哈希改由**持久哈希索引**供给——

① `go/scanner/hashindex.go`：每扫描根一份 `<root>/.ysm-hash-index.json`（`path → {size, mtime(毫秒), hash}`；原子写 `fsutil.WriteFileAtomic`，损坏文件视为空表自愈重写）。全量扫描哈希段（`hashEntriesParallel`）改为：**指纹（size+mtime）命中 → 直接取存哈希，跳过文件读盘；未命中 → 真算 SHA256 并回写索引**。扫描收尾按「本次扫描路径集」剪枝索引（消失路径自愈，move/delete 无需专门失效——哈希面随路径集收敛）。
② 开关：`types.AppConfig.HashIndexDisabled`（缺省 = 启用；显式 true = 回旧全真算行为），`hashEntriesParallel` 入口经 `go/config.Get()` 活读（同 `ScanCacheTTLMs` 的 ADR-091 配置单源先例，改配置即时生效无需重启；入口快照防 worker 池并发读）。
③ 观测：`hashComputations` / `hashIndexHits` 包级计数（同 `walkCount` 范式），`benchmark` B2/B3 与 CLI 可测「冷扫免哈希率」。

**判据**：指纹 = `(Size, ModTime)` 双值（`types.ModelEntry` 既有字段，零新 I/O）；`.ban` 开关只改名不动内容（mtime/size 保持）→ 天然命中不重算；move/delete 经剪枝 + 新路径 miss 自愈。
**不做**（本刀边界）：多机共享索引（按仓库根路径键化的全局缓存）、索引 GC 上限、mmap 只读映射加速——均待数据实证后排期。

## 3. 后果（Consequences）

- 正面：冷全量扫描读盘量从 O(全库字节) 降至 O(指纹 miss 的条目字节)——稳态（watcher 增量场景）接近 O(元数据)；同步/去重/基准全线继承；重启后首扫即热。
- 负面/已知遗留：
  - **对手面**：外部工具保 size+mtime 改内容（备份还原/恶意）→ 陈旧哈希滞留至下次 mtime 变化——与 geoCache 指纹守卫同类边界（`app_geo_cache.go` 先例），已裁定接受（SHA256 消费场景最坏 = 一次同步误判，非数据损坏）；
  - 仓库根多一个 `.ysm-hash-index.json`（点文件，扫描白名单不纳管，repo-audit 的 .json 桶 +1 条目，可忽略；可移植 = 换机/换盘随仓库走）；
  - 索引写盘新增（仅真算过哈希或剪枝过时落盘，dirty 门控，稳态近零写）；
  - mtime 粒度（NTFS 100ns）内改内容的极端窗口并入对手面。
- 回退：`HashIndexDisabled` 一键回旧行为；删索引文件 = 全量重算一次自愈。

## 4. 数据溯源

- 病征：模型仓库功能锐评 P0 哈希税（2026-10-15）→ A1 移 UI 面税 → 本 ADR 收残余（同步面）
- 指纹可行性：`types.ModelEntry.Size/ModTime` 既有（毫秒级 mtime，`scanner_scan.go` walk 期已填）；`ShouldHashExt` 白名单口径不变（索引只记白名单条目）
- 原子写先例：`fsutil.WriteFileAtomic`（ADR-109 §4 起全仓统一）；缓存 TTL/包级注入先例：`EffectiveCacheTTL` / `SetErrorSink`
- 消费面：`go/sync`（toggle/relink/diff 哈希面）、`go/dedup`、CLI `benchmark`（B2/B3 冷搜口径自刀 2 起 = 扫+直通，本 ADR 进一步免哈希）

<!-- 文件名: b1-size-mtime-sha256.md → 实际文件 architecture/ADR-348-b1-size-mtime-sha256.md（ADR-320 architecture 全量模板） -->
