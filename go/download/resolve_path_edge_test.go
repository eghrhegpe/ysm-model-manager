//go:build !android

// 边界/攻击面探察：ResolveSavePath 的畸形输入。
// 只读源码 (go/download/download.go)，发现问题用 t.Log 标记，不修改源码。
package download

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode"
	"ysm-model-manager/go/internal/testutil"
)

// 辅助：构造超长路径字符串
func strN(s string, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteString(s)
	}
	return b.String()
}

// ---------- 1. URL 带 query string ----------
func TestResolveSavePath_QueryString(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/file.ysm?token=abc123&x=1"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// FIXED(BUG-1): query string 必须被剥离
	if strings.Contains(savePath, "?") {
		t.Fatalf("query string 未被剥离，savePath 含 '?': %s", savePath)
	}
	if strings.Contains(jsd, "?") || strings.Contains(api, "?") {
		t.Fatalf("jsdURL/apiURL 保留了 query 字符: %s / %s", jsd, api)
	}
	t.Logf("FIXED(BUG-1): query stripped OK: savePath=%q", savePath)
}

// ---------- 2. URL 带 fragment ----------
func TestResolveSavePath_Fragment(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/file.ysm#section-2"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// FIXED(BUG-2): fragment '#' 必须被剥离
	if strings.Contains(savePath, "#") {
		t.Fatalf("fragment '#' 未被剥离，savePath 含 '#': %s", savePath)
	}
	t.Logf("FIXED(BUG-2): fragment stripped OK: savePath=%q", savePath)
}

// ---------- 3. URL 无 main/master 分支 ----------
// ---------- 3b. 非 main/master 分支的 raw URL：结构化解析拿完整相对路径 ----------

// raw.githubusercontent.com/{owner}/{repo}/{branch}/{path} 是固定四段式，
// 分支名任意（dev/develop/release/1.0 等）都应解析出完整 relPath 与带正确
// 分支的 jsd/api 回退源，而不是退化为仅文件名（历史行为：只枚举 /main/ /master/）。
func TestResolveSavePath_DevBranch(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/dev/a/b/file.ysm"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	if !strings.HasSuffix(savePath, filepath.Join("a", "b", "file.ysm")) {
		t.Fatalf("dev 分支应解析完整相对路径 a/b/file.ysm，实际 savePath: %s", savePath)
	}
	if jsd == "" || !strings.Contains(jsd, "@dev/") {
		t.Fatalf("jsd 回退源应带 @dev 分支: %q", jsd)
	}
	if api == "" {
		t.Fatal("api 回退源不应为空")
	}
}

func TestResolveSavePath_NoMainMaster(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/release/1.0/file.ysm"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	if !strings.HasSuffix(savePath, "file.ysm") && !strings.HasSuffix(savePath, "1.0/file.ysm") {
		t.Fatalf("unexpected savePath: %s", savePath)
	}
	// 无分支时，jsd/api 构造失败 —— 当前行为就是空
	if jsd != "" || api != "" {
		t.Log("INFO(3): 无分支 URL 意外得到 jsd/api URL，可能绕过默认分支策略", jsd, api)
	} else {
		t.Log("INFO(3): 无 main/master 分支的 URL 只能拿到 savePath，jsd/api 为空（当前行为），无法回退下载")
	}
}

// ---------- 4. 非 raw.githubusercontent.com 来源 ----------
func TestResolveSavePath_NonGitHub(t *testing.T) {
	url := "https://cdn.example.com/path/to/file.ysm"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	if !strings.HasSuffix(savePath, "file.ysm") {
		t.Fatalf("unexpected savePath: %s", savePath)
	}
	if jsd != "" || api != "" {
		t.Log("INFO(4): 非 GitHub 来源意外得到 jsd/api URL", jsd, api)
	} else {
		t.Log("INFO(4): 非 GitHub 来源，jsd/api 为空（当前行为），无回退源")
	}
}

// ---------- 5. URL 含 %2f 混合编码的伪穿越 ----------
func TestResolveSavePath_PctEncodedTraversal(t *testing.T) {
	// neturl.Parse 会解码 %2f → /，filepath.Clean 随后解析 .. 上溯目录，
	// prefix 检查拦截越界——跨平台一致。
	url := "https://raw.githubusercontent.com/user/repo/main/a/..%2f..%2fetc/passwd"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath != "" {
		t.Fatalf("FIXED(跨平台): %%2f 编码穿越应被拒绝，实际 savePath=%q", savePath)
	}
	t.Log("FIXED(跨平台): 编码穿越被 neturl.Parse+prefix 检查拦截")
}

// ---------- 6. URL 含 NUL 字节 (%00) ----------
func TestResolveSavePath_NUL(t *testing.T) {
	// 跨平台差异：Windows filepath.Abs 遇 NUL 报错（攻击失效）；
	// Linux/macOS filepath.Abs 放行，但 os.Create("file.ysm\x00.exe") 创建的是 "file.ysm"
	// （C 字符串以 NUL 截断），攻击者剥离任意后缀绕过前端扩展名校验。
	// ResolveSavePath 主动剔除 NUL，跨平台一致拒绝。
	url := "https://raw.githubusercontent.com/user/repo/main/file.ysm%00.exe"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath != "" {
		t.Fatalf("FIXED(BUG-6, 跨平台): NUL 字节 URL 应返回空，实际 savePath=%q", savePath)
	}
	t.Log("FIXED(BUG-6, 跨平台): NUL 注入被拒绝（跨平台一致行为）")
}

// ---------- 7. Unicode 同形字符 (Cyrillic 'і' 代替 'i') ----------
func TestResolveSavePath_UnicodeLookalike(t *testing.T) {
	// 使用 Cyrillic 小写 i (U+0456) —— 与 ASCII 'i' 视觉相同
	url := "https://raw.githubusercontent.com/user/repo/main/f\u0456le.ysm"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	t.Logf("INFO(7): savePath 含同形 Unicode 字符: %q", savePath)
	// 验证 savePath 中是否含有非 ASCII 字符
	for _, r := range savePath {
		if r > unicode.MaxASCII {
			t.Log("TODO(BUG-7): savePath 包含非 ASCII 同形字符，可能绕过前端/文件系统过滤:", savePath)
			break
		}
	}
}

// ---------- 8. URL 路径含 .git 目录 ----------
func TestResolveSavePath_GitDotdir(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/.git/config"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath for .git/config")
	}
	// FIXED(BUG-8): .git/ 前缀必须被剔除，不能下载仓库配置
	if strings.Contains(savePath, ".git") {
		t.Fatalf("FIXED(BUG-8): .git/ 子路径未被 strip，保存路径含 .git: %s", savePath)
	}
	t.Logf("FIXED(BUG-8): .git/ stripped OK: savePath=%q", savePath)
}

// ---------- 9. URL 含 %00 + 路径穿越组合 ----------
func TestResolveSavePath_Pct00Traversal(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main/../../etc/%00passwd"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Log("INFO(9): %00 + 穿越返回空")
		return
	}
	t.Logf("INFO(9): savePath=%q", savePath)
}

// ---------- 10. 超长 URL (>>32k) ----------
func TestResolveSavePath_SuperLong(t *testing.T) {
	// 32000+ 字符的 path 片段，逼近/超过 Windows MAX_PATH
	longSegment := strN("a/", 4000) // 8000 chars
	url := "https://raw.githubusercontent.com/user/repo/main/" + longSegment + "file.ysm"
	t.Logf("INFO(10): URL len=%d", len(url))
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath != "" {
		t.Logf("INFO(10): 超长 URL 成功返回 savePath len=%d（可能超过 MAX_PATH 但 Windows 接受 UTF-8 转义路径）", len(savePath))
	} else {
		t.Log("INFO(10): 超长 URL 返回空（可能被 filepath.Abs 拒绝）")
	}
}

// ---------- 11. 连续多斜杠 ----------
func TestResolveSavePath_MultipleSlashes(t *testing.T) {
	url := "https://raw.githubusercontent.com/user/repo/main///a//b///file.ysm"
	savePath, _, _ := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// 检查是否被 Clean 归一化
	if strings.Contains(savePath, "//") {
		t.Log("TODO(BUG-11): 连续多斜杠未被归一化", savePath)
		return
	}
	t.Logf("INFO(11): Clean 归一化 OK: %q", savePath)
}

// ---------- 12. saveDir 越界 ----------
func TestResolveSavePath_SaveDirOutside(t *testing.T) {
	// saveDir 本身越界到 /tmp/outside 时，savePath 自然落在该目录下，prefix 检查会通过
	saveDir := t.TempDir()
	// 用正常 URL + 正常 saveDir 验证边界：saveDir 与 savePath 严格前缀匹配
	url := "https://raw.githubusercontent.com/user/repo/main/a.ysm"
	savePath, _, _ := ResolveSavePath(url, saveDir)
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	if savePath == saveDir {
		t.Fatal("savePath must not equal saveDir (only possible when relPath empty)")
	}
	t.Logf("INFO(12): prefix 检查允许 savePath 在 saveDir 内: %q", savePath)
}

// ---------- 13. 边界：main 出现在 query 中 ----------
func TestResolveSavePath_MainInQuery(t *testing.T) {
	// "/main/" 出现在 query string 而非 path —— 不应被当作分支标记
	url := "https://raw.githubusercontent.com/user/repo/stable/file.ysm?/main/x"
	savePath, jsd, api := ResolveSavePath(url, t.TempDir())
	if savePath == "" {
		t.Fatal("expected non-empty savePath")
	}
	// FIXED(BUG-13): query 中的 "/main/" 不能被误判为分支
	if jsd != "" && strings.Contains(jsd, "@main/") {
		t.Fatalf("FIXED(BUG-13): query 中的 '/main/' 被误当作分支，jsdURL 异常: %s", jsd)
	}
	if api != "" && strings.Contains(api, "main") {
		t.Fatalf("FIXED(BUG-13): query 中的 '/main/' 被误当作分支，apiURL 异常: %s", api)
	}
	// relPath 必须来自 URL path（file.ysm），不含 query
	if strings.Contains(savePath, "/main/") || strings.Contains(savePath, "/main") {
		t.Fatalf("relPath 含 query 片段: %s", savePath)
	}
	t.Logf("FIXED(BUG-13): query 中 '/main/' 未误判分支: savePath=%q", savePath)
}

// ---------- 14. #8 回收站：.recycle 段剔除（含嵌套 + 大小写变体） ----------
func TestResolveSavePath_RecycleStrip(t *testing.T) {
	cases := []struct {
		url  string
		name string // 期望最终文件名（不含 .recycle 段）
	}{
		{"https://raw.githubusercontent.com/user/repo/main/.recycle/foo.ysm", "foo.ysm"},
		{"https://raw.githubusercontent.com/user/repo/main/models/.recycle/foo.ysm", "foo.ysm"},
		{"https://raw.githubusercontent.com/user/repo/main/models/.Recycle/foo.ysm", "foo.ysm"},
		{"https://raw.githubusercontent.com/user/repo/main/.RECYCLE/sub/foo.ysm", "foo.ysm"},
	}
	for _, c := range cases {
		savePath, _, _ := ResolveSavePath(c.url, t.TempDir())
		if savePath == "" {
			t.Fatalf("URL %q 应解析出非空 savePath", c.url)
		}
		// 下载文件不得落盘到 .recycle 子树（scanner/dedup/sync 视其为回收站，
		// Empty() 会 RemoveAll 清除——#8 回收站误删同类风险）
		if strings.EqualFold(filepath.Base(savePath), ".recycle") ||
			strings.Contains(strings.ToLower(savePath), ".recycle") {
			t.Fatalf("savePath 仍含 .recycle 段: %q (URL %q)", savePath, c.url)
		}
		if filepath.Base(savePath) != c.name {
			t.Fatalf("savePath 基名 = %q, want %q (URL %q)", filepath.Base(savePath), c.name, c.url)
		}
	}
}

// TestResolveSavePath_RecycleOnlyPath_Rejected
// URL 路径整体是 .recycle（无实际文件）→ 剔除后为空 → 拒绝返回空。
func TestResolveSavePath_RecycleOnlyPath_Rejected(t *testing.T) {
	savePath, _, _ := ResolveSavePath(
		"https://raw.githubusercontent.com/user/repo/main/.recycle", t.TempDir())
	if savePath != "" {
		t.Fatalf("纯 .recycle 路径应被拒绝，实际 savePath=%q", savePath)
	}
}

// ---------- 15. ResolveSavePath 错误分支 ----------
func TestResolveSavePath_SaveDirIsFile(t *testing.T) {
	// MkdirAll 失败分支：saveDir 是普通文件 → 返回全空
	dir := t.TempDir()
	filePath := filepath.Join(dir, "not-a-dir")
	if err := os.WriteFile(filePath, []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	savePath, jsd, api := ResolveSavePath(
		"https://raw.githubusercontent.com/user/repo/main/a.ysm", filePath)
	if savePath != "" || jsd != "" || api != "" {
		t.Fatalf("saveDir 是普通文件时应返回全空，实际 savePath=%q jsd=%q api=%q",
			savePath, jsd, api)
	}
}

func TestResolveSavePath_InvalidURL(t *testing.T) {
	// neturl.Parse 失败分支：非法 % 转义 → 返回全空
	savePath, jsd, api := ResolveSavePath(
		"https://raw.githubusercontent.com/%zz", t.TempDir())
	if savePath != "" || jsd != "" || api != "" {
		t.Fatalf("非法 URL 应返回全空，实际 savePath=%q jsd=%q api=%q",
			savePath, jsd, api)
	}
}

// ---------- 15b. 畸形 raw URL：结构化解析失败 → 无 jsd/api 回退源 ----------
// 固化行为：四段式结构化解析失败的 raw URL（尾斜杠/双斜杠/缺文件路径）只产出
// savePath，不生成 jsd/api 回退源（repoPath 为空）。此前 repoPath 提取块不可达
// 已删除，此测试防后续误判为回归。
func TestResolveSavePath_MalformedRawNoFallback(t *testing.T) {
	cases := []string{
		"https://raw.githubusercontent.com/user/repo/main/",     // 尾斜杠
		"https://raw.githubusercontent.com/user/repo//file.ysm", // 双斜杠
		"https://raw.githubusercontent.com/user/repo/main",      // 缺文件路径
	}
	for _, u := range cases {
		savePath, jsd, api := ResolveSavePath(u, t.TempDir())
		if savePath == "" {
			t.Errorf("畸形 raw URL 应仍产出 savePath: %s", u)
		}
		if jsd != "" || api != "" {
			t.Errorf("畸形 raw URL 不应生成 jsd/api 回退源: %s → jsd=%q api=%q", u, jsd, api)
		}
	}
}

// ---------- 16. isBinaryContentType 纯函数表驱动 ----------
func TestIsBinaryContentType_Table(t *testing.T) {
	cases := []struct {
		ct   string
		want bool
	}{
		{"", true},                                       // 空 Content-Type（HTTP/1.0）放行
		{"text/html", false},                             // 404 错误页
		{"text/html; charset=utf-8", false},              // 带参数的 HTML
		{"TEXT/HTML; CHARSET=UTF-8", false},              // 大小写不敏感
		{"application/xhtml+xml", false},                 // XHTML 错误页
		{"application/xml", false},                       // 反向代理 XML 错误页
		{"text/xml", false},                              // 纯 XML 错误页
		{"text/plain", true},                             // 文本文件放行（.ysm 配置等）
		{"application/json", true},                       // JSON 放行
		{"application/octet-stream", true},               // 二进制放行
		{"image/png", true},                              // 图片放行
		{"Application/Json", true},                       // 大小写不敏感放行
		{" application/octet-stream ; charset=x ", true}, // 首尾空白 + 参数剥离
	}
	for _, c := range cases {
		if got := isBinaryContentType(c.ct); got != c.want {
			t.Errorf("isBinaryContentType(%q) = %v, want %v", c.ct, got, c.want)
		}
	}
}
