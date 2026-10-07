// scanner_lite.go：轻量目录遍历（作者提取专用，原 scanner.go 拆分，2026-10 文件行数治理）。
// ScanEntriesLite / ScanEntriesLiteCtx——与 ScanEntries 同一套过滤口径但不读文件信息、
// 不读不写共享 scanCache（避免哈希空条目污染缓存）。
package scanner

import (
	"context"
	"io/fs"
	"os"
	"sort"
	"sync"

	"ysm-model-manager/go/types"
)

// ========== 作者提取 ==========

// ScanEntriesLite 轻量目录遍历（作者提取专用）：与 ScanEntries 同一套过滤口径
// （recycle/.github/禁用后缀目录跳过、扩展名白名单、.json 仅放行 ysm.json、
// 文件级禁用恢复扩展名），但不读文件信息（Size/ModTime/Hash 恒零值）、
// 不读不写共享 scanCache——无哈希条目一旦入缓存，同步系统 GetInstanceStatus
// 会把对应文件当「哈希为空」静默跳过；作者提取只消费 Name/Path，
// 跳过逐文件 open+hash 后冷扫成本降为纯目录枚举（大库首屏关键路径优化）。
// 不设独立缓存：调用方（前端 withCached / CLI 单次调用）自行决定复用策略。
func ScanEntriesLite(dir string) []types.ModelEntry {
	return ScanEntriesLiteCtx(context.Background(), dir)
}

// ScanEntriesLiteCtx 同 ScanEntriesLite，ctx 取消时中止 walk（ADR-197），
// 返回已收集的部分结果。
func ScanEntriesLiteCtx(ctx context.Context, dir string) []types.ModelEntry {
	dir = normalizeScanKey(dir)
	if dir == "" {
		return []types.ModelEntry{}
	}
	entries := []types.ModelEntry{}
	var entriesMu sync.Mutex
	_ = walkDirParallel(dir, func(p string, d os.DirEntry, err error) error {
		if ctx.Err() != nil {
			return fs.SkipAll
		}
		entry, walkRet, _ := processScanDirEntry(p, d, err, dir, false, false)
		if walkRet != nil {
			return walkRet
		}
		if entry != nil {
			entriesMu.Lock()
			entries = append(entries, *entry)
			entriesMu.Unlock()
		}
		return nil
	})
	// 并行遍历产出非确定顺序——按路径排序恢复 filepath.WalkDir 的字典序口径
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})
	return entries
}
