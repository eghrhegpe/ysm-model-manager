// ========== root 解析缓存组件（ADR-134 同构）==========
// 从 app_scan.go 的包级全局 `var resolvedRootCache sync.Map` 抽离为组件，
// 消除「全局可变状态跨文件隐式耦合」——与 app_container_cache.go 同构。
//
// root 来自 AppConfig 运行期极少变化，每次重算 EvalSymlinks 是扫描热路径
// （isPathInRootOrSelf 逐文件调用）的主要重复开销。组件持有 map + mutex：
// 未命中调 paths.ResolveOrKeep；saveConfig 后调 Clear 失效（roots 可能被
// 用户改指向新目录/盘符）。path 侧（clean）仍实时解析，路径中途 symlink
// 的复核语义不变。已知取舍：进程存活期内 root 自身被替换为指向外部的
// symlink 时缓存可能滞后——风险面与缓存前的 check-then-use TOCTOU 同级，
// 可接受。
//
// App 在 NewApp() 组装点无需显式注入（无 detectFn），经
// ensureResolvedRootCache() 兜底（测试用 repoApp 不经 NewApp 构造时
// 避免 nil panic）。Once.Do 确保并发调用（watcher + Wails binding 同时
// 抵达）只初始化一次。
package app

import (
	"sync"

	"ysm-model-manager/go/paths"
)

// resolvedRootCache root → EvalSymlinks 解析结果缓存组件（map[string]string）
type resolvedRootCache struct {
	mu    sync.Mutex
	items map[string]string
}

// newResolvedRootCache 构造空缓存
func newResolvedRootCache() *resolvedRootCache {
	return &resolvedRootCache{items: make(map[string]string)}
}

// LoadOrStore 命中即返回；未命中调 valFn 计算真实值后写入并返回。
// 计算期间释放锁（允许其他 goroutine 并发解析不同 root），
// 写回时若已有其他 goroutine 抢先写入，返回抢先者（与 sync.Map 语义一致）。
func (c *resolvedRootCache) LoadOrStore(key string, valFn func() string) string {
	c.mu.Lock()
	if v, ok := c.items[key]; ok {
		c.mu.Unlock()
		return v
	}
	c.mu.Unlock()

	v := valFn()

	c.mu.Lock()
	if existing, ok := c.items[key]; ok {
		c.mu.Unlock()
		return existing
	}
	c.items[key] = v
	c.mu.Unlock()
	return v
}

// Load 只读查询（未命中返回 ok=false），测试用于断言缓存写入/失效
func (c *resolvedRootCache) Load(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.items[key]
	return v, ok
}

// Store 直接写入（测试用于模拟陈旧条目），生产代码只用 LoadOrStore
func (c *resolvedRootCache) Store(key, value string) {
	c.mu.Lock()
	c.items[key] = value
	c.mu.Unlock()
}

// Clear 清空缓存（saveConfig 后失效：roots 可能被用户改指向新目录/盘符）
func (c *resolvedRootCache) Clear() {
	c.mu.Lock()
	c.items = make(map[string]string)
	c.mu.Unlock()
}

// ensureResolvedRootCache 兜底：测试用 repoApp 不经 NewApp 构造时
// resolvedRootCache 为 nil，调用前惰性初始化，避免 nil panic。
func (a *App) ensureResolvedRootCache() *resolvedRootCache {
	a.resolvedRootCacheOnce.Do(func() {
		a.resolvedRootCache = newResolvedRootCache()
	})
	return a.resolvedRootCache
}

// resolvedRoot 取 root 的解析结果（带缓存）；解析失败（root 不存在）保留
// 原路径，与 paths.ResolveOrKeep 语义一致。App 方法：isPathInRootOrSelf
// 是热路径（ScanModelEntries 等逐文件调用），root 侧每次实时解析开销大，
// path 侧（clean）仍实时解析。
func (a *App) resolvedRoot(root string) string {
	return a.ensureResolvedRootCache().LoadOrStore(root, func() string {
		return paths.ResolveOrKeep(root)
	})
}
