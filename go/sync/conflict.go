package sync

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/paths"
)

// ConflictType 冲突类型
type ConflictType string

const (
	// ConflictContentModified 内容冲突：本地和远端文件内容都被修改（hash 不同）
	ConflictContentModified ConflictType = "content_modified"
	// ConflictSizeMismatch 大小不匹配：路径存在但文件大小不同（快速检测，可能后续 hash 验证为同一内容）
	ConflictSizeMismatch ConflictType = "size_mismatch"
)

// ResolutionStrategy 冲突解决策略
type ResolutionStrategy string

const (
	// ResolveForceRemote 强制使用远端版本
	ResolveForceRemote ResolutionStrategy = "force_remote"
	// ResolveForceLocal 强制保留本地版本
	ResolveForceLocal ResolutionStrategy = "force_local"
	// ResolveManual 手动解决（由调用方决定）
	ResolveManual ResolutionStrategy = "manual"
)

// FileConflict 文件冲突详情
type FileConflict struct {
	// Path 冲突文件的相对路径
	Path string `json:"path"`
	// Type 冲突类型
	Type ConflictType `json:"type"`
	// LocalModTime 本地文件修改时间
	LocalModTime time.Time `json:"localModTime"`
	// RemoteModTime 远端文件修改时间
	RemoteModTime time.Time `json:"remoteModTime"`
	// LocalSize 本地文件大小
	LocalSize int64 `json:"localSize"`
	// RemoteSize 远端文件大小
	RemoteSize int64 `json:"remoteSize"`
	// LocalHash 本地文件哈希
	LocalHash string `json:"localHash,omitempty"`
	// RemoteHash 远端文件哈希
	RemoteHash string `json:"remoteHash,omitempty"`
	// SuggestedStrategy 建议的解决策略
	SuggestedStrategy ResolutionStrategy `json:"suggestedStrategy"`
	// HashFailed 标记哈希计算失败的条目。
	// 此类条目本应人工审查，ResolveConflictsLocked 检测到 HashFailed 时
	// 不覆盖 SuggestedStrategy，直接计入 manual 计数。
	HashFailed bool `json:"hashFailed,omitempty"`
}

// ConflictReport 冲突报告
type ConflictReport struct {
	// Conflicts 冲突文件列表
	Conflicts []FileConflict `json:"conflicts"`
	// TotalConflicts 总冲突数
	TotalConflicts int `json:"totalConflicts"`
}

// DetectConflicts 检测本地和远端之间的冲突
// 基于文件哈希比较：两端都存在且哈希不同 → 内容冲突
// localDir: 本地目录路径（整合包）
// remoteDir: 远端目录路径（全局/主仓库）
// rtype: 资源类型 ID
func DetectConflicts(localDir, remoteDir, rtype string) (*ConflictReport, error) {
	localFiles, err := collectFileEntries(localDir)
	if err != nil {
		return nil, fmt.Errorf("收集本地文件失败: %w", err)
	}

	remoteFiles, err := collectFileEntries(remoteDir)
	if err != nil {
		return nil, fmt.Errorf("收集远端文件失败: %w", err)
	}

	var conflicts []FileConflict

	// 遍历本地文件，检查是否与远端冲突
	for path, localInfo := range localFiles {
		remoteInfo, exists := remoteFiles[path]
		if !exists {
			continue // 远端不存在，是本地独有文件，不算冲突
		}

		// 内容冲突判定：两端都存在且哈希不同
		if localInfo.Hash != remoteInfo.Hash && localInfo.Hash != "" && remoteInfo.Hash != "" {
			conflict := newConflict(path, localInfo, remoteInfo,
				ConflictContentModified, suggestStrategy(localInfo.ModTime, remoteInfo.ModTime), false)
			conflicts = append(conflicts, conflict)
		} else if localInfo.Size != remoteInfo.Size {
			// 大小不匹配但哈希可能一致（极端情况），标记为 size_mismatch 供参考
			// 注：哈希一致但大小不同在理论上不可能，此分支为防御性分支
			conflict := newConflict(path, localInfo, remoteInfo,
				ConflictSizeMismatch, suggestStrategy(localInfo.ModTime, remoteInfo.ModTime), false)
			conflicts = append(conflicts, conflict)
		} else if localInfo.Size == remoteInfo.Size && (localInfo.Hash == "" || remoteInfo.Hash == "") {
			// 两端 size 相同但任一端 hash 失败：
			// 旧实现在此情况静默跳过（hash 空时 L91 条件不满足），
			// 导致哈希失败的真实冲突文件被漏报。
			// 修复：标记 HashFailed=true + ResolveManual，让 ResolveConflictsLocked
			// 检测到 HashFailed 时不覆盖 SuggestedStrategy，直接计入 manual。
			conflict := newConflict(path, localInfo, remoteInfo,
				ConflictContentModified, ResolveManual, true)
			conflicts = append(conflicts, conflict)
		}
	}

	// 冲突列表按 Path 字典序排序——localFiles 为 map，迭代序由 Go 运行时随机化，
	// 不排序则同一目录每次调用输出顺序不同（前端冲突列表刷新跳动）。
	// 与包内其余 diff 出口（ResourceDiff / syncResourcesDirLevel）的确定性纪律对齐。
	sort.Slice(conflicts, func(i, j int) bool {
		return conflicts[i].Path < conflicts[j].Path
	})

	report := &ConflictReport{
		Conflicts:      conflicts,
		TotalConflicts: len(conflicts),
	}

	return report, nil
}

// ResolveConflict 解决单个文件冲突
// 先备份再操作，确保安全
func ResolveConflict(conflict FileConflict, strategy ResolutionStrategy, localDir, remoteDir string) error {
	// 路径守卫：防 conflict.Path 含 ".." 穿越到 localDir/remoteDir 之外
	//（与 sync_push.go 同款 RelInside 防线对齐）。
	// 此处由调用方 ResolveConflictsLocked 在持锁前提下调用，路径来自前端 JSON 传入，信任面需显式守卫。
	if _, err := paths.RelInside(localDir, filepath.Join(localDir, conflict.Path)); err != nil {
		return fmt.Errorf("冲突路径越界 %q: %w", conflict.Path, err)
	}
	if _, err := paths.RelInside(remoteDir, filepath.Join(remoteDir, conflict.Path)); err != nil {
		return fmt.Errorf("冲突路径越界 %q: %w", conflict.Path, err)
	}
	localPath := filepath.Join(localDir, conflict.Path)
	remotePath := filepath.Join(remoteDir, conflict.Path)

	switch strategy {
	case ResolveForceRemote:
		// 强制使用远端：先备份本地，再用远端覆盖。
		// 拷贝统一走 fsutil.CopyFile（ADR-044 收敛：原子 tmp+rename，
		// 中途失败不留半截目标；权限/步骤错误类型化见 fsutil）。
		// 备份名带时间戳：固定 ".bak" 会在残留旧备份时被静默覆盖（丢失唯一的恢复点）；
		// 时间戳版与 fsutil.CopyDirRecursive 的 .bak-<ts> 口径一致，成功后由下方删除。
		backupPath := fmt.Sprintf("%s.bak-%d", localPath, time.Now().UnixNano())
		if err := fsutil.CopyFile(localPath, backupPath); err != nil {
			return fmt.Errorf("备份本地文件失败: %w", err)
		}
		if err := fsutil.CopyFile(remotePath, localPath); err != nil {
			// 恢复备份。恢复失败时返回带备份路径的复合错误，
			// 让调用方知悉恢复点位置（旧实现 _ 吞掉恢复失败错误）。
			if rerr := fsutil.CopyFile(backupPath, localPath); rerr != nil {
				return fmt.Errorf("拷贝远端文件失败: %w; 恢复备份也失败（备份保留在 %s）: %v", err, backupPath, rerr)
			}
			removeBackup(backupPath)
			return fmt.Errorf("拷贝远端文件失败（已恢复备份）: %w", err)
		}
		removeBackup(backupPath)
		return nil

	case ResolveForceLocal:
		// 强制保留本地：不做任何操作
		return nil

	case ResolveManual:
		// 手动解决：返回错误让上层处理
		return fmt.Errorf("需要手动解决冲突: %s", conflict.Path)

	default:
		return fmt.Errorf("未知的解决策略: %s", strategy)
	}
}

// ResolveConflicts 批量解决冲突（公开入口，整段持 installer.InstallLock）。
func ResolveConflicts(conflicts []FileConflict, defaultStrategy ResolutionStrategy, localDir, remoteDir string) (resolved, failed, manual int) {
	installer.InstallLocker.Lock()
	defer installer.InstallLocker.Unlock()
	return ResolveConflictsLocked(conflicts, defaultStrategy, localDir, remoteDir)
}

// ResolveConflictsLocked 与 ResolveConflicts 语义相同，但调用方须已持有 installer.InstallLock
// （禁止重入加锁——sync.Mutex 不可重入，外层已持锁时再 Lock 会 self-deadlock）。
// 派生的调用方：SyncResourcesWithConfig 的冲突自动解决分支（该函数可能经
// PushResources/PullResources → SyncResources 在 InstallLock 临界区内运行）。
// ResolveConflict 自身不加锁，供本函数在持锁前提下调用。
//
// 锁契约是文档约束，不做运行时断言：
// sync.Mutex 不暴露「是否已持锁」的查询，TryLock 在其他 goroutine 持锁时返回 false
// → 不可靠；且生产环境 panic 不可接受。调用方须自行确保持锁。
// 唯一受控例外：sync.go 的 assertInstallLockHeld 是 fail-fast 守卫——仅在
// config.ConflictPolicy 非空时触发（当前生产调用链恒传 nil config，仅测试注入）。
// 局限：TryLock 无法区分「本 goroutine 持有」与「他人持有」。未持锁违规调用 +
// 他人 goroutine 正持 InstallLock 时，TryLock 返回 false 被误判为「已持锁」而
// 放行——此时 ResolveConflictsLocked 将在无锁状态下执行（并发写目录竞态）。
// 新增非 nil config 调用路径时，必须确保调用方已持有 InstallLock，不可依赖本断言。
func ResolveConflictsLocked(conflicts []FileConflict, defaultStrategy ResolutionStrategy, localDir, remoteDir string) (resolved, failed, manual int) {
	defer InvalidateSyncScanCaches() // 冲突解决会改实例/全局目录，清同步扫盘缓存防陈旧
	for _, c := range conflicts {
		// HashFailed 条目（hash 计算失败）不覆盖 SuggestedStrategy，
		// 直接计入 manual。
		if c.HashFailed {
			manual++
			continue
		}
		strategy := c.SuggestedStrategy
		if strategy == ResolveManual {
			strategy = defaultStrategy
		}

		err := ResolveConflict(c, strategy, localDir, remoteDir)
		if err != nil {
			if strategy == ResolveManual {
				manual++
			} else {
				failed++
			}
		} else {
			resolved++
		}
	}
	return
}

// ===== 辅助函数 =====

// fileEntryInfo 文件条目信息
type fileEntryInfo struct {
	Path    string
	Size    int64
	ModTime time.Time
	Hash    string
}

// newConflict 统一构造 FileConflict 字面量——DetectConflicts 的三个分支
// （内容修改 / 大小不匹配 / 哈希失败）字段布局高度重复，收敛到单点，
// 避免将来新增字段时三分支漂移。
func newConflict(path string, local, remote fileEntryInfo, typ ConflictType, strategy ResolutionStrategy, hashFailed bool) FileConflict {
	return FileConflict{
		Path:              path,
		Type:              typ,
		LocalModTime:      local.ModTime,
		RemoteModTime:     remote.ModTime,
		LocalSize:         local.Size,
		RemoteSize:        remote.Size,
		LocalHash:         local.Hash,
		RemoteHash:        remote.Hash,
		SuggestedStrategy: strategy,
		HashFailed:        hashFailed,
	}
}

// hashFileForEntries 供 collectFileEntries 计算单文件哈希。
// 包级变量作为测试 seam：默认直连 fsutil.SHA256File，测试可注入失败场景——
// Windows/CI 无法可靠构造"文件存在但读失败"的真实文件系统状态
// （chmod 000 对目录不生效、symlink 需开发者模式）。
// 注意：非并发安全，测试注入时不得 t.Parallel()。
var hashFileForEntries = fsutil.SHA256File

// collectFileEntries 收集目录下的所有文件信息。
// 错误通道分离（2026-09-14）：
//   - 返回的 error 仅表示「结构性失败」（root 不存在 / Walk 顶层错误），此时结果不可用。
//   - 单文件哈希失败属条目级错误：仅记录日志，条目保留 Hash=="" 继续返回，
//     DetectConflicts 靠 per-entry Hash=="" 识别并标记 HashFailed=true（人工审查路径）。
//
// 旧实现把 hashErr 混入 walkErr，导致任意一个被占用/超限的文件就让整个冲突检测
// 整体失败，HashFailed 分支永远走不到——注释声明"DetectConflicts 不消费它"但实现
// 消费了，注释与实现背离（2026-09-14 修复）。
func collectFileEntries(dir string) (map[string]fileEntryInfo, error) {
	entries := make(map[string]fileEntryInfo)
	var walkErr error

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil, fmt.Errorf("目录不存在: %s", dir)
	}

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// 子树访问失败：跳过该路径继续遍历（尽力而为的冲突检测）
			return nil
		}
		if info.IsDir() {
			return nil
		}

		relPath, relErr := filepath.Rel(dir, path)
		if relErr != nil {
			walkErr = relErr
			return nil
		}
		relPath = filepath.ToSlash(relPath)

		hash, hashErr := hashFileForEntries(path)
		if hashErr != nil {
			// 条目级错误：不中断流程、不影响整体错误。条目保留 Hash==""，
			// DetectConflicts 据此标记 HashFailed=true 走人工审查（L125-144 分支）。
			log.Printf("[sync] 冲突检测哈希失败 %s: %v", path, hashErr)
		}

		entries[relPath] = fileEntryInfo{
			Path:    relPath,
			Size:    info.Size(),
			ModTime: info.ModTime(),
			Hash:    hash,
		}
		return nil
	})

	if err != nil {
		walkErr = err
	}

	return entries, walkErr
}

// computeFileHash 曾为 fsutil.SHA256File 的无价值薄封装（同名近义双轨），
// 已删除、调用点直连 hashFileForEntries（默认 fsutil.SHA256File）——无大文件上限
// （冲突检测走全量哈希）。哈希失败语义见 collectFileEntries 注释：条目级错误，
// per-entry Hash=="" 触发 DetectConflicts 的 HashFailed 分支，不再上抛整体错误。

// removeBackup 删除冲突解决的备份文件，失败仅记日志不吞净——
// 残留 .bak-<ts> 提示用户确有未清理的恢复点，静默 `_ =` 会让备份在
// 用户模型目录堆积且无人知晓（P2 修复）。
func removeBackup(backupPath string) {
	if err := os.Remove(backupPath); err != nil {
		log.Printf("[sync] 删除备份文件失败 %s: %v", backupPath, err)
	}
}

// suggestStrategy 根据修改时间建议解决策略
func suggestStrategy(localTime, remoteTime time.Time) ResolutionStrategy {
	if remoteTime.After(localTime) {
		return ResolveForceRemote
	}
	if localTime.After(remoteTime) {
		return ResolveForceLocal
	}
	return ResolveManual
}
