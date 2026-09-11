package install

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// 回调注入（ADR-002 P1 打破循环）后 DownloadQueue 可脱离 App 独立测试

func TestDownloadQueue_Sequential(t *testing.T) {
	var downloaded []string
	var emitted []string
	q := NewDownloadQueue(context.Background(),
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
	q := NewDownloadQueue(context.Background(),
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
	q := NewDownloadQueue(context.Background(),
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
	q := NewDownloadQueue(context.Background(),
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

// TestDownloadQueue_ParentCancelStopsQueue 锁定生命周期归属：队列 ctx 必须派生自
// 应用级 parent ctx——parent 取消时在途下载与后续消费一并终止
// （原 context.Background 自建生命周期，应用退出后队列独立跑满下载超时）。
func TestDownloadQueue_ParentCancelStopsQueue(t *testing.T) {
	parent, parentCancel := context.WithCancel(context.Background())
	defer parentCancel()
	downloadStarted := make(chan struct{})
	q := NewDownloadQueue(parent,
		func(ctx context.Context, url, saveDir string) (string, error) {
			close(downloadStarted)
			<-ctx.Done() // 阻塞直到队列 ctx 被取消
			return "", ctx.Err()
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.tasks = []types.DownloadTask{
		{URL: "https://a.example/x.ysm", SaveDir: t.TempDir(), Name: "a.ysm"},
		{URL: "https://b.example/y.ysm", SaveDir: t.TempDir(), Name: "b.ysm"},
	}
	done := make(chan struct{})
	go func() { q.process(); close(done) }()

	<-downloadStarted
	parentCancel() // 应用退出：parent 取消

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("parent ctx 取消后 process 未退出（队列 ctx 未派生自 parent）")
	}
	if q.running {
		t.Error("parent 取消后 running 应复位（代际一致路径）")
	}
}

// TestDownloadQueue_DownloadPanicRecovered 锁住 processForEpoch 的 recover 防线：
// downloadFn 回调 panic 不得崩溃进程（与 conc.Pool/watcher/dedup 的 worker 兜底对齐），
// 队列以 fail-stop 语义停止——running 复位、不重启、不把 panic 当普通下载失败记账。
func TestDownloadQueue_DownloadPanicRecovered(t *testing.T) {
	var emitted []string
	var logged []string
	q := NewDownloadQueue(context.Background(),
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

// TestProcessForEpoch_StaleEpochRejected 锁定 spawnEpoch 代际守卫（P1 竞态回归）。
// 场景：Enqueue spawn 出 worker 后、worker 首次取锁前，队列被 Cancel+Enqueue 取代
// （epoch 已越过 spawn 时的值）。旧 worker 必须以过期代际被拒绝运行，否则它会与
// 新 worker 并发消费同一批任务——重复发 done、提前复位 running。
//
// 同步测试：直接以过期代际调用消费循环，无需 goroutine 与时序，天然确定性。
// 旧实现 Enqueue 走 processForEpoch(0)（跳过守卫）故无法被本用例锁定；
// 修复后 spawn 路径携带 spawnEpoch，守卫生效。
func TestProcessForEpoch_StaleEpochRejected(t *testing.T) {
	var downloaded []string
	q := NewDownloadQueue(context.Background(),
		func(ctx context.Context, url, saveDir string) (string, error) {
			downloaded = append(downloaded, url)
			return "", nil
		},
		func(name string, args ...interface{}) {},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	q.mu.Lock()
	q.tasks = []types.DownloadTask{
		{URL: "https://new.example/x.ysm", SaveDir: t.TempDir(), Name: "new.ysm"},
	}
	q.epoch = 7 // 队列当前代际（已被随后一次 Enqueue 推进）
	q.mu.Unlock()

	q.processForEpoch(3) // 过期代际 worker（spawn 时的代际已作废）

	if len(downloaded) != 0 {
		t.Errorf("过期代际 worker 不得消费任务, got %v", downloaded)
	}
	if len(q.tasks) != 1 {
		t.Errorf("过期代际 worker 不得弹出任务, 剩余应 1, got %d", len(q.tasks))
	}
	if q.running {
		t.Error("过期代际 worker 不得置 running（应立即返回，不触碰队列状态）")
	}
}

// TestEnqueue_CancelReenqueue_NoDuplicateDone 反复「Cancel → 再 Enqueue」的竞态回归。
// 每轮结束应恰有一次 queue:status done。旧实现 Enqueue 以 processForEpoch(0) 启动
// worker（跳过代际守卫），被取代的旧 worker 会采纳「取锁时」的当前代际，与新 worker
// 并发消费同一批任务 → 重复发 done（并提前复位 running）。新实现 spawn 携带
// spawnEpoch，旧 worker 启动即被拒。多轮循环把偶发竞态放大为可观测失败。
//
// 关键设计：首轮 a 批任务的 downloadFn 停在 ctx.Done()（慢任务），使其不可能在
// Cancel 前跑完——否则 a 批合法发出一次 done 会污染计数（假阳性）。故每轮唯一
// 合法的 done 只来自 b 批。
func TestEnqueue_CancelReenqueue_NoDuplicateDone(t *testing.T) {
	const rounds = 50
	var mu sync.Mutex
	doneCount := 0
	q := NewDownloadQueue(context.Background(),
		func(ctx context.Context, url, saveDir string) (string, error) {
			if strings.Contains(url, "slow") {
				<-ctx.Done() // 慢任务：取消前不会结束，故不产生 done
				return "", ctx.Err()
			}
			return "", nil
		},
		func(name string, args ...interface{}) {
			if name != "queue:status" || len(args) == 0 {
				return
			}
			if s, ok := args[0].(string); ok && s == "done" {
				mu.Lock()
				doneCount++
				mu.Unlock()
			}
		},
		func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string) {},
	)
	for i := 0; i < rounds; i++ {
		if err := q.Enqueue([]types.DownloadTask{{Name: "a", URL: "https://slow.example/a", SaveDir: "/"}}); err != nil {
			t.Fatalf("round %d 入队失败: %v", i, err)
		}
		q.Cancel()
		if err := q.Enqueue([]types.DownloadTask{{Name: "b", URL: "https://b", SaveDir: "/"}}); err != nil {
			t.Fatalf("round %d 取消后入队失败: %v", i, err)
		}
		// 等本轮静止，避免轮次交叠
		deadline := time.Now().Add(2 * time.Second)
		for {
			st := q.Status()
			if !st.Running && st.Remaining == 0 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("round %d 队列未静止: %+v", i, st)
			}
			time.Sleep(time.Millisecond)
		}
	}
	mu.Lock()
	got := doneCount
	mu.Unlock()
	if got != rounds {
		t.Errorf("每轮应恰发一次 done，%d 轮应 %d 次，got %d（被取代的旧 worker 与新 worker 并发消费）", rounds, rounds, got)
	}
}
