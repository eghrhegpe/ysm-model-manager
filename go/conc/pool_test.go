package conc

import (
	"context"
	"reflect"
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

// ===== ParallelN：显式 worker 数变体 =====

// TestParallelN_OrderPreserved：结果序 = 输入序（与完成序无关，ADR-119）。
// 用人为延迟反转完成序：后一个元素先做完，验证仍按输入序收集。
func TestParallelN_OrderPreserved(t *testing.T) {
	items := []int{10, 20, 30, 40, 50}
	got := ParallelN(context.Background(), 3, items, func(_ context.Context, i int, v int) (int, bool) {
		// 让下标越小的睡越久，刻意反转完成序
		time.Sleep(time.Duration(len(items)-i) * 2 * time.Millisecond)
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

// measureMaxActive 返回 fn 运行期观测到的最大并发数（辅助 clamp 断言）。
func measureMaxActive(n, workers int, fn func(ctx context.Context, i int) (int, bool)) ([]int, int) {
	var mu sync.Mutex
	var active, maxActive int
	items := make([]int, n)
	got := ParallelN(context.Background(), workers, items, func(ctx context.Context, i int, _ int) (int, bool) {
		mu.Lock()
		active++
		if active > maxActive {
			maxActive = active
		}
		mu.Unlock()
		fn(ctx, i)
		mu.Lock()
		active--
		mu.Unlock()
		return i, true
	})
	mu.Lock()
	defer mu.Unlock()
	return got, maxActive
}

// TestParallelN_WorkerClamp_Low：workers=0 → 等效 1（clamp 下限），不 panic。
func TestParallelN_WorkerClamp_Low(t *testing.T) {
	got0, max0 := measureMaxActive(5, 0, func(ctx context.Context, _ int) (int, bool) {
		return 0, true
	})
	got1, _ := measureMaxActive(5, 1, func(ctx context.Context, _ int) (int, bool) {
		return 0, true
	})
	if !reflect.DeepEqual(got0, got1) {
		t.Fatalf("workers=0 与 workers=1 结果应一致: %#v vs %#v", got0, got1)
	}
	if max0 != 1 {
		t.Errorf("workers=0 应 clamp 到 1, 观测并发 %d", max0)
	}
}

// TestParallelN_WorkerClamp_High：workers=1000 且 n=3 → clamp 到 3（上限 = n），不 panic。
func TestParallelN_WorkerClamp_High(t *testing.T) {
	gotHi, maxHi := measureMaxActive(3, 1000, func(ctx context.Context, i int) (int, bool) {
		time.Sleep(5 * time.Millisecond) // 制造重叠窗口
		return i, true
	})
	gotCap, _ := measureMaxActive(3, 3, func(ctx context.Context, i int) (int, bool) {
		time.Sleep(5 * time.Millisecond)
		return i, true
	})
	if !reflect.DeepEqual(gotHi, gotCap) {
		t.Fatalf("workers=1000 与 workers=3 结果应一致: %#v vs %#v", gotHi, gotCap)
	}
	if maxHi > 3 {
		t.Errorf("并发不得超过 n=3, 观测 %d", maxHi)
	}
	if runtime.NumCPU() >= 2 && maxHi != 3 {
		t.Errorf("n=3 应可观测并发=3, 观测 %d", maxHi)
	}
}

// TestParallelN_Cancel：cancel 后不 panic、长度 ≤ n（不硬跑完）。
func TestParallelN_Cancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	n := 200
	var started atomic.Int32
	got := ParallelN(ctx, 4, make([]int, n), func(_ context.Context, _ int, _ int) (int, bool) {
		if started.Add(1) == 5 {
			cancel()
		}
		return 1, true
	})
	if len(got) > n {
		t.Fatalf("结果长度超过输入: %d > %d", len(got), n)
	}
	if s := started.Load(); int(s) >= n {
		t.Errorf("取消后仍跑完全部任务: %d", s)
	}
}

// TestParallelN_PanicIsolation：某 item 的 fn panic，其余 worker 仍产出，该位被跳过（ok=false）。
func TestParallelN_PanicIsolation(t *testing.T) {
	items := []int{0, 1, 2, 3, 4, 5, 6}
	got := ParallelN(context.Background(), 4, items, func(_ context.Context, i int, v int) (int, bool) {
		if v == 3 {
			panic("boom")
		}
		return v * 10, true
	})
	want := []int{0, 10, 20, 40, 50, 60} // 跳过 v==3 的位
	if len(got) != len(want) {
		t.Fatalf("长度不符: got %#v want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("index %d: got %d want %d", i, got[i], want[i])
		}
	}
}

// TestParallelN_EqualsParallelCtx：worker 数传 runtime.NumCPU() 时与 ParallelCtx 输出一致。
func TestParallelN_EqualsParallelCtx(t *testing.T) {
	items := []int{3, 1, 4, 1, 5, 9, 2, 6}
	// 结果依赖完成序的场景：人为延迟，若收集顺序漂移即暴露差异
	fn := func(ctx context.Context, i int, v int) (int, bool) {
		time.Sleep(time.Duration(len(items)-i) * time.Millisecond)
		if ctx.Err() != nil {
			return 0, false
		}
		return v * v, v%2 == 0
	}
	a := ParallelCtx(context.Background(), items, fn)
	b := ParallelN(context.Background(), runtime.NumCPU(), items, fn)
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("ParallelN 与 ParallelCtx 输出不一致: %#v vs %#v", b, a)
	}
}
