package install

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// 落盘账本单测：队列常驻 worker 由 wake 驱动，异步消费——用有界轮询（waitFor）收敛时序，
// 全程带超时保护，绝不无限等待。

func writeLedger(t *testing.T, path string, tasks []types.DownloadTask) {
	t.Helper()
	data, err := json.Marshal(ledgerState{SchemaVersion: ledgerSchemaVersion, Tasks: tasks})
	if err != nil {
		t.Fatalf("marshal 账本失败: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("写账本失败: %v", err)
	}
}

func waitFor(t *testing.T, desc string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("超时未满足条件: %s", desc)
}

func fileGone(path string) bool {
	_, err := os.Stat(path)
	return os.IsNotExist(err)
}

// 崩溃/重启续排：账本里的 pending 任务被播种并排空，排空后文件删除（不误续已完成的批）。
func TestDownloadQueue_LedgerResumesPendingOnStartup(t *testing.T) {
	p := filepath.Join(t.TempDir(), "download-queue.json")
	a := types.DownloadTask{URL: "https://a.example/x.ysm", SaveDir: t.TempDir(), Name: "a.ysm"}
	b := types.DownloadTask{URL: "https://b.example/y.ysm", SaveDir: t.TempDir(), Name: "b.ysm"}
	writeLedger(t, p, []types.DownloadTask{a, b})

	var mu sync.Mutex
	var urls []string
	q := NewDownloadQueue(context.Background(),
		func(ctx context.Context, url, saveDir string) (string, error) {
			mu.Lock()
			urls = append(urls, url)
			mu.Unlock()
			return filepath.Join(saveDir, "out.ysm"), nil
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.UseLedger(p)

	waitFor(t, "两个 pending 任务被续排", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(urls) >= 2
	})
	mu.Lock()
	got := append([]string(nil), urls...)
	mu.Unlock()
	if !contains(got, a.URL) || !contains(got, b.URL) {
		t.Fatalf("续排任务不全: got %v, 期望含 %s 和 %s", got, a.URL, b.URL)
	}
	waitFor(t, "排空后账本文件删除", func() bool { return fileGone(p) })
}

// 篡改防御：陈旧账本被写入非 https 任务时，播种按 Enqueue 同源 https 守卫过滤掉。
func TestDownloadQueue_LedgerFiltersNonHttps(t *testing.T) {
	p := filepath.Join(t.TempDir(), "download-queue.json")
	ok := types.DownloadTask{URL: "https://ok.example/m.ysm", SaveDir: t.TempDir(), Name: "m.ysm"}
	bad := types.DownloadTask{URL: "file:///etc/passwd", SaveDir: t.TempDir(), Name: "evil"}
	writeLedger(t, p, []types.DownloadTask{bad, ok})

	var mu sync.Mutex
	var urls []string
	q := NewDownloadQueue(context.Background(),
		func(ctx context.Context, url, saveDir string) (string, error) {
			mu.Lock()
			urls = append(urls, url)
			mu.Unlock()
			return filepath.Join(saveDir, "out"), nil
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.UseLedger(p)

	waitFor(t, "https 任务被续排", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(urls) >= 1
	})
	// 给坏任务一点时间，确认它永不出现在消费里
	time.Sleep(50 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if contains(urls, bad.URL) {
		t.Errorf("非 https 任务不应被续排（SSRF/本地读防御失效）: got %v", urls)
	}
	if !contains(urls, ok.URL) {
		t.Errorf("https 任务应被续排: got %v", urls)
	}
}

// 损坏/版本不符：安全降级为无账本，清理损坏文件，不 panic、不阻断启动。
func TestDownloadQueue_LedgerCorruptIgnored(t *testing.T) {
	p := filepath.Join(t.TempDir(), "download-queue.json")
	if err := os.WriteFile(p, []byte("{ not valid json"), 0o644); err != nil {
		t.Fatalf("写损坏文件失败: %v", err)
	}
	called := false
	q := NewDownloadQueue(context.Background(),
		func(ctx context.Context, url, saveDir string) (string, error) {
			called = true
			return "", nil
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.UseLedger(p)

	if q.Status().Remaining != 0 {
		t.Errorf("损坏账本应播种 0 任务: got %d", q.Status().Remaining)
	}
	if !fileGone(p) {
		t.Errorf("损坏账本文件应被清理")
	}
	if called {
		t.Errorf("损坏账本不应触发任何下载")
	}
}

// 用户取消即清空账本：在途 worker 阻塞时 Cancel，重启不应续排被主动取消的批。
func TestDownloadQueue_LedgerCancelClearsLedger(t *testing.T) {
	p := filepath.Join(t.TempDir(), "download-queue.json")
	a := types.DownloadTask{URL: "https://a.example/x.ysm", SaveDir: t.TempDir(), Name: "a.ysm"}
	b := types.DownloadTask{URL: "https://b.example/y.ysm", SaveDir: t.TempDir(), Name: "b.ysm"}
	writeLedger(t, p, []types.DownloadTask{a, b})

	q := NewDownloadQueue(context.Background(),
		func(ctx context.Context, url, saveDir string) (string, error) {
			<-ctx.Done() // 永久阻塞直到取消：worker 卡在首个任务，第二个始终 pending
			return "", ctx.Err()
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.UseLedger(p)
	waitFor(t, "worker 已开始消费", func() bool { return q.Status().Running })

	q.Cancel()
	waitFor(t, "Cancel 后账本文件删除", func() bool { return fileGone(p) })
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
