// ===== 同步目录扫描结果缓存（TTL 跟随 scanner.EffectiveCacheTTL，默认 30s）=====
// 背景：BuildSyncItems 结果缓存能挡住“重复刷新”，但首次重算仍有多条路径直接 Walk：
//   - SyncResources（resourcepack/shaderpack 文件级）
//   - SyncResourcesDirLevel 含嵌套类型（maid-model）回退 Walk
//   - DiffFolderContents 的实例侧 collectFolderFiles Walk
//
// 这里给这些“同步专用扫盘结果”再加一层短 TTL 缓存，使一次失效后的重算在 30s 内
// 对同一目录/rtype 只真正 Walk 一次（与 scanner.ScanEntries 的去重效果对齐）。
//
// 铁律（引用返回契约）：
// loadSyncScanCache 返回的 map 是缓存共享对象，消费方必须只读。
// 禁止在 diff/对比后向返回的 map 写入“虚拟条目/临时条目”，否则会跨调用串数据。
// 若未来确需修改，先 clone 再改，或在本包统一改为浅拷贝返回。
package sync

import (
	"sync"
	"time"

	"ysm-model-manager/go/scanner"
)

var (
	registerHookOnce sync.Once
)

// RegisterInvalidationHook 把同步扫描缓存挂到 scanner 失效钩子上。
// 原为包内隐式 init 注册（导入即产生跨包副作用），改为 app 层启动时显式调用，
// 依赖可见且可测；内部 sync.Once 保证幂等，可安全重复调用。
func RegisterInvalidationHook() {
	registerHookOnce.Do(func() {
		scanner.OnCacheInvalidated(InvalidateSyncScanCaches)
	})
}

// syncDirectoryScanKey 标识一次同步扫描结果。
// kind 用于区分三类结果：
//   - "resources":  map[string]DiffEntry（SyncResources 全树文件 + 资源包文件夹）
//   - "dirlevel":   map[string]string（SyncResourcesDirLevel 的同步单元集合）
//   - "folder":     map[string]string（DiffFolderContents 的文件夹内文件集合）
type syncDirectoryScanKey struct {
	kind  string
	root  string
	rtype string
	// hashed 区分「带哈希的 resources 扫描」与「纯 Size 扫描」两种 collect 结果，
	// 防 D2′-a 注入版（scanFn≠nil，条目附 Hash）与 nil 版（Size-only）互相污染缓存：
	// 否则 nil 调用先 populate 无哈希缓存 → App.SyncResources 命中它 → 内容级判定静默失效 30s。
	// 仅 "resources" 用；其余 kind 恒 false（字段名构造默认零值）。
	hashed bool
}

type syncDirectoryScanEntry struct {
	value     any
	expiresAt time.Time
}

var (
	// 三类「同步专用扫盘结果」缓存。选型 sync.Map 而非 sync.RWMutex + 普通 map：
	// 读取路径（同步重算）无写锁竞争、写入按 key 并发分散（每目录/rtype 一个 key，天然
	// disjoint），正好落入 sync.Map「读多、写 key 集分散」的适用域；失效走全量
	// Range+Delete（InvalidateSyncScanCaches）由单一失效入口触发，无细粒度锁竞争。
	// 若未来出现高频「部分 key 写入校验」场景再评估切 RWMutex。
	syncResourcesScanCache sync.Map // syncDirectoryScanKey -> *syncDirectoryScanEntry (map[string]DiffEntry)
	syncDirLevelScanCache  sync.Map // syncDirectoryScanKey -> *syncDirectoryScanEntry (map[string]string)
	syncFolderScanCache    sync.Map // syncDirectoryScanKey -> *syncDirectoryScanEntry (map[string]string)
)

// InvalidateSyncScanCaches 清空全部同步目录扫描结果缓存。
// scanner.InvalidateCache/InvalidatePath 会自动调用；不走 scanner 失效的 push/pull/toggle
// 等入口需显式调（见 internal/app 的 mutation 收口）。
func InvalidateSyncScanCaches() {
	syncResourcesScanCache.Range(func(k, _ interface{}) bool {
		syncResourcesScanCache.Delete(k)
		return true
	})
	syncDirLevelScanCache.Range(func(k, _ interface{}) bool {
		syncDirLevelScanCache.Delete(k)
		return true
	})
	syncFolderScanCache.Range(func(k, _ interface{}) bool {
		syncFolderScanCache.Delete(k)
		return true
	})
}

// loadSyncScanCache 命中时直接返回缓存内 map/MAP 引用；调用方按包级契约只读使用。
func loadSyncScanCache[T any](cache *sync.Map, key any) (T, bool) {
	v, ok := cache.Load(key)
	if !ok {
		var zero T
		return zero, false
	}
	entry := v.(*syncDirectoryScanEntry)
	if time.Now().Before(entry.expiresAt) {
		value, ok := entry.value.(T)
		if !ok {
			cache.Delete(key)
			var zero T
			return zero, false
		}
		return value, true
	}
	cache.Delete(key)
	var zero T
	return zero, false
}

func storeSyncScanCache[T any](cache *sync.Map, key any, value T) {
	cache.Store(key, &syncDirectoryScanEntry{
		value: value,
		// 写缓存时刻取当前生效 TTL（scanner 单一事实源，随 AppConfig.ScanCacheTTLMs 变化）
		expiresAt: time.Now().Add(scanner.EffectiveCacheTTL()),
	})
}
