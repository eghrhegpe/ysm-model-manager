//go:build rust_backend

// ===== scanner 在途合并（single-flight）测试——Rust 快路径对等变体 =====
// 与 scanner_singleflight_test.go（!rust_backend）互为镜像：Go-walk 版靠 setWalkStartHook
// 制造确定性在途重叠；rust_backend 下 Go walk 被 tryRustScan 快路径短路（handled=true），
// walkStartHook 永不触发——直接复用 Go 版钩子会在 <-ownerStarted 死等。
// 本文件用 setRustScanHook（测试注入优先于真实 DLL，钩子闭包本身即阻塞点）在
// 生产 Rust 路径上锁定同一组在途合并不变量：
//   - 并发同目录扫描共享一次 rust 扫描（非 owner 全部并入在途航班，不重复走引擎）
//   - 航班在途 InvalidateCache：等待方不得吞下失效前旧结果，应 retry 重扫
//   - 扫描结束后航班清空（不泄漏）
//
// 钩子完全绕过真实 Rust 桥（无需 DLL 在场即可运行）；CI 的 rust_backend 作业
// （.github/workflows/test.yml「Rust 桥 DLL + rust_backend Go 测试」）跑本文件。
package scanner

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// inflightLen / waitForInflight 与 !rust_backend 版（scanner_singleflight_test.go）
// 逐字同构——两文件由互斥 build tag 保证同包只编译其一，重名不冲突
// （同 rust_backend.go / rust_backend_stub.go 的双实现范式）。
func inflightLen() int {
	n := 0
	inFlight.Range(func(_, _ any) bool {
		n++
		return true
	})
	return n
}

func waitForInflight(t *testing.T, want int) {
	t.Helper()
	for i := 0; i < 500; i++ {
		if inflightLen() >= want {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("等待在途航班数 >= %d 超时（当前 %d）", want, inflightLen())
}

var _ = waitForInflight // 保留：与 !rust_backend 版对齐的辅助工具（当前用例经 sleep 窗口保证并入，见 L104 注释）

// TestScanEntriesWithHit_Rust_ConcurrentSameDir_SingleScan Rust 快路径版单飞：
// n 个并发同目录扫描共享一次 rust 扫描——非 owner 全部并入在途航班，
// walkCount 恒 0（未走 Go 兜底），恰 1 个调用方 hit=false（owner 真扫）。
func TestScanEntriesWithHit_Rust_ConcurrentSameDir_SingleScan(t *testing.T) {
	InvalidateCache()
	walkCount.Store(0)
	flightJoins.Store(0)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	// 钩子制造确定性重叠：owner 进入 rust 扫描后阻塞，等待方全部挂在在途航班上再放行
	ownerStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	rustCalls := atomic.Int64{}
	setRustScanHook(func(dir string) ([]types.ModelEntry, bool, bool) {
		rustCalls.Add(1)
		select {
		case ownerStarted <- struct{}{}:
		default:
		}
		<-release
		return []types.ModelEntry{{Name: "a.ysm", Path: filepath.Join(dir, "a.ysm")}}, true, true
	})
	defer setRustScanHook(nil)

	const n = 6
	var wg sync.WaitGroup
	hits := make([]bool, n)
	counts := make([]int, n)
	// goroutine 0 先跑成为 owner
	wg.Add(1)
	go func() {
		defer wg.Done()
		entries, hit := ScanEntriesWithHit(dir)
		hits[0] = hit
		counts[0] = len(entries)
	}()
	<-ownerStarted
	// 其余并发调用应全部并入在途航班
	for i := 1; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			entries, hit := ScanEntriesWithHit(dir)
			hits[i] = hit
			counts[i] = len(entries)
		}(i)
	}
	// owner 被钩子阻塞期间，等待方有充足时间并入在途航班，再放行
	time.Sleep(100 * time.Millisecond)
	close(release)
	wg.Wait()

	// Rust 快路径：非 owner 永不重走引擎（对比 Go 版断言 walkCount=1，此处为 rustCalls=1 且未走 Go 兜底）
	if got := rustCalls.Load(); got != 1 {
		t.Fatalf("并发同目录扫描应只触发 1 次 rust 扫描，实际 %d 次", got)
	}
	if got := walkCount.Load(); got != 0 {
		t.Fatalf("owner 已走 Rust 快路径，不应出现 Go 兜底 walk，实际 %d 次", got)
	}
	if got := flightJoins.Load(); got != n-1 {
		t.Fatalf("除 owner 外 %d 个调用方应全部并入在途航班，实际 %d", n-1, got)
	}
	for i := 0; i < n; i++ {
		if counts[i] != 1 {
			t.Fatalf("调用方 %d 应拿到 1 个条目，实际 %d", i, counts[i])
		}
	}
	// 恰有 1 个调用方 hit=false（owner 真扫）；等待方并入航班取克隆结果 hit=true
	falses := 0
	for _, h := range hits {
		if !h {
			falses++
		}
	}
	if falses != 1 {
		t.Fatalf("应恰好 1 个调用方 hit=false（唯一真扫），实际 %d", falses)
	}
	// 航班须已清理（不泄漏）
	if inflightLen() != 0 {
		t.Fatalf("扫描结束后在途航班应清空，剩余 %d", inflightLen())
	}
}

// TestScanEntriesWithHit_Rust_WaiterInvalidatedDuringFlight_Rescans 航班在途期间
// InvalidateCache（模拟 import/enable/disable 完成）：等待方不得吞下失效前旧结果，
// 应 retry 重扫——rust 扫描共 2 次（owner 1 + 等待方重扫 1），双 hit=false。
func TestScanEntriesWithHit_Rust_WaiterInvalidatedDuringFlight_Rescans(t *testing.T) {
	InvalidateCache()
	walkCount.Store(0)
	flightJoins.Store(0)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	ownerStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	rustCalls := atomic.Int64{}
	setRustScanHook(func(dir string) ([]types.ModelEntry, bool, bool) {
		rustCalls.Add(1)
		select {
		case ownerStarted <- struct{}{}:
		default:
		}
		<-release
		return []types.ModelEntry{{Name: "a.ysm", Path: filepath.Join(dir, "a.ysm")}}, true, true
	})
	defer setRustScanHook(nil)

	var wg sync.WaitGroup
	hits := make([]bool, 2)
	var ownerEntries, waiterEntries []types.ModelEntry
	// owner 先跑成为航班 owner
	wg.Add(1)
	go func() {
		defer wg.Done()
		entries, hit := ScanEntriesWithHit(dir)
		hits[0] = hit
		ownerEntries = entries
	}()
	<-ownerStarted
	// 等待方并入航班
	wg.Add(1)
	go func() {
		defer wg.Done()
		entries, hit := ScanEntriesWithHit(dir)
		hits[1] = hit
		waiterEntries = entries
	}()
	// 等待方并入航班（flightJoins 在 waiter 捕获 gen 并 join 后才 +1——
	// 用它作同步点，确保 InvalidateCache 发生在 waiter 捕获 gen 之后，否则
	// waiter 捕获的是失效后的 gen，比对相等会合法拿到旧结果，测不到守卫）
	for i := 0; i < 500; i++ {
		if flightJoins.Load() >= 1 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if flightJoins.Load() < 1 {
		t.Fatal("等待方未并入航班（flightJoins 仍为 0）")
	}
	// 航班在途期间缓存被失效
	InvalidateCache()
	close(release)
	wg.Wait()

	// 失效后等待方重扫：rust 共 2 次（owner 1 + 等待方重扫 1），且全程未走 Go 兜底
	if got := rustCalls.Load(); got != 2 {
		t.Fatalf("失效后等待方应重扫，期望 rust 扫描 2 次，实际 %d 次", got)
	}
	if got := walkCount.Load(); got != 0 {
		t.Fatalf("重扫仍应走 Rust 快路径，不应出现 Go 兜底 walk，实际 %d 次", got)
	}
	if len(ownerEntries) != 1 || len(waiterEntries) != 1 {
		t.Fatalf("双方各应 1 条目: owner=%d waiter=%d", len(ownerEntries), len(waiterEntries))
	}
	// 重扫的等待方 hit=false（真扫）；owner 的 rust 结果 hit 亦为 false
	for i, h := range hits {
		if h {
			t.Fatalf("调用方 %d 应 hit=false（真扫），实际 true", i)
		}
	}
	if inflightLen() != 0 {
		t.Fatalf("扫描结束后在途航班应清空，剩余 %d", inflightLen())
	}
}
