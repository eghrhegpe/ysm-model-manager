package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/installer"
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
			conflict := FileConflict{
				Path:              path,
				Type:              ConflictContentModified,
				LocalModTime:      localInfo.ModTime,
				RemoteModTime:     remoteInfo.ModTime,
				LocalSize:         localInfo.Size,
				RemoteSize:        remoteInfo.Size,
				LocalHash:         localInfo.Hash,
				RemoteHash:        remoteInfo.Hash,
				SuggestedStrategy: suggestStrategy(localInfo.ModTime, remoteInfo.ModTime),
			}
			conflicts = append(conflicts, conflict)
		} else if localInfo.Size != remoteInfo.Size {
			// 大小不匹配但哈希可能一致（极端情况），标记为 size_mismatch 供参考
			// 注：哈希一致但大小不同在理论上不可能，此分支为防御性分支
			conflict := FileConflict{
				Path:              path,
				Type:              ConflictSizeMismatch,
				LocalModTime:      localInfo.ModTime,
				RemoteModTime:     remoteInfo.ModTime,
				LocalSize:         localInfo.Size,
				RemoteSize:        remoteInfo.Size,
				LocalHash:         localInfo.Hash,
				RemoteHash:        remoteInfo.Hash,
				SuggestedStrategy: suggestStrategy(localInfo.ModTime, remoteInfo.ModTime),
			}
			conflicts = append(conflicts, conflict)
		}
	}

	report := &ConflictReport{
		Conflicts:      conflicts,
		TotalConflicts: len(conflicts),
	}

	return report, nil
}

// ResolveConflict 解决单个文件冲突
// 先备份再操作，确保安全
func ResolveConflict(conflict FileConflict, strategy ResolutionStrategy, localDir, remoteDir string) error {
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
			// 恢复备份
			_ = fsutil.CopyFile(backupPath, localPath)
			_ = os.Remove(backupPath)
			return fmt.Errorf("拷贝远端文件失败: %w", err)
		}
		_ = os.Remove(backupPath)
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
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	return ResolveConflictsLocked(conflicts, defaultStrategy, localDir, remoteDir)
}

// ResolveConflictsLocked 与 ResolveConflicts 语义相同，但调用方须已持有 installer.InstallLock
// （禁止重入加锁——sync.Mutex 不可重入，外层已持锁时再 Lock 会 self-deadlock）。
// 派生的调用方：SyncResourcesWithConfig 的冲突自动解决分支（该函数可能经
// PushResources/PullResources → SyncResources 在 InstallLock 临界区内运行）。
// ResolveConflict 自身不加锁，供本函数在持锁前提下调用。
func ResolveConflictsLocked(conflicts []FileConflict, defaultStrategy ResolutionStrategy, localDir, remoteDir string) (resolved, failed, manual int) {
	defer InvalidateSyncScanCaches() // 冲突解决会改实例/全局目录，清同步扫盘缓存防陈旧
	for _, c := range conflicts {
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

// collectFileEntries 收集目录下的所有文件信息
func collectFileEntries(dir string) (map[string]fileEntryInfo, error) {
	entries := make(map[string]fileEntryInfo)
	var walkErr error

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil, fmt.Errorf("目录不存在: %s", dir)
	}

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// 收集访问错误但继续遍历其他文件（部分文件权限问题不影响整体扫描）
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

		hash, hashErr := computeFileHash(path)
		if hashErr != nil {
			// 哈希失败但仍记录条目（无 hash），不中断流程
			walkErr = hashErr
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

// computeFileHash 计算文件 SHA256 哈希
func computeFileHash(path string) (string, error) {
	hash, err := fsutil.SHA256File(path)
	if err != nil {
		return "", err
	}
	return hash, nil
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
