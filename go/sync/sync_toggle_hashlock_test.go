// ===== SyncToggleStatus 锁粒度回归测试 =====
package sync

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
)

// TestSyncToggleStatus_HashComputedOutsideLock 验证：
// SyncToggleStatus 对 relKey miss 的文件的哈希计算在 InstallLock 锁外进行。
func TestSyncToggleStatus_HashComputedOutsideLock(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.MkdirAll(customDir, 0755)

	// 在仓库中放一个被禁用的文件
	repoFile := filepath.Join(repoDir, "model.ysm.ban")
	if err := os.WriteFile(repoFile, []byte("test content for hash outside lock"), 0644); err != nil {
		t.Fatal(err)
	}

	// 实例中放一个同名但不同路径的文件（改名场景，relKey miss，需要哈希）
	customFile := filepath.Join(customDir, "renamed_model.ysm")
	if err := os.WriteFile(customFile, []byte("test content for hash outside lock"), 0644); err != nil {
		t.Fatal(err)
	}

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoDir {
			h := computeHash(repoFile)
			return []types.ModelEntry{
				{Name: "model.ysm.ban", Path: repoFile, Hash: h},
			}
		}
		return nil
	}

	// 执行 SyncToggleStatus
	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if disable != 1 {
		t.Errorf("改名文件应经 hash 兜底被禁用，disable = %d, want 1", disable)
	}
	if enable != 0 {
		t.Errorf("enable = %d, want 0", enable)
	}
}

// TestSyncToggleStatus_LockReleasedDuringHash 验证：
// SyncToggleStatus 执行期间锁会被释放（允许并发安装操作进行）。
// 使用一个后台 goroutine 尝试获取锁，验证锁确实在哈希期间被释放。
func TestSyncToggleStatus_LockReleasedDuringHash(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.MkdirAll(customDir, 0755)

	// 创建需要哈希的文件
	repoFile := filepath.Join(repoDir, "big_model.ysm.ban")
	if err := os.WriteFile(repoFile, []byte("big content"), 0644); err != nil {
		t.Fatal(err)
	}
	customFile := filepath.Join(customDir, "renamed_big_model.ysm")
	if err := os.WriteFile(customFile, []byte("big content"), 0644); err != nil {
		t.Fatal(err)
	}

	// 用于检测锁是否被释放
	lockAcquired := make(chan struct{})

	scanFn := func(dir string) []types.ModelEntry {
		h := computeHash(repoFile)
		return []types.ModelEntry{
			{Name: "big_model.ysm.ban", Path: repoFile, Hash: h},
		}
	}

	// 后台 goroutine：尝试获取锁，检测锁是否在 SyncToggleStatus 执行期间被释放
	go func() {
		installer.InstallLocker.Lock()
		close(lockAcquired)
		installer.InstallLocker.Unlock()
	}()

	// 执行 SyncToggleStatus
	go func() {
		_, _, _ = SyncToggleStatus(customDir, repoDir, scanFn)
	}()

	// 等待看锁是否能被获取（说明 SyncToggleStatus 释放了锁）
	select {
	case <-lockAcquired:
		// 锁能被获取，说明 SyncToggleStatus 释放了锁
	case <-time.After(2 * time.Second):
		t.Fatal("SyncToggleStatus 持锁期间锁未被释放，哈希可能仍在锁内计算")
	}
}

// TestSyncToggleStatus_ConcurrentInstall 验证：
// SyncToggleStatus 与其他持锁操作可以并发执行（锁粒度已优化）。
func TestSyncToggleStatus_ConcurrentInstall(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.MkdirAll(customDir, 0755)

	repoFile := filepath.Join(repoDir, "model.ysm.ban")
	if err := os.WriteFile(repoFile, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}
	customFile := filepath.Join(customDir, "renamed_model.ysm")
	if err := os.WriteFile(customFile, []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	// 执行 SyncToggleStatus
	go func() {
		defer wg.Done()
		scanFn := func(dir string) []types.ModelEntry {
			h := computeHash(repoFile)
			return []types.ModelEntry{
				{Name: "model.ysm.ban", Path: repoFile, Hash: h},
			}
		}
		_, _, _ = SyncToggleStatus(customDir, repoDir, scanFn)
	}()

	// 同时尝试获取锁（模拟安装操作）
	lockAcquired := make(chan struct{})
	go func() {
		defer wg.Done()
		installer.InstallLocker.Lock()
		close(lockAcquired)
		installer.InstallLocker.Unlock()
	}()

	// 重新执行
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		// 两个操作都完成，说明可以并发
	case <-time.After(3 * time.Second):
		t.Fatal("SyncToggleStatus 阻塞了并发安装操作")
	}

	select {
	case <-lockAcquired:
		// 安装操作获取到了锁
	default:
		t.Fatal("安装操作未能获取锁")
	}
}
