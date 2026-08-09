//go:build windows

package app

import (
	"os/exec"
	"syscall"
)

// hideWindow 隐藏子进程控制台窗口（Windows 专属，对齐 go/fileops 同名抽象）
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
