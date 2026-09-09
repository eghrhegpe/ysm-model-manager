package executil

import (
	"os/exec"
	"runtime"
	"testing"
)

// TestHideWindow_NonWindows_IsNoop 非 Windows 平台验证 HideWindow 不 panic、cmd 仍可执行。
func TestHideWindow_NonWindows_IsNoop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("仅 Unix/Linux/macOS 平台")
	}
	cmd := exec.Command("echo", "ok")
	// 调用应为 no-op，不应 panic
	HideWindow(cmd)
	if cmd == nil {
		t.Fatal("cmd 不应为 nil")
	}
	// 实际执行验证 cmd 仍然可用
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("执行 echo 失败: %v", err)
	}
	got := string(out)
	if got != "ok\n" {
		t.Fatalf("输出 %q，期望 %q", got, "ok\n")
	}
}

// TestHideWindow_Windows_SetsSysProcAttr Windows 平台验证 SysProcAttr.HideWindow 被设为 true。
func TestHideWindow_Windows_SetsSysProcAttr(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows 平台")
	}
	cmd := exec.Command("echo", "test")
	HideWindow(cmd)
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr 应为非 nil")
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Fatal("SysProcAttr.HideWindow 应为 true")
	}
}

// TestHideWindow_NilCmdNoPanic 验证 nil cmd 输入跨平台安全（no-op，不 panic）：
// 原 Windows 平台会解引用 nil panic，已加 nil guard（hidewindow_windows.go 头注释），两平台语义对齐。
func TestHideWindow_NilCmdNoPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("HideWindow(nil) 不应 panic（nil guard 失效）: %v", r)
		}
	}()
	var cmd *exec.Cmd
	HideWindow(cmd)
}
