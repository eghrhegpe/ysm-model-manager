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

func init() {
	debounceDelay = 50 * time.Millisecond
}

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

// waitForCall 轮询等待 scanFn 被调用（替代固定 sleep，事件传播不拖长测试时长）
func waitForCall(t *testing.T, c *atomic.Int32, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if c.Load() > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("scanFn 未在超时内被调用")
}

func TestNew(t *testing.T) {
	w := New("/tmp/repo", "/tmp/mc", mockScanFunc)
	if w == nil {
		t.Fatal("New() = nil")
	}
	if w.filesRoot != "/tmp/repo" {
		t.Errorf("filesRoot = %q", w.filesRoot)
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
	// 生产语义：Start 对不存在的 repoRoot 不报错（WalkDir 失败仅 log 后返回 nil），
	// 验证「无效路径不崩溃、watcher 正常进入运行态」（原测试 if err==nil 恒过是空断言）
	w := New("/nonexistent/path", "/tmp/mc", mockScanFunc)
	if err := w.Start(); err != nil {
		t.Fatalf("Start(/nonexistent/path) 应容忍无效路径: %v", err)
	}
	if !w.IsRunning() {
		t.Fatal("Start 后 IsRunning() = false，watcher 未进入运行态")
	}
	w.Stop()
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

	// 条件等待防抖（800ms）+ syncAll 执行，替代固定 sleep
	waitForCall(t, &callCount, 3*time.Second)
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

	waitForCall(t, &callCount, 3*time.Second)
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

	waitForCall(t, &callCount, 3*time.Second)

	// waitForCall 在首个同步调用出现时即返回——此时
	// 后续事件的防抖窗口（debounceDelay=800ms）尚未走完，直接采样 n 会把「防抖失效」
	// （每个事件各触发一次）误判为合并成功（n=1）。等待防抖窗口 + 余量后再采样
	time.Sleep(debounceDelay + 200*time.Millisecond)

	n := callCount.Load()
	// 原 `if n > 3 { t.Logf(...) }`——n<=3 静默通过、n>3 只打日志，
	// **永远不会失败**（防抖合并效果完全未验证）；改硬断言：5 次快速创建应合并到 <5 次
	if n >= 5 {
		t.Errorf("防抖合并失效：%d 次文件创建 → %d 次同步调用（期望合并 < 5）", 5, n)
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
	waitForCall(t, &callCount, 3*time.Second)
}

// TestSyncAllSerialized 并发触发多次同步应串行执行（防抖合并调度，syncAll 合并执行）
func TestSyncAllSerialized(t *testing.T) {
	repoDir := t.TempDir()
	// 仓库放真实模型文件 + custom 目录放同名文件（状态一致，SyncToggleStatus 不产生
	// rename 副作用）：scanFn 返回非空条目使空仓库短路不触发，SyncToggleStatus 循环
	// 真实执行、scanFn 被多次调用——修复前 scanFn 恒返 nil，短路路径只串行调 1 次，
	// maxConcurrent 恒为 1，断言从未被挑战（空断言，watcher 子代理审计发现）
	if err := os.WriteFile(filepath.Join(repoDir, "bar.ysm"), []byte("bar"), 0644); err != nil {
		t.Fatal(err)
	}
	mcDir := setupMinecraftRoot(t)
	customDir := filepath.Join(mcDir, "versions", "1.20.1-Fabric", "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(customDir, "bar.ysm"), []byte("bar"), 0644); err != nil {
		t.Fatal(err)
	}

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
		return []types.ModelEntry{
			{Name: "bar.ysm", Path: filepath.Join(repoDir, "bar.ysm")},
		}
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

// TestCreateSubdirTriggersSync 回归（锐评 #5）：Start 后新建子目录，fsnotify 非递归
// 不会自动监听新目录——子目录内文件变更必须能触发同步（修复前漏报，本测试会超时失败）。
func TestCreateSubdirTriggersSync(t *testing.T) {
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

	// 级联创建两层新目录（mkdir -p 场景：事件到达时目录树已就位，须递归补监听）
	sub := filepath.Join(repoDir, "nested")
	if err := os.MkdirAll(filepath.Join(sub, "deep"), 0755); err != nil {
		t.Fatal(err)
	}
	// 给 loop 补监听新目录留传播时间（Create 事件 → watchNewDir WalkDir Add）
	time.Sleep(300 * time.Millisecond)

	// 基线归零：目录创建本身已触发过一次同步，归零确保断言只统计子目录内变更那一次
	callCount.Store(0)
	// 多文件间隔写入，规避「写入落在补监听完成前」的窗口（任一命中即通过）
	for i := 0; i < 3; i++ {
		f := filepath.Join(sub, "deep", "child"+string(rune('0'+i))+".ysm")
		if err := os.WriteFile(f, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		time.Sleep(150 * time.Millisecond)
	}
	waitForCall(t, &callCount, 3*time.Second)
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
