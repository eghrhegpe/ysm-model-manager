// Package fsutil 提供目录遍历工具函数，集中管理 WalkDir 逻辑
package fsutil

import (
	"os"
	"path/filepath"
	"strings"
)

// WalkAllFiles 递归遍历目录返回所有文件的完整路径（不限制扩展名）
// skipRecycle 为 true 时跳过 .recycle 子目录
func WalkAllFiles(dir string, skipRecycle bool) []string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil
	}
	var result []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if skipRecycle && isRecycleDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		result = append(result, p)
		return nil
	})
	return result
}

// WalkAllDirs 递归遍历目录，返回所有子目录路径（广度优先，后序遍历用）
// 不包含根目录本身，按深度优先顺序（后序：子目录在前，父目录在后）
func WalkAllDirs(dir string, skipRecycle bool) []string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil
	}
	var result []string
	walkAllDirs(dir, skipRecycle, &result)
	return result
}

func walkAllDirs(dir string, skipRecycle bool, out *[]string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(dir, e.Name())
		if skipRecycle && isRecycleDir(sub) {
			continue
		}
		walkAllDirs(sub, skipRecycle, out)
		*out = append(*out, sub)
	}
}

// CountFiles 统计目录中的文件数（不限制扩展名）
func CountFiles(dir string, skipRecycle bool) int {
	return len(WalkAllFiles(dir, skipRecycle))
}

// CleanEmptyDirs 递归删除空子目录，返回删除数
func CleanEmptyDirs(dir string, skipRecycle bool) int {
	dirs := WalkAllDirs(dir, skipRecycle)
	// dirs 已经是后序（最深在前），直接遍历——删除深目录后父目录变空可被后续删除
	count := 0
	for _, d := range dirs {
		if err := os.Remove(d); err == nil {
			count++
		}
	}
	return count
}

func isRecycleDir(path string) bool {
	lower := strings.ToLower(path)
	base := filepath.Base(lower)
	return base == ".recycle"
}
