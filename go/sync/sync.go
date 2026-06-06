package sync

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// 鎵弿妯″瀷锛堝嚱鏁扮被鍨嬶紝鐢?app.go 娉ㄥ叆锛?
type ScanFunc func(dir string) []types.ModelEntry

// GetInstanceStatus 鑾峰彇鏁村悎鍖呯姸鎬?
func GetInstanceStatus(mcRoot, repoDir string, scanFn ScanFunc) []types.InstanceStatus {
	if mcRoot == "" || repoDir == "" {
		return []types.InstanceStatus{}
	}

	repoEntries := scanFn(repoDir)
	repoByHash := make(map[string]types.ModelEntry)
	for _, e := range repoEntries {
		if e.Hash == "" {
			continue
		}
		// 跳过禁用的模型（.ban），它们不应出现在缺失列表中
		if strings.HasSuffix(strings.ToLower(e.Name), ".ban") {
			continue
		}
		repoByHash[e.Hash] = e
	}

	instances := ListVersions(mcRoot)
	var results []types.InstanceStatus

	for _, ins := range instances {
		customEntries := scanFn(ins.CustomDir)
		customByHash := make(map[string]bool)
		for _, c := range customEntries {
			if c.Hash != "" {
				customByHash[c.Hash] = true
			}
		}

		status := types.InstanceStatus{
			Name:      ins.Name,
			CustomDir: ins.CustomDir,
			Missing:   []string{},
			Extra:     []string{},
			Disabled:  []string{},
			HasYSM:    ysm.HasYSMMod(filepath.Join(ins.VersionDir, "mods")),
		}

				for hash, e := range repoByHash {
					if !customByHash[hash] {
						// Missing 存完整路径，供安装时直接使用
						status.Missing = append(status.Missing, e.Path)
					}
				}
		// 预构建禁用哈希集合
		bannedHashes := make(map[string]bool)
		for _, re := range repoEntries {
			if strings.HasSuffix(strings.ToLower(re.Name), ".ban") && re.Hash != "" {
				bannedHashes[re.Hash] = true
			}
		}

		for _, c := range customEntries {
			if c.Hash == "" {
				continue
			}
			if bannedHashes[c.Hash] {
				// 仓库已禁用此模型 → 标记为已禁用，不入额外
				name := c.Name
				if strings.HasSuffix(strings.ToLower(name), ".ban") {
					name = name[:len(name)-4]
				}
				status.Disabled = append(status.Disabled, name)
			} else if _, found := repoByHash[c.Hash]; !found {
				// 仓库中没有此哈希 → 额外
				name := c.Name
				if strings.HasSuffix(strings.ToLower(name), ".ban") {
					name = name[:len(name)-4]
				}
				status.Extra = append(status.Extra, name)
			}
		}

				// 收集 custom 目录下每个文件的链接类型
		for _, c := range customEntries {
			linkType := getLinkType(c.Path)
			fileName := c.Name
			// 去掉 .ban 后缀，方便前端匹配
			if strings.HasSuffix(strings.ToLower(fileName), ".ban") {
				fileName = fileName[:len(fileName)-4]
			}
			status.Files = append(status.Files, types.CustomFileInfo{
				Name:     fileName,
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

// SyncToggleStatus 同步启用/禁用状态
func SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error) {
	repoEntries := scanFn(repoRoot)
	repoHash := make(map[string]bool) // hash → banned
	repoName := make(map[string]bool) // relPath(去.ban) → banned，用于同名不同文件夹的文件
	repoRootClean := strings.ToLower(filepath.Clean(repoRoot)) + string(filepath.Separator)
	for _, e := range repoEntries {
		banned := strings.HasSuffix(strings.ToLower(e.Name), ".ban")
		// 用路径前缀限定：relPath 带至少一级父文件夹，避免跨文件夹撞名
		ePath := strings.ToLower(e.Path)
		if strings.HasPrefix(ePath, repoRootClean) {
			rel := strings.TrimPrefix(ePath, repoRootClean)
			rel = strings.TrimSuffix(rel, ".ban")
			repoName[rel] = banned
		} else {
			// fallback：纯文件名（顶层文件）
			baseName := strings.TrimSuffix(strings.ToLower(e.Name), ".ban")
			repoName[baseName] = banned
		}
		if e.Hash != "" {
			repoHash[e.Hash] = banned
		}
	}
	if len(repoHash) == 0 && len(repoName) == 0 {
		return 0, 0, fmt.Errorf("仓库中未找到模型文件")
	}

	disableCount := 0
	enableCount := 0
	customDirClean := strings.ToLower(filepath.Clean(instanceCustomDir)) + string(filepath.Separator)
	filepath.WalkDir(instanceCustomDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if strings.Contains(strings.ToLower(p), ".recycle") {
			return nil
		}
		actualPath := p
		isCurrentlyBanned := strings.HasSuffix(strings.ToLower(p), ".ban")
		if isCurrentlyBanned {
			actualPath = p[:len(p)-4]
		}
		ext := strings.ToLower(filepath.Ext(actualPath))
		if ext != ".ysm" && ext != ".zip" && ext != ".7z" {
			return nil
		}

		// 先试哈希匹配，再用多级路径匹配，最后 fallback 到纯文件名
		var shouldBeBanned bool
		var matched bool
		hash := computeHash(p)
		if hash != "" {
			shouldBeBanned, matched = repoHash[hash]
		}
		if !matched {
			// 用 relative path 匹配（带文件夹限定）
			pLower := strings.ToLower(p)
			if strings.HasPrefix(pLower, customDirClean) {
				rel := strings.TrimPrefix(pLower, customDirClean)
				rel = strings.TrimSuffix(rel, ".ban")
				shouldBeBanned, matched = repoName[rel]
			}
		}
		if !matched {
			// fallback：纯文件名（旧仓库或同名不同路径的特例）
			baseName := strings.ToLower(filepath.Base(actualPath))
			shouldBeBanned, matched = repoName[baseName]
		}
		if !matched {
			return nil
		}

		if shouldBeBanned && !isCurrentlyBanned {
			newPath := p + ".ban"
			if _, err := os.Stat(newPath); err == nil {
				return nil
			}
			if err := os.Rename(p, newPath); err == nil {
				disableCount++
			} else if isFileLocked(err) {
				// 文件被其他进程锁定（如 Minecraft），跳过
			} else {
				// 其他错误也跳过，不阻塞
			}
		} else if !shouldBeBanned && isCurrentlyBanned {
			newPath := p[:len(p)-4]
			if err := os.Rename(p, newPath); err == nil {
				enableCount++
			} else if isFileLocked(err) {
				// 文件被其他进程锁定（如 Minecraft），跳过
			}
		}
		return nil
	})
	return disableCount, enableCount, nil
}

func ListVersions(mcRoot string) []types.VersionInstance {
	versionsDir := filepath.Join(mcRoot, "versions")
	ents, err := os.ReadDir(versionsDir)
	if err != nil {
		return []types.VersionInstance{}
	}
	out := []types.VersionInstance{}
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		verDir := filepath.Join(versionsDir, name)
		custom := filepath.Join(verDir, "config", "yes_steve_model", "custom")
		exists := true
		if _, st := os.Stat(custom); os.IsNotExist(st) {
			exists = false
		}
		out = append(out, types.VersionInstance{
			Name:       name,
			VersionDir: verDir,
			CustomDir:  custom,
			Exists:     exists,
		})
	}
	return out
}

func computeHash(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	io.Copy(h, f)
	return fmt.Sprintf("%x", h.Sum(nil))
}

// SortEntries 鎸夊悕绉版帓搴忔ā鍨嬫潯鐩?
func SortEntries(entries []types.ModelEntry) {
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})
}

// getLinkType 判断文件的链接类型
func getLinkType(path string) types.LinkType {
	info, err := os.Lstat(path)
	if err != nil {
		return types.LinkUnknown
	}
	// 符号链接
	if info.Mode()&os.ModeSymlink != 0 {
		return types.LinkSym
	}
	// 在 Windows 上判断硬链接：通过 syscall.GetFileInformationByHandle 获取 nlink
	// 如果 nlink > 1，说明是硬链接
	return checkHardLink(path)
}

// isFileLocked 判断错误是否因为文件被其他进程锁定
func isFileLocked(err error) bool {
	if err == nil {
		return false
	}
	// Windows 共享违例 (ERROR_SHARING_VIOLATION)
	// 或权限拒绝 (ERROR_ACCESS_DENIED) — 文件被打开时常见
	if linkErr, ok := err.(*os.LinkError); ok {
		if linkErr.Err != nil {
			msg := strings.ToLower(linkErr.Err.Error())
			if strings.Contains(msg, "sharing") ||
				strings.Contains(msg, "access") ||
				strings.Contains(msg, "used by another process") {
				return true
			}
		}
	}
	return false
}
