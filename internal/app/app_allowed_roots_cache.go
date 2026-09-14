// ========== 允许根清单缓存组件（ADR-134 同构）==========
// allAllowedRoots（配置层根 + 派生 ysm 仓库根）在 isPathInRootOrSelf 逐文件
// 热路径中被反复调用，每次重算 LoadAppConfig + GetRepoRoot（含注册表查询，
// Android 查看器模式下还含文件系统 stat）是主要重复开销。根清单在运行期仅
// saveConfig 时变化——与本组件同失效范式的 resolvedRootCache 对齐：
// saveConfig 后 Clear，热路径命中后短路。
package app

import "sync"

// allowedRootsCache 允许根清单缓存（缓存 allAllowedRoots 结果）。
type allowedRootsCache struct {
	mu     sync.Mutex
	cached []string
	loaded bool
}

// newAllowedRootsCache 构造空缓存
func newAllowedRootsCache() *allowedRootsCache {
	return &allowedRootsCache{}
}

// Get 命中即返回；未命中调 computeFn 计算并缓存。
// computeFn 在锁外执行（允许并发 miss 时各自计算，写回时首次获胜者生效——
// 与 resolvedRootCache.LoadOrStore 同语义）。
func (c *allowedRootsCache) Get(computeFn func() []string) []string {
	c.mu.Lock()
	if c.loaded {
		v := c.cached
		c.mu.Unlock()
		return v
	}
	c.mu.Unlock()

	v := computeFn()

	c.mu.Lock()
	if c.loaded {
		existing := c.cached
		c.mu.Unlock()
		return existing
	}
	c.cached = v
	c.loaded = true
	c.mu.Unlock()
	return v
}

// Clear 清空缓存（saveConfig 后失效：根清单可能被用户改向新目录）
func (c *allowedRootsCache) Clear() {
	c.mu.Lock()
	c.cached = nil
	c.loaded = false
	c.mu.Unlock()
}

// ensureAllowedRootsCache 兜底：测试用 repoApp 不经 NewApp 构造时缓存为 nil，
// 调用前惰性初始化，避免 nil panic。Once.Do 确保并发调用只初始化一次。
func (a *App) ensureAllowedRootsCache() *allowedRootsCache {
	a.allowedRootsCacheOnce.Do(func() {
		a.allowedRootsCache = newAllowedRootsCache()
	})
	return a.allowedRootsCache
}
