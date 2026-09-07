// ===== SyncResourcesWithConfig 锁契约断言回归测试 =====
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/types"
)

// TestSyncResourcesWithConfig_ConflictPolicyRequiresLock 验证：
// 当 config.ConflictPolicy 非空时，SyncResourcesWithConfig 内部调用
// ResolveConflictsLocked（要求调用方已持 InstallLock）。若调用方未持锁，
// 测试构建下断言应 panic；持锁路径不应 panic。
func TestSyncResourcesWithConfig_ConflictPolicyRequiresLock(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instanceDir := filepath.Join(base, "instance")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(instanceDir, 0755)

	// 制造冲突条件：两侧各有一个同名文件
	_ = os.WriteFile(filepath.Join(globalDir, "conflict.ysm"), []byte("remote"), 0644)
	_ = os.WriteFile(filepath.Join(instanceDir, "conflict.ysm"), []byte("local"), 0644)

	// 子测试 1：未持锁 + ConflictPolicy 非空 → 断言应 panic
	t.Run("unlocked_should_panic", func(t *testing.T) {
		defer func() {
			r := recover()
			if r == nil {
				t.Fatal("未持锁调用 ConflictPolicy 非空应 panic（锁契约断言），但未 panic")
			}
			t.Logf("锁契约断言正确触发: %v", r)
		}()
		// 未持锁直接调用
		cfg := &types.SyncConfig{ConflictPolicy: string(ResolveForceRemote)}
		_ = SyncResourcesWithConfig(globalDir, instanceDir, cfg, "ysm")
	})

	// 子测试 2：持锁 + ConflictPolicy 非空 → 不应 panic
	t.Run("locked_no_panic", func(t *testing.T) {
		installer.InstallLocker.Lock()
		defer installer.InstallLocker.Unlock()
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("持锁调用不应 panic，但触发: %v", r)
			}
		}()
		cfg := &types.SyncConfig{ConflictPolicy: string(ResolveForceRemote)}
		_ = SyncResourcesWithConfig(globalDir, instanceDir, cfg, "ysm")
	})
}
