// scanindex.go — 持久浏览索引（ADR-352 两阶段扫描投影二段：身份投影 B1 之后的浏览段）。
// 每注册扫描根一份 <root>/.ysm-scan-index.json（path → {name, size, mtime}）：
// 浏览 walk 零错误收尾时 upsert 本次路径集 + prune 消失路径（move/delete 自愈）+
// dirty 门控原子落盘；缓存 TTL 过期且信任态（trusted + 双代数快照未推进 + 15 分钟窗）
// 成立时，ScanEntriesBrowseWithHit 免 walk 直接按表重建条目（O(1) 稳态服务）。
//
// 信任态是进程内语义（ADR-352 二轮审查 N1）：表文件只持久化 records，trusted 位与
// 代际快照不落盘——新进程活体 (cacheGen=0, keyVersions=0) 撞旧进程持久化的 (0,0)+trusted
// 会免 walk serve 陈旧索引，击穿「重启首走即信任收敛点」。load 时 trusted 强制 false，
// 本进程首次零错误 walk 才重锚。
//
// 红线（镜像 walkFailed 不缓存）：根级失败 / 条目级错误计数 >0 / walk 期间代际推进
// 三者任一，本次 upsert+prune+Save 全部放弃——部分失败的路径集做 prune 会误删磁盘
// 真实条目，失败结果不得当成功固化。
package scanner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// ScanIndexPath 扫描根下的索引文件名（点文件：扫描白名单不纳管，repo-audit 的
// .json 桶 +1 可忽略；可移植——随仓库目录走，换机/换盘索引仍命中，口径同 B1 哈希索引）
const ScanIndexPath = ".ysm-scan-index.json"

// indexTrustCap 被监控根的信任时限（ADR-352 ⑤）：锚点 = 最近一次零错误 walk 成功，
// 成功 serve 不重锚——超窗即重走并刷新锚点，形成健康周期。仅对「watcher 主动去信任」
// 的根（MarkIndexRootWatched）生效；其余注册根取 scanTTL() 兜底（= 与今日 TTL 过期
// 重走同周期，外部变更探测零回归——它们没有失效源，给 15min 窗会把探测上限从
// 30s 恶化 30 倍，表只在持久化面获益）。数值为经验值，基准数据到手后可调。
var indexTrustCap = 15 * time.Minute

// SetIndexTrustCapForTest 仅测试注入（生产恒 15min）：压缩信任窗验证 cap 过期重走。
func SetIndexTrustCapForTest(d time.Duration) {
	indexTrustCap = d
}

// scanIndexRecord 单条浏览投影记录。Ext 不入表——serve 重推（与 processScanDirEntry
// 逐字同口径：先剥禁用后缀再取小写扩展名，x.ysm.disabled 重推 ".ysm"，不得固为
// 禁用后缀）；SubDir 恒不填（walk 层已停填，测试锁定）；Hash 恒空（浏览契约）。
type scanIndexRecord struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"` // Unix 毫秒，types.ModelEntry.ModTime 同口径
}

// scanIndexTable 某扫描根专属的持久浏览索引（懒加载 + 内存写 + dirty 门控原子落盘，
// 骨架照抄 hashindex.go；trusted 位与快照为内存态，OpenScanIndex 恒置 false——N1）。
type scanIndexTable struct {
	mu        sync.Mutex
	path      string
	records   map[string]scanIndexRecord
	dirty     bool
	loadEmpty bool
	// 信任态（进程内，不落盘）：
	trusted    bool
	trustedGen uint64 // walk 启动前捕获的 cacheGen
	trustedKV  uint64 // walk 启动前捕获的 keyVersions[root]
	trustedAt  time.Time
	// registered 由 SetIndexRoots 管理：仅注册根查表/维护/落盘；
	// watched 由 MarkIndexRootWatched 管理（watcher 主动去信任的根）：
	// 信任窗取 indexTrustCap，其余注册根取 scanTTL()（外部变更探测零回归）。
	registered bool
	watched    bool
}

// OpenScanIndex 打开（或懒初始化）某扫描根的浏览索引。
// 文件不存在 = 空表（首扫全走，正常冷启动）；存在但解析失败 = 空表 + 标记待重写。
// trusted 恒 false（N1：跨重启不采信信任态，本进程首次零错误 walk 才锚定）。
func OpenScanIndex(rootDir string) *scanIndexTable {
	t := &scanIndexTable{
		path:    filepath.Join(rootDir, ScanIndexPath),
		records: map[string]scanIndexRecord{},
	}
	data, err := os.ReadFile(t.path)
	if err != nil {
		return t
	}
	var m map[string]scanIndexRecord
	if json.Unmarshal(data, &m) != nil || m == nil {
		t.loadEmpty = true
		return t
	}
	for p, r := range m {
		t.records[p] = r
	}
	return t
}

// indexTables 按扫描根懒开的表实例（sync.Map：rootDir → *scanIndexTable，同 hashIndexes 先例）。
// 生命周期受 indexRootsMu 保护（SetIndexRoots 重注册时 Range+Delete 出集表，不驻留积累——N4）。
var indexTables sync.Map

// indexRootsMu 保护 indexRoots 与 indexTables 的生命周期变更（懒开 LoadOrStore 免锁，
// Delete 与 LoadOrStore 并发是 sync.Map 惯用安全组合——Delete 至多删掉一个即将被
// LoadOrStore 重建的实例，新实例 registered=false 语义无害）。
var indexRootsMu sync.RWMutex

// indexRoots 当前注册根集合（normalizeScanKey 后存键，与快路径请求键字节级一致——N8）；
// 值 = watched 位（watcher 主动去信任的根，信任窗取 indexTrustCap，其余取 scanTTL()）
var indexRoots = map[string]bool{}

// IsIndexRoot 该（归一化后）目录是否注册扫描根
func IsIndexRoot(dir string) bool {
	indexRootsMu.RLock()
	defer indexRootsMu.RUnlock()
	_, ok := indexRoots[dir]
	return ok
}

// SetIndexRoots 注册扫描根集合（app 层在 ServiceStartup / restartWatcher /
// SetResourceRoot / ResetResourceRoot 调用，清单 = a.allAllowedRoots() 非空项）。
// 全量重建（watched 位复位 false——根变更后 watcher 未必跟上新根，保守降级
// scanTTL() 兜底）；已出注册集的既有表实例删除（根切换不驻留孤儿表——N4）；
// 新根下次访问时懒开。
func SetIndexRoots(dirs []string) {
	indexRootsMu.Lock()
	indexRoots = map[string]bool{}
	for _, d := range dirs {
		if k := normalizeScanKey(d); k != "" {
			indexRoots[k] = false
		}
	}
	indexRootsMu.Unlock()
	// 同步既有表实例的 registered/watched 位 + 删除出集表
	forEachIndexTable(func(key string, t *scanIndexTable, watched, ok bool) {
		t.registered = ok
		t.watched = ok && watched
		if !ok {
			indexTables.Delete(key)
		}
	})
}

// MarkIndexRootWatched 标记「watcher 主动去信任」的根（app 层在 watcher.Start /
// 重启 watcher 成功后调用，实参 = watcher 实际监视的仓库根，即 a.ysmRoot()）。
// 仅这些根享 indexTrustCap 长信任窗：其外部变更必经 watcher onChange →
// InvalidateScanPath 去信任，15min 只是失效源故障（Linux inotify 超限/事件丢失）
// 时的最坏上限；其余注册根取 scanTTL()（与今日 TTL 过期重走同周期，零回归）。
func MarkIndexRootWatched(dirs []string) {
	indexRootsMu.Lock()
	for _, d := range dirs {
		if k := normalizeScanKey(d); k != "" {
			if _, ok := indexRoots[k]; ok {
				indexRoots[k] = true
			}
		}
	}
	indexRootsMu.Unlock()
	forEachIndexTable(func(_ string, t *scanIndexTable, watched, ok bool) {
		t.watched = ok && watched
	})
}

// forEachIndexTable 遍历全部索引表实例，对每项回调「当前注册集快照」：
// key = 归一化目录；t = 表实例（回调期间已持 t.mu）；watched/ok = 该 key 在
// indexRoots 里的 (watched 位, 是否在注册集)。
//
// 抽出的理由：SetIndexRoots / MarkIndexRootWatched 此前各抄一份同样的
// 「key 断言 → indexRootsMu.RLock 读位 → t.mu.Lock → 置位 → Unlock」骨架，
// 两处唯一的差别只在锁内做什么（前者还删出集表）——骨架抄两份，锁纪律就得
// 同步维护两遍（jscpd 亦反复点名该对）。
//
// 锁顺序契约（不可调换）：先取 indexRootsMu 读快照并立即释放，再取 t.mu——
// 若反过来（持 t.mu 时去取 indexRootsMu），与 IsIndexRoot 等只读路径无冲突，
// 但与「先 indexRootsMu 后 t.mu」的其他路径构成反向序，存在死锁面。
func forEachIndexTable(fn func(key string, t *scanIndexTable, watched, ok bool)) {
	indexTables.Range(func(k, v interface{}) bool {
		key := k.(string)
		indexRootsMu.RLock()
		watched, ok := indexRoots[key]
		indexRootsMu.RUnlock()
		t := v.(*scanIndexTable)
		t.mu.Lock()
		fn(key, t, watched, ok)
		t.mu.Unlock()
		return true
	})
}

// ScanIndexFor 取某扫描根的索引表（懒开；未注册根的表存在但 registered=false，
// Serve/CommitWalk 自动 no-op——子目录浏览不落文件、不查表，行为不变）
func ScanIndexFor(rootDir string) *scanIndexTable {
	dir := normalizeScanKey(rootDir)
	if dir == "" {
		return nil
	}
	if v, ok := indexTables.Load(dir); ok {
		return v.(*scanIndexTable)
	}
	indexRootsMu.RLock()
	watched, reg := indexRoots[dir]
	indexRootsMu.RUnlock()
	t := OpenScanIndex(dir)
	t.mu.Lock()
	t.registered = reg
	t.watched = reg && watched
	t.mu.Unlock()
	actual, _ := indexTables.LoadOrStore(dir, t)
	return actual.(*scanIndexTable)
}

// keyVersionOf 读某目录的 per-key 版本戳（未开过 = 0，与 flight 捕获口径同源）
func keyVersionOf(dir string) uint64 {
	kv, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	return kv.(*atomic.Uint64).Load()
}

// MarkWalkStart walk 启动前捕获信任快照（S1-1：必须 walk 前捕获——walk 期间失效
// 推进的代际不得被收尾复核「追认」，混合结果不得固化入表）
func (t *scanIndexTable) MarkWalkStart() {
	if !t.isRegistered() {
		return
	}
	t.mu.Lock()
	t.trustedGen = cacheGen.Load()
	t.trustedKV = keyVersionOf(rootOf(t.path))
	t.mu.Unlock()
}

// rootOf 由表文件路径反推扫描根（OpenScanIndex 时 filepath.Join(root, ScanIndexPath)）
func rootOf(indexFile string) string {
	return filepath.Dir(indexFile)
}

// CommitWalk walk 收尾维护（ADR-352 ③ 保存门）：
//  1. 快照复核：当前 cacheGen/keyVersions 任一推进（walk 期间被失效）→ 放弃本次
//     upsert+prune+Save（混合结果不得固化，镜像 tryStoreBrowseCache 版本守卫）；
//  2. 条目级错误计数 >0 → 放弃 prune（部分失败路径集误删真实条目）且不刷信任锚点；
//     upsert 本身安全（新条目真存在），但 dirty 不落盘直至下次合法 walk——
//     保守取「整体放弃」，与红线「失败结果不得当成功固化」同向；
//  3. 全过：upsert 本次路径集 + prune 消失路径 + trusted 锚定 + dirty 门控 Save。
//
// 根级 walk 失败（walkFailed）由调用方不进入本函数（保留末次良好表服务至 cap——S3-9）。
func (t *scanIndexTable) CommitWalk(entries []types.ModelEntry, entryErrs int64) {
	if !t.isRegistered() {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	root := rootOf(t.path)
	// 保存门 1：快照复核（walk 启动前捕获的快照 vs 当前活体）
	if cacheGen.Load() != t.trustedGen || keyVersionOf(root) != t.trustedKV {
		return
	}
	// 保存门 2：条目级错误门（>0 = 本次路径集不完整，prune 会误删）
	if entryErrs > 0 {
		return
	}
	current := make(map[string]struct{}, len(entries))
	for _, e := range entries {
		t.records[e.Path] = scanIndexRecord{Name: e.Name, Size: e.Size, Mtime: e.ModTime}
		current[e.Path] = struct{}{}
	}
	for p := range t.records {
		if _, ok := current[p]; !ok {
			delete(t.records, p)
		}
	}
	t.dirty = true
	t.trusted = true
	t.trustedAt = time.Now()
	t.saveLocked()
}

// Serve 信任态成立时按表重建条目（ADR-352 ④ 快路径，单飞 owner 分支调用）：
// trusted && 代际快照未推进 && 信任窗内（被监控根 = indexTrustCap，其余注册根 =
// scanTTL()——后者无 watcher 失效源，取与今日 TTL 过期重走同周期，外部变更
// 探测零回归，表仅贡献持久化面）。重建口径：Ext 词法重推、SubDir 恒空、
// Hash 恒空（浏览契约）、Path 字典序（与 walk 的 sort.SliceStable 同序）。
// 成功重建计 indexServes（仅 owner 调一次——waiter 取 fl.entries 不重复计数）。
func (t *scanIndexTable) Serve() ([]types.ModelEntry, bool) {
	if !t.isRegistered() {
		return nil, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	root := rootOf(t.path)
	if !t.trusted || cacheGen.Load() != t.trustedGen || keyVersionOf(root) != t.trustedKV {
		return nil, false
	}
	trustCap := scanTTL()
	if t.watched {
		trustCap = indexTrustCap
	}
	if time.Since(t.trustedAt) >= trustCap {
		return nil, false // 超窗：本次走 walk，刷新锚点（健康周期）
	}
	out := make([]types.ModelEntry, 0, len(t.records))
	for p, r := range t.records {
		out = append(out, rebuildEntry(p, r))
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Path < out[j].Path
	})
	indexServes.Add(1)
	return out, true
}

// rebuildEntry 从记录重建 ModelEntry（ADR-352 ① 字段口径）：
// Ext = ToLower(Ext(stripDisableSuffix(path)))——与 processScanDirEntry 逐字同口径
// （先剥禁用后缀再取小写扩展名）；SubDir 恒空；Hash 恒空。
func rebuildEntry(p string, r scanIndexRecord) types.ModelEntry {
	ext := strings.ToLower(filepath.Ext(p))
	if restored := stripDisableSuffix(p); restored != p {
		ext = strings.ToLower(filepath.Ext(restored))
	}
	return types.ModelEntry{
		Name:    r.Name,
		Path:    p,
		Ext:     ext,
		ModTime: r.Mtime,
		Size:    r.Size,
	}
}

// isRegistered 表实例的注册位（注册集变更经 SetIndexRoots 同步）
func (t *scanIndexTable) isRegistered() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.registered
}

// saveLocked 原子落盘（须持 t.mu；dirty 门控 + 坏表自愈口径同 hashindex.Save）
func (t *scanIndexTable) saveLocked() {
	if !t.dirty {
		return
	}
	data, err := json.MarshalIndent(t.records, "", "  ")
	if err != nil {
		return
	}
	if err := fsutil.WriteFileAtomic(t.path, data); err != nil {
		return // 目录不可写等 fail-safe：内存表照常服务，索引丢失不影响正确性（只损失加速）
	}
	t.dirty = false
	t.loadEmpty = false
}

// 观测计数（同 walkCount 范式，CLI benchmark 消费「稳态免走率」= indexServes /
// (indexServes+indexWalks)——ADR-352 ⑦；indexWalks 计注册根上的浏览 owner 真走次数）
var (
	indexServes atomic.Int64 // 索引表免 walk 服务次数（owner 口径）
	indexWalks  atomic.Int64 // 注册根浏览 owner 真走次数（含 cap 超窗重走）
)

// ScanIndexStatsSnapshot 当前计数快照 + 测试复位
func ScanIndexStatsSnapshot() (serves, walks int64) {
	return indexServes.Load(), indexWalks.Load()
}

// ResetScanIndexStats 测试专用复位
func ResetScanIndexStats() {
	indexServes.Store(0)
	indexWalks.Store(0)
}
