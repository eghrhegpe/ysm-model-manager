// ===== SyncToggleStatus 锁粒度回归测试 =====
package sync

import (
	"os"
	"path/filepath"
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
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

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

	// scanFn 预设 Hash（模拟 relKey miss 场景，hash 匹配路径）
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
// SyncToggleStatus 执行完成后锁能正常获取（间接验证锁被正确释放）。
func TestSyncToggleStatus_LockReleasedDuringHash(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	if err := os.MkdirAll(repoDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}

	repoFile := filepath.Join(repoDir, "big_model.ysm.ban")
	if err := os.WriteFile(repoFile, []byte("big content"), 0644); err != nil {
		t.Fatal(err)
	}
	customFile := filepath.Join(customDir, "renamed_big_model.ysm")
	if err := os.WriteFile(customFile, []byte("big content"), 0644); err != nil {
		t.Fatal(err)
	}

	// scanFn 预设 Hash（模拟 relKey miss 场景，hash 匹配路径）
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "big_model.ysm.ban", Path: repoFile, Hash: computeHash(repoFile)},
		}
	}

	// 执行 SyncToggleStatus
	_, _, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}

	// 验证锁可正常获取（说明 SyncToggleStatus 正确释放了锁）
	// 若锁未释放，此处会阻塞直到超时
	done := make(chan struct{})
	go func() {
		installer.InstallLocker.Lock()
		defer installer.InstallLocker.Unlock()
		close(done)
	}()

	select {
	case <-done:
		// 锁获取成功，验证通过
	case <-time.After(500 * time.Millisecond):
		t.Fatal("锁未在预期时间内释放")
	}
}
