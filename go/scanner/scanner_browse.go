// scanner_browse.go：仓库树浏览投影（止血 2026-10-15 P0-1，原「全库哈希税」）。
// ScanEntriesBrowse / ScanEntriesBrowseWithHit / ScanEntriesBrowseCtx /
// ScanEntriesBrowseWithHitCtx——与 ScanEntries 同一套过滤口径（recycle/.github/
// .relink-bak-*/禁用后缀目录跳过、扩展名白名单、.json 仅放行 ysm.json、.ban 恢复），
// 但 **不计算 SHA256**（Hash 恒空）：哈希只被同步系统的文件内容匹配消费
// （go/sync sync.go 的 repoHash / sync_push / sync_relink 等），仓库树（app-tree
// loader、预览 siblings/候选列表）从不读 Hash——每次冷加载为同步付一遍「全库逐文件
// 读全量字节」是纯税。大库冷扫/缓存过期重扫成本降为纯目录枚举 + d.Info()。
//
// 缓存隔离（红线）：无哈希条目**不得**进共享 scanCache——同步系统把「哈希为空」当
// 静默跳过匹配（scanner_scan.go 的 emitScanError 口径），污染即同步静默失真。
// 故浏览走独立 browseCache：同 30s TTL、共享 cacheGen / keyVersions 代际守卫，
// InvalidateCache / InvalidatePath 双缓存同时失效；在途合并用独立 inFlightBrowse
// 表——全量扫描 waiter 绝不能并入浏览 owner 的航班取无哈希结果写回 scanCache
// （正向全量→浏览无害，反向污染不被代际守卫拦截）。
//
// 诊断计数：浏览路径**不**计 walkCount（scan-bench 的引擎归属测量的是全量扫描，
// 混入会污染「这次扫描是否真走引擎」的前后差判据）。
package scanner

import (
	"context"
	"io/fs"
	"os"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/types"
)

// browseCache 浏览投影独立缓存：dir → scanCacheEntry（Hash 恒空的条目，共享 TTL）。
// 与 scanCache 同寿命同失效（InvalidateCache/InvalidatePath 双删），但写入来源独立。
var browseCache sync.Map

// inFlightBrowse 浏览路径在途航班表：dir → *scanFlight。独立于 inFlight——
// 见文件头「缓存隔离」：跨路径在途合并会把无哈希结果带进全量扫描 waiter。
var inFlightBrowse sync.Map

// joinInFlightBrowseWaiter 浏览路径在途合并：与 joinInFlightWaiter 同构，
// 航班表换成 inFlightBrowse（失效守卫仍共享 cacheGen/keyVersions——同一目录
// 的在途全量/浏览扫描必须看到同一版本戳）。
func joinInFlightBrowseWaiter(dir string, fl *scanFlight) joinResult {
	prev, loaded := inFlightBrowse.LoadOrStore(dir, fl)
	if !loaded {
		return joinResult{} // owner
	}
	other := prev.(*scanFlight)
	other.wg.Wait()
	kvNow, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	if cacheGen.Load() == other.gen && kvNow.(*atomic.Uint64).Load() == other.keyVersion {
		return joinResult{entries: append([]types.ModelEntry{}, other.entries...), hit: true}
	}
	return joinResult{retry: true}
}

// lookupBrowseCache 查 browseCache，命中新鲜条目返回克隆（同 lookupScanCache 口径）。
func lookupBrowseCache(dir string) ([]types.ModelEntry, bool) {
	v, ok := browseCache.Load(dir)
	if !ok {
		return nil, false
	}
	entry := v.(scanCacheEntry)
	if time.Now().Before(entry.expiresAt) {
		return append([]types.ModelEntry{}, entry.entries...), true
	}
	browseCache.Delete(dir)
	return nil, false
}

// tryStoreBrowseCache 版本守卫通过时写入 browseCache（同 tryStoreScanCache：
// 在途被失效则丢弃；walkFailed 结果不缓存——「目录不可读」不享受 30s 假空）。
func tryStoreBrowseCache(dir string, stored []types.ModelEntry, startTime time.Time, gen, keyVersion uint64, walkFailed bool) {
	if walkFailed {
		return
	}
	kvNow, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	if cacheGen.Load() != gen || kvNow.(*atomic.Uint64).Load() != keyVersion {
		return
	}
	browseCache.Store(dir, scanCacheEntry{entries: stored, expiresAt: startTime.Add(scanTTL())})
}

// ScanEntriesBrowse 仓库树浏览投影（无 SHA256）：同 ScanEntries 的过滤口径，
// Hash 恒空；读浏览独立缓存，不污染同步消费的 scanCache。
func ScanEntriesBrowse(dir string) []types.ModelEntry {
	entries, _ := ScanEntriesBrowseWithHit(dir)
	return entries
}

// ScanEntriesBrowseWithHit 同 ScanEntriesBrowse，但额外返回是否命中浏览缓存，
// 调用方据此决定是否记录扫描日志（TTL 内重复访问不刷屏操作日志，同 WithHit 口径）。
func ScanEntriesBrowseWithHit(dir string) ([]types.ModelEntry, bool) {
	return ScanEntriesBrowseWithHitCtx(context.Background(), dir)
}

// ScanEntriesBrowseCtx 同 ScanEntriesBrowse，ctx 取消时中止 walk（ADR-197 对齐），
// 返回已收集的部分结果且不写缓存。
func ScanEntriesBrowseCtx(ctx context.Context, dir string) []types.ModelEntry {
	entries, _ := ScanEntriesBrowseWithHitCtx(ctx, dir)
	return entries
}

// ScanEntriesBrowseWithHitCtx 浏览投影核心（带 ctx 取消）：结构对齐
// ScanEntriesWithHitCtx（代际守卫 / 在途合并 / 排序 / 失败不缓存），差异两处——
// ① 缓存/航班表换 browseCache/inFlightBrowse；② 不跑 hashEntriesParallel
// （deferHash=true 跳过 walk 内联哈希 + 不走并行回填，Hash 留空即契约）。
func ScanEntriesBrowseWithHitCtx(ctx context.Context, dir string) ([]types.ModelEntry, bool) {
	dir = normalizeScanKey(dir)
	if dir == "" {
		return []types.ModelEntry{}, false
	}
	// 符号链接根目录检查（与 ScanEntriesWithHitCtx / go/dedup 同口径）
	if fi, err := os.Lstat(dir); err == nil && fi.Mode()&os.ModeSymlink != 0 {
		emitScanError("[scanner] 扫描根目录是符号链接: %s", dir)
		return []types.ModelEntry{}, false
	}
	startTime := time.Now()
retry:
	gen := cacheGen.Load()
	kv, _ := keyVersions.LoadOrStore(dir, &atomic.Uint64{})
	keyVersion := kv.(*atomic.Uint64).Load()

	if cloned, ok := lookupBrowseCache(dir); ok {
		return cloned, true
	}

	fl := &scanFlight{gen: gen, keyVersion: keyVersion}
	fl.wg.Add(1)
	if res := joinInFlightBrowseWaiter(dir, fl); res.hit {
		return res.entries, true
	} else if res.retry {
		goto retry
	}
	defer func() {
		inFlightBrowse.Delete(dir)
		fl.wg.Done()
	}()

	entries := []types.ModelEntry{}
	var entriesMu sync.Mutex
	var walkFailed atomic.Bool
	// 条目级错误计数（ADR-352 ③）：非根 ReadDir 回调 err + d.Info() 失败。
	// >0 = 本次路径集不完整——prune 会误删磁盘真实条目，索引维护门整体跳过。
	var entryErrs atomic.Int64
	// ADR-352 ④ 快路径（单飞 owner 分支内）：信任态（trusted + 双代数快照 + 15 分钟窗）
	// 成立时免 walk，按持久索引表重建条目——waiter 经既有航班机制取 fl.entries
	// （hit=true，不重复重建），结果经 tryStoreBrowseCache 版本守卫回存刷 TTL。
	si := ScanIndexFor(dir)
	if si != nil {
		if served, ok := si.Serve(); ok {
			fl.entries = served
			tryStoreBrowseCache(dir, served, startTime, gen, keyVersion, false)
			return served, true // 未走盘——缓存命中口径，oplog 免刷屏
		}
	}
	// 索引维护快照须在 walk 启动前捕获（ADR-352 ③/S1-1）：walk 期间的代际推进
	// 不得被收尾复核「追认」——混合结果不得固化入表。
	if si != nil {
		si.MarkWalkStart()
		indexWalks.Add(1)
	}
	// wantMeta=true：树需要 Size/ModTime（size/date 排序）；deferHash=true：跳过
	// walk 内联哈希，且本路径不跑 hashEntriesParallel——Hash 恒空即浏览投影契约。
	if werr := walkDirParallel(dir, func(p string, d os.DirEntry, err error) error {
		if ctx.Err() != nil {
			return fs.SkipAll
		}
		entry, walkRet, rootFailed := processScanDirEntry(p, d, err, dir, true, true, &entryErrs)
		if rootFailed {
			walkFailed.Store(true)
			return nil
		}
		if walkRet != nil {
			return walkRet
		}
		if entry != nil {
			entriesMu.Lock()
			entries = append(entries, *entry)
			entriesMu.Unlock()
		}
		return nil
	}); werr != nil {
		walkFailed.Store(true)
	}
	// 并行遍历产出非确定顺序——按路径排序恢复 filepath.WalkDir 的字典序口径
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})
	stored := append([]types.ModelEntry(nil), entries...)
	fl.entries = stored
	if ctx.Err() != nil {
		return entries, false
	}
	tryStoreBrowseCache(dir, stored, startTime, gen, keyVersion, walkFailed.Load())
	// ADR-352 ③ 索引收尾：根级失败（walkFailed）不进入维护——末次良好表保留服务
	// 至 15 分钟 cap（静默降级面，诊断经 scanErrorDedup/OpLog 可见）；ctx 取消
	// 已在上方提前返回，此处结果必完整。
	if si != nil && !walkFailed.Load() {
		si.CommitWalk(stored, entryErrs.Load())
	}
	return entries, false
}

// InvalidateBrowseCache 全量失效浏览缓存（供 InvalidateCache 内部调用；导出仅为
// 同包测试与失效配对派生闸断言入口，外部调用方应走 InvalidateCache）。
func InvalidateBrowseCache() {
	browseCache.Range(func(key, _ interface{}) bool {
		browseCache.Delete(key)
		return true
	})
}

// InvalidateBrowsePath 删除指定目录的浏览缓存（判据与 scanCache 删除单点同源
// isInvalidationRelated——自身/子孙/祖先、兄弟目录不失效；外部调用方应走
// InvalidatePath 保持双缓存配对失效）。
func InvalidateBrowsePath(dir string) {
	key := normalizeScanKey(dir)
	if key == "" {
		return
	}
	browseCache.Range(func(k, _ interface{}) bool {
		kstr := k.(string)
		if isInvalidationRelated(key, kstr) {
			browseCache.Delete(kstr)
		}
		return true
	})
}
