// ===== 模式切换端到端钉桩（ADR-296 D1）=====
// 锐评曾断言「hardlink→copy 切模式后实例仍是硬链接（哈希匹配条目被 continue 跳过）」，
// 子代理逐行核对证伪：RelinkDir 只在 !found 时 continue，哈希匹配条目**无条件**按
// 当前 linkMode 重跑 Install。本文件用真实文件系统（os.Link/os.Symlink，先例
// go/instance/instance_test.go 与 installer TestInstall_Symlink，不支持即 Skip）
// 钉死该语义：若以下任一断言变红，切模式不解耦即为真实现缺陷——排查方向
// linkMode 时序（install/link.go 同值早退 + SaveAppConfig 双写）/ scanner 缓存陈旧，
// 而不是在本测试上找平。
// 与前辈用例同构不 t.Parallel()（全局 InstallLock）。
package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// modeSwitchFixture 构造 repo + custom（含 .minecraft 段过 ContainsMinecraftMarker），
// 仓库侧 m.ysm 内容为 content，customFile 由调用方按场景建立（link/symlink/副本）。
// scanFn 两侧返回同哈希——模拟真实扫描结果形状。
func modeSwitchFixture(t *testing.T, content string) (repoRoot, customDir, repoFile, customFile string, scanFn func(string) []types.ModelEntry) {
	t.Helper()
	base := t.TempDir()
	repoRoot = filepath.Join(base, "repo")
	customDir = filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(repoRoot, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	repoFile = filepath.Join(repoRoot, "m.ysm")
	if err := os.WriteFile(repoFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	customFile = filepath.Join(customDir, "m.ysm")
	hash := computeHash(repoFile)
	if hash == "" {
		t.Fatal("computeHash 为空（fixture 失败）")
	}
	scanFn = func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "m.ysm", Path: repoFile, Hash: hash}}
		}
		return []types.ModelEntry{{Name: "m.ysm", Path: customFile, Hash: hash}}
	}
	return
}

func relinkQuiet(t *testing.T, customDir, repoRoot, linkMode string, scanFn func(string) []types.ModelEntry) int {
	t.Helper()
	count, err := RelinkDir(customDir, repoRoot, "resourcepack", linkMode, scanFn,
		func(name, src, dst string, size int64, status, msg string) {
			if status == "failed" {
				t.Errorf("relink 失败: %s %s: %s", name, src, msg)
			}
		})
	if err != nil {
		t.Fatalf("RelinkDir(%s) 失败: %v", linkMode, err)
	}
	return count
}

// hardlink→copy：实例与仓库共享 inode（哈希恒相等）→ 重链后必须断链为独立副本，
// 且内容保留、仓库侧完好。
func TestRelinkDir_HardLinkToCopy_Decouples(t *testing.T) {
	repoRoot, customDir, repoFile, customFile, scanFn := modeSwitchFixture(t, "same")
	if err := os.Link(repoFile, customFile); err != nil {
		t.Skipf("平台不支持硬链接: %v", err)
	}
	si, _ := os.Stat(repoFile)
	if ci, _ := os.Stat(customFile); !os.SameFile(si, ci) {
		t.Fatal("fixture 失败：实例应先是指向仓库的硬链接")
	}

	if n := relinkQuiet(t, customDir, repoRoot, "copy", scanFn); n != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", n)
	}
	ci, err := os.Stat(customFile)
	if err != nil {
		t.Fatalf("实例文件应存在: %v", err)
	}
	if os.SameFile(si, ci) {
		t.Fatal("hardlink→copy 后仍共享 inode——切模式未解耦（真缺陷，按 ADR-296 D1 排查 linkMode 时序/scanner 缓存）")
	}
	if lt := GetLinkType(customFile); lt != types.LinkCopy {
		t.Errorf("实例应为 LinkCopy，实际 %v", lt)
	}
	data, err := os.ReadFile(customFile)
	if err != nil || string(data) != "same" {
		t.Errorf("解耦后内容应保留，实际 %q err=%v", data, err)
	}
	if _, err := os.Stat(repoFile); err != nil {
		t.Errorf("仓库侧文件应完好: %v", err)
	}
}

// symlink→copy：实例是指向仓库的符号链接 → 重链后 Lstat 不再是 symlink、
// 与仓库不再同文件、内容保留、仓库侧不被误删。
func TestRelinkDir_SymlinkToCopy_Decouples(t *testing.T) {
	repoRoot, customDir, repoFile, customFile, scanFn := modeSwitchFixture(t, "same")
	if err := os.Symlink(repoFile, customFile); err != nil {
		t.Skipf("平台不支持符号链接（需特权/开发者模式）: %v", err)
	}
	if li, _ := os.Lstat(customFile); li.Mode()&os.ModeSymlink == 0 {
		t.Fatal("fixture 失败：实例应先是指向仓库的符号链接")
	}

	if n := relinkQuiet(t, customDir, repoRoot, "copy", scanFn); n != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", n)
	}
	li, err := os.Lstat(customFile)
	if err != nil {
		t.Fatalf("实例文件应存在: %v", err)
	}
	if li.Mode()&os.ModeSymlink != 0 {
		t.Fatal("symlink→copy 后仍是符号链接——未解耦")
	}
	si, _ := os.Stat(repoFile)
	ci, _ := os.Stat(customFile)
	if os.SameFile(si, ci) {
		t.Fatal("解耦后不应仍与仓库共享 inode")
	}
	data, err := os.ReadFile(customFile)
	if err != nil || string(data) != "same" {
		t.Errorf("解耦后内容应保留，实际 %q err=%v", data, err)
	}
	if _, err := os.Stat(repoFile); err != nil {
		t.Errorf("仓库侧文件应完好（断链不删仓）: %v", err)
	}
}

// copy→hardlink：两侧独立副本（内容相同、哈希相等）→ 重链后实例应与仓库共享 inode。
func TestRelinkDir_CopyToHardLink_Links(t *testing.T) {
	repoRoot, customDir, repoFile, customFile, scanFn := modeSwitchFixture(t, "same")
	if err := os.WriteFile(customFile, []byte("same"), 0644); err != nil {
		t.Fatal(err)
	}

	if n := relinkQuiet(t, customDir, repoRoot, "hardlink", scanFn); n != 1 {
		t.Fatalf("应重链接 1 个，实际 %d", n)
	}
	if lt := GetLinkType(customFile); lt != types.LinkHard {
		t.Errorf("copy→hardlink 后实例应为 LinkHard，实际 %v", lt)
	}
	si, _ := os.Stat(repoFile)
	ci, _ := os.Stat(customFile)
	if !os.SameFile(si, ci) {
		t.Fatal("copy→hardlink 后应与仓库共享 inode")
	}
}

// TestRelinkDir_DirLevelSnapshotMissingRefusesRename（ADR-296 D4 + 对抗审查①）：
// 目录级分支的锁内复验——scanFn 快照了 dstParent，但锁外 Lstat 时目录已不存在
// （快照收集不存 key）→ 锁内必须**拒搬**（旧行为：无复验直接 rename 失败留噪），
// 并记 logger failed「快照缺失」。断言零 rename 产物：目录不存在、无备份、count==0。
func TestRelinkDir_DirLevelSnapshotMissingRefusesRename(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(filepath.Join(repoRoot, "m"), 0755); err != nil {
		t.Fatal(err)
	}
	// 仓库侧实体目录；实例侧 sub 目录**故意不建**——注入 scanFn 撒谎快照 dstParent
	_ = os.WriteFile(filepath.Join(repoRoot, "m", "ysm.json"), []byte("repo"), 0644)
	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(repoRoot, "m", "ysm.json"), Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(customDir, "sub", "ysm.json"), Hash: "h1"}}
	}
	var failedMsgs []string
	count, err := RelinkDir(customDir, repoRoot, "ysm", "hardlink", scanFn,
		func(name, src, dst string, size int64, status, msg string) {
			if status == "failed" {
				failedMsgs = append(failedMsgs, msg)
			}
		})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 0 {
		t.Errorf("快照缺失应拒搬，count=%d want 0", count)
	}
	if len(failedMsgs) == 0 || !strings.Contains(failedMsgs[0], "快照缺失") {
		t.Errorf("应记 logger failed 含「快照缺失」，实际 %v", failedMsgs)
	}
	// 无 rename 产物：备份目录不得出现（旧实现会 rename→失败→留 .relink-bak 噪点）
	mb, _ := filepath.Glob(filepath.Join(customDir, "*.relink-bak-*"))
	if len(mb) != 0 {
		t.Errorf("拒搬不应产生备份残留: %v", mb)
	}
}

// TestRelinkDir_DirLevelSnapshotReplacedRefusesRename（ADR-296 D4）：
// 复验三分支之二——SameFile 失配（dstParent 被换成异体对象）→ 拒搬 + failed「已被替换」。
// 构造：scanFn 真实快照 customDir/sub 后、锁内复验前无法注入竞态（RelinkDir 内部），
// 改为让复验对象与快照对象天然不同：注入 scanFn 的 ce.Path 指向 **文件**（非目录），
// 锁外 Lstat 存到的是文件 FileInfo，锁内复验 IsDir 失败 → 拒搬（三分支之 IsDir 校验）。
func TestRelinkDir_DirLevelSnapshotReplacedRefusesRename(t *testing.T) {
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "resourcepacks")
	if err := os.MkdirAll(filepath.Join(repoRoot, "m"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(customDir, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(repoRoot, "m", "ysm.json"), []byte("repo"), 0644)
	// dstParent = customDir/occ，被**普通文件**占据（模拟外部改动把目录换成异体类型）
	occupied := filepath.Join(customDir, "occ")
	if err := os.WriteFile(occupied, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(repoRoot, "m", "ysm.json"), Hash: "h1"}}
		}
		return []types.ModelEntry{{Name: "ysm.json", Path: filepath.Join(occupied, "ysm.json"), Hash: "h1"}}
	}
	var failedMsgs []string
	count, err := RelinkDir(customDir, repoRoot, "ysm", "hardlink", scanFn,
		func(name, src, dst string, size int64, status, msg string) {
			if status == "failed" {
				failedMsgs = append(failedMsgs, msg)
			}
		})
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 0 {
		t.Errorf("dstParent 非目录应拒搬，count=%d want 0", count)
	}
	if strings.Contains(strings.Join(failedMsgs, ";"), "relink 备份目录失败") {
		t.Errorf("应走复验拒搬（快照复验失败/类型不符），而非旧路径 rename 噪点，实际 %v", failedMsgs)
	}
	// 文件占位物必须完好——复验在 rename **之前**，旧实现会把文件 rename 走变成备份目录
	data, err := os.ReadFile(occupied)
	if err != nil || string(data) != "x" {
		t.Fatalf("占位文件应原样完好（未被动过）: err=%v data=%q", err, data)
	}
}

// 负向钉桩：Hash=="" 与 .ban 实例条目在**任何**模式下都不被动——
// 钉住 RelinkDir 主循环真实的 continue 边界（sync_relink.go），
// 防后续重构把 continue 条件挪错位置引入「禁用被悄悄恢复」类缺陷。
func TestRelinkDir_NoHashOrBanned_Untouched(t *testing.T) {
	repoRoot, customDir, repoFile, _, _ := modeSwitchFixture(t, "same")
	noHash := filepath.Join(customDir, "nohash.ysm")
	banned := filepath.Join(customDir, "m.ysm.ban")
	for _, p := range []string{noHash, banned} {
		if err := os.WriteFile(p, []byte("stale"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	hash := computeHash(repoFile)
	scanFn := func(dir string) []types.ModelEntry {
		if dir == repoRoot {
			return []types.ModelEntry{{Name: "m.ysm", Path: repoFile, Hash: hash}}
		}
		return []types.ModelEntry{
			{Name: "nohash.ysm", Path: noHash, Hash: ""},  // 空哈希 → 跳过（真扫描对超限/读错文件也产空哈希）
			{Name: "m.ysm.ban", Path: banned, Hash: hash}, // 禁用条目 → 跳过（重链不得静默恢复启用）
		}
	}
	for _, mode := range []string{"copy", "hardlink", "symlink"} {
		count, err := RelinkDir(customDir, repoRoot, "resourcepack", mode, scanFn,
			func(name, src, dst string, size int64, status, msg string) {
				if status == "failed" {
					t.Errorf("mode=%s 不应有失败: %s %s: %s", mode, name, src, msg)
				}
			})
		if err != nil {
			t.Fatalf("mode=%s: %v", mode, err)
		}
		if count != 0 {
			t.Errorf("mode=%s: 空哈希/禁用条目不应被重链，count=%d", mode, count)
		}
		for _, p := range []string{noHash, banned} {
			data, err := os.ReadFile(p)
			if err != nil || string(data) != "stale" {
				t.Errorf("mode=%s: %s 应原样保留（实际 %q err=%v）", mode, p, data, err)
			}
		}
	}
}
