//go:build !windows

package avatar

import "os/exec"

// hideWindow 非 Windows no-op（Unix 无控制台窗口概念）
func hideWindow(cmd *exec.Cmd) {}
