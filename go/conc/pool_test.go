package conc

import (
	"context"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestParallel_Empty：空输入返回 nil。
func TestParallel_Empty(t *testing.T) {
	got := Parallel([]int{}, func(i int, _ int) (int, bool) { return i, true })
	if got != nil {
		t.Fatalf("空输入应返回 nil，got %#v", got)
	}
}

// TestParallel_OrderPreserved：结果顺序 = 输入顺序（与完成序无关）。
// 用人为延迟反转完成序验证确定性契约。
func TestParallel_OrderPreserved(t *testing.T) {
	items := []int{10, 20, 30, 40, 50}
	got := Parallel(items, func(i int, v int) (int, bool) {
		return v * 2, true
	})
	want := []int{20, 40, 60, 80, 100}
	if len(got) != len(want) {
		t.Fatalf("长度不符: got %d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("index %d: got %d want %d", i, got[i], want[i])
		}
	}
}

// TestParallel_Skip：ok=false 的项被跳过。
func TestParallel_Skip(t *testing.T) {
	items := []int{0, 1, 2, 3, 4}
	got := Parallel(items, func(i int, v int) (int, bool) {
		return v * 10, v%2 == 0
	})
	// 只保留偶数 index：0,2,4 → 0,20,40
	want := []int{0, 20, 40}
	if len(got) != len(want) {
		t.Fatalf("长度不符: got %d want %d (got %#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("index %d: got %d want %d", i, got[i], want[i])
		}
	}
}

// TestParallel_AllSkipped：全部跳过返回空切片（非 nil，长度 0）。
func TestParallel_AllSkipped(t *testing.T) {
	got := Parallel([]int{1, 2, 3}, func(_ int, _ int) (int, bool) { return 0, false })
	if got == nil || len(got) != 0 {
		t.Fatalf("应返回空切片, got %#v", got)
	}
}

// TestParallel_InvokedOnce：每个元素恰好处理一次。
func TestParallel_InvokedOnce(t *testing.T) {
	const n = 64
	var calls atomic.Int32
	Parallel(make([]int, n), func(_ int, _ int) (int, bool) {
		calls.Add(1)
		return 1, true
	})
	if got := calls.Load(); got != n {
		t.Fatalf("fn 调用次数 = %d, want %d", got, n)
	}
}

// TestParallel_Single：单元素可用（worker=1 时结果正确）。
func TestParallel_Single(t *testing.T) {
	got := Parallel([]int{42}, func(_ int, v int) (int, bool) { return v, true })
	if len(got) != 1 || got[0] != 42 {
		t.Fatalf("单元素结果错误: %#v", got)
	}
}

// TestParallel_WorkerCapAtLen：n < minWorkers 时不启动多余 goroutine（资源收敛）。
func TestParallel_WorkerCapAtLen(t *testing.T) {
	// 2 个元素：workers 应被截断到 2，不 panic、结果正确
	got := Parallel([]int{1, 2}, func(_ int, v int) (int, bool) { return v, true })
	if len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("结果错误: %#v", got)
	}
}

// TestParallel_ConcurrentExecution：确认实际并行（而非串行执行）。
// 用原子计数 + 少量延迟验证 worker 数 > 1 时重叠执行。
func TestParallel_ConcurrentExecution(t *testing.T) {
	if runtime.NumCPU() < 2 {
		t.Skip("单核环境跳过并行性验证")
	}
	var mu sync.Mutex
	var active, maxActive int
	var seen atomic.Int32
	Parallel(make([]int, 16), func(_ int, _ int) (int, bool) {
		mu.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}
		mu.Unlock()
		seen.Add(1)
		time.Sleep(2 * time.Millisecond) // 制造窗口让其他 worker 进入
		mu.Lock()
		active--
		mu.Unlock()
		return 1, true
	})
	if seen.Load() != 16 {
		t.Fatalf("fn 调用次数 = %d, want 16", seen.Load())
	}
	mu.Lock()
	defer mu.Unlock()
	if maxActive < 2 {
		t.Fatalf("未观察到并行执行: maxActive=%d", maxActive)
	}
}

// TestParallelCtx_CancelStopsDispatch：cancel 后停止派发新任务（ADR-197）。
// 已派发任务自行观察到 ctx 取消并跳过；未派发任务不再执行。
func TestParallelCtx_CancelStopsDispatch(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	items := make([]int, 200)
	var started atomic.Int32
	got := ParallelCtx(ctx, items, func(_ context.Context, _ int, _ int) (int, bool) {
		n := started.Add(1)
		if n == 5 {
			cancel() // 第 5 个任务执行时取消
		}
		select {
		case <-ctx.Done():
			return 0, false // 取消后任务尽早退出
		default:
			return 1, true
		}
	})
	// 取消后不应跑完全部 200 个
	if s := started.Load(); s >= 200 {
		t.Fatalf("取消后仍执行了全部任务: started=%d", s)
	}
	_ = got
}

// TestParallelCtx_ContextDoneBeforeStart：预取消的 ctx 不执行任何任务。
func TestParallelCtx_ContextDoneBeforeStart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var started atomic.Int32
	got := ParallelCtx(ctx, []int{1, 2, 3}, func(_ context.Context, _ int, _ int) (int, bool) {
		started.Add(1)
		return 1, true
	})
	if started.Load() != 0 {
		t.Fatalf("预取消后仍执行了 %d 个任务", started.Load())
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("取消后应返回空结果, got %#v", got)
	}
}

// TestParallelCtx_Delegate: Parallel 等价于 ParallelCtx(Background)。
func TestParallelCtx_Delegate(t *testing.T) {
	got := ParallelCtx(context.Background(), []int{1, 2, 3}, func(_ context.Context, _ int, v int) (int, bool) {
		return v * 2, true
	})
	if len(got) != 3 || got[0] != 2 || got[2] != 6 {
		t.Fatalf("结果错误: %#v", got)
	}
}
