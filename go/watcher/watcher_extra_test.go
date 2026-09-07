package watcher

import (
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/types"

	"github.com/fsnotify/fsnotify"
)

// —— isNoiseEvent 纯函数表驱动 ——

func TestIsNoiseEvent(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		// 临时/锁/下载中文件 → 噪声
		{name: "~$test.ysm", want: true},
		{name: filepath.Join("dir", "~$hidden.ysm"), want: true}, // 前缀判断在 base 名上
		{name: "a.tmp", want: true},
		{name: "b.temp", want: true},
		{name: "c.swp", want: true},
		{name: "d.crdownload", want: true},
		{name: "e.part", want: true},
		{name: filepath.Join("sub", "f.tmp"), want: true},
		{name: "F.TMP", want: true}, // 大写扩展名（base 已转小写）
		// 正常模型/状态文件 → 非噪声
		{name: "foo.ysm", want: false},
		{name: "foo.ysm.ban", want: false},
		{name: "foo.tmp2", want: false},      // 不是 .tmp 后缀
		{name: "~foo.ysm", want: false},      // 只有 ~ 没有 $
		{name: "noise.tmp.bak", want: false}, // 以 .bak 结尾
	}
	for _, tt := range tests {
		if got := isNoiseEvent(tt.name); got != tt.want {
			t.Errorf("isNoiseEvent(%q) = %v, want %v", tt.name, got, tt.want)
		}
	}
}

// —— New 带 clearCacheFn 的分支 ——

func TestNewWithClearCacheFn(t *testing.T) {
	cleared := false
	w := New(t.TempDir(), t.TempDir(), mockScanFunc, func() { cleared = true })
	if w.clearCacheFn == nil {
		t.Fatal("clearCacheFn not saved")
	}
	w.clearCacheFn()
	if !cleared {
		t.Fatal("clearCacheFn not called")
	}
}

// —— syncAll 直接调用（同步执行，无需真实事件等待） ——

// TestSyncAllNotRunning 未运行时调用 syncAll 应立即返回，不触发任何扫描
func TestSyncAllNotRunning(t *testing.T) {
	var calls atomic.Int32
	scanFn := func(string) []types.ModelEntry { calls.Add(1); return nil }
	w := New(t.TempDir(), setupMinecraftRoot(t), scanFn)
	w.syncAll()
	if calls.Load() != 0 {
		t.Fatalf("syncAll should not trigger scan when not running (called %d times)", calls.Load())
	}
}

// TestSyncAllEmptyInstances 无整合包（versions/ 缺失）时返回，不触发扫描
func TestSyncAllEmptyInstances(t *testing.T) {
	var calls atomic.Int32
	scanFn := func(string) []types.ModelEntry { calls.Add(1); return nil }
	w := New(t.TempDir(), t.TempDir(), scanFn) // mcRoot 无 versions/ → 0 实例
	w.running = true
	w.syncAll()
	if calls.Load() != 0 {
		t.Fatalf("syncAll should not trigger scan without instances (called %d times)", calls.Load())
	}
	if w.syncRunning {
		t.Fatal("syncRunning still true after syncAll returned")
	}
}

// TestSyncAllPanicRecovery scanFn panics, syncAll recovers, serial state not stuck
func TestSyncAllPanicRecovery(t *testing.T) {
	panicScan := func(string) []types.ModelEntry { panic("boom: scanFn error") }
	w := New(t.TempDir(), setupMinecraftRoot(t), panicScan)
	w.running = true
	w.syncAll() // 不应 panic 传播
	if w.syncRunning {
		t.Fatal("syncRunning still true after panic recovery")
	}
	// 恢复后仍可继续正常同步
	var calls atomic.Int32
	w.scanFn = func(string) []types.ModelEntry { calls.Add(1); return nil }
	w.syncAll()
	if calls.Load() == 0 {
		t.Fatal("syncAll cannot execute again after panic")
	}
	if w.syncRunning {
		t.Fatal("syncRunning still true after second syncAll")
	}
}

// TestSyncAllSyncsInstances 完整同步路径：仓库 .ban 状态实际同步到整合包 custom 目录
// 覆盖：clearCacheFn 回调、Exists=false 实例跳过、SyncToggleStatus 禁用重命名、总数日志
func TestSyncAllSyncsInstances(t *testing.T) {
	repoDir := t.TempDir()
	// 仓库：foo.ysm.ban（已禁用）+ bar.ysm（启用中）
	if err := os.WriteFile(filepath.Join(repoDir, "foo.ysm.ban"), []byte("foo"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoDir, "bar.ysm"), []byte("bar"), 0644); err != nil {
		t.Fatal(err)
	}

	mcDir := setupMinecraftRoot(t)
	customDir := filepath.Join(mcDir, "versions", "1.20.1-Fabric", "config", "yes_steve_model", "custom")
	// 整合包：foo.ysm（应被禁用为 .ban）+ bar.ysm（状态已一致，不动）
	if err := os.WriteFile(filepath.Join(customDir, "foo.ysm"), []byte("foo"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(customDir, "bar.ysm"), []byte("bar"), 0644); err != nil {
		t.Fatal(err)
	}
	// 无 custom 目录的版本 → Exists=false 实例，应被跳过
	if err := os.MkdirAll(filepath.Join(mcDir, "versions", "vanilla2"), 0755); err != nil {
		t.Fatal(err)
	}

	var calls atomic.Int32
	var cacheClears atomic.Int32
	scanFn := func(dir string) []types.ModelEntry {
		calls.Add(1)
		return []types.ModelEntry{
			{Name: "foo.ysm.ban", Path: filepath.Join(repoDir, "foo.ysm.ban")},
			{Name: "bar.ysm", Path: filepath.Join(repoDir, "bar.ysm")},
		}
	}
	w := New(repoDir, mcDir, scanFn, func() { cacheClears.Add(1) })
	w.running = true
	w.syncAll()

	if cacheClears.Load() != 1 {
		t.Fatalf("clearCacheFn should be called 1 time, got %d", cacheClears.Load())
	}
	if _, err := os.Stat(filepath.Join(customDir, "foo.ysm.disabled")); err != nil {
		t.Errorf("foo.ysm not disabled (expected foo.ysm.disabled): %v", err)
	}
	if _, err := os.Stat(filepath.Join(customDir, "foo.ysm")); !os.IsNotExist(err) {
		t.Error("foo.ysm should have been renamed to .disabled")
	}
	if _, err := os.Stat(filepath.Join(customDir, "bar.ysm")); err != nil {
		t.Errorf("bar.ysm should not be changed: %v", err)
	}
	if w.syncRunning {
		t.Fatal("syncRunning still true after syncAll returned")
	}
}

// TestSyncAllSyncError SyncToggleStatus error (repo scan empty) logs and continues
func TestSyncAllSyncError(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)
	customDir := filepath.Join(mcDir, "versions", "1.20.1-Fabric", "config", "yes_steve_model", "custom")
	if err := os.WriteFile(filepath.Join(customDir, "foo.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	var calls atomic.Int32
	scanFn := func(dir string) []types.ModelEntry {
		n := calls.Add(1)
		if n == 1 {
			// 第一次调用（syncAll 空仓库短路检查）：有文件 → 继续深入
			return []types.ModelEntry{{Name: "foo.ysm", Path: filepath.Join(repoDir, "foo.ysm")}}
		}
		// 第二次调用（SyncToggleStatus 内）：仓库扫描为空 → 触发错误路径
		return nil
	}
	w := New(repoDir, mcDir, scanFn)
	w.running = true
	w.syncAll() // 不应 panic 传播
	if calls.Load() != 2 {
		t.Fatalf("scanFn should be called 2 times (short-circuit + SyncToggleStatus), got %d", calls.Load())
	}
	if w.syncRunning {
		t.Fatal("syncRunning still true after syncAll returned")
	}
}

// TestDebounceSyncAfterStopDoesNotArm Stop 后 loop 消费残余事件时不再武装计时器
// （running 守卫）——否则「Stop→立即 Start」后旧代计时器 firing 会读到新 running=true
// 而误触发一次多余同步（跨代事件/假活）
func TestDebounceSyncAfterStopDoesNotArm(t *testing.T) {
	var calls atomic.Int32
	scanFn := func(string) []types.ModelEntry { calls.Add(1); return nil }
	w := New(t.TempDir(), setupMinecraftRoot(t), scanFn)
	w.running = false // 模拟 Stop 完成后的状态
	w.debounceSync()
	w.mu.Lock()
	armed := w.debounce != nil
	w.mu.Unlock()
	if armed {
		t.Fatal("debounceSync still armed timer after Stop (missing running guard)")
	}
	time.Sleep(debounceDelay + 100*time.Millisecond)
	if calls.Load() != 0 {
		t.Fatalf("no sync should trigger after Stop, scanFn called %d times", calls.Load())
	}
}

// TestStopClearsDebounceTimer Stop 必须清掉已武装的防抖计时器引用，
// 避免「Stop→立即 Start」后旧代计时器在新代存活期间 firing
func TestStopClearsDebounceTimer(t *testing.T) {
	w := New(t.TempDir(), setupMinecraftRoot(t), mockScanFunc)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	w.debounceSync() // 直接武装计时器（running=true）
	w.mu.Lock()
	armed := w.debounce != nil
	w.mu.Unlock()
	if !armed {
		t.Fatal("precondition failed: debounceSync did not arm timer")
	}
	w.Stop()
	w.mu.Lock()
	left := w.debounce
	w.mu.Unlock()
	if left != nil {
		t.Fatal("debounce timer reference not cleared after Stop")
	}
}

// TestSyncAllEmptyRepoShortCircuit 有整合包但仓库扫描为空 → 短路返回，不进入
// SyncToggleStatus 循环（scanFn 仅被短路检查调用 1 次）
func TestSyncAllEmptyRepoShortCircuit(t *testing.T) {
	var calls atomic.Int32
	scanFn := func(string) []types.ModelEntry {
		calls.Add(1)
		return nil // 空仓库
	}
	w := New(t.TempDir(), setupMinecraftRoot(t), scanFn) // 仓库为空 + 有 1 个实例
	w.running = true
	w.syncAll()
	if calls.Load() != 1 {
		t.Fatalf("empty repo short-circuit should call scanFn 1 time, got %d", calls.Load())
	}
	if w.syncRunning {
		t.Fatal("syncRunning still true after syncAll returned")
	}
}

// TestSyncAllNoClearCacheWithoutInstances 无整合包（versions/ 缺失）时不应清空缓存
// （回归：clearCacheFn 调用被正确放在 ListVersions/len==0 判断之后）
func TestSyncAllNoClearCacheWithoutInstances(t *testing.T) {
	var cacheClears atomic.Int32
	w := New(t.TempDir(), t.TempDir(), mockScanFunc, func() { cacheClears.Add(1) })
	w.running = true
	w.syncAll()
	if cacheClears.Load() != 0 {
		t.Fatalf("clearCacheFn should not be called without instances, got %d times", cacheClears.Load())
	}
}

// —— loop 直接注入（真实 fsnotify.Watcher 提供 channel，避免长等待） ——

// TestLoopErrorEvent loop 收到错误事件时记录日志并继续运行
func TestLoopErrorEvent(t *testing.T) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer fw.Close()
	w := &Watcher{
		w:         fw,
		filesRoot: t.TempDir(),
		mcRoot:    setupMinecraftRoot(t),
		scanFn:    mockScanFunc,
		done:      make(chan struct{}),
		loopDone:  make(chan struct{}),
	}
	go w.loop()
	// Errors 为无缓冲 channel：发送完成即代表 loop 已收到并处理（日志）完
	w.w.Errors <- errors.New("injected listener error for testing")
	close(w.done)
	<-w.loopDone
}

// TestLoopNoiseEventFiltered 噪声事件被 loop 过滤，不触发防抖同步；
// 用真实事件（FIFO 消费顺序）做同步点，断言全程仅 1 次同步调用
func TestLoopNoiseEventFiltered(t *testing.T) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatal(err)
	}
	defer fw.Close()

	var calls atomic.Int32
	scanFn := func(string) []types.ModelEntry { calls.Add(1); return nil }
	w := &Watcher{
		w:         fw,
		filesRoot: t.TempDir(),
		mcRoot:    setupMinecraftRoot(t),
		scanFn:    scanFn,
		done:      make(chan struct{}),
		loopDone:  make(chan struct{}),
		running:   true,
	}
	go w.loop()

	// 注入噪声事件（Events 为有缓冲 channel），随后注入真实事件作为 FIFO 同步点
	w.w.Events <- fsnotify.Event{Name: filepath.Join("models", "~$tmp.ysm"), Op: fsnotify.Create}
	w.w.Events <- fsnotify.Event{Name: filepath.Join("models", "dl.part"), Op: fsnotify.Write}
	w.w.Events <- fsnotify.Event{Name: filepath.Join("models", "real.ysm"), Op: fsnotify.Create}

	// 等到真实事件触发的防抖计时器就绪 → 前序噪声事件已被 loop 消费（channel FIFO）
	deadline := time.Now().Add(2 * time.Second)
	for {
		w.mu.Lock()
		armed := w.debounce != nil
		w.mu.Unlock()
		if armed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("debounce timer not ready within timeout")
		}
		time.Sleep(20 * time.Millisecond)
	}
	// 防抖窗口走完后只应有真实事件触发的 1 次同步——噪声事件若漏过滤会多于 1 次
	time.Sleep(debounceDelay + 300*time.Millisecond)
	if n := calls.Load(); n != 1 {
		t.Fatalf("noise events not filtered: %d sync calls (expected only 1 from real event)", n)
	}
	fw.Close()
	<-w.loopDone
}
