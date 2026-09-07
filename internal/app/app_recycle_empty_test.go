// ===== findRecycleRoot 返回空串 → MoveToRecycle 以空 root 执行 =====
// 问题：findRecycleRoot 找不到根时返回空串，recycle.Move("", src) 以空 root 执行
// 修复：在 MoveToRecycle 入口加 root == "" 的 fail-fast 守卫
package app

import (
	"os"
	"path/filepath"
	"testing"
)

// TestMoveToRecycle_EmptyRootGuard 验证：当 findRecycleRoot 返回空串时，
// MoveToRecycle 应拒绝执行而非用空 root 调用 recycle.Move。
func TestMoveToRecycle_EmptyRootGuard(t *testing.T) {
	a := &App{}

	// 创建一个不在任何已知资源根下的文件
	tmpDir := t.TempDir()
	src := filepath.Join(tmpDir, "outside-root.ysm")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}

	// findRecycleRoot 对找不到根的文件返回空串
	root := a.findRecycleRoot(src)
	if root != "" {
		t.Skip("此文件恰好在已知资源根内，跳过")
	}

	// 修复前：MoveToRecycle 会用空 root 调用 recycle.Move
	// 修复后：MoveToRecycle 应在 root == "" 时直接返回错误
	err := a.MoveToRecycle(src)
	if err == nil {
		t.Fatal("MoveToRecycle 对 root==\"\" 的文件应返回错误（防止 recycle.Move(\"\", src) 静默执行）")
	}
}
