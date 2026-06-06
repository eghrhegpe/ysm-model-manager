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
	Action string // "recycled" / "deleted_link" / "error"
	Reason string // 如果是链接文件，说明原因
}

// Move 移动文件到仓库回收站（跨分区兼容）
// 符号链接直接删除（回收无意义），硬链接也直接删除（数据还在仓库）
func Move(src, repoRoot string) error {
	_, err := moveEx(src, repoRoot)
	return err
}

// MoveEx 移动文件到回收站，返回操作详情
func MoveEx(src, repoRoot string) *MoveResult {
	res, err := moveEx(src, repoRoot)
	if err != nil {
		return &MoveResult{Action: "error", Reason: err.Error()}
	}
	return res
}

func moveEx(src, repoRoot string) (*MoveResult, error) {
	if repoRoot == "" {
		return nil, fmt.Errorf("仓库根目录未设置")
	}
	// 确保 src 在仓库目录内
	if err := paths.IsInside(repoRoot, src); err != nil {
		return nil, err
	}

	// 检查符号链接
	info, err := os.Lstat(src)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		os.Remove(src)
		return &MoveResult{Action: "deleted_link", Reason: "符号链接，已直接删除（原始文件不受影响）"}, nil
	}

	// 检查硬链接（Windows 下通过 nlink 判断）
	stat, ok := info.Sys().(interface{ Nlink() uint64 })
	if ok && stat.Nlink() > 1 {
		os.Remove(src)
		return &MoveResult{Action: "deleted_link", Reason: fmt.Sprintf("硬链接（链接数 %d），已直接删除（仓库数据不受影响）", stat.Nlink())}, nil
	}

	// 普通文件：移入回收站
	recycleDir := filepath.Join(repoRoot, ".recycle")
	os.MkdirAll(recycleDir, 0755)

	rel, err := filepath.Rel(repoRoot, src)
	if err != nil {
		return nil, err
	}
	// 防止 rel 包含 .. 路径遍历
	dst := filepath.Join(recycleDir, rel)
	if err := paths.IsInside(recycleDir, dst); err != nil {
		return nil, err
	}

	os.MkdirAll(filepath.Dir(dst), 0755)

	for i := 1; ; i++ {
		if _, err := os.Stat(dst); os.IsNotExist(err) {
			break
		}
		ext := filepath.Ext(rel)
		name := rel[:len(rel)-len(ext)]
		dst = filepath.Join(recycleDir, name+"("+strconv.Itoa(i)+")"+ext)
		if err := paths.IsInside(recycleDir, dst); err != nil {
			return nil, err
		}
	}
	// 跨分区兼容：先复制再删除
	if err := copyFile(src, dst); err != nil {
		return nil, err
	}
	return &MoveResult{Action: "recycled", Reason: ""}, os.Remove(src)
}

// List 列出回收站中的文件
func List(repoRoot string) []types.ModelEntry {
	recycleDir := filepath.Join(repoRoot, ".recycle")
	entries := []types.ModelEntry{}
	filepath.WalkDir(recycleDir, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if ext != ".ysm" && ext != ".zip" && ext != ".7z" && ext != ".ban" {
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

// Restore 从回收站恢复到原目录（跨分区兼容）
func Restore(src, repoRoot string) error {
	recycleDir := filepath.Join(repoRoot, ".recycle")
	if err := paths.IsInside(recycleDir, src); err != nil {
		return err
	}

	rel, err := filepath.Rel(recycleDir, src)
	if err != nil {
		return err
	}
	dst := filepath.Join(repoRoot, rel)
	if err := paths.IsInside(repoRoot, dst); err != nil {
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
		dst = filepath.Join(repoRoot, name+"("+strconv.Itoa(i)+")"+ext)
		if err := paths.IsInside(repoRoot, dst); err != nil {
			return err
		}
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	return os.Remove(src)
}

// Delete 永久删除回收站中的文件
func Delete(src, repoRoot string) error {
	recycleDir := filepath.Join(repoRoot, ".recycle")
	if err := paths.IsInside(recycleDir, src); err != nil {
		return err
	}
	return os.Remove(src)
}

// Empty 清空回收站
func Empty(repoRoot string) (int, error) {
	recycleDir := filepath.Join(repoRoot, ".recycle")
	entries, err := os.ReadDir(recycleDir)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, e := range entries {
		p := filepath.Join(recycleDir, e.Name())
		if err := os.RemoveAll(p); err == nil {
			count++
		}
	}
	return count, nil
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
