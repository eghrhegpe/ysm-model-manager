// ===== 重链接执行（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 relinkDir 提取：按 SHA256 哈希比对
// 将整合包实例目录中的文件重新链接到仓库版本（原子替换，失败回滚）。
// scanFn（扫描）/ linkMode / logger 由薄壳注入。
package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// RelinkDir 按哈希比对重链接实例目录与仓库（原子替换，失败回滚）
func RelinkDir(customDir, filesRoot, rtype, linkMode string, scanFn func(string) []types.ModelEntry, logger Logger) (int, error) {
	customDir = strings.TrimSpace(customDir)
	filesRoot = strings.TrimSpace(filesRoot)
	if customDir == "" || filesRoot == "" {
		return 0, fmt.Errorf("参数为空")
	}
	if scanFn == nil {
		return 0, fmt.Errorf("scanFn 为空")
	}

	// 锁外扫描（镜像 SyncToggleStatus 的「锁外哈希」自我修正：relink 的 repo/custom
	// 全量扫描含 SHA256 哈希，持锁执行会阻塞所有其他同步/安装操作）。
	// TOCTOU 容忍：哈希仅作为 content 关联兜底，锁外快照后文件被外部修改的概率极低
	// （SyncToggleStatus 同款理由，单进程桌面应用无并发 relink 同 customDir 路径）。
	// 目录级分支（下方 isDirType）的 rename/回滚目标 dstParent 在锁内 rename 前经
	// dstSnapshots + os.SameFile 复验（ADR-296 D4），收窄「锁外快照→锁内 rename」
	// 窗口内 dstParent 被 rename 走/替换为异体目录导致的搬错对象；残余窗口见
	// dstSnapshots 收集处注释。
	repoByHash := buildRelinkRepoIndex(scanFn(filesRoot))
	customEntries := scanFn(customDir)

	// ADR-296 D4：目录级替换分支的 dstParent 锁外快照——rename/回滚的原子性前提是
	// 「锁内搬的就是扫描时观察到的那个目录」。对将走整目录替换的条目（isDirType 且非
	// 根层平铺）在锁外 Lstat 父目录，锁内 rename 前经 verifyDirSnapshot 复验。
	// 仅逐条 Lstat（微秒级），不违 TestRelinkDir_ScanNotHeldLock 的「全量扫描不持锁」契约。
	dirSnaps := snapshotRelinkDirTargets(customEntries, rtype, customDir)

	// 整段持 installer.InstallLock（仅覆盖操作段，不含锁外扫描）：RelinkDir 自身对 custom
	// 目录做 os.Rename/os.RemoveAll（目录级分支的备份/回滚/清理）——ADR-056 要求同步与
	// 安装并发操作同一 custom 目录文件时互斥，这些目录级写操作不能只靠 installer 内部
	// 文件级锁覆盖。内部对 installer.Install/InstallDir/CopyFile 的调用改用对应 *Locked
	// 变体，避免同一 goroutine 重入非重入 mutex 死锁（第六轮整段持锁 + 调用公开函数的
	// 死锁回归）。
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	defer InvalidateSyncScanCaches() // 重链接会改实例目录，清同步扫盘缓存防陈旧

	count := 0
	// replacedDirs 记录本轮已整夹替换过的实例目录（小写规范化路径）——同夹多条目
	// （一个模型夹里两个目录型入口，如 ysm.json + model.ysm）**共享一次替换结果**：
	// 首次替换后该夹已是仓库版本，后续条目直接计成功，不得再搬一次。
	// 必要性由 ADR-342 的身份复验根治换来：复验修好之前 os.SameFile 恒真（比的是路径
	// 对自己），第二条目「通过」并白做一次替换；修好后第二条目会**正确地**发现
	// 「目录已被替换」——若不在此承接，就会把自己刚做的事报成失败（误报）。
	replacedDirs := make(map[string]bool)
	for _, ce := range customEntries {
		// 重链备份目录尸体不参与重链（斩断 rename→InstallDir→新备份 套娃，ADR-296 D3）；
		// 无哈希无法做内容关联；禁用条目跳过——禁用文件保持禁用，否则 Install 会把仓库
		// 活跃版装回实例、用户禁用被悄悄撤销。
		if isRelinkEntrySkippable(ce) {
			continue
		}
		srcPath := pickRelinkSource(repoByHash[ce.Hash])
		if srcPath == "" {
			continue
		}
		// 目录型模型文件判定（ADR-064 锚定）：原硬编码 ysm.json/.pmx/.pmd；
		// 现为该类型注册表 dirLevelSync + 文件属于该类型——新增目录型类型自动生效
		baseName := registry.StripDisableSuffix(strings.ToLower(filepath.Base(ce.Path)))
		isDirType := registry.IsDirLevelSync(rtype) && packs.IsTypeModelFile(baseName, rtype)
		// 注：此处传剥 .disabled/.ban 后的 baseName（relink 需识别禁用文件的目录型——
		// 原 ce.Path 未剥后缀时 filepath.Ext 得 ".ban" 不匹配任何扩展集，测试红）。
		// 代价：MMD 目录型 .zip 在 relink 不识别（裸名 zip 分支开不了文件）——
		// 如需 zip 目录型 relink，需拆路径感知 + 剥离感知的专门 API（本轮不做）
		if !isDirType {
			// 传入基础 customDir，让 installer.Install 自行计算相对路径。
			// Install 内部对已存在的旧文件做原子替换（临时链接 + rename），失败不破坏原文件
			if err := installer.InstallLocked(srcPath, customDir, filesRoot, linkMode); err != nil {
				logRelinkFailure(ce, customDir, "relink 失败: "+err.Error(), logger)
				continue
			}
			count++
			continue
		}
		dstParent := filepath.Dir(ce.Path)
		// ce.Path 已在目标子目录内，父层才是 InstallDir 要写入的基础目录。
		// ysm.json/.pmx 平铺在 customDir 根层时（dstParent == customDir），
		// InstallDir 的「挪走整目录→重建→回滚」会连带把同目录其他模型一起 rename 走、
		// 重建失败回滚后其他模型也随备份 RemoveAll 丢失。根层平铺退化为单文件落地，
		// 不做整目录替换。
		// flat 判定大小写敏感——Windows 上实例目录名
		// 大小写与 customDir 不一致时落入 dir 分支，把整个 customDir 当模型目录
		// rename 走（数据丢失复现）。对齐 ADR-044③ 用 EqualFold。
		if strings.EqualFold(filepath.Clean(dstParent), filepath.Clean(customDir)) {
			if relinkFlatEntry(ce, srcPath, customDir, logger) {
				count++
			}
			continue
		}
		dirKey := strings.ToLower(filepath.Clean(dstParent))
		if replacedDirs[dirKey] {
			// 该夹本轮已整夹替换（仓库版本已落盘），本条目的入口文件随之一并到位：
			// 计成功但不重复搬动，避免「刚建好又搬一次」与多余备份
			count++
			continue
		}
		if relinkReplaceDirTree(ce, filepath.Dir(srcPath), dstParent, dirSnaps, filesRoot, linkMode, rtype, logger) {
			replacedDirs[dirKey] = true
			count++
		}
	}
	return count, nil
}

// isRelinkEntrySkippable 报告扫描条目是否必须剔出重链（索引构建与主循环共用同一谓词）。
// 三类：重链备份目录尸体（ADR-296 D3）、空哈希（无法内容关联）、禁用标记条目
// （仓库侧禁用条目只是标记不得充当重链源；实例侧禁用文件保持禁用不静默恢复）。
func isRelinkEntrySkippable(e types.ModelEntry) bool {
	return isRelinkBackupPath(e.Path) ||
		e.Hash == "" ||
		registry.IsDisableSuffix(e.Name)
}

// buildRelinkRepoIndex 按哈希归并仓库条目为「hash → 候选源」，先剔出可跳过条目
// （备份尸体/空哈希/禁用），使主循环只做 O(1) 命中查询。
// 调用方须在 installer.InstallLock 之外调用（含 SHA256 的全量扫描不得持锁）。
func buildRelinkRepoIndex(repoEntries []types.ModelEntry) map[string][]types.ModelEntry {
	repoByHash := make(map[string][]types.ModelEntry)
	for _, e := range repoEntries {
		if isRelinkEntrySkippable(e) {
			continue
		}
		repoByHash[e.Hash] = append(repoByHash[e.Hash], e)
	}
	return repoByHash
}

// dirIdentity 取「目录身份」快照——复验的输入必须是**立刻固化**的对象身份。
//
// ⚠️ 不可用 os.Lstat 直接当身份（ADR-342 根治）：Windows 上 os.Lstat 产出惰性
// fileStat（只存路径不存文件 ID），os.SameFile 时才按路径名 CreateFile 取 ID
// （Go stdlib os/types_windows.go loadFileId）→ 快照与现取都解析到「P 现在是谁」，
// 比的是自己对自己，恒真。故本函数把路径**打开成句柄**再 Stat：句柄态 stat 由
// GetFileInformationByHandle 直接填 vol/idx 并清掉延迟路径，身份在调用瞬间固化，
// 之后的 rename/replace 不会把它改写成别的对象。
func dirIdentity(path string) (os.FileInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	return f.Stat()
}

// snapshotRelinkDirTargets 锁外取将走整目录替换的条目的 dstParent 身份（ADR-296 D4），
// 供锁内 verifyDirSnapshot 复验「锁内搬的就是扫描时观察到的那个目录」。
// 仅收目录级同步类型下的模型文件条目；dstParent 即 customDir 根层的平铺条目不做整目录
// rename，无需快照。取身份失败（目录不存在/竞态中消失）→ 无快照 → 由 verifyDirSnapshot
// 的调用方拒绝搬运并记 logger（行为与加固前一致）。
func snapshotRelinkDirTargets(customEntries []types.ModelEntry, rtype, customDir string) map[string]os.FileInfo {
	dirSnaps := make(map[string]os.FileInfo)
	if !registry.IsDirLevelSync(rtype) {
		return dirSnaps
	}
	for _, ce := range customEntries {
		baseName := registry.StripDisableSuffix(strings.ToLower(filepath.Base(ce.Path)))
		if !packs.IsTypeModelFile(baseName, rtype) {
			continue
		}
		dstParent := filepath.Dir(ce.Path)
		if strings.EqualFold(filepath.Clean(dstParent), filepath.Clean(customDir)) {
			continue // 平铺分支不做整目录 rename，无需复验
		}
		if info, err := dirIdentity(dstParent); err == nil {
			dirSnaps[ce.Path] = info
		}
	}
	return dirSnaps
}

// pickRelinkSource 取该哈希下的第一个非禁用源路径（防御：即使索引构建时已跳过禁用，
// 查询仍只取第一个非禁用条目）。无可用源返回空串，调用方据此跳过该条目。
func pickRelinkSource(entries []types.ModelEntry) string {
	for _, e := range entries {
		if registry.IsDisableSuffix(e.Name) {
			continue
		}
		return e.Path
	}
	return ""
}

// relinkFlatEntry 把仓库源平铺落到 customDir 根层，返回是否计入成功数。
// 用 CopyFile 而非 Install：Install 按 rel(srcPath, repoRoot) 推导目标，仓库侧文件在
// 子目录时会装到 <customDir>/<subdir>/<base>，而平铺位置 <customDir>/<base> 残留陈旧
// 副本（报告成功但游戏实际加载的文件未重链）。
// 调用方须持 installer.InstallLock（走 *Locked 变体，避免重入死锁）。
func relinkFlatEntry(ce types.ModelEntry, srcPath, customDir string, logger Logger) bool {
	if _, err := installer.CopyFileLocked(srcPath, customDir); err != nil {
		logRelinkFailure(ce, customDir, "relink 失败: "+err.Error(), logger)
		return false
	}
	return true
}

// collectInstanceOnlyFiles 收集实例夹内「仓库侧没有」的文件**相对路径**（正斜杠）。
// 用途（ADR-342）：整夹替换前先记账、替换成功后回填。替换的语义是「把实例夹换成仓库
// 版本」，**不是**「删掉用户放在这个夹里的东西」——原实现把旧夹 rename 成备份后
// RemoveAll，自制贴图/额外子目录就此永久消失（且日志为空、count 报全成功）。
//
// ⚠️ 只记相对路径，**不记绝对路径**：调用方紧接着会 os.Rename 掉 instDir，
// 绝对路径当场失效（回填必失败）。回填的源 = 备份目录 + 相对路径。
// 递归收集使「实例独有子目录」整体存活；跳过回收站与备份尸体子树（非用户数据）。
func collectInstanceOnlyFiles(instDir, repoDir string) []string {
	var extras []string
	_ = filepath.WalkDir(instDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 尽力而为：读不了的子树跳过（不可读条目不属于可保全范围）
		}
		if d.IsDir() {
			if p != instDir && (fsutil.IsRecycleDir(p) || isRelinkBackupPath(p)) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, relErr := filepath.Rel(instDir, p)
		if relErr != nil {
			return nil
		}
		relSlash := filepath.ToSlash(rel)
		// 仓库侧同相对路径存在 → 非独有（替换会以仓库版覆盖它，正是 relink 本意）
		if _, statErr := os.Stat(filepath.Join(repoDir, filepath.FromSlash(relSlash))); statErr == nil {
			return nil
		}
		extras = append(extras, relSlash)
		return nil
	})
	sort.Strings(extras)
	return extras
}

// restoreInstanceOnlyFiles 从备份目录把实例独有文件回填到替换后的新夹，
// 返回未成功的相对路径。失败不静默（调用方据此保留备份 + 记日志）：
// 宁留一个恢复点，不无声丢数据。
func restoreInstanceOnlyFiles(backupDir string, rels []string, newDir string) []string {
	var failed []string
	for _, rel := range rels {
		src := filepath.Join(backupDir, filepath.FromSlash(rel))
		dst := filepath.Join(newDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), fsutil.DirPerms); err != nil {
			failed = append(failed, rel)
			continue
		}
		if err := fsutil.CopyFile(src, dst); err != nil {
			failed = append(failed, rel)
		}
	}
	return failed
}

// relinkReplaceDirTree 整目录原子替换：rename 旧目录为带时间戳备份 → InstallDir 重建 →
// 成功清理备份 / 失败回滚（删半成品 + 备份 rename 回原位）。返回是否计入成功数。
// 时间戳备份名（P2-4）与 conflict.go 的 .bak-<ts> 口径对齐，避免上一次失败遗留的恢复点
// 被本次无条件 RemoveAll 掉。srcDir 为仓库侧模型文件夹，dstParent 为实例侧待替换目录。
// 调用方须持 installer.InstallLock（os.Rename/os.RemoveAll 与 InstallDirLocked 同段互斥）。
func relinkReplaceDirTree(ce types.ModelEntry, srcDir, dstParent string, dirSnaps map[string]os.FileInfo,
	filesRoot, linkMode, rtype string, logger Logger) bool {
	// 上一层目录作为 dstDir，让 InstallDir 自动创建 {targetSubDir}——若直接传 dstParent
	// 则 InstallDir 会在已是模型目录的它之下二次嵌套。
	dstBase := filepath.Dir(dstParent)
	// ADR-296 D4 锁内复验：搬前确认 dstParent 仍是锁外快照观察到的那个对象
	// （谓词与残余窗口说明见 verifyDirSnapshot）
	snap, hasSnap := dirSnaps[ce.Path]
	if !hasSnap {
		// 锁外 Lstat 即失败（目录不存在/竞态窗口中消失）——拒绝搬一个
		// 从未观察到的对象；改名/删除竞态中重建的同名目录不是快照对象
		logRelinkFailure(ce, dstParent, "relink 跳过: 目标目录快照缺失（已不存在或扫描窗口中被改动）", logger)
		return false
	}
	if ok, reason := verifyDirSnapshot(snap, dstParent); !ok {
		logRelinkFailure(ce, dstParent, "relink 跳过: "+reason, logger)
		return false
	}
	// ADR-342：替换前记账实例独有文件（用户数据），成功后从备份回填——替换不等于删除
	extras := collectInstanceOnlyFiles(dstParent, srcDir)
	backup := fmt.Sprintf("%s.relink-bak-%d", dstParent, time.Now().UnixNano())
	if err := os.Rename(dstParent, backup); err != nil {
		logRelinkFailure(ce, dstParent, "relink 备份目录失败: "+err.Error(), logger)
		return false
	}
	if err := installer.InstallDirLocked(srcDir, dstBase, filesRoot, linkMode, rtype); err != nil {
		rollbackRelinkReplace(ce, dstParent, dstBase, srcDir, backup, logger)
		logRelinkFailure(ce, dstParent, "relink 失败: "+err.Error(), logger)
		return false
	}
	// 回填实例独有文件到新夹（InstallDir 落位 = dstBase/<仓库夹名>，与 resolveFinalDst 同规）
	newDir := filepath.Join(dstBase, filepath.Base(srcDir))
	if _, statErr := os.Stat(newDir); statErr != nil {
		rollbackRelinkReplace(ce, dstParent, dstBase, srcDir, backup, logger)
		logRelinkFailure(ce, dstParent, "重链后未找到重建目录 "+newDir+"，已整体回滚该夹（未重链）: "+
			statErr.Error(), logger)
		return false
	}
	if failed := restoreInstanceOnlyFiles(backup, extras, newDir); len(failed) > 0 {
		// 回填失败 → **整夹回滚**（本函数承诺「原子替换」：要么按仓库版重建且用户独有文件
		// 全部到位，要么原地不动）。半成品态（新夹 + 独有文件滞留备份）会让用户在游戏里
		// 看到残缺模型，且事后没人知道该怎么补——回滚是可解释的终态。
		// 回滚本身失败时 rollbackRelinkReplace 会保留备份并记日志（恢复点仍在）。
		rollbackRelinkReplace(ce, dstParent, dstBase, srcDir, backup, logger)
		logRelinkFailure(ce, dstParent, fmt.Sprintf(
			"实例独有文件回填失败 %d 个（%s），已整体回滚该夹（未重链）",
			len(failed), strings.Join(failed, "、")), logger)
		return false
	}
	removeRelinkBackup(backup, ce, dstParent, logger)
	return true
}

// rollbackRelinkReplace 是整目录替换失败后的恢复路径：先删半成品重建目录，再把备份
// rename 回原位。两步失败都只记 logger 不吞净——残留半成品/滞留 .relink-bak 都是
// 用户需要知道的现场（原 `_ =` 静默吞错会让实例目录缺失且无人知晓）。
func rollbackRelinkReplace(ce types.ModelEntry, dstParent, dstBase, srcDir, backup string, logger Logger) {
	if rmErr := os.RemoveAll(filepath.Join(dstBase, filepath.Base(srcDir))); rmErr != nil {
		logRelinkFailure(ce, dstParent, "回滚删除半成品失败: "+rmErr.Error(), logger)
	}
	// 回滚 rename 失败不再静默吞——原目录滞留 .relink-bak、实例目录缺失且函数继续执行
	// （静默数据不可达）；记 logger 供用户排查（不 return——目录已损坏，继续无意义）
	if rbErr := os.Rename(backup, dstParent); rbErr != nil {
		logRelinkFailure(ce, dstParent,
			"relink 失败且回滚失败，原目录滞留 "+filepath.Base(backup)+": "+rbErr.Error(), logger)
	}
}

// logRelinkFailure 是重链各失败路径的统一出口：logger 为 nil 时静默（薄壳可不注入）。
func logRelinkFailure(ce types.ModelEntry, dst, msg string, logger Logger) {
	if logger != nil {
		logger(ce.Name, ce.Path, dst, 0, types.StatusFailed, msg)
	}
}

// isRelinkBackupPath 判断路径是否落在某次 relink 的备份目录（`<目录名>.relink-bak-<UnixNano>`）子树内。
// 备份名是**后缀形态**（不是独立段），故不能照抄 sync.go hasRecycleSegment 的逐段精确 EqualFold——
// 必须逐段判「是否含 .relink-bak-」。命中即从 relink/toggle 的扫描条目集中剔除：
// 否则备份目录内的模型条目（Go WalkDir 与生产 Rust 快路径都会下钻并填哈希）哈希恒匹配仓库原件，
// 触发对尸体的 rename→InstallDir→再生新备份，套娃增长（ADR-296 D3）。
// 谓词判「任一段」而非只判 basename：备份目录**内部**的文件（Path 含 .relink-bak 段）同样要剔除。
func isRelinkBackupPath(p string) bool {
	for _, seg := range strings.Split(p, string(filepath.Separator)) {
		if strings.Contains(strings.ToLower(seg), ".relink-bak-") {
			return true
		}
	}
	return false
}

// verifyDirSnapshot 锁内 rename 前复验 dstParent 仍是快照观察到的对象（ADR-296 D4）。
// os.SameFile 比对文件身份：Windows 走 VolumeSerial+FileIndex、Unix 走 dev+ino
// （installer.sameDir 同口径，双端可用，不依赖 Sys() 断言）。
// 能检出：路径被换成异体对象（rename 搬走/删除后新建）→ 拒搬。
// 诚实标注的残余窗口（不可检出，接受）：
//   - 目录内容增删不改目录自身身份——relink 本就整目录覆盖重建，内容漂移不威胁「搬对对象」；
//   - NTFS FileId 删除后立即回收复用的极端巧合（理论漏检，概率≈0）；
//   - InstallLock 只互斥本进程，复验 Lstat 与 Rename 之间外部进程仍可改动——窗口已从
//     「扫描→rename 全程」收窄为「两条相邻 syscall 之间」。
func verifyDirSnapshot(snap os.FileInfo, dstParent string) (bool, string) {
	cur, err := dirIdentity(dstParent)
	if err != nil {
		return false, "目标目录已不存在: " + err.Error()
	}
	if !cur.IsDir() {
		return false, "目标已不是目录（快照后类型被改动）"
	}
	if !os.SameFile(snap, cur) {
		return false, "目标目录已被替换为另一对象（锁外快照失效）"
	}
	return true, ""
}

// removeRelinkBackup 删除 relink 成功后的备份目录，失败仅记 logger 不吞净——
// 残留 .relink-bak-<ts> 提示用户确有恢复点未清理，静默 `_ =` 会让备份目录
// 在用户模型目录堆积且无人知晓（P2 修复，替代旧 `_ = os.RemoveAll(backup)`）。
func removeRelinkBackup(backup string, ce types.ModelEntry, dstParent string, logger Logger) {
	if err := os.RemoveAll(backup); err != nil {
		logRelinkFailure(ce, dstParent, "清理 relink 备份目录失败: "+err.Error(), logger)
	}
}
