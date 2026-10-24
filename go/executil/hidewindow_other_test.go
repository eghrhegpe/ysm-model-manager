//go:build !windows

package executil

import (
	"os/exec"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestHideWindow_OtherNoop 验证非 Windows 分支为 no-op（不 panic、不改动 Cmd）。
func TestHideWindow_OtherNoop(t *testing.T) {
	cmd := exec.Command("echo", "x")
	testutil.Nil(t, cmd.SysProcAttr, "前置假设被破坏：新建 Cmd 的 SysProcAttr 应为 nil")
	HideWindow(cmd) // 不 panic 即通过
	testutil.Nil(t, cmd.SysProcAttr, "no-op 分支不应改动 SysProcAttr")
}
