// ===== SyncToggleStatus .recycle 跳过 / isFileLocked errno33 补测 =====
// R18 审核修复链（71a13752）：SyncToggleStatus 回收站判定收敛为逐段 EqualFold
// （hasRecycleSegment 单测已在 sync_test.go 覆盖，此处补 walk 内调用行与
// isFileLocked 新增 ERROR_LOCK_VIOLATION(33) 分支）——变更行此前零覆盖。
package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"ysm-model-manager/go/types"
)

// TestSyncToggleStatus_RecycleSubtreeSkipped 覆盖 SyncToggleStatus walk 内的
// hasRecycleSegment 调用行：.recycle 子树中的 .ban 文件应被跳过（不参与启禁），
// 正常位置的 .ban 仍被启用。
func TestSyncToggleStatus_RecycleSubtreeSkipped(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	_ = os.MkdirAll(repoDir, 0755)
	_ = os.MkdirAll(filepath.Join(customDir, ".recycle"), 0755)

	// custom: .recycle 子树内一个 .ban（应跳过）+ 正常位置一个 .ban（应启用）
	_ = os.WriteFile(filepath.Join(customDir, ".recycle", "trash.ysm.ban"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "model_a.ysm.ban"), []byte("disabled"), 0644)
	// repo: model_a 正常 → custom 的 model_a.ysm.ban 应被启用
	_ = os.WriteFile(filepath.Join(repoDir, "model_a.ysm"), []byte("repo"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "model_a.ysm", Path: filepath.Join(repoDir, "model_a.ysm"), Hash: "hash_a"}}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	if enable != 1 {
		t.Errorf(".recycle 子树内 .ban 应被跳过、model_a 应启用 1 个, got enable=%d", enable)
	}
	if disable != 0 {
		t.Errorf("无禁用目标, got disable=%d", disable)
	}
}

// TestIsFileLocked_Errno33 新增 ERROR_LOCK_VIOLATION(33) 判定分支：
// errno 33 应判定锁定，无关 errno 不误判。
func TestIsFileLocked_Errno33(t *testing.T) {
	if !isFileLocked(fmt.Errorf("wrap: %w", syscall.Errno(33))) {
		t.Error("errno 33 (ERROR_LOCK_VIOLATION) 应判定为文件锁定")
	}
	if isFileLocked(fmt.Errorf("wrap: %w", syscall.Errno(2))) {
		t.Error("errno 2 (ENOENT) 不应判定为文件锁定")
	}
}
