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
	"os"
	"path/filepath"
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

// ===== SimpleCopyImporter =====
// 适用于材质包/光影包等只需复制文件的资源类型

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
	// 确保目标目录存在
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Sprintf("创建目标目录失败: %v", err)
	}
	// 打开源文件
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Sprintf("打开源文件失败: %v", err)
	}
	defer srcFile.Close()
	// 创建目标文件
	dstPath := filepath.Join(dstDir, filepath.Base(srcPath))
	dstFile, err := os.Create(dstPath)
	if err != nil {
		return fmt.Sprintf("创建目标文件失败: %v", err)
	}
	defer dstFile.Close()
	// 复制内容
	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Sprintf("复制文件失败: %v", err)
	}
	return ""
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
// srcPath 是文件夹内任意文件路径，导入时复制整个父文件夹
func (d *DirectoryCopyImporter) Import(srcPath, dstDir string) string {
	if srcPath == "" {
		return "源文件路径为空"
	}
	if dstDir == "" {
		return "目标目录为空"
	}
	srcDir := filepath.Dir(srcPath)
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
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		srcPath := filepath.Join(src, e.Name())
		dstPath := filepath.Join(dst, e.Name())
		if e.IsDir() {
			if err := copyDir(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if err := copyFile(srcPath, dstPath); err != nil {
				return err
			}
		}
	}
	return nil
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
