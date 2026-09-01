// Package conc 通用泛型并发工具（P0：收敛 internal/app 三处手写 worker 池）。
//
// 背景：app_scan.go runConcurrentAnalyze / app_model.go readFileBytesBatchConcurrent、
// ReadFileBytesBatchWithMeta 各自手写 taskCh+wg+resultCh+mutex 的复制粘贴，且
// worker 数阈值魔法数（<=2 / <=4）不一致。此包提供唯一泛型入口，三处收敛复用。
package conc

import (
	"runtime"
	"sync"
)

// Parallel 对 items 并行执行 fn，结果按输入序收集返回。
// fn 返回 (R, ok)：ok=false 表示该项被跳过（结果中不出现该位置）。
// worker 数 = max(NumCPU, 2)，不超过 items 长度；空输入返回 nil。
//
// 设计要点：
//   - 结果顺序 = 输入顺序，与 goroutine 完成序无关（ADR-119 确定性契约）——
//     内部按 index 写入预留切片，不依赖 resultCh 到达序。
//   - 不提供 context 取消：现有三处调用均无取消语义；将来需要时在此加 ctx 变体。
func Parallel[T, R any](items []T, fn func(i int, item T) (R, bool)) []R {
	n := len(items)
	if n == 0 {
		return nil
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
	taskCh := make(chan int, n)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range taskCh {
				r, keep := fn(idx, items[idx])
				results[idx] = r
				ok[idx] = keep
			}
		}()
	}
	for i := range n {
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
