//go:build windows

package executil

import (
	"os/exec"
	"syscall"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestHideWindow_Windows 验证 Windows 分支设置 HideWindow 标志（ADR-003 下沉收敛）。
func TestHideWindow_Windows(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "exit")
	testutil.Nil(t, cmd.SysProcAttr, "前置假设被破坏：新建 Cmd 的 SysProcAttr 应为 nil")
	HideWindow(cmd)
	testutil.NotNil(t, cmd.SysProcAttr, "HideWindow 后 SysProcAttr 不应为 nil")
	// NotNil 前置守卫已通过（失败即弃权），此处解引用安全
	testutil.Equal(t, cmd.SysProcAttr.HideWindow, true, "HideWindow 后 SysProcAttr.HideWindow 应为 true")
	// 幂等：重复调用不 panic、标志保持
	HideWindow(cmd)
	testutil.Equal(t, cmd.SysProcAttr.HideWindow, true, "重复调用 HideWindow 后标志应保持 true")
}

// TestHideWindow_ExistingAttr 验证不覆盖调用方已设置的 SysProcAttr 字段。
func TestHideWindow_ExistingAttr(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "exit")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: "keep"}
	HideWindow(cmd)
	testutil.Equal(t, cmd.SysProcAttr.CmdLine, "keep", "HideWindow 不应覆盖已设置的 CmdLine")
	// 调用方已设置非 nil SysProcAttr，解引用安全
	testutil.Equal(t, cmd.SysProcAttr.HideWindow, true, "HideWindow 应叠加设置 HideWindow 标志")
}
