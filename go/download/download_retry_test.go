package download

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"ysm-model-manager/go/internal/testutil"
)

// flakyTransport 前 N 次返回网络错误（连接重置），之后透传真实 transport——
// 构造弱网抖动：重试需在网络类失败后恢复成功。
type flakyTransport struct {
	rt       http.RoundTripper
	failures int
}

func (f *flakyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if f.failures > 0 {
		f.failures--
		return nil, &net.OpError{Op: "read", Net: "tcp", Err: errors.New("connection reset by peer")}
	}
	return f.rt.RoundTrip(req)
}

// 重试只在同一 URL 的网络类失败/5xx 上退避（与三源回退正交——URL 内耗尽才换源）。
// 默认不重试（行为零漂移，downloadFileWithQueue 三级回退不叠加）。

func TestRetry_Transient503_Succeeds(t *testing.T) {
	var calls int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	}))
	defer ts.Close()

	dl := NewWithClient(ts.Client()).WithRetry(3, 5*time.Millisecond)
	testutil.NoError(t, dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "f.txt"), nil), "503 后重试应成功")
	got := atomic.LoadInt32(&calls)
	testutil.Equal(t, got, int32(2), "应请求 2 次（1 失败 + 1 成功），got %d", got)
}

func TestRetry_Exhausted_ReturnsLastError(t *testing.T) {
	var calls int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer ts.Close()

	dl := NewWithClient(ts.Client()).WithRetry(3, time.Millisecond)
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "f.txt"), nil)
	testutil.NotNil(t, err, "应返回错误")
	var httpErr *HTTPStatusError
	// OR 型复合条件拆序贯：As 前置守卫防 httpErr.Code 解引用（原 if !As || Code!=502）
	testutil.Equal(t, errors.As(err, &httpErr), true, "重试耗尽应返回末次错误（HTTP 502）且分类不变，got %T: %v", err, err)
	testutil.Equal(t, httpErr.Code, http.StatusBadGateway, "重试耗尽应返回末次错误（HTTP 502）且分类不变，got %v", err)
	got := atomic.LoadInt32(&calls)
	testutil.Equal(t, got, int32(3), "应请求 3 次（耗尽），got %d", got)
}

func TestRetry_NotTriggeredOn4xx(t *testing.T) {
	var calls int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	dl := NewWithClient(ts.Client()).WithRetry(3, time.Millisecond)
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "f.txt"), nil)
	var httpErr *HTTPStatusError
	// OR 型复合条件拆序贯：As 前置守卫防 httpErr.Code 解引用（原 if !As || Code!=404）
	testutil.Equal(t, errors.As(err, &httpErr), true, "4xx 不应重试，应原样返回 404，got %v", err)
	testutil.Equal(t, httpErr.Code, http.StatusNotFound, "4xx 不应重试，应原样返回 404，got %v", err)
	got := atomic.LoadInt32(&calls)
	testutil.Equal(t, got, int32(1), "4xx 不应重试，应请求 1 次，got %d", got)
}

func TestRetry_NotTriggeredOnCancel(t *testing.T) {
	var calls int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer ts.Close()

	dl := NewWithClient(ts.Client()).WithRetry(3, time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 预取消
	err := dl.File(ctx, ts.URL, filepath.Join(t.TempDir(), "f.txt"), nil)
	testutil.ErrorIs(t, err, context.Canceled, "应返回 context.Canceled")
	got := atomic.LoadInt32(&calls)
	testutil.Equal(t, got > 1, false, "ctx 取消不应重试，请求次数应 ≤1，got %d", got)
}

func TestRetry_DefaultDisabled(t *testing.T) {
	var calls int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer ts.Close()

	dl := NewWithClient(ts.Client()) // 默认不重试（零值，行为零漂移）
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "f.txt"), nil)
	testutil.NotNil(t, err, "应返回错误")
	got := atomic.LoadInt32(&calls)
	testutil.Equal(t, got, int32(1), "默认应不重试，应请求 1 次，got %d", got)
}

func TestRetry_NetworkError_RetriesThenSucceeds(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer ts.Close()

	dl := NewWithClient(&http.Client{
		Transport: &flakyTransport{rt: ts.Client().Transport, failures: 2},
	}).WithRetry(3, time.Millisecond)
	testutil.NoError(t, dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "f.txt"), nil), "网络错误重试后应成功")
}

// truncatingTransport 前 N 次声明 Content-Length 但少写字节（clean EOF 截断），
// 之后透传真实 transport。模拟代理提前关闭连接——TruncationError 应被重试。
type truncatingTransport struct {
	rt       http.RoundTripper
	failures int
}

func (t *truncatingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if t.failures > 0 {
		t.failures--
		// 声明 10 字节但只写 3 字节 → downloadTo 检测 downloaded < total → TruncationError
		return &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: 10,
			Body:          io.NopCloser(strings.NewReader("abc")),
			Header:        make(http.Header),
		}, nil
	}
	return t.rt.RoundTrip(req)
}

func TestRetry_TruncationRetried(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))
	defer ts.Close()

	dl := NewWithClient(&http.Client{
		Transport: &truncatingTransport{rt: ts.Client().Transport, failures: 2},
	}).WithRetry(3, time.Millisecond)
	testutil.NoError(t, dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "f.txt"), nil), "截断错误重试后应成功")
}
