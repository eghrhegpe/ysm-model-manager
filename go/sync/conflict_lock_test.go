// ===== conflict.go 锁契约（R27 P2-3）覆盖率补测 =====
// ResolveConflictsLocked 的 assertInstallLock 硬约束：持锁调用放行、无锁调用 panic。
// 覆盖 assertInstallLock 调用行（block[265-270]）与其 TryLock 成功→panic 分支（block[319-321]）。
package sync

import (
	"testing"

	"ysm-model-manager/go/installer"
)

// 持锁调用 ResolveConflictsLocked：assertInstallLock 的 TryLock 因已持锁而阻塞，
// 判定「已持锁」放行，不触发 panic；覆盖 assertInstallLock 调用行（R27 P2-3）。
func TestResolveConflictsLocked_HeldLock(t *testing.T) {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	resolved, failed, manual := ResolveConflictsLocked(nil, ResolveManual, "", "")
	if resolved != 0 || failed != 0 || manual != 0 {
		t.Fatalf("空冲突应全 0, got %d/%d/%d", resolved, failed, manual)
	}
}

// 无锁调用 ResolveConflictsLocked：assertInstallLock 的 TryLock 成功（无人持锁）
// → 立即 Unlock 并 panic（锁契约违反）。recover 验证 panic 确实发生，
// 覆盖 TryLock 成功→panic 分支（block[319-321]）。
func TestResolveConflictsLocked_NoLockPanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("未持 InstallLock 调用 ResolveConflictsLocked 应 panic（锁契约违反）")
		}
	}()
	ResolveConflictsLocked(nil, ResolveManual, "", "")
}
