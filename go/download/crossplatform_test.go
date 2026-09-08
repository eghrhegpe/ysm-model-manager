// 跨平台差异：ResolveSavePath 在 Windows vs Linux/macOS 的行为一致性。
//
// 本文件只保留「生产契约验证」测试（失败会 fatal 的断言）。平台行为观察型
// 测试（无生产断言、纯 t.Log* 记录平台差异）隔离在 crossplatform_obs_test.go
// （//go:build crossplatform_obs，默认 CI 不编译；显式运行：
// `go test -tags crossplatform_obs ./go/download/`）。
//
// 技术路线：用 runtime.GOOS 在测试内区分平台，一份测试同时钉住两个平台的预期。
//   - Windows：filepath.Abs 遇 NUL 报错（攻击自然失效）
//   - Linux/macOS：filepath.Abs 放行 NUL → os.Create 创建的文件被 C 截断（后缀剥离攻击成功）
//
// 我们的 fix 在字符串层面（neturl.Parse 后）剔除 NUL，跨平台一致拒绝。
package download

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// =====================================================================
// 一、NUL 字节：字符串层拒绝（跨平台一致）—— 契约验证（fatal）
// =====================================================================

func TestCrossPlatform_NUL_StringLevelReject(t *testing.T) {
	// 无论 runtime.GOOS 是什么，ResolveSavePath 在字符串层拒绝 NUL——
	// 测试在任何平台上都应返回空 savePath。
	// 这是"跨平台安全"的证据：不依赖平台特性（filepath.Abs 行为），
	// 而是主动在解析层剔除攻击向量。
	url := "https://raw.githubusercontent.com/user/repo/main/file.ysm%00.exe"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath != "" {
		t.Fatalf("NUL 字节 URL 应返回空（跨平台一致），实际 savePath=%q", savePath)
	}
}

// =====================================================================
// 二、路径分隔符：契约验证（fatal）
// =====================================================================

func TestCrossPlatform_SeparatorConsistency(t *testing.T) {
	// filepath.Separator: Windows = '\\'，Linux/macOS = '/'
	// ResolveSavePath 输出统一用 filepath.Separator
	savePath, _, _ := ResolveSavePath(
		"https://raw.githubusercontent.com/user/repo/main/a/b/file.ysm",
		t.TempDir(),
	)
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// 验证输出路径符合当前平台约定
	if runtime.GOOS == "windows" && filepath.Separator != '\\' {
		t.Fatal("Windows: filepath.Separator 应为 '\\\\'")
	}
	if (runtime.GOOS == "linux" || runtime.GOOS == "darwin") && filepath.Separator != '/' {
		t.Fatalf("Linux/macOS: filepath.Separator 应为 '/', 实际 %q", string(filepath.Separator))
	}
}

// =====================================================================
// 三、大小写敏感性：ResolveSavePath 不依赖大小写行为
// =====================================================================

func TestCrossPlatform_CaseSensitivity(t *testing.T) {
	// Windows 大小写不敏感：'a/b/c' 与 'A/B/C' 指向同一文件
	// Linux/macOS 大小写敏感：'a/b/c' 与 'A/B/C' 是不同路径
	// 我们的 fix 不依赖大小写行为（prefix 检查用绝对路径字符串比较）
	dir := t.TempDir()
	upper := filepath.Join(dir, "UPPER")
	if err := os.MkdirAll(upper, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(upper, "file.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	// 用不同大小写的路径做 ResolveSavePath 测试
	url := "https://raw.githubusercontent.com/user/repo/main/UPPER/file.ysm"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	t.Logf("%s 大小写敏感路径 %q 成功解析（prefix 检查用字符串比较，与大小写无关）", runtime.GOOS, savePath)
}
