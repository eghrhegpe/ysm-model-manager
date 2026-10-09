// sync_dirlevel_sync.go：文件夹级同步主流程（原 sync_dirlevel.go 拆分，2026-10 文件行数治理）。
// SyncResourcesDirLevel / SyncResourcesDirLevelScan / collectEntriesWalk / collectEntriesFromScan——
// global/instance 两侧文件夹级对比与补齐。
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

type ScanEntriesFn func(dir string) ([]types.ModelEntry, bool)

// dirLevelCacheKey 构建文件夹级同步的缓存键（kind 恒为 dirlevel）。
// syncResourcesDirLevel 的 collectEntries 闭包与 collectEntriesWalkCached 原本各写一份
// 「构造 cacheKey + loadSyncScanCache」块，jscpd 记为新增重复对；收口到此处消除。
func dirLevelCacheKey(rootDir, rtype string) syncDirectoryScanKey {
	return syncDirectoryScanKey{kind: "dirlevel", root: rootDir, rtype: rtype}
}

// loadDirLevelScanCache 读文件夹级同步缓存（syncDirLevelScanCache）；命中返回 true。
// 返回的 map 是缓存共享对象，消费方必须只读（见 sync_cache.go 契约）。
func loadDirLevelScanCache(rootDir, rtype string) (map[string]string, bool) {
	return loadSyncScanCache[map[string]string](&syncDirLevelScanCache, dirLevelCacheKey(rootDir, rtype))
}

// SyncResourcesDirLevel 文件夹级同步（默认 filepath.Walk，行为不变，供测试/旧调用方使用）。
func SyncResourcesDirLevel(globalDir, instanceDir, rtype string) types.ResourceSyncResult {
	return syncResourcesDirLevel(globalDir, instanceDir, rtype, nil)
}

// SyncResourcesDirLevelScan 同 SyncResourcesDirLevel，但注入 scanFn 复用扫描缓存，
// 消除 8 个 MMD 子类型 ×(1+N 整合包) 对同一仓库树的重复 Walk（性能修复）。
// scanFn 一般用 scanner.ScanEntriesWithHit；其结果带 30s TTL + single-flight，
// 故 8×(N+1) 次调用对同一目录实际只走盘一次。无嵌套模式类型（MMD/YSM）从已扫描
// 文件列表精确反推同步条目；含嵌套模式（maid-model 等）回退 filepath.Walk。
func SyncResourcesDirLevelScan(globalDir, instanceDir, rtype string, scanFn ScanEntriesFn) types.ResourceSyncResult {
	return syncResourcesDirLevel(globalDir, instanceDir, rtype, scanFn)
}

func syncResourcesDirLevel(globalDir, instanceDir, rtype string, scanFn ScanEntriesFn) types.ResourceSyncResult {
	result := types.ResourceSyncResult{}

	// collectEntries 收集整棵树的同步单元：以相对路径（relKeyDirLevel）为 key，
	// 保留完整目录层级。scanFn 命中时从已扫描文件列表反推（避免重复 Walk），
	// 否则退回 filepath.Walk 原行为（结果叠 30s sync 目录扫描缓存，
	// 使 maid-model 等嵌套类型的回退 Walk 在 TTL 内也只真正走一次）。
	collectEntries := func(rootDir string) map[string]string {
		if cached, ok := loadDirLevelScanCache(rootDir, rtype); ok {
			return cached
		}
		if scanFn != nil {
			if entries, hit := scanFn(rootDir); hit && len(entries) > 0 {
				if m := collectEntriesFromScan(entries, rootDir, rtype); m != nil {
					// scan-hit 衍生结果叠同款 syncDirLevelScanCache：BuildSyncItems 周期内
					// 8 个 MMD 子类型 × N 个实例反复对同一个全局仓库根 (rootDir, rtype)
					// 重算 O(entries) 衍生 map——命中 scanner 30s TTL+single-flight 窗口内
					// 直接返回，与 Walk 回退路径（collectEntriesWalkCached）对称复用缓存。
					// 仅当 m != nil（无嵌套模式可反推）才存——nil 回退 Walk 不缓存，
					// 否则会把「须走 Walk」误判为命中而永久跳过 Walk。
					storeSyncScanCache(&syncDirLevelScanCache, dirLevelCacheKey(rootDir, rtype), m)
					return m
				}
			}
		}
		return collectEntriesWalkCached(rootDir, rtype)
	}

	globalDirs := collectEntries(globalDir)
	instanceDirs := collectEntries(instanceDir)

	// 找出 synced / missing / extra
	seen := make(map[string]bool)
	for key, gPath := range globalDirs {
		seen[key] = true
		if _, exists := instanceDirs[key]; exists {
			result.Synced = append(result.Synced, gPath)
		} else {
			result.Missing = append(result.Missing, gPath)
		}
	}
	for key, iPath := range instanceDirs {
		if !seen[key] {
			result.Extra = append(result.Extra, iPath)
		}
	}

	sort.Strings(result.Synced)
	sort.Strings(result.Missing)
	sort.Strings(result.Extra)
	return result
}

// collectEntriesWalk 原 filepath.Walk 实现（scanFn 未命中时回退，语义权威基准）。
// 返回 (entries, partialFail)：partialFail 表示 Walk 中途遇错（子树读失败/目录消失），
// 调用方据此决定残缺结果不入缓存——与 sync.go 的 rootFailed/partialFail 双守卫同口径。
// 以下所有分支逻辑（isDirTypeModelFolder / containsModelSubfolder / 容器下钻注册自身键）
// 均继承自原 SyncResourcesDirLevel 的 Walk 实现，保持与旧行为完全一致——
// collectEntriesFromScan 的反推结果须与之等价（见 sync_dirlevel_scan_test.go）。
func collectEntriesWalk(rootDir string, rtype string) (map[string]string, bool) {
	entries := make(map[string]string)
	partialFail := false
	memo := make(nestedDirMemo)
	// Walk 外层返回仅承接回调错误，而回调恒返回 nil（含 root 不存在首回调 err→partialFail，
	// 见下方 err 分支），故外层返回恒 nil——按最佳努力忽略，与其余 WalkDir 收口口径一致
	_ = filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] Walk 错误 %s: %v", path, err)
			partialFail = true
			return nil
		}
		if !info.IsDir() {
			// 平铺模型文件：在任意深度收集（不再限定 rootDir 顶层）
			if packs.IsTypeModelFile(path, rtype) {
				if key := relKeyDirLevel(rootDir, path, false); key != "" {
					entries[key] = path
				}
			}
			return nil
		}
		if path == rootDir {
			return nil
		}
		// 跳过回收站目录（与 scanner.ScanEntries 对齐）
		if fsutil.IsRecycleDir(path) {
			return filepath.SkipDir
		}
		// 模型文件夹：在任意深度收集（不再限定一级子目录）
		// 使用 memo 变体消除 patternFind 重复子树扫描（patternFind 已知残余 IO）
		if isDirTypeModelFolderMemo(path, rtype, memo) {
			// 容器目录混入直接平铺模型文件（.ysm/.zip）也会被 isDirTypeModelFolder 判真，
			// 但若它同时含子模型文件夹，则是「容器」而非「叶子模型夹」——整体收编 SkipDir
			// 会吞掉子夹层级（如 嵌套1/ 内含平铺 .ysm + 01_taisho_maid/ + 嵌套2/ 深层）。
			// 此时下钻保留各子夹层级，让 nestDirLevelTree 重建容器。
			if containsModelSubfolderMemo(path, rtype, memo) {
				// 容器下钻时也注册自身键（目录 marker）——与对侧同名
				// 叶子目录（仅平铺文件——pre-fix 安装）键一致，避免键集不相交产生
				// 幻影 Missing+Extra（内容相同却显示分歧）
				if key := relKeyDirLevel(rootDir, path, true); key != "" {
					entries[key] = path
				}
				return nil
			}
			if key := relKeyDirLevel(rootDir, path, true); key != "" {
				entries[key] = path
			}
			return filepath.SkipDir
		}
		// 非模型子目录：继续递归（可能包含深层嵌套的模型文件夹/文件）
		return nil
	})
	return entries, partialFail
}

// collectEntriesWalkCached 与 collectEntriesWalk 语义一致，但结果叠 30s
// sync 目录扫描缓存；用于嵌套类型（maid-model）等无法从 scanner 扁平列表
// 精确反推、必须回退 Walk 的路径。
func collectEntriesWalkCached(rootDir, rtype string) map[string]string {
	if cached, ok := loadDirLevelScanCache(rootDir, rtype); ok {
		return cached
	}
	entries, partialFail := collectEntriesWalk(rootDir, rtype)
	// 完整 Walk 才入缓存（对齐 sync.go 的 rootFailed/partialFail 双守卫）：
	// 根目录存在 ≠ 子树扫完整——原 os.Stat 守卫与完整性无关，子目录读失败时
	// 残缺 entries 仍会被缓存 30s 当权威。partialFail 已覆盖 root 不存在（首回调即 err）。
	if !partialFail {
		storeSyncScanCache(&syncDirLevelScanCache, dirLevelCacheKey(rootDir, rtype), entries)
	}
	return entries
}

// collectEntriesFromScan 从 scanner 已扫描的模型文件列表反推目录级同步条目，
// 语义与 collectEntriesWalk 对齐。仅适用于「无嵌套模式」类型（MMD/YSM）：
// 此类类型的「模型文件夹」= 直接含模型文件的目录，可从扁平文件列表精确重建；
// 含嵌套模式（maid-model：assets/<ns>/maid_model.json）无法从文件列表精确重建，
// 调用方须先判 NestedPatternsFor 为空，否则应返回 nil 回退 Walk。
//
// 重建规则（对照 Walk 的 SkipDir 语义）：
//   - 平铺模型文件：仅当父目录不是「叶子模型文件夹」时登记（叶子夹 SkipDir 不登记内部文件；
//     容器夹下钻则登记内部文件；父为 rootDir 恒登记）。
//   - 模型文件夹：所有直接含模型文件的目录（含容器）均登记为目录键。
func collectEntriesFromScan(entries []types.ModelEntry, rootDir, rtype string) map[string]string {
	// 含嵌套模式无法精确重建，回退 nil → 调用方走 Walk
	if len(registry.NestedPatternsFor(rtype)) > 0 {
		return nil
	}
	sep := string(filepath.Separator)
	rootDir = filepath.Clean(rootDir)

	// 直接含模型文件的目录索引 + 收集的模型文件
	dirHasModelFile := make(map[string]bool)
	var modelFiles []types.ModelEntry
	for _, e := range entries {
		p := e.Path
		if p != rootDir && !strings.HasPrefix(p, rootDir+sep) {
			continue // 不在 rootDir 下的条目忽略（防御）
		}
		if !packs.IsTypeModelFile(p, rtype) {
			continue
		}
		dirHasModelFile[filepath.Dir(p)] = true
		modelFiles = append(modelFiles, e)
	}

	// directChildModelFolder 判定 parent 是否直接含子模型文件夹（对照 containsModelSubfolder）。
	// 预处理一次 parent→直接子模型夹 反向索引，使每次查询 O(1)（原实现为 O(n_files × n_dirs)
	// 全量扫描 dirHasModelFile，大仓库下有感知）。语义与原实现严格等价。
	directChildModelDirs := make(map[string][]string)
	for d := range dirHasModelFile {
		p := filepath.Dir(d)
		if p == rootDir || strings.HasPrefix(p, rootDir+sep) {
			directChildModelDirs[p] = append(directChildModelDirs[p], d)
		}
	}
	directChildModelFolder := func(parent string) bool {
		return len(directChildModelDirs[parent]) > 0
	}

	out := make(map[string]string)
	// 1) 平铺模型文件：父为 rootDir 或父非叶子模型文件夹时登记
	for _, e := range modelFiles {
		p := e.Path
		parent := filepath.Dir(p)
		if parent == rootDir {
			if key := relKeyDirLevel(rootDir, p, false); key != "" {
				out[key] = p
			}
			continue
		}
		isLeafFolder := dirHasModelFile[parent] && !directChildModelFolder(parent)
		if !isLeafFolder {
			if key := relKeyDirLevel(rootDir, p, false); key != "" {
				out[key] = p
			}
		}
	}
	// 2) 模型文件夹：直接含模型文件的目录（含容器）均登记为目录键
	for d := range dirHasModelFile {
		if d == rootDir {
			continue
		}
		if !strings.HasPrefix(d, rootDir+sep) {
			continue
		}
		if key := relKeyDirLevel(rootDir, d, true); key != "" {
			out[key] = d
		}
	}
	return out
}
