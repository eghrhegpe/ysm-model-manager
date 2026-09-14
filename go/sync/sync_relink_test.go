// ===== go/sync 重链接单测（ADR-003 补充下沉验证）=====
package sync

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"ysm-model-manager/go/installer"
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

// TestRelinkDir_ScanNotHeldLock 钉住 RelinkDir 的锁范围：repo/custom 全量扫描（含 SHA256 哈希）
// 必须在 InstallLock 外执行——持锁扫描会阻塞所有其他同步/安装操作（P2-2 重构的核心，
// 镜像 SyncToggleStatus 的「锁外哈希」自我修正）。
// 探测法：注入 scanFn 在扫描段内 TryLock——锁空闲则 TryLock 成功（正确，扫描在锁外）；
// TryLock 失败说明扫描段被持锁（回归）。与前辈用例同构、时序确定，故不使用 t.Parallel()。
func TestRelinkDir_ScanNotHeldLock(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst")
	if err := os.MkdirAll(repoRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("same"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "m.ysm"), []byte("same"), 0644)

	scanLocked := false
	scanFn := func(dir string) []types.ModelEntry {
		if mu, ok := installer.InstallLocker.(*sync.Mutex); ok {
			if mu.TryLock() {
				mu.Unlock() // 锁空闲 → 扫描在锁外 ✓
			} else {
				scanLocked = true // 锁被持有 → 扫描在锁内 ✗（回归）
			}
		}
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
	}
	_, _ = RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if scanLocked {
		t.Fatal("RelinkDir 全量扫描不应在 InstallLock 内执行（阻塞并发同步/安装）")
	}
}

// 平铺 customDir 根层条目（P1 数据丢失修复的回归测试）——
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

// P2 补测：.ban 条目跳过——重链接不得静默恢复禁用状态。
// custom 条目 m.ysm.ban（hash 与仓库活跃版匹配）应被跳过：count 不含它、.ban 文件保留原内容
func TestRelinkDir_BanEntrySkipped(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(repoRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 仓库侧活跃版 + 实例侧禁用态（.ban），hash 相同
	_ = os.WriteFile(filepath.Join(repoRoot, "m.ysm"), []byte("same"), 0644)
	banFile := filepath.Join(customDir, "m.ysm.ban")
	_ = os.WriteFile(banFile, []byte("disabled-copy"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "m.ysm", Path: filepath.Join(dir, "m.ysm"), Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "m.ysm.ban", Path: filepath.Join(dir, "m.ysm.ban"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "resourcepack", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 0 {
		t.Fatalf(".ban 条目不应被重链接，实际 count=%d", count)
	}
	// .ban 文件保留（内容不变，未被替换为仓库活跃版）
	data, err := os.ReadFile(banFile)
	if err != nil {
		t.Fatalf(".ban 文件应保留: %v", err)
	}
	if string(data) != "disabled-copy" {
		t.Fatalf(".ban 文件应保持原内容，实际 %q", string(data))
	}
}

// P2 补测：RelinkDir 目录级分支（非平铺）——custom 有 sub/ysm.json、repo 有同 hash 的
// ysm.json，rtype=ysm 时旧目录应被整体替换（rename 备份 + InstallDir 重建），不留 .relink-bak
func TestRelinkDir_DirLevelReplacesOldDir(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(filepath.Join(repoRoot, "repo-sub"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(customDir, "custom-sub"), 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(repoRoot, "repo-sub", "ysm.json"), []byte("repo-version"), 0644)
	_ = os.WriteFile(filepath.Join(customDir, "custom-sub", "ysm.json"), []byte("stale"), 0644)

	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(dir, "repo-sub", "ysm.json"), Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(dir, "custom-sub", "ysm.json"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn,
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", count)
	}
	// 旧目录被替换：custom-sub 不再存在
	if _, err := os.Stat(filepath.Join(customDir, "custom-sub")); !os.IsNotExist(err) {
		t.Fatalf("旧目录应被替换移除: %v", err)
	}
	// 无 .relink-bak 残留
	matches, _ := filepath.Glob(filepath.Join(customDir, "*.relink-bak"))
	if len(matches) != 0 {
		t.Fatalf("不应有 .relink-bak 残留: %v", matches)
	}
	// 新目录内容为仓库版本
	data, err := os.ReadFile(filepath.Join(customDir, "repo-sub", "ysm.json"))
	if err != nil {
		t.Fatalf("新目录 ysm.json 应存在: %v", err)
	}
	if string(data) != "repo-version" {
		t.Fatalf("新目录应为仓库版本，实际 %q", string(data))
	}
}
