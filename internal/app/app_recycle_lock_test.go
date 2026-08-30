// ===== recycle 绑定 InstallLock 不变量测试（R24 review #3）=====
// R24 P3 修复后，回收站五绑定（MoveToRecycle/MoveToRecycleEx/RestoreFromRecycle/
// DeleteFromRecycle/EmptyRecycleBin）统一持 installer.InstallLock（非重入锁）——
// 两个不变量需固化：
//  1. 不得在已持 InstallLock 的路径内调用（重入即自死锁，R21 同型事故）；
//  2. 并发调用互斥串行（回收站操作与 sync/install 共享单锁闭环，无竞态）。
package app

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/installer"
)

// TestRecycleBindings_NonReentrantUnderLock 固定「非重入」不变量：
// 已持 InstallLock 时调用 MoveToRecycle 必须阻塞（不得返回）——若某次改动让绑定
// 不再持锁（回归），done 会立即关闭、本测试立刻失败；解锁后调用必须完成。
func TestRecycleBindings_NonReentrantUnderLock(t *testing.T) {
	a := &App{}
	src := filepath.Join(t.TempDir(), "model.ysm")

	installer.InstallLock.Lock()
	done := make(chan struct{})
	go func() {
		_ = a.MoveToRecycle(src)
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("持锁调用 MoveToRecycle 不应返回（非重入锁：已持 InstallLock 的路径内调用会自死锁，R21 同型）")
	case <-time.After(300 * time.Millisecond):
		// 预期：阻塞中（重入挂死被固定为已知不变量）
	}

	installer.InstallLock.Unlock()
	select {
	case <-done:
		// 解锁后正常完成
	case <-time.After(3 * time.Second):
		t.Fatal("解锁后 MoveToRecycle 应完成")
	}
}

// TestRecycleBindings_ConcurrentLockedOps 并发冒烟（-race 下验证共享单锁互斥）：
// 多 goroutine 并发调用持锁绑定，断言全部完成且无数据竞争——锁契约回归（如某
// 绑定漏加锁导致共享状态竞态）会被 -race 检出。
func TestRecycleBindings_ConcurrentLockedOps(t *testing.T) {
	a := &App{}
	base := t.TempDir()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			src := filepath.Join(base, fmt.Sprintf("m%d.ysm", n))
			_ = a.MoveToRecycle(src)
		}(i)
	}
	wg.Wait()
}
