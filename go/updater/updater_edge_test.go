// 对抗测试：updater 裸 exe 安装 / HTTP 下载安全边界
// 重点：PE 魔数校验、HTTP 重定向跟随、Content-Type/Content-Range 防御、哈希校验
package updater

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// =====================================================================
// InstallUpdate 安全边界（v1.13.0 起裸 exe 直装）
// =====================================================================

// ---------- 1. 更新包含非 PE 文件（无 MZ 魔数）----------
func TestInstallUpdate_InvalidPE(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows only")
		return
	}
	tmpDir := t.TempDir()

	// 直接写一个非 PE 内容的更新包文件（裸 exe 发布，无 zip 环节）
	exePath := filepath.Join(tmpDir, "YSM-Model-Manager_windows_amd64.exe")
	if err := os.WriteFile(exePath, []byte("NOT_A_PE_FILE"), 0644); err != nil {
		t.Fatal(err)
	}

	err := InstallUpdate(exePath)
	if err == nil {
		t.Fatal("InstallUpdate 应拒绝非 PE 文件")
	}
	if !strings.Contains(err.Error(), "有效 Windows 程序") {
		t.Errorf("错误信息应提示 PE 校验失败: %v", err)
	}
}

// =====================================================================
// Download / downloadOnce HTTP 安全边界
// =====================================================================

// ---------- 2. HTTP 302 重定向跟随 ----------
func TestDownloadOnce_RedirectFollowing(t *testing.T) {
	// 目标服务器
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write([]byte("target-content"))
	}))
	defer target.Close()

	// 重定向服务器
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer proxy.Close()

	path, err := downloadOnce(proxy.URL, "", nil)
	if err != nil {
		t.Logf("INFO(INFO-REDIRECT): downloadOnce 拒绝重定向: %v", err)
		return
	}
	// 先读后删（3-3 修复）：原实现先 os.Remove 再 ReadFile，检测分支读到的恒为空文件，
	// BUG 探测永不触发。302 跟随是 GitHub CDN 下载的必需行为（BrowserDownloadURL
	// 普遍 302 到 objects.githubusercontent.com），安全防线是 expectedHash 哈希校验
	// 而非拒绝重定向——故保持 INFO 记录而非断言失败（拒绝会破坏真实更新下载）。
	data, _ := os.ReadFile(path)
	os.Remove(path)
	if string(data) == "target-content" {
		t.Logf("BUG(INFO-REDIRECT): downloadOnce 跟随 302 重定向，写入了目标内容——攻击者可通过恶意源将更新包替换为任意文件")
	}
}

// ---------- 3. Content-Type 非二进制（HTML 错误页）----------
func TestDownloadOnce_HTMLContentType(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte("<html><body>Error 404</body></html>"))
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		t.Logf("FIXED(BUG-INFO-CT): downloadOnce 拒绝 HTML Content-Type: %v", err)
		return
	}
	t.Error("BUG(INFO-CT): downloadOnce 接受 HTML Content-Type——未修复")
}

// ---------- 4. Content-Range 部分响应 ----------
func TestDownloadOnce_PartialContent(t *testing.T) {
	// httptest 自动设 Content-Type: text/plain（会被 HTML 检查先行拦截）。
	// 用 application/octet-stream 绕过 HTML 检查，专门触发 Content-Range 分支。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Range", "bytes 0-9/1000")
		w.Write([]byte("partial-data"))
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		if strings.Contains(err.Error(), "Content-Range") || strings.Contains(err.Error(), "部分响应") {
			t.Logf("FIXED(BUG-INFO-RANGE): downloadOnce 拒绝 Content-Range: %v", err)
		} else {
			t.Logf("FIXED/INFO(INFO-RANGE): downloadOnce 拒绝: %v", err)
		}
		return
	}
	t.Error("BUG(INFO-RANGE): downloadOnce 接受 200+Content-Range 部分响应——未修复")
}

// =====================================================================
// fetchExpectedHash 安全边界
// =====================================================================

// ---------- 5. SHA256SUMS 注入（换行符 / 畸形行）----------
func TestFetchExpectedHash_MalformedSums(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(
			"deadbeef  YSM-Model-Manager.exe\n" +
				"INVALID_LINE_NO_HASH\n" +
				"\n" +
				"aabbccdd  evil.exe\n",
		))
	}))
	defer server.Close()

	hash, err := fetchExpectedHash(server.URL, "YSM-Model-Manager.exe")
	if err != nil {
		t.Logf("FIXED/INFO(INFO-SUMS): fetchExpectedHash malformed: %v", err)
		return
	}
	if hash != "deadbeef" {
		t.Logf("INFO(INFO-SUMS): fetchExpectedHash 返回 hash=%q（畸形行未导致 panic）", hash)
	}
}

// ---------- 6. SHA256SUMS NUL 字节注入 ----------
// Go strings.Fields 以空白分割，"\x00" 不是空白，保留在 parts[1] 中。
// Go strings.EqualFold 按字节逐一比较，"\x00" 不等于空字符串（不做 C 截断）。
// 因此 fetchExpectedHash 无 NUL 注入漏洞——跨行攻击无效。
func TestFetchExpectedHash_NULInjection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("deadbeef  safe.exe\x00malicious.txt\nevilhash  YSM-Model-Manager.exe\n"))
	}))
	defer server.Close()

	hash, err := fetchExpectedHash(server.URL, "YSM-Model-Manager.exe")
	if err != nil {
		t.Logf("INFO(INFO-NUL-SUMS): fetchExpectedHash NUL 注入: %v", err)
		return
	}
	if hash == "evilhash" {
		t.Log("FIXED/INFO(INFO-NUL-SUMS): fetchExpectedHash 正确返回 evilhash——" +
			"Go strings.Fields 保留 NUL 在 parts[1]，EqualFold 按字节比较不做 C 截断，" +
			"第一行 \"safe.exe\x00malicious.txt\" 不匹配 \"YSM-Model-Manager.exe\"，跨行攻击无效")
		return
	}
	t.Logf("UNEXPECTED(INFO-NUL-SUMS): fetchExpectedHash 返回 hash=%q", hash)
}

// ---------- 7. semver 比较脏 tag ----------
func TestIsNewer_DirtyTags(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.2.3", "1.2.3", false},
		{"1.2.4", "1.2.3", true},
		{"1.2.3", "1.2.4", false},
		{"1.2", "1.2.3", false},
		{"1.2.3-beta", "1.2.3", false},
		// 带 v 前缀 / 脏 tag → splitVer 首段 Atoi 失败归零，恒判旧（updater_test.go 锁定契约）
		{"v1.1.0", "1.0.0", false},
		{"vv1.2.3", "1.2.3", false},
		{"", "1.2.3", false},
	}
	for _, c := range cases {
		got := isNewer(c.a, c.b)
		if got != c.want {
			t.Errorf("isNewer(%q, %q) = %v, 期望 %v", c.a, c.b, got, c.want)
		}
	}
	t.Log("FIXED(INFO-SEMVER): isNewer 脏 tag 防御正确")
}

// ---------- 8. assetPattern 平台差异 ----------
func TestAssetPattern_WindowsFormat(t *testing.T) {
	p := assetPattern()
	// assetPattern 用 Sprintf 直接拼出具体 asset 名（无占位符），
	// 应包含平台名与资产后缀（v1.13.0 起 Windows 为裸 exe）
	if !strings.Contains(p, runtime.GOOS) {
		t.Fatalf("assetPattern 应包含当前平台 %q, got %q", runtime.GOOS, p)
	}
	if !strings.HasSuffix(p, ".exe") && !strings.HasSuffix(p, ".tar.gz") {
		t.Fatalf("assetPattern 应包含资产后缀, got %q", p)
	}
	t.Logf("INFO(INFO-ASSET): assetPattern=%s", p)
}

// ---------- 9. cleanup 清理 .old 文件 ----------
func TestCleanupOldVersion_NonExistent(t *testing.T) {
	// CleanupOldVersion 使用 os.Executable() 获取当前 exe 路径
	// 测试不创建 .old 文件，应无操作
	CleanupOldVersion()
	t.Log("INFO(INFO-CLEANUP): CleanupOldVersion 对不存在 .old 文件无操作（正常）")
}

// ---------- 10. downloadOnce 空 body ----------
func TestDownloadOnce_EmptyBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		t.Logf("INFO(INFO-EMPTY-BODY): downloadOnce 空 body: %v", err)
		return
	}
	fi, _ := os.Stat(path)
	os.Remove(path)
	if fi.Size() != 0 {
		t.Errorf("BUG(INFO-EMPTY-BODY): downloadOnce 空 body 写出 %d 字节", fi.Size())
	} else {
		t.Log("FIXED/INFO(INFO-EMPTY-BODY): downloadOnce 空 body 写出 0 字节文件（无错误，但可能不应静默成功）")
	}
}

// ---------- 11. Content-Length 与实际 body 不一致（预检通过但传输中断）----------
func TestDownloadOnce_TruncatedTransfer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", "100")
		w.Write([]byte("short")) // 只写 5 字节
	}))
	defer server.Close()

	path, err := downloadOnce(server.URL, "", nil)
	if err != nil {
		t.Logf("守卫: downloadOnce 截断传输被拒绝: %v", err)
		return
	}
	os.Remove(path)
	t.Fatalf("BUG(INFO-TRUNC): downloadOnce 接受截断传输（Content-Length 100 实际 5 字节），损坏包被装盘")
}

// ---------- 12. 超大 Content-Length ----------
func TestDownloadOnce_EnormousContentLength(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", "99999999999")
		// 不写 body——Content-Length 超限应被预检拒绝
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "", nil)
	if err == nil {
		t.Fatal("超大 Content-Length 应被拒绝")
	}
	if strings.Contains(err.Error(), "超过") || strings.Contains(err.Error(), "limit") || strings.Contains(err.Error(), "上限") {
		t.Logf("FIXED(INFO-ENOCL): 超大 Content-Length 被拒绝: %v", err)
	} else {
		t.Logf("INFO(INFO-ENOCL): 超大 Content-Length 被拒绝: %v", err)
	}
}

// ---------- 13. SHA256 不匹配 ----------
func TestDownloadOnce_HashMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Write([]byte("payload"))
	}))
	defer server.Close()

	_, err := downloadOnce(server.URL, "nonexistenthash", nil)
	if err == nil {
		t.Fatal("SHA256 不匹配应被拒绝")
	}
	if !strings.Contains(err.Error(), "SHA256") {
		t.Fatalf("SHA256 不匹配应返回 SHA256 错误, 实际: %v", err)
	}
	t.Logf("FIXED(INFO-HASH): SHA256 不匹配被拒绝: %v", err)
}

// ---------- 14. http.Client 默认 CheckRedirect 跟随无限重定向 ----------
func TestDownloadOnce_InfiniteRedirect(t *testing.T) {
	selfURL := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, selfURL, http.StatusFound)
	}))
	defer server.Close()
	selfURL = server.URL

	// Go http.Client 默认最多跟随 10 次重定向，第 10 次返回错误
	_, err := downloadOnce(server.URL, "", nil)
	if err == nil {
		t.Fatalf("BUG(INFO-REDIR-LOOP): 无限重定向未被拒绝")
	}
	if errors.Is(err, http.ErrUseLastResponse) {
		t.Logf("守卫: 无限重定向被 Go http 拒绝: %v", err)
	} else {
		t.Logf("守卫: 无限重定向被拒绝: %v", err)
	}
}
