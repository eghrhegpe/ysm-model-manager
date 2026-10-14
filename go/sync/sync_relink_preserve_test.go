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
// 本文件是上述两条的回归锁；断言统一走 testutil（ADR-202 刀5 裸断言债）。
package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// relinkProbeEnv 搭一个「一个模型夹 + 可注入实例独有文件」的 relink 环境。
// 返回 (repoRoot, customDir, 收集日志的闭包)。
func relinkProbeEnv(t *testing.T) (string, string, *[]string) {
	t.Helper()
	base := t.TempDir()
	repoRoot := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "inst", ".minecraft", "ysm")
	testutil.NoError(t, os.MkdirAll(filepath.Join(repoRoot, "packA"), 0755), "建仓库夹")
	testutil.NoError(t, os.MkdirAll(filepath.Join(customDir, "packA"), 0755), "建实例夹")
	logs := &[]string{}
	return repoRoot, customDir, logs
}

func relinkLogger(logs *[]string) Logger {
	return func(name, src, dst string, size int64, status, msg string) {
		*logs = append(*logs, status+" "+msg)
	}
}

func readBody(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	testutil.NoError(t, err, "读文件 "+path)
	return string(b)
}

// TestRelinkDir_KeepsInstanceOnlyFiles 【A1 红】整夹替换必须保住实例独有文件。
// 现状：备份 RemoveAll → 自制贴图与额外子目录一起消失，且日志为空。
func TestRelinkDir_KeepsInstanceOnlyFiles(t *testing.T) {
	repoRoot, customDir, logs := relinkProbeEnv(t)
	instPack := filepath.Join(customDir, "packA")
	// 两侧同名模型（哈希匹配 → 走整夹替换）
	testutil.WriteTestFile(t, filepath.Join(repoRoot, "packA", "x.ysm"), "repo-body")
	testutil.WriteTestFile(t, filepath.Join(instPack, "x.ysm"), "repo-body")
	// 实例独有：一张自制贴图 + 一个额外子目录（仓库侧都没有）
	ownTex := filepath.Join(instPack, "my-own-texture.png")
	ownDeep := filepath.Join(instPack, "extra", "deep.png")
	testutil.WriteTestFile(t, ownTex, "mine")
	testutil.WriteTestFile(t, ownDeep, "mine-deep")

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "x.ysm", Path: filepath.Join(dir, "packA", "x.ysm"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, relinkLogger(logs))
	testutil.NoError(t, err, "RelinkDir 不应报错")
	testutil.Equal(t, count, 1, "应重链接 1 个（日志 %v）", *logs)
	// 核心断言：实例独有文件必须存活（原实现随备份 RemoveAll 静默消失）
	testutil.FileExists(t, ownTex, "实例独有贴图必须存活")
	testutil.FileExists(t, ownDeep, "实例独有子目录内文件必须存活")
	// 模型本身仍被换成仓库版本（不因保全而漏做重链）
	testutil.Equal(t, readBody(t, filepath.Join(instPack, "x.ysm")), "repo-body", "模型应为仓库版本")
	// 成功且全部回填 → 不留备份残留
	matches, globErr := filepath.Glob(filepath.Join(customDir, "*.relink-bak-*"))
	testutil.NoError(t, globErr, "glob 备份残留")
	testutil.Equal(t, len(matches), 0, "不应有 .relink-bak 残留: %v", matches)
}

// TestDirIdentity_RejectsReplacedDir 【A2 红】目录身份复验必须在「同名重建」时判否。
// 正向：快照 → rename 走 → 同名新建 → 必须判「不是同一对象」（现状恒判是）。
// 反向对照：同目录连取两次身份必须相等——防「恒不等」式的假修复把复验变成无条件拒绝。
func TestDirIdentity_RejectsReplacedDir(t *testing.T) {
	base := t.TempDir()
	dir := filepath.Join(base, "packA")
	bak := filepath.Join(base, "packA.bak")
	testutil.NoError(t, os.Mkdir(dir, 0755), "建目录")
	snap, err := dirIdentity(dir)
	testutil.NoError(t, err, "取快照身份")
	testutil.NoError(t, os.Rename(dir, bak), "rename 走")
	testutil.NoError(t, os.Mkdir(dir, 0755), "同名新建")
	cur, err := dirIdentity(dir)
	testutil.NoError(t, err, "取现身份")
	testutil.Equal(t, os.SameFile(snap, cur), false,
		"同名重建后仍判同一对象：目录身份复验在 Windows 上失效（ADR-296 D4 防护形同虚设）")
	// 反向对照
	again, err := dirIdentity(dir)
	testutil.NoError(t, err, "二次取身份")
	testutil.Equal(t, os.SameFile(cur, again), true, "同一未改动目录两次取身份应相等（防恒不等假修复）")
}

// TestRelinkDir_SameFolderTwoEntries 【A2+A3 锁】同夹两条目录型入口：
// 首次整夹替换后，第二条目必须被「同夹去重」承接（计成功），不得报快照失效/被替换，
// 也不得再白做一次替换。修好身份复验后若忘了去重，这条即红（子代理预言的误报会显形）。
func TestRelinkDir_SameFolderTwoEntries(t *testing.T) {
	repoRoot, customDir, logs := relinkProbeEnv(t)
	testutil.WriteTestFile(t, filepath.Join(repoRoot, "packA", "x.ysm"), "repo-x")
	testutil.WriteTestFile(t, filepath.Join(repoRoot, "packA", "y.ysm"), "repo-y")
	testutil.WriteTestFile(t, filepath.Join(customDir, "packA", "x.ysm"), "old-x")
	testutil.WriteTestFile(t, filepath.Join(customDir, "packA", "y.ysm"), "old-y")
	own := filepath.Join(customDir, "packA", "own.png")
	testutil.WriteTestFile(t, own, "mine")

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "x.ysm", Path: filepath.Join(dir, "packA", "x.ysm"), Hash: "h1"},
			{Name: "y.ysm", Path: filepath.Join(dir, "packA", "y.ysm"), Hash: "h2"},
		}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, relinkLogger(logs))
	testutil.NoError(t, err, "RelinkDir 不应报错")
	testutil.Equal(t, count, 2, "同夹两条目都应计成功（日志 %v）", *logs)
	snapshotFailures := filterLogs(*logs, "已被替换为另一对象", "快照缺失")
	testutil.Equal(t, len(snapshotFailures), 0, "同夹第二条目不应报快照类失败（自己刚搬过）: %v", snapshotFailures)
	testutil.FileExists(t, own, "实例独有文件必须存活")
	testutil.Equal(t, readBody(t, filepath.Join(customDir, "packA", "x.ysm")), "repo-x", "x.ysm 应为仓库版本")
	testutil.Equal(t, readBody(t, filepath.Join(customDir, "packA", "y.ysm")), "repo-y", "y.ysm 应为仓库版本")
}

// TestRelinkDir_RestoreFailureRollsBackWholeDir 【A1 原子性锁】回填失败必须整夹回滚：
// 注入手法——实例侧 `y.ysm` 是**目录**（内含 inner.png），仓库侧 `y.ysm` 是**同名文件**；
// 替换后新夹里 y.ysm 是文件，回填 y.ysm/inner.png 时 MkdirAll 撞同名文件必失败。
// 期望「原子替换」语义：实例夹原地不动（x.ysm 仍是旧内容、独有文件原位）、该条目不计成功、
// 日志点名回填失败、不留备份残留（回滚已把备份 rename 回原位）。
func TestRelinkDir_RestoreFailureRollsBackWholeDir(t *testing.T) {
	repoRoot, customDir, logs := relinkProbeEnv(t)
	instPack := filepath.Join(customDir, "packA")
	testutil.WriteTestFile(t, filepath.Join(repoRoot, "packA", "x.ysm"), "repo-body")
	testutil.WriteTestFile(t, filepath.Join(repoRoot, "packA", "y.ysm"), "repo-file") // 仓库侧同名文件
	testutil.WriteTestFile(t, filepath.Join(instPack, "x.ysm"), "old-body")
	testutil.WriteTestFile(t, filepath.Join(instPack, "y.ysm", "inner.png"), "mine") // 实例侧同名目录

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{{Name: "x.ysm", Path: filepath.Join(dir, "packA", "x.ysm"), Hash: "h1"}}
	}
	count, err := RelinkDir(customDir, repoRoot, "ysm", "copy", scanFn, relinkLogger(logs))
	testutil.NoError(t, err, "RelinkDir 不应报错（失败经 logger 点名）")
	testutil.Equal(t, count, 0, "回填失败应整夹回滚且不计成功（日志 %v）", *logs)
	testutil.Equal(t, readBody(t, filepath.Join(instPack, "x.ysm")), "old-body", "回滚后模型应保持旧内容")
	testutil.FileExists(t, filepath.Join(instPack, "y.ysm", "inner.png"), "回滚后实例独有文件应原位")
	testutil.Equal(t, len(filterLogs(*logs, "回填失败")), 1, "应点名回填失败（日志 %v）", *logs)
	matches, globErr := filepath.Glob(filepath.Join(customDir, "*.relink-bak-*"))
	testutil.NoError(t, globErr, "glob 备份残留")
	testutil.Equal(t, len(matches), 0, "回滚应把备份 rename 回原位，不留残留: %v", matches)
}

// filterLogs 捞出含任一关键词的日志行（供集合式断言，避免逐条裸断言）。
func filterLogs(logs []string, subs ...string) []string {
	var hit []string
	for _, l := range logs {
		for _, s := range subs {
			if strings.Contains(l, s) {
				hit = append(hit, l)
				break
			}
		}
	}
	return hit
}
