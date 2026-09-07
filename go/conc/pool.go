// Package conc 通用泛型并发工具（P0：收敛 internal/app 三处手写 worker 池）。
//
// 背景：app_scan.go runConcurrentAnalyze / app_model.go readFileBytesBatchConcurrent、
// ReadFileBytesBatchWithMeta 各自手写 taskCh+wg+resultCh+mutex 的复制粘贴，且
// worker 数阈值魔法数（<=2 / <=4）不一致。此包提供唯一泛型入口，三处收敛复用。
package conc

import (
	"context"
	"log"
	"runtime"
	"sync"
)

// Parallel 对 items 并行执行 fn，结果按输入序收集返回。
// 等价于 ParallelCtx(context.Background(), ...)（ADR-197 兼容壳）：无取消语义的
// 旧调用方零迁移成本；新代码一律走 ParallelCtx。
func Parallel[T, R any](items []T, fn func(i int, item T) (R, bool)) []R {
	return ParallelCtx(context.Background(), items, func(_ context.Context, i int, item T) (R, bool) {
		return fn(i, item)
	})
}

// ParallelCtx 对 items 并行执行 fn，结果按输入序收集返回；带取消语义（ADR-197）。
// fn 收到 ctx 用于任务内部尽早退出（返回 ok=false 跳过该位）；ctx 取消后
// 停止派发新任务，在途任务不受强制打断（文件级粒度，IO 由 fn 自行让出）。
// worker 数 = max(NumCPU, 2)，不超过 items 长度；空输入或预取消返回空切片（非 nil）。
//
// 设计要点：
//   - 结果顺序 = 输入顺序，与 goroutine 完成序无关（ADR-119 确定性契约）——
//     内部按 index 写入预留切片，不依赖 resultCh 到达序。
//   - 取消只保证「尽快停止派发」：派发循环 select ctx.Done，worker 每取一个任务前复查。
func ParallelCtx[T, R any](ctx context.Context, items []T, fn func(ctx context.Context, i int, item T) (R, bool)) []R {
	n := len(items)
	if n == 0 {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return []R{}
	}
	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}
	if workers > n {
		workers = n
	}
	results := make([]R, n)
	ok := make([]bool, n)
	// 缓冲 = workers 而非 n：派发不被 worker 消费拖慢，又不物化整张任务表
	// （cap=n 时 items + chan 双份驻留，纯浪费；无缓冲则派发与消费同步交接）
	taskCh := make(chan int, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range taskCh {
				if ctx.Err() != nil {
					continue // 取消后不再处理新任务，仅排空管道
				}
				func() {
					defer func() {
						if r := recover(); r != nil {
							// fn panic 不崩整个批次：标记该位 ok=false，其余 worker 继续
							ok[idx] = false
							// 走标准库 log（非 fmt）：App 启动期 log.SetOutput(runtimeLogs)
							// 已将其重定向至环形日志面板，fmt 直出会绕过捕获、排障盲飞。
							log.Printf("[conc] Parallel worker panic at idx=%d: %v", idx, r)
						}
					}()
					r, keep := fn(ctx, idx, items[idx])
					results[idx] = r
					ok[idx] = keep
				}()
			}
		}()
	}
dispatch:
	for i := range n {
		select {
		case <-ctx.Done():
			break dispatch
		default:
		}
		taskCh <- i
	}
	close(taskCh)
	wg.Wait()
	out := make([]R, 0, n)
	for i := range n {
		if ok[i] {
			out = append(out, results[i])
		}
	}
	return out
}
