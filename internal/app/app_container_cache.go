// ========== 容器类型指纹缓存组件（ADR-134）==========
// 从 app_scan.go 的包级全局 `var containerTypeCache sync.Map` 抽离为组件，
// 消除「全局可变状态跨文件隐式耦合」（非循环依赖——Go 编译器本就拒包级导入环，
// check-circular-go 不覆盖的对象级环已由 ADR-002 P1 回调注入破净）。
//
// 组件持有指纹 map + mutex + 可注入 detectFn（复用 DownloadQueue 回调注入范式）：
// detectFn 默认指向 packs.DetectResourceType，测试可注入假实现断言缓存短路语义，
// 无需真实容器文件。App 在 NewApp() 组装点显式注入（依赖可见），亦经
// ensureContainerCache() 兜底（测试用 repoApp 不经 NewApp 构造时避免 nil panic）。
package app

import (
	"os"
	"sync"
	"time"

	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"
)

// containerFingerprint 单文件指纹：modtime+size 命中即复用旧 detected，避免重开归档
type containerFingerprint struct {
	modTime  time.Time
	size     int64
	detected string
}

// containerTypeCache 容器类型指纹缓存组件（path → fingerprint）
type containerTypeCache struct {
	mu       sync.Mutex
	items    map[string]containerFingerprint
	detectFn func(path string, registry *types.ResourceTypeRegistry) string
}

// newContainerTypeCache 构造组件；detectFn 负责「缓存未命中时」的真实容器类型探测
func newContainerTypeCache(detectFn func(path string, registry *types.ResourceTypeRegistry) string) *containerTypeCache {
	return &containerTypeCache{
		items:    make(map[string]containerFingerprint),
		detectFn: detectFn,
	}
}

// defaultDetectFn 生产默认探测实现（指向 packs，组装点注入 App）
func defaultDetectFn(path string, registry *types.ResourceTypeRegistry) string {
	return packs.DetectResourceType(path, registry)
}

// Get 返回容器真实类型（带文件指纹缓存）；文件变化（modtime/size）时重核验
func (c *containerTypeCache) Get(path string, registry *types.ResourceTypeRegistry) string {
	info, err := os.Stat(path)
	if err != nil {
		return ""
	}
	c.mu.Lock()
	if fp, ok := c.items[path]; ok && fp.modTime.Equal(info.ModTime()) && fp.size == info.Size() {
		c.mu.Unlock()
		return fp.detected
	}
	c.mu.Unlock()

	detected := c.detectFn(path, registry)
	c.mu.Lock()
	c.items[path] = containerFingerprint{modTime: info.ModTime(), size: info.Size(), detected: detected}
	c.mu.Unlock()
	return detected
}

// Clear 清空指纹缓存（下载/导入后随扫描缓存一起失效）
func (c *containerTypeCache) Clear() {
	c.mu.Lock()
	c.items = make(map[string]containerFingerprint)
	c.mu.Unlock()
}

// ensureContainerCache 兜底：测试用 repoApp 不经 NewApp 构造时 containerCache 为 nil，
// 调用前惰性初始化为默认探测，避免 ScanModelEntriesFiltered / ClearScanCache nil panic。
// Once.Do 确保并发调用（watcher + Wails binding 同时抵达）只初始化一次（code review P3）。
func (a *App) ensureContainerCache() {
	a.containerCacheOnce.Do(func() {
		a.containerCache = newContainerTypeCache(defaultDetectFn)
	})
}
