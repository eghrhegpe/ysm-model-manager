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
// 当 config.ConflictPolicy 非空时，SyncResourcesWithConfig 内部通过
// assertInstallLockHeld 检测锁持有状态。
// 软断言语义：未持锁 → 记警告日志但不 panic（fail-soft 降级）；
// 持锁 → 静默通过。
func TestSyncResourcesWithConfig_ConflictPolicyRequiresLock(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instanceDir := filepath.Join(base, "instance")
	_ = os.MkdirAll(globalDir, 0755)
	_ = os.MkdirAll(instanceDir, 0755)

	// 制造冲突条件：两侧各有一个同名文件
	_ = os.WriteFile(filepath.Join(globalDir, "conflict.ysm"), []byte("remote"), 0644)
	_ = os.WriteFile(filepath.Join(instanceDir, "conflict.ysm"), []byte("local"), 0644)

	// 子测试 1：未持锁 + ConflictPolicy 非空 → 软断言应放行（fail-soft，不 panic）
	t.Run("unlocked_soft_pass", func(t *testing.T) {
		// 未持锁调用——软断言记日志但不 panic，函数正常完成
		cfg := &types.SyncConfig{ConflictPolicy: string(ResolveForceRemote)}
		_ = SyncResourcesWithConfig(globalDir, instanceDir, cfg, "ysm")
	})

	// 子测试 2：持锁 + ConflictPolicy 非空 → 静默通过
	t.Run("locked_silent", func(t *testing.T) {
		installer.InstallLocker.Lock()
		defer installer.InstallLocker.Unlock()
		cfg := &types.SyncConfig{ConflictPolicy: string(ResolveForceRemote)}
		_ = SyncResourcesWithConfig(globalDir, instanceDir, cfg, "ysm")
	})
}

// TestAssertInstallLockHeld_OwnerPrecision 直接验证 assertInstallLockHeld
// 的 owner-tracked 精度：他人 goroutine 持锁时返回 false（消除 TryLock 误判窗口）。
func TestAssertInstallLockHeld_OwnerPrecision(t *testing.T) {
	// 锁空闲：HasLock = false → assertInstallLockHeld = false
	if assertInstallLockHeld() {
		t.Fatal("锁空闲时 assertInstallLockHeld 应返回 false")
	}

	// 持锁：HasLock = true → assertInstallLockHeld = true
	installer.InstallLocker.Lock()
	if !assertInstallLockHeld() {
		t.Fatal("本 goroutine 持锁时 assertInstallLockHeld 应返回 true")
	}

	// 他人 goroutine 持锁（自锁后 spawn 新 goroutine 探测）：
	// 新 goroutine 的 HasLock = false（owner 不匹配）→ 精确识别非持有者
	ch := make(chan bool, 1)
	go func() {
		ch <- assertInstallLockHeld()
	}()
	otherSawHeld := <-ch
	if otherSawHeld {
		t.Fatal("他人 goroutine 持锁时，本 goroutine 的 assertInstallLockHeld 应返回 false（精确 owner 检测）")
	}

	installer.InstallLocker.Unlock()
}
