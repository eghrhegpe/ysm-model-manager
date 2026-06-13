package installer

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"ysm-model-manager/go/paths"
	"ysm-model-manager/go/types"
)

// Install 安装模型到目标目录（支持链接模式）
func Install(src, customDir, repoRoot, linkMode string) error {
	src = strings.TrimSpace(src)
	customDir = strings.TrimSpace(customDir)
	if src == "" || customDir == "" {
		return types.AppError{Code: "INVALID_PARAM", Operation: "安装模型", Reason: "参数为空", Suggestion: "请检查输入"}
	}

	// 🔒 路径清理与安全校验
	srcClean, _ := filepath.Abs(filepath.Clean(src))
	customClean, _ := filepath.Abs(filepath.Clean(customDir))

	// 验证 customDir 在 .minecraft 内（防路径穿越）
	if !paths.ContainsMinecraftMarker(customClean) {
		return types.AppError{Code: "INVALID_PATH", Operation: "安装模型", SourcePath: customDir, Reason: "目标目录不在 .minecraft 路径内", Suggestion: "请确保整合包的 custom 目录位于 .minecraft 内"}
	}

	// 验证 src 在仓库目录内（防任意文件写入）
	if repoRoot != "" {
		if err := paths.IsInside(repoRoot, srcClean); err != nil {
			return types.AppError{Code: "INVALID_PATH", Operation: "安装模型", SourcePath: src, Reason: "源文件不在仓库目录内", Suggestion: "请确保模型文件位于已选择的仓库目录中"}
		}
	}

	ext := strings.ToLower(filepath.Ext(src))
	if strings.HasSuffix(strings.ToLower(src), ".ban") {
		ext = strings.ToLower(filepath.Ext(src[:len(src)-4]))
	}
	if !types.IsSupportedExt(ext) {
		return types.AppError{Code:"UNSUPPORTED_FORMAT", Operation:"安装模型", SourcePath:src, Reason:"不支持的文件类型", Suggestion:"支持格式: " + strings.Join(types.AllExts, " / ")}
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
					if !paths.ContainsMinecraftMarker(targetDir) {
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

// InstallDir 安装整个目录下的所有文件到目标目录（支持链接模式）
// 用于 MMD/VRC 模型，.pmx/.pmd 文件所在文件夹包含纹理等配套文件
// rtype 用于过滤文件类型（如 MMD 排除 .vrm）
func InstallDir(srcDir, dstDir, repoRoot, linkMode, rtype string) error {
	srcDir = strings.TrimSpace(srcDir)
	dstDir = strings.TrimSpace(dstDir)
	if srcDir == "" || dstDir == "" {
		return types.AppError{Code: "INVALID_PARAM", Operation: "安装目录", Reason: "参数为空", Suggestion: "请检查输入"}
	}
	srcDir, _ = filepath.Abs(filepath.Clean(srcDir))
	dstDir, _ = filepath.Abs(filepath.Clean(dstDir))
	fmt.Printf("[InstallDir] srcDir=%s dstDir=%s repoRoot=%s\n", srcDir, dstDir, repoRoot)

	// 验证 dstDir 在 .minecraft 内
	if !paths.ContainsMinecraftMarker(dstDir) {
		fmt.Println("[InstallDir] FAIL: dstDir not in .minecraft:", dstDir)
		return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: dstDir, Reason: "目标目录不在 .minecraft 路径内"}
	}
	// 验证 srcDir 在仓库目录内
	if repoRoot != "" {
		if err := paths.IsInside(repoRoot, srcDir); err != nil {
			fmt.Println("[InstallDir] FAIL: srcDir not in repoRoot:", srcDir, "repoRoot:", repoRoot, "err:", err)
			return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: srcDir, Reason: "源目录不在仓库目录内"}
		}
	}
	fmt.Println("[InstallDir] path checks OK")

	// 目标子目录名 = 源文件夹名
	targetSubDir := filepath.Base(srcDir)
	finalDst := filepath.Join(dstDir, targetSubDir)
	fmt.Printf("[InstallDir] targetSubDir=%s finalDst=%s\n", targetSubDir, finalDst)
	if err := os.MkdirAll(finalDst, 0755); err != nil {
		fmt.Println("[InstallDir] FAIL: mkdir:", err)
		return types.AppError{Code: "IO_ERROR", Operation: "安装目录", TargetPath: finalDst, Reason: "无法创建目标目录"}
	}
	// 校验目标也在 .minecraft 内
	finalDst, _ = filepath.Abs(filepath.Clean(finalDst))
	if !paths.ContainsMinecraftMarker(finalDst) {
		fmt.Println("[InstallDir] FAIL: finalDst not in .minecraft:", finalDst)
		return types.AppError{Code: "INVALID_PATH", Operation: "安装目录", SourcePath: finalDst, Reason: "目标子目录不在 .minecraft 路径内"}
	}

	entries, err := os.ReadDir(srcDir)
	if err != nil {
		fmt.Println("[InstallDir] FAIL: readdir:", err)
		return err
	}
	fmt.Printf("[InstallDir] found %d entries in srcDir\n", len(entries))
	// 按类型过滤允许的文件扩展名
	isAllowed := func(name string) bool {
		low := strings.ToLower(name)
		switch rtype {
		case "mmd-skin":
			// MMD 允许 .pmx/.pmd + 纹理文件，排除 .vrm（自包含格式）
			ext := filepath.Ext(low)
			if ext == ".pmx" || ext == ".pmd" || ext == ".png" || ext == ".tga" || ext == ".spa" || ext == ".sph" {
				return true
			}
			return false
		case "ysm":
			ext := filepath.Ext(low)
			return ext == ".json" || ext == ".png" || ext == ".jpg" || ext == ".jpeg"
		default:
			return true
		}
	}
	for _, entry := range entries {
		if entry.IsDir() {
			// 递归复制子目录（MMD 模型的 spa/textures/toon 等子文件夹含材质文件）
			subSrc := filepath.Join(srcDir, entry.Name())
			subDst := filepath.Join(finalDst, entry.Name())
			fmt.Printf("[InstallDir] recurse subdir: %s -> %s\n", subSrc, subDst)
			if err := os.MkdirAll(subDst, 0755); err != nil {
				fmt.Printf("[InstallDir] mkdir subdir failed: %v (continue)\n", err)
				continue
			}
			subEntries, _ := os.ReadDir(subSrc)
			for _, se := range subEntries {
				if se.IsDir() || !isAllowed(se.Name()) {
					continue
				}
				subFile := filepath.Join(subSrc, se.Name())
				switch linkMode {
				case "hardlink":
					linkOrCopy(subFile, subDst)
				case "symlink":
					symlinkOrCopy(subFile, subDst)
				default:
					CopyFile(subFile, subDst)
				}
			}
			continue
		}
		if !isAllowed(entry.Name()) {
			continue
		}
		srcFile := filepath.Join(srcDir, entry.Name())
		fmt.Printf("[InstallDir] processing: %s (linkMode=%s)\n", srcFile, linkMode)
		switch linkMode {
		case "hardlink":
			if err := linkOrCopy(srcFile, finalDst); err != nil {
				fmt.Printf("[InstallDir] linkOrCopy failed: %v (continue)\n", err)
				continue
			}
		case "symlink":
			if err := symlinkOrCopy(srcFile, finalDst); err != nil {
				fmt.Printf("[InstallDir] symlinkOrCopy failed: %v (continue)\n", err)
				continue
			}
		default:
			if _, err := CopyFile(srcFile, finalDst); err != nil {
				continue
			}
		}
	}
	return nil
}

// InstallToGlobal 安装到全局 custom 目录
func InstallToGlobal(src, mcRoot string) (string, error) {
	if src == "" || mcRoot == "" {
		return "", types.AppError{Code:"INVALID_PARAM", Operation:"安装到全局", Reason:"参数为空", Suggestion:"请检查输入"}

	}
	mcRoot, _ = filepath.Abs(filepath.Clean(mcRoot))
	if !paths.ContainsMinecraftMarker(mcRoot) {
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
	if !paths.ContainsMinecraftMarker(customDir) {
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
