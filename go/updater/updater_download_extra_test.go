// ===== go/updater downloadOnce 错误分支补测 =====
// 覆盖：NewRequest 失败、传输层连接失败、响应被截断（io.Copy 错误）、
// 分块传输超过上限的截断探测拒绝、错误哨兵 errors.Is 分类、Content-Length 完整性校验。
// 全部走本地 httptest / 自定义 RoundTripper，零真实网络。
// TruncationProbe 测试覆盖 maxDownloadSize 为 1MB，回环传输 1MB 秒级完成。
package updater

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// isolateProxy 将 ghProxyPrefixes 置空——错误路径不得回退到真实代理（避免真实网络）
func isolateProxy(t *testing.T) {
	t.Helper()
	old := ghProxyPrefixes
	ghProxyPrefixes = []string{}
	t.Cleanup(func() { ghProxyPrefixes = old })
}

// TestDownloadOnce_InvalidURL 覆盖 http.NewRequest 失败分支（非法 URL 不触发网络）
func TestDownloadOnce_InvalidURL(t *testing.T) {
	isolateProxy(t)
	path, err := Download("://bad-url/pkg.zip", "")
	if err == nil {
		t.Fatal("非法 URL 应返回错误")
	}
	if path != "" {
		t.Errorf("失败时不应返回路径, got %q", path)
	}
}

// TestDownloadOnce_ConnectionRefused 覆盖 client.Do 传输层错误分支
// （server 已关闭 → 本地连接被拒，即时失败）
func TestDownloadOnce_ConnectionRefused(t *testing.T) {
	isolateProxy(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL := server.URL
	server.Close() // 端口立即释放，后续连接必然被拒

	_, err := Download(deadURL+"/pkg.zip", "x")
	if err == nil {
		t.Fatal("连接被拒应返回错误")
	}
	if !strings.Contains(err.Error(), "个源均失败") {
		t.Errorf("应聚合源错误信息, got %v", err)
	}
}

// TestDownloadOnce_TruncatedResponse 覆盖 io.Copy 读错误分支：
// 声明 Content-Length 大于实际发送量 → 客户端读到 unexpected EOF → 拒绝并清理临时文件
func TestDownloadOnce_TruncatedResponse(t *testing.T) {
	isolateProxy(t)
	body := bytes.Repeat([]byte("x"), 100)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", strconv.Itoa(1024)) // 声明 1024，实际只发 100
		w.Write(body)
	}))
	defer server.Close()

	// hash 传非空：截断读错误先于 hash 检查触发，保住截断分支
	path, err := Download(server.URL+"/pkg.zip", "x")
	if err == nil {
		t.Fatal("截断响应应返回错误")
	}
	if path != "" {
		t.Errorf("失败时不应返回路径, got %q", path)
	}
}

// TestDownloadOnce_TruncationProbe 覆盖分块传输（无 Content-Length）超过上限的截断探测分支：
// 读到上限后再读 1 字节仍有数据 → 拒绝。测试覆盖 maxDownloadSize 为 1MB，回环传输秒级完成。
func TestDownloadOnce_TruncationProbe(t *testing.T) {
	isolateProxy(t)
	// 覆盖上限为 1MB，避免回环传输 500MB 拖慢测试
	old := maxDownloadSize
	maxDownloadSize = 1 << 20
	t.Cleanup(func() { maxDownloadSize = old })

	chunk := make([]byte, 256<<10) // 256KB 复用缓冲，避免大分配
	maxBody := int64(maxDownloadSize)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush() // 先发 header → chunked，绕过 Content-Length 预检分支
		for sent := int64(0); sent <= maxBody; sent += int64(len(chunk)) {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	_, err := Download(server.URL+"/pkg.zip", "x")
	if err == nil {
		t.Fatal("超过上限应返回错误")
	}
	if !strings.Contains(err.Error(), "上限") {
		t.Errorf("错误信息应包含大小上限, got %v", err)
	}
}

// ====== 错误哨兵 errors.Is 分类（陷阱 #11 文本匹配错误分类）与完整性校验 ======

// truncRT 构造 Content-Length=100 但 body 仅 5 字节且正常 EOF 的响应，
// 专用于触发 downloadOnce 的完整性校验分支（陷阱 #11 限流器截断静默）。
// 标准 http client 对提前关闭的 CL 响应返回 unexpected EOF，真实网络不可触达该分支。
type truncRT struct{}

func (truncRT) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode:    http.StatusOK,
		Header:        http.Header{"Content-Type": []string{"application/octet-stream"}},
		Body:          io.NopCloser(strings.NewReader("short")),
		ContentLength: 100,
		Request:       &http.Request{Method: "GET"},
	}, nil
}

// TestDownloadOnce_ContentLengthMismatch 覆盖完整性校验：
// Content-Length 已知但与实收字节不符 → ErrDownloadIncomplete，失败不返回路径
func TestDownloadOnce_ContentLengthMismatch(t *testing.T) {
	old := newDownloadClient
	newDownloadClient = func() *http.Client { return &http.Client{Transport: truncRT{}} }
	defer func() { newDownloadClient = old }()

	path, err := downloadOnce("https://example.invalid/pkg", "x", nil)
	if err == nil {
		t.Fatal("Content-Length 与实收不符应返回错误")
	}
	if path != "" {
		t.Errorf("失败时不应返回路径, got %q", path)
	}
	if !errors.Is(err, ErrDownloadIncomplete) {
		t.Errorf("应可通过 errors.Is 匹配 ErrDownloadIncomplete, got %v", err)
	}
	if !strings.Contains(err.Error(), "期望 100 字节") {
		t.Errorf("错误信息应包含期望字节数, got %v", err)
	}
}

// TestDownload_ContentLengthMismatch_ThroughDownload 经 Download 入口验证同一分支
// （多源回退隔离，防止错误路径回退到真实代理）
func TestDownload_ContentLengthMismatch_ThroughDownload(t *testing.T) {
	oldClient := newDownloadClient
	newDownloadClient = func() *http.Client { return &http.Client{Transport: truncRT{}} }
	defer func() { newDownloadClient = oldClient }()
	isolateProxy(t)

	_, err := Download("https://example.invalid/pkg", "x")
	if err == nil {
		t.Fatal("截断下载应返回错误")
	}
	if !errors.Is(err, ErrDownloadIncomplete) {
		t.Errorf("应可通过 errors.Is 匹配 ErrDownloadIncomplete, got %v", err)
	}
}

// TestDownload_HashMismatch_Sentinel：SHA256 不匹配 → ErrHashMismatch
func TestDownload_HashMismatch_Sentinel(t *testing.T) {
	isolateProxy(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("content"))
	}))
	defer server.Close()

	_, err := Download(server.URL+"/pkg", "deadbeef")
	if err == nil {
		t.Fatal("hash 不匹配应报错")
	}
	if !errors.Is(err, ErrHashMismatch) {
		t.Errorf("应可通过 errors.Is 匹配 ErrHashMismatch, got %v", err)
	}
}

// TestDownload_RejectsOversized_Sentinel：Content-Length 超限 → ErrDownloadTooBig
func TestDownload_RejectsOversized_Sentinel(t *testing.T) {
	isolateProxy(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", 600<<20))
	}))
	defer server.Close()

	_, err := Download(server.URL+"/pkg", "x")
	if err == nil {
		t.Fatal("Content-Length 超限应返回错误")
	}
	if !errors.Is(err, ErrDownloadTooBig) {
		t.Errorf("应可通过 errors.Is 匹配 ErrDownloadTooBig, got %v", err)
	}
}

// TestDownload_RejectsEmptyHash：R30 P2-3 新行为——空 hash **下载前**即拒绝（ErrHashMismatch）：
// 防攻击者阻断 SHA256SUMS 获取后绕过完整性校验；确定性失败不再回退 ghProxy。
func TestDownload_RejectsEmptyHash(t *testing.T) {
	isolateProxy(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("any"))
	}))
	defer server.Close()

	_, err := Download(server.URL+"/pkg.zip", "")
	if err == nil {
		t.Fatal("空 hash 必须拒绝下载（R30 P2-3：哈希不可得时禁止无完整性校验）")
	}
	if !errors.Is(err, ErrHashMismatch) {
		t.Errorf("应 errors.Is 匹配 ErrHashMismatch, got %v", err)
	}
}

// TestDownload_TruncationProbe_Sentinel：分块传输超限截断探测 → ErrDownloadTooBig
func TestDownload_TruncationProbe_Sentinel(t *testing.T) {
	isolateProxy(t)
	old := maxDownloadSize
	maxDownloadSize = 1 << 20
	t.Cleanup(func() { maxDownloadSize = old })

	chunk := make([]byte, 256<<10)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		for sent := int64(0); sent <= int64(maxDownloadSize); sent += int64(len(chunk)) {
			if _, err := w.Write(chunk); err != nil {
				return
			}
		}
	}))
	defer server.Close()

	_, err := Download(server.URL+"/pkg", "x")
	if err == nil {
		t.Fatal("超过上限应返回错误")
	}
	if !errors.Is(err, ErrDownloadTooBig) {
		t.Errorf("应可通过 errors.Is 匹配 ErrDownloadTooBig, got %v", err)
	}
}
