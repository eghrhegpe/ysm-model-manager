//go:build !rust_backend

// ===== scanner 在途合并（single-flight）测试 =====
// 背景（2026-08-21）：点击整合包时前端多组件并发请求 GetResourceInstanceStatus，
// 同目录的两次扫描在途重叠——缓存「扫完才 Store」导致重叠请求双双真扫
// （操作日志面板同一秒出现两条相同目录的扫描记录）。在途合并：
// 同目录并发扫描共享一次 walk，等待方拿克隆结果且 hit=true（薄壳不重复记日志）。
package scanner

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// inflightLen 在途航班数（白盒断言用：合并生效/结束清空）
func inflightLen() int {
	n := 0
	inFlight.Range(func(_, _ any) bool {
		n++
		return true
	})
	return n
}

// waitForInflight 带上限的等待循环（防死等）
func waitForInflight(t *testing.T, want int) {
	t.Helper()
	for i := 0; i < 500; i++ {
		if inflightLen() >= want {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	// 护栏（到达即失败）：Equal 恒失败即 Goexit，与原 t.Fatalf 终止语义等价
	testutil.Equal(t, false, true, "等待在途航班数 >= %d 超时（当前 %d）", want, inflightLen())
}

func TestScanEntriesWithHit_ConcurrentSameDir_SingleWalk(t *testing.T) {
	InvalidateCache()
	walkCount.Store(0)
	flightJoins.Store(0)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	// 钩子制造确定性重叠：owner 进入 walk 后阻塞，等待方全部挂在在途航班上再放行
	ownerStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	setWalkStartHook(func() {
		select {
		case ownerStarted <- struct{}{}:
		default:
		}
		<-release
	})
	defer setWalkStartHook(nil)

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

	testutil.Equal(t, walkCount.Load(), int64(1), "并发同目录扫描应只走盘 1 次，实际 %d", walkCount.Load())
	testutil.Equal(t, flightJoins.Load(), int64(n-1), "除 owner 外 %d 个调用方应全部并入在途航班，实际 %d", n-1, flightJoins.Load())
	for i := 0; i < n; i++ {
		testutil.Equal(t, counts[i], 1, "调用方 %d 应拿到 1 个条目，实际 %d", i, counts[i])
	}
	// 恰有 1 个调用方 hit=false（owner，薄壳据此只记 1 条扫描日志）；
	// 等待方与缓存命中者均 hit=true（不重复记日志）
	falses := 0
	for _, h := range hits {
		if !h {
			falses++
		}
	}
	testutil.Equal(t, falses, 1, "应恰好 1 个调用方 hit=false（唯一真扫），实际 %d", falses)
	// 航班须已清理（不泄漏）
	testutil.Equal(t, inflightLen(), 0, "扫描结束后在途航班应清空，剩余 %d", inflightLen())
}

func TestScanEntriesWithHit_DifferentDirs_EachWalked(t *testing.T) {
	InvalidateCache()
	walkCount.Store(0)

	dirA := t.TempDir()
	dirB := t.TempDir()
	_ = os.WriteFile(filepath.Join(dirA, "a.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(dirB, "b.ysm"), []byte("x"), 0644)

	ScanEntriesWithHit(dirA)
	ScanEntriesWithHit(dirB)
	testutil.Equal(t, walkCount.Load(), int64(2), "不同目录各走盘 1 次，应 2 次，实际 %d", walkCount.Load())
	// 缓存内二次扫描不新增 walk
	_, hit := ScanEntriesWithHit(dirA)
	testutil.Equal(t, hit, true, "30s 内二次扫描应命中缓存")
	testutil.Equal(t, walkCount.Load(), int64(2), "缓存命中不应新增 walk，实际 %d", walkCount.Load())
}

func TestScanEntriesWithHit_WaitersGetClone(t *testing.T) {
	InvalidateCache()
	walkCount.Store(0)

	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644)

	ownerStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	setWalkStartHook(func() {
		select {
		case ownerStarted <- struct{}{}:
		default:
		}
		<-release
	})
	defer setWalkStartHook(nil)

	var wg sync.WaitGroup
	var ownerEntries, waiterEntries []types.ModelEntry
	wg.Add(2)
	go func() {
		defer wg.Done()
		entries, _ := ScanEntriesWithHit(dir)
		ownerEntries = entries
	}()
	<-ownerStarted
	go func() {
		defer wg.Done()
		entries, _ := ScanEntriesWithHit(dir)
		waiterEntries = entries
	}()
	waitForInflight(t, 1)
	close(release)
	wg.Wait()

	// 等待方拿到的是克隆——改等待方切片不得污染 owner/缓存后备
	// OR 型复合条件拆序贯（len 守卫在前，防下方 [0] 越界——Equal 失败即 Goexit，守卫语义等价）
	testutil.Equal(t, len(waiterEntries), 1, "双方各应 1 条目: owner=%d waiter=%d", len(ownerEntries), len(waiterEntries))
	testutil.Equal(t, len(ownerEntries), 1, "双方各应 1 条目: owner=%d waiter=%d", len(ownerEntries), len(waiterEntries))
	waiterEntries[0].Name = "HACKED"
	testutil.Equal(t, ownerEntries[0].Name == "HACKED", false, "等待方切片与 owner 共享底层数组——必须克隆")
}

func TestScanEntriesWithHit_WaiterInvalidatedDuringFlight_Rescans(t *testing.T) {
	InvalidateCache()
	walkCount.Store(0)
	flightJoins.Store(0)

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.ysm"), []byte("x"), 0644); err != nil {
		testutil.NoError(t, err)
	}

	ownerStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	setWalkStartHook(func() {
		select {
		case ownerStarted <- struct{}{}:
		default:
		}
		<-release
	})
	defer setWalkStartHook(nil)

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
	testutil.Equal(t, flightJoins.Load() >= 1, true, "等待方未并入航班（flightJoins 仍为 0）")
	// 航班在途期间缓存被失效（模拟 import/enable/disable 完成时 InvalidatePath）
	InvalidateCache()
	close(release)
	wg.Wait()

	// 等待方不得吞下失效前的旧结果：应 retry 重扫（walkCount=2：owner 1 次 + 等待方重扫 1 次）
	testutil.Equal(t, walkCount.Load(), int64(2), "失效后等待方应重扫，期望 walk=2，实际 %d", walkCount.Load())
	// OR 型复合条件拆序贯（len 守卫在前，防下方 [0] 越界——Equal 失败即 Goexit，守卫语义等价）
	testutil.Equal(t, len(ownerEntries), 1, "双方各应 1 条目: owner=%d waiter=%d", len(ownerEntries), len(waiterEntries))
	testutil.Equal(t, len(waiterEntries), 1, "双方各应 1 条目: owner=%d waiter=%d", len(ownerEntries), len(waiterEntries))
	// 重扫的等待方 hit=false（真扫，不记「缓存命中」日志）；owner 也 hit=false
	for i, h := range hits {
		testutil.Equal(t, h, false, "调用方 %d 应 hit=false（真扫），实际 true", i)
	}
	testutil.Equal(t, inflightLen(), 0, "扫描结束后在途航班应清空，剩余 %d", inflightLen())
}

// InvalidatePath 在途窗口（复核 P2-3 补锁，与上方 InvalidateCache 版 Rescans 对仗）：
// 子目录扫描在途期间失效**父目录**——子孙 keyVersions bump 臂（HasPrefix(kstr, key+sep)）
// 递增子目录版本 → 该在途子扫的 Store 被版本守卫丢弃（在途脏读不得入缓存），
// 下次调用必 miss 重扫。InvalidateCache 版只锁了「同目录航班内等待方」，
// 「父目录失效 × 子目录在途」交叉场景此前无回归锁。
func TestInvalidatePath_DuringInFlightDescendantScan(t *testing.T) {
	InvalidateCache()
	walkCount.Store(0)

	base := t.TempDir()
	sub := filepath.Join(base, "sub")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(sub, "a.ysm"), []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}

	// 钩子挂住子目录扫描的在途航班（walk 起点阻塞，版本戳已在进入时捕获）
	ownerStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	setWalkStartHook(func() {
		select {
		case ownerStarted <- struct{}{}:
		default:
		}
		<-release
	})
	defer setWalkStartHook(nil)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = ScanEntriesWithHit(sub)
	}()
	<-ownerStarted

	// 子扫在途期间失效父目录：子孙 bump 臂递增 sub 的 keyVersions
	InvalidatePath(base)
	close(release)
	wg.Wait()

	// 被失效的在途结果不得入缓存：下次调用必 miss 重扫（新增文件可见，非陈旧读）
	if err := os.WriteFile(filepath.Join(sub, "b.ysm"), []byte("x"), perm); err != nil {
		testutil.NoError(t, err)
	}
	entries, hit := ScanEntriesWithHit(sub)
	testutil.Equal(t, hit, false, "InvalidatePath 失效的在途子扫结果不得入缓存（下次调用应 miss）")
	testutil.Equal(t, len(entries), 2, "重扫应见新文件（丢弃在途结果而非陈旧读）")
}
