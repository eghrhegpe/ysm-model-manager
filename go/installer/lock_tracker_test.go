package installer

import (
	"sync"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestLockTracker_BasicLockUnlock 验证 Lock/Unlock 基本语义 + owner 追踪。
func TestLockTracker_BasicLockUnlock(t *testing.T) {
	var lt LockTracker
	testutil.Equal(t, lt.HasLock(), false, "未持锁时 HasLock 应返回 false")
	testutil.Equal(t, lt.IsLocked(), false, "未持锁时 IsLocked 应返回 false")

	lt.Lock()
	testutil.Equal(t, lt.HasLock(), true, "持锁后 HasLock 应返回 true")
	testutil.Equal(t, lt.IsLocked(), true, "持锁后 IsLocked 应返回 true")
	lt.Unlock()
	testutil.Equal(t, lt.HasLock(), false, "释放锁后 HasLock 应返回 false")
	testutil.Equal(t, lt.IsLocked(), false, "释放锁后 IsLocked 应返回 false")
}

// TestLockTracker_TryLock 验证 TryLock 非阻塞语义。
func TestLockTracker_TryLock(t *testing.T) {
	var lt LockTracker

	// 空闲时 TryLock 成功
	testutil.Equal(t, lt.TryLock(), true, "空闲锁 TryLock 应成功")
	testutil.Equal(t, lt.HasLock(), true, "TryLock 成功后 HasLock 应返回 true")
	lt.Unlock()

	// 已持锁时 TryLock 失败（自锁检测——本 goroutine 已持锁）
	lt.Lock()
	testutil.Equal(t, lt.TryLock(), false, "已持锁时 TryLock 应失败（不可重入）")
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
	testutil.Equal(t, sawLock, false, "他人 goroutine 持锁时，本 goroutine HasLock 应返回 false（旧 TryLock 会误判为 true）")
}

// TestLockTracker_CrossGoroutine_Free 验证锁空闲时其他 goroutine HasLock 也为 false。
func TestLockTracker_CrossGoroutine_Free(t *testing.T) {
	var lt LockTracker
	// 锁空闲
	otherSaw := make(chan bool, 1)
	go func() {
		otherSaw <- lt.HasLock()
	}()
	saw := <-otherSaw
	testutil.Equal(t, saw, false, "锁空闲时 HasLock 应返回 false")
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
				// 临界区须非空：staticcheck SA2001 无法区分「刻意的空临界区」与
				// 「Lock 后忘写操作」的笔误，故持锁期间真实读写受保护状态——
				// 顺带让 -race 能真正观测到「owner 追踪 + 受保护数据」的并发行为。
				if !lt.HasLock() {
					t.Error("持锁期间 HasLock 应为 true")
				}
				lt.Unlock()
			}
		}()
	}
	wg.Wait()
	testutil.Equal(t, lt.IsLocked(), false, "所有 goroutine 完成后锁应空闲")
}
