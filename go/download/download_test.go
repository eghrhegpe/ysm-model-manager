package download

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"ysm-model-manager/go/internal/testutil"
)

func TestFileDownload(t *testing.T) {
	t.Parallel()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello world"))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "test.txt")

	var progressDownloaded int64
	err := dl.File(context.Background(), ts.URL, savePath, func(downloaded, total int64) {
		progressDownloaded = downloaded
	})
	testutil.NoError(t, err, "File()")
	data, _ := os.ReadFile(savePath)
	testutil.Equal(t, string(data), "hello world")
	testutil.Equal(t, progressDownloaded, int64(11))
}

func TestFileDownloadHTTPError(t *testing.T) {
	t.Parallel()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "x.txt"), nil)
	var httpErr *HTTPStatusError
	// OR 型复合条件拆序贯：As 前置守卫防 httpErr.Code 解引用（原 if !As || Code!=404）
	testutil.Equal(t, errors.As(err, &httpErr), true, "404 应返回可分类的 HTTPStatusError{Code:404}, got %v", err)
	testutil.Equal(t, httpErr.Code, http.StatusNotFound, "404 应返回可分类的 HTTPStatusError{Code:404}, got %v", err)
}

func TestFileDownloadEmptyBody(t *testing.T) {
	t.Parallel()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "empty.txt")
	testutil.NoError(t, dl.File(context.Background(), ts.URL, savePath, nil))
	data, _ := os.ReadFile(savePath)
	testutil.Equal(t, len(data), 0, "expected empty file")
}

func TestFileDownloadProgressOnlyAtEnd(t *testing.T) {
	t.Parallel()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("short"))
	}))
	defer ts.Close()

	dl := New()
	var calls []int64
	dl.File(context.Background(), ts.URL, filepath.Join(t.TempDir(), "p.txt"), func(downloaded, total int64) {
		calls = append(calls, downloaded)
	})
	// 护栏：至少 1 次进度回调（原 if len==0 → t.Fatal）
	testutil.Equal(t, len(calls) == 0, false, "expected at least 1 progress call")
	testutil.Equal(t, calls[len(calls)-1], int64(5))
}

func TestGitHubAPIDownload(t *testing.T) {
	t.Parallel()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/vnd.github.v3.raw" {
			t.Errorf("expected GitHub Accept header")
		}
		w.Write([]byte(`{"content":"dGVzdA=="}`))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "api.txt")
	testutil.NoError(t, dl.FromGitHubAPI(context.Background(), ts.URL, savePath, nil))
}

func TestResolveSavePath(t *testing.T) {
	t.Parallel()
	savePath, jsd, api := ResolveSavePath(
		"https://raw.githubusercontent.com/user/repo/main/models/a.ysm",
		"/tmp/out",
	)
	// OR 型复合条件拆序贯：三项分别断言非空（原 if =="" || =="" || ==""）
	testutil.Equal(t, savePath == "", false, "expected non-empty paths")
	testutil.Equal(t, jsd == "", false, "expected non-empty paths")
	testutil.Equal(t, api == "", false, "expected non-empty paths")
	testutil.Equal(t, jsd, "https://cdn.jsdelivr.net/gh/user/repo@main/models/a.ysm")
	testutil.Equal(t, api, "https://api.github.com/repos/user/repo/contents/models/a.ysm")
}

func TestResolveSavePathTraversal(t *testing.T) {
	t.Parallel()
	urls := []string{
		"https://raw.githubusercontent.com/user/repo/main/../../etc/passwd",
		"https://raw.githubusercontent.com/user/repo/master/a/b/../../c/../../../../../etc/passwd",
	}
	for _, url := range urls {
		savePath, _, _ := ResolveSavePath(url, "/tmp/out")
		testutil.Equal(t, savePath, "", "expected empty savePath for traversal URL")
	}
}

func TestResolveSavePathValidNested(t *testing.T) {
	t.Parallel()
	savePath, _, _ := ResolveSavePath(
		"https://raw.githubusercontent.com/user/repo/main/models/sub/a.ysm",
		"/tmp/out",
	)
	// 护栏：合法嵌套 URL 不得判为拒绝（原 if =="" → t.Fatal）
	testutil.Equal(t, savePath == "", false, "expected non-empty savePath for valid nested URL")
}

func TestDownloadCtxCancel(t *testing.T) {
	// 确定性取消：服务端发出第一个分块（firstChunk 关闭）即证明下载已进行，
	// 此时 cancel 必能截断进行中的流——不再依赖 time.Sleep(5ms) 与流竞态
	// （快机上 4MB 流可能 5ms 内读完，err=nil flaky）。
	// New() 默认不重试（retry=nil），handler 只会被访问一次，close 安全。
	firstChunk := make(chan struct{})
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		for i := 0; i < 1000; i++ {
			w.Write(make([]byte, 4096))
			flusher.Flush()
			if i == 0 {
				close(firstChunk)
			}
			time.Sleep(1 * time.Millisecond)
		}
	}))
	defer ts.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-firstChunk // 流确已进行，cancel 立即触发（总时长 ≥1s，远长于首分块时刻）
		cancel()
	}()

	dl := New()
	err := dl.File(ctx, ts.URL, filepath.Join(t.TempDir(), "cancel.txt"), nil)
	testutil.NotNil(t, err, "expected cancellation error, got nil")
}
