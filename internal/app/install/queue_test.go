package install

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

// TestQueueStatus_ReflectsQueue 钉住 Status 的结构化返回（ADR-145：返回类型
// 已下沉 types.QueueStatusInfo——JSON 契约 remaining/running 不变，本测试锁行为）。
func TestQueueStatus_ReflectsQueue(t *testing.T) {
	q := NewDownloadQueue(
		func(ctx context.Context, url, saveDir string) (string, error) {
			return filepath.Join(saveDir, "out.ysm"), nil
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	st := q.Status()
	if st.Running || st.Remaining != 0 {
		t.Errorf("空队列应 idle: got %+v", st)
	}
	// 包内直接注入任务（不启 process），验证 remaining 读数
	q.mu.Lock()
	q.tasks = []types.DownloadTask{
		{URL: "https://a.example/x.ysm", SaveDir: t.TempDir(), Name: "a.ysm"},
		{URL: "https://b.example/y.ysm", SaveDir: t.TempDir(), Name: "b.ysm"},
	}
	q.running = true
	q.mu.Unlock()
	st = q.Status()
	if !st.Running || st.Remaining != 2 {
		t.Errorf("注入 2 任务后应 running+remaining=2, got %+v", st)
	}
}

// TestDownloadQueue_DownloadPanicRecovered 锁住 processForEpoch 的 recover 防线：
// downloadFn 回调 panic 不得崩溃进程（与 conc.Pool/watcher/dedup 的 worker 兜底对齐），
// 队列以 fail-stop 语义停止——running 复位、不重启、不把 panic 当普通下载失败记账。
func TestDownloadQueue_DownloadPanicRecovered(t *testing.T) {
	var emitted []string
	var logged []string
	q := NewDownloadQueue(
		func(ctx context.Context, url, saveDir string) (string, error) {
			panic("boom")
		},
		func(name string, args ...interface{}) { emitted = append(emitted, name) },
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {
			logged = append(logged, status)
		},
	)
	q.tasks = []types.DownloadTask{
		{URL: "https://a.example/x.ysm", SaveDir: t.TempDir(), Name: "a.ysm"},
		{URL: "https://b.example/y.ysm", SaveDir: t.TempDir(), Name: "b.ysm"},
	}

	// 修复前：q.process() 会 panic 穿透，测试进程崩溃；修复后应正常返回
	q.process()

	if q.running {
		t.Error("panic 后 running 应复位")
	}
	if len(q.tasks) != 1 {
		t.Errorf("panic 时已弹出 1 任务，剩余应 1（fail-stop 不继续消费），got %d", len(q.tasks))
	}
	for _, s := range logged {
		if s == "failed" {
			t.Error("panic 不应被当成普通下载失败记账到导入日志")
		}
	}
	// panic 后不得广播「下载完成」——否则 UI 误判整体状态
	for _, e := range emitted {
		if e == "queue:status" {
			t.Error("panic 后不应广播 queue:status done（队列 fail-stop，非正常完成）")
		}
	}
}
