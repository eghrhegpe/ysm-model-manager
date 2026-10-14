// ===== relink 数据保全 + 目录身份复验回归（锐评 2026-10-14 批 A）=====
//
// 背景（两条实证发现，见 ADR-342）：
//
//	① N1 数据丢失：relinkReplaceDirTree 成功路径 `removeRelinkBackup` 直接 RemoveAll 备份，
//	   实例夹内「仓库没有的文件」（自制贴图/额外子目录）随之永久消失，且**一条日志都没有**——
//	   count 报全成功。触发路径是设置页「重新应用链接模式/切换链接模式」，copy 模式同样跑。
//	② N2 防护失效：verifyDirSnapshot 用 os.SameFile(锁外快照, 锁内现取)，而 Windows 的
//	   os.Lstat 产出惰性 fileStat，os.SameFile 会**按路径名重新 CreateFile 取 ID**
//	   （Go stdlib os/types_windows.go loadFileId）→ 比的是「P 现在是谁」对「P 现在是谁」，
//	   恒真。ADR-296 D4 想拦的「锁内搬的不是扫描时那个对象」在主力平台拦不住。
//	   副作用：同夹多条目时第二条目会白做一次整夹替换（本应被复验拦下/去重）。
//
// 本文件是上述两条的回归锁。先写断言（红）再改实现。
package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// relinkProbeEnv 搭一个「一个模型夹 + 可注入实例独有文件」的 relink 环境。
// 返回 (repoRoot, customDir, 收集日志的闭包)。
func relinkProbeEnv(t *testing.T) (string, string, *[]string) {
	t.Helper()
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "ysm")
	if err := os.MkdirAll(filepath.Join(repoRoot, "packA"), 0755); err != nil {
		t.Fatalf("建仓库夹失败: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(customDir, "packA"), 0755); err != nil {
		t.Fatalf("建实例夹失败: %v", err)
	}
	logs := &[]string{}
	return repoRoot, customDir, logs
}

func relinkLogger(logs *[]string) Logger {
	return func(name, src, dst string, size int64, status, msg string) {
		*logs = append(*logs, status+" "+msg)
	}
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("建目录失败 %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(body), 0644); err != nil {
		t.Fatalf("写文件失败 %s: %v", path, err)
	}
}

func mustExist(t *testing.T, path string, why string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("%s：%s 应存在，实际 %v", why, path, err)
	}
}

// TestRelinkDir_KeepsInstanceOnlyFiles 【A1 红】整夹替换必须保住实例独有文件。
// 现状：备份 RemoveAll → 自制贴图与额外子目录一起消失，且日志为空。
func TestRelinkDir_KeepsInstanceOnlyFiles(t *testing.T) {
	repoRoot, customDir, logs := relinkProbeEnv(t)
	instPack := filepath.Join(customDir, "packA")
	// 两侧同名模型（哈希匹配 → 走整夹替换）
	mustWrite(t, filepath.Join(repoRoot, "packA", "x.ysm"), "repo-body")
	mustWrite(t, filepath.Join(instPack, "x.ysm"), "repo-body")
	// 实例独有：一张自制贴图 + 一个额外子目录（仓库侧都没有）
	ownTex := filepath.Join(instPack, "my-own-texture.png")
	ownDeep := filepath.Join(instPack, "extra", "deep.png")
	mustWrite(t, ownTex, "mine")
	mustWrite(t, ownDeep, "mine-deep")

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "x.ysm", Path: filepath.Join(dir, "packA", "x.ysm"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, relinkLogger(logs))
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 1 {
		t.Fatalf("应重链接 1 个，实际 %d（日志 %v）", count, *logs)
	}
	// 核心断言：实例独有文件必须存活（原实现随备份 RemoveAll 静默消失）
	mustExist(t, ownTex, "实例独有贴图")
	mustExist(t, ownDeep, "实例独有子目录内文件")
	// 模型本身仍被换成仓库版本（不因保全而漏做重链）
	body, err := os.ReadFile(filepath.Join(instPack, "x.ysm"))
	if err != nil {
		t.Fatalf("模型应存在: %v", err)
	}
	if string(body) != "repo-body" {
		t.Fatalf("模型应为仓库版本，实际 %q", string(body))
	}
	// 成功且全部回填 → 不留备份残留
	matches, _ := filepath.Glob(filepath.Join(customDir, "*.relink-bak-*"))
	if len(matches) != 0 {
		t.Fatalf("不应有 .relink-bak 残留: %v", matches)
	}
}

// TestDirIdentity_RejectsReplacedDir 【A2 红】目录身份复验必须在「同名重建」时判否。
// 正向：快照 → rename 走 → 同名新建 → 必须判「不是同一对象」（现状恒判是）。
// 反向对照：同目录连取两次身份必须相等——防「恒不等」式的假修复把复验变成无条件拒绝。
func TestDirIdentity_RejectsReplacedDir(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "packA")
	bak := filepath.Join(base, "packA.bak")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatalf("建目录失败: %v", err)
	}
	snap, err := dirIdentity(dir)
	if err != nil {
		t.Fatalf("取快照身份失败: %v", err)
	}
	if err := os.Rename(dir, bak); err != nil {
		t.Fatalf("rename 失败: %v", err)
	}
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatalf("同名新建失败: %v", err)
	}
	cur, err := dirIdentity(dir)
	if err != nil {
		t.Fatalf("取现身份失败: %v", err)
	}
	if os.SameFile(snap, cur) {
		t.Fatal("同名重建后仍判同一对象：目录身份复验在 Windows 上失效（ADR-296 D4 防护形同虚设）")
	}
	// 反向对照
	again, err := dirIdentity(dir)
	if err != nil {
		t.Fatalf("二次取身份失败: %v", err)
	}
	if !os.SameFile(cur, again) {
		t.Fatal("同一未改动目录两次取身份应相等（防恒不等假修复）")
	}
}

// TestRelinkDir_SameFolderTwoEntries 【A2+A3 锁】同夹两条目录型入口：
// 首次整夹替换后，第二条目必须被「同夹去重」承接（计成功），不得报快照失效/被替换，
// 也不得再白做一次替换。修好身份复验后若忘了去重，这条即红（子代理预言的误报会显形）。
func TestRelinkDir_SameFolderTwoEntries(t *testing.T) {
	repoRoot, customDir, logs := relinkProbeEnv(t)
	mustWrite(t, filepath.Join(repoRoot, "packA", "x.ysm"), "repo-x")
	mustWrite(t, filepath.Join(repoRoot, "packA", "y.ysm"), "repo-y")
	mustWrite(t, filepath.Join(customDir, "packA", "x.ysm"), "old-x")
	mustWrite(t, filepath.Join(customDir, "packA", "y.ysm"), "old-y")
	own := filepath.Join(customDir, "packA", "own.png")
	mustWrite(t, own, "mine")

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "x.ysm", Path: filepath.Join(dir, "packA", "x.ysm"), Hash: "h1"},
			{Name: "y.ysm", Path: filepath.Join(dir, "packA", "y.ysm"), Hash: "h2"},
		}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, relinkLogger(logs))
	if err != nil {
		t.Fatalf("RelinkDir 失败: %v", err)
	}
	if count != 2 {
		t.Fatalf("同夹两条目都应计成功，实际 count=%d（日志 %v）", count, *logs)
	}
	for _, l := range *logs {
		if strings.Contains(l, "已被替换为另一对象") || strings.Contains(l, "快照缺失") {
			t.Fatalf("同夹第二条目不应报快照类失败（自己刚搬过）: %v", *logs)
		}
	}
	mustExist(t, own, "实例独有文件")
	for f, want := range map[string]string{"x.ysm": "repo-x", "y.ysm": "repo-y"} {
		body, err := os.ReadFile(filepath.Join(customDir, "packA", f))
		if err != nil {
			t.Fatalf("%s 应存在: %v", f, err)
		}
		if string(body) != want {
			t.Fatalf("%s 应为仓库版本 %q，实际 %q", f, want, string(body))
		}
	}
}
