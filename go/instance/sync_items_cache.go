package instance

import (
	"sync"
	"time"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// ========== 同步结果缓存组件 ==========
// 从 instance.go 的包级 `var syncItemsCache sync.Map` 收编为类型化组件（2026-09-14
// 锐评刀①）：消除 interface{} 断言散落（原 `v.(*syncItemsCacheEntry)`）与裸全局态。
//
// 与 internal/app.resolvedRootCache（ADR-134）的范式差异：后者可挂 App 字段随配置
// 生命周期失效；本包函数均为无接收者的包级函数（BuildSyncItems 无实例概念），
// 故组件化止步于「单例 + 类型封装」，不强行引入实例参数（改动面扩散无收益）。
//
// TTL 跟随 scanner.EffectiveCacheTTL（默认 30s）；真实数据变更由 scanner 失效
// 钩子（RegisterInvalidationHook）+ 显式 InvalidateSyncItemsCache 双路清理。

type syncItemsCacheEntry struct {
	items     []types.ResourceSyncItem
	expiresAt time.Time
}

// syncCache 整合包同步结果缓存（键为 buildSyncItemsKey 的 xxhash 十六进制摘要）
type syncCache struct {
	mu    sync.Mutex
	items map[string]*syncItemsCacheEntry
}

func newSyncCache() *syncCache {
	return &syncCache{items: make(map[string]*syncItemsCacheEntry)}
}

// get 命中未过期返回条目克隆；命中已过期惰性删除并返回未命中（调用方重算）。
// 读写同一把锁：BuildSyncItems 单次调用只触及一次缓存，无并发热点，从简。
func (c *syncCache) get(key string) ([]types.ResourceSyncItem, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.items[key]
	if !ok {
		return nil, false
	}
	if time.Now().Before(entry.expiresAt) {
		return cloneSyncItems(entry.items), true
	}
	delete(c.items, key)
	return nil, false
}

// put 写入缓存（items 由调用方传入克隆件，组件不再复制——调用点已就近 clone）
func (c *syncCache) put(key string, items []types.ResourceSyncItem) {
	c.putAt(key, items, time.Now().Add(scanner.EffectiveCacheTTL()))
}

// putAt 写入并显式指定过期时刻（生产走 put；测试用它构造长寿命哨兵条目）
func (c *syncCache) putAt(key string, items []types.ResourceSyncItem, expiresAt time.Time) {
	c.mu.Lock()
	c.items[key] = &syncItemsCacheEntry{
		items:     items,
		expiresAt: expiresAt,
	}
	c.mu.Unlock()
}

// peek 只查存在性（含过期惰性删除），不返回数据（测试断言缓存写入/失效用）
func (c *syncCache) peek(key string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.items[key]
	if !ok {
		return false
	}
	if !time.Now().Before(entry.expiresAt) {
		delete(c.items, key)
		return false
	}
	return true
}

// clear 清空全部条目（scanner 失效钩子与显式失效入口共用）
func (c *syncCache) clear() {
	c.mu.Lock()
	c.items = make(map[string]*syncItemsCacheEntry)
	c.mu.Unlock()
}
