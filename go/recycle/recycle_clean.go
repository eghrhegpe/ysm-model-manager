// ===== 清空/去重（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 clearInstanceDir / DeduplicateCustomDir 提取；
// recycleRoot（回收站根）/ logger 由薄壳注入。
package recycle

import (
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// CleanLogger 清理操作日志回调（薄壳注入 App.logger.Add）
type CleanLogger func(name, src, dst string, size int64, status, msg string)

// CleanInstanceDir 清理整合包子目录中仓库已有的文件：
// 在 recycleRoot 内的移入回收站（可恢复），否则直接删除（仓库侧无损可重推）
func CleanInstanceDir(dir, repoRoot, recycleRoot string) int {
	targets := fsutil.WalkAllFiles(dir, true)
	if repoRoot == "" {
		// 没有仓库根目录时不做处理
		return 0
	}
	// 预加载仓库文件列表（仅文件名，用于判断是否在仓库中）
	repoFiles := make(map[string]bool)
	for _, p := range fsutil.WalkAllFiles(repoRoot, true) {
		repoFiles[strings.ToLower(filepath.Base(p))] = true
	}
	count := 0
	for _, p := range targets {
		name := strings.ToLower(filepath.Base(p))
		if !repoFiles[name] {
			// 仓库没有此文件，跳过（整合包自带资源）
			continue
		}
		if recycleRoot != "" && paths.IsInside(recycleRoot, p) == nil {
			// 实例文件在仓库根内 → 移回收站（可恢复）
			if err := Move(p, recycleRoot); err != nil {
				continue
			}
		} else {
			// 实例文件不在仓库根内（常见情况：整合包在 mcRoot 下）→ 直接删
			if err := os.Remove(p); err != nil {
				continue
			}
		}
		count++
	}
	// 清理空目录
	fsutil.CleanEmptyDirs(dir, true)
	return count
}

// DeduplicateEntries 按 SHA256 哈希分组去重：保留每组第一个，其余移入回收站
func DeduplicateEntries(entries []types.ModelEntry, recycleRoot string, logger CleanLogger) (removed, kept int) {
	hashGroups := make(map[string][]types.ModelEntry)
	for _, e := range entries {
		if e.Hash == "" {
			continue
		}
		hashGroups[e.Hash] = append(hashGroups[e.Hash], e)
	}
	for _, group := range hashGroups {
		if len(group) <= 1 {
			continue
		}
		// 保留第一个，其余移入回收站
		for _, e := range group[1:] {
			if err := Move(e.Path, recycleRoot); err != nil {
				if logger != nil {
					logger(e.Name, e.Path, recycleRoot, 0, "failed", "回收站移动失败: "+err.Error())
				}
				continue
			}
			removed++
		}
		kept++
	}
	return removed, kept
}
