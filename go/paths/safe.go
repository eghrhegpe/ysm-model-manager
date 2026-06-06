package paths

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ErrPathEscalation 路径越权错误
type ErrPathEscalation struct {
	Path    string
	BaseDir string
	Reason  string
}

func (e *ErrPathEscalation) Error() string {
	return fmt.Sprintf("路径越权: %s 不在 %s 目录下 (%s)", e.Path, e.BaseDir, e.Reason)
}

// IsInside 检查 path 是否在 baseDir 下，防止路径遍历。
// 使用 filepath.EvalSymlinks 解析符号链接，比 filepath.Abs 更安全。
// 返回 nil 表示安全，否则返回 ErrPathEscalation。
func IsInside(baseDir, path string) error {
	absBase, err := filepath.Abs(filepath.Clean(baseDir))
	if err != nil {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "无法解析基准路径: " + err.Error()}
	}
	absPath, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		// EvalSymlinks 失败（如文件不存在），回退到 Abs
		absPath, err = filepath.Abs(filepath.Clean(path))
		if err != nil {
			return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "无法解析目标路径: " + err.Error()}
		}
	}
	absBase = filepath.Clean(absBase)
	absPath = filepath.Clean(absPath)

	rel, err := filepath.Rel(absBase, absPath)
	if err != nil {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "计算相对路径失败: " + err.Error()}
	}
	if strings.HasPrefix(rel, "..") || rel == ".." {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "路径不在基准目录内"}
	}
	// 额外检查：绝对路径必须真的以 baseDir 开头（防 Unix 符号链接绕过）
	if !strings.HasPrefix(absPath, absBase+string(filepath.Separator)) && absPath != absBase {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "符号链接绕过了基准目录"}
	}
	return nil
}

// ContainsMinecraftMarker 检查路径中是否包含 .minecraft 标记
func ContainsMinecraftMarker(path string) bool {
	cleaned := filepath.Clean(path)
	lower := strings.ToLower(cleaned)
	mcMarker := strings.ToLower(string(filepath.Separator) + ".minecraft" + string(filepath.Separator))
	if strings.Contains(lower, mcMarker) {
		return true
	}
	if strings.HasSuffix(lower, strings.ToLower(string(filepath.Separator)+".minecraft")) {
		return true
	}
	return false
}
