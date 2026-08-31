// ===== 清空/去重（ADR-003 补充下沉）=====
// 从 internal/app/app_install.go 的 clearInstanceDir / DeduplicateCustomDir 提取；
// recycleRoot（回收站根）/ logger 由薄壳注入。
package recycle

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// CleanOpLogger 清理操作日志回调（薄壳注入 App.logger.Add）
type CleanOpLogger func(name, src, dst string, size int64, status, msg string)

// RemoveRepoDuplicates 清理整合包子目录中仓库已有的文件：
// 在 recycleRoot 内的移入回收站（可恢复），否则直接删除（仓库侧无损可重推）。
// logger 可为 nil（nil 时失败仅静默跳过）；非 nil 时移动/删除失败逐条上报
// failed 回调，与 DeduplicateEntries 口径一致——清理数偏少可归因。
func RemoveRepoDuplicates(dir, filesRoot, recycleRoot string, logger CleanOpLogger) int {
	if filesRoot == "" {
		// 没有仓库根目录时不做处理（R24 P4-1：守卫前移，避免空根时白走一遍遍历）
		return 0
	}
	// 防御性守卫（R26 P3-2）：拒绝空 dir 与文件系统根目录，
	// 防止误遍历/误删整个盘符根。dir 由 App 层薄壳注入（整合包实例目录），
	// 允许在 filesRoot 外（如 mcRoot 下），故不加 IsInsideResolved 守卫。
	if dir == "" {
		return 0
	}
	// 拒绝文件系统根目录（R26 P3-2 + code_review P1-1 修正）：
	// Windows 上 filepath.VolumeName("C:\\") 返回 "C:"（无尾随 \），
	// 直接与 cleaned 比较会漏掉盘符根。正确比较：
	// cleaned == "/"（Unix 根）或 cleaned == vol + "\\"（Windows 盘符根）。
	cleaned := filepath.Clean(dir)
	vol := filepath.VolumeName(cleaned)
	sep := string(filepath.Separator)
	isRoot := cleaned == sep || (vol != "" && cleaned == vol+sep)
	if isRoot {
		return 0
	}
	targets := fsutil.WalkAllFiles(dir, true)
	// 预加载仓库文件索引：文件名(小写) → 完整路径列表（同名可能散布多处）
	repoFiles := make(map[string][]string)
	for _, p := range fsutil.WalkAllFiles(filesRoot, true) {
		name := strings.ToLower(filepath.Base(p))
		repoFiles[name] = append(repoFiles[name], p)
	}
	// 候选仓库文件哈希缓存：同一候选被多个实例文件比对时不重复读盘
	candidateHashes := make(map[string]string)
	candidateSizes := make(map[string]int64)
	sizeOf := func(path string) (int64, bool) {
		if s, ok := candidateSizes[path]; ok {
			return s, true
		}
		fi, err := os.Stat(path)
		if err != nil {
			return 0, false
		}
		candidateSizes[path] = fi.Size()
		return fi.Size(), true
	}
	hashOf := func(path string) string {
		if h, ok := candidateHashes[path]; ok {
			return h
		}
		h := scanner.ComputeFileHash(path)
		candidateHashes[path] = h
		return h
	}
	count := 0
	for _, p := range targets {
		candidates, ok := repoFiles[strings.ToLower(filepath.Base(p))]
		if !ok {
			// 仓库没有此文件，跳过（整合包自带资源）
			continue
		}
		// 内容必须与某仓库副本一致才清理——go-installer 卡语义「只删仓库同名副本、
		// 保留整合包用户自装资源」：同名不同内容是自装改版，仅按名匹配会误删。
		// 哈希失败/超限返回空 → 一律保守保留。
		targetSize, ok := sizeOf(p)
		if !ok {
			continue
		}
		targetHash := hashOf(p)
		if targetHash == "" {
			continue
		}
		matched := false
		for _, c := range candidates {
			// 大小预筛：SHA256 相等必同大小，先比大小跳过绝大多数不同候选，免读盘哈希
			cs, ok := sizeOf(c)
			if !ok || cs != targetSize {
				continue
			}
			if h := hashOf(c); h == targetHash {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		if recycleRoot != "" && paths.IsInsideResolved(recycleRoot, p) == nil {
			// 实例文件在仓库根内 → 移回收站（可恢复）
			if err := Move(p, recycleRoot); err != nil {
				if logger != nil {
					logger(filepath.Base(p), p, "", 0, "failed", "移入回收站失败: "+err.Error())
				}
				continue
			}
		} else {
			// 实例文件不在仓库根内（常见情况：整合包在 mcRoot 下）→ 直接删
			if err := os.Remove(p); err != nil {
				if logger != nil {
					logger(filepath.Base(p), p, "", 0, "failed", "直接删除失败: "+err.Error())
				}
				continue
			}
		}
		count++
	}
	// 清理空目录
	fsutil.CleanEmptyDirs(dir, true)
	return count
}

// DeduplicateEntries 按 SHA256 哈希分组去重：每组显式按路径排序保留第一个，其余移入回收站
//
// 返回值语义（R26 P3-1 修复）：
//   - removed：成功移入回收站的条目数
//   - kept：去重成功的组数（每组保留第一个，记 1）
//
// 移动失败时该条目滞留原地、不计 removed；组内有任一移动失败时该组不计 kept
// （去重未完成）。上层可据 removed + kept 与预期组数判断是否需重试。
func DeduplicateEntries(entries []types.ModelEntry, recycleRoot string, logger CleanOpLogger) (removed, kept int) {
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
		// 显式按路径排序——原「保留第一个」依赖调用方传入的
		// 扫描序（WalkDir 遍历序），同一目录在检测侧（dedup.FindDuplicateFiles 用
		// 遍历序）与执行侧（ScanModelEntries 序）保留的文件可能不一致，去重结论
		// 跨路径不稳定。按 Path 字典序排序后保留 Files[0]，确定性（与 dedup 检测侧
		// 分组 Files 口径对齐——检测侧同样按遍历序，但执行侧不再依赖隐式顺序）。
		sort.Slice(group, func(i, j int) bool {
			return group[i].Path < group[j].Path
		})
		groupFailed := false
		for _, e := range group[1:] {
			if err := Move(e.Path, recycleRoot); err != nil {
				if logger != nil {
					logger(e.Name, e.Path, recycleRoot, 0, "failed", "回收站移动失败: "+err.Error())
				}
				groupFailed = true
				continue
			}
			removed++
		}
		// 组内 Move 全成功时才计 kept（去重完成，保留了一个）；
		// 有失败时该组去重未完成，不计 kept（R26 P3-1：旧实现无条件 kept++，
		// 把移动失败滞留的文件也计为保留，上层无法区分「无重复」与「移动全失败」）。
		if !groupFailed {
			kept++
		}
	}
	return removed, kept
}
