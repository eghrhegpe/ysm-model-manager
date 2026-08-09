//go:build windows

package app

import "syscall"

// getVirtualScreen 获取 Windows 虚拟屏幕边界（所有显示器合起来的矩形）
func getVirtualScreen() (x, y, w, h int) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("GetSystemMetrics")
	r, _, _ := proc.Call(76) // SM_XVIRTUALSCREEN
	x = int(r)
	r, _, _ = proc.Call(77) // SM_YVIRTUALSCREEN
	y = int(r)
	r, _, _ = proc.Call(78) // SM_CXVIRTUALSCREEN
	w = int(r)
	r, _, _ = proc.Call(79) // SM_CYVIRTUALSCREEN
	h = int(r)
	if w == 0 {
		r, _, _ = proc.Call(0) // SM_CXSCREEN
		w = int(r)
	}
	if h == 0 {
		r, _, _ = proc.Call(1) // SM_CYSCREEN
		h = int(r)
	}
	return
}
