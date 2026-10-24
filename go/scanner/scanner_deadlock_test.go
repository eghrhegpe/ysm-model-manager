// ===== notifyCacheInvalidated 重入死锁回归测试 =====
package scanner

import (
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/internal/testutil"
)

// TestNotifyCacheInvalidated_NoReentrantDeadlock 验证：
// 回调内调用 OnCacheInvalidated（重入 cacheInvalidatorsMu）时不会自死锁。
// 旧实现持锁调回调 → 回调内 OnCacheInvalidated 尝试 Lock → self-deadlock。
// 修复后：notifyCacheInvalidated 在锁外复制回调切片，释放锁后再调回调。
func TestNotifyCacheInvalidated_NoReentrantDeadlock(t *testing.T) {
	done := make(chan struct{})
	var mu sync.Mutex
	reentered := false

	// 注册一个会重入 OnCacheInvalidated 的回调
	// （模拟派生缓存清理钩子内部注册新的回调）
	OnCacheInvalidated(func() {
		// 重入：尝试再次注册回调（会 Lock cacheInvalidatorsMu）
		OnCacheInvalidated(func() {})
		mu.Lock()
		reentered = true
		mu.Unlock()
	})

	go func() {
		defer close(done)
		InvalidateCache() // 触发 notifyCacheInvalidated
	}()

	// select 超时分支无法映射值断言：改 timedOut 标志 + 收尾 Equal
	timedOut := false
	select {
	case <-done:
		// 正常返回，无死锁
	case <-time.After(5 * time.Second):
		timedOut = true
	}
	testutil.Equal(t, timedOut, false, "notifyCacheInvalidated 重入死锁：回调内 OnCacheInvalidated 自死锁")

	// 验证回调确实执行了重入
	mu.Lock()
	defer mu.Unlock()
	testutil.Equal(t, reentered, true, "回调内部重入 OnCacheInvalidated 未执行")
}
