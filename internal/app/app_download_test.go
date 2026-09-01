package app

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// 回调注入（ADR-002 P1 打破循环）后 DownloadQueue 可脱离 App 独立测试

func TestDownloadQueue_Sequential(t *testing.T) {
	var downloaded []string
	var emitted []string
	q := NewDownloadQueue(
		func(ctx context.Context, url, saveDir string) (string, error) {
			downloaded = append(downloaded, url)
			return filepath.Join(saveDir, "out.ysm"), nil
		},
		func(name string, args ...interface{}) { emitted = append(emitted, name) },
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.tasks = []types.DownloadTask{
		{URL: "https://a.example/x.ysm", SaveDir: t.TempDir(), Name: "a.ysm"},
		{URL: "https://b.example/y.ysm", SaveDir: t.TempDir(), Name: "b.ysm"},
	}

	q.process() // 同步阻塞：处理完队列后返回

	if len(downloaded) != 2 || downloaded[0] != "https://a.example/x.ysm" || downloaded[1] != "https://b.example/y.ysm" {
		t.Fatalf("顺序下载: got %v, 期望 [a, b]", downloaded)
	}
	// 事件序列：file-start → file-done → ... → done
	joined := strings.Join(emitted, ",")
	for _, want := range []string{"queue:file-start", "queue:file-done", "queue:status", "queue:status"} {
		if !strings.Contains(joined, want) {
			t.Errorf("事件序列缺 %s, got %v", want, emitted)
		}
	}
	if emitted[len(emitted)-1] != "queue:status" {
		t.Errorf("最后一个事件应为 done, got %v", emitted)
	}
}

func TestDownloadQueue_ErrorDoesNotStopQueue(t *testing.T) {
	var downloaded []string
	q := NewDownloadQueue(
		func(ctx context.Context, url, saveDir string) (string, error) {
			downloaded = append(downloaded, url)
			if url == "https://bad.example/x.ysm" {
				return "", context.Canceled // 模拟失败
			}
			return filepath.Join(saveDir, "out.ysm"), nil
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.tasks = []types.DownloadTask{
		{URL: "https://bad.example/x.ysm", SaveDir: t.TempDir(), Name: "bad.ysm"},
		{URL: "https://ok.example/y.ysm", SaveDir: t.TempDir(), Name: "ok.ysm"},
	}

	q.process()

	if len(downloaded) != 2 {
		t.Fatalf("失败任务不应中断队列: got %v", downloaded)
	}
	if q.running {
		t.Error("process 结束后 running 应复位")
	}
}

func TestDownloadQueue_CancelSkipsDoneEvent(t *testing.T) {
	var emitted []string
	q := NewDownloadQueue(
		func(ctx context.Context, url, saveDir string) (string, error) {
			// 等待 ctx 取消（模拟下载中）
			<-ctx.Done()
			return "", ctx.Err()
		},
		func(name string, args ...interface{}) { emitted = append(emitted, name) },
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.tasks = []types.DownloadTask{
		{URL: "https://slow.example/x.ysm", SaveDir: t.TempDir(), Name: "slow.ysm"},
	}
	q.cancelled = true
	q.cancelFn() // 触发 ctx 取消

	q.process()

	for _, e := range emitted {
		if e == "queue:status" {
			t.Error("取消后不应发 done 事件")
		}
	}
}

// TestQueueStatus_ReflectsQueue 钉住 QueueStatus 的结构化返回（ADR-145：返回类型
// 已下沉 types.QueueStatusInfo——JSON 契约 remaining/running 不变，本测试锁行为）。
// 注：不调 EnqueueDownloads（其 process goroutine 的 emit 依赖 Wails runtime，
// headless 测试会 nil panic），直接注入 queue.tasks 验证读锁路径。
func TestQueueStatus_ReflectsQueue(t *testing.T) {
	a := NewApp()
	st := a.QueueStatus()
	if st.Running || st.Remaining != 0 {
		t.Errorf("空队列应 idle: got %+v", st)
	}
	// 包内直接注入任务（不启 process），验证 remaining 读数
	a.queue.mu.Lock()
	a.queue.tasks = []types.DownloadTask{
		{URL: "https://a.example/x.ysm", SaveDir: t.TempDir(), Name: "a.ysm"},
		{URL: "https://b.example/y.ysm", SaveDir: t.TempDir(), Name: "b.ysm"},
	}
	a.queue.running = true
	a.queue.mu.Unlock()
	st = a.QueueStatus()
	if !st.Running || st.Remaining != 2 {
		t.Errorf("注入 2 任务后应 running+remaining=2, got %+v", st)
	}
}
