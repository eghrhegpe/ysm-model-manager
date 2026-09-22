// ===== 重链接执行（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 relinkDir 提取：按 SHA256 哈希比对
// 将整合包实例目录中的文件重新链接到仓库版本（原子替换，失败回滚）。
// scanFn（扫描）/ linkMode / logger 由薄壳注入。
package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

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
	repoEntries := scanFn(filesRoot)
	repoByHash := make(map[string][]types.ModelEntry)
	for _, e := range repoEntries {
		// 重链备份目录尸体不得充当重链源（ADR-296 D3，谓词说明见 isRelinkBackupPath）
		if isRelinkBackupPath(e.Path) {
			continue
		}
		if e.Hash == "" {
			continue
		}
		// 仓库侧禁用条目只是禁用标记，不能作为重链接源（与 sync.go 对齐）
		if registry.IsDisableSuffix(e.Name) {
			continue
		}
		repoByHash[e.Hash] = append(repoByHash[e.Hash], e)
	}
	customEntries := scanFn(customDir)

	// ADR-296 D4：目录级替换分支的 dstParent 锁外快照——rename/回滚的原子性前提是
	// 「锁内搬的就是扫描时观察到的那个目录」。对将走整目录替换的条目（isDirType 且非
	// 根层平铺）在锁外 Lstat 父目录，锁内 rename 前经 verifyDirSnapshot 复验。
	// 仅逐条 Lstat（微秒级），不违 TestRelinkDir_ScanNotHeldLock 的「全量扫描不持锁」契约。
	dirSnaps := make(map[string]os.FileInfo)
	if registry.IsDirLevelSync(rtype) {
		for _, ce := range customEntries {
			baseName := registry.StripDisableSuffix(strings.ToLower(filepath.Base(ce.Path)))
			if !packs.IsTypeModelFile(baseName, rtype) {
				continue
			}
			dstParent := filepath.Dir(ce.Path)
			if strings.EqualFold(filepath.Clean(dstParent), filepath.Clean(customDir)) {
				continue // 平铺分支不做整目录 rename，无需复验
			}
			if info, err := os.Lstat(dstParent); err == nil {
				dirSnaps[ce.Path] = info
			}
			// Lstat 失败（目录不存在/竞态中消失）→ 无快照 → 复验放行，
			// 由锁内 rename 走原有失败路径记 logger（行为与加固前一致）
		}
	}

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
	for _, ce := range customEntries {
		// 重链备份目录尸体不参与重链（斩断 rename→InstallDir→新备份 套娃，ADR-296 D3）
		if isRelinkBackupPath(ce.Path) {
			continue
		}
		if ce.Hash == "" {
			continue
		}
		// 重链接不得静默恢复禁用状态——禁用文件跳过（保持禁用），
		// 否则 Install 会把仓库活跃版装回实例、用户禁用被悄悄撤销
		if registry.IsDisableSuffix(ce.Name) {
			continue
		}
		entries, found := repoByHash[ce.Hash]
		if !found {
			continue
		}
		var srcPath string
		for _, e := range entries {
			// 防御：即使构建时已跳过，查询仍只取第一个非禁用条目
			if registry.IsDisableSuffix(e.Name) {
				continue
			}
			srcPath = e.Path
			break
		}
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
		if isDirType {
			srcDir := filepath.Dir(srcPath)
			// ce.Path 已在目标子目录内，父层才是 InstallDir 要写入的基础目录
			dstParent := filepath.Dir(ce.Path)
			// ysm.json/.pmx 平铺在 customDir 根层时（dstParent == customDir），
			// InstallDir 的「挪走整目录→重建→回滚」会连带把同目录其他模型一起 rename 走、
			// 重建失败回滚后其他模型也随备份 RemoveAll 丢失。根层平铺退化为单文件落地，
			// 不做整目录替换。
			// flat 判定大小写敏感——Windows 上实例目录名
			// 大小写与 customDir 不一致时落入 dir 分支，把整个 customDir 当模型目录
			// rename 走（数据丢失复现）。对齐 ADR-044③ 用 EqualFold。
			if strings.EqualFold(filepath.Clean(dstParent), filepath.Clean(customDir)) {
				// 用 CopyFile 装到 customDir 平铺位置——
				// installer.Install 按 rel(srcPath, repoRoot) 推导目标，仓库侧文件在子目录时
				// 会装到 <customDir>/<subdir>/<base> 而平铺位置 <customDir>/<base> 残留陈旧副本
				//（报告成功但游戏实际加载的文件未重链）。CopyFile 直接落地到平铺目录。
				if _, err := installer.CopyFileLocked(srcPath, customDir); err != nil {
					if logger != nil {
						logger(ce.Name, ce.Path, customDir, 0, "failed", "relink 失败: "+err.Error())
					}
					continue
				}
				count++
				continue
			}
			// 但 InstallDir 会自动创建 {targetSubDir}，如果 dstParent 已经是模型目录
			// 则会二次嵌套。正确的做法：上一层目录作为 dstDir，让 InstallDir 创建子目录
			dstBase := filepath.Dir(dstParent)
			// ADR-296 D4 锁内复验：搬前确认 dstParent 仍是锁外快照观察到的那个对象
			// （谓词与残余窗口说明见 verifyDirSnapshot）
			snap, hasSnap := dirSnaps[ce.Path]
			if !hasSnap {
				// 锁外 Lstat 即失败（目录不存在/竞态窗口中消失）——拒绝搬一个
				// 从未观察到的对象；改名/删除竞态中重建的同名目录不是快照对象
				if logger != nil {
					logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 跳过: 目标目录快照缺失（已不存在或扫描窗口中被改动）")
				}
				continue
			}
			if ok, reason := verifyDirSnapshot(snap, dstParent); !ok {
				if logger != nil {
					logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 跳过: "+reason)
				}
				continue
			}
			// 原子替换：先把旧目录挪走作备份，InstallDir 重建成功后再清理备份；
			// 失败则回滚恢复，避免目录整体丢失（旧实现先 RemoveAll 后重建，失败即丢）
			// 备份名带时间戳（P2-4）：旧实现固定 ".relink-bak" + 无条件 RemoveAll，
			// 上一次 relink 失败留有的备份目录会被本次删除——恢复点丢失。
			// 时间戳版与 conflict.go 的 .bak-<ts> 口径对齐，避免备份覆盖。
			backup := fmt.Sprintf("%s.relink-bak-%d", dstParent, time.Now().UnixNano())
			if err := os.Rename(dstParent, backup); err != nil {
				if logger != nil {
					logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 备份目录失败: "+err.Error())
				}
				continue
			}
			if err := installer.InstallDirLocked(srcDir, dstBase, filesRoot, linkMode, rtype); err != nil {
				// 回滚：删除半成品，恢复原目录。删除失败仅记日志不吞净——
				// 残留半成品目录提示用户确实需要清理（P2 修复，替代静默 `_ =`）。
				if rmErr := os.RemoveAll(filepath.Join(dstBase, filepath.Base(srcDir))); rmErr != nil && logger != nil {
					logger(ce.Name, ce.Path, dstParent, 0, "failed", "回滚删除半成品失败: "+rmErr.Error())
				}
				// 回滚 rename 失败不再静默吞——原 `_ =` 吞错，
				// 原目录滞留 .relink-bak、实例目录缺失且函数继续执行（静默数据不可达）；
				// 记 logger 供用户排查（不 return——目录已损坏，继续无意义）
				if rbErr := os.Rename(backup, dstParent); rbErr != nil {
					if logger != nil {
						logger(ce.Name, ce.Path, dstParent, 0, "failed",
							"relink 失败且回滚失败，原目录滞留 "+filepath.Base(backup)+": "+rbErr.Error())
					}
				}
				if logger != nil {
					logger(ce.Name, ce.Path, dstParent, 0, "failed", "relink 失败: "+err.Error())
				}
				continue
			}
			removeRelinkBackup(backup, ce, dstParent, logger)
			count++
			continue
		}
		// 传入基础 customDir，让 installer.Install 自行计算相对路径。
		// Install 内部对已存在的旧文件做原子替换（临时链接 + rename），失败不破坏原文件
		if err := installer.InstallLocked(srcPath, customDir, filesRoot, linkMode); err != nil {
			if logger != nil {
				logger(ce.Name, ce.Path, customDir, 0, "failed", "relink 失败: "+err.Error())
			}
			continue
		}
		count++
	}
	return count, nil
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
	cur, err := os.Lstat(dstParent)
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
	if err := os.RemoveAll(backup); err != nil && logger != nil {
		logger(ce.Name, ce.Path, dstParent, 0, "failed", "清理 relink 备份目录失败: "+err.Error())
	}
}
