package recycle

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"

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
	// 硬链接检测：Unix 通过 Nlink()，Windows 通过 syscall
	if isHardLink(info, src) {
		os.Remove(src)
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

// isHardLink 跨平台判断文件是否为硬链接（nlink > 1）
// Unix: 通过 os.FileInfo.Sys().Nlink()
// Windows: 通过 syscall.GetFileInformationByHandle
func isHardLink(info os.FileInfo, path string) bool {
	// Unix/macOS: 通过 Nlink() 接口
	if stat, ok := info.Sys().(interface{ Nlink() uint64 }); ok && stat.Nlink() > 1 {
		return true
	}
	// Windows: 通过 syscall 获取 NumberOfLinks
	if runtime.GOOS == "windows" {
		pathp, err := syscall.UTF16PtrFromString(path)
		if err != nil {
			return false
		}
		handle, err := syscall.CreateFile(pathp,
			syscall.GENERIC_READ,
			syscall.FILE_SHARE_READ|syscall.FILE_SHARE_WRITE,
			nil,
			syscall.OPEN_EXISTING,
			syscall.FILE_ATTRIBUTE_NORMAL,
			0)
		if err != nil {
			return false
		}
		defer syscall.CloseHandle(handle)
		var bhi syscall.ByHandleFileInformation
		if err := syscall.GetFileInformationByHandle(handle, &bhi); err == nil && bhi.NumberOfLinks > 1 {
			return true
		}
	}
	return false
}

// List 列出回收站中的文件
func (tm *TrashManager) List() []types.ModelEntry {
	entries := []types.ModelEntry{}
	filepath.WalkDir(tm.recycleDir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			log.Printf("[recycle] WalkDir 错误 %s: %v", p, err)
			return nil
		}
		if d.IsDir() {
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
