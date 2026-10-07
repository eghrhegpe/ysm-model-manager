// sync_dirlevel_diff.go：文件夹内容差异比对（原 sync_dirlevel.go 拆分，2026-10 文件行数治理）。
// FileDiffEntry / DiffFolderContents / DiffFolderContentsScan / collectFolderFiles——
// 两侧文件夹文件清单/哈希差异，产出 FileDiffEntry 列表。
package sync

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

type FileDiffEntry struct {
	RelPath string           `json:"relPath"` // 相对于文件夹根的路径
	AbsPath string           `json:"absPath"` // 绝对路径
	Size    int64            `json:"size"`
	Status  types.SyncStatus `json:"status"` // synced/missing/optional/diverged
}

// diffFolderContentsCore 以全局/实例两侧文件映射计算子文件级同步 diff。
// 收集方式（Walk 走盘 / scanner 反推）由调用方决定，本函数只做差异聚合，
// 故 DiffFolderContents 与 DiffFolderContentsScan 共用、零行为漂移（ADR-140 L3）。
//
// globalHash/instanceHash 为 relKey→摘要（可 nil）：两侧均命中哈希时比哈希，
// 异哈希 → Diverged（消除「改内容不改大小」假绿，D2′-c 盲区③）；
// 任一侧缺哈希（Walk 侧无摘要）→ 回退比 Size，Size 异亦 → Diverged；
// 均无差异 → Synced。nil,nil 时退化为纯 Size 对比，与原「存在即 Synced」相比
// 收紧了大小口径，但 DiffFolderContents（无 scanFn 公共入口）两侧均走 Walk，
// Size 相等即 Synced，行为等价无回归。
func diffFolderContentsCore(globalFiles, instanceFiles map[string]string, globalHash, instanceHash map[string]string) []FileDiffEntry {
	// contentStatus 判定两侧均存在的同名文件：哈希优先、Size 兜底。
	contentStatus := func(relKey, gPath, iPath string) types.SyncStatus {
		if gh, ih := globalHash[relKey], instanceHash[relKey]; gh != "" && ih != "" {
			if gh != ih {
				return types.SyncStatusDiverged
			}
			return types.SyncStatusSynced
		}
		if gSize, iSize := fsutil.FileSize(gPath), fsutil.FileSize(iPath); gSize != iSize {
			return types.SyncStatusDiverged
		}
		return types.SyncStatusSynced
	}
	var diffs []FileDiffEntry
	seen := make(map[string]bool)

	// 检查全局有但实例没有的文件（missing，可推送）
	for relKey, gEntry := range globalFiles {
		seen[relKey] = true
		if iEntry, exists := instanceFiles[relKey]; exists {
			// 两侧都有 → 内容级判定（哈希优先/Size 兜底），异则 Diverged
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: gEntry,
				Size:    fsutil.FileSize(gEntry),
				Status:  contentStatus(relKey, gEntry, iEntry),
			})
		} else {
			// 全局有、实例没有 → missing
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: gEntry,
				Size:    fsutil.FileSize(gEntry),
				Status:  types.SyncStatusMissing,
			})
		}
	}

	// 检查实例有但全局没有的文件（optional，可拉取）
	for relKey, iEntry := range instanceFiles {
		if !seen[relKey] {
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: iEntry,
				Size:    fsutil.FileSize(iEntry),
				Status:  types.SyncStatusOptional,
			})
		}
	}

	sort.Slice(diffs, func(i, j int) bool {
		return diffs[i].RelPath < diffs[j].RelPath
	})
	return diffs
}

// DiffFolderContents 对同名文件夹进行内容级 diff
// 扫描两侧文件夹内的模型文件，比较差异，返回子文件级别的同步状态
// 用于在文件夹级同步单元内恢复单文件粒度的同步信息
//
// 参数：
//
//	globalFolder: 全局仓库侧的文件夹绝对路径
//	instanceFolder: 实例侧的文件夹绝对路径
//	rtype: 资源类型 ID（用于识别模型文件）
//
// 返回：
//
//	[]FileDiffEntry: 子文件级别的同步状态列表
//
// 设计原则：
//   - 只扫描模型文件（通过 IsTypeModelFile 过滤）
//   - 使用相对路径作为 key，保留层级信息
//   - 返回全局侧文件清单（synced 条目含在结果中——前端子文件列表需全量展示；
//     差异判定由调用方按 Status 区分——注释对齐实现）
func DiffFolderContents(globalFolder, instanceFolder, rtype string) []FileDiffEntry {
	// 扫描全局文件夹内的模型文件
	globalFiles := collectFolderFiles(globalFolder, rtype)
	// 扫描实例文件夹内的模型文件
	instanceFiles := collectFolderFiles(instanceFolder, rtype)
	return diffFolderContentsCore(globalFiles, instanceFiles, nil, nil)
}

// DiffFolderContentsScan 同 DiffFolderContents，但全局侧文件收集复用 scanner 已缓存的
// 组根扫描结果（scanFn(globalRoot)），避免对每个模型夹重复 Walk 全局子树。
// 实例侧优先 scanner 反推（拿到哈希），未命中回退 Walk（collectFolderFiles，无哈希 →
// contentStatus 比 Size）——实例夹通常不在 globalRoot 下，scanFn 未必覆盖。
//
// cacheHit=false（缓存未命中/含嵌套模式类型）时整体回退 DiffFolderContents，零行为漂移。
// scanFn 签名与 SyncResourcesDirLevelScan 一致：func(dir string) ([]types.ModelEntry, bool)。
func DiffFolderContentsScan(globalFolder, instanceFolder, rtype string, scanFn ScanEntriesFn, globalRoot string) []FileDiffEntry {
	if scanFn == nil || len(registry.NestedPatternsFor(rtype)) > 0 {
		// 含嵌套模式类型不参与反推（语义由 Walk 保证）；未注入则回退
		return DiffFolderContents(globalFolder, instanceFolder, rtype)
	}
	entries, hit := scanFn(globalRoot)
	if !hit || len(entries) == 0 {
		return DiffFolderContents(globalFolder, instanceFolder, rtype)
	}
	// 全局侧：从组根全量条目按 globalFolder 前缀过滤（零 Walk），并旁挂哈希
	globalFiles, globalHash := collectFolderFilesFromScan(globalFolder, rtype, entries)
	// 实例侧：优先尝试 scanner 反推（拿到哈希）；实例夹通常不在 globalRoot 下，
	// scanFn 未命中时回退 collectFolderFiles（Walk，无哈希 → contentStatus 比 Size）。
	var instanceFiles, instanceHash map[string]string
	if instEntries, instHit := scanFn(instanceFolder); instHit && len(instEntries) > 0 {
		instanceFiles, instanceHash = collectFolderFilesFromScan(instanceFolder, rtype, instEntries)
	} else {
		instanceFiles = collectFolderFiles(instanceFolder, rtype)
	}
	return diffFolderContentsCore(globalFiles, instanceFiles, globalHash, instanceHash)
}

// collectFolderFilesFromScan 从 scanner 已缓存的组根全量条目中，过滤出 folder 下的
// 模型文件（相对 folder 的 slash 路径为 key）。与 collectFolderFiles（Walk）语义等价：
// 仅收集 IsTypeModelFile 命中的文件，跳过回收站目录。
// 第二返回值 relKey→哈希：仅当条目携带非空摘要（e.Hash != ""）时填充，
// 供 diffFolderContentsCore 做 D2′-c 内容级判定；无摘要侧留空 → 上层回退 Size。
func collectFolderFilesFromScan(folder, rtype string, entries []types.ModelEntry) (map[string]string, map[string]string) {
	result := make(map[string]string)
	hashes := make(map[string]string)
	if folder == "" {
		return result, hashes
	}
	prefix := folder + string(os.PathSeparator)
	for _, e := range entries {
		p := e.Path
		if !strings.HasPrefix(p, prefix) {
			continue
		}
		// 回收站目录内的文件跳过（与 Walk 的 IsRecycleDir SkipDir 对齐）
		if fsutil.IsRecycleDir(filepath.Dir(p)) {
			continue
		}
		if !packs.IsTypeModelFile(p, rtype) {
			continue
		}
		rel, err := filepath.Rel(folder, p)
		if err != nil {
			continue
		}
		key := filepath.ToSlash(rel)
		result[key] = p
		if e.Hash != "" {
			hashes[key] = e.Hash
		}
	}
	return result, hashes
}

// collectFolderFiles 扫描文件夹内的所有模型文件
// 返回以相对路径为 key 的映射
// 结果叠 30s sync 目录扫描缓存：同一 folder+rtype 在 TTL 内只真正 Walk 一次，
// 覆盖 DiffFolderContents 的实例侧（原来每次 BuildSyncItems 展开都实走）。
func collectFolderFiles(folder, rtype string) map[string]string {
	entries := make(map[string]string)
	if folder == "" {
		return entries
	}
	partialFail := false
	cacheKey := syncDirectoryScanKey{kind: "folder", root: folder, rtype: rtype}
	if cached, ok := loadSyncScanCache[map[string]string](&syncFolderScanCache, cacheKey); ok {
		return cached
	}
	// 回调恒返回 nil（含 folder 不存在首回调 err→partialFail），外层返回恒 nil，
	// 按最佳努力忽略，与其余 Walk 收口口径一致
	_ = filepath.Walk(folder, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] collectFolderFiles Walk 错误 %s: %v", path, err)
			partialFail = true
			return nil
		}
		// 跳过目录
		if info.IsDir() {
			// 跳过回收站目录
			if path != folder && fsutil.IsRecycleDir(path) {
				return filepath.SkipDir
			}
			return nil
		}
		// 只收集模型文件
		if packs.IsTypeModelFile(path, rtype) {
			rel, err := filepath.Rel(folder, path)
			if err != nil {
				return nil
			}
			relSlash := filepath.ToSlash(rel)
			entries[relSlash] = path
		}
		return nil
	})
	// 完整 Walk 才入缓存（对齐 sync.go 双守卫）：子树读失败时残缺结果不入缓存当权威。
	// partialFail 已覆盖 folder 不存在（首回调即 err），原 os.Stat 守卫与完整性无关。
	if !partialFail {
		storeSyncScanCache(&syncFolderScanCache, cacheKey, entries)
	}
	return entries
}
