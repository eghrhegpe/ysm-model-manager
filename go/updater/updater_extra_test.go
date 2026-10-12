// ===== go/updater 补充单测 =====
package updater

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ====== assetPattern ======

func TestAssetPattern_Windows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	pattern := assetPattern()
	if !strings.HasPrefix(pattern, "YSM-Model-Manager_windows_") {
		t.Errorf("期望 windows 前缀, 得到 %q", pattern)
	}
	if !strings.HasSuffix(pattern, ".exe") {
		t.Errorf("期望 .exe 结尾（纯 exe 发布）, 得到 %q", pattern)
	}
}

func TestAssetPattern_NonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("仅非 Windows")
	}
	pattern := assetPattern()
	if !strings.HasPrefix(pattern, "YSM-Model-Manager_") {
		t.Errorf("期望标准前缀, 得到 %q", pattern)
	}
	if !strings.HasSuffix(pattern, ".tar.gz") {
		t.Errorf("期望 .tar.gz 结尾, 得到 %q", pattern)
	}
}

// ====== CleanupOldVersion ======

func TestCleanupOldVersion_NoFile(t *testing.T) {
	// 无 .old 文件 → 静默成功
	CleanupOldVersion()
}

func TestCleanupOldVersion_WithFile(t *testing.T) {
	// 在 exe 同目录创建 .old 文件 → 应被清理
	exe, err := os.Executable()
	if err != nil {
		t.Skip("无法获取可执行路径")
	}
	oldPath := exe + ".old"
	if err := os.WriteFile(oldPath, []byte("old version"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	defer os.Remove(oldPath)

	CleanupOldVersion()

	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Error(".old 文件应已被删除")
	}
}

// ====== InstallUpdate ======

func TestInstallUpdate_NonWindows(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("非 Windows 专用测试")
	}
	err := InstallUpdate("/tmp/fake.zip")
	testutil.NotNil(t, err, "非 Windows 平台应报错")
	if !strings.Contains(err.Error(), "仅支持 Windows") {
		t.Errorf("错误信息应提示仅支持 Windows, 得到: %v", err)
	}
}

func TestInstallUpdate_BadExe(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("仅 Windows")
	}
	dir := t.TempDir()
	badExe := filepath.Join(dir, "bad.exe")
	if err := os.WriteFile(badExe, []byte("not a PE binary"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	err := InstallUpdate(badExe)
	testutil.NotNil(t, err, "坏 exe 应报错")
}
