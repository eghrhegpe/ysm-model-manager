// recycle_restore.go：回收站还原与清空（原 recycle.go 拆分，2026-10 文件行数治理）。
// Restore / restoreSymlinkEntry / copyBackThenRemove / resolveRestoreDest / Delete / Empty——
// 目录级还原、符号链接回拷、单条删除、整站清空。
package recycle

import (
	"fmt"
	"log"
	"os"
	"path/filepath"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
)

func (tm *TrashManager) resolveRestoreDest(src string) (string, error) {
	// IsInside 对 path==baseDir 放行——src==recycleDir 时
	// rel=="."、dst==rootDir，整个回收站会被 rename 成 rootDir 的兄弟目录
	// （rootDir(1)），回收站被整体搬走；显式拒绝 src 等于回收站本身
	if paths.IsInsideResolved(tm.recycleDir, src) != nil || filepath.Clean(src) == filepath.Clean(tm.recycleDir) {
		return "", fmt.Errorf("路径越权: %s 不在回收站目录下", src)
	}
	rootDir := filepath.Dir(tm.recycleDir)
	rel, err := filepath.Rel(tm.recycleDir, src)
	if err != nil {
		return "", err
	}
	dst := filepath.Join(rootDir, rel)
	if err := paths.IsInside(rootDir, dst); err != nil {
		return "", err
	}
	dstDir := filepath.Dir(dst)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return "", err
	}
	// 冲突后缀循环（与 moveEx 共用 generateConflictFreeDest）；guard 保持越权校验
	return generateConflictFreeDest(dst, func(candidate string) error {
		return paths.IsInside(rootDir, candidate)
	})
}

// restoreSymlinkEntry 恢复符号链接条目本身（不跟随读取目标内容，与 moveEx 的 Lstat 语义对齐）。
// moveEx 对符号链接直接删除不入回收站，但若回收站已有历史符号链接条目（手动放入/旧版本遗留），
// Restore 需正确处理：读取链接目标 → 重建链接 → 删除回收站侧旧链接。
// 返回 handled=true 表示 src 是符号链接、本函数已接管，err 即终态（成功为 nil）。
func restoreSymlinkEntry(src, dst string) (handled bool, err error) {
	info, statErr := os.Lstat(src)
	if statErr != nil || info.Mode()&os.ModeSymlink == 0 {
		return false, nil
	}
	target, readErr := os.Readlink(src)
	if readErr != nil {
		return true, fmt.Errorf("读取符号链接目标失败 %s: %w", src, readErr)
	}
	// 删除回收站侧旧链接（unlink，不影响链接目标）
	if removeErr := os.Remove(src); removeErr != nil {
		return true, fmt.Errorf("删除回收站符号链接失败 %s: %w", src, removeErr)
	}
	// 在原位置重建符号链接
	if linkErr := os.Symlink(target, dst); linkErr != nil {
		// 回滚：恢复回收站侧链接。回滚失败时 log 并在错误中追加信息，
		// 让调用方知道回收站侧链接已永久丢失（旧实现 _ 静默吞掉）。
		if rbErr := os.Symlink(target, src); rbErr != nil {
			log.Printf("[recycle] 回收站侧链接回滚失败 %s: %v（回收站条目已丢失）", src, rbErr)
			return true, fmt.Errorf("恢复符号链接失败 %s -> %s: %w; 回收站侧链接回滚失败: %v", dst, target, linkErr, rbErr)
		}
		return true, fmt.Errorf("恢复符号链接失败 %s -> %s: %w（已回滚回收站侧链接）", dst, target, linkErr)
	}
	return true, nil
}

// copyBackThenRemove 跨设备（EXDEV）恢复回退：复制回原位置 + 删除回收站条目。
// 与 copyThenRemove 对称（目录递归 / 文件单拷 + 半截清理 + 源删失败回滚），
// 同样共用 moveEx 的 copyDirForMove/copyFileForMove 注入点——EXDEV 在单机不可稳定复现。
func (tm *TrashManager) copyBackThenRemove(src, dst string) error {
	// 目录（整组合并条目）跨设备：递归复制整棵树；文件走 copyFile
	if info, statErr := os.Lstat(src); statErr == nil && info.IsDir() {
		if err := tm.copyDirForMove(src, dst); err != nil {
			logHalfCleanup(dst, "Restore", true) // 清理失败记录日志，与 moveEx 的清理分支对齐（原 _ 静默）
			return err
		}
		if err := os.RemoveAll(src); err != nil {
			// 源删除失败：清理已落地的 dst 副本，恢复可重试状态（P3 修复，与 moveEx 对称）
			return tm.rollbackAfterSourceRemoveFail(src, dst, err, true)
		}
		return nil
	}
	if err := tm.copyFileForMove(src, dst); err != nil {
		logHalfCleanup(dst, "Restore", false) // 复制中断/失败时清理半截恢复文件，避免目标目录残留损坏文件（原 _ 静默）
		return err
	}
	if err := os.Remove(src); err != nil {
		// 源删除失败：清理已落地的 dst 副本（P3 修复，与 moveEx 对称）
		return tm.rollbackAfterSourceRemoveFail(src, dst, err, false)
	}
	return nil
}

// Restore 从回收站恢复到原目录。
// 路径：落点计算（resolveRestoreDest）→ 符号链接条目专路（restoreSymlinkEntry）
// → 同卷 rename → 跨设备复制后删（copyBackThenRemove）。
func (tm *TrashManager) Restore(src string) error {
	dst, err := tm.resolveRestoreDest(src)
	if err != nil {
		return err
	}
	// 符号链接处理：恢复链接本身而非跟随读取目标内容（与 moveEx 的 Lstat 语义对齐）。
	// moveEx 对符号链接直接删除不入回收站，但若回收站已有历史符号链接条目（手动放入/旧版本遗留），
	// Restore 需正确处理：读取链接目标 → 重建链接 → 删除回收站侧旧链接。
	if handled, symlinkErr := restoreSymlinkEntry(src, dst); handled || symlinkErr != nil {
		return symlinkErr
	}
	// 优先瞬时移动（同分区原子操作）；跨设备时回退复制后删，语义不变
	// 与 moveEx 共用 renameForMove/copyDirForMove/copyFileForMove 注入点，
	// 跨设备回退分支可被单测确定性覆盖（EXDEV 在单机不可稳定复现）
	renameErr := tm.renameForMove(src, dst)
	if renameErr == nil {
		return nil
	}
	if !fsutil.IsCrossDeviceErr(renameErr) {
		return renameErr // 权限/占用等非跨设备错误直接返回，不尝试复制
	}
	return tm.copyBackThenRemove(src, dst)
}

// logHalfCleanup 复制/移动中断时清理半截目标并记录日志（避免回收站残留损坏数据）。
// prefix 为调用方标识（如 "Restore"），空串表示 Move 分支；isDir 决定用 RemoveAll 还是 Remove。
// 文案与 moveEx / Restore 原分支逐字一致，仅收敛重复（索引 6.8b 清理块去重）。
func logHalfCleanup(dst, prefix string, isDir bool) {
	var rerr error
	if isDir {
		rerr = os.RemoveAll(dst)
	} else {
		rerr = os.Remove(dst)
	}
	if rerr != nil {
		tag := "清理半截目录失败"
		if !isDir {
			tag = "清理半截文件失败"
		}
		if prefix != "" {
			log.Printf("[recycle] %s %s %s: %v", prefix, tag, dst, rerr)
		} else {
			log.Printf("[recycle] %s %s: %v", tag, dst, rerr)
		}
	}
}

// copyDirRecursive 递归复制目录树（跨设备 Restore 整组合并条目的 fallback）
// 已收敛至 fsutil.CopyDirRecursive（ADR-044 策略 A）：保留 symlink 链接本身、覆盖允许。
// 此处为测试注入点（copyDirForMove），生产路径由 New 初始化。
func copyDirRecursive(src, dst string) error {
	return fsutil.CopyDirRecursive(src, dst, fsutil.CopyDirOptions{
		RejectSymlink: false, // 保留符号链接语义（复制链接本身，不跟随）
		Overwrite:     true,  // 恢复场景允许覆盖已存在目标
		Rollback:      false, // 失败残留由调用方清理（Restore 有独立回滚语义）
	})
}

// Delete 永久删除回收站中的文件
// ADR-038 D3.4：整组合并条目 Path 指向目录，os.Remove 无法删非空目录 → 目录用 RemoveAll
func (tm *TrashManager) Delete(src string) error {
	if err := paths.IsInsideResolved(tm.recycleDir, src); err != nil {
		return err
	}
	// 对齐 Move/Restore 的根级守卫：IsInside 对 path==baseDir 放行（rel=="."）
	if filepath.Clean(src) == filepath.Clean(tm.recycleDir) {
		return fmt.Errorf("路径越权: 不能删除回收站根目录")
	}
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return os.RemoveAll(src)
	}
	return os.Remove(src)
}

// Empty 清空回收站
// 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理
//
// 守卫：RemoveAll 是破坏性最强的操作，却唯一未对 recycleDir 做 symlink 检查——
// 若 .recycle 被替换为指向外部的 symlink，os.Stat 会跟随返回外部目录的 stat（非 NotExist），
// os.RemoveAll 会跟随 symlink 删除外部目录树（P2-1）。
// 修复：入口 Lstat(recycleDir)，命中 symlink 一律拒绝——正常 .recycle 是 MkdirAll
// 创建的普通目录，不可能是 symlink；命中即说明被篡改。
// 不用 IsInsideResolved：recycleDir 尚不存在时 EvalSymlinks 失败保留原路径，
// Windows 8.3 短名与长名解析不一致会让 IsInside 误判越权（TestEmpty_RecycleDirNotExist）。
func (tm *TrashManager) Empty() (int, error) {
	if tm.recycleDir == "" {
		return 0, nil
	}
	// Lstat 不跟随 symlink，能识别 .recycle 本身被换 symlink 的篡改场景。
	if info, err := os.Lstat(tm.recycleDir); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return 0, fmt.Errorf("清空回收站失败: 回收站目录是符号链接, 可能被篡改: %s", tm.recycleDir)
		}
	} else if !os.IsNotExist(err) {
		return 0, fmt.Errorf("清空回收站失败: %w", err)
	}
	if _, err := os.Stat(tm.recycleDir); os.IsNotExist(err) {
		return 0, nil
	}
	// 先统计文件数（最佳努力）：复用 List() 的过滤口径（含 ysm.json 的文件夹模型
	// 整组算 1 条、被禁用/受支持扩展名过滤后的文件条目）但只计数——不构造 []ModelEntry
	// 切片、不递归算 dirSize，避免清空前一次全量物化（List() 的 WalkDir+dirSize 对大回收站是
	// 纯浪费，仅为了拿一个 len）。
	count := tm.countEntries()
	// 删除整个回收站目录
	if err := os.RemoveAll(tm.recycleDir); err != nil {
		return 0, fmt.Errorf("清空回收站失败: %w", err)
	}
	// 重建空目录
	if err := os.MkdirAll(tm.recycleDir, fsutil.DirPerms); err != nil {
		return 0, fmt.Errorf("重建回收站目录失败: %w", err)
	}
	return count, nil
}

// ===== 向后兼容的包级函数 =====
