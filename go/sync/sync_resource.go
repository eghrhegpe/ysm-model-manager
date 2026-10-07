// sync_resource.go：资源同步与推送（原 sync.go 拆分，2026-10 文件行数治理）。
// SyncResources / SyncResourcesWithConfig / collectResourceEntries / handleSyncConflicts /
// GetLinkType / isFileLocked——仓库↔实例资源级 diff + 推送 + 冲突处理。
package sync

import (
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func SyncResources(globalDir, instanceDir string, rtype ...string) types.ResourceSyncResult {
	return SyncResourcesWithConfig(globalDir, instanceDir, nil, nil, rtype...)
}

// SyncResourcesWithConfig 同步资源，支持配置化（含冲突检测）。
// scanFn 提供 scanner 缓存化的文件哈希，旁挂到 DiffEntry.Hash 做内容级对比（D2′-a / ADR-269）；
// 传 nil → 条目恒无哈希 → 回退 Size 对比（现状，旧调用 / push / pull 沿用）。
// foldAcc 是 pack 目录「结构折叠指纹」的累积器（D2′-b / ADR-269）：
// sum 为子文件 fnv64a("<rel>:<size>") 的顺序无关之和，count 为参与累积的子文件数。
type foldAcc struct {
	sum   uint64
	count int
}

// walkFoldState 承载 Walk 期间的折叠指纹累积状态（pack 目录 → 累积器 / 绝对前缀）。
type walkFoldState struct {
	packFold   map[string]*foldAcc // pack 目录 relKey -> 累积器
	packDirAbs map[string]string   // pack 目录 relKey -> 绝对路径 + 分隔符
}

// addFile 把一个文件计入其所属 pack 目录的折叠指纹：须在 IsResourceAllowed 过滤
// 之前调用，令被过滤的纹理/mcmeta 等子文件也计入所属 pack 目录——正是盲区②的载荷。
// 零新 I/O（info 已由目录枚举给出、无额外 stat）、与 scanFn 无关（UI nil 路径亦生效）。
func (f *walkFoldState) addFile(path string, size int64) {
	for k, dirPrefix := range f.packDirAbs {
		if !strings.HasPrefix(path, dirPrefix) {
			continue
		}
		rel := filepath.ToSlash(strings.ToLower(strings.TrimPrefix(path, dirPrefix)))
		h := fnv.New64a()
		h.Write([]byte(rel))
		h.Write([]byte{':'})
		h.Write([]byte(strconv.FormatInt(size, 10)))
		acc := f.packFold[k]
		acc.sum += h.Sum64()
		acc.count++
	}
}

// walkEntryState 是单侧目录 Walk 的收集状态——原 SyncResourcesWithConfig 内联闭包
// 捕获的局部量提升为字段（提取后行为等价，圈复杂度自函数本体转移）。
type walkEntryState struct {
	rootDir          string
	isPackFolderType bool
	entries          map[string]DiffEntry
	hashByKey        map[string]string
	fold             walkFoldState
	rootFailed       bool // 根目录本身 Walk 失败：结果不可信，短路且不入缓存
	partialFail      bool // 部分子树失败：残缺 entries 不入缓存
}

// handleDir 处理 Walk 遇到的目录：跳过回收站；资源包文件夹自身成条目但不递归。
func (s *walkEntryState) handleDir(path string) error {
	// 跳过回收站目录（与 scanner.ScanEntries 对齐）：回收站内模型不是仓库活跃模型
	if path != s.rootDir && fsutil.IsRecycleDir(path) {
		return filepath.SkipDir
	}
	// 资源包文件夹：扫描其本身但不递归（仅资源包类型收集）
	if path != s.rootDir && s.isPackFolderType && fsutil.IsResourcePackFolder(path) {
		if key := relKey(s.rootDir, path); key != "" {
			s.entries[key] = DiffEntry{Path: path, IsDir: true}
			s.fold.packFold[key] = &foldAcc{}
			s.fold.packDirAbs[key] = path + string(os.PathSeparator)
		}
	}
	return nil
}

// walkFn 是 filepath.Walk 的回调：目录走 handleDir，文件先累积折叠指纹再按允许清单收条目。
func (s *walkEntryState) walkFn(path string, info os.FileInfo, err error) error {
	if err != nil {
		log.Printf("[sync] Walk 错误 %s: %v", path, err)
		if path == s.rootDir {
			s.rootFailed = true
		} else {
			s.partialFail = true
		}
		return nil
	}
	if info.IsDir() {
		return s.handleDir(path)
	}
	// 折叠指纹累积（D2′-b）：须在 IsResourceAllowed 过滤之前，
	// 令被过滤的纹理/mcmeta 等子文件也计入所属 pack 目录。
	s.fold.addFile(path, info.Size())
	if !registry.IsResourceAllowed(info.Name()) {
		return nil
	}
	if key := relKey(s.rootDir, path); key != "" {
		s.entries[key] = DiffEntry{Path: path, Size: info.Size(), Hash: s.hashByKey[key]}
	}
	return nil
}

// collectScanHashes 旁挂 scanner 哈希：以 relKey(rootDir, e.Path) 归一为键，与 entries
// 的 key 同源，规避 scanner 与裸 Walk 两套 path 字面不一致。scanFn 命中 scanner 30s
// 缓存、哈希在其侧并行预算——非 sync 热路径现算（不触 hashlock 红线）。
// nil → 空表 → 条目无哈希 → 回退 Size。
func collectScanHashes(rootDir string, scanFn ScanFunc) map[string]string {
	hashByKey := make(map[string]string)
	if scanFn == nil {
		return hashByKey
	}
	for _, e := range scanFn(rootDir) {
		if e.Hash == "" {
			continue
		}
		if rk := relKey(rootDir, e.Path); rk != "" {
			hashByKey[rk] = e.Hash
		}
	}
	return hashByKey
}

// collectResourceEntries 全树递归扫描一侧目录：文件条目 + 资源包文件夹条目。
// key 为相对路径（relKey），过滤与归一化统一走 types，对比归并统一走
// ResourceDiff（ADR-064：scanner 口径 + 单点对比，消除手工对齐漂移）。
// 结果叠 30s sync 目录扫描缓存：同一 root+rtype 在 TTL 内只真正 Walk 一次。
//
// 原为 SyncResourcesWithConfig 的内联闭包，提取为顶层函数以拆解该函数圈复杂度
// （gocyclo 33>20，ADR-269 D2′-a/b 引入；纯提取、行为等价）。
func collectResourceEntries(rootDir, rtypeID string, isPackFolderType bool, scanFn ScanFunc) map[string]DiffEntry {
	cacheKey := syncDirectoryScanKey{kind: "resources", root: rootDir, rtype: rtypeID, hashed: scanFn != nil}
	if cached, ok := loadSyncScanCache[map[string]DiffEntry](&syncResourcesScanCache, cacheKey); ok {
		return cached
	}
	st := &walkEntryState{
		rootDir:          rootDir,
		isPackFolderType: isPackFolderType,
		entries:          make(map[string]DiffEntry),
		hashByKey:        collectScanHashes(rootDir, scanFn),
		fold: walkFoldState{
			packFold:   make(map[string]*foldAcc),
			packDirAbs: make(map[string]string),
		},
	}
	// Walk 的 error 仅由 walkFn 返回非 nil 非 SkipDir 触发（本实现恒返回 nil/SkipDir），
	// 故此处实际只作 errcheck 契约兜底 + 诊断留痕，不改变返回值语义。
	if err := filepath.Walk(rootDir, st.walkFn); err != nil {
		log.Printf("[sync] Walk 中止 %s: %v", rootDir, err)
	}
	// Walk 结束：把每个 pack 目录的折叠指纹回填到其 IsDir 条目（D2′-b）。
	for k, acc := range st.fold.packFold {
		if e, ok := st.entries[k]; ok {
			e.FoldDigest = fmt.Sprintf("%x:%d", acc.sum, acc.count)
			st.entries[k] = e
		}
	}
	// 完整 Walk 才入缓存：rootFailed 已短路，partialFail 时残缺 entries 不入缓存，
	// 避免后续 30s 内调用方拿到不完整结果
	if !st.rootFailed && !st.partialFail {
		storeSyncScanCache(&syncResourcesScanCache, cacheKey, st.entries)
	}
	return st.entries
}

// handleSyncConflicts 按配置的冲突策略检测并解决冲突（原 SyncResourcesWithConfig
// 内联块提取）。无配置或策略为空时直接返回。
func handleSyncConflicts(config *types.SyncConfig, instanceDir, globalDir, rtypeID string) {
	if config == nil || config.ConflictPolicy == "" {
		return
	}
	// 锁契约软断言（owner-tracked，消除旧 TryLock 误判窗口）：
	// 持锁时走 *Locked 变体（快速路径，不重入加锁）；未持锁时改调自锁的
	// ResolveConflicts（公开入口）——不会 self-deadlock（未持锁语境下加锁无重入），
	// 消除旧 fail-soft 静默放行导致的无锁并发写目录竞态（2026-09-14 审核修复：
	// 旧注释声称「ResolveConflictsLocked 内部会自锁」与实现不符，实际无锁执行）。
	// 断言仅记日志不 panic——原 panic 设计因分段持锁（SyncToggleStatus 阶段2锁外哈希）
	// 导致锁释放后误报，已降级为 fail-soft。
	held := assertInstallLockHeld()
	if !held {
		log.Printf("[sync] 警告: SyncResourcesWithConfig 冲突处理未在 InstallLock 内执行，改走自锁入口")
	}
	report, err := DetectConflicts(instanceDir, globalDir, rtypeID)
	if err != nil {
		log.Printf("[sync] 冲突检测失败: %v", err)
		return
	}
	if report.TotalConflicts == 0 {
		return
	}
	log.Printf("[sync] 检测到 %d 个冲突，策略: %s", report.TotalConflicts, config.ConflictPolicy)
	strategy := ResolutionStrategy(config.ConflictPolicy)
	if strategy != ResolveForceRemote && strategy != ResolveForceLocal {
		// 手动解决模式，返回结果中标记冲突
		log.Printf("[sync] 检测到冲突，请手动处理")
		return
	}
	var resolved, failed, manual int
	if held {
		// 已持锁：走 *Locked 变体（可能经 PushResources/PullResources →
		// SyncResources 在 InstallLock 临界区内运行，重入自锁入口会 self-deadlock）。
		resolved, failed, manual = ResolveConflictsLocked(report.Conflicts, strategy, instanceDir, globalDir)
	} else {
		// 未持锁：走自锁公开入口，避免无锁执行冲突解决（并发写目录竞态）。
		resolved, failed, manual = ResolveConflicts(report.Conflicts, strategy, instanceDir, globalDir)
	}
	log.Printf("[sync] 冲突解决完成: 解决 %d, 失败 %d, 需手动 %d", resolved, failed, manual)
}

// SyncResourcesWithConfig 按配置同步两侧目录的资源：收集 → 对比 → 冲突处理。
// rtype 为可选资源类型 ID（空 = 旧行为兼容，逻辑等价于资源包类型）。
func SyncResourcesWithConfig(globalDir, instanceDir string, config *types.SyncConfig, scanFn ScanFunc, rtype ...string) types.ResourceSyncResult {
	rtypeID := ""
	if len(rtype) > 0 {
		rtypeID = rtype[0]
	}
	// 资源包文件夹（含 pack.mcmeta）作为同步单元——仅资源包类型（detector=mcmeta）
	// 或空 rtype（旧行为兼容）收集。P5 修复：原实现不分类型一律收集，蓝图仓库
	// （blueprint）里误放的资源包文件夹被当成蓝图 missing 显示"推送"，
	// 而该目录实际没有任何 .nbt/.schematic（识别错文件）。
	isPackFolderType := rtypeID == "" || isMcmetaDetectorType(rtypeID)

	globalFiles := collectResourceEntries(globalDir, rtypeID, isPackFolderType, scanFn)
	instanceFiles := collectResourceEntries(instanceDir, rtypeID, isPackFolderType, scanFn)
	result := ResourceDiff(globalFiles, instanceFiles)

	handleSyncConflicts(config, instanceDir, globalDir, rtypeID)

	return result
}

// assertInstallLockHeld 返回调用方是否已持有 installer.InstallLock。
// 使用 LockTracker.HasLock() 精确验证「本 goroutine 是否持有」——
// 消除旧 TryLock 探测的误判窗口（他人 goroutine 持锁时 TryLock 失败被误判为已持锁）。
//
// 降级语义（测试 stub 场景）：
//   - 若 InstallLocker 未实现 HasLock 接口（如测试注入的 stub），则返回 true（放行）
//     （测试桩通常自行保证锁契约，不影响正确性）。
//
// 返回值：true = 本 goroutine 持有 InstallLock（可安全调用 *Locked 变体）；
//
//	false = 未持有（调用方应自行加锁或接受 fail-soft 降级）。
func assertInstallLockHeld() bool {
	lt, ok := installer.InstallLocker.(interface{ HasLock() bool })
	if !ok {
		return true // 测试 stub 无 HasLock → 放行（保持向后兼容）
	}
	return lt.HasLock()
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

// SyncToggleStatus 阶段 4 遇 Windows 共享锁瞬时争用时的重试窗口。
// 50ms 足够容忍杀毒/索引器等瞬时句柄占用，又远低于一次同步的提交粒度，
// 不会让整个 Rename 循环因单文件重试而显著拖长。
const fileLockRetryDelay = 50 * time.Millisecond

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
