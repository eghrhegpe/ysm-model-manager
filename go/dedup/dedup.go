// Package dedup 提供文件去重检测——纯函数，不绑定回收站或任何 UI
package dedup

import (
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FileEntry 文件条目
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
}

// Group 重复文件分组
type Group struct {
	Hash  string      `json:"hash"`  // SHA256
	Size  int64       `json:"size"`  // 单文件大小
	Files []FileEntry `json:"files"` // 文件列表
}

// FindDuplicateFiles 扫描目录，按 SHA256 哈希分组，返回包含重复的分组
// skipRecycle 为 true 时跳过 .recycle 子目录
func FindDuplicateFiles(dir string, skipRecycle bool) ([]Group, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, fmt.Errorf("目录为空")
	}

	hashGroups := make(map[string]*Group)
	// 使用 map 保持插入顺序
	var orderedKeys []string

	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 跳过权限错误等
		}
		if d.IsDir() {
			if skipRecycle {
				low := strings.ToLower(p)
				if strings.HasSuffix(low, "\\.recycle") || strings.HasSuffix(low, "/.recycle") {
					return filepath.SkipDir
				}
			}
			return nil
		}

		// 只处理普通文件
		info, err := d.Info()
		if err != nil || info == nil {
			return nil
		}
		if info.Size() == 0 {
			return nil // 跳过空文件
		}

		// 计算 SHA256
		f, err := os.Open(p)
		if err != nil {
			return nil
		}
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			f.Close()
			return nil
		}
		f.Close()
		hash := fmt.Sprintf("%x", h.Sum(nil))

		if g, ok := hashGroups[hash]; ok {
			g.Files = append(g.Files, FileEntry{
				Name:    filepath.Base(p),
				Path:    p,
				Size:    info.Size(),
				ModTime: info.ModTime().UnixMilli(),
			})
		} else {
			hashGroups[hash] = &Group{
				Hash: hash,
				Size: info.Size(),
				Files: []FileEntry{{
					Name:    filepath.Base(p),
					Path:    p,
					Size:    info.Size(),
					ModTime: info.ModTime().UnixMilli(),
				}},
			}
			orderedKeys = append(orderedKeys, hash)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 只保留有重复的分组，按首次出现顺序
	result := []Group{}
	for _, key := range orderedKeys {
		g := hashGroups[key]
		if len(g.Files) > 1 {
			sort.Slice(g.Files, func(i, j int) bool {
				return g.Files[i].Path < g.Files[j].Path
			})
			result = append(result, *g)
		}
	}
	return result, nil
}

// CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数）
func CountDuplicates(dir string, skipRecycle bool) (groups int, extraFiles int, err error) {
	groups = 0
	extraFiles = 0
	hashCount := make(map[string]int)

	err = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skipRecycle {
				low := strings.ToLower(p)
				if strings.HasSuffix(low, "\\.recycle") || strings.HasSuffix(low, "/.recycle") {
					return filepath.SkipDir
				}
			}
			return nil
		}
		info, err := d.Info()
		if err != nil || info == nil || info.Size() == 0 {
			return nil
		}
		f, err := os.Open(p)
		if err != nil {
			return nil
		}
		h := sha256.New()
		io.Copy(h, f)
		f.Close()
		hash := fmt.Sprintf("%x", h.Sum(nil))
		hashCount[hash]++
		return nil
	})
	if err != nil {
		return 0, 0, err
	}

	for _, count := range hashCount {
		if count > 1 {
			groups++
			extraFiles += count - 1
		}
	}
	return groups, extraFiles, nil
}
