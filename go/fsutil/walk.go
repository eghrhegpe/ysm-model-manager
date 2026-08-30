// Package fsutil 提供目录遍历工具函数，集中管理 WalkDir 逻辑
package fsutil

import (
	"log"
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
			log.Printf("[fsutil] WalkDir 访问 %s 失败: %v", p, err)
			return nil
		}
		if d.IsDir() {
			if skipRecycle && IsRecycleDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		result = append(result, p)
		return nil
	})
	return result
}

// WalkAllDirs 递归遍历目录，返回所有子目录路径（深度优先后序：子目录在前，父目录在后）
// 不包含根目录本身。后序便于删除类操作（先删深目录，父目录变空后可被继续删除）。
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
		// 与 WalkAllFiles 对齐，ReadDir 失败打日志——
		// 原实现完全静默 return，不可读子目录及其整棵子树从结果中消失且调用方无感知
		log.Printf("[fsutil] ReadDir 访问 %s 失败: %v", dir, err)
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(dir, e.Name())
		if skipRecycle && IsRecycleDir(sub) {
			continue
		}
		walkAllDirs(sub, skipRecycle, out)
		*out = append(*out, sub)
	}
}

// CountFiles 统计目录中的文件数（不限制扩展名）
// 流式计数：不构造完整 []string，避免大目录下为取 len 白白物化整棵文件树
// （遍历语义与 WalkAllFiles 完全一致：不跟随子目录符号链接、skipRecycle 同口径）。
func CountFiles(dir string, skipRecycle bool) int {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return 0
	}
	count := 0
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[fsutil] WalkDir 访问 %s 失败: %v", p, err)
			return nil
		}
		if d.IsDir() {
			if skipRecycle && IsRecycleDir(p) {
				return filepath.SkipDir
			}
			return nil
		}
		count++
		return nil
	})
	return count
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

// IsRecycleDir 判断路径是否指向 .recycle 回收站目录（大小写不敏感，ADR-044 策略 A 统一口径）——
// dedup / scanner / sync 的回收站排除判定统一引用本函数，禁止各自内联 EqualFold 判定。
// 例外：sync.go 的 SyncToggleStatus 对「路径任一段为 .recycle」跳过（覆盖 .recycle
// 子树内已遍历文件），语义与基名精确匹配不同，属有意保留的兜底（code_review）。
// 原为整路径子串 Contains，会误伤文件名含 ".recycle" 的正常模型，已改为逐段判定
// （sync.hasRecycleSegment）。
func IsRecycleDir(path string) bool {
	lower := strings.ToLower(path)
	base := filepath.Base(lower)
	return base == ".recycle"
}

// IsResourcePackFolder 检查目录是否为资源包文件夹（内含 pack.mcmeta）。
// 收敛自 instance.go / sync.go 各自实现的同名函数（双包逐字重复）。
func IsResourcePackFolder(path string) bool {
	_, err := os.Stat(filepath.Join(path, "pack.mcmeta"))
	return err == nil
}
