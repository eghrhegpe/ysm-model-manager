package recycle

import (
	"fmt"
	"io"
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
		os.Remove(src)
		return &MoveResult{Action: "deleted_link", Reason: "符号链接，已直接删除"}, nil
	}
	stat, ok := info.Sys().(interface{ Nlink() uint64 })
	if ok && stat.Nlink() > 1 {
		os.Remove(src)
		return &MoveResult{Action: "deleted_link", Reason: fmt.Sprintf("硬链接(链接数 %d)，已直接删除", stat.Nlink())}, nil
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
		}
		ext := filepath.Ext(rel)
		name := rel[:len(rel)-len(ext)]
		dst = filepath.Join(tm.recycleDir, name+"("+strconv.Itoa(i)+")"+ext)
		cleanDst = filepath.Clean(dst)
		if !strings.HasPrefix(cleanDst, cleanRecycle+string(filepath.Separator)) && cleanDst != cleanRecycle {
			return nil, fmt.Errorf("路径越权: %s 不在回收站目录下", dst)
		}
	}
	if err := copyFile(src, dst); err != nil {
		return nil, err
	}
	return &MoveResult{Action: "recycled", Reason: ""}, os.Remove(src)
}

// List 列出回收站中的文件
func (tm *TrashManager) List() []types.ModelEntry {
	entries := []types.ModelEntry{}
	filepath.WalkDir(tm.recycleDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
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
	if err := copyFile(src, dst); err != nil {
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

// Empty 清空回收站（递归删除所有文件和子目录）
func (tm *TrashManager) Empty() (int, error) {
	if tm.recycleDir == "" {
		return 0, nil
	}
	if _, err := os.Stat(tm.recycleDir); os.IsNotExist(err) {
		return 0, nil
	}
	count := 0
	filepath.WalkDir(tm.recycleDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if p == tm.recycleDir {
			return nil
		}
		if d.IsDir() {
			// 删除空目录
			os.Remove(p)
			return filepath.SkipDir
		}
		if err := os.Remove(p); err == nil {
			count++
		}
		return nil
	})
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
