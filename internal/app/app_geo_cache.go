// ========== 几何分析结果缓存组件（ADR-134 同构）==========
// 收敛 SearchModels 每次重跑 AnalyzeBedrockModel 的重复开销：.ysm 二进制几何分析
// 要拉 Node+WASM 子进程解码，是全仓扫描/搜索热路径里最贵的单步；Bedrock/zip/7z/json
// 解析同样逐文件重开归档或重读磁盘。ModelEntry 不含几何字段（types.go:24-44）、
// 扫描层也不填（grep 零命中），故几何分析结果此前零缓存——同一文件每次关键词/范围
// 搜索都被重新解析。组件以「stripped path + 文件指纹(modtime/size)」为键复用结果，
// 与 containerTypeCache/resolvedRootCache 同范：struct{mu;items}+NewApp 注入+
// ensure 兜底 + Clear 失效；失效挂在 ClearScanCache（下载/导入后模型几何可能变化）。
//
// 文件变动（modtime/size）即命中失效，重新计算真实几何；文件不可 stat（路径越权 / 禁用
// 后缀剥离后指向不存在文件）不缓存、直接算，避免缓存垃圾键。锁内只做 map 读写，
// 计算（compute）在锁外执行，与扫描缓存组件一致。
package app

import (
	"os"
	"sync"
	"time"

	"ysm-model-manager/go/types"
)

// geoCacheEntry 单文件几何分析结果：modtime+size 命中即复用旧 BedrockModel
type geoCacheEntry struct {
	modTime time.Time
	size    int64
	model   types.BedrockModel
}

// geoCache 几何分析结果缓存组件（path → entry）
type geoCache struct {
	mu    sync.Mutex
	items map[string]geoCacheEntry
}

// newGeoCache 构造空缓存
func newGeoCache() *geoCache {
	return &geoCache{items: make(map[string]geoCacheEntry)}
}

// Get 返回路径的几何分析结果（带文件指纹缓存）；文件变化（modtime/size）时重算。
// compute 负责「缓存未命中时」的真实 AnalyzeBedrockModel，调用方已剥禁用后缀并做
// 路径守卫，故 key 用 cleaned path；compute 内防御性复核（幂等）。
func (c *geoCache) Get(path string, compute func() types.BedrockModel) types.BedrockModel {
	info, err := os.Stat(path)
	if err != nil {
		// 不可 stat：不缓存，直接算（返回当前真实结果，含越权/不存在的空值）
		return compute()
	}
	c.mu.Lock()
	if e, ok := c.items[path]; ok && e.modTime.Equal(info.ModTime()) && e.size == info.Size() {
		c.mu.Unlock()
		return e.model
	}
	c.mu.Unlock()

	m := compute()
	c.mu.Lock()
	c.items[path] = geoCacheEntry{modTime: info.ModTime(), size: info.Size(), model: m}
	c.mu.Unlock()
	return m
}

// Load 只读查询（未命中返回 ok=false），测试用于断言缓存写入/命中语义
func (c *geoCache) Load(path string) (types.BedrockModel, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[path]
	return e.model, ok
}

// Clear 清空几何缓存（下载/导入后随扫描缓存一起失效）
func (c *geoCache) Clear() {
	c.mu.Lock()
	c.items = make(map[string]geoCacheEntry)
	c.mu.Unlock()
}

// ensureGeoCache 兜底：测试用 repoApp 不经 NewApp 构造时 geoCache 为 nil，
// 调用前惰性初始化，避免 AnalyzeBedrockModel / ClearScanCache nil panic。
// Once.Do 确保并发调用（watcher + Wails binding 同时抵达）只初始化一次。
func (a *App) ensureGeoCache() *geoCache {
	a.geoCacheOnce.Do(func() {
		a.geoCache = newGeoCache()
	})
	return a.geoCache
}
