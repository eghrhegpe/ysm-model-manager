// ===== go/recycle 清空/去重单测（ADR-003 补充下沉验证）=====
package recycle

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestRemoveRepoDuplicates_RemovesRepoFilesOnly(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "inst")
	repoRoot := filepath.Join(base, "repo")
	recycleRoot := filepath.Join(base, "ysm")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(repoRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(recycleRoot, 0755); err != nil {
		t.Fatal(err)
	}
	// 仓库文件：repo 有 m.ysm，inst 也有 → 应被清理
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("x"), 0644)
	_ = os.WriteFile(filepath.Join(dir, "m.ysm"), []byte("x"), 0644)
	// 非仓库文件：inst 有 user.ysm，repo 没有 → 保留
	_ = os.WriteFile(filepath.Join(dir, "user.ysm"), []byte("x"), 0644)

	count := RemoveRepoDuplicates(dir, repoRoot, recycleRoot)
	if count != 1 {
		t.Fatalf("应清理 1 个，实际 %d", count)
	}
	if _, err := os.Stat(filepath.Join(dir, "m.ysm")); err == nil {
		t.Fatal("m.ysm 应被清理")
	}
	if _, err := os.Stat(filepath.Join(dir, "user.ysm")); err != nil {
		t.Fatalf("user.ysm 应保留: %v", err)
	}
}

func TestRemoveRepoDuplicates_NoRepoRoot(t *testing.T) {
	dir := t.TempDir()
	_ = os.WriteFile(filepath.Join(dir, "m.ysm"), []byte("x"), 0644)
	if count := RemoveRepoDuplicates(dir, "", ""); count != 0 {
		t.Fatalf("无仓库根应返回 0，实际 %d", count)
	}
}

func TestDeduplicateEntries(t *testing.T) {
	base := t.TempDir()
	recycleRoot := filepath.Join(base, "ysm")
	if err := os.MkdirAll(recycleRoot, 0755); err != nil {
		t.Fatal(err)
	}
	// Move 内部 WalkDir 回收站目录，需先存在
	if err := os.MkdirAll(filepath.Join(recycleRoot, ".recycle"), 0755); err != nil {
		t.Fatal(err)
	}
	// 两个相同哈希（内容相同）的文件（置于 recycleRoot 内以满足 Move 的路径安全校验）
	a := filepath.Join(recycleRoot, "a.ysm")
	b := filepath.Join(recycleRoot, "b.ysm")
	_ = os.WriteFile(a, []byte("same"), 0644)
	_ = os.WriteFile(b, []byte("same"), 0644)

	entries := []types.ModelEntry{
		{Name: "a.ysm", Path: a, Hash: "abc"},
		{Name: "b.ysm", Path: b, Hash: "abc"},
		{Name: "c.ysm", Path: filepath.Join(recycleRoot, "c.ysm"), Hash: "def"},
	}
	removed, kept := DeduplicateEntries(entries, recycleRoot, nil)
	if removed != 1 || kept != 1 {
		t.Fatalf("应 removed=1 kept=1，实际 %d/%d", removed, kept)
	}
	// a.ysm 保留（组内第一个），b.ysm 移入回收站
	if _, err := os.Stat(a); err != nil {
		t.Fatalf("a.ysm 应保留: %v", err)
	}
	if _, err := os.Stat(b); err == nil {
		t.Fatal("b.ysm 应移入回收站")
	}
}
