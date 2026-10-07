// recycle_list.go：回收站列表（原 recycle.go 拆分，2026-10 文件行数治理）。
// List / countEntries / dirSize——回收站条目枚举与体量统计。
package recycle

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func (tm *TrashManager) List() []types.ModelEntry {
	entries := []types.ModelEntry{}
	_ = filepath.WalkDir(tm.recycleDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[recycle] WalkDir 错误 %s: %v", p, err)
			return nil
		}
		if d.IsDir() {
			// 文件夹模型整组：目录含 ysm.json 清单 → 合并为单一条目，跳过目录内部文件
			if _, statErr := os.Stat(filepath.Join(p, "ysm.json")); statErr == nil {
				info, _ := d.Info()
				e := types.ModelEntry{
					Name: filepath.Base(p),
					Path: p,
					Ext:  "",
				}
				if info != nil {
					e.Size = dirSize(p)
				}
				entries = append(entries, e)
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		// 检查是否为禁用后缀（.disabled/.ban）或其他受支持的扩展名
		if !registry.IsDisableSuffix(ext) && !registry.IsSupportedExt(ext) {
			return nil
		}
		info, _ := d.Info()
		e := types.ModelEntry{
			Name: filepath.Base(p),
			Path: p,
			Ext:  ext,
		}
		if info != nil {
			e.Size = info.Size()
		}
		entries = append(entries, e)
		return nil
	})
	return entries
}

// countEntries 与 List() 同过滤口径只计数：文件夹模型整组（含 ysm.json 的目录）算 1、被
// IsDisableSuffix/IsSupportedExt 过滤后的文件条目 =1；不构造 []ModelEntry、不调 dirSize，
// 供 Empty() 清空前拿条目数而不物化全量切片。WalkDir 回调豁免错误继续遍历（与 List 一致）。
func (tm *TrashManager) countEntries() int {
	n := 0
	// 显式丢弃 WalkDir 顶层返回值：它只在「根目录本身不可读」时非 nil，
	// 而本函数仅用于 Empty() 清空前取条目数——根不可读即 0 条，静默豁免即可。
	// 回调内每条错误已走 log.Printf（与 List() 口径一致），不重复上报。
	_ = filepath.WalkDir(tm.recycleDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[recycle] countEntries WalkDir 错误 %s: %v", p, err)
			return nil
		}
		if d.IsDir() {
			if _, statErr := os.Stat(filepath.Join(p, "ysm.json")); statErr == nil {
				n++
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if !registry.IsDisableSuffix(ext) && !registry.IsSupportedExt(ext) {
			return nil
		}
		n++
		return nil
	})
	return n
}

// dirSize 递归统计目录总大小（文件夹模型整组条目显示用）。
// 实现已收敛到 `fsutil.DirSize`（唯一出口）——同一语义不在两处各写一遍。
func dirSize(dir string) int64 {
	total, _ := fsutil.DirSize(dir)
	return total
}

// resolveRestoreDest Restore 前置：越权守卫 + 目标路径计算 + 冲突后缀消解。
// 守卫顺序与迁移前逐条一致：越权/根级守卫 → Rel → Join → IsInside → MkdirAll 父目录
// → 冲突后缀循环。
