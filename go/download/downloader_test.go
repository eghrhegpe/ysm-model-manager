package download

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestFileDownload(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hello world"))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "test.txt")

	var progressDownloaded int64
	err := dl.File(ts.URL, savePath, func(downloaded, total int64) {
		progressDownloaded = downloaded
	})
	if err != nil {
		t.Fatalf("File() error: %v", err)
	}

	data, _ := os.ReadFile(savePath)
	if string(data) != "hello world" {
		t.Fatalf("got %q, want %q", string(data), "hello world")
	}
	if progressDownloaded != 11 {
		t.Fatalf("progress %d, want 11", progressDownloaded)
	}
}

func TestFileDownloadHTTPError(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer ts.Close()

	dl := New()
	err := dl.File(ts.URL, filepath.Join(t.TempDir(), "x.txt"), nil)
	if err == nil {
		t.Fatal("expected error for 404")
	}
}

func TestFileDownloadEmptyBody(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "empty.txt")
	err := dl.File(ts.URL, savePath, nil)
	if err != nil {
		t.Fatalf("File() error: %v", err)
	}
	data, _ := os.ReadFile(savePath)
	if len(data) != 0 {
		t.Fatalf("expected empty file, got %d bytes", len(data))
	}
}

func TestFileDownloadProgressOnlyAtEnd(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("short"))
	}))
	defer ts.Close()

	dl := New()
	var calls []int64
	dl.File(ts.URL, filepath.Join(t.TempDir(), "p.txt"), func(downloaded, total int64) {
		calls = append(calls, downloaded)
	})

	// small files may only trigger one progress call at the end
	if len(calls) == 0 {
		t.Fatal("expected at least 1 progress call")
	}
	if calls[len(calls)-1] != 5 {
		t.Fatalf("final progress %d, want 5", calls[len(calls)-1])
	}
}

func TestGitHubAPIDownload(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "application/vnd.github.v3.raw" {
			t.Errorf("expected GitHub Accept header")
		}
		w.Write([]byte(`{"content":"dGVzdA=="}`))
	}))
	defer ts.Close()

	dl := New()
	savePath := filepath.Join(t.TempDir(), "api.txt")
	err := dl.FromGitHubAPI(ts.URL, savePath, nil)
	if err != nil {
		t.Fatalf("FromGitHubAPI() error: %v", err)
	}
}

func TestResolveSavePath(t *testing.T) {
	savePath, jsd, api := ResolveSavePath(
		"https://raw.githubusercontent.com/user/repo/main/models/a.ysm",
		"/tmp/out",
	)
	if savePath == "" || jsd == "" || api == "" {
		t.Fatal("expected non-empty paths")
	}
	if jsd != "https://cdn.jsdelivr.net/gh/user/repo@main/models/a.ysm" {
		t.Fatalf("unexpected jsd: %s", jsd)
	}
	if api != "https://api.github.com/repos/user/repo/contents/models/a.ysm" {
		t.Fatalf("unexpected api: %s", api)
	}
}
