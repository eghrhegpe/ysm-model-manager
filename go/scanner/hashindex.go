//go:build !rust_backend

// hashindex.go — 持久哈希索引（ADR-348 B1 两阶段扫描投影：身份投影阶段）。
// 每扫描根一份 <root>/.ysm-hash-index.json（path → {size, mtime, hash}）：
// 全量扫描哈希段对 (size, mtime) 指纹命中者直接取存哈希、免读盘重算；
// 未命中真算后回写；扫描收尾按本次路径集剪枝（move/delete 自愈，无专门失效）。
package scanner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"

	"ysm-model-manager/go/fsutil"
)

// HashIndexPath 扫描根下的索引文件名（点文件：扫描白名单不纳管，repo-audit 的
// .json 桶 +1 可忽略；可移植——随仓库目录走，换机/换盘索引仍命中）
const HashIndexPath = ".ysm-hash-index.json"

// hashIndexRecord 单条指纹记录（modtime 口径 = types.ModelEntry.ModTime Unix 毫秒）
type hashIndexRecord struct {
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
	Hash  string `json:"hash"`
}

// HashIndex 扫描根专属的持久哈希索引（懒加载 + 内存写 + dirty 门控原子落盘）
type HashIndex struct {
	mu      sync.Mutex
	path    string
	records map[string]hashIndexRecord
	dirty   bool
	// loadEmpty 启动读文件损坏/不可解析 → 空表起步（自愈：Save 重写覆盖坏文件）
	loadEmpty bool
}

// OpenHashIndex 打开（或懒初始化）某扫描根的哈希索引。
// 文件不存在 = 空表（首扫全算，正常冷启动）；存在但解析失败 = 空表 + 标记待重写。
func OpenHashIndex(rootDir string) *HashIndex {
	h := &HashIndex{
		path:    filepath.Join(rootDir, HashIndexPath),
		records: map[string]hashIndexRecord{},
	}
	data, err := os.ReadFile(h.path)
	if err != nil {
		return h // 不存在/不可读 → 空表起步（目录不可写等场景 Save 自会 fail-safe）
	}
	var m map[string]hashIndexRecord
	if json.Unmarshal(data, &m) != nil || m == nil {
		h.loadEmpty = true
		return h
	}
	for p, r := range m {
		if r.Hash != "" {
			h.records[p] = r
		}
	}
	return h
}

// Lookup 指纹命中（size+mtime 双值相等）→ 存哈希；否则 "" + false
func (h *HashIndex) Lookup(path string, size, modTime int64) (string, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r, ok := h.records[path]
	if !ok || r.Hash == "" {
		return "", false
	}
	if r.Size != size || r.Mtime != modTime {
		return "", false // 内容变更（mtime/size 动了指纹）→ 强制重算
	}
	return r.Hash, true
}

// Record 回写一条（真算成功才有非空 hash；空哈希不入索引——超限/读错文件下次仍试）
func (h *HashIndex) Record(path string, size, modTime int64, hash string) {
	if hash == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.records[path] = hashIndexRecord{Size: size, Mtime: modTime, Hash: hash}
	h.dirty = true
}

// Prune 剔除不在 currentPaths 中的条目（扫描收尾调——路径消失即自愈）；有删除 → dirty
func (h *HashIndex) Prune(currentPaths map[string]struct{}) {
	h.mu.Lock()
	defer h.mu.Unlock()
	deleted := false
	for p := range h.records {
		if _, ok := currentPaths[p]; !ok {
			delete(h.records, p)
			deleted = true
		}
	}
	if deleted {
		h.dirty = true
	}
}

// Save 原子落盘（dirty 门控：稳态扫描近零写；loadEmpty 的坏表在首次有记录/剪枝后重写）
func (h *HashIndex) Save() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.dirty {
		return
	}
	data, err := json.MarshalIndent(h.records, "", "  ")
	if err != nil {
		return // 序列化失败不落盘（内存表保留，下次再试）
	}
	if err := fsutil.WriteFileAtomic(h.path, data); err != nil {
		return // 目录不可写等 fail-safe：内存表照常服务，索引丢失不影响正确性（只损失加速）
	}
	h.dirty = false
	h.loadEmpty = false
}

// HashIndexStats 观测计数（同 walkCount 范式，benchmark/CLI 消费「冷扫免哈希率」）
var (
	hashComputations atomic.Int64 // 真读盘算 SHA256 的条目数
	hashIndexHits    atomic.Int64 // 指纹命中免读盘的条目数
)

// HashIndexStatsSnapshot 当前计数快照 + 测试复位（对齐 ResetScanEngineStats 用法）
func HashIndexStatsSnapshot() (computations, hits int64) {
	return hashComputations.Load(), hashIndexHits.Load()
}

// ResetHashIndexStats 测试专用复位
func ResetHashIndexStats() {
	hashComputations.Store(0)
	hashIndexHits.Store(0)
}

// hashIndexes 按扫描根懒开的索引实例（sync.Map：rootDir → *HashIndex）
var hashIndexes sync.Map

// HashIndexFor 取某扫描根的索引实例（懒开）
func HashIndexFor(rootDir string) *HashIndex {
	if v, ok := hashIndexes.Load(rootDir); ok {
		return v.(*HashIndex)
	}
	h := OpenHashIndex(rootDir)
	actual, _ := hashIndexes.LoadOrStore(rootDir, h)
	return actual.(*HashIndex)
}
