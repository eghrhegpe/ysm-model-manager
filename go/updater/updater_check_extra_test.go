// ===== go/updater CheckWithClient / fetchExpectedHash 分支补测 =====
// 覆盖 CheckWithClient 的错误分支：NewRequest 失败、client.Do 传输错误、
// 非 JSON 错误体、JSON 解码失败、hash 获取失败告警、无本平台 asset。
package updater

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// failRT 固定返回传输错误的 RoundTripper（不发起任何真实网络请求）
type failRT struct{}

func (failRT) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("transport down")
}

// TestCheckWithClient_InvalidURL 覆盖 http.NewRequest 失败分支（非法 URL）
func TestCheckWithClient_InvalidURL(t *testing.T) {
	_, err := CheckWithClient(&http.Client{}, "://bad-url", "1.0.0")
	if err == nil {
		t.Fatal("非法 URL 应返回错误")
	}
}

// TestCheckWithClient_TransportError 覆盖 client.Do 传输层错误分支
// （自定义 RoundTripper 直接返回错误，零网络）
func TestCheckWithClient_TransportError(t *testing.T) {
	_, err := CheckWithClient(&http.Client{Transport: failRT{}}, "http://example.invalid/releases", "1.0.0")
	if err == nil {
		t.Fatal("传输错误应返回错误")
	}
	if !strings.Contains(err.Error(), "transport down") {
		t.Errorf("错误信息应透传底层错误, got %v", err)
	}
}

// TestCheckWithClient_NonJSONErrorBody 覆盖错误体不是 JSON 的分支：
// 403 返回纯文本 → 通用错误文案（不带 message）
func TestCheckWithClient_NonJSONErrorBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte("plain text error page"))
	}))
	defer server.Close()

	_, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err == nil {
		t.Fatal("403 应返回错误")
	}
	if strings.Contains(err.Error(), "plain text") {
		t.Errorf("非 JSON 错误体不应拼入 message, got %v", err)
	}
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("错误信息应包含状态码 403, got %v", err)
	}
}

// TestCheckWithClient_InvalidJSONBody 覆盖 200 但 body 不是合法 JSON 数组的解码失败分支
func TestCheckWithClient_InvalidJSONBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`this is not [json`))
	}))
	defer server.Close()

	_, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err == nil {
		t.Fatal("非法 JSON 应返回解码错误")
	}
}

// TestCheckWithClient_NoPlatformAsset 覆盖「有新版本但无本平台安装包」分支：
// 返回不可更新 + Latest 标记，不 panic
func TestCheckWithClient_NoPlatformAsset(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Release{
			// 新版本但 asset 均非本平台安装包
			{TagName: "v2.0.0", Body: "新版说明", Draft: false, Prerelease: false,
				Assets: []ReleaseAsset{{Name: "YSM-Model-Manager_other-platform.zip",
					BrowserDownloadURL: server.URL + "/dl/other"}}},
			// 空 body 的新版本 → notes 跳过（rel.Body == "" 分支）
			{TagName: "v1.5.0", Body: "", Draft: false, Prerelease: false, Assets: nil},
		})
	}))
	defer server.Close()

	info, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err != nil {
		t.Fatalf("CheckWithClient() = %v", err)
	}
	if info.Available {
		t.Fatal("无本平台安装包不应 available")
	}
	if info.Latest != "v2.0.0" {
		t.Errorf("Latest = %q, 期望 v2.0.0", info.Latest)
	}
}

// TestCheckWithClient_HashFetchFails 覆盖 SHA256SUMS 获取失败分支：
// R30 P2-3 fail-closed 契约——哈希不可得则更新不可用（Available=false，
// 防攻击者阻断 SHA256SUMS 获取绕过完整性校验；旧「hash 缺失仍可用」契约已废弃）
func TestCheckWithClient_HashFetchFails(t *testing.T) {
	pattern := assetPattern()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/sums") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Release{
			{TagName: "v2.1.0", Body: "新版", Draft: false, Prerelease: false,
				Assets: []ReleaseAsset{
					{Name: pattern, BrowserDownloadURL: server.URL + "/dl/2.1.0"},
					{Name: "SHA256SUMS", BrowserDownloadURL: server.URL + "/sums-404"},
				}},
		})
	}))
	defer server.Close()

	info, err := CheckWithClient(server.Client(), server.URL, "1.0.0")
	if err != nil {
		t.Fatalf("CheckWithClient() = %v", err)
	}
	if info.Available {
		t.Fatal("hash 获取失败时应更新不可用（R30 P2-3 fail-closed）")
	}
	if info.ExpectedHash != "" {
		t.Errorf("hash 获取失败时 ExpectedHash 应为空, got %q", info.ExpectedHash)
	}
}

// TestCheckWithClient_NoReleaseNotes 覆盖全部新版本 body 为空时 notes 为空串
// （带 SHA256SUMS asset，使更新可用以聚焦 notes 聚合语义）
func TestCheckWithClient_NoReleaseNotes(t *testing.T) {
	pattern := assetPattern()
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/sums") {
			fmt.Fprintf(w, "%x  %s\n", sha256.Sum256([]byte("pkg")), pattern)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Release{
			{TagName: "v1.9.0", Body: "", Draft: false, Prerelease: false,
				Assets: []ReleaseAsset{
					{Name: pattern, BrowserDownloadURL: server.URL + "/dl/1.9.0"},
					{Name: "SHA256SUMS", BrowserDownloadURL: server.URL + "/sums"},
				}},
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
	if info.ReleaseNotes != "" {
		t.Errorf("空 body 不应聚合日志, got %q", info.ReleaseNotes)
	}
}

// ====== fetchExpectedHash 补充 ======

// TestFetchExpectedHash_MalformedURL 覆盖 http.NewRequest 失败分支（非法 URL，
// 与 updater_test.go 中 DNS 失败的 TestFetchExpectedHash_InvalidURL 互补）
func TestFetchExpectedHash_MalformedURL(t *testing.T) {
	_, err := fetchExpectedHash("://bad-url/sums", "test.zip")
	if err == nil {
		t.Fatal("非法 URL 应返回错误")
	}
}

// TestFetchExpectedHash_SumsPrefix 覆盖 <hash> *<filename> 星号前缀格式（多行 + 空行跳过）
func TestFetchExpectedHash_SumsPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "\n\nabc123def456  YSM-Model-Manager_windows_amd64.exe\nfed789cba012 *YSM-Model-Manager_windows_arm64.exe\n\n")
	}))
	defer server.Close()

	got, err := fetchExpectedHash(server.URL+"/sums", "YSM-Model-Manager_windows_arm64.exe")
	if err != nil {
		t.Fatalf("fetchExpectedHash() = %v", err)
	}
	if got != "fed789cba012" {
		t.Errorf("hash = %q, 期望 fed789cba012", got)
	}
}

// TestFetchExpectedHash_TruncatedBody 覆盖 io.ReadAll 读中断分支：
// 声明 Content-Length 大于实际发送量 → 客户端读错误 → 返回错误
func TestFetchExpectedHash_TruncatedBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "65536") // 声明 64KB，实际只发 1KB
		w.Write([]byte("abc123def456  YSM-Model-Manager_windows_amd64.exe"))
	}))
	defer server.Close()

	_, err := fetchExpectedHash(server.URL+"/sums", "YSM-Model-Manager_windows_amd64.zip")
	if err == nil {
		t.Fatal("截断的 sums 响应应返回错误")
	}
}
