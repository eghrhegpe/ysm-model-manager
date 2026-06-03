package installer

import (
	"io"
	"os"
	"path/filepath"
	"strings"
    "ysm-model-manager/go/types" 
)

// Install 安装模型到目标目录（支持链接模式）
func Install(src, customDir, repoRoot, linkMode string) error {
	src = strings.TrimSpace(src)
	customDir = strings.TrimSpace(customDir)
	if src == "" || customDir == "" {
		return types.AppError{Code:"INVALID_PARAM", Operation:"安装模型", Reason:"参数为空", Suggestion:"请检查输入"}
	}

	// 🔒 路径清理与安全校验
	srcClean, _ := filepath.Abs(filepath.Clean(src))
	customClean, _ := filepath.Abs(filepath.Clean(customDir))

	// 验证 customDir 在 .minecraft 内（防路径穿越）
	if !isInsideMinecraft(customClean) {
		return types.AppError{Code:"INVALID_PATH", Operation:"安装模型", SourcePath:customDir, Reason:"目标目录不在 .minecraft 路径内", Suggestion:"请确保整合包的 custom 目录位于 .minecraft 内"}
	}

	// 验证 src 在仓库目录内（防任意文件写入）
	if repoRoot != "" {
		if !isInsideRepo(srcClean, repoRoot) {
			return types.AppError{Code:"INVALID_PATH", Operation:"安装模型", SourcePath:src, Reason:"源文件不在仓库目录内", Suggestion:"请确保模型文件位于已选择的仓库目录中"}
		}
	}

	ext := strings.ToLower(filepath.Ext(src))
	if strings.HasSuffix(strings.ToLower(src), ".ban") {
		ext = strings.ToLower(filepath.Ext(src[:len(src)-4]))
	}
	switch ext {
	case ".ysm", ".zip", ".7z":
	default:
		return types.AppError{Code:"UNSUPPORTED_FORMAT", Operation:"安装模型", SourcePath:src, Reason:"不支持的文件类型", Suggestion:"仅支持 .ysm / .zip / .7z 格式"}
	}

	// 计算相对路径，保持目录结构
	targetDir := customDir
	if repoRoot != "" {
		absRepo, _ := filepath.Abs(filepath.Clean(repoRoot))
		if strings.HasPrefix(strings.ToLower(src), strings.ToLower(absRepo)) {
			rel, err := filepath.Rel(absRepo, src)
			if err == nil {
				relDir := filepath.Dir(rel)
				if relDir != "." {
					targetDir = filepath.Join(customDir, relDir)
					// 再次校验子目录也在 .minecraft 内
					targetDir, _ = filepath.Abs(filepath.Clean(targetDir))
					if !isInsideMinecraft(targetDir) {
						return types.AppError{Code:"INVALID_PATH", Operation:"安装模型", SourcePath:targetDir, Reason:"子目录不在 .minecraft 路径内", Suggestion:"请确保整合包的 custom 目录位于 .minecraft 内"}
					}
				}
			}
		}
	}

	switch linkMode {
	case "hardlink":
		return linkOrCopy(src, targetDir)
	case "symlink":
		return symlinkOrCopy(src, targetDir)
	default:
		_, err := CopyFile(src, targetDir)
		return err
	}
}
// 额外校验：src 的真实路径必须在 repoRoot 内
// isInsideRepo 安全校验：确保 src 真实地位于 repoRoot 目录下
func isInsideRepo(src, repoRoot string) bool {
	absSrc, err := filepath.EvalSymlinks(filepath.Clean(src))
	if err != nil {
		return false
	}
	absRepo, err := filepath.EvalSymlinks(filepath.Clean(repoRoot))
	if err != nil {
		return false
	}
	absSrc = filepath.Clean(absSrc)
	absRepo = filepath.Clean(absRepo)

	rel, err := filepath.Rel(absRepo, absSrc)
	if err != nil {
		return false
	}
	if strings.HasPrefix(rel, "..") {
		return false
	}
	return true
}
// isInsideMinecraft 安全校验：确保 path 真实地位于 .minecraft 目录下
func isInsideMinecraft(path string) bool {
	cleaned := filepath.Clean(path)
	abs, err := filepath.EvalSymlinks(cleaned)
	if err != nil {
		// EvalSymlinks 失败时，回退到普通 Clean 路径检查
		abs = cleaned
	}
	abs = filepath.Clean(abs)

	lower := strings.ToLower(abs)
	mcMarker := strings.ToLower(string(filepath.Separator) + ".minecraft" + string(filepath.Separator))

	idx := strings.Index(lower, mcMarker)
	if idx == -1 {
		if strings.HasSuffix(lower, strings.ToLower(string(filepath.Separator)+".minecraft")) {
			return true
		}
		return false
	}

	rest := abs[idx+len(mcMarker)-1:]
	if strings.Contains(rest, "..") {
		return false
	}
	return true
}

// InstallToGlobal 安装到全局 custom 目录
func InstallToGlobal(src, mcRoot string) (string, error) {
	if src == "" || mcRoot == "" {
		return "", types.AppError{Code:"INVALID_PARAM", Operation:"安装到全局", Reason:"参数为空", Suggestion:"请检查输入"}

	}
	mcRoot, _ = filepath.Abs(filepath.Clean(mcRoot))
	if !isInsideMinecraft(mcRoot) {
		return "", types.AppError{Code:"INVALID_PATH", Operation:"安装到全局", SourcePath:mcRoot, Reason:"目标不在 .minecraft 路径内", Suggestion:"请确保 .minecraft 目录路径正确"}
	}
	src, _ = filepath.Abs(filepath.Clean(src))
	customDir := filepath.Join(mcRoot, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		return "", types.AppError{Code:"IO_ERROR", Operation:"安装到全局", TargetPath:customDir, Reason:"无法创建安装目录", Suggestion:"请检查磁盘权限或空间"}

	}
	return CopyFile(src, customDir)
}

// InstallWithOverlay 带冲突检查的安装
func InstallWithOverlay(src, customDir string) (string, error) {
	if src == "" || customDir == "" {
		return "", types.AppError{Code:"INVALID_PARAM", Operation:"安装模型（覆盖检查）", Reason:"参数为空", Suggestion:"请检查输入"}
	}
	src, _ = filepath.Abs(filepath.Clean(src))
	customDir, _ = filepath.Abs(filepath.Clean(customDir))
	if !isInsideMinecraft(customDir) {
		return "", types.AppError{Code:"INVALID_PATH", Operation:"安装模型（覆盖检查）", SourcePath:customDir, Reason:"目标目录不在 .minecraft 路径内", Suggestion:"请确保整合包的 custom 目录位于 .minecraft 内"}

	}
	ext := strings.ToLower(filepath.Ext(src))
	switch ext {
	case ".ysm", ".zip", ".7z":
	default:
		return "", types.AppError{Code:"UNSUPPORTED_FORMAT", Operation:"安装模型（覆盖检查）", SourcePath:src, Reason:"不支持的文件格式", Suggestion:"仅支持 .ysm / .zip / .7z 格式"}

	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		return "", types.AppError{Code:"IO_ERROR", Operation:"安装模型（覆盖检查）", TargetPath:customDir, Reason:"无法创建目录", Suggestion:"请检查磁盘权限或空间"}

	}
	dst := filepath.Join(customDir, filepath.Base(src))
	if _, err := os.Stat(dst); err == nil {
		return "CONFLICT:" + dst, types.AppError{Code:"ALREADY_EXISTS", Operation:"安装模型（覆盖检查）", TargetPath:dst, Reason:"文件已存在", Suggestion:"如需覆盖请先删除原文件"}
	}
	return CopyFile(src, customDir)
}

// CopyFile 复制文件到目标目录
func CopyFile(src, dstDir string) (string, error) {
	src, _ = filepath.Abs(filepath.Clean(src))
	dstDir, _ = filepath.Abs(filepath.Clean(dstDir))
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return "", err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	if src == dst {
		return dst, nil
	}
	in, err := os.Open(src)
	if err != nil {
		return "", types.AppError{Code:"IO_ERROR", Operation:"复制文件", SourcePath:src, Reason:"无法读取源文件", Suggestion:"请检查文件是否被占用或已删除"}

	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return "", types.AppError{Code:"IO_ERROR", Operation:"复制文件", TargetPath:dst, Reason:"无法创建目标文件", Suggestion:"请检查磁盘空间或权限"}
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return "", types.AppError{Code:"IO_ERROR", Operation:"复制文件", TargetPath:dst, Reason:"写入目标文件失败", Suggestion:"请检查磁盘空间或权限"}
	}
	return dst, nil
}

func linkOrCopy(src, dstDir string) error {
	src, _ = filepath.Abs(filepath.Clean(src))
	dstDir, _ = filepath.Abs(filepath.Clean(dstDir))
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	// linkOrCopy
if err := os.Link(src, dst); err != nil {
    errStr := strings.ToLower(err.Error())
    if strings.Contains(errStr, "cross-device") || strings.Contains(errStr, "different") {
        return types.AppError{
            Code:"LINK_FAILED", Operation:"安装模型",
            SourcePath:src, TargetPath:dst,
            Reason:"仓库与游戏目录在不同分区，不支持硬链接",
            Suggestion:"请在设置中切换为复制模式",
        }
    }
    if strings.Contains(errStr, "access") || strings.Contains(errStr, "permission") {
        return types.AppError{
            Code:"LINK_FAILED", Operation:"安装模型",
            SourcePath:src, TargetPath:dst,
            Reason:"权限不足，无法创建硬链接",
            Suggestion:"请以管理员身份运行，或在设置中切换为复制模式",
        }
    }
    return types.AppError{
        Code:"LINK_FAILED", Operation:"安装模型",
        SourcePath:src, TargetPath:dst,
        Reason:"硬链接失败",
        Suggestion:"请在设置中切换为复制模式",
    }
}
	return nil
}

func symlinkOrCopy(src, dstDir string) error {
	src, _ = filepath.Abs(filepath.Clean(src))
	dstDir, _ = filepath.Abs(filepath.Clean(dstDir))
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return err
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	if err := os.Symlink(src, dst); err != nil {
    errStr := strings.ToLower(err.Error())
    if strings.Contains(errStr, "access") || strings.Contains(errStr, "privilege") || strings.Contains(errStr, "permission") {
        return types.AppError{
            Code:"LINK_FAILED", Operation:"安装模型",
            SourcePath:src, TargetPath:dst,
            Reason:"创建符号链接需要管理员权限",
            Suggestion:"请以管理员身份运行，或在设置中切换为复制模式",
        }
    }
    return types.AppError{
        Code:"LINK_FAILED", Operation:"安装模型",
        SourcePath:src, TargetPath:dst,
        Reason:"符号链接失败",
        Suggestion:"请在设置中切换为复制模式",
    }
}
	return nil
}
// IsValidRepoRoot 禁止选择系统敏感目录作为仓库
func IsValidRepoRoot(path string) bool {
    abs, err := filepath.Abs(filepath.Clean(path))
    if err != nil {
        return false
    }

    // 禁止系统根目录
    forbidden := []string{
        "C:\\", "D:\\", "E:\\", "C:/", "D:/", "E:/",
        "C:\\Windows", "C:/Windows",
        "C:\\Windows\\System32", "C:/Windows/System32",
        "C:\\Program Files", "C:/Program Files",
        "C:\\Program Files (x86)", "C:/Program Files (x86)",
    }
    for _, f := range forbidden {
        if strings.EqualFold(abs, f) || strings.HasPrefix(strings.ToLower(abs)+"\\", strings.ToLower(f)+"\\") {
            return false
        }
    }

    return true
	
}