// ===== 文件夹级资源同步（ADR-040 拆分，多层物理路径支持）=====
// 从 sync.go 拆出：YSM（ysm.json 文件夹）/ MMD（.pmx/.pmd 文件夹）按文件夹名对比
//
// ═══════════════════════════════════════════════════════════════════════════════
// 多层物理路径支持（2026-09 重构）
// ───────────────────────────────────────────────────────────────────────────────
// 原实现使用文件夹/文件名的 basename 作为同步 key，且仅收集 rootDir 顶层单元：
//   - 平铺模型文件仅收集 "直接位于 rootDir 下" 的（filepath.Dir(path)==rootDir）
//   - 模型文件夹仅收集 rootDir 的直接一级子目录（Walk 找到模型文件夹后 SkipDir，
//     不再深入兄弟目录间的深层嵌套）
//
// 后果：仓库多级子目录（如 maid-model/vendor/character/pack.zip）被扁平化，
// 同步时丢失层级信息，实质上阻碍模型仓库多层物理路径推广。
//
// 重构方案：
//  1. key 从 basename 升级为相对路径（relKeyDirLevel），天然保留目录层级
//  2. 平铺模型文件在任意深度收集——仅当父目录不含模型文件（未被整体收编 SkipDir）时可达，
//     属于边界路径：主路径（目录含模型文件 → isDirTypeModelFolder 检测为模型文件夹 →
//     SkipDir 整树收编）覆盖绝大多数场景
//  3. 模型文件夹在任意深度收集，不再限定一级子目录
//  4. 非模型子目录中不包含任何模型文件/文件夹时，SkipDir 优化遍历
//
// 已知限制（非本次回归，待治理）：
//   - 同级目录 `模型包/` 与文件 `模型包.zip` 的 key 都归一为 `<parent>/模型包` → 静默丢失一个
//     （relKeyDirLevel 去扩展名 vs 目录 basename 冲突）
//   - patternFind 重复子树扫描已治理（2026-08-24）：collectEntriesWalk 内建
//     nestedDirMemo，一次 Walk 内同一目录+pattern 只递归一次，O(N²) 降为 O(N)。
//
// ═══════════════════════════════════════════════════════════════════════════════
package sync

import (
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

// isDirTypeModelFolder 检查一个子目录是否包含 YSM/MMD 模型文件（即文件夹级资源）
// 用于 YSM（.ysm / ysm.json）和 MMD（.pmx/.pmd）类型的文件夹级同步
// 支持多层嵌套结构检测（通过 NestedPatterns 配置）
func isDirTypeModelFolder(path string, rtype string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if types.IsTypeModelFile(filepath.Join(path, e.Name()), rtype) {
			return true
		}
	}
	// 基于 NestedPatterns 配置的多层嵌套检测
	// 支持任意深度的嵌套结构，不再硬编码 maid-model 特定逻辑
	// 只在当前目录是真正的模型目录（包含入口文件的目录）时返回 true
	if patterns := types.NestedPatternsFor(rtype); len(patterns) > 0 {
		if foundDir := findNestedModelDir(path, patterns); foundDir != "" {
			// 只有当找到的模型目录就是当前路径时才返回 true
			// 如果找到的是更深层的目录，说明当前目录只是中间目录
			if filepath.Clean(foundDir) == filepath.Clean(path) {
				return true
			}
		}
	}
	return false
}

// findNestedModelDir 在指定目录下递归查找嵌套模型目录
// 返回第一个符合模式的模型目录路径，找不到返回空字符串
// 关键设计：返回实际的模型目录路径（包含入口文件的目录），
// 而不是中间目录的路径。这样 Walk 能正确识别嵌套结构。
func findNestedModelDir(path string, patterns []types.NestedPattern) string {
	for _, pattern := range patterns {
		if found := patternFind(path, pattern, 0); found != "" {
			return found
		}
	}
	return ""
}

// patternFind 递归查找符合单个嵌套模式的模型目录
// 返回找到的模型目录路径，找不到返回空字符串
// 与 patternMatches 不同：此函数返回具体路径而非布尔值，
// 让调用方能区分"当前目录是模型文件夹"和"子目录中有模型文件夹"两种情况
//
// 返回值说明：
// - 当在 EntryDir 下（或其子目录）找到入口文件时，返回 EntryDir 的父目录
// - 这样能正确识别模型包的根目录（如 my_pack/assets/ns/maid_model.json -> my_pack）
// - 当 EntryDir 为空且入口文件直接在当前目录时，返回当前目录
//
// 实现：薄包装 patternFindMemo，传入独立空 memo。单次调用内目录路径唯一，
// memo 不会提前命中，故语义与"无 memo"的原实现逐分支一致（零行为变更，ADR-140 L3）。
func patternFind(path string, pattern types.NestedPattern, depth int) string {
	return patternFindMemo(path, pattern, depth, make(map[string]string))
}

// checkEntryFiles 检查目录中是否存在入口文件列表中的任一文件
func checkEntryFiles(path string, entryFiles []string) bool {
	for _, entryFile := range entryFiles {
		// 支持不带路径的文件名（如 "maid_model.json"）
		fileName := filepath.Base(entryFile)
		if info, err := os.Stat(filepath.Join(path, fileName)); err == nil && !info.IsDir() {
			return true
		}
	}
	return false
}

// ===== nested 目录检测 memoization（去重 patternFind 重复子树扫描）=====

// nestedDirMemo 用于在同一棵 Walk 树内缓存 patternFind 的结果。
// 外层 key = patternKey（编码 EntryDir/EntryFiles/MaxDepth），
// 内层 key = 目录路径，值 = findNestedModelDir 对该路径+pattern 的返回结果（"" 表示未找到）。
type nestedDirMemo map[string]map[string]string

func patternKey(pattern types.NestedPattern) string {
	var b strings.Builder
	b.WriteString(pattern.EntryDir)
	b.WriteByte(0)
	for _, f := range pattern.EntryFiles {
		b.WriteString(f)
		b.WriteByte(0)
	}
	b.WriteString(strconv.Itoa(pattern.MaxDepth))
	return b.String()
}

// patternFindMemo 语义同 patternFind，但结果写入 memo 避免重复子树扫描。
// 同一棵 Walk 树内，同一路径+pattern 只递归一次。
func patternFindMemo(path string, pattern types.NestedPattern, depth int, memo map[string]string) string {
	if v, ok := memo[path]; ok {
		return v
	}

	maxDepth := pattern.MaxDepth
	if maxDepth <= 0 {
		maxDepth = 10
	}
	if depth > maxDepth {
		memo[path] = ""
		return ""
	}

	if pattern.EntryDir == "" {
		if checkEntryFiles(path, pattern.EntryFiles) {
			memo[path] = path
			return path
		}
		memo[path] = ""
		return ""
	}

	dirName := filepath.Base(path)
	if strings.EqualFold(dirName, pattern.EntryDir) {
		entries, err := os.ReadDir(path)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() {
					subPath := filepath.Join(path, e.Name())
					if checkEntryFiles(subPath, pattern.EntryFiles) {
						result := filepath.Dir(path)
						memo[path] = result
						return result
					}
				}
			}
			if checkEntryFiles(path, pattern.EntryFiles) {
				result := filepath.Dir(path)
				memo[path] = result
				return result
			}
		}
		memo[path] = ""
		return ""
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		memo[path] = ""
		return ""
	}
	for _, e := range entries {
		if e.IsDir() {
			subPath := filepath.Join(path, e.Name())
			if found := patternFindMemo(subPath, pattern, depth+1, memo); found != "" {
				memo[path] = found
				return found
			}
		}
	}
	memo[path] = ""
	return ""
}

func findNestedModelDirMemo(path string, patterns []types.NestedPattern, memo nestedDirMemo) string {
	for _, pattern := range patterns {
		pKey := patternKey(pattern)
		pMemo := memo[pKey]
		if pMemo == nil {
			pMemo = make(map[string]string)
			memo[pKey] = pMemo
		}
		if found := patternFindMemo(path, pattern, 0, pMemo); found != "" {
			return found
		}
	}
	return ""
}

// isDirTypeModelFolderMemo 同 isDirTypeModelFolder，但使用 memo 去重 patternFind 子树扫描。
func isDirTypeModelFolderMemo(path string, rtype string, memo nestedDirMemo) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if types.IsTypeModelFile(filepath.Join(path, e.Name()), rtype) {
			return true
		}
	}
	if patterns := types.NestedPatternsFor(rtype); len(patterns) > 0 {
		if foundDir := findNestedModelDirMemo(path, patterns, memo); foundDir != "" {
			if filepath.Clean(foundDir) == filepath.Clean(path) {
				return true
			}
		}
	}
	return false
}

// containsModelSubfolderMemo 同 containsModelSubfolder，但使用 memo 去重 patternFind 子树扫描。
func containsModelSubfolderMemo(path string, rtype string, memo nestedDirMemo) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if isDirTypeModelFolderMemo(filepath.Join(path, e.Name()), rtype, memo) {
			return true
		}
	}
	return false
}

// relKeyDirLevel 计算目录级同步条目的规范化 key：相对路径 + 小写 + 去禁用后缀。
// 与 relKey 的区别：relKey 保留扩展名（供 ResourceDiff 按大小对比），
// 而目录级同步的 key 按「模型身份」去扩展名（模型 A 的 zip 无论版本为何，
// 身份相同；扩展名不是模型身份的一部分）。
// 多层物理路径支持：返回的 key 包含完整相对路径层级，如 "vendor/character/pack"
// 而非扁平化的 "pack"。
func relKeyDirLevel(root, path string, isDir bool) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	rel = strings.ToLower(rel)
	rel = types.StripDisableSuffix(rel)
	// 剥离扩展名——模型身份不以扩展名区分
	if ext := filepath.Ext(rel); ext != "" {
		rel = strings.TrimSuffix(rel, ext)
	}
	// code review P3：目录键加尾随 "/"——与兄弟平铺文件（同名剥扩展名）区分——
	// 文件"嵌套1/动力臂.ysm"与目录"嵌套1/动力臂/"不再同键（map last-write-wins
	// 曾让文件覆盖目录——模型包静默丢失）
	if isDir {
		rel += "/"
	}
	return rel
}

// SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹）
// 以文件夹名为单位，一个文件夹包含模型文件 + 纹理文件 = 一个整体
// 同时也会收集各层级的平铺模型文件（如 .ysm），以相对路径（去扩展名）作为 key
// 路径存储：全局侧存全局路径，实例侧存实例路径；missing/extra 都是路径
//
// 多层物理路径支持：
//   - key 为相对路径（relKeyDirLevel），天然保留目录层级
//   - 平铺模型文件在任意深度收集
//   - 模型文件夹在任意深度收集
//   - 非模型空子目录跳过（SkipDir 优化），避免无意义遍历
//
// ScanEntriesFn 可选注入：复用 scanner 已缓存的扫描结果，避免对已被扫描层走盘过的
// 目录（如全局仓库根）重复全树 Walk。返回 (entries, hit)；hit=false 时调用方回退
// filepath.Walk 原行为。
type ScanEntriesFn func(dir string) ([]types.ModelEntry, bool)

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
		if scanFn != nil {
			if entries, hit := scanFn(rootDir); hit && len(entries) > 0 {
				if m := collectEntriesFromScan(entries, rootDir, rtype); m != nil {
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
// 以下所有分支逻辑（isDirTypeModelFolder / containsModelSubfolder / 容器下钻注册自身键）
// 均继承自原 SyncResourcesDirLevel 的 Walk 实现，保持与旧行为完全一致——
// collectEntriesFromScan 的反推结果须与之等价（见 sync_dirlevel_scan_test.go）。
func collectEntriesWalk(rootDir string, rtype string) map[string]string {
	entries := make(map[string]string)
	memo := make(nestedDirMemo)
	filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] Walk 错误 %s: %v", path, err)
			return nil
		}
		if !info.IsDir() {
			// 平铺模型文件：在任意深度收集（不再限定 rootDir 顶层）
			if types.IsTypeModelFile(path, rtype) {
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
				// code review P3：容器下钻时也注册自身键（目录 marker）——与对侧同名
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
	return entries
}

// collectEntriesWalkCached 与 collectEntriesWalk 语义一致，但结果叠 30s
// sync 目录扫描缓存；用于嵌套类型（maid-model）等无法从 scanner 扁平列表
// 精确反推、必须回退 Walk 的路径。
func collectEntriesWalkCached(rootDir, rtype string) map[string]string {
	cacheKey := syncDirectoryScanKey{kind: "dirlevel", root: rootDir, rtype: rtype}
	if cached, ok := loadSyncScanCache[map[string]string](&syncDirLevelScanCache, cacheKey); ok {
		return cached
	}
	entries := collectEntriesWalk(rootDir, rtype)
	if _, err := os.Stat(rootDir); err == nil {
		storeSyncScanCache(&syncDirLevelScanCache, cacheKey, entries)
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
	if len(types.NestedPatternsFor(rtype)) > 0 {
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
		if !types.IsTypeModelFile(p, rtype) {
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

// FileDiffEntry 文件级差异条目（用于文件夹内容级 diff）
type FileDiffEntry struct {
	RelPath string           `json:"relPath"` // 相对于文件夹根的路径
	AbsPath string           `json:"absPath"` // 绝对路径
	Size    int64            `json:"size"`
	Status  types.SyncStatus `json:"status"` // synced/missing/optional
}

// diffFolderContentsCore 以全局/实例两侧文件映射计算子文件级同步 diff。
// 收集方式（Walk 走盘 / scanner 反推）由调用方决定，本函数只做差异聚合，
// 故 DiffFolderContents 与 DiffFolderContentsScan 共用、零行为漂移（ADR-140 L3）。
func diffFolderContentsCore(globalFiles, instanceFiles map[string]string) []FileDiffEntry {
	var diffs []FileDiffEntry
	seen := make(map[string]bool)

	// 检查全局有但实例没有的文件（missing，可推送）
	for relKey, gEntry := range globalFiles {
		seen[relKey] = true
		if _, exists := instanceFiles[relKey]; exists {
			// 两侧都有，视为 synced（当前不做内容哈希对比）
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: gEntry,
				Size:    fileSize(gEntry),
				Status:  types.SyncStatusSynced,
			})
		} else {
			// 全局有、实例没有 → missing
			diffs = append(diffs, FileDiffEntry{
				RelPath: relKey,
				AbsPath: gEntry,
				Size:    fileSize(gEntry),
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
				Size:    fileSize(iEntry),
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
//     差异判定由调用方按 Status 区分——code review P3 注释对齐实现）
func DiffFolderContents(globalFolder, instanceFolder, rtype string) []FileDiffEntry {
	// 扫描全局文件夹内的模型文件
	globalFiles := collectFolderFiles(globalFolder, rtype)
	// 扫描实例文件夹内的模型文件
	instanceFiles := collectFolderFiles(instanceFolder, rtype)
	return diffFolderContentsCore(globalFiles, instanceFiles)
}

// DiffFolderContentsScan 同 DiffFolderContents，但全局侧文件收集复用 scanner 已缓存的
// 组根扫描结果（scanFn(globalRoot)），避免对每个模型夹重复 Walk 全局子树。
// 实例侧（instanceFolder）通常不在 globalRoot 之下，且文件量远小于全局侧，
// 保持 Walk（collectFolderFiles）不改语义。
//
// cacheHit=false（缓存未命中/含嵌套模式类型）时整体回退 DiffFolderContents，零行为漂移。
// scanFn 签名与 SyncResourcesDirLevelScan 一致：func(dir string) ([]types.ModelEntry, bool)。
func DiffFolderContentsScan(globalFolder, instanceFolder, rtype string, scanFn ScanEntriesFn, globalRoot string) []FileDiffEntry {
	if scanFn == nil || len(types.NestedPatternsFor(rtype)) > 0 {
		// 含嵌套模式类型不参与反推（语义由 Walk 保证）；未注入则回退
		return DiffFolderContents(globalFolder, instanceFolder, rtype)
	}
	entries, hit := scanFn(globalRoot)
	if !hit || len(entries) == 0 {
		return DiffFolderContents(globalFolder, instanceFolder, rtype)
	}
	// 全局侧：从组根全量条目按 globalFolder 前缀过滤（零 Walk）
	globalFiles := collectFolderFilesFromScan(globalFolder, rtype, entries)
	// 实例侧：collectFolderFiles 内部已叠 30s sync 目录扫描缓存，不再每次实走
	instanceFiles := collectFolderFiles(instanceFolder, rtype)
	return diffFolderContentsCore(globalFiles, instanceFiles)
}

// collectFolderFilesFromScan 从 scanner 已缓存的组根全量条目中，过滤出 folder 下的
// 模型文件（相对 folder 的 slash 路径为 key）。与 collectFolderFiles（Walk）语义等价：
// 仅收集 IsTypeModelFile 命中的文件，跳过回收站目录。
func collectFolderFilesFromScan(folder, rtype string, entries []types.ModelEntry) map[string]string {
	result := make(map[string]string)
	if folder == "" {
		return result
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
		if !types.IsTypeModelFile(p, rtype) {
			continue
		}
		rel, err := filepath.Rel(folder, p)
		if err != nil {
			continue
		}
		result[filepath.ToSlash(rel)] = p
	}
	return result
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
	cacheKey := syncDirectoryScanKey{kind: "folder", root: folder, rtype: rtype}
	if cached, ok := loadSyncScanCache[map[string]string](&syncFolderScanCache, cacheKey); ok {
		return cached
	}
	filepath.Walk(folder, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[sync] collectFolderFiles Walk 错误 %s: %v", path, err)
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
		if types.IsTypeModelFile(path, rtype) {
			rel, err := filepath.Rel(folder, path)
			if err != nil {
				return nil
			}
			relSlash := filepath.ToSlash(rel)
			entries[relSlash] = path
		}
		return nil
	})
	if _, err := os.Stat(folder); err == nil {
		storeSyncScanCache(&syncFolderScanCache, cacheKey, entries)
	}
	return entries
}

// fileSize 获取文件大小
func fileSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}
