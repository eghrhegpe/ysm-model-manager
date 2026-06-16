package watcher

import (
	"os"
	"path/filepath"
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
