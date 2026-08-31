package recycle

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// MoveResult 回收操作结果
type MoveResult struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
}

// TrashManager 可配置的回收站管理器
type TrashManager struct {
	recycleDir string
	// ⚠️ 跨设备回退的 rename/目录复制/文件复制实现（测试注入点，禁止生产调用：模拟 EXDEV 与复制中途失败），
	// 生产恒为真实实现（New 中初始化）；moveEx 与 Restore 共用同一组注入点，
	// 保证跨设备回退分支（含复制失败清理）在单测中可确定性覆盖
	renameForMove   func(src, dst string) error
	copyDirForMove  func(src, dst string) error
	copyFileForMove func(src, dst string) error
}

// New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle
func New(root string) *TrashManager {
	return &TrashManager{
		recycleDir:      filepath.Join(root, ".recycle"),
		renameForMove:   os.Rename,
		copyDirForMove:  copyDirRecursive,
		copyFileForMove: copyFile,
	}
}

// RecycleDir 返回回收站目录路径
func (tm *TrashManager) RecycleDir() string {
	return tm.recycleDir
}

// Move 移动文件到回收站
func (tm *TrashManager) Move(src string) error {
	_, err := tm.moveEx(src)
	return err
}

// MoveEx 移动文件到回收站，返回操作详情
func (tm *TrashManager) MoveEx(src string) *MoveResult {
	res, err := tm.moveEx(src)
	if err != nil {
		return &MoveResult{Action: "error", Reason: err.Error()}
	}
	return res
}

// uniqueDest 冲突后缀循环：目标已存在时在扩展名前追加 (1)、(2)… 重试，
// 返回首个不存在的目标路径。每次候选（含初始 dst）先经 guard 越权校验；
// os.Lstat 非「不存在」错误（权限 EACCES 等）直接返回，避免静默跳过冲突检测。
// 使用 Lstat 而非 Stat：避免跟随符号链接——目标位置的悬空符号链接（target 不存在）
// 经 Stat 会返回 IsNotExist=true，误判为「路径空闲」导致 rename 覆盖悬空链接；
// Lstat 检测链接本身存在，正确生成编号后缀路径（与 moveEx/Restore 的 Lstat 语义对齐）。
// 收敛 moveEx / Restore 两份逐字重复的冲突后缀循环（索引 6.8b）。
func uniqueDest(dst string, guard func(string) error) (string, error) {
	if err := guard(dst); err != nil {
		return "", err
	}
	ext := filepath.Ext(dst)
	base := dst[:len(dst)-len(ext)]
	for i := 1; ; i++ {
		if _, err := os.Lstat(dst); os.IsNotExist(err) {
			return dst, nil
		} else if err != nil {
			// 非「不存在」错误（权限等）直接返回，避免静默跳过冲突检测
			return "", err
		}
		dst = base + "(" + strconv.Itoa(i) + ")" + ext
		if err := guard(dst); err != nil {
			return "", err
		}
	}
}

func (tm *TrashManager) moveEx(src string) (*MoveResult, error) {
	if tm.recycleDir == "" {
		return nil, fmt.Errorf("回收站目录未设置")
	}
	rootDir := filepath.Dir(tm.recycleDir)
	// IsInside 对 path==baseDir（rel=="."）放行——src==rootDir
	// 时 rel=="."、dst==recycleDir 命中回收站自身，整树 rename 会把回收站搬进自己
	// （目标已存在报错，但守卫语义错位）；显式拒绝 src 等于资源根（对齐 AGENTS.md
	// 「IsInside 相等放行时额外 Clean 相等拒绝」范式）
	if paths.IsInsideResolved(rootDir, src) != nil || filepath.Clean(src) == filepath.Clean(rootDir) {
		return nil, fmt.Errorf("路径越权: %s 不在资源目录下", src)
	}
	info, err := os.Lstat(src)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		if err := os.Remove(src); err != nil {
			return nil, err
		}
		return &MoveResult{Action: "deleted_link", Reason: "符号链接，已直接删除"}, nil
	}
	// 硬链接检测：统一走 fsutil.IsHardLink（含目录排除 ADR-038）
	if fsutil.IsHardLink(src) {
		if err := os.Remove(src); err != nil {
			return nil, err
		}
		return &MoveResult{Action: "deleted_link", Reason: "硬链接，已直接删除"}, nil
	}
	if err := os.MkdirAll(tm.recycleDir, fsutil.DirPerms); err != nil {
		return nil, err // fail-fast：回收站目录创建失败（权限/磁盘满）提前暴露，避免后续 rename 报无关错误
	}
	rel, err := filepath.Rel(rootDir, src)
	if err != nil {
		return nil, err
	}
	dst := filepath.Join(tm.recycleDir, rel)
	// dst 由 tm.recycleDir + rel 构造，安全检查
	cleanDst := filepath.Clean(dst)
	cleanRecycle := filepath.Clean(tm.recycleDir)
	if !strings.HasPrefix(cleanDst, cleanRecycle+string(filepath.Separator)) && cleanDst != cleanRecycle {
		return nil, fmt.Errorf("路径越权: %s 不在回收站目录下", dst)
	}
	// 冲突后缀循环（与 Restore 共用 uniqueDest，索引 6.8b）；guard 保持越权校验
	dst, err = uniqueDest(dst, func(candidate string) error {
		cd := filepath.Clean(candidate)
		if !strings.HasPrefix(cd, cleanRecycle+string(filepath.Separator)) && cd != cleanRecycle {
			return fmt.Errorf("路径越权: %s 不在回收站目录下", candidate)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// 优先瞬时移动（同分区原子操作，避免大模型文件全量复制）；
	// 仅跨设备（EXDEV）回退复制后删；权限/占用等其他失败直接报错，
	// 避免无谓全量复制，以及「副本已入站、源未删」的重试堆积（审核 P2）
	if err := os.MkdirAll(filepath.Dir(dst), fsutil.DirPerms); err != nil {
		return nil, err
	}
	if err := tm.renameForMove(src, dst); err == nil {
		// rename 成功后事后校验：dst 仍落在 recycleDir 内（R26 P2-3）。
		// 防御文件系统 TOCTOU——rename 前父目录被换 symlink 可能让文件落到回收站之外。
		// 虽 TrashManager 自身无共享内存状态，但文件系统 TOCTOU 面存在；
		// 命中时尝试 os.Rename 回滚，回滚失败则报错让上层决策。
		if rerr := paths.IsInsideResolved(tm.recycleDir, dst); rerr != nil {
			if rbErr := os.Rename(dst, src); rbErr != nil {
				return nil, fmt.Errorf("rename 后 dst 越出回收站且回滚失败: %w（源 %s, 副本 %s）", rerr, src, dst)
			}
			return nil, fmt.Errorf("rename 后 dst 越出回收站, 已回滚: %w", rerr)
		}
		return &MoveResult{Action: "recycled", Reason: ""}, nil
	} else if !fsutil.IsCrossDeviceErr(err) {
		return nil, err
	}
	// 跨设备回退：目录（文件夹型模型）递归复制整棵树；文件走 copyFile
	if info.IsDir() {
		if err := tm.copyDirForMove(src, dst); err != nil {
			logHalfCleanup(dst, "", true) // 复制中断/失败时清理半截目录，避免回收站残留损坏数据
			return nil, err
		}
		if err := os.RemoveAll(src); err != nil {
			return nil, tm.rollbackAfterSourceRemoveFail(src, dst, err, true)
		}
		return &MoveResult{Action: "recycled", Reason: ""}, nil
	}
	if err := tm.copyFileForMove(src, dst); err != nil {
		logHalfCleanup(dst, "", false) // 复制中断/失败时清理半截文件，避免回收站残留损坏文件
		return nil, err
	}
	if err := os.Remove(src); err != nil {
		return nil, tm.rollbackAfterSourceRemoveFail(src, dst, err, false)
	}
	return &MoveResult{Action: "recycled", Reason: ""}, nil
}

// rollbackAfterSourceRemoveFail 跨设备 move 源删除失败时的副本回滚（R26 P2-2）。
// 源删除失败说明 move 未原子完成：清理已落地的 dst 副本（目录走 RemoveAll /
// 文件走 Remove），恢复「源还在 + 副本已清理」可安全重试状态；回滚本身也失败则
// 在复合错误中同时披露源与副本两路径，交上层决策。目录/文件两分支共用此helper，
// 消除 moveEx 内近重复回滚块（jscpd 新增对收敛）。
func (tm *TrashManager) rollbackAfterSourceRemoveFail(src, dst string, srcErr error, isDir bool) error {
	var rbErr error
	if isDir {
		rbErr = os.RemoveAll(dst)
	} else {
		rbErr = os.Remove(dst)
	}
	if rbErr != nil {
		return fmt.Errorf("跨设备 move 源删除失败且回滚副本失败: 源 %s (%w), 副本 %s (%v)", src, srcErr, dst, rbErr)
	}
	return fmt.Errorf("跨设备 move 源删除失败, 已回滚副本: 源 %s (%w)", src, srcErr)
}

// List 列出回收站中的文件。
// ADR-038 D3.4：文件夹型模型（含 ysm.json 的目录）整组合并显示为单一条目，
// 不再拆散成 ysm.json / 几何 / 动画 / 语言 json 等单文件；Restore 保持目录级还原。
func (tm *TrashManager) List() []types.ModelEntry {
	entries := []types.ModelEntry{}
	filepath.WalkDir(tm.recycleDir, func(p string, d os.DirEntry, err error) error {
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
		if !types.IsDisableSuffix(ext) && !types.IsSupportedExt(ext) {
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

// dirSize 递归统计目录总大小（文件夹模型整组条目显示用）
func dirSize(dir string) int64 {
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}

// Restore 从回收站恢复到原目录
func (tm *TrashManager) Restore(src string) error {
	// IsInside 对 path==baseDir 放行——src==recycleDir 时
	// rel=="."、dst==rootDir，整个回收站会被 rename 成 rootDir 的兄弟目录
	// （rootDir(1)），回收站被整体搬走；显式拒绝 src 等于回收站本身
	if paths.IsInsideResolved(tm.recycleDir, src) != nil || filepath.Clean(src) == filepath.Clean(tm.recycleDir) {
		return fmt.Errorf("路径越权: %s 不在回收站目录下", src)
	}
	rootDir := filepath.Dir(tm.recycleDir)
	rel, err := filepath.Rel(tm.recycleDir, src)
	if err != nil {
		return err
	}
	dst := filepath.Join(rootDir, rel)
	if err := paths.IsInside(rootDir, dst); err != nil {
		return err
	}
	dstDir := filepath.Dir(dst)
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return err
	}
	// 冲突后缀循环（与 moveEx 共用 uniqueDest，索引 6.8b）；guard 保持越权校验
	dst, err = uniqueDest(dst, func(candidate string) error {
		return paths.IsInside(rootDir, candidate)
	})
	if err != nil {
		return err
	}
	// 符号链接处理：恢复链接本身而非跟随读取目标内容（与 moveEx 的 Lstat 语义对齐）。
	// moveEx 对符号链接直接删除不入回收站，但若回收站已有历史符号链接条目（手动放入/旧版本遗留），
	// Restore 需正确处理：读取链接目标 → 重建链接 → 删除回收站侧旧链接。
	if info, statErr := os.Lstat(src); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		target, readErr := os.Readlink(src)
		if readErr != nil {
			return fmt.Errorf("读取符号链接目标失败 %s: %w", src, readErr)
		}
		// 删除回收站侧旧链接（unlink，不影响链接目标）
		if removeErr := os.Remove(src); removeErr != nil {
			return fmt.Errorf("删除回收站符号链接失败 %s: %w", src, removeErr)
		}
		// 在原位置重建符号链接
		if linkErr := os.Symlink(target, dst); linkErr != nil {
			// 回滚：恢复回收站侧链接。回滚失败时 log 并在错误中追加信息，
			// 让调用方知道回收站侧链接已永久丢失（R26 P3-3：旧实现 _ 静默吞掉）。
			if rbErr := os.Symlink(target, src); rbErr != nil {
				log.Printf("[recycle] 回收站侧链接回滚失败 %s: %v（回收站条目已丢失）", src, rbErr)
				return fmt.Errorf("恢复符号链接失败 %s -> %s: %w; 回收站侧链接回滚失败: %v", dst, target, linkErr, rbErr)
			}
			return fmt.Errorf("恢复符号链接失败 %s -> %s: %w（已回滚回收站侧链接）", dst, target, linkErr)
		}
		return nil
	}
	// 优先瞬时移动（同分区原子操作）；跨设备时回退复制后删，语义不变
	// 与 moveEx 共用 renameForMove/copyDirForMove/copyFileForMove 注入点，
	// 跨设备回退分支可被单测确定性覆盖（EXDEV 在单机不可稳定复现）
	if err := tm.renameForMove(src, dst); err == nil {
		return nil
	} else if !fsutil.IsCrossDeviceErr(err) {
		return err // 权限/占用等非跨设备错误直接返回，不尝试复制
	}
	// 目录（整组合并条目）跨设备：递归复制整棵树；文件走 copyFile
	if info, statErr := os.Lstat(src); statErr == nil && info.IsDir() {
		if err := tm.copyDirForMove(src, dst); err != nil {
			logHalfCleanup(dst, "Restore", true) // 清理失败记录日志，与 moveEx 的清理分支对齐（原 _ 静默）
			return err
		}
		return os.RemoveAll(src)
	}
	if err := tm.copyFileForMove(src, dst); err != nil {
		logHalfCleanup(dst, "Restore", false) // 复制中断/失败时清理半截恢复文件，避免目标目录残留损坏文件（原 _ 静默）
		return err
	}
	return os.Remove(src)
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
// os.RemoveAll 会跟随 symlink 删除外部目录树（R26 P2-1）。
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
	// 先统计文件数（最佳努力）
	count := len(tm.List())
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
// 仅保留 Move（go/cli/dedup.go 调用）。MoveEx/Restore/Delete/Empty/List 包级
// 变体已删除（R26 P4-1）：无生产调用方，且每次 New(filesRoot) 新建临时
// TrashManager 绕过 InstallLock 绑定，构成未持锁逃逸口。调用方应直接使用
// TrashManager 方法并确保持锁。

func Move(src, filesRoot string) error {
	return New(filesRoot).Move(src)
}

// copyFile 复制文件（跨分区兼容）
// 已收敛至 fsutil.CopyFile（ADR-044 策略 A）：同目录 tmp+rename 原子落地 + Sync 落盘检查。
// 注意：fsutil.CopyFile 的 tmp 创建在目标同目录，rename 同文件系统内执行，天然跨分区兼容。
func copyFile(src, dst string) error {
	return fsutil.CopyFile(src, dst)
}
