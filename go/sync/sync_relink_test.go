// ===== go/sync 重链接单测（ADR-003 补充下沉验证）=====
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestRelinkDir_MatchesByHash(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(repoRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("same"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "m.ysm"), []byte("same"), 0644)

	// scanFn 模拟扫描：repo 与 custom 返回相同哈希 → 匹配重链接
	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "samehash"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", count)
	}
	// customDir 的文件应被重装（copy 模式保留内容）
	if _, err := os.Stat(filepath.Join(customDir, "m.ysm")); err != nil {
		t.Fatalf("实例文件应存在: %v", err)
	}
}

func TestRelinkDir_EmptyParams(t *testing.T) {
	if _, err := RelinkDir("", "repo", "resourcepack", "copy", nil, nil); err == nil {
		t.Fatal("空 customDir 应报错")
	}
	if _, err := RelinkDir("custom", "", "resourcepack", "copy", nil, nil); err == nil {
		t.Fatal("空 repoRoot 应报错")
	}
}
