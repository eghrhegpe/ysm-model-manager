// ===== 模型扫描 + 作者提取 + 仓库索引（ADR-003 P2 Logic Sinking）=====
// 从 internal/app/app_scan.go 下沉：目录扫描、SHA256 哈希、扫描缓存、
// 作者提取、index.json 生成。纯 Go 逻辑，无 Wails runtime 依赖；
// tagsStore 填充与 AddOpLog 日志由薄壳处理。
// 2026-10 拆分：原 976 行按职责分为 scanner.go（本文件：缓存 + single-flight + Invalidate）/
// scanner_scan.go（扫描主体 + 哈希）/ scanner_lite.go（轻量目录遍历）/ scanner_authors.go（作者提取）/
// scanner_repo_index.go（index.json 生成）。
package scanner

import (
	"fmt"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/types"
)

// ========== 扫描缓存（30s TTL）==========

var scanCache sync.Map

// cacheGen 缓存代际：InvalidateCache（全量失效）递增。
// 在途扫描 Store 前比对代际，若扫描期间缓存已被全量失效则丢弃本次结果，
// 防止「刚失效又被旧扫描结果重新 Store」导致失效白做（P2 竞态修复）。
// 用 atomic 保护：watcher 后台 goroutine 与 Wails 绑定线程并发读写，普通 uint64 存在数据竞争。
var cacheGen atomic.Uint64

// keyVersions per-key 版本戳（P1 修复：InvalidatePath 只递增目标目录版本——
// 原实现递增全局 cacheGen，单目录失效会丢弃其它任意目录的在途扫描结果，
// 安全但浪费，等同全量失效；per-key 隔离后仅本目录在途扫描受影响。
// 值类型为 *atomic.Uint64，支持原子 Load/Store/Add 操作，消除竞态窗口。）
var keyVersions sync.Map // string → *atomic.Uint64

type scanCacheEntry struct {
	entries   []types.ModelEntry
	expiresAt time.Time
}

// ========== 在途合并（single-flight）==========
// 背景（2026-08-21）：点击整合包时前端多组件并发请求实例状态，同目录扫描在途重叠——
// 缓存「扫完才 Store」让重叠请求双双真扫（操作日志同秒出现两条相同目录记录）。
// 同目录并发扫描共享一次 walk：首个请求注册航班走盘，后续请求等待并取克隆结果，
// 返回 hit=true 让薄壳不重复记扫描日志（唯一真扫的 owner 返回 hit=false）。

// inFlight 在途航班表：dir → *scanFlight
var inFlight sync.Map

// walkCount 真实走盘次数（诊断/测试用：验证在途合并与缓存效果）
var walkCount atomic.Int64

// flightJoins 并入在途航班的等待方计数（诊断/测试用）
var flightJoins atomic.Int64

// walkStartHookFn 走盘开始钩子（仅测试注入：制造确定性在途重叠；生产恒 nil）。
// 旧实现是裸包级变量、无任何并发防护——现经 hookMu 读写（Set* 注入 / get* 快照读取，
// 与 SetErrorSink 同款范式）；测试注入走 Set 接口，禁止生产调用。
var (
	hookMu          sync.RWMutex
	walkStartHookFn func()
)

// setWalkStartHook 注入/清除走盘开始钩子（仅同包测试 seam，包外不可见；传 nil 清除）。
// ADR-176 2.2：改为未导出，生产/绑定 API 不再暴露可写函数指针。
func setWalkStartHook(fn func()) {
	hookMu.Lock()
	walkStartHookFn = fn
	hookMu.Unlock()
}

// getWalkStartHook 快照读取走盘钩子（生产路径恒 nil）。
func getWalkStartHook() func() {
	hookMu.RLock()
	defer hookMu.RUnlock()
	return walkStartHookFn
}

// 注意：ADR-176 2.2 将测试注入 seam 改为未导出；当前仅剩 walkStartHookFn 一条 seam。

type scanFlight struct {
	wg         sync.WaitGroup
	entries    []types.ModelEntry
	gen        uint64 // owner 启动时捕获的 cacheGen（waiter 失效守卫比较用）
	keyVersion uint64 // owner 启动时捕获的 per-key 版本
}

// joinResult joinInFlightWaiter 的结果（替代三态 bool 返回）：
//   - hit=true：成功等到合法（版本未变）航班结果，直接用 entries
//   - retry=true：等到但版本已变，调用方 goto retry 重来
//   - 两者皆 false：本调用成为 owner，需自己真扫并把结果写入 fl.entries
//
// hit 与 retry 互斥。
type joinResult struct {
	entries []types.ModelEntry
	hit     bool
	retry   bool
}

const scanCacheTTL = 30 * time.Second

// errorSink 扫描错误回调（ADR-082 续：GUI 下 stdout 不可见，log.Printf 等于静默——
// 薄壳注入 AddOpLog 让 walk/文件信息/哈希错误进环形日志面板，用户可查）
// 旧实现是裸变量，SetErrorSink 无锁写、emitScanError 无锁读 → data race。
// 改 RWMutex 保护（启动期单写、运行期只读，RWMutex 足够）。
var (
	errorSinkMu sync.RWMutex
	errorSink   func(msg string)
)

// scanErrorDedup 错误去重窗口：同一 msg 在窗口期内只上报一次。
// 背景：扫描缓存 30s TTL，缓存过期后同目录反复重扫；若目录持续出错（如权限拒绝），
// 每次扫描都会触发同一条错误 → 环形日志面板刷屏（日志面板本身无去重，只按条数截尾）。
// 窗口与 scanCacheTTL 对齐（30s）：重扫前该错误已入面板，去重不影响可查性。
const scanErrorDedupWindow = 30 * time.Second

// dedupCleanEvery 每次全量清理间隔（按写入次数）：错误路径本身低频，
// 摊还避免每次上报都锁内 O(n) 遍历 dedupSeen。
const dedupCleanEvery = 128

// dedupMu + dedupSeen 记录 msg → 上次上报时间；dedupWrites 写入计数（摊还清理用）
var (
	dedupMu     sync.Mutex
	dedupSeen   = map[string]time.Time{}
	dedupWrites int
)

// SetErrorSink 注入扫描错误回调（薄壳 internal/app 启动时调用，如 AddOpLog 包装）
// RWMutex 写锁保护，消除 data race。
func SetErrorSink(fn func(msg string)) {
	errorSinkMu.Lock()
	errorSink = fn
	errorSinkMu.Unlock()
}

// emitScanError 上报扫描错误：注入 sink 时走 sink（进日志面板），否则 log.Printf 兜底。
// 同 msg 在 scanErrorDedupWindow 窗口内去重（防重复扫描刷屏），窗口外重新上报。
func emitScanError(format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	now := time.Now()
	dedupMu.Lock()
	last, seen := dedupSeen[msg]
	if seen && now.Sub(last) < scanErrorDedupWindow {
		dedupMu.Unlock()
		return // 窗口内同错误已上报过，去重
	}
	dedupSeen[msg] = now
	dedupWrites++
	// 摊还清理过期条目：每 dedupCleanEvery 次写入才全量扫一遍。
	// 过期条目在窗口外不会再匹配命中，晚清无碍去重正确性，只影响 map 占用。
	if dedupWrites%dedupCleanEvery == 0 {
		for k, t := range dedupSeen {
			if now.Sub(t) >= scanErrorDedupWindow {
				delete(dedupSeen, k)
			}
		}
	}
	dedupMu.Unlock()
	// RWMutex 读锁保护，消除 data race。
	errorSinkMu.RLock()
	fn := errorSink
	errorSinkMu.RUnlock()
	if fn != nil {
		fn(msg)
		return
	}
	log.Printf("%s", msg)
}

// scanTTL 扫描缓存 TTL：AppConfig.ScanCacheTTLMs > 0 用之，否则默认 30s。
// 配置源收敛到 go/config 单持有点（ADR-091 D12），字段 0 = 回退包级默认。
func scanTTL() time.Duration {
	if ms := config.Get().ScanCacheTTLMs; ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	return scanCacheTTL
}

// EffectiveCacheTTL 导出当前生效的扫描缓存 TTL，供派生缓存（go/instance 同步结果、
// go/sync 扫描缓存）写缓存时取同一刷新周期——30s 刷新周期的单一事实源，
// 消除各派生缓存各自硬编码 30s 与用户配置 ScanCacheTTLMs 错位的漂移。
func EffectiveCacheTTL() time.Duration {
	return scanTTL()
}

// normalizeScanKey 统一缓存 key：TrimSpace + filepath.Clean（去尾部分隔符/相对路径归一）。
// ScanEntries 与 InvalidatePath 必须共用同一规整，否则失效 key 与扫描 key 字节级不一致会脱靶（P2 修复）。
func normalizeScanKey(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return ""
	}
	return filepath.Clean(dir)
}

// cacheInvalidators 扫描缓存失效后的派生缓存清理钩子。
// 上层（如 go/instance 的同步结果缓存）注册后，可以在 InvalidateCache/InvalidatePath
// 时同步失效，避免“磁盘已变、派生结果仍旧”。
var (
	cacheInvalidatorsMu sync.Mutex
	cacheInvalidators   []func()
)

// OnCacheInvalidated 注册一个扫描缓存失效回调。回调会在 InvalidateCache 或
// InvalidatePath 完成清理后同步调用，适合清理依赖 scanner 结果的派生缓存。
// 注册通常发生在包 init/启动期，调用方自行保证幂等。
func OnCacheInvalidated(fn func()) {
	if fn == nil {
		return
	}
	cacheInvalidatorsMu.Lock()
	cacheInvalidators = append(cacheInvalidators, fn)
	cacheInvalidatorsMu.Unlock()
}

// notifyCacheInvalidated 在锁外调用所有已注册的失效回调。
// 实现要点：先在 cacheInvalidatorsMu 保护下复制回调切片，释放锁后再遍历调用。
//
// ⚠️ 回调内禁止调用 OnCacheInvalidated（注册新回调），否则会重入 cacheInvalidatorsMu 的
// Lock 造成 self-dead锁（sync.Mutex 不可重入）。回调仅应做「清理派生缓存」等幂等操作。
func notifyCacheInvalidated() {
	cacheInvalidatorsMu.Lock()
	fns := append([]func(){}, cacheInvalidators...)
	cacheInvalidatorsMu.Unlock()
	for _, fn := range fns {
		fn()
	}
}

// InvalidateCache 清空全部扫描缓存（下载/导入/同步后调用）
func InvalidateCache() {
	cacheGen.Add(1)
	scanCache.Range(func(key, _ interface{}) bool {
		scanCache.Delete(key)
		return true
	})
	notifyCacheInvalidated()
}

// invalidateKeyVersion 原子递增指定 key 的版本戳（P1 修复：原子操作防竞态）
func invalidateKeyVersion(key string) {
	v, _ := keyVersions.LoadOrStore(key, &atomic.Uint64{})
	v.(*atomic.Uint64).Add(1)
}

// InvalidatePath 删除指定目录的扫描缓存（启用/禁用 .ban 后调用）
func InvalidatePath(dir string) {
	key := normalizeScanKey(dir)
	if key == "" {
		return
	}
	sep := string(filepath.Separator)
	// 祖先脏读修复。
	// 旧实现仅递增 key 自身 + 子孙 key 版本，不递增祖先 key 版本。
	// 若用户扫描 /a 后 InvalidatePath("/a/b")，/a 的缓存仍 30s TTL 命中，
	// 但 /a 的扫描结果可能已包含 /a/b 子树的状态 → 父缓存脏读。
	// 修复：同时递增所有祖先 key 的版本，确保父缓存也失效。
	// Windows 盘符根路径（C:\\）上 filepath.Dir 不变，
	// 旧循环无 parent==prev 守卫会无限循环。加 prev 守卫。
	ancestors := []string{key}
	{
		prev := key
		for parent := filepath.Dir(key); parent != prev; parent = filepath.Dir(parent) {
			ancestors = append(ancestors, parent)
			prev = parent
			if parent == "." || parent == string(filepath.Separator) {
				break
			}
		}
	}
	for _, anc := range ancestors {
		kv, _ := keyVersions.LoadOrStore(anc, &atomic.Uint64{})
		kv.(*atomic.Uint64).Add(1)
	}
	// 恢复 descendant keyVersion 递增。
	// 旧实现 keyVersions.Range 递增所有子孙 key 版本，拦截在途 Store。
	// 重写时丢失了这一臂，导致在途子目录扫描的陈旧结果被缓存。
	keyVersions.Range(func(k, v interface{}) bool {
		kstr := k.(string)
		if strings.HasPrefix(kstr, key+sep) {
			v.(*atomic.Uint64).Add(1)
		}
		return true
	})
	// 遍历 scanCache 删除相关条目（自身 + 子孙 + 祖先）
	scanCache.Range(func(k, _ interface{}) bool {
		kstr := k.(string)
		for _, anc := range ancestors {
			if kstr == anc || strings.HasPrefix(anc, kstr+sep) || strings.HasPrefix(kstr, anc+sep) {
				scanCache.Delete(kstr)
				return true
			}
		}
		return true
	})
	notifyCacheInvalidated()
}
