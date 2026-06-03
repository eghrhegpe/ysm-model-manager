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
	"syscall"
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
		if e.Hash != "" {
			repoByHash[e.Hash] = e
		}
	}

	instances := listVersions(mcRoot)
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
				status.Missing = append(status.Missing, e.Name)
			}
		}
		for _, c := range customEntries {
			if c.Hash != "" {
				if _, found := repoByHash[c.Hash]; !found {
					status.Extra = append(status.Extra, c.Name)
				}
			}
		}
		for _, c := range customEntries {
			if c.Hash == "" {
				continue
			}
			for _, re := range repoEntries {
				if re.Hash == c.Hash && strings.HasSuffix(strings.ToLower(re.Name), ".ban") {
					name := c.Name
					if strings.HasSuffix(strings.ToLower(name), ".ban") {
						name = name[:len(name)-4]
					}
					status.Disabled = append(status.Disabled, name)
					break
				}
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

// SyncToggleStatus 鍚屾鍚敤/绂佺敤鐘舵€?
func SyncToggleStatus(instanceCustomDir, repoRoot string, scanFn ScanFunc) (int, int, error) {
	repoEntries := scanFn(repoRoot)
	repoStatus := make(map[string]bool)
	for _, e := range repoEntries {
		banned := strings.HasSuffix(strings.ToLower(e.Name), ".ban")
		hash := computeHash(e.Path)
		if hash != "" {
			repoStatus[hash] = banned
		}
	}
	if len(repoStatus) == 0 {
		return 0, 0, nil
	}

	disableCount := 0
	enableCount := 0
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
		hash := computeHash(p)
		if hash == "" {
			return nil
		}
		shouldBeBanned, exists := repoStatus[hash]
		if !exists {
			return nil
		}
		if shouldBeBanned && !isCurrentlyBanned {
			newPath := p + ".ban"
			if _, err := os.Stat(newPath); err == nil {
				return nil
			}
			if err := os.Rename(p, newPath); err == nil {
				disableCount++
			}
		} else if !shouldBeBanned && isCurrentlyBanned {
			newPath := p[:len(p)-4]
			if err := os.Rename(p, newPath); err == nil {
				enableCount++
			}
		}
		return nil
	})
	return disableCount, enableCount, nil
}

func listVersions(mcRoot string) []types.VersionInstance {
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

// checkHardLink 检查文件是否为硬链接（Windows 上通过 nlink 判断）
func checkHardLink(path string) types.LinkType {
	// Windows 上通过 CreateFile + GetFileInformationByHandle 获取文件信息
	// 使用 golang.org/x/sys/windows 或 syscall
	pathp, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return types.LinkCopy
	}
	handle, err := syscall.CreateFile(pathp,
		syscall.GENERIC_READ,
		syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE,
		nil,
		syscall.OPEN_EXISTING,
		syscall.FILE_ATTRIBUTE_NORMAL,
		0)
	if err != nil {
		return types.LinkCopy
	}
	defer syscall.CloseHandle(handle)

	var info syscall.ByHandleFileInformation
	err = syscall.GetFileInformationByHandle(handle, &info)
	if err != nil {
		return types.LinkCopy
	}

	// nlink > 1 表示有多个硬链接
	if info.NumberOfLinks > 1 {
		return types.LinkHard
	}
	return types.LinkCopy
}



