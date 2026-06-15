// Package importer 提供资源导入策略接口和内置实现
//
// 每种资源类型可以注册自己的导入策略，通用组件通过 rtype 自动选择：
//
//	handler := importer.Get("resourcepack")
//	errMsg := handler.Import(zipPath, dstDir)
package importer

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// Handler 资源导入策略接口
type Handler interface {
	// Type 返回支持的类型 ID
	Type() string
	// Import 执行导入，返回错误信息（空串=成功）
	Import(srcPath, dstDir string) string
}

var registry = map[string]Handler{}

// Register 注册导入策略
func Register(h Handler) {
	registry[h.Type()] = h
}

// Get 获取指定类型的导入策略
func Get(rtype string) Handler {
	return registry[rtype]
}

// sanitizePath 清理路径，确保不含路径遍历组件（..）
// 注意：上层调用（installer.Install）已通过 paths.IsInside 做了严格校验，
// 此处的检查是防御纵深，防止 importer 被独立使用时出现路径遍历。
func sanitizePath(path, label string) (string, string) {
	cleaned := filepath.Clean(path)
	// filepath.Clean 会规范化路径，但若 path 以 .. 开头（如 ../etc），Clean 后可能仍含 ..。
	// 此处检查清理后的结果是否仍有 .. 前缀或组件。
	sep := string(filepath.Separator)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+sep) || strings.Contains(cleaned, sep+".."+sep) || strings.HasSuffix(cleaned, sep+"..") {
		return cleaned, fmt.Sprintf("%s 包含非法路径 '..'", label)
	}
	return cleaned, ""
}

// ===== SimpleCopyImporter =====
// 适用于资源包/光影包等只需复制文件的资源类型

type SimpleCopyImporter struct {
	rtype string
}

// NewSimpleCopy 创建简单文件复制导入器
func NewSimpleCopy(rtype string) *SimpleCopyImporter {
	return &SimpleCopyImporter{rtype: rtype}
}

func (s *SimpleCopyImporter) Type() string { return s.rtype }

func (s *SimpleCopyImporter) Import(srcPath, dstDir string) string {
	if srcPath == "" {
		return "源文件路径为空"
	}
	if dstDir == "" {
		return "目标目录为空"
	}

	// 路径清理与遍历防护
	var errMsg string
	srcPath, errMsg = sanitizePath(srcPath, "源路径")
	if errMsg != "" {
		return errMsg
	}
	dstDir, errMsg = sanitizePath(dstDir, "目标路径")
	if errMsg != "" {
		return errMsg
	}

	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Sprintf("创建目标目录失败: %v", err)
	}

	// 检查源路径是文件还是目录
	info, err := os.Stat(srcPath)
	if err != nil {
		return fmt.Sprintf("无法访问源路径: %v", err)
	}

	if info.IsDir() {
		// 目录导入：复制整个目录树
		baseName := filepath.Base(srcPath)
		targetDir := filepath.Join(dstDir, baseName)
		if err := copyDirRecursive(srcPath, targetDir); err != nil {
			return fmt.Sprintf("导入目录失败: %v", err)
		}
		return ""
	}

	// 文件导入：单文件复制
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Sprintf("打开源文件失败: %v", err)
	}
	defer srcFile.Close()

	dstPath := filepath.Join(dstDir, filepath.Base(srcPath))
	dstFile, err := os.Create(dstPath)
	if err != nil {
		return fmt.Sprintf("创建目标文件失败: %v", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Sprintf("复制文件失败: %v", err)
	}
	return ""
}

// copyDirRecursive 递归复制目录（先复制到临时目录再 rename，保证原子性）
func copyDirRecursive(src, dst string) error {
	// 用 MkdirTemp 创建临时目录（自动生成唯一名称，避免并发冲突）
	tmpDir, err := os.MkdirTemp(filepath.Dir(dst), ".tmp_import_")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir) // 失败时清理临时目录

	if err := copyDirContents(src, tmpDir); err != nil {
		return err
	}

	// 原子性：先重命名临时目录为目标目录
	// 若目标已存在，先删除再 rename（os.Rename 在 Windows 上不覆盖已存在的目录）
	if _, stErr := os.Stat(dst); stErr == nil {
		os.RemoveAll(dst)
	}
	return os.Rename(tmpDir, dst)
}

// copyDirContents 递归复制目录内容到目标（无原子性保证，供 copyDirRecursive 内部调用）
func copyDirContents(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			// 符号链接目录：复制链接本身而非进入
			if entry.Type()&os.ModeSymlink != 0 {
				if target, rErr := os.Readlink(srcPath); rErr == nil {
					os.Symlink(target, dstPath)
				}
				continue
			}
			if err := copyDirContents(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			// 符号链接文件：复制链接本身
			if entry.Type()&os.ModeSymlink != 0 {
				if target, rErr := os.Readlink(srcPath); rErr == nil {
					os.Symlink(target, dstPath)
				}
				continue
			}
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}
	return nil
}

// ===== DirectoryCopyImporter =====
// 适用于 MMD 模型等以文件夹为单位的资源类型

type DirectoryCopyImporter struct {
	rtype string
}

// NewDirectoryCopy 创建文件夹复制导入器
func NewDirectoryCopy(rtype string) *DirectoryCopyImporter {
	return &DirectoryCopyImporter{rtype: rtype}
}

func (d *DirectoryCopyImporter) Type() string { return d.rtype }

// Import 复制源文件夹到目标目录
// srcPath 可以是文件夹内任意文件路径，也可以是文件夹本身
// 若 srcPath 是文件则取父目录，若是目录则直接使用
func (d *DirectoryCopyImporter) Import(srcPath, dstDir string) string {
	if srcPath == "" {
		return "源文件路径为空"
	}
	if dstDir == "" {
		return "目标目录为空"
	}

	// 路径清理与遍历防护
	var errMsg string
	srcPath, errMsg = sanitizePath(srcPath, "源路径")
	if errMsg != "" {
		return errMsg
	}
	dstDir, errMsg = sanitizePath(dstDir, "目标路径")
	if errMsg != "" {
		return errMsg
	}

	// 判断 srcPath 是文件还是目录
	info, stErr := os.Stat(srcPath)
	if stErr != nil {
		return fmt.Sprintf("无法访问源路径: %v", stErr)
	}
	var srcDir string
	if info.IsDir() {
		srcDir = srcPath
	} else {
		srcDir = filepath.Dir(srcPath)
	}
	folderName := filepath.Base(srcDir)
	dstPath := filepath.Join(dstDir, folderName)

	// 确保目标父目录存在
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Sprintf("创建目标目录失败: %v", err)
	}
	// 复制整个文件夹
	if err := copyDir(srcDir, dstPath); err != nil {
		return fmt.Sprintf("复制文件夹失败: %v", err)
	}
	return ""
}

func copyDir(src, dst string) error {
	// 用 MkdirTemp 创建临时目录，避免并发冲突
	tmpDir, err := os.MkdirTemp(filepath.Dir(dst), ".tmp_import_")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmpDir)

	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(tmpDir, e.Name())
		if e.IsDir() {
			if e.Type()&os.ModeSymlink != 0 {
				if target, rErr := os.Readlink(srcPath); rErr == nil {
					os.Symlink(target, dstPath)
				}
				continue
			}
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if e.Type()&os.ModeSymlink != 0 {
				if target, rErr := os.Readlink(srcPath); rErr == nil {
					os.Symlink(target, dstPath)
				}
				continue
			}
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}

	if _, stErr := os.Stat(dst); stErr == nil {
		os.RemoveAll(dst)
	}
	return os.Rename(tmpDir, dst)
}

// copyFile 复制单文件（工具函数）
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
	if err == nil {
		if chErr := os.Chmod(dst, 0644); chErr != nil {
			log.Printf("[importer] 设置权限失败 %s: %v", dst, chErr)
		}
	}
	return err
}

// ===== 初始化注册 =====
func init() {
	Register(NewSimpleCopy("resourcepack"))
	Register(NewSimpleCopy("shaderpack"))
	Register(NewSimpleCopy("create-blueprint"))
	Register(NewDirectoryCopy("mmd-skin"))
	Register(NewSimpleCopy("vrchat-avatar"))
}
