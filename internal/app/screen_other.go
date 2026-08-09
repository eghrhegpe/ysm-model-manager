//go:build !windows

package app

// getVirtualScreen 非 Windows stub：无 user32 API，返回零值。
// 窗口位置恢复为 Windows 专属能力（双屏虚拟屏幕语义），非 Windows 上
// SaveWindowPosition 的 safePct 以 total<=0 回落 50%，GetWindowPosition
// 因 vw/vh=0 跳过屏幕变化重算、走默认 100,100——功能退化可接受（ADR-046）。
func getVirtualScreen() (x, y, w, h int) {
	return 0, 0, 0, 0
}
