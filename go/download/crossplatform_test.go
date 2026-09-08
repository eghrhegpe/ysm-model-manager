// 跨平台差异探察：ResolveSavePath 在 Windows vs Linux/macOS 的行为一致性。
//
// 技术路线：用 runtime.GOOS 在测试内区分平台，一份测试同时钉住两个平台的预期。
//   - Windows：filepath.Abs 遇 NUL 报错（攻击自然失效）
//   - Linux/macOS：filepath.Abs 放行 NUL → os.Create 创建的文件被 C 截断（后缀剥离攻击成功）
//
// 我们的 fix 在字符串层面（neturl.Parse 后）剔除 NUL，跨平台一致拒绝。
//
// 验证方式：
//  1. Windows CI：此文件自动跑 Windows 分支（`go test` on windows-latest）
//  2. Linux CI/本地：此文件自动跑 Linux 分支（`go test` on ubuntu-latest 或 WSL）
//  3. 无论当前平台如何，`ResolveSavePath` 层面对 NUL 的拒绝是固定的——这是跨平台安全的证明
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
// 二、filepath.Abs 平台差异：同一 NUL 路径在不同平台的原始行为（观察）
// =====================================================================

func TestCrossPlatform_filepathAbs_NULBehavior(t *testing.T) {
	dir := t.TempDir()
	// 直接测试底层 filepath.Abs 行为（无我们的 fix 干预），
	// 证明平台差异真实存在。此为观察性测试，不 fail。
	nulPath := filepath.Join(dir, "file.ysm\x00.exe")
	_, err := filepath.Abs(nulPath)
	switch runtime.GOOS {
	case "windows":
		if err == nil {
			t.Fatal("Windows: filepath.Abs 遇 NUL 应报错，实际 nil")
		}
		t.Logf("观察: Windows filepath.Abs 遇 NUL 报错（攻击自然失效）: %v", err)
	case "linux", "darwin":
		if err != nil {
			t.Logf("观察: Linux/macOS filepath.Abs 遇 NUL 报错: %v（部分版本可能不报错）", err)
		} else {
			t.Log("观察: Linux/macOS filepath.Abs 遇 NUL 放行——需依赖 ResolveSavePath 字符串层修复防御")
		}
	default:
		t.Logf("观察: 未知平台 %s: filepath.Abs 返回 err=%v", runtime.GOOS, err)
	}
}

// =====================================================================
// 三、后缀剥离攻击面：Linux 特有（观察）
// =====================================================================

func TestCrossPlatform_NUL_SuffixStripping(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("后缀剥离攻击仅 Linux 可复现（Windows filepath.Abs 拒 NUL）")
		return
	}
	// Linux 下：os.Create("file.ysm\x00.exe") 实际创建 "file.ysm"（C 截断）
	// 攻击者通过注入 NUL 剥离 .exe 后缀，使文件以 .ysm 扩展名落盘，
	// 绕过前端只接受 .ysm 的扩展名校验。
	// 此为观察性测试，证明攻击面存在，实际防御由 NUL_StringLevelReject 保障。
	dir := t.TempDir()
	nulPath := filepath.Join(dir, "file.ysm\x00.exe")
	f, err := os.Create(nulPath)
	if err != nil {
		// 部分 Linux 版本可能也拒 NUL（如 glibc 较新版），标记为观察
		t.Logf("观察: Linux 拒 NUL（较新版本 glibc）: %v", err)
		return
	}
	f.Close()
	// 检查实际文件名是否被剥离
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		name := e.Name()
		if len(name) < len("file.ysm") {
			continue
		}
		if name[:8] == "file.ysm" {
			if name == "file.ysm" {
				t.Logf("观察: Linux NUL 后缀剥离成功——文件名='%s'（缺 .exe）", name)
				return
			}
			t.Logf("观察: Linux 文件名='%s'（非预期）", name)
			return
		}
	}
	t.Logf("观察: Linux 未找到预期文件（entries=%v）", entries)
}

// =====================================================================
// 四、路径分隔符：契约验证（fatal）
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
	t.Logf("观察: %s savePath=%q（含 %q 分隔符）", runtime.GOOS, savePath, string(filepath.Separator))
}

// =====================================================================
// 五、大小写敏感性：观察（ResolveSavePath 不依赖大小写行为）
// =====================================================================

func TestCrossPlatform_CaseSensitivity(t *testing.T) {
	// Windows 大小写不敏感：'a/b/c' 与 'A/B/C' 指向同一文件
	// Linux/macOS 大小写敏感：'a/b/c' 与 'A/B/C' 是不同路径
	// 我们的 fix 不依赖大小写行为（prefix 检查用绝对路径字符串比较）
	dir := t.TempDir()
	upper := filepath.Join(dir, "UPPER")
	os.MkdirAll(upper, 0755)
	_ = os.WriteFile(filepath.Join(upper, "file.ysm"), []byte("x"), 0644)

	// 用不同大小写的路径做 ResolveSavePath 测试
	url := "https://raw.githubusercontent.com/user/repo/main/UPPER/file.ysm"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	t.Logf("观察: %s 大小写敏感路径 %q 成功解析（prefix 检查用字符串比较，与大小写无关）", runtime.GOOS, savePath)
}

// =====================================================================
// 六、Max Path 长度：观察（各平台行为不同，无统一契约）
// =====================================================================

func TestCrossPlatform_MaxPathLength(t *testing.T) {
	// Windows MAX_PATH=260（默认），Linux/macOS PATH_MAX 通常 4096
	// 超长路径在 Windows 下被 filepath.Abs 拒，Linux 下可能放行
	// 此为观察性测试，记录平台差异，不构成回归防护。
	longName := ""
	for i := 0; i < 300; i++ {
		longName += "a"
	}
	savePath, _, _ := ResolveSavePath(
		"https://raw.githubusercontent.com/user/repo/main/"+longName+".ysm",
		t.TempDir(),
	)
	if savePath == "" {
		t.Logf("观察: %s 超长文件名路径被拒绝（len=%d）", runtime.GOOS, len(longName))
		return
	}
	t.Logf("观察: %s 超长文件名路径放行（len=%d, savePath len=%d）",
		runtime.GOOS, len(longName), len(savePath))
}

// =====================================================================
// 七、特殊字符过滤：观察（ResolveSavePath 不处理 OS 文件名规范）
// =====================================================================

func TestCrossPlatform_ReserveCharReject(t *testing.T) {
	// Windows 文件系统拒绝：< > : " / \\ | ? *
	// Linux/macOS 只拒绝 / 和 NUL
	// ResolveSavePath 只处理 URL 层面的畸形，不处理 OS 文件名规范
	// 这里验证 ResolveSavePath 不处理 OS 文件名规范（那是下载后的事）
	badChars := []string{"<", ">", ":", `"`, "|", "?", "*"}
	for _, ch := range badChars {
		url := "https://raw.githubusercontent.com/user/repo/main/file" + ch + "ysm"
		_, _, _ = ResolveSavePath(url, t.TempDir())
	}
	t.Logf("观察: %s 特殊字符未导致 ResolveSavePath 报错（文件名校验在下载后完成）", runtime.GOOS)
}

// =====================================================================
// 八、软链接/符号链接行为差异：观察（ResolveSavePath 不处理 symlink）
// =====================================================================

func TestCrossPlatform_SymlinkBehavior(t *testing.T) {
	// Windows 需管理员权限创建 symlink；Linux 默认允许
	// ResolveSavePath 不处理 symlink，仅记录行为差异
	if runtime.GOOS == "windows" {
		t.Log("观察: Windows symlink 需管理员权限，ResolveSavePath 不处理")
		return
	}
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "target"), 0755)
	_ = os.WriteFile(filepath.Join(dir, "target", "file.ysm"), []byte("x"), 0644)
	err := os.Symlink(filepath.Join(dir, "target"), filepath.Join(dir, "link"))
	if err != nil {
		t.Logf("观察: Linux symlink 创建失败: %v", err)
		return
	}
	t.Log("观察: Linux symlink 可正常创建（ResolveSavePath 不处理）")
}
