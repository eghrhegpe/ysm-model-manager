// ===== getTagsStore panic 后 sync.Once 永久锁死回归测试 =====
// 问题：sync.Once.Do 在 tags.NewStore panic 后永久"done"，后续所有调用返回 nil
// 修复：用 sync.Mutex + nil 检查替代 sync.Once
package app

import (
	"sync"
	"testing"
)

// TestGetTagsStore_PanicRecovery 验证：tagsStore 被置 nil 后（模拟 panic），
// getTagsStore 应重试初始化而非返回 nil。
// 旧实现（sync.Once）：Once 已 done → 永远返回 nil。
// 新实现（sync.Mutex + nil 检查）：发现 nil → 重试初始化。
func TestGetTagsStore_PanicRecovery(t *testing.T) {
	a := &App{}

	// 第一次调用：初始化 tagsStore
	_ = a.getTagsStore()

	// 模拟 panic 后状态：tagsStore 被置 nil（Once 已 done 但 store 为 nil）
	a.tagsStore = nil

	// 第二次调用：旧实现返回 nil（bug），新实现重试
	store := a.getTagsStore()
	if store == nil {
		t.Fatal("getTagsStore 在 tagsStore=nil 时应重试初始化，但返回了 nil（sync.Once 永久锁死）")
	}
}

// TestGetTagsStore_ConcurrentSafe 验证并发调用不 data race
func TestGetTagsStore_ConcurrentSafe(t *testing.T) {
	a := &App{}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = a.getTagsStore()
		}()
	}
	wg.Wait()
}
