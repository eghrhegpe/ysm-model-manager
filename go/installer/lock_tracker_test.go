package installer

import (
	"sync"
	"testing"
)

// TestLockTracker_BasicLockUnlock 验证 Lock/Unlock 基本语义 + owner 追踪。
func TestLockTracker_BasicLockUnlock(t *testing.T) {
	var lt LockTracker
	if lt.HasLock() {
		t.Fatal("未持锁时 HasLock 应返回 false")
	}
	if lt.IsLocked() {
		t.Fatal("未持锁时 IsLocked 应返回 false")
	}

	lt.Lock()
	if !lt.HasLock() {
		t.Fatal("持锁后 HasLock 应返回 true")
	}
	if !lt.IsLocked() {
		t.Fatal("持锁后 IsLocked 应返回 true")
	}
	lt.Unlock()
	if lt.HasLock() {
		t.Fatal("释放锁后 HasLock 应返回 false")
	}
	if lt.IsLocked() {
		t.Fatal("释放锁后 IsLocked 应返回 false")
	}
}

// TestLockTracker_TryLock 验证 TryLock 非阻塞语义。
func TestLockTracker_TryLock(t *testing.T) {
	var lt LockTracker

	// 空闲时 TryLock 成功
	if !lt.TryLock() {
		t.Fatal("空闲锁 TryLock 应成功")
	}
	if !lt.HasLock() {
		t.Fatal("TryLock 成功后 HasLock 应返回 true")
	}
	lt.Unlock()

	// 已持锁时 TryLock 失败（自锁检测——本 goroutine 已持锁）
	lt.Lock()
	if lt.TryLock() {
		t.Fatal("已持锁时 TryLock 应失败（不可重入）")
	}
	lt.Unlock()
}

// TestLockTracker_CrossGoroutine_OtherHolds 验证 HasLock 的 owner 区分能力：
// goroutine A 持锁时，goroutine B 的 HasLock 应返回 false（消除 TryLock 误判窗口）。
func TestLockTracker_CrossGoroutine_OtherHolds(t *testing.T) {
	var lt LockTracker
	lt.Lock()
	defer lt.Unlock()

	// 从新 goroutine 探测：他人持锁时 HasLock() = false（旧 TryLock 探测会误判为 true）
	otherGoroutineSawLock := make(chan bool, 1)
	go func() {
		// B 视角：锁被 A 持有 → HasLock 必须为 false
		otherGoroutineSawLock <- lt.HasLock()
	}()
	sawLock := <-otherGoroutineSawLock
	if sawLock {
		t.Fatal("他人 goroutine 持锁时，本 goroutine HasLock 应返回 false（旧 TryLock 会误判为 true）")
	}
}

// TestLockTracker_CrossGoroutine_Free 验证锁空闲时其他 goroutine HasLock 也为 false。
func TestLockTracker_CrossGoroutine_Free(t *testing.T) {
	var lt LockTracker
	// 锁空闲
	otherSaw := make(chan bool, 1)
	go func() {
		otherSaw <- lt.HasLock()
	}()
	if <-otherSaw {
		t.Fatal("锁空闲时 HasLock 应返回 false")
	}
}

// TestLockTracker_SyncLockerInterface 验证 LockTracker 实现 sync.Locker 接口。
func TestLockTracker_SyncLockerInterface(t *testing.T) {
	var _ sync.Locker = &LockTracker{}
}

// TestLockTracker_SmokeConcurrent 多 goroutine 并发锁/解锁 1000 轮，
// 验证 owner 追踪不引入竞争（go test -race 下应零告警）。
func TestLockTracker_SmokeConcurrent(t *testing.T) {
	var lt LockTracker
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				lt.Lock()
				// 短暂忙等模拟临界区（无需真实睡眠）
				lt.Unlock()
			}
		}()
	}
	wg.Wait()
	if lt.IsLocked() {
		t.Fatal("所有 goroutine 完成后锁应空闲")
	}
}
