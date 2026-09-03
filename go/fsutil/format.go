package fsutil

import (
	"fmt"
	"os"
)

// FormatSize 人性化字节大小（B/KB/MB/GB 分级）。
// 单一事实来源——cli/repoaudit 的 formatSize 均委托本函数，防多处实现口径漂移。
func FormatSize(bytes int64) string {
	switch {
	case bytes < 1024:
		return fmt.Sprintf("%dB", bytes)
	case bytes < 1024*1024:
		return fmt.Sprintf("%.1fKB", float64(bytes)/1024)
	case bytes < 1024*1024*1024:
		return fmt.Sprintf("%.1fMB", float64(bytes)/(1024*1024))
	default:
		return fmt.Sprintf("%.1fGB", float64(bytes)/(1024*1024*1024))
	}
}

// FileSize 安全取文件大小（Stat 失败返回 0）。
// 收敛点：instance/sync_dirlevel 曾各自实现同款 os.Stat 样板（锐评 #17），统一委托本函数。
func FileSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}
