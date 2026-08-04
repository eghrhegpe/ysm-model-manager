package app

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
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
	q.tasks = []DownloadTask{
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
	q.tasks = []DownloadTask{
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
	q.tasks = []DownloadTask{
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
