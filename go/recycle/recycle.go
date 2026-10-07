// Package recycle 回收站（Move/List/Restore/Delete/Empty）。
// 2026-10 拆分：原 552 行按职责分为 recycle.go（本文件：Move 入站 + 包级 Move 兼容）/
// recycle_list.go（List 枚举 + countEntries）/ recycle_restore.go（Restore/Delete/Empty）。
package recycle

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
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
		copyFileForMove: fsutil.CopyFile,
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

// generateConflictFreeDest 冲突后缀循环：目标已存在时在扩展名前追加 (1)、(2)… 重试，
// 返回首个不存在的目标路径。每次候选（含初始 dst）先经 guard 越权校验；
// os.Lstat 非「不存在」错误（权限 EACCES 等）直接返回，避免静默跳过冲突检测。
// 使用 Lstat 而非 Stat：避免跟随符号链接——目标位置的悬空符号链接（target 不存在）
// 经 Stat 会返回 IsNotExist=true，误判为「路径空闲」导致 rename 覆盖悬空链接；
// Lstat 检测链接本身存在，正确生成编号后缀路径（与 moveEx/Restore 的 Lstat 语义对齐）。
// 收敛 moveEx / Restore 两份逐字重复的冲突后缀循环（ADR-044 策略 A 收敛）。
func generateConflictFreeDest(dst string, guard func(string) error) (string, error) {
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

// prepareMoveSource moveEx 前置：越权守卫 + Lstat + 链接直删。
// 返回 (info, done, err)：done 非 nil 表示「已是终态结果」（符号链接/硬链接直接删除），
// 调用方原样返回即可，不再走回收站落点计算。
func (tm *TrashManager) prepareMoveSource(rootDir, src string) (os.FileInfo, *MoveResult, error) {
	// IsInside 对 path==baseDir（rel=="."）放行——src==rootDir
	// 时 rel=="."、dst==recycleDir 命中回收站自身，整树 rename 会把回收站搬进自己
	// （目标已存在报错，但守卫语义错位）；显式拒绝 src 等于资源根（对齐 AGENTS.md
	// 「IsInside 相等放行时额外 Clean 相等拒绝」范式）
	if paths.IsInsideResolved(rootDir, src) != nil || filepath.Clean(src) == filepath.Clean(rootDir) {
		return nil, nil, fmt.Errorf("路径越权: %s 不在资源目录下", src)
	}
	info, err := os.Lstat(src)
	if err != nil {
		return nil, nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		if err := os.Remove(src); err != nil {
			return nil, nil, err
		}
		return info, &MoveResult{Action: "deleted_link", Reason: "符号链接，已直接删除"}, nil
	}
	// 硬链接检测：统一走 fsutil.IsHardLink（含目录排除 ADR-038）
	if fsutil.IsHardLink(src) {
		if err := os.Remove(src); err != nil {
			return nil, nil, err
		}
		return info, &MoveResult{Action: "deleted_link", Reason: "硬链接，已直接删除"}, nil
	}
	return info, nil, nil
}

// resolveTrashDest 计算回收站内落点（<recycleDir>/<rel>）并做冲突后缀消解。
// 先做前缀越权校验，再把同一校验作为 guard 交给 generateConflictFreeDest——
// 每个候选（含 (1)、(2)…）都重新过一遍越权检查。
func (tm *TrashManager) resolveTrashDest(rootDir, src string) (string, error) {
	if err := os.MkdirAll(tm.recycleDir, fsutil.DirPerms); err != nil {
		return "", err // fail-fast：回收站目录创建失败（权限/磁盘满）提前暴露，避免后续 rename 报无关错误
	}
	rel, err := filepath.Rel(rootDir, src)
	if err != nil {
		return "", err
	}
	dst := filepath.Join(tm.recycleDir, rel)
	// dst 由 tm.recycleDir + rel 构造，安全检查
	cleanRecycle := filepath.Clean(tm.recycleDir)
	insideRecycle := func(candidate string) error {
		cd := filepath.Clean(candidate)
		if !strings.HasPrefix(cd, cleanRecycle+string(filepath.Separator)) && cd != cleanRecycle {
			return fmt.Errorf("路径越权: %s 不在回收站目录下", candidate)
		}
		return nil
	}
	if err := insideRecycle(dst); err != nil {
		return "", err
	}
	// 冲突后缀循环（与 Restore 共用 generateConflictFreeDest）；guard 保持越权校验
	dst, err = generateConflictFreeDest(dst, insideRecycle)
	if err != nil {
		return "", err
	}
	// 落点父目录（嵌套 rel 的中间层）在冲突后缀消解「之后」创建——保证最终选定的
	// 路径父目录必定存在，且 (1)、(2)… 的候选探测发生在空目录之上。
	// 该 MkdirAll 同时是上层清理失败的确定性归因点：落点目录被同名普通文件占用时
	// 必然返回 "not a directory"（RemoveRepoDuplicates 的 failed 上报契约依赖此行为）。
	if err := os.MkdirAll(filepath.Dir(dst), fsutil.DirPerms); err != nil {
		return "", err
	}
	return dst, nil
}

// verifyRenamedInside rename 成功后事后校验（P2-3）：dst 仍落在 recycleDir 内。
// 防御文件系统 TOCTOU——rename 前父目录被换 symlink 可能让文件落到回收站之外。
// 虽 TrashManager 自身无共享内存状态，但文件系统 TOCTOU 面存在；
// 命中时尝试 os.Rename 回滚，回滚失败则报错让上层决策。
func (tm *TrashManager) verifyRenamedInside(src, dst string) (*MoveResult, error) {
	if rerr := paths.IsInsideResolved(tm.recycleDir, dst); rerr != nil {
		if rbErr := os.Rename(dst, src); rbErr != nil {
			return nil, fmt.Errorf("rename 后 dst 越出回收站且回滚失败: %w（源 %s, 副本 %s）", rerr, src, dst)
		}
		return nil, fmt.Errorf("rename 后 dst 越出回收站, 已回滚: %w", rerr)
	}
	return &MoveResult{Action: "recycled", Reason: ""}, nil
}

// copyThenRemove 跨设备（EXDEV）回退：先把 src 复制到 dst（目录递归 / 文件单拷），
// 复制中断时清理半截副本（logHalfCleanup），源删除失败时回滚副本
// （rollbackAfterSourceRemoveFail），恢复「源还在 + 副本已清理」可安全重试状态。
//
// ⚠️ 这条「复制后删」是跨卷移动的必要防线（go/AGENTS.md 明写：不得「简化」）：
// 同卷 rename 是原子操作，跨卷则不行，只能复制 + 删源。
func (tm *TrashManager) copyThenRemove(src, dst string, info os.FileInfo) (*MoveResult, error) {
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

// moveEx 把 src 移入回收站：守卫/链接直删（prepareMoveSource）→ 落点计算
// （resolveTrashDest）→ 同卷 rename（+ 越界事后校验）→ 跨设备复制后删（copyThenRemove）。
func (tm *TrashManager) moveEx(src string) (*MoveResult, error) {
	if tm.recycleDir == "" {
		return nil, fmt.Errorf("回收站目录未设置")
	}
	rootDir := filepath.Dir(tm.recycleDir)
	info, done, err := tm.prepareMoveSource(rootDir, src)
	if err != nil {
		return nil, err
	}
	if done != nil {
		return done, nil
	}
	dst, err := tm.resolveTrashDest(rootDir, src)
	if err != nil {
		return nil, err
	}
	// 优先瞬时移动（同分区原子操作，避免大模型文件全量复制）；
	// 仅跨设备（EXDEV）回退复制后删；权限/占用等其他失败直接报错，
	// 避免无谓全量复制，以及「副本已入站、源未删」的重试堆积
	renameErr := tm.renameForMove(src, dst)
	if renameErr == nil {
		return tm.verifyRenamedInside(src, dst)
	}
	if !fsutil.IsCrossDeviceErr(renameErr) {
		return nil, renameErr
	}
	return tm.copyThenRemove(src, dst, info)
}

// rollbackAfterSourceRemoveFail 跨设备 move 源删除失败时的副本回滚（P2-2）。
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
// ===== 向后兼容的包级函数 =====
// 仅保留 Move（go/cli/dedup.go 调用）。MoveEx/Restore/Delete/Empty/List 包级
// 变体已删除（P4-1）：无生产调用方，且每次 New(filesRoot) 新建临时
// TrashManager 绕过 InstallLock 绑定，构成未持锁逃逸口。调用方应直接使用
// TrashManager 方法并确保持锁。

func Move(src, filesRoot string) error {
	return New(filesRoot).Move(src)
}
