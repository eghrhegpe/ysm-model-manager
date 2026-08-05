package recycle

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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
}

// New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle
func New(root string) *TrashManager {
	return &TrashManager{recycleDir: filepath.Join(root, ".recycle")}
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

func (tm *TrashManager) moveEx(src string) (*MoveResult, error) {
	if tm.recycleDir == "" {
		return nil, fmt.Errorf("回收站目录未设置")
	}
	rootDir := filepath.Dir(tm.recycleDir)
	if err := paths.IsInside(rootDir, src); err != nil {
		return nil, err
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
	// 硬链接检测：Unix 通过 Nlink()，Windows 通过 syscall
	if isHardLink(info, src) {
		if err := os.Remove(src); err != nil {
			return nil, err
		}
		return &MoveResult{Action: "deleted_link", Reason: "硬链接，已直接删除"}, nil
	}
	os.MkdirAll(tm.recycleDir, 0755)
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
	for i := 1; ; i++ {
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			break
		} else if err != nil {
			// 非"不存在"错误（权限等）直接返回，避免静默跳过冲突检测
			return nil, err
		}
		ext := filepath.Ext(rel)
		name := rel[:len(rel)-len(ext)]
		dst = filepath.Join(tm.recycleDir, name+"("+strconv.Itoa(i)+")"+ext)
		cleanDst = filepath.Clean(dst)
		if !strings.HasPrefix(cleanDst, cleanRecycle+string(filepath.Separator)) && cleanDst != cleanRecycle {
			return nil, fmt.Errorf("路径越权: %s 不在回收站目录下", dst)
		}
	}
	// 优先瞬时移动（同分区原子操作，避免大模型文件全量复制）；
	// 跨设备（EXDEV）或文件占用时回退复制后删，语义不变
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return nil, err
	}
	if err := os.Rename(src, dst); err == nil {
		return &MoveResult{Action: "recycled", Reason: ""}, nil
	}
	if err := copyFile(src, dst); err != nil {
		return nil, err
	}
	return &MoveResult{Action: "recycled", Reason: ""}, os.Remove(src)
}

// isHardLink 判断文件是否为硬链接（nlink > 1）。
// 实现按平台隔离：见 recycle_windows.go / recycle_other.go。

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
		// 检查是否为 .ban 后缀（禁用标记）或其他受支持的扩展名
		if ext != ".ban" && !types.IsSupportedExt(ext) {
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
	if err := paths.IsInside(tm.recycleDir, src); err != nil {
		return err
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
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	for i := 1; ; i++ {
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			break
		}
		ext := filepath.Ext(rel)
		name := rel[:len(rel)-len(ext)]
		dst = filepath.Join(rootDir, name+"("+strconv.Itoa(i)+")"+ext)
		if err := paths.IsInside(rootDir, dst); err != nil {
			return err
		}
	}
	// 优先瞬时移动（同分区原子操作）；跨设备时回退复制后删，语义不变
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := copyFile(src, dst); err != nil {
		// 复制中断/失败时清理半截恢复文件，避免目标目录残留损坏文件
		os.Remove(dst)
		return err
	}
	return os.Remove(src)
}

// Delete 永久删除回收站中的文件
func (tm *TrashManager) Delete(src string) error {
	if err := paths.IsInside(tm.recycleDir, src); err != nil {
		return err
	}
	return os.Remove(src)
}

// Empty 清空回收站
// 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理
func (tm *TrashManager) Empty() (int, error) {
	if tm.recycleDir == "" {
		return 0, nil
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
	if err := os.MkdirAll(tm.recycleDir, 0755); err != nil {
		return 0, fmt.Errorf("重建回收站目录失败: %w", err)
	}
	return count, nil
}

// ===== 向后兼容的包级函数 =====

func Move(src, repoRoot string) error {
	return New(repoRoot).Move(src)
}

func MoveEx(src, repoRoot string) *MoveResult {
	return New(repoRoot).MoveEx(src)
}

func List(repoRoot string) []types.ModelEntry {
	return New(repoRoot).List()
}

func Restore(src, repoRoot string) error {
	return New(repoRoot).Restore(src)
}

func Delete(src, repoRoot string) error {
	return New(repoRoot).Delete(src)
}

func Empty(repoRoot string) (int, error) {
	return New(repoRoot).Empty()
}

// copyFile 复制文件（跨分区兼容）
// 注意：未限制读取大小，但回收站场景目标文件来自用户本地目录，风险可控
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
