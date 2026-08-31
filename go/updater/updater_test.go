package updater

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestNormalize(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"v1.2.3", "1.2.3"},
		{"  v1.2.3  ", "1.2.3"},
		{"1.2.3", "1.2.3"},
		{"v1.2.3-beta", "1.2.3-beta"},
		{"v2.0.0", "2.0.0"},
		{"  2.0.0  ", "2.0.0"},
		{"v", ""},
		{"", ""},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("input=%q", tt.input), func(t *testing.T) {
			result := normalize(tt.input)
			if result != tt.expected {
				t.Errorf("normalize(%q) = %q, 期望 %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestIsNewer(t *testing.T) {
	tests := []struct {
		a        string
		b        string
		expected bool
	}{
		{"1.2.3", "1.2.2", true},
		{"1.2.3", "1.2.3", false},
		{"1.3.0", "1.2.9", true},
		{"1.2", "1.2.3", false},
		{"1.2.3", "1.2", true},
		{"2.0.0", "1.9.9", true},
		{"1.0.0", "2.0.0", false},
		{"1.10.0", "1.9.0", true},
		{"1.2.10", "1.2.9", true},
		{"1.2.0", "1.2.0", false},
		// ADR-063 边界用例（x/mod/semver 库比较钉住）：
		// 大版本号跨段（1.10 > 1.9 语义，非字典序）
		{"1.10.0", "1.9.9", true},
		{"1.9.9", "1.10.0", false},
		// 预发布语义默认关闭：v1.0.0 与 v1.0.0-beta.1 视为相等（stripMeta 剥离 - 后缀，
		// 维持现状判定；preReleaseSemantics 开启后 beta 判旧）
		{"1.0.0", "1.0.0-beta.1", false},
		{"1.0.0-beta.1", "1.0.0", false},
		// 构建元数据 +build 不参与比较（stripMeta 剥离 + 后缀，与 semver 规范一致）
		{"1.2.3+build.7", "1.2.3", false},
		{"1.2.3", "1.2.3+build.7", false},
		// 脏 tag 防御：vv1.1.0 normalize 后首段 "v1" 非数字 → splitVer 按 0 处理，
		// 恒小于正常版本，绝不误触发更新
		{"v1.1.0", "1.9.3", false},
		{"v1.1.0", "1.0.0", false},
		{"v1.1.0", "v1.1.0", false},
		// 多段版本：1.2.3.4.5 第 4 段 4 < 5，应判旧
		{"1.2.3.4.5", "1.2.3.5", false},
		{"1.2.3.5", "1.2.3.4.5", true},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("%s_vs_%s", tt.a, tt.b), func(t *testing.T) {
			result := isNewer(tt.a, tt.b)
			if result != tt.expected {
				t.Errorf("isNewer(%q, %q) = %v, 期望 %v", tt.a, tt.b, result, tt.expected)
			}
		})
	}
}

func TestSplitVer(t *testing.T) {
	tests := []struct {
		input    string
		expected []int
	}{
		{"1.2.3-beta", []int{1, 2, 3}},
		{"1.2.3+build", []int{1, 2, 3}},
		{"1.a.3", []int{1, 0, 3}},
		{"2", []int{2}},
		{"1.2.3", []int{1, 2, 3}},
		{"1.2", []int{1, 2}},
		{"1.2.3.4", []int{1, 2, 3, 4}},
		{"", []int{0}},
		{"x.y.z", []int{0, 0, 0}},
		// P3 补测：dev 语义（未注入版本号的开发构建）→ splitVer("dev") 归零 [0]，
		// 与正常版本比较恒旧 → 更新检查恒提示新版（updater 无 dev 特判，知识卡已标注）
		{"dev", []int{0}},
		// 脏 tag 防御：normalize 只去一个 v（vv1.1.0 → "v1.1.0"）；splitVer 直接处理
		// "vv1.1.0" 时首段 "vv1" Atoi 失败按 0 → [0,1,0]
		{"v1.1.0", []int{0, 1, 0}},
		{"vv1.1.0", []int{0, 1, 0}},
		// 多段版本全量解析（SplitN 截断回归：1.2.3.4.5 不应变 [1,2,3,0]）
		{"1.2.3.4.5", []int{1, 2, 3, 4, 5}},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("input=%q", tt.input), func(t *testing.T) {
			result := splitVer(tt.input)
			if len(result) != len(tt.expected) {
				t.Fatalf("splitVer(%q) 长度 = %d, 期望 %d", tt.input, len(result), len(tt.expected))
			}
			for i := range result {
				if result[i] != tt.expected[i] {
					t.Errorf("splitVer(%q)[%d] = %d, 期望 %d", tt.input, i, result[i], tt.expected[i])
				}
			}
		})
	}
}

func TestFetchExpectedHash(t *testing.T) {
	// 模拟 SHA256SUMS 文件内容
	sumsContent := `abc123def456  YSM-Model-Manager_windows_amd64.exe
fed789cba012 *YSM-Model-Manager_windows_arm64.exe
000000000000  other-file.tar.gz`

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(sumsContent))
	}))
	defer server.Close()

	tests := []struct {
		fileName string
		expected string
	}{
		{"YSM-Model-Manager_windows_amd64.exe", "abc123def456"},
		{"YSM-Model-Manager_windows_arm64.exe", "fed789cba012"},
		{"YSM-Model-Manager_linux_amd64.tar.gz", ""},
		{"other-file.tar.gz", "000000000000"},
		// 非本平台 .tar.gz 占位资产：hash 可解析但 UpdateInfo.URL 为空 → Available=false
		// （测试验证 fetchExpectedHash 的通用解析能力，不依赖 platform 匹配逻辑）
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("file=%s", tt.fileName), func(t *testing.T) {
			result, _ := fetchExpectedHash(server.URL+"/sums", tt.fileName)
			if result != tt.expected {
				t.Errorf("fetchExpectedHash(..., %q) = %q, 期望 %q", tt.fileName, result, tt.expected)
			}
		})
	}
}

func TestFetchExpectedHash_EmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(""))
	}))
	defer server.Close()

	// P2 修复后签名返回 (string, error)：空响应（未找到 hash）应返回 error
	_, err := fetchExpectedHash(server.URL+"/sums", "YSM-Model-Manager_windows_amd64.exe")
	if err == nil {
		t.Error("空响应（未找到 hash）应返回错误")
	}
}

func TestFetchExpectedHash_ServerError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	// P2 修复后签名返回 (string, error)：服务器 500 应返回 error
	_, err := fetchExpectedHash(server.URL+"/sums", "YSM-Model-Manager_windows_amd64.exe")
	if err == nil {
		t.Error("服务器错误应返回错误")
	}
}

func TestFetchExpectedHash_InvalidURL(t *testing.T) {
	// P2 修复后签名返回 (string, error)：无效 URL 应返回 error
	_, err := fetchExpectedHash("http://invalid-url-that-does-not-exist.local/sums", "test.zip")
	if err == nil {
		t.Error("无效 URL 应返回错误")
	}
}

func TestDownload_OK(t *testing.T) {
	body := []byte("fake update package content")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(body)
	}))
	defer server.Close()

	// URL 带路径段——原 `server.URL` 的 filepath.Base 在 Windows 上得到
	// "127.0.0.1:PORT"（冒号非法文件名），os.Create 失败 → 主平台测试必挂
	// hash：R30 P2-3 后空 hash 前置拒绝，成功路径必须传真实哈希
	path, err := Download(server.URL+"/pkg.zip", fmt.Sprintf("%x", sha256.Sum256(body)))
	if err != nil {
		t.Fatalf("Download() = %v", err)
	}
	defer os.Remove(path)

	data, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(data, body) {
		t.Errorf("下载内容不符: err=%v", err)
	}
}

func TestDownloadWithProgress_KnownLength(t *testing.T) {
	body := bytes.Repeat([]byte("x"), 1024*1024) // 1MB，足够触发多次 1% 步进回调
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 显式 Content-Length：Go server 对 >4KB 单次 Write 会自动转 chunked（resp.ContentLength=-1），
		// 无法测「已知长度」分支
		w.Header().Set("Content-Length", strconv.Itoa(len(body)))
		w.Write(body)
	}))
	defer server.Close()

	var calls []struct{ done, total int64 }
	path, err := DownloadWithProgress(server.URL+"/pkg.zip", fmt.Sprintf("%x", sha256.Sum256(body)), func(done, total int64) {
		calls = append(calls, struct{ done, total int64 }{done, total})
	})
	if err != nil {
		t.Fatalf("DownloadWithProgress() = %v", err)
	}
	defer os.Remove(path)

	if len(calls) == 0 {
		t.Fatal("进度回调未被调用")
	}
	// 最终回调必须覆盖 100%（done==total==len(body)）
	last := calls[len(calls)-1]
	if last.done != int64(len(body)) || last.total != int64(len(body)) {
		t.Errorf("最终回调 = %d/%d，期望 %d/%d", last.done, last.total, len(body), len(body))
	}
	// 回调单调递增且 total 恒定
	var prev int64
	for i, c := range calls {
		if c.done < prev {
			t.Fatalf("回调 %d 回退: done=%d < prev=%d", i, c.done, prev)
		}
		prev = c.done
		if c.total != int64(len(body)) {
			t.Errorf("回调 %d total=%d，期望 %d", i, c.total, len(body))
		}
	}
}

func TestDownloadWithProgress_UnknownLength(t *testing.T) {
	// 分块传输（Flush 强制无 Content-Length）：total 应为 0，回调仍按字节节流发生
	body := bytes.Repeat([]byte("y"), 600<<10) // 600KB > 512KB 节流阈值
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush() // 先发 header → 无法再设 Content-Length → chunked
		w.Write(body)
	}))
	defer server.Close()

	var calls []struct{ done, total int64 }
	path, err := DownloadWithProgress(server.URL+"/pkg.zip", fmt.Sprintf("%x", sha256.Sum256(body)), func(done, total int64) {
		calls = append(calls, struct{ done, total int64 }{done, total})
	})
	if err != nil {
		t.Fatalf("DownloadWithProgress() = %v", err)
	}
	defer os.Remove(path)

	if len(calls) == 0 {
		t.Fatal("分块传输下进度回调未被调用")
	}
	// 尾块补发（P3 修复）：最终回调必须覆盖完整字节数（600KB，非 512KB 整数倍）
	last := calls[len(calls)-1]
	if last.done != int64(len(body)) {
		t.Errorf("最终回调 done=%d，期望 %d（尾块补发）", last.done, len(body))
	}
	for i, c := range calls {
		if c.total != 0 {
			t.Errorf("回调 %d total=%d，期望 0（未知长度）", i, c.total)
		}
		if c.done < 0 {
			t.Errorf("回调 %d done=%d，不可为负", i, c.done)
		}
	}
}

func TestDownloadWithProgress_ChunkedShortBody(t *testing.T) {
	// <512KB 的 chunked 短包：progressWriter 节流阈值内零回调，必须靠 Copy 后
	// 的尾块补发至少回调一次，且 done 覆盖完整字节数（P3 修复核心场景）
	body := bytes.Repeat([]byte("z"), 200<<10) // 200KB < 512KB 节流阈值
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		w.Write(body)
	}))
	defer server.Close()

	var calls []struct{ done, total int64 }
	path, err := DownloadWithProgress(server.URL+"/pkg.zip", fmt.Sprintf("%x", sha256.Sum256(body)), func(done, total int64) {
		calls = append(calls, struct{ done, total int64 }{done, total})
	})
	if err != nil {
		t.Fatalf("DownloadWithProgress() = %v", err)
	}
	defer os.Remove(path)

	if len(calls) == 0 {
		t.Fatal("短包也应收到至少一次进度回调（尾块补发）")
	}
	last := calls[len(calls)-1]
	if last.done != int64(len(body)) {
		t.Errorf("最终回调 done=%d，期望 %d", last.done, len(body))
	}
}

func TestDownload_HashMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("content"))
	}))
	defer server.Close()

	// 多源回退隔离：hash 失败路径不得回退到真实 ghProxyPrefixes（避免真实网络请求）
	oldPrefixes := ghProxyPrefixes
	ghProxyPrefixes = []string{}
	defer func() { ghProxyPrefixes = oldPrefixes }()

	path, err := Download(server.URL+"/pkg.zip", "deadbeef")
	if err == nil {
		t.Fatal("hash 不匹配应报错")
	}
	if path != "" {
		t.Error("校验失败时不应返回路径")
	}
}

func TestDownload_RejectsOversized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 声明超大 Content-Length（>500MB 上限），实际不写 body
		w.Header().Set("Content-Length", fmt.Sprintf("%d", 600<<20))
	}))
	defer server.Close()

	// 多源回退隔离：Content-Length 超限失败路径不得回退到真实 ghProxyPrefixes
	oldPrefixes := ghProxyPrefixes
	ghProxyPrefixes = []string{}
	defer func() { ghProxyPrefixes = oldPrefixes }()

	// 加路径段——原 `server.URL` 的 filepath.Base 在 Windows 上
	// 是含冒号的非法文件名，os.Create 在 Content-Length 预检前失败 → 超限分支在
	// 主平台从未真正执行（测试通过但测的是别的错误）。
	// hash 传非空：R30 P2-3 前置空 hash 拒绝在 CL 预检之前，传 "x" 保住 CL 预检分支
	if _, err := Download(server.URL+"/pkg.zip", "x"); err == nil {
		t.Fatal("Content-Length 超限应返回错误")
	}
}

func TestDownload_HTTPError(t *testing.T) {
	// 非 200 分支专项测试——404 错误页 HTML 不得被当更新包装盘
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte("<html>404 Not Found</html>"))
	}))
	defer server.Close()

	// 多源回退隔离：404 失败路径不得回退到真实 ghProxyPrefixes
	oldPrefixes := ghProxyPrefixes
	ghProxyPrefixes = []string{}
	defer func() { ghProxyPrefixes = oldPrefixes }()

	// hash 传非空：404 状态码检查先于下载，传任意非空保住 404 分支
	path, err := Download(server.URL+"/pkg.zip", "deadbeef")
	if err == nil {
		t.Fatal("404 应返回错误（错误页不得当更新包）")
	}
	if path != "" {
		t.Errorf("失败时不应返回临时文件路径，得到 %q", path)
	}
}

// TestDownload_MultiSource_DirectFirst 直连成功 → 代理不被请求
func TestDownload_MultiSource_DirectFirst(t *testing.T) {
	body := []byte("direct ok")
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(body)
	}))
	defer direct.Close()
	var proxyHits int
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyHits++
		http.Error(w, "should not hit", http.StatusInternalServerError)
	}))
	defer proxy.Close()

	oldPrefixes := ghProxyPrefixes
	ghProxyPrefixes = []string{proxy.URL + "/"}
	defer func() { ghProxyPrefixes = oldPrefixes }()

	path, err := Download(direct.URL+"/pkg.zip", fmt.Sprintf("%x", sha256.Sum256(body)))
	if err != nil {
		t.Fatalf("Download() = %v", err)
	}
	defer os.Remove(path)
	if proxyHits != 0 {
		t.Errorf("直连成功时代理不应被请求，实际 %d 次", proxyHits)
	}
}

// TestDownload_MultiSource_FallbackToProxy 直连失败（403）→ 回退代理成功
func TestDownload_MultiSource_FallbackToProxy(t *testing.T) {
	body := []byte("update package via proxy")
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "blocked", http.StatusForbidden)
	}))
	defer direct.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(body)
	}))
	defer proxy.Close()

	oldPrefixes := ghProxyPrefixes
	ghProxyPrefixes = []string{proxy.URL + "/"}
	defer func() { ghProxyPrefixes = oldPrefixes }()

	path, err := Download(direct.URL+"/pkg.zip", fmt.Sprintf("%x", sha256.Sum256(body)))
	if err != nil {
		t.Fatalf("Download() = %v", err)
	}
	defer os.Remove(path)
	data, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(data, body) {
		t.Errorf("回退代理内容不符: err=%v", err)
	}
}

// TestDownload_MultiSource_AllFail 全部源失败 → 错误信息聚合各源
func TestDownload_MultiSource_AllFail(t *testing.T) {
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "blocked", http.StatusForbidden)
	}))
	defer direct.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "proxy down", http.StatusBadGateway)
	}))
	defer proxy.Close()

	oldPrefixes := ghProxyPrefixes
	ghProxyPrefixes = []string{proxy.URL + "/"}
	defer func() { ghProxyPrefixes = oldPrefixes }()

	_, err := Download(direct.URL+"/pkg.zip", "deadbeef")
	if err == nil {
		t.Fatal("全部源失败应报错")
	}
	if !strings.Contains(err.Error(), "个源均失败") {
		t.Errorf("错误信息应聚合源数: %v", err)
	}
}

// TestCheck_FindsNewer 集成测试：httptest 模拟 GitHub API，验证新版本发现、日志聚合与 hash 解析
func TestCheck_FindsNewer(t *testing.T) {
	pattern := assetPattern()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/sums") {
			fmt.Fprintf(w, "abc123def456  %s\n", pattern)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Release{
			{TagName: "v1.2.0", Body: "版本二说明", Draft: false, Prerelease: false,
				Assets: []ReleaseAsset{
					{Name: pattern, BrowserDownloadURL: server.URL + "/dl/1.2.0"},
					{Name: "SHA256SUMS", BrowserDownloadURL: server.URL + "/sums"},
				}},
			{TagName: "v1.1.0", Body: "版本一说明", Draft: false, Prerelease: false, Assets: nil},
		})
	}))
	defer server.Close()

	info, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err != nil {
		t.Fatalf("CheckWithClient() = %v", err)
	}
	if !info.Available {
		t.Fatal("应检测到新版本")
	}
	if info.Latest != "v1.2.0" {
		t.Errorf("Latest = %q, 期望 v1.2.0", info.Latest)
	}
	if !strings.Contains(info.ReleaseNotes, "版本二说明") || !strings.Contains(info.ReleaseNotes, "版本一说明") {
		t.Errorf("应聚合所有新版本日志, got %q", info.ReleaseNotes)
	}
	if info.ExpectedHash != "abc123def456" {
		t.Errorf("ExpectedHash = %q, 期望 abc123def456", info.ExpectedHash)
	}
}

func TestCheck_NoNewer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Release{
			{TagName: "v0.9.0", Body: "旧版本", Draft: false, Prerelease: false, Assets: nil},
		})
	}))
	defer server.Close()

	info, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err != nil {
		t.Fatalf("CheckWithClient() = %v", err)
	}
	if info.Available {
		t.Fatal("无新版本时不应 available")
	}
}

func TestCheck_SkipsPrerelease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Release{
			{TagName: "v1.5.0", Body: "预发布", Draft: false, Prerelease: true, Assets: nil},
			{TagName: "v1.4.0", Body: "草稿", Draft: true, Prerelease: false, Assets: nil},
		})
	}))
	defer server.Close()

	info, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err != nil {
		t.Fatalf("CheckWithClient() = %v", err)
	}
	if info.Available {
		t.Fatal("prerelease/draft 不应触发更新")
	}
}

func TestCheck_APIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"message":"API rate limit exceeded"}`))
	}))
	defer server.Close()

	_, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err == nil {
		t.Fatal("API 错误应返回错误")
	}
	if !strings.Contains(err.Error(), "rate limit") {
		t.Errorf("错误信息应包含 GitHub message, got %v", err)
	}
}
