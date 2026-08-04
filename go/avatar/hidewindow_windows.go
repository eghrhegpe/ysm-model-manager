//go:build windows

package avatar

import (
	"os/exec"
	"syscall"
)

// hideWindow 隐藏子进程控制台窗口（Windows 专属）
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
