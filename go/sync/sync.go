// Package sync 整合包同步：仓库 ↔ 实例（custom 目录）的资源同步、diff、推送与重链接。
//
// ⚠️ 包名与标准库 `sync` 同名，外部引用一律显式 alias：
//
//	import ysmsync "ysm-model-manager/go/sync"
//
// 本包内部同时 import 标准库 "sync"（锁原语，见下方 import 块），故 alias 是编译期必需，
// **不是命名 stutter** —— 勿发起「消除 stutter」的重命名，决策与实证数据见 ADR-236。
package sync

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// 锁统一（ADR-056 共享单锁）：同步与安装并发操作同一 custom 目录文件（Rename 竞态），
// 原两包各自定义 installLock/syncLock 互不感知——现统一复用 installer.InstallLock

// ScanFunc 扫描模型（函数类型，由 app.go 注入）
type ScanFunc func(dir string) []types.ModelEntry

// GetInstanceStatus 获取整合包状态（使用真实 ListVersions）
// rtype: 资源类型 ID（如 "ysm"），用于解析特定子目录；为空时使用 ins.CustomDir（向后兼容）
func GetInstanceStatus(mcRoot, repoDir, rtype string, scanFn ScanFunc) []types.InstanceStatus {
	return GetInstanceStatusWith(mcRoot, repoDir, rtype, scanFn, ListVersions)
}

// GetInstanceStatusWith 可注入的整合包状态获取（测试用）
// rtype: 资源类型 ID（如 "ysm"），用于解析特定子目录；为空时使用 ins.CustomDir（向后兼容）
// repoIndex 预构建的仓库索引，供每个 instance 复用。
type repoIndex struct {
	ByHash     map[string][]types.ModelEntry
	ByRelKey   map[string][]types.ModelEntry
	BannedHash map[string]bool
	UseHash    bool
}

// buildRepoIndex 扫描仓库目录并构建哈希/relKey 双索引。
func buildRepoIndex(scanFn ScanFunc, repoDir string) *repoIndex {
	idx := &repoIndex{
		ByHash:     make(map[string][]types.ModelEntry),
		ByRelKey:   make(map[string][]types.ModelEntry),
		BannedHash: make(map[string]bool),
	}

	for _, e := range scanFn(repoDir) {
		// 禁用的模型（.disabled/.ban）不应出现在缺失列表，同时归入 bannedHashes
		if registry.IsDisableSuffix(e.Name) {
			if e.Hash != "" {
				idx.BannedHash[e.Hash] = true
			}
			continue
		}
		if e.Hash != "" {
			idx.ByHash[e.Hash] = append(idx.ByHash[e.Hash], e)
		}
		// relKey 始终构建（哈希命中优先，哈希空时回退 relKey）
		if rel := relKey(repoDir, e.Path); rel != "" {
			idx.ByRelKey[rel] = append(idx.ByRelKey[rel], e)
		}
	}

	idx.UseHash = len(idx.ByHash) > 0
	return idx
}

// compareHashMode 哈希对比路径：计算 Missing/Extra/Disabled/Synced。
// 先构建 custom 哈希集合（一次遍历），缺失检测从 O(H×C) 降为 O(H+C)。
func compareHashMode(idx *repoIndex, customEntries []types.ModelEntry) (missing, extra, disabled []string, synced int) {
	customHash := make(map[string]bool, len(customEntries))
	for _, c := range customEntries {
		if c.Hash != "" {
			customHash[c.Hash] = true
		}
	}

	for hash, entries := range idx.ByHash {
		if !customHash[hash] {
			for _, e := range entries {
				missing = append(missing, e.Path)
			}
		}
	}

	for _, c := range customEntries {
		if c.Hash == "" {
			continue
		}
		// 活跃副本优先判定：同 hash 存在于 ByHash（活跃模型）即不算 disabled/extra——
		// 即便仓库另有 .ban 同内容副本，实例命中活跃副本应计 Synced，不被 Disabled 优先吞掉。
		if _, found := idx.ByHash[c.Hash]; found {
			continue
		}
		if idx.BannedHash[c.Hash] {
			disabled = append(disabled, registry.StripDisableSuffix(c.Name))
		} else {
			extra = append(extra, registry.StripDisableSuffix(c.Name))
		}
	}

	// Synced 口径：custom 中命中仓库哈希的文件数
	for _, c := range customEntries {
		if c.Hash != "" {
			if _, found := idx.ByHash[c.Hash]; found {
				synced++
			}
		}
	}
	return
}

// compareRelKeyMode relKey 回退路径（MMD/VRC 等无哈希类型）。
func compareRelKeyMode(idx *repoIndex, customEntries []types.ModelEntry, scanDir string) (missing, extra []string, synced int) {
	customByRelKey := make(map[string]bool)
	for _, c := range customEntries {
		if rel := relKey(scanDir, c.Path); rel != "" {
			customByRelKey[rel] = true
		}
	}

	// Missing: 仓库有但实例没有的 relKey
	for rel, entries := range idx.ByRelKey {
		if !customByRelKey[rel] {
			for _, e := range entries {
				missing = append(missing, e.Path)
			}
		}
	}

	// Extra: 实例有但仓库没有的 relKey
	for _, c := range customEntries {
		if rel := relKey(scanDir, c.Path); rel != "" {
			if _, found := idx.ByRelKey[rel]; !found {
				extra = append(extra, c.Name)
			}
		}
	}

	// Synced: 实例中 relKey 命中仓库的文件数
	for _, c := range customEntries {
		if rel := relKey(scanDir, c.Path); rel != "" {
			if _, found := idx.ByRelKey[rel]; found {
				synced++
			}
		}
	}
	return
}

// resolveInstanceScanDir 解析实例扫描目录。
// rtype 不为空时使用 FindInstDir 限定子目录；否则用 ins.CustomDir。
func resolveInstanceScanDir(ins types.VersionInstance, rtype, subDir string) string {
	if rtype != "" && subDir != "" {
		return registry.FindInstDir(ins.VersionDir, subDir, rtype)
	}
	return ins.CustomDir
}

func GetInstanceStatusWith(mcRoot, repoDir, rtype string, scanFn ScanFunc, listFn ListVersionsFunc) []types.InstanceStatus {
	if mcRoot == "" || repoDir == "" {
		return []types.InstanceStatus{}
	}
	if scanFn == nil || listFn == nil {
		return []types.InstanceStatus{}
	}

	// 预解析子目录（rtype 不为空时使用 FindInstDir 限定路径）
	var subDir string
	if rtype != "" {
		subDir = registry.SubDirMap(rtype)
	}

	idx := buildRepoIndex(scanFn, repoDir)
	instances := listFn(mcRoot)
	var results []types.InstanceStatus

	for _, ins := range instances {
		scanDir := resolveInstanceScanDir(ins, rtype, subDir)
		customEntries := scanFn(scanDir)

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: scanDir,
			Missing:   []string{},
			Extra:     []string{},
			Disabled:  []string{},
		}

		if idx.UseHash {
			missing, extra, disabled, synced := compareHashMode(idx, customEntries)
			status.Missing = missing
			status.Extra = extra
			status.Disabled = disabled
			status.Synced = synced
		} else {
			missing, extra, synced := compareRelKeyMode(idx, customEntries, scanDir)
			status.Missing = missing
			status.Extra = extra
			status.Synced = synced
		}

		// Missing 由 repoByHash/repoByRelKey map 迭代构建——Go 运行时随机化
		// map 迭代序，不排序则列表每次刷新顺序跳动；字典序输出保证确定性
		sort.Strings(status.Missing)

		// 收集 custom 目录下每个文件的链接类型
		for _, c := range customEntries {
			linkType := GetLinkType(c.Path)
			// 去掉禁用后缀，方便前端匹配
			status.Files = append(status.Files, types.CustomFileInfo{
				Name:     registry.StripDisableSuffix(c.Name),
				LinkType: linkType,
			})
		}

		if len(status.Missing) == 0 && len(status.Extra) == 0 {
			status.Status = "complete"
		} else if len(status.Extra) > 0 {
			status.Status = "extra"
		} else {
			status.Status = "missing"
		}
		results = append(results, status)
	}
	return results
}

// toggleFileInfo 实例目录待判文件清单条目（SyncToggleStatus 阶段 1 收集）
type toggleFileInfo struct {
	path              string
	isCurrentlyBanned bool
	actualPath        string
}

// SyncToggleStatus 同步启用/禁用状态
// 持锁分段设计：阶段 1 与阶段 3+4 各为独立持锁段（段内 defer 释放），
// 中间锁外算哈希。若锁外阶段 panic，不会出现「头部 defer Unlock 对已手动
// 释放的锁二次 Unlock」而掩盖原错误的场景——每段锁的生命周期由段内 defer 保证。
func SyncToggleStatus(instanceCustomDir, filesRoot string, scanFn ScanFunc) (int, int, error) {
	if scanFn == nil {
		return 0, 0, fmt.Errorf("scanFn 为空")
	}

	// 阶段 1（持锁）：构建仓库禁启用索引 + 收集实例目录文件清单。
	repoHash, repoName, fileInfos, err := func() (map[string]bool, map[string]bool, []toggleFileInfo, error) {
		installer.InstallLocker.Lock()
		defer installer.InstallLocker.Unlock()

		repoEntries := scanFn(filesRoot)
		repoHash := make(map[string]bool) // hash → banned
		repoName := make(map[string]bool) // relPath(去禁用后缀) → banned，用于同名不同文件夹的文件
		filesRootClean := strings.ToLower(filepath.Clean(filesRoot)) + string(filepath.Separator)
		for _, e := range repoEntries {
			banned := registry.IsDisableSuffix(e.Name)
			// 用路径前缀限定：relPath 带至少一级父文件夹，避免跨文件夹撞名
			ePath := strings.ToLower(e.Path)
			if strings.HasPrefix(ePath, filesRootClean) {
				rel := strings.TrimPrefix(ePath, filesRootClean)
				rel = registry.StripDisableSuffix(rel)
				repoName[rel] = banned
			} else {
				// fallback：纯文件名（顶层文件）
				baseName := strings.ToLower(e.Name)
				baseName = registry.StripDisableSuffix(baseName)
				repoName[baseName] = banned
			}
			if e.Hash != "" {
				repoHash[e.Hash] = banned
			}
		}
		if len(repoHash) == 0 && len(repoName) == 0 {
			return nil, nil, nil, fmt.Errorf("仓库中未找到模型文件")
		}

		// 收集实例目录中的文件路径（不计算哈希）
		var fileInfos []toggleFileInfo
		filepath.WalkDir(instanceCustomDir, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				log.Printf("[sync] WalkDir 错误 %s: %v", p, err)
				return nil
			}
			if d.IsDir() {
				return nil
			}
			// 逐段判定（对齐 fsutil.IsRecycleDir/download.stripRecycleSegments 口径）：
			if hasRecycleSegment(p) {
				return nil
			}
			actualPath := p
			isCurrentlyBanned := registry.IsDisableSuffix(p)
			if isCurrentlyBanned {
				actualPath = registry.StripDisableSuffix(p)
			}
			ext := strings.ToLower(filepath.Ext(actualPath))
			if !registry.IsSupportedExt(ext) {
				return nil
			}
			fileInfos = append(fileInfos, toggleFileInfo{
				path:              p,
				isCurrentlyBanned: isCurrentlyBanned,
				actualPath:        actualPath,
			})
			return nil
		})
		return repoHash, repoName, fileInfos, nil
	}()
	if err != nil {
		return 0, 0, err
	}

	// 阶段 2（锁外）：预计算 relKey miss 文件的哈希
	// 锁外哈希评估 TOCTOU 风险：文件在锁外被外部进程修改/替换的概率极低（用户主动操作除外），
	// 且哈希仅作 relKey miss 时的改名/移动文件的内容关联兜底，改名场景下文件名已变、
	// 内容匹配是近似判定。若文件被修改导致哈希变化，纯文件名 fallback 仍会兜底匹配。
	customDirClean := strings.ToLower(filepath.Clean(instanceCustomDir)) + string(filepath.Separator)

	// 收集 relKey miss 的文件路径
	relKeyMissPaths := make([]string, 0, len(fileInfos))
	for _, fi := range fileInfos {
		pLower := strings.ToLower(fi.path)
		var matched bool
		if strings.HasPrefix(pLower, customDirClean) {
			rel := strings.TrimPrefix(pLower, customDirClean)
			rel = registry.StripDisableSuffix(rel)
			_, matched = repoName[rel]
		}
		if !matched {
			relKeyMissPaths = append(relKeyMissPaths, fi.path)
		}
	}

	// 预计算哈希（锁外）
	precomputedHashes := make(map[string]string, len(relKeyMissPaths))
	for _, p := range relKeyMissPaths {
		precomputedHashes[p] = computeHash(p)
	}

	// 重新持锁，执行匹配 + rename
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	defer InvalidateSyncScanCaches() // 启禁会改实例目录名，清同步扫盘缓存防陈旧

	// 阶段 3：匹配并收集待 Rename 的文件
	type renameOp struct {
		src string
		dst string
	}
	var ops []renameOp
	for _, fi := range fileInfos {
		p := fi.path
		// 匹配顺序：relKey（路径对应）→ 哈希（内容对应）→ 纯文件名兜底。
		var shouldBeBanned bool
		var matched bool
		pLower := strings.ToLower(p)
		if strings.HasPrefix(pLower, customDirClean) {
			// relKey 匹配（带文件夹限定）
			rel := strings.TrimPrefix(pLower, customDirClean)
			rel = registry.StripDisableSuffix(rel)
			shouldBeBanned, matched = repoName[rel]
		}
		if !matched {
			hash := precomputedHashes[p]
			if hash != "" {
				shouldBeBanned, matched = repoHash[hash]
			}
		}
		if !matched {
			// fallback：纯文件名（旧仓库或同名不同路径的特例）
			baseName := strings.ToLower(filepath.Base(fi.actualPath))
			shouldBeBanned, matched = repoName[baseName]
		}
		if !matched {
			continue
		}

		if shouldBeBanned && !fi.isCurrentlyBanned {
			// 禁用统一收敛到新标准后缀（.disabled）。
			newPath := p + registry.DisabledSuffix()
			if _, err := os.Stat(newPath); err == nil {
				continue // 目标已存在，跳过
			}
			ops = append(ops, renameOp{src: p, dst: newPath})
		} else if !shouldBeBanned && fi.isCurrentlyBanned {
			newPath := registry.StripDisableSuffix(p)
			// 启用分支补目标存在性检查
			if _, err := os.Stat(newPath); err == nil {
				continue
			}
			ops = append(ops, renameOp{src: p, dst: newPath})
		}
	}

	// 阶段 4：统一执行 Rename（目录结构已稳定，无竞态）
	disableCount := 0
	enableCount := 0
	var failures []string
	for _, op := range ops {
		err := os.Rename(op.src, op.dst)
		if err != nil && isFileLocked(err) {
			// Windows 共享锁瞬时争用：等待后重试一次
			time.Sleep(50 * time.Millisecond)
			err = os.Rename(op.src, op.dst)
		}
		if err != nil {
			if isFileLocked(err) {
				log.Printf("[sync] 文件被占用，跳过: %s → %s: %v", op.src, op.dst, err)
			} else {
				failures = append(failures, fmt.Sprintf("%s→%s: %v", op.src, op.dst, err))
			}
			continue
		}
		if registry.IsDisableSuffix(op.dst) {
			disableCount++
		} else {
			enableCount++
		}
	}
	if len(failures) > 0 {
		return disableCount, enableCount, fmt.Errorf("同步完成: 成功禁用 %d 启用 %d，失败 %d: %s",
			disableCount, enableCount, len(failures), strings.Join(failures, "; "))
	}
	return disableCount, enableCount, nil
}

// 文件级同步深度上限：SyncResources 仅收集 scanDir 顶层文件，不递归进入嵌套子目录。
// 文件夹级类型（YSM/MMD 等）仍全树递归，由 SyncResourcesDirLevel 按文件夹名对比。
// SyncResources 对比两个目录的资源文件差异，按文件名匹配
// 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步
// 只统计模型/资源相关扩展名的文件，忽略无关文件
// rtype 指定资源类型 ID：文件级类型（!dirLevelSync）仅在目标目录顶层收集文件（depth 1），
// 不递归进嵌套子目录；文件夹级类型仍全树递归。空 rtype 保持旧的全树递归行为（测试/兼容）。
// P3 修复：原实现无论类型一律全递归——Sable Schematics 等生成 .nbt 于嵌套子目录时，
// mapSrcToGlobal（顶层语义）算出相对路径以 ".." 开头误判越界 → 拉取报"不在目标目录内"。
// isMcmetaDetectorType 判断资源类型是否为资源包文件夹型（detector=mcmeta）。
// SyncResources 的 pack.mcmeta 文件夹收集仅对此类（及空 rtype 兼容）生效，
// 避免蓝图/YSM 等类型的仓库中误放的资源包文件夹被当成本类型同步单元。
func isMcmetaDetectorType(rtype string) bool {
	rt := registry.RegistryType(rtype)
	return rt != nil && rt.Detector == "mcmeta"
}

// relKey 计算文件相对 root 的规范化同步 key（小写、正斜杠、去 .disabled/.ban 尾部）。
// ADR-064 阶段二：文件级对比从「文件名」升级为「相对路径」——嵌套文件天然区分、
// 无同名冲突、与仓库树树状语义一致（原"只扫顶层"深度守卫随之取消）。
func relKey(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	rel = strings.ToLower(rel)
	rel = registry.StripDisableSuffix(rel)
	return rel
}

func SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult {
	return SyncResourcesWithConfig(globalDir, instanceDir, nil, rtype...)
}

// SyncResourcesWithConfig 同步资源，支持配置化（含冲突检测）
func SyncResourcesWithConfig(globalDir, instanceDir string, config *types.SyncConfig, rtype ...string) types.ResourceSyncResult {
	rtypeID := ""
	if len(rtype) > 0 {
		rtypeID = rtype[0]
	}
	// 资源包文件夹（含 pack.mcmeta）作为同步单元——仅资源包类型（detector=mcmeta）
	// 或空 rtype（旧行为兼容）收集。P5 修复：原实现不分类型一律收集，蓝图仓库
	// （blueprint）里误放的资源包文件夹被当成蓝图 missing 显示"推送"，
	// 而该目录实际没有任何 .nbt/.schematic（识别错文件）。
	isPackFolderType := rtypeID == "" || isMcmetaDetectorType(rtypeID)

	// collect 全树递归扫描一侧目录：文件条目 + 资源包文件夹条目。
	// key 为相对路径（relKey），过滤与归一化统一走 types，对比归并统一走
	// ResourceDiff（ADR-064：scanner 口径 + 单点对比，消除手工对齐漂移）。
	// 结果叠 30s sync 目录扫描缓存：同一 root+rtype 在 TTL 内只真正 Walk 一次。
	collect := func(rootDir string) map[string]DiffEntry {
		cacheKey := syncDirectoryScanKey{kind: "resources", root: rootDir, rtype: rtypeID}
		if cached, ok := loadSyncScanCache[map[string]DiffEntry](&syncResourcesScanCache, cacheKey); ok {
			return cached
		}
		rootFailed := false
		partialFail := false // Walk 部分子树失败时设 true，失败结果不入缓存
		entries := make(map[string]DiffEntry)
		filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("[sync] Walk 错误 %s: %v", path, err)
				if path == rootDir {
					rootFailed = true
				} else {
					partialFail = true
				}
				return nil
			}
			if info.IsDir() {
				// 跳过回收站目录（与 scanner.ScanEntries 对齐）：回收站内模型不是仓库活跃模型
				if path != rootDir && fsutil.IsRecycleDir(path) {
					return filepath.SkipDir
				}
				// 资源包文件夹：扫描其本身但不递归（仅资源包类型收集）
				if path != rootDir && isPackFolderType && fsutil.IsResourcePackFolder(path) {
					if key := relKey(rootDir, path); key != "" {
						entries[key] = DiffEntry{Path: path, IsDir: true}
					}
				}
				return nil
			}
			if !registry.IsResourceAllowed(info.Name()) {
				return nil
			}
			if key := relKey(rootDir, path); key != "" {
				entries[key] = DiffEntry{Path: path, Size: info.Size()}
			}
			return nil
		})
		// 完整 Walk 才入缓存：rootFailed 已短路，partialFail 时残缺 entries 不入缓存，
		// 避免后续 30s 内调用方拿到不完整结果
		if !rootFailed && !partialFail {
			storeSyncScanCache(&syncResourcesScanCache, cacheKey, entries)
		}
		return entries
	}

	globalFiles := collect(globalDir)
	instanceFiles := collect(instanceDir)
	result := ResourceDiff(globalFiles, instanceFiles)

	// 冲突检测（如果配置了冲突策略）
	if config != nil && config.ConflictPolicy != "" {
		// 锁契约断言（生产构建同样编译——fail-fast 守卫，非测试专属）：
		// config.ConflictPolicy 非空时，调用方必须已持有 installer.InstallLock，
		// 否则 ResolveConflictsLocked 会 self-deadlock（sync.Mutex 不可重入）。
		// 当前生产调用链（PushResources/PullResources → SyncResources）恒传 nil config，
		// 非空 config 仅测试注入；断言捕获「未来新增直接调用且未持锁」的违规场景，
		// 违规即 panic（安全侧失败，优于静默死锁）。
		assertInstallLockHeld()
		report, err := DetectConflicts(instanceDir, globalDir, rtypeID)
		if err != nil {
			log.Printf("[sync] 冲突检测失败: %v", err)
		} else if report.TotalConflicts > 0 {
			log.Printf("[sync] 检测到 %d 个冲突，策略: %s", report.TotalConflicts, config.ConflictPolicy)
			// 自动解决冲突。走 *Locked 变体：本函数可能经 PushResources/PullResources →
			// SyncResources 在 InstallLock 临界区内运行（config 恒为 nil 走不到此处），
			// 若改走自锁的 ResolveConflicts 会在持锁语境下重入 sync.Mutex 造成 self-deadlock。
			// 因此此处约定：config != nil 的冲突解决必须由调用方保证已持有 InstallLock。
			strategy := ResolutionStrategy(config.ConflictPolicy)
			if strategy == ResolveForceRemote || strategy == ResolveForceLocal {
				resolved, failed, manual := ResolveConflictsLocked(report.Conflicts, strategy, instanceDir, globalDir)
				log.Printf("[sync] 冲突解决完成: 解决 %d, 失败 %d, 需手动 %d", resolved, failed, manual)
			} else {
				// 手动解决模式，返回结果中标记冲突
				log.Printf("[sync] 检测到冲突，请手动处理")
			}
			// 将冲突信息附加到结果（如果需要，可以扩展 ResourceSyncResult）
			// 目前仅记录日志，后续可扩展前端 UI 展示
		}
	}

	return result
}

// assertInstallLockHeld 断言调用方已持有 installer.InstallLock。
// 使用 TryLock 实现：若 TryLock 成功说明锁未被持有 → 调用方违规 → panic；
// 若 TryLock 失败说明锁已被持有（调用方或他人）→ 放行。
// 注意：TryLock 无法区分「本 goroutine 持有」与「其他 goroutine 持有」，
// 但在 SyncResourcesWithConfig 的调用约定下（调用方必须持锁），此断言足够捕获违规。
func assertInstallLockHeld() {
	// InstallLocker 是 sync.Locker 接口，需类型断言到 *sync.Mutex 才能使用 TryLock
	if mu, ok := installer.InstallLocker.(*sync.Mutex); ok {
		if mu.TryLock() {
			mu.Unlock()
			panic("SyncResourcesWithConfig: config.ConflictPolicy 非空时调用方必须已持有 installer.InstallLock")
		}
	}
}

// SortEntries 按名称排序模型条目
func SortEntries(entries []types.ModelEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
}

// GetLinkType 判断文件的链接类型
func GetLinkType(path string) types.LinkType {
	info, err := os.Lstat(path)
	if err != nil {
		return types.LinkUnknown
	}
	// 符号链接
	if info.Mode()&os.ModeSymlink != 0 {
		return types.LinkSym
	}
	// 在 Windows 上判断硬链接：通过 syscall.GetFileInformationByHandle 获取 nlink
	// 如果 nlink > 1，说明是硬链接（统一走 fsutil.IsHardLink，含目录排除 ADR-038）
	if fsutil.IsHardLink(path) {
		return types.LinkHard
	}
	return types.LinkCopy
}

// hasRecycleSegment 判断路径中是否存在任一名为 .recycle 的目录段（大小写不敏感，
// 对齐 fsutil.IsRecycleDir / download.stripRecycleSegments 的 EqualFold 口径）。
// 覆盖 .recycle 子树内已遍历文件的跳过语义（walk 会进入子树列出其下文件），
// 同时不误伤文件名含 ".recycle" 的正常模型（如 my.recycle.backup.ysm）。
func hasRecycleSegment(p string) bool {
	for _, seg := range strings.Split(p, string(filepath.Separator)) {
		if strings.EqualFold(seg, ".recycle") {
			return true
		}
	}
	return false
}

// isFileLocked 判断错误是否因为文件被其他进程锁定。
// 错误码按 GOOS 分支（对齐 installer.errnoIs 范式）：Windows 与 Unix 的 errno 数值空间
// 虽同为小整数但同一数值语义不同（16 = ERROR_CURRENT_DIRECTORY / EBUSY；32/33 在 Unix
// 是 EPIPE/EDOM）——跨平台混判必然误判。errors.Is 链式穿透
// os.LinkError/os.PathError 包装，无需文本兜底（陷阱 #11：禁止文本匹配错误分类）。
func isFileLocked(err error) bool {
	if err == nil {
		return false
	}
	if runtime.GOOS == "windows" {
		// ERROR_SHARING_VIOLATION(32) / ERROR_LOCK_VIOLATION(33)
		return errors.Is(err, syscall.Errno(32)) || errors.Is(err, syscall.Errno(33))
	}
	// Unix EBUSY(16)
	return errors.Is(err, syscall.Errno(16))
}
