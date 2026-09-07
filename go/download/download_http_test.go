package download

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/internal/testutil"
)

// startRawHTTPServer 启动一个原始 TCP HTTP 服务器，精确控制 Content-Length 与实际 body 的匹配
// 用于探察 Content-Length 截断/超额等边界场景
func startRawHTTPServer(t *testing.T, status int, contentLength int, body []byte) (url string, cleanup func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// 读取并丢弃 HTTP 请求头
		buf := make([]byte, 4096)
		conn.Read(buf)
		// 构造 HTTP 响应
		resp := fmt.Sprintf(
			"HTTP/1.1 %d OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n",
			status, contentLength,
		)
		conn.Write([]byte(resp))
		conn.Write(body)
		conn.Close()
	}()
	return "http://" + ln.Addr().String(), func() { ln.Close() }
}

// ============================================================================
// 验证方向 1: 206 Partial Content 静默装盘
// ============================================================================

// TestHTTP_206PartialContent_Rejected
// 服务端返回 206 Partial Content + Content-Range: bytes 0-99/1000
// 防御：StatusCode 检查拒绝非 200 + Content-Range 头兜底（BUG-HTTP-1/2）
func TestHTTP_206PartialContent_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "bytes 0-99/1000")
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusPartialContent)
		w.Write(make([]byte, 100))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "partial.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		if info, err2 := os.Stat(savePath); err2 == nil {
			t.Fatalf("BUG-HTTP-1: 206 Partial Content 被当作成功，文件已写入 (%d bytes)，可能是不完整分片数据被当作完整文件装盘", info.Size())
		} else {
			t.Fatalf("BUG-HTTP-1b: 206 返回 nil 但无文件写入，行为异常")
		}
	} else {
		t.Logf("OK: 206 被正确拒绝: %v", err)
	}
}

// TestHTTP_200WithContentRange_Rejected
// 服务端返回 200 OK + Content-Range: bytes 0-99/1000 + Content-Length: 100
// 防御（BUG-HTTP-2 修复）：即使 StatusCode=200，Content-Range 头存在即拒绝——
// 防 SSRF 中间人用 200 + Content-Range 伪装完整响应整盘
func TestHTTP_200WithContentRange_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "bytes 0-99/1000")
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusOK)
		w.Write(make([]byte, 100))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "tricky.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		t.Fatalf("FIXED(BUG-HTTP-2): 200 + Content-Range 应被拒绝，实际无错误")
	}
	t.Logf("FIXED(BUG-HTTP-2): 200 + Content-Range 被拒绝: %v", err)
}

// ============================================================================
// 验证方向 2: 重定向链与 scheme 白名单
// ============================================================================

// TestHTTP_Redirect_ChainExceedsLimit
// 构造 12 跳重定向链，应触发 10 hop 上限被拒绝
func TestHTTP_Redirect_ChainExceedsLimit(t *testing.T) {
	const hops = 12
	servers := make([]*httptest.Server, hops)
	for i := hops - 1; i >= 0; i-- {
		idx := i
		if idx == hops-1 {
			servers[idx] = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("final"))
			}))
		} else {
			servers[idx] = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", servers[idx+1].URL)
				w.WriteHeader(http.StatusFound)
			}))
		}
		defer servers[idx].Close()
	}

	dl := New()
	err := dl.File(context.Background(), servers[0].URL, filepath.Join(t.TempDir(), "chain.txt"), nil)
	if err == nil {
		t.Fatalf("BUG-HTTP-3: 12 跳重定向链未被拦截，存在 SSRF 风险")
	} else {
		t.Logf("OK: 重定向链被拦截: %v", err)
	}
}

// TestHTTP_Redirect_ToFileScheme_Rejected
// 服务端重定向到 file:///etc/passwd，应被 scheme 白名单拒绝
func TestHTTP_Redirect_ToFileScheme_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "file:///etc/passwd")
		w.WriteHeader(http.StatusFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "file.txt"), nil)
	if err == nil {
		t.Fatalf("BUG-HTTP-4a: 重定向到 file:// 未被拒绝，存在 SSRF/本地文件读取风险")
	} else {
		t.Logf("OK: file:// 重定向被拒绝: %v", err)
	}
}

// TestHTTP_Redirect_ToFtpScheme_Rejected
// 服务端重定向到 ftp://，应被 scheme 白名单拒绝
func TestHTTP_Redirect_ToFtpScheme_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "ftp://malicious-server.example.com/payload.bin")
		w.WriteHeader(http.StatusFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "ftp.txt"), nil)
	if err == nil {
		t.Fatalf("BUG-HTTP-4b: 重定向到 ftp:// 未被拒绝，存在 SSRF 风险")
	} else {
		t.Logf("OK: ftp:// 重定向被拒绝: %v", err)
	}
}

// ============================================================================
// 验证方向 3: Content-Type 校验缺失
// ============================================================================

// TestHTTP_ContentType_HTML_Rejected
// 服务端返回 200 + Content-Type: text/html + HTML 错误页 body
// 防御（BUG-HTTP-5 修复）：downloadTo 校验 Content-Type，text/html 错误页被拒绝
func TestHTTP_ContentType_HTML_Rejected(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte("<html><body><h1>404 Not Found</h1><p>The requested resource was not found.</p></body></html>"))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "download.html")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		data, _ := os.ReadFile(savePath)
		if strings.Contains(string(data), "404 Not Found") {
			t.Fatalf("FIXED(BUG-HTTP-5): text/html 错误页被当作文件装盘，Content-Type 应被拒绝")
		}
	}
	t.Logf("FIXED(BUG-HTTP-5): text/html 被拒绝: %v", err)
}

// ============================================================================
// 验证方向 4: Content-Length 声明不符
// ============================================================================

// TestHTTP_ContentLength_TruncationDetected
// 服务端声明 Content-Length: 1000 但只发送 7 字节后断连
// 使用原始 TCP 服务器精确控制 Connection: close + 部分 body
func TestHTTP_ContentLength_TruncationDetected(t *testing.T) {
	url, cleanup := startRawHTTPServer(t, 200, 1000, []byte("partial"))
	defer cleanup()

	dl := New()
	err := dl.File(context.Background(), url, filepath.Join(t.TempDir(), "truncated.txt"), nil)
	if err == nil {
		t.Fatalf("BUG-HTTP-6a: Content-Length 截断未被检测到 — 服务端声明 1000 字节但只发送 7 字节，不完整文件被当作完整文件装盘")
	} else {
		t.Logf("OK: 截断被检测到: %v", err)
	}
}

// TestHTTP_ContentLength_OverSent_TruncatedByProtocol
// 服务端声明 Content-Length: 100 但实际发送 200 字节
// HTTP 客户端受 Content-Length 限制只读 100 字节，downloaded=100, total=100
// 断言：成功且文件恰为声明长度（多余字节由协议层截断，无需额外校验——确定性行为）。
func TestHTTP_ContentLength_OverSent_TruncatedByProtocol(t *testing.T) {
	url, cleanup := startRawHTTPServer(t, 200, 100, make([]byte, 200))
	defer cleanup()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "oversent.txt")
	err := dl.File(context.Background(), url, savePath, nil)
	testutil.NoError(t, err, "Content-Length 决定 body 边界，多余字节应被协议截断而非报错")
	data, rErr := os.ReadFile(savePath)
	testutil.NoError(t, rErr, "读取下载文件失败")
	testutil.Equal(t, len(data), 100, "文件应恰为 Content-Length 声明的 100 字节（协议截断）")
}

// ============================================================================
// 验证方向 5: Progress 回调 panic
// ============================================================================

// TestHTTP_ProgressPanic_DuringLoop_TempFileCleaned
// onProgress 在下载循环中 panic（非最终回调）→ downloadTo 不 recover
// defer 清理逻辑应保证 temp 文件被删除，savePath 不应被写入
// 关键: 发送足够数据确保 loop 中触发 progress（progressEmitInterval=200ms）
func TestHTTP_ProgressPanic_DuringLoop_TempFileCleaned(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 持续发送数据使下载循环多次 Read，触发循环内的 onProgress
		for i := 0; i < 100; i++ {
			w.Write(make([]byte, 4096))
			w.(http.Flusher).Flush()
			time.Sleep(5 * time.Millisecond)
		}
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "panic-loop.txt")

	dl := New()
	panicked := false
	var panicCall int64
	// 只在前几次进度回调 panic（确保命中循环内，而非最终回调）
	func() {
		defer func() {
			if recover() != nil {
				panicked = true
			}
		}()
		dl.File(context.Background(), ts.URL, savePath, func(downloaded, total int64) {
			if panicCall == 0 {
				panicCall = downloaded
				panic("boom")
			}
		})
	}()

	if !panicked {
		t.Fatal("预期 onProgress 回调触发 panic")
	}
	t.Logf("panic 发生在 downloaded=%d 时", panicCall)

	// 验证 savePath 未被写入
	if _, err := os.Stat(savePath); !os.IsNotExist(err) {
		t.Fatalf("BUG-HTTP-7a: onProgress 循环内 panic 后 savePath 文件仍存在 — defer 清理逻辑失效")
	} else {
		t.Log("OK: 循环内 panic 后 savePath 未被写入")
	}

	// 验证 .part 临时文件已清理
	entries, _ := os.ReadDir(saveDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Fatalf("BUG-HTTP-7b: 循环内 panic 后 .part 临时文件残留: %s", e.Name())
		}
	}
}

// TestHTTP_ProgressPanic_FinalCallback_FileSurvives
// onProgress 在最终回调（ok=true 后）panic → savePath 已被写入，不会被清理
// 验证: 这是预期的副作用 — panic 时文件已 rename 完成
func TestHTTP_ProgressPanic_FinalCallback_FileSurvives(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello"))
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "panic-final.txt")

	dl := New()
	panicked := false
	var callCount int
	func() {
		defer func() {
			if recover() != nil {
				panicked = true
			}
		}()
		dl.File(context.Background(), ts.URL, savePath, func(downloaded, total int64) {
			callCount++
			if callCount == 1 {
				panic("boom")
			}
		})
	}()

	if !panicked {
		t.Fatal("预期 onProgress 回调触发 panic")
	}

	// 由于 panic 发生在最终回调（ok=true 后），savePath 应已存在
	if info, err := os.Stat(savePath); err == nil {
		data, _ := os.ReadFile(savePath)
		if string(data) == "hello" {
			t.Logf("OK(BUG-HTTP-7c): 最终 onProgress 回调 panic 后 savePath 仍存在（%d 字节，内容正确）。这是预期行为 — rename 已完成，panic 在 success path 中。若需防御，应在 rename 后 wrap onProgress 调用。", info.Size())
		} else {
			t.Fatalf("BUG-HTTP-7c: 最终回调 panic 后 savePath 内容异常: got %q, want %q", string(data), "hello")
		}
	}
}

// ============================================================================
// 验证方向 6: Chunked encoding (无 Content-Length)
// ============================================================================

// TestHTTP_ChunkedEncoding_Success
// Transfer-Encoding: chunked + 无 Content-Length
// total = 0/-1 → 截断检测跳过 → 写实际字节 → 最终文件正确
func TestHTTP_ChunkedEncoding_Success(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("chunk1-"))
		w.(http.Flusher).Flush()
		w.Write([]byte("chunk2-"))
		w.(http.Flusher).Flush()
		w.Write([]byte("chunk3"))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "chunked.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err != nil {
		t.Fatalf("chunked encoding 下载失败: %v", err)
	}
	data, _ := os.ReadFile(savePath)
	if string(data) != "chunk1-chunk2-chunk3" {
		t.Fatalf("内容不符: got %q, want %q", string(data), "chunk1-chunk2-chunk3")
	}
	t.Log("OK: chunked encoding (无 Content-Length) 工作正常，total 回退为 downloaded 字节数")
}

// ============================================================================
// 验证方向 7: 0 字节 body + Content-Length: 0
// ============================================================================

// TestHTTP_ZeroByteBody_WithContentLength0
// Content-Length: 0 → total=0 → 截断检测跳过 → 写入空文件
func TestHTTP_ZeroByteBody_WithContentLength0(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "zero.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err != nil {
		t.Fatalf("Content-Length: 0 下载失败: %v", err)
	}
	data, _ := os.ReadFile(savePath)
	if len(data) != 0 {
		t.Fatalf("预期空文件，实际 %d 字节", len(data))
	}
	t.Log("OK: Content-Length: 0 正确写入空文件")
}

// ============================================================================
// 验证方向 8: fileLocks 并发冲突
// ============================================================================

// TestHTTP_ConcurrentSamePath_MutexSafety
// 2 个 goroutine 同时下载同一路径 → fileLocks 互斥锁保证串行化
// 验证: 两个调用均成功，最终文件内容正确，无临时文件残留
func TestHTTP_ConcurrentSamePath_MutexSafety(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("concurrent-mutex-test-content"))
	}))
	defer ts.Close()

	dl := New()
	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "concurrent.txt")

	var wg sync.WaitGroup
	errors := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			errors[idx] = dl.File(context.Background(), ts.URL, savePath, nil)
		}(i)
	}
	wg.Wait()

	for i, err := range errors {
		if err != nil {
			t.Errorf("goroutine %d 下载失败: %v", i, err)
		}
	}

	data, err := os.ReadFile(savePath)
	if err != nil {
		t.Fatalf("文件不存在: %v", err)
	}
	if string(data) != "concurrent-mutex-test-content" {
		t.Fatalf("内容不符: got %q", string(data))
	}

	entries, _ := os.ReadDir(saveDir)
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".part") {
			t.Fatalf("BUG-HTTP-8: 并发下载后 .part 临时文件残留: %s", e.Name())
		}
	}
	t.Log("OK: fileLocks 互斥锁正常工作，并发同路径下载串行化，无临时文件残留")
}

// ============================================================================
// #11 截断静默陷阱 + 文本匹配错误分类反模式——专项测试
// ============================================================================

// startTruncatingServer 启动一个 TCP 服务器，声明 Content-Length 但只发送部分字节后
// 干净关闭连接（模拟 io.LimitReader 截断 + 半截响应被装盘的陷阱）。
// 关键：发送完截断数据后直接 conn.Close()，让客户端在 Read 时拿到 n=0, err=io.EOF
// 或 io.ErrUnexpectedEOF——无论哪种，downloadTo 的截断检测都应拦截。
func startTruncatingServer(t *testing.T, declaredLength, actualSend int) (url string, cleanup func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 4096)
		conn.Read(buf) // 丢弃请求头
		resp := fmt.Sprintf(
			"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n",
			declaredLength,
		)
		conn.Write([]byte(resp))
		conn.Write(make([]byte, actualSend))
		conn.Close()
	}()
	return "http://" + ln.Addr().String(), func() { ln.Close() }
}

// TestHTTP_ErrorClassification_TruncationDetected
// 服务端声明 Content-Length: 1000 但只发送 7 字节后干净关闭连接。
// 期望：downloadTo 返回非 nil 错误，且是 TruncationError 或包装了它的错误。
// 调用方用 errors.As(err, &truncErr) 提取 Expected/Actual 做诊断（#11 错误分类）。
func TestHTTP_ErrorClassification_TruncationDetected(t *testing.T) {
	url, cleanup := startTruncatingServer(t, 1000, 7)
	defer cleanup()

	dl := New()
	err := dl.File(context.Background(), url, filepath.Join(t.TempDir(), "trunc.txt"), nil)
	if err == nil {
		t.Fatal("#11 截断静默陷阱：服务端声明 1000 字节但只发送 7 字节，截断未被检测到，损坏文件可能被装盘")
	}

	// 验证错误可通过 errors.As 分类——不需要 strings.Contains 文本匹配
	var truncErr *TruncationError
	if errors.As(err, &truncErr) {
		if truncErr.Expected != 1000 {
			t.Errorf("TruncationError.Expected = %d, want 1000", truncErr.Expected)
		}
		if truncErr.Actual != 7 {
			t.Errorf("TruncationError.Actual = %d, want 7", truncErr.Actual)
		}
		t.Logf("OK: 截断被检测并分类为 TruncationError: expected=%d actual=%d",
			truncErr.Expected, truncErr.Actual)
	} else {
		// 如果传输层返回 io.ErrUnexpectedEOF（而非干净 EOF），截断检测走 rErr 路径
		// 这也是正确的——关键是 err != nil
		t.Logf("OK: 截断被检测到（通过 IO 错误路径）: %v", err)
	}

	// 如果是 TruncationError，验证 errors.Is(err, ErrTruncated) 成立
	if errors.As(err, &truncErr) && !errors.Is(err, ErrTruncated) {
		t.Errorf("errors.Is(err, ErrTruncated) 应成立（TruncationError.Unwrap 返回 ErrTruncated）")
	}
}

// TestHTTP_ErrorClassification_HTTPStatusError
// 服务端返回 404，downloadTo 返回 HTTPStatusError{Code: 404}。
// 调用方用 errors.As(err, &httpErr) 提取 Code 做分支（#11 错误分类），
// 替代 strings.Contains(err.Error(), "404")。
func TestHTTP_ErrorClassification_HTTPStatusError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "404.txt"), nil)
	if err == nil {
		t.Fatal("expected error for 404")
	}

	var httpErr *HTTPStatusError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected HTTPStatusError, got %T: %v", err, err)
	}
	if httpErr.Code != http.StatusNotFound {
		t.Errorf("HTTPStatusError.Code = %d, want %d", httpErr.Code, http.StatusNotFound)
	}
	t.Logf("OK: HTTP 状态码错误可通过 errors.As 提取 Code=%d", httpErr.Code)
}

// TestHTTP_ErrorClassification_UnsupportedScheme
// URL scheme 非 http/https，返回包装了 ErrUnsupportedScheme 的错误。
func TestHTTP_ErrorClassification_UnsupportedScheme(t *testing.T) {
	dl := New()
	err := dl.File(context.Background(), "ftp://example.com/file",
		filepath.Join(t.TempDir(), "ftp.txt"), nil)
	if err == nil {
		t.Fatal("expected error for ftp:// scheme")
	}
	if !errors.Is(err, ErrUnsupportedScheme) {
		t.Fatalf("expected errors.Is(err, ErrUnsupportedScheme), got: %v", err)
	}
	t.Logf("OK: scheme 错误可通过 errors.Is(err, ErrUnsupportedScheme) 分类: %v", err)
}

// TestHTTP_ErrorClassification_PartialResponse
// 服务端返回 200 OK + Content-Range 头（partial 响应伪装）。
// 返回包装了 ErrPartialResponse 的错误。
func TestHTTP_ErrorClassification_PartialResponse(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Range", "bytes 0-99/1000")
		w.Header().Set("Content-Length", "100")
		w.WriteHeader(http.StatusOK)
		w.Write(make([]byte, 100))
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL,
		filepath.Join(t.TempDir(), "partial.txt"), nil)
	if err == nil {
		t.Fatal("expected error for 200 + Content-Range")
	}
	if !errors.Is(err, ErrPartialResponse) {
		t.Fatalf("expected errors.Is(err, ErrPartialResponse), got: %v", err)
	}
	t.Logf("OK: partial 响应错误可通过 errors.Is(err, ErrPartialResponse) 分类: %v", err)
}

// TestHTTP_ErrorClassification_NonBinaryContentType
// 服务端返回 text/html 错误页，downloadTo 拒绝并返回 ErrNonBinaryContentType。
func TestHTTP_ErrorClassification_NonBinaryContentType(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte("<html><body>404 Not Found</body></html>"))
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL,
		filepath.Join(t.TempDir(), "html.txt"), nil)
	if err == nil {
		t.Fatal("expected error for text/html Content-Type")
	}
	if !errors.Is(err, ErrNonBinaryContentType) {
		t.Fatalf("expected errors.Is(err, ErrNonBinaryContentType), got: %v", err)
	}
	t.Logf("OK: 非二进制 Content-Type 错误可通过 errors.Is 分类: %v", err)
}

// TestHTTP_ErrorClassification_CtxCanceled
// ctx 取消时，downloadTo 应返回包装了 context.Canceled 的错误，
// 调用方可用 errors.Is(err, context.Canceled) 分类（#11 错误分类）。
// 确定性：download.go 三条取消路径（client.Do 失败 / 读循环 select / 读错误）
// 均 `fmt.Errorf("下载被取消: %w", ctx.Err())` 包装 ctxErr → errors.Is 必然成立。
func TestHTTP_ErrorClassification_CtxCanceled(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for i := 0; i < 1000; i++ {
			w.Write(make([]byte, 4096))
			w.(http.Flusher).Flush()
			time.Sleep(1 * time.Millisecond)
		}
	}))
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(5 * time.Millisecond)
		cancel()
	}()

	// 同一 savePath 贯穿调用与断言（早前版本误用两个 t.TempDir()，
	// 「取消后文件未写入」断言永远命中不存在路径，属无效断言）。
	savePath := filepath.Join(t.TempDir(), "cancel.txt")

	dl := New()
	err := dl.File(ctx, ts.URL, savePath, nil)
	// 错误必须可分类为 context.Canceled（download.go 各取消路径均包装 ctxErr）
	testutil.ErrorIs(t, err, context.Canceled, "download.go 取消路径统一 %w ctx.Err()")

	// 取消后 savePath 不得装盘（截断/取消不应写半截文件）
	testutil.FileNotExists(t, savePath, "取消后不应有半截文件装盘")
}

// TestHTTP_ErrorClassification_NoTruncationOnFullDownload
// 服务端发送完整的 Content-Length 数据，downloadTo 不应误报截断。
// 回归测试：确保截断检测不会在正常下载时产生假阳性。
func TestHTTP_ErrorClassification_NoTruncationOnFullDownload(t *testing.T) {
	body := make([]byte, 2048)
	for i := range body {
		body[i] = byte(i % 256)
	}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(body)))
		w.Write(body)
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "full.txt")
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err != nil {
		t.Fatalf("正常下载不应报截断错误: %v", err)
	}

	data, _ := os.ReadFile(savePath)
	if len(data) != len(body) {
		t.Fatalf("文件长度不符: got %d, want %d", len(data), len(body))
	}
	// 验证内容完整性（非截断/非损坏）
	for i, b := range data {
		if b != byte(i%256) {
			t.Fatalf("文件内容在偏移 %d 处损坏: got %d, want %d", i, b, byte(i%256))
		}
	}
	t.Logf("OK: 完整下载 %d 字节，内容校验通过", len(data))
}

// TestHTTP_ErrorClassification_OverReadTruncationError
// 服务端声明 Content-Length: 1000 但只发 7 字节——截断检测应拦截。
// 传输层在 Connection: close + Content-Length 不符时可能返回 ErrUnexpectedEOF，
// 无论走 TruncationError 路径还是 IO 错误路径，err 应非 nil。
func TestHTTP_ErrorClassification_OverReadTruncationError(t *testing.T) {
	url, cleanup := startTruncatingServer(t, 1000, 7)
	defer cleanup()

	dl := New()
	err := dl.File(context.Background(), url,
		filepath.Join(t.TempDir(), "overread.txt"), nil)
	if err == nil {
		t.Fatal("#11 截断静默陷阱：超读/截断未被检测到")
	}

	// 无论走 TruncationError 路径还是 IO 错误路径，err 应非 nil
	var truncErr *TruncationError
	if errors.As(err, &truncErr) {
		t.Logf("OK: 截断被分类为 TruncationError: %v", truncErr)
	} else if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		t.Logf("OK: 截断通过 IO 错误路径被检测: %v", err)
	} else {
		t.Logf("OK: 截断被检测到（其他错误路径）: %v", err)
	}
}

// TestHTTP_ErrorClassification_RedirectChainTooLong
// 12 跳重定向链超过 10 hop 上限，返回 ErrRedirectChainTooLong。
func TestHTTP_ErrorClassification_RedirectChainTooLong(t *testing.T) {
	const hops = 12
	servers := make([]*httptest.Server, hops)
	for i := hops - 1; i >= 0; i-- {
		idx := i
		if idx == hops-1 {
			servers[idx] = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte("final"))
			}))
		} else {
			servers[idx] = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", servers[idx+1].URL)
				w.WriteHeader(http.StatusFound)
			}))
		}
		defer servers[idx].Close()
	}

	dl := New()
	err := dl.File(context.Background(), servers[0].URL,
		filepath.Join(t.TempDir(), "chain.txt"), nil)
	if err == nil {
		t.Fatal("expected error for redirect chain exceeding limit")
	}
	if !errors.Is(err, ErrRedirectChainTooLong) {
		t.Fatalf("expected errors.Is(err, ErrRedirectChainTooLong), got: %v", err)
	}
	t.Logf("OK: 重定向链超限错误可通过 errors.Is(err, ErrRedirectChainTooLong) 分类")
}

// TestHTTP_ErrorClassification_RedirectToUnsafeScheme
// 重定向到 file:///etc/passwd，返回 ErrRedirectToUnsafeScheme。
func TestHTTP_ErrorClassification_RedirectToUnsafeScheme(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "file:///etc/passwd")
		w.WriteHeader(http.StatusFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL,
		filepath.Join(t.TempDir(), "file.txt"), nil)
	if err == nil {
		t.Fatal("expected error for file:// redirect")
	}
	if !errors.Is(err, ErrRedirectToUnsafeScheme) {
		t.Fatalf("expected errors.Is(err, ErrRedirectToUnsafeScheme), got: %v", err)
	}
	t.Logf("OK: file:// 重定向错误可通过 errors.Is(err, ErrRedirectToUnsafeScheme) 分类")
}

// ============================================================================
// 剩余审核补充：未覆盖分支（#11 先删后建 / 失败回滚 / rename/MkdirAll/网络错误）
// ============================================================================

// hasPartResidue 检查 dir 下是否有 .part 临时文件残留。
func hasPartResidue(t *testing.T, dir string) []string {
	t.Helper()
	var residue []string
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("ReadDir(%s): %v", dir, err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".part") {
			residue = append(residue, e.Name())
		}
	}
	return residue
}

// TestAudit_DownloadFail_PreservesOldFile_NoTempResidue
// #11 先删后建 / 失败回滚：savePath 上已有旧文件，下载截断失败后——
// 旧文件必须原样保留（原子替换，绝不先删后建），且无 .part 临时文件残留。
func TestAudit_DownloadFail_PreservesOldFile_NoTempResidue(t *testing.T) {
	url, cleanup := startTruncatingServer(t, 1000, 7)
	defer cleanup()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "model.ysm")
	if err := os.WriteFile(savePath, []byte("OLD-VALUE"), 0644); err != nil {
		t.Fatal(err)
	}

	dl := New()
	err := dl.File(context.Background(), url, savePath, nil)
	if err == nil {
		t.Fatal("截断下载应失败")
	}

	// 旧文件必须原样保留
	data, rErr := os.ReadFile(savePath)
	if rErr != nil {
		t.Fatalf("失败后旧文件丢失: %v", rErr)
	}
	if string(data) != "OLD-VALUE" {
		t.Fatalf("失败后旧文件被改写: got %q, want %q", string(data), "OLD-VALUE")
	}

	// 无 .part 残留
	if residue := hasPartResidue(t, saveDir); len(residue) > 0 {
		t.Fatalf("失败后 .part 临时文件残留: %v", residue)
	}
}

// TestAudit_DownloadSuccess_AtomicallyReplacesOldFile
// 成功下载必须原子覆盖旧文件（tmp+rename，先建后删语义），且无 .part 残留。
func TestAudit_DownloadSuccess_AtomicallyReplacesOldFile(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "11")
		w.Write([]byte("hello world"))
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "model.ysm")
	if err := os.WriteFile(savePath, []byte("OLD-VALUE-OLD"), 0644); err != nil {
		t.Fatal(err)
	}

	dl := New()
	if err := dl.File(context.Background(), ts.URL, savePath, nil); err != nil {
		t.Fatalf("下载失败: %v", err)
	}
	data, err := os.ReadFile(savePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello world" {
		t.Fatalf("成功覆盖失败: got %q, want %q", string(data), "hello world")
	}
	if residue := hasPartResidue(t, saveDir); len(residue) > 0 {
		t.Fatalf("成功下载后 .part 残留: %v", residue)
	}
}

// TestAudit_RenameFailure_SavePathIsDirectory
// os.Rename 失败分支：savePath 已存在且是目录（rename 文件→目录跨平台必然失败）。
// 目录必须原样保留，temp 必须清理，错误非 nil。
func TestAudit_RenameFailure_SavePathIsDirectory(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("data"))
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "target")
	if err := os.MkdirAll(savePath, 0755); err != nil {
		t.Fatal(err)
	}

	dl := New()
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		t.Fatal("savePath 是目录时 rename 应失败")
	}

	// 目录必须保留
	info, sErr := os.Stat(savePath)
	if sErr != nil {
		t.Fatalf("失败后目录丢失: %v", sErr)
	}
	if !info.IsDir() {
		t.Fatalf("savePath 不再是目录: %v", info.Mode())
	}
	if residue := hasPartResidue(t, saveDir); len(residue) > 0 {
		t.Fatalf("rename 失败后 .part 残留: %v", residue)
	}
}

// TestAudit_MkdirAllFailure_ParentIsFile
// downloadTo 的 MkdirAll 失败分支：savePath 父级某段是普通文件。
func TestAudit_MkdirAllFailure_ParentIsFile(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("data"))
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	blocker := filepath.Join(saveDir, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	savePath := filepath.Join(blocker, "sub", "x.ysm")

	dl := New()
	err := dl.File(context.Background(), ts.URL, savePath, nil)
	if err == nil {
		t.Fatal("父级是普通文件时 MkdirAll 应失败")
	}
}

// TestAudit_NetworkError_RequestFailed
// client.Do 网络错误分支（连接被拒），与 ctx 取消区分——错误非 nil 且不是 context.Canceled。
func TestAudit_NetworkError_RequestFailed(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close() // 立即关闭，保证后续连接被拒

	dl := New()
	err = dl.File(context.Background(), "http://"+addr+"/x",
		filepath.Join(t.TempDir(), "net.txt"), nil)
	if err == nil {
		t.Fatal("连接被拒应返回错误")
	}
	if errors.Is(err, context.Canceled) {
		t.Fatalf("网络错误被误判为 ctx 取消: %v", err)
	}
}

// TestAudit_DownloadFailed_FileNeverCreated
// 下载失败（HTTP 404）时 savePath 必须不存在（无半截文件装盘）。
func TestAudit_DownloadFailed_FileNeverCreated(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "missing.ysm")
	dl := New()
	if err := dl.File(context.Background(), ts.URL, savePath, nil); err == nil {
		t.Fatal("404 应返回错误")
	}
	if _, err := os.Stat(savePath); !os.IsNotExist(err) {
		t.Fatalf("404 失败后 savePath 不应存在: %v", err)
	}
	if residue := hasPartResidue(t, saveDir); len(residue) > 0 {
		t.Fatalf("404 失败后 .part 残留: %v", residue)
	}
}

// ============================================================================
// P2 预留：可选 checksum 校验（FileWithChecksum / FromGitHubAPIWithChecksum）
// ============================================================================

// TestHTTP_Checksum_Match 期望 SHA256 匹配 → 下载成功装盘，内容一致。
func TestHTTP_Checksum_Match(t *testing.T) {
	body := []byte("checksum-match-content-1234567890")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(body)
	}))
	defer ts.Close()

	h := sha256.Sum256(body)
	dl := New()
	savePath := filepath.Join(t.TempDir(), "ck-match.txt")
	if err := dl.FileWithChecksum(context.Background(), ts.URL, savePath, nil, h[:]); err != nil {
		t.Fatalf("checksum 匹配应下载成功: %v", err)
	}
	data, err := os.ReadFile(savePath)
	if err != nil {
		t.Fatalf("下载文件缺失: %v", err)
	}
	if string(data) != string(body) {
		t.Fatalf("内容不符: got %q, want %q", string(data), string(body))
	}
}

// TestHTTP_Checksum_Mismatch 期望 SHA256 不匹配 → 返回 ErrChecksumMismatch，
// savePath 不得装盘、无 .part 残留（temp 由 defer 清理，原子性保持）。
func TestHTTP_Checksum_Mismatch(t *testing.T) {
	body := []byte("checksum-mismatch-content")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write(body)
	}))
	defer ts.Close()

	dl := New()
	saveDir := t.TempDir()
	savePath := filepath.Join(saveDir, "ck-mismatch.txt")
	err := dl.FileWithChecksum(context.Background(), ts.URL, savePath, nil, make([]byte, 32))
	if err == nil {
		t.Fatal("checksum 不匹配应报错")
	}
	if !errors.Is(err, ErrChecksumMismatch) {
		t.Fatalf("应为 ErrChecksumMismatch, got %T: %v", err, err)
	}
	if _, sErr := os.Stat(savePath); !os.IsNotExist(sErr) {
		t.Fatalf("checksum 失败后 savePath 不应被装盘: %v", sErr)
	}
	if residue := hasPartResidue(t, saveDir); len(residue) > 0 {
		t.Fatalf("checksum 失败后 .part 残留: %v", residue)
	}
}
