// Package dedup 提供文件去重检测——纯函数，不绑定回收站或任何 UI
package dedup

import (
	"crypto/sha256"
	"fmt"
	"io"
	"log"
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
			log.Printf("[dedup] 访问 %s 失败: %v", p, err)
			return nil
		}
		// 跳过符号链接（去重只处理实际文件）
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if d.IsDir() {
			if skipRecycle && filepath.Base(p) == ".recycle" {
				return filepath.SkipDir
			}
			return nil
		}

		// 只处理普通文件
		info, err := d.Info()
		if err != nil || info == nil {
			return nil
		}
		if info.Size() == 0 {
			// 跳过空文件——不同用途的空文件（占位符、空 .animation 等）不是重复文件
			return nil
		}

		// 计算 SHA256
		f, err := os.Open(p)
		if err != nil {
			log.Printf("[dedup] 打开文件失败 %s: %v", p, err)
			return nil
		}
		h := sha256.New()
		if _, err := io.Copy(h, f); err != nil {
			f.Close()
			log.Printf("[dedup] 读取文件失败 %s: %v", p, err)
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
			log.Printf("[dedup] 访问 %s 失败: %v", p, err)
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if d.IsDir() {
			if skipRecycle && filepath.Base(p) == ".recycle" {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil || info == nil {
			return nil
		}
		if info.Size() == 0 {
			// 跳过空文件——不同用途的空文件不是重复文件
			return nil
		}
		f, err := os.Open(p)
		if err != nil {
			log.Printf("[dedup] 打开文件失败 %s: %v", p, err)
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

// CleanEmptyDirs 递归删除指定目录下的所有空子目录。
// 返回删除的空目录数。从最深层开始删除，确保祖父目录也能被清理。
func CleanEmptyDirs(dir string) (int, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return 0, fmt.Errorf("目录为空")
	}
	var removed int
	removeEmptyDirs(dir, &removed)
	return removed, nil
}

// removeEmptyDirs 递归后序遍历删除空目录
func removeEmptyDirs(dir string, removed *int) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		if e.IsDir() {
			subPath := filepath.Join(dir, e.Name())
			removeEmptyDirs(subPath, removed)
		}
	}
	// 再次检查是否为空（子目录可能已被删除）
	if isEmptyDir(dir) {
		if err := os.Remove(dir); err == nil {
			(*removed)++
		}
	}
	return *removed
}

// isEmptyDir 检查目录是否为空（不含任何文件和非空子目录）
func isEmptyDir(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	return len(entries) == 0
}
