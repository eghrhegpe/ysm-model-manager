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
//
// 字节预算封顶（2026-10-14 锐评 P2：桌面应用长驻，原实现无界 map——BedrockModel 含
// base64 纹理，万级模型库一轮全量搜索可驻留数百 MB 直到下次导入 Clear）：
// 预算 geoCacheMaxBytes（128MB），条目成本按 geoCacheEntryBytes 估算（base64 纹理占
// 绝对大头，只要求单调稳定不要求精确）；超预算按 FIFO 逐出最旧条目，单条超预算时
// 只保留该条（不逐出到 0，保证至少 1 条命中）。
package app

import (
	"os"
	"sync"
	"time"

	"ysm-model-manager/go/types"
)

// geoCacheMaxBytes 几何缓存字节预算：条目成本（base64 纹理为主）累计超此值按 FIFO 逐出。
// 128MB 量级 = 桌面常驻进程可接受上限（纹理缓存 texture_cache 另有内容哈希存储，
// 本缓存只是搜索热路径的进程内复用层，淘汰后可重算，丢得起）。
const geoCacheMaxBytes = 128 << 20

// geoCacheEntry 单文件几何分析结果：modtime+size 命中即复用旧 BedrockModel
type geoCacheEntry struct {
	modTime time.Time
	size    int64
	model   types.BedrockModel
	bytes   int // 条目成本（geoCacheEntryBytes，入账/逐出按此扣减）
}

// geoCache 几何分析结果缓存（path → entry，带字节预算）
type geoCache struct {
	mu         sync.Mutex
	items      map[string]geoCacheEntry
	order      []string // FIFO 插入序（仅首次插入 append，覆盖不挪槽）；head 逐出指针
	head       int      // 逐出指针（到达 len(order) 时压缩复位，摊还 O(1)）
	totalBytes int
	maxBytes   int
}

// newGeoCache 构造空缓存（生产路径，默认字节预算 geoCacheMaxBytes）
func newGeoCache() *geoCache {
	return newGeoCacheWithMax(geoCacheMaxBytes)
}

// newGeoCacheWithMax 构造指定字节预算的缓存（同包测试 seam：小预算触发逐出断言；
// 生产恒走 newGeoCache，预算不开放配置——调参属于发版决策，届时再上移 AppConfig）。
func newGeoCacheWithMax(maxBytes int) *geoCache {
	return &geoCache{items: make(map[string]geoCacheEntry), maxBytes: maxBytes}
}

// geoCacheEntryBytes 估算条目成本：base64 纹理（Texture/Textures/ComponentTextures）是
// 绝对大头；Bones（含 Cubes）/Animations 按条目数粗估——成本只要求单调、稳定，
// 不要求精确字节（预算是「量级」控制，不是会计账）。
func geoCacheEntryBytes(m types.BedrockModel) int {
	n := len(m.Texture)
	for _, t := range m.Textures {
		n += len(t)
	}
	for _, ts := range m.ComponentTextures {
		for _, t := range ts {
			n += len(t)
		}
	}
	n += len(m.Bones) * 256
	n += len(m.Animations) * 1024
	return n
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
	if m.BoneCount == 0 {
		// 解析失败（空结果）不缓存：.ysm WASM 解码临时挂起 / 文件越权等失败若被固化，
		// 模型会在后续搜索里「永久消失」直到 ClearScanCache（假绿）。代价是失败模型下次
		// 重试——数量有限（通常是坏档），可接受；对齐 contract-b1「BoneCount==0 = 无内容」。
		// 锐评 2026-10-09 补齐：原实现无条件缓存空结果。
		return m
	}
	c.mu.Lock()
	c.storeLocked(path, info, m)
	c.mu.Unlock()
	return m
}

// storeLocked 写入条目并逐出至预算内（须持 c.mu 调用）。
// 覆盖既有键时先扣旧条目成本再入账新值；order 只按首次插入记账（覆盖不提升优先级，
// FIFO 口径 = 首次插入序），逐出指针推进时命中「已被覆盖」的槽按 items 中当前值扣账、
// 命中「已删除」的槽跳过——账目始终自洽。
// 新键的尾槽（刚写入的条目）是逐出上界：单条超预算时逐光其余、保留该条（不逐出到 0，
// 保证至少 1 条命中）。
func (c *geoCache) storeLocked(path string, info os.FileInfo, m types.BedrockModel) {
	e := geoCacheEntry{modTime: info.ModTime(), size: info.Size(), model: m, bytes: geoCacheEntryBytes(m)}
	var limit int // 可逐出槽位上界（exclusive）
	if old, ok := c.items[path]; ok {
		// 覆盖：order 尾部无新槽，逐出可推进到尾部（旧槽按插入序，可能先于后插条目被逐）
		c.totalBytes -= old.bytes
		limit = len(c.order)
	} else {
		c.order = append(c.order, path)
		limit = len(c.order) - 1 // 新写入条目的尾槽不可被本次逐出
	}
	c.items[path] = e
	c.totalBytes += e.bytes
	for c.totalBytes > c.maxBytes && c.head < limit {
		k := c.order[c.head]
		c.head++
		if cur, ok := c.items[k]; ok {
			delete(c.items, k)
			c.totalBytes -= cur.bytes
		}
	}
	// 环压缩：逐出指针到达尾部时回收前缀（摊还 O(1)，避免 order 无限增长）
	if c.head > 0 && c.head == len(c.order) {
		c.order = c.order[:0]
		c.head = 0
	}
}

// Load 只读查询（未命中返回 ok=false），测试用于断言缓存写入/命中语义
func (c *geoCache) Load(path string) (types.BedrockModel, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[path]
	return e.model, ok
}

// Clear 清空几何缓存（下载/导入后随扫描缓存一起失效），并复位逐出记账
func (c *geoCache) Clear() {
	c.mu.Lock()
	c.items = make(map[string]geoCacheEntry)
	c.order = nil
	c.head = 0
	c.totalBytes = 0
	c.mu.Unlock()
}

// ensureGeoCache 兜底：测试用 repoApp 不经 NewApp 构造时 geoCache 为 nil，
// 调用前惰性初始化为默认预算，避免 AnalyzeBedrockModel / ClearScanCache nil panic。
// Once.Do 确保并发调用（watcher + Wails binding 同时抵达）只初始化一次。
func (a *App) ensureGeoCache() *geoCache {
	a.geoCacheOnce.Do(func() {
		a.geoCache = newGeoCache()
	})
	return a.geoCache
}
