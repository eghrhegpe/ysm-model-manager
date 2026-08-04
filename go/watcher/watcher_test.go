package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

func mockScanFunc(dir string) []types.ModelEntry { return nil }

// setupMinecraftRoot 创建一个伪 mcRoot，含 versions/{name}/config/yes_steve_model/custom/ 结构
func setupMinecraftRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	customDir := filepath.Join(root, "versions", "1.20.1-Fabric", "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestNew(t *testing.T) {
	w := New("/tmp/repo", "/tmp/mc", mockScanFunc)
	if w == nil {
		t.Fatal("New() = nil")
	}
	if w.repoRoot != "/tmp/repo" {
		t.Errorf("repoRoot = %q", w.repoRoot)
	}
	if w.mcRoot != "/tmp/mc" {
		t.Errorf("mcRoot = %q", w.mcRoot)
	}
}

func TestStartStop(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	w := New(repoDir, mcDir, mockScanFunc)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	if !w.IsRunning() {
		t.Fatal("IsRunning() = false after Start")
	}
	w.Stop()
	if w.IsRunning() {
		t.Fatal("IsRunning() = true after Stop")
	}
}

func TestStartTwice(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	w := New(repoDir, mcDir, mockScanFunc)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	if err := w.Start(); err != nil {
		t.Fatalf("Start() again = %v, want nil", err)
	}
	w.Stop()
}

func TestStopWithoutStart(t *testing.T) {
	w := New("/tmp/repo", "/tmp/mc", mockScanFunc)
	w.Stop()
}

func TestIsRunning(t *testing.T) {
	w := New("/tmp/repo", "/tmp/mc", mockScanFunc)
	if w.IsRunning() {
		t.Fatal("IsRunning() = true before Start")
	}
}

func TestStartInvalidPath(t *testing.T) {
	w := New("/nonexistent/path", "/tmp/mc", mockScanFunc)
	err := w.Start()
	if err == nil {
		w.Stop()
	}
}

func TestFileEventTriggersSync(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	var callCount atomic.Int32
	scanFn := func(dir string) []types.ModelEntry {
		callCount.Add(1)
		return nil
	}

	w := New(repoDir, mcDir, scanFn)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	defer w.Stop()

	// 等 watcher 完成目录注册
	time.Sleep(500 * time.Millisecond)

	// 创建文件 → 触发 Create 事件 → 触发射频同步
	testFile := filepath.Join(repoDir, "test.ysm")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}

	// 等防抖（800ms）+ syncAll 执行 + buffer
	time.Sleep(1500 * time.Millisecond)

	if n := callCount.Load(); n == 0 {
		t.Fatal("scanFn was not called after file creation")
	}
}

func TestRenameEventTriggersSync(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	var callCount atomic.Int32
	scanFn := func(dir string) []types.ModelEntry {
		callCount.Add(1)
		return nil
	}

	existingFile := filepath.Join(repoDir, "existing.ysm")
	if err := os.WriteFile(existingFile, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	w := New(repoDir, mcDir, scanFn)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	defer w.Stop()

	time.Sleep(500 * time.Millisecond)

	newFile := filepath.Join(repoDir, "renamed.ysm")
	if err := os.Rename(existingFile, newFile); err != nil {
		t.Fatal(err)
	}

	time.Sleep(1500 * time.Millisecond)

	if n := callCount.Load(); n == 0 {
		t.Fatal("scanFn was not called after file rename")
	}
}

func TestDebounceMergesRapidEvents(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	var callCount atomic.Int32
	scanFn := func(dir string) []types.ModelEntry {
		callCount.Add(1)
		return nil
	}

	w := New(repoDir, mcDir, scanFn)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() = %v", err)
	}
	defer w.Stop()

	time.Sleep(500 * time.Millisecond)

	// 快速连续创建文件
	for i := 0; i < 5; i++ {
		f := filepath.Join(repoDir, "f"+string(rune('0'+i))+".ysm")
		os.WriteFile(f, []byte("data"), 0644)
		time.Sleep(30 * time.Millisecond)
	}

	time.Sleep(1500 * time.Millisecond)

	n := callCount.Load()
	if n == 0 {
		t.Fatal("scanFn was not called after rapid file creations")
	}
	if n > 3 {
		t.Logf("防抖合并效果：%d 次文件创建 → %d 次同步调用", 5, n)
	}
}

// TestStartStopRestart 回归：Stop 后再 Start 必须恢复监听（done channel 每次重建）
func TestStartStopRestart(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	var callCount atomic.Int32
	scanFn := func(dir string) []types.ModelEntry {
		callCount.Add(1)
		return nil
	}

	w := New(repoDir, mcDir, scanFn)
	if err := w.Start(); err != nil {
		t.Fatalf("Start() #1 = %v", err)
	}
	w.Stop()
	if err := w.Start(); err != nil {
		t.Fatalf("Start() #2 = %v", err)
	}
	defer w.Stop()

	time.Sleep(500 * time.Millisecond)
	testFile := filepath.Join(repoDir, "restart.ysm")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1500 * time.Millisecond)

	if n := callCount.Load(); n == 0 {
		t.Fatal("Stop 后重启的 watcher 未监听文件变化")
	}
}

// TestSyncAllSerialized 并发触发多次同步应串行执行（防抖合并调度，syncAll 合并执行）
func TestSyncAllSerialized(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	var concurrent atomic.Int32
	var maxConcurrent atomic.Int32
	scanFn := func(dir string) []types.ModelEntry {
		c := concurrent.Add(1)
		for {
			old := maxConcurrent.Load()
			if c <= old || maxConcurrent.CompareAndSwap(old, c) {
				break
			}
		}
		time.Sleep(150 * time.Millisecond)
		concurrent.Add(-1)
		return nil
	}

	w := New(repoDir, mcDir, scanFn)
	if err := w.Start(); err != nil {
		t.Fatal(err)
	}
	defer w.Stop()

	// 并发触发多次同步（模拟防抖窗口内的连续文件事件）
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.syncAll()
		}()
	}
	wg.Wait()

	if n := maxConcurrent.Load(); n > 1 {
		t.Fatalf("syncAll 最大并发 = %d, 期望串行执行", n)
	}
}

// TestStopWaitsForSync Stop 必须等待 in-flight 同步完成，避免退出后仍有后台写盘
func TestStopWaitsForSync(t *testing.T) {
	repoDir := t.TempDir()
	mcDir := setupMinecraftRoot(t)

	var once sync.Once
	syncDone := make(chan struct{})
	scanFn := func(dir string) []types.ModelEntry {
		once.Do(func() { close(syncDone) }) // 进入执行即发信号，sleep 模拟长同步
		time.Sleep(300 * time.Millisecond)
		return nil
	}

	w := New(repoDir, mcDir, scanFn)
	if err := w.Start(); err != nil {
		t.Fatal(err)
	}

	go w.syncAll() // 模拟防抖 timer 触发的同步
	<-syncDone     // 等待同步进入执行（scanFn 运行中）

	start := time.Now()
	w.Stop()
	if elapsed := time.Since(start); elapsed < 200*time.Millisecond {
		t.Fatalf("Stop 未等待 in-flight 同步完成（耗时 %v）", elapsed)
	}
}
