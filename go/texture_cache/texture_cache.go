// Package texture_cache 提供纹理缓存目录管理和 KTX2 缓存读写。
// 与 avatar 包同构：缓存目录收敛到平台数据根，SHA256 内容哈希做 key，
// 不受文件路径变动影响（模型重命名/移动后缓存仍然命中）。
//
// 使用方式：
//
//	hash, err := texture_cache.TextureHash(pngPath)
//	data, ok, err := texture_cache.ReadCached(hash)
//	if ok { /* 用 KTX2 data */ }
package texture_cache

import (
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ysm-model-manager/go/fsutil"
)

// CacheDir 返回纹理缓存目录。
// 默认走 os.UserConfigDir()/YSM-Model-Manager/texture_cache（与 avatar 同根，ADR-046 P2）。
// 外部可覆盖此函数（internal/app 启动期注入平台数据根；测试可设置临时目录）。
// 并发契约：写入仅允许在启动期 / 测试 setup 发生，运行期视为只读常量——
// 包级函数变量无内置并发防护，运行期写入须自行承担同步责任（跨测试污染同理）。
var CacheDir = func() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		return "" // 平台配置根不可用：no-op
	}
	return filepath.Join(base, "YSM-Model-Manager", "texture_cache")
}

// TextureHash 计算文件内容的 SHA256 哈希，用作缓存 key。
// 哈希基于文件内容而非路径，模型重命名/移动后缓存仍然命中。
func TextureHash(path string) (string, error) {
	hash, err := fsutil.SHA256File(path)
	if err != nil {
		return "", fmt.Errorf("texture_cache: 计算哈希 %s: %w", path, err)
	}
	return hash, nil
}

// CachePath 返回给定哈希对应的缓存文件路径。
func CachePath(hash string) string {
	dir := CacheDir()
	if dir == "" {
		return ""
	}
	return filepath.Join(dir, hash+".ktx2")
}

// ReadCached 读取缓存中的 KTX2 数据。
// ok=false 表示缓存未命中（非错误）。
func ReadCached(hash string) (data []byte, ok bool, err error) {
	path := CachePath(hash)
	if path == "" {
		return nil, false, nil
	}
	// 一步 ReadFile + fs.ErrNotExist 判定：不做 Stat-then-Read（TOCTOU 竞态——
	// 两步之间文件可能被 Prune 删除，旧实现会把删除竞态误报为读错误而非 miss）。
	data, err = os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, false, nil // 缓存未命中（含并发淘汰竞态），非错误
		}
		return nil, false, fmt.Errorf("texture_cache: 读取缓存 %s: %w", path, err)
	}
	return data, true, nil
}

// WriteCached 写入 KTX2 数据到缓存。
// 自动创建缓存目录（如果不存在）。
func WriteCached(hash string, data []byte) error {
	dir := CacheDir()
	if dir == "" {
		return fmt.Errorf("texture_cache: 缓存目录不可用")
	}
	if err := os.MkdirAll(dir, fsutil.DirPerms); err != nil {
		return fmt.Errorf("texture_cache: 创建缓存目录 %s: %w", dir, err)
	}
	path := filepath.Join(dir, hash+".ktx2")
	if err := fsutil.WriteFileAtomic(path, data); err != nil {
		return fmt.Errorf("texture_cache: 写入缓存 %s: %w", path, err)
	}
	// 写后限频淘汰：缓存只增不减会长期膨胀，写路径是最自然的收敛触发点
	maybePrune()
	return nil
}

// HasCached 检查缓存中是否存在指定哈希的 KTX2 文件。
func HasCached(hash string) (bool, error) {
	path := CachePath(hash)
	if path == "" {
		return false, nil
	}
	_, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// ClearCache 清空纹理缓存目录（用于测试或用户主动清理）。
func ClearCache() error {
	dir := CacheDir()
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if err := os.Remove(p); err != nil {
			log.Printf("texture_cache: 清理缓存文件 %s: %v", p, err)
		}
	}
	return nil
}

// cacheScanEntry 缓存目录扫描单条目。
type cacheScanEntry struct {
	path string
	name string
	size int64
	mod  time.Time
	tmp  bool // 写入中间产物 .tmp（仅 Prune 按 TTL 关注，不占容量预算）
}

// scanCacheDir 扫描缓存目录：ReadDir 一次 + 逐文件 stat，过滤 .ktx2/.tmp。
// 目录不存在返回 (nil, nil)（消费方按空目录语义处理）；stat 失败单条跳过并留日志。
// ListCacheFiles / GetCacheStats / Prune 三处原各自 ReadDir+过滤+stat 的
// 重复遍历收敛至此单一来源（外部锐评 2026-09：三份近亲遍历）。
func scanCacheDir(dir string) ([]cacheScanEntry, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	files := make([]cacheScanEntry, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		isTmp := strings.HasSuffix(name, ".tmp")
		if !isTmp && !strings.HasSuffix(name, ".ktx2") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			log.Printf("texture_cache: 扫描跳过无法 stat 的文件 %s: %v", filepath.Join(dir, name), err)
			continue
		}
		files = append(files, cacheScanEntry{
			path: filepath.Join(dir, name),
			name: name,
			size: info.Size(),
			mod:  info.ModTime(),
			tmp:  isTmp,
		})
	}
	return files, nil
}

// CacheEntry 缓存条目信息
type CacheEntry struct {
	Hash string
	Path string
	Size int64
}

// ListCacheFiles 列出所有缓存文件
func ListCacheFiles() ([]CacheEntry, error) {
	dir := CacheDir()
	if dir == "" {
		return nil, nil
	}

	files, err := scanCacheDir(dir)
	if err != nil {
		return nil, err
	}

	var result []CacheEntry
	for _, f := range files {
		if f.tmp {
			continue // .tmp 中间产物不是缓存条目
		}
		result = append(result, CacheEntry{
			Hash: strings.TrimSuffix(f.name, ".ktx2"),
			Path: f.path,
			Size: f.size,
		})
	}
	return result, nil
}

// CacheStats 缓存统计信息
type CacheStats struct {
	Dir        string
	FileCount  int
	TotalSize  int64
	ShouldWarn bool // 容量接近上限（> 0.8 * maxCacheBytes）时置真，体检页提示清理
}

// GetCacheStats 获取缓存统计
func GetCacheStats() CacheStats {
	dir := CacheDir()
	stats := CacheStats{Dir: dir}

	if dir == "" {
		return stats
	}

	// 统计只读：扫描错误按旧语义忽略（返回零值统计，不阻断体检页）
	files, _ := scanCacheDir(dir)
	for _, f := range files {
		if f.tmp {
			continue // .tmp 写入中间产物不计容量统计
		}
		stats.FileCount++
		stats.TotalSize += f.size
	}

	// 容量告警：接近上限（> 0.8 * maxCacheBytes）即提示，早于淘汰阈值预警清理。
	// 阈值经 pruneMu 快照（与 Prune 同范式），避免与 SetCacheLimits 并发写竞争。
	pruneMu.Lock()
	maxBytes := maxCacheBytes
	pruneMu.Unlock()
	stats.ShouldWarn = maxBytes > 0 && stats.TotalSize > maxBytes*4/5

	return stats
}

// ===== 缓存淘汰（容量上限 + TTL）=====
// 默认限制：容量 1GB（与 repoaudit warnCacheSizeGB 对齐）、TTL 30 天、写后每 5 分钟扫一次。
// 缓存是衍生数据，删错可经 WriteCached 重新生成，故淘汰失败仅记录日志、不中断写入。

var (
	maxCacheBytes = int64(1 << 30)      // 容量上限（0 = 不限）
	maxEntryAge   = 30 * 24 * time.Hour // 条目 TTL（0 = 不按 TTL 删）
	pruneInterval = 5 * time.Minute     // 写路径限频间隔（0 = 每次写都触发）
	pruneMu       sync.Mutex            // 保护 lastPrune 与 SetCacheLimits 的并发读写
	lastPrune     time.Time
	pruneInFlight atomic.Bool // 后台淘汰防重入：已有 Prune 在跑时跳过本轮（限频下轮写再触发）
	// removeFile 删除实现：测试可注入替换以模拟删除失败（P2 记账失真回归）
	removeFile = os.Remove
)

// SetCacheLimits 覆盖淘汰阈值（测试/配置注入用）。
// maxBytes<=0 表示不限容量；maxAge<=0 表示不按 TTL 删；interval<=0 表示每次写入都触发淘汰。
// 锁内写包级变量，与 maybePrune 的限频读互斥；但仍须在任何并发写/淘汰开始之前调用
// （Prune 内读取阈值不加锁——运行时阈值应视为启动期常量）。
func SetCacheLimits(maxBytes int64, maxAge, interval time.Duration) {
	pruneMu.Lock()
	defer pruneMu.Unlock()
	maxCacheBytes = maxBytes
	maxEntryAge = maxAge
	pruneInterval = interval
}

// PruneResult 一次淘汰的结果（供日志与测试断言）
type PruneResult struct {
	RemovedCount int   // 成功删除的文件数
	FreedBytes   int64 // 释放的字节
	KeptCount    int   // 保留的文件数
	Remaining    int64 // 保留的总字节
}

// Prune 淘汰纹理缓存：先清超龄（TTL），再按容量从最旧删到上限内。
// 可被 repoaudit / CLI / 应用启动按需调用；WriteCached 写路径也会限频自动触发。
func Prune() (PruneResult, error) {
	var res PruneResult
	dir := CacheDir()
	if dir == "" {
		return res, nil // 平台配置根不可用：no-op
	}
	// 快照阈值：SetCacheLimits 在 pruneMu 下写，这里在 pruneMu 下读，
	// 避免 concurrent SetCacheLimits + Prune 的数据竞争。
	pruneMu.Lock()
	maxBytes := maxCacheBytes
	maxAge := maxEntryAge
	pruneMu.Unlock()
	files, err := scanCacheDir(dir)
	if err != nil {
		return res, fmt.Errorf("texture_cache: 扫描缓存目录 %s: %w", dir, err)
	}
	totalFiles := len(files)
	now := time.Now()

	// 最旧优先排序（确定性：同 mtime 按路径字典序）
	sort.SliceStable(files, func(i, j int) bool {
		if !files[i].mod.Equal(files[j].mod) {
			return files[i].mod.Before(files[j].mod)
		}
		return files[i].path < files[j].path
	})

	// remove 成功返回 true 才记账——删除失败（占用/只读）不得虚报 FreedBytes、
	// 不得低估 Remaining，且容量段失败时不减 total（继续尝试下一个直到达标）。
	remove := func(p string) bool {
		if err := removeFile(p); err != nil {
			log.Printf("texture_cache: 淘汰删除失败 %s: %v", p, err)
			return false
		}
		res.RemovedCount++
		return true
	}

	// 1) TTL：超龄文件直接删（mtime 近似最后写入，LRU 语义）；.tmp 崩溃残留顺带清超龄。
	//    删除失败的超龄文件留在 kept，Remaining 如实反映磁盘现状，下轮自愈。
	if maxAge > 0 {
		cutoff := now.Add(-maxAge)
		kept := files[:0]
		for _, f := range files {
			if f.mod.Before(cutoff) && remove(f.path) {
				// .tmp 崩溃残留不是缓存条目，不计 FreedBytes（F-12 统计口径修复）
				if !strings.HasSuffix(f.path, ".tmp") {
					res.FreedBytes += f.size
				}
				continue
			}
			kept = append(kept, f)
		}
		files = kept
	}

	// 2) 容量：.ktx2 总大小超上限，从最旧删到达标（.tmp 不占容量预算）
	if maxBytes > 0 {
		var total int64
		for _, f := range files {
			if f.tmp {
				continue
			}
			total += f.size
		}
		for _, f := range files {
			if f.tmp {
				continue
			}
			if total <= maxBytes {
				break
			}
			if remove(f.path) {
				total -= f.size
				res.FreedBytes += f.size
			}
		}
		res.Remaining = total
	} else {
		var total int64
		for _, f := range files {
			if f.tmp {
				continue
			}
			total += f.size
		}
		res.Remaining = total
	}

	res.KeptCount = totalFiles - res.RemovedCount
	return res, nil
}

// maybePrune 写路径限频触发：距上次扫描未达间隔则跳过，避免每次写都 O(n) 扫目录。
// lastPrune 在锁内更新后于锁外执行 Prune，避免慢扫描阻塞并发写。
// 异步分叉（2026-09 外部锐评 #7）：interval>0（生产限频配置）时后台执行，
// 淘汰的 O(n) 目录扫描不阻塞 WriteCached 调用方 goroutine（若调用发生在 UI 绑定
// 线程上，同步扫描上千文件的缓存目录会冻结界面）；interval<=0（测试/调试配置，
// 每次写都触发）保持同步，便于测试直连断言。pruneInFlight 防后台重入：
// 已有 Prune 在跑时跳过本轮，限频语义下由后续写再触发。
func maybePrune() {
	pruneMu.Lock()
	if pruneInterval > 0 && !lastPrune.IsZero() && time.Since(lastPrune) < pruneInterval {
		pruneMu.Unlock()
		return
	}
	lastPrune = time.Now()
	pruneMu.Unlock()

	if pruneInterval <= 0 {
		if _, err := Prune(); err != nil {
			log.Printf("texture_cache: 写后淘汰失败: %v", err)
		}
		return
	}
	if !pruneInFlight.CompareAndSwap(false, true) {
		return // 已有淘汰在跑：跳过本轮（限频下轮写再触发）
	}
	go func() {
		defer pruneInFlight.Store(false)
		if _, err := Prune(); err != nil {
			log.Printf("texture_cache: 写后淘汰失败: %v", err)
		}
	}()
}
