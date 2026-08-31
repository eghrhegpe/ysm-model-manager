// Package importer 提供资源导入策略接口和内置实现
//
// 每种资源类型可以注册自己的导入策略，通用组件通过 rtype 自动选择：
//
//	handler := importer.Get("resourcepack")
//	errMsg := handler.Import(zipPath, dstDir)
package importer

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/paths"
)

// Handler 资源导入策略接口
type Handler interface {
	// Type 返回支持的类型 ID
	Type() string
	// Import 执行导入，返回错误信息（空串=成功）
	Import(srcPath, dstDir string) string
}

var (
	registry   = map[string]Handler{}
	registryMu sync.RWMutex
)

// Register 注册导入策略（线程安全）
func Register(h Handler) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[h.Type()] = h
}

// Get 获取指定类型的导入策略（线程安全）
func Get(rtype string) Handler {
	registryMu.RLock()
	defer registryMu.RUnlock()
	return registry[rtype]
}

// sanitizePath 清理路径，确保不含路径遍历组件（..）
// 注意：上层调用（installer.Install）已通过 paths.IsInside 做了严格校验，
// 此处的检查是防御纵深，防止 importer 被独立使用时出现路径遍历。
func sanitizePath(path, label string) (string, error) {
	// NUL 字节防御——与 fsutil.WriteFileAtomic 对齐（防御纵深，跨平台行为一致）：
	// Linux filepath.Abs/Clean 会静默截断 NUL 后内容，Windows OS 层拒绝但 Go 层不拦截。
	// 显式拒绝避免 "safe.ysm\x00.exe" → "safe.ysm" 的静默截断攻击面。
	if strings.Contains(path, "\x00") {
		return "", fmt.Errorf("%s 含 NUL 字节", label)
	}
	cleaned := filepath.Clean(path)
	if paths.HasTraversal(cleaned) {
		return cleaned, fmt.Errorf("%s 包含非法路径 '..'", label)
	}
	return cleaned, nil
}

// sanitizeImportPaths 校验并清理导入操作的源/目标路径。
// 返回 (清理后源路径, 清理后目标路径, 错误文案)；错误文案非空时调用方应原样返回给用户。
// 两类 Import 实现（SimpleCopy / DirectoryCopy）的前置校验逐字相同，抽此为单一事实源。
func sanitizeImportPaths(srcPath, dstDir string) (string, string, string) {
	if srcPath == "" {
		return "", "", "源文件路径为空"
	}
	if dstDir == "" {
		return "", "", "目标目录为空"
	}

	// 路径清理与遍历防护
	cleanSrc, err := sanitizePath(srcPath, "源路径")
	if err != nil {
		return "", "", err.Error()
	}
	cleanDst, err := sanitizePath(dstDir, "目标路径")
	if err != nil {
		return "", "", err.Error()
	}
	return cleanSrc, cleanDst, ""
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
	srcPath, dstDir, errMsg := sanitizeImportPaths(srcPath, dstDir)
	if errMsg != "" {
		return errMsg
	}

	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
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
		if baseName == "" || baseName == "." ||
			baseName == string(filepath.Separator) ||
			baseName == string(filepath.VolumeName(srcPath)) {
			return "源路径无效：无法确定要导入的模型文件夹（源为磁盘根目录）"
		}
		targetDir := filepath.Join(dstDir, baseName)
		if err := copyDirRecursive(srcPath, targetDir); err != nil {
			return fmt.Sprintf("导入目录失败: %v", err)
		}
		return ""
	}

	// 文件导入：收敛到 fsutil.CopyFile（ADR-044 策略 A）——
	// tmp+rename 原子落地 + Sync 落盘 + Chmod 0644 + rename 前关闭源文件句柄
	// （Windows 同目录复制兼容：defer Close 太晚导致 rename Access is denied）。
	// 原 50 行手写 tmp+sync+chmod+rename 实现与 fsutil.CopyFile 完全重复，收敛后单一实现。
	dstPath := filepath.Join(dstDir, filepath.Base(srcPath))
	if err := fsutil.CopyFile(srcPath, dstPath); err != nil {
		return fmt.Sprintf("复制文件失败: %v", err)
	}
	return ""
}

// copyDirRecursive 递归复制目录（先复制到临时目录再 rename，保证原子性）
// 已收敛至 fsutil.CopyDirRecursive（ADR-044 策略 A）
func copyDirRecursive(src, dst string) error {
	return fsutil.CopyDirRecursive(src, dst, fsutil.CopyDirOptions{
		Overwrite:    true,
		AtomicRename: true,
	})
}

// ===== DirectoryCopyImporter =====

// copyDirContents 递归复制目录内容到目标（无原子性保证，供旧 copyDirRecursive 测试保留）。
// 收敛后不再供生产代码使用，仅保留供已有测试引用（drift-scan 不检测此函数名）。
func copyDirContents(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		srcPath := filepath.Join(src, entry.Name())
		dstPath := filepath.Join(dst, entry.Name())
		if entry.IsDir() {
			if err := os.MkdirAll(dstPath, fsutil.DirPerms); err != nil {
				return err
			}
			if err := copyDirContents(srcPath, dstPath); err != nil {
				return err
			}
		} else {
			if entry.Type()&os.ModeSymlink != 0 {
				target, rErr := os.Readlink(srcPath)
				if rErr != nil {
					return rErr
				}
				// R30 P2-1：符号链接路径穿越防护。
				// 绝对路径或含 .. 的相对路径可指向仓库外（如 /etc/passwd），
				// 攻击者构造含恶意 symlink 的源目录即可越权读/写。
				// 修复：解析 target 为绝对路径，判定是否在源目录树内，
				// 越界则拒绝。
				cleanTarget := filepath.Clean(target)
				var resolvedTarget string
				if filepath.IsAbs(cleanTarget) {
					resolvedTarget = cleanTarget
				} else {
					// 相对路径：解析为相对于 src 的绝对路径
					resolvedTarget = filepath.Join(src, cleanTarget)
				}
				resolvedSrc, _ := filepath.Abs(src)
				resolvedTargetAbs, _ := filepath.Abs(resolvedTarget)
				// 允许指向源目录树内（含 src 自身）的 symlink，拒绝越界
				if resolvedTargetAbs != resolvedSrc &&
					!strings.HasPrefix(resolvedTargetAbs+string(filepath.Separator), resolvedSrc+string(filepath.Separator)) {
					return fmt.Errorf("拒绝越界符号链接: %s -> %s", srcPath, target)
				}
				if sErr := os.Symlink(target, dstPath); sErr != nil {
					return sErr
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
	srcPath, dstDir, errMsg := sanitizeImportPaths(srcPath, dstDir)
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
	if folderName == "" || folderName == "." ||
		folderName == string(filepath.Separator) ||
		folderName == string(filepath.VolumeName(srcDir)) {
		return "源路径无效：无法确定要导入的模型文件夹（源为磁盘根目录）"
	}
	dstPath := filepath.Join(dstDir, folderName)

	// 确保目标父目录存在
	if err := os.MkdirAll(dstDir, fsutil.DirPerms); err != nil {
		return fmt.Sprintf("创建目标目录失败: %v", err)
	}
	// 复制整个文件夹
	if err := copyDir(srcDir, dstPath); err != nil {
		return fmt.Sprintf("复制文件夹失败: %v", err)
	}
	return ""
}

func copyDir(src, dst string) error {
	// 已收敛至 fsutil.CopyDirRecursive（ADR-044 策略 A）：原子 rename + 祖先守卫。
	return fsutil.CopyDirRecursive(src, dst, fsutil.CopyDirOptions{
		Overwrite:    true,
		AtomicRename: true,
	})
}

// copyFile 复制单文件（工具函数）
// 已收敛至 fsutil.CopyFile（ADR-044 策略 A）：tmp+rename 原子落地 + Sync + Chmod 0644，
// 失败自动清理临时文件，不留半截目标（原直写 os.Create + 失败 os.Remove 降级为原子模式）。
func copyFile(src, dst string) error {
	return fsutil.CopyFile(src, dst)
}

// ===== 初始化注册 =====
func init() {
	Register(NewSimpleCopy("resourcepack"))
	Register(NewSimpleCopy("shaderpack"))
	Register(NewSimpleCopy("blueprint"))
	Register(NewDirectoryCopy("EntityPlayer"))
	Register(NewDirectoryCopy("SceneModel"))
	Register(NewDirectoryCopy("CustomAnim"))
	Register(NewDirectoryCopy("CustomMorph"))
	Register(NewDirectoryCopy("StageAnim"))
	Register(NewDirectoryCopy("mmd-shader"))
	Register(NewDirectoryCopy("DefaultAnim"))
	Register(NewDirectoryCopy("DefaultMorph"))
	Register(NewDirectoryCopy("maid-model"))
	Register(NewSimpleCopy("ysm"))
	Register(NewSimpleCopy("litematic"))
}
