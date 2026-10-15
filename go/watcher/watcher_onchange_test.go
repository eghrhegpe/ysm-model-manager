// ===== watcher onChange UI 通知回归锁（止血 2026-10-15 A3：watcher 不驱动 UI）=====
// 覆盖：文件变更 → 防抖 → onChange 触发（无整合包也触发——UI 刷新语义独立于同步）；
// 未注入回调的 nil 守卫（CLI/测试路径不崩、运行态不受影响）。
package watcher

import (
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/internal/testutil"
)

// 1. 文件变更 → 800ms 防抖（测试 init 已缩至 50ms）→ onChange 触发。
// mcRoot 用空目录（零整合包）：证明 onChange 不依赖 syncAll 的实例短路判断。
func TestOnChange_FiresOnFileChange(t *testing.T) {
	repoDir := t.TempDir()
	var onChangeCount atomic.Int32
	w := New(repoDir, t.TempDir(), mockScanFunc)
	w.SetOnChange(func() { onChangeCount.Add(1) })
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	defer w.Stop()
	w.WaitReady()

	if err := os.WriteFile(filepath.Join(repoDir, "test.ysm"), []byte("test"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	testutil.WaitForCall(t, &onChangeCount, 3*time.Second)
}

// 2. 未注入回调（New 后不调 SetOnChange）：文件变更不崩、运行态不变（nil 守卫）
func TestOnChange_NilGuard(t *testing.T) {
	repoDir := t.TempDir()
	w := New(repoDir, t.TempDir(), mockScanFunc)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	defer w.Stop()
	w.WaitReady()

	if err := os.WriteFile(filepath.Join(repoDir, "x.ysm"), []byte("x"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	// 跨过防抖窗口（测试 50ms）+ 余量：nil 回调路径不 panic、watcher 保持运行
	time.Sleep(300 * time.Millisecond)
	if !w.IsRunning() {
		t.Error("onChange 未注入时 watcher 应保持运行态")
	}
}

// 3. 快速连发事件合并为一轮 onChange（防抖合并语义，与 TestDebounceMergesRapidEvents 同判据）
func TestOnChange_MergesRapidEvents(t *testing.T) {
	repoDir := t.TempDir()
	var onChangeCount atomic.Int32
	w := New(repoDir, t.TempDir(), mockScanFunc)
	w.SetOnChange(func() { onChangeCount.Add(1) })
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	defer w.Stop()
	w.WaitReady()

	// 防抖窗口（测试 50ms）内连发 3 个变更 → 只应触发 1 轮 onChange
	for _, name := range []string{"a.ysm", "b.ysm", "c.ysm"} {
		if err := os.WriteFile(filepath.Join(repoDir, name), []byte("x"), 0o644); err != nil {
			testutil.NoError(t, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	// 等一轮触发 + 余量（若防抖失效，多次触发会 >1）
	testutil.WaitForCall(t, &onChangeCount, 3*time.Second)
	time.Sleep(500 * time.Millisecond)
	if got := onChangeCount.Load(); got > 1 {
		t.Errorf("防抖窗口内连发事件应合并为 1 轮 onChange，got %d", got)
	}
}
