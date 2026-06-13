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
func IsInside(baseDir, path string) error {
	absBase, err := filepath.Abs(filepath.Clean(baseDir))
	if err != nil {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "无法解析基准路径: " + err.Error()}
	}
	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "无法解析目标路径: " + err.Error()}
	}

	rel, err := filepath.Rel(absBase, absPath)
	if err != nil {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "计算相对路径失败: " + err.Error()}
	}
	if strings.HasPrefix(rel, "..") || rel == ".." {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "路径不在基准目录内"}
	}
	// 大小写不敏感检查（Windows 路径不区分大小写）
	basePrefix := strings.ToLower(absBase) + string(filepath.Separator)
	if !strings.EqualFold(absPath, absBase) && !strings.HasPrefix(strings.ToLower(absPath), basePrefix) {
		return &ErrPathEscalation{Path: path, BaseDir: baseDir, Reason: "路径不在基准目录内"}
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
