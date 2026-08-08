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

// P3 修复（code_review）：平铺 customDir 根层条目（P1 数据丢失修复的回归测试）——
// ysm.json/.pmx 平铺在 customDir 根层时不得把整个实例目录 rename 走、
// 不得连带删除同目录其他模型；平铺文件应被重链接、不留 .relink-bak 残留
func TestRelinkDir_FlatEntryAtCustomDirRoot(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(filepath.Join(repoRoot, "subdir"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 仓库侧：ysm.json 在子目录（hash 匹配按全树扫描，路径无关）
	_ = os.WriteFile(filepath.Join(repoRoot, "subdir", "ysm.json"), []byte("repo-version"), 0644)
	// 实例侧：平铺在 customDir 根层 + 一个兄弟模型（必须存活）
	_ = os.WriteFile(filepath.Join(customDir, "ysm.json"), []byte("stale"), 0644)
	sibling := filepath.Join(customDir, "sibling.ysm")
	_ = os.WriteFile(sibling, []byte("sibling"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(dir, "subdir", "ysm.json"), Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(dir, "ysm.json"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", count)
	}
	// 平铺文件被替换为仓库版本（copy 模式）
	data, err := os.ReadFile(filepath.Join(customDir, "ysm.json"))
	if err != nil {
		t.Fatalf("平铺 ysm.json 应存在: %v", err)
	}
	if string(data) != "repo-version" {
		t.Fatalf("平铺文件应被替换为仓库版本，实际 %q", string(data))
	}
	// 兄弟模型必须存活（P1 数据丢失修复核心断言）
	if _, err := os.Stat(sibling); err != nil {
		t.Fatalf("兄弟模型被误删: %v", err)
	}
	// 不留 .relink-bak 残留
	matches, _ := filepath.Glob(customDir + "*.relink-bak")
	if len(matches) != 0 {
		t.Fatalf("不应有 .relink-bak 残留: %v", matches)
	}
}
