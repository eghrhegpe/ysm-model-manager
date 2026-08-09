//go:build !windows

package app

import "os/exec"

// hideWindow 非 Windows no-op（Unix 无控制台窗口概念，对齐 go/fileops 同名抽象）
func hideWindow(cmd *exec.Cmd) {}
