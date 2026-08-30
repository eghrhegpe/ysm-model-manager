// ========== 2026-08-31 watcher 审核回归测试 ==========
// TestSyncAllPanicResetsPending：syncAll panic 恢复路径必须复位 syncRunning、
// 清空 syncPending 并按 pending 语义串行续跑——防「panic 后状态残留」回归。
package watcher

import (
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

func TestSyncAllPanicResetsPending(t *testing.T) {
	root := t.TempDir()
	mcRoot := t.TempDir()
	// ListVersions 需要至少一个 Prism 实例（instances/{name}/.minecraft + ysm 子目录，
	// 否则 Exists=false 被 syncAll 跳过、走不到 scanFn）才会触达 panic 注入点
	mcDir := filepath.Join(mcRoot, "instances", "t1", ".minecraft")
	if err := os.MkdirAll(filepath.Join(mcDir, types.SubDirMap("ysm")), 0o755); err != nil {
		t.Fatal(err)
	}

	var calls atomic.Int32
	firstEntered := make(chan struct{})
	release := make(chan struct{})
	w := New(root, mcRoot, func(root string) []types.ModelEntry {
		if calls.Add(1) == 1 {
			close(firstEntered)
			<-release // 挂住第一轮，给主线程制造 syncPending 的时间窗
		}
		panic("scanFn boom")
	})

	// 不走 Start()（避免 fsnotify 依赖），直接置 running 满足 syncAll 入口守卫
	w.mu.Lock()
	w.running = true
	w.mu.Unlock()

	// 第一轮在后台 goroutine 跑（模拟 AfterFunc 调度），scanFn panic 被兜底 recover
	done := make(chan struct{})
	go func() { w.syncAll(); close(done) }()
	<-firstEntered

	// 第一轮执行中再触发一次 → 应仅置 syncPending=true，不并发重入
	w.syncAll()
	if !w.syncRunning {
		t.Fatal("第一轮执行中 syncRunning 应为 true")
	}
	if !w.syncPending {
		t.Fatal("重入应置 syncPending=true")
	}

	close(release) // 放行第一轮 → panic → recover → 应复位状态并续跑一轮（再次 panic，同样兜底）
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("第一轮 syncAll 未返回（panic 恢复路径卡死？）")
	}

	// 状态必须归零：panic 恢复不得残留 syncRunning / syncPending
	w.mu.Lock()
	running, pending := w.syncRunning, w.syncPending
	w.mu.Unlock()
	if running || pending {
		t.Fatalf("panic 恢复后状态残留: syncRunning=%v syncPending=%v", running, pending)
	}
	// 续跑语义：pending 在 panic 前已置位 → 恢复后应串行续跑（scanFn 第二次进入）
	if got := calls.Load(); got < 2 {
		t.Fatalf("panic 恢复后应按 pending 续跑一轮, scanFn 调用 %d 次", got)
	}
}
