// ===== conflict.go R27 code_review 修正（P2-1/P2-3）覆盖率补测 =====
// 锁契约已收敛为文档约束（R27 code_review 否决运行时 panic 硬约束：
// TryLock 检测不可靠 + 生产 panic 不可接受），不再有 assertInstallLock；
// 本文件测 ResolveConflictsLocked 本体逻辑 + HashFailed 条目不自动处置。
package sync

import (
	"testing"

	"ysm-model-manager/go/installer"
)

// 持锁调用 ResolveConflictsLocked：空冲突返回全 0。
// 锁契约现为文档约束（调用方须自行确保持锁），持锁路径仍须正确放行。
func TestResolveConflictsLocked_HeldLock(t *testing.T) {
	installer.InstallLock.Lock()
	defer installer.InstallLock.Unlock()
	resolved, failed, manual := ResolveConflictsLocked(nil, ResolveManual, "", "")
	if resolved != 0 || failed != 0 || manual != 0 {
		t.Fatalf("空冲突应全 0, got %d/%d/%d", resolved, failed, manual)
	}
}

// HashFailed 条目（哈希计算失败）不覆盖 SuggestedStrategy，直接计入 manual：
// 此类条目本应人工审查，不允许随 defaultStrategy 自动处置（R27 code_review P2-1 修复）。
// 默认策略刻意设为 ResolveForceRemote——若 HashFailed 分支失效，条目会按默认策略
// 自动覆盖（对不存在的源走 CopyFile → failed++）；分支生效则直接 manual=1。
func TestResolveConflictsLocked_HashFailedCountsManual(t *testing.T) {
	conflicts := []FileConflict{
		{
			Path:              "hash-fail.ysm",
			Type:              ConflictContentModified,
			SuggestedStrategy: ResolveManual,
			HashFailed:        true,
		},
	}
	resolved, failed, manual := ResolveConflictsLocked(conflicts, ResolveForceRemote, t.TempDir(), t.TempDir())
	if resolved != 0 || failed != 0 || manual != 1 {
		t.Fatalf("HashFailed 条目应只计 manual=1, got %d/%d/%d", resolved, failed, manual)
	}
}
