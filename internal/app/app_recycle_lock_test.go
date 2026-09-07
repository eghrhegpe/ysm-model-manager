// ===== recycle 绑定 InstallLock 不变量测试（R24 review #3 / ADR-202 刀3 改造）=====
// R24 P3 修复后，回收站五绑定（MoveToRecycle/MoveToRecycleEx/RestoreFromRecycle/
// DeleteFromRecycle/EmptyRecycleBin）统一持 installer.InstallLock（非重入锁）——
// 两个不变量需固化：
//  1. 不得在已持 InstallLock 的路径内调用（重入即自死锁，R21 同型事故）；
//  2. 并发调用互斥串行（回收站操作与 sync/install 共享单锁闭环，无竞态）。
//
// ADR-202 刀3：锁协议断言注入 recordingLocker stub（t.Cleanup 恢复全局 InstallLocker），
// 确定性触发、零 goroutine/超时/手动释放编排（替代 685829f70 式脆弱补丁）。
package app

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/installer"
)

// recordingLocker 记录 Lock/Unlock 调用与重入请求的 stub 锁（ADR-202 刀3）。
// 非阻塞（不会自死锁），专供锁协议断言：验证绑定确实请求持锁、且在已持锁
// 路径内调用会触发重入请求（R21 同型事故防护）。
type recordingLocker struct {
	mu        sync.Mutex
	locked    bool
	lockCalls int
	reentrant bool
}

func (r *recordingLocker) Lock() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.locked {
		r.reentrant = true
	}
	r.locked = true
	r.lockCalls++
}

func (r *recordingLocker) Unlock() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.locked = false
}

// TestRecycleBindings_NonReentrantUnderLock 固定「非重入」不变量：
// 绑定必须请求持锁（lockCalls > 0）；已持锁路径内调用必须触发重入请求
// （reentrant=true，若绑定漏加锁或语义漂移则断言失败）。
func TestRecycleBindings_NonReentrantUnderLock(t *testing.T) {
	stub := &recordingLocker{}
	installer.InstallLocker = stub
	t.Cleanup(func() { installer.InstallLocker = &installer.InstallLock })

	a := &App{}
	src := filepath.Join(t.TempDir(), "model.ysm")

	stub.Lock() // 模拟外层已持锁路径
	_ = a.MoveToRecycle(src)
	stub.Unlock()

	if stub.lockCalls == 0 {
		t.Fatal("MoveToRecycle 未请求持锁（锁契约回归：绑定不再持 InstallLock）")
	}
	if !stub.reentrant {
		t.Fatal("非重入契约失效：已持锁路径内调用未触发重入请求（R21 同型事故防护）")
	}
}

// TestRecycleBindings_ConcurrentLockedOps 并发冒烟（-race 下验证共享单锁互斥）：
// 多 goroutine 并发调用持锁绑定，断言全部完成且无数据竞争——锁契约回归（如某
// 绑定漏加锁导致共享状态竞态）会被 -race 检出。带超时：锁逻辑回归导致死锁时
// 快速失败而非套件挂 10 分钟（code_review P2）。
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
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("并发持锁操作超时（疑似死锁：锁契约回归）")
	}
}
