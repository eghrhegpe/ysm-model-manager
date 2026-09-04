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
// 收敛点：instance/sync_dirlevel 曾各自实现同款 os.Stat 样板，统一委托本函数。
func FileSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}

// TruncateWidth 按显示宽度预算截断字符串（省略号 "…" 占 1 个宽度位）。
// 按 rune 计数——CJK 组名/预览名是常态（如 "模型" 6 字节 2 rune），字节截断会
// 把 rune 切半输出非法 UTF-8。len(runes) <= width 返回原串；
// 超宽取 runes[:width-1] + "…"，保证总宽 ≤ width。
// 收敛自 cli/resource.go 私有 truncate（表格列宽语义）。
// 防御：width <= 0 返回空串（原 cli 版 width=0 会 panic on runes[:-1]，收编时修复）。
func TruncateWidth(s string, width int) string {
	if width <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= width {
		return s
	}
	return string(r[:width-1]) + "…"
}

// TruncateLimit 按 rune 上限截断字符串（省略号 "..." 追加超出预算，不占上限位）。
// 与 TruncateWidth 语义不同：本函数 limit 是「内容硬上限」——超限取 runes[:limit]
// 后追加 "..."，输出可达 limit+3；limit <= 0 时返回 "..."（截空 + 省略号，不 panic）。
// 收敛自 ysm/summary.go 私有 truncate（Tips 内容上限语义：max=0 用例锁定返回 "..."）。
func TruncateLimit(s string, limit int) string {
	if limit < 0 {
		limit = 0
	}
	r := []rune(s)
	if len(r) <= limit {
		return s
	}
	return string(r[:limit]) + "..."
}
