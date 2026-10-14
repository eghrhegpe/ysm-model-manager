// sync_toggle_basename_reach_test.go：basename 兜底可达性实证（锐评 ③ 裁定）。
//
// 背景：知识卡 go-sync.md / go-sync-toggle.md 曾把「三级匹配的最后一级是 basename，
// 同名不同路径的不同模型会被互相匹配启禁状态」列为观察项，建议「新仓库数据齐全时该
// 兜底应可收紧」。本文件用实证取代推断，钉住 basename 兜底的**真实可达条件**。
//
// 关键机制：basename 兜底查的是 `repoName[纯文件名]`，而 `collectToggleRepoIndex` 只在
// 仓库条目 `e.Path` 越出 filesRoot 前缀时才写入纯文件名键——正常仓库布局（所有条目都在
// filesRoot 下）时 repoName 只有相对路径键（`a/foo.ysm`），basename 键（`foo.ysm`）恒
// 不存在 → 兜底恒 miss。故「同名不同路径互传染」在正常布局下不可达，观察项不成立。
// 已有 TestChar_SyncToggleStatus_RepoOutsideFilesRoot_BaseNameFallback 从反面钉住该
// 兜底（越界条目场景），本文件从正面钉住「正常布局不命中」，两条合起来闭环。
package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// writeToggleFiles 批量写文件（content 为 map[相对路径]内容）。
func writeToggleFiles(t *testing.T, root string, contents map[string]string) {
	t.Helper()
	for rel, content := range contents {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			testutil.NoError(t, err, "建目录 "+rel)
		}
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			testutil.NoError(t, err, "写文件 "+rel)
		}
	}
}

// walkScanFn 递归遍历目录收集模型条目（镜像生产 scanner 的递归语义，含真实磁盘哈希）——
// 平铺 ReadDir 版扫不到子目录条目，会触发 collectToggleRepoIndex 的空索引早退。
func walkScanFn(root string) func(string) []types.ModelEntry {
	return func(dir string) []types.ModelEntry {
		var out []types.ModelEntry
		_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			out = append(out, types.ModelEntry{Name: d.Name(), Path: p, Hash: computeHash(p)})
			return nil
		})
		return out
	}
}

// TestSyncToggleStatus_SameNameDifferentPaths_NoCrossContamination 仓库两个子目录下的
// 同名文件状态**不一致**（a 禁用、b 活跃），实例侧根下同名文件与两侧内容都不同
// （relKey miss + hash miss）——basename 兜底必须**不命中**，否则会把实例文件误禁。
// 钉住：正常仓库布局下 basename 键不存在，兜底不可达。
func TestSyncToggleStatus_SameNameDifferentPaths_NoCrossContamination(t *testing.T) {
	_, repoDir, customDir := newToggleEnv(t)

	writeToggleFiles(t, repoDir, map[string]string{
		"a/foo.ysm.ban": "AAA-a-disabled",
		"b/foo.ysm":     "BBB-b-active",
	})
	writeToggleFiles(t, customDir, map[string]string{
		"foo.ysm": "CCC-instance", // 与两侧内容都不同 → hash 维度必 miss
	})

	// scanFn 走真实磁盘哈希（递归遍历，镜像生产 scanner），避免手工 Hash 让 hash 兜底误命中
	scanFn := walkScanFn(repoDir)

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	testutil.NoError(t, err, "不应报错")

	// relKey（custom/foo.ysm ↔ a/foo.ysm、b/foo.ysm）miss、hash（内容都不同）miss、
	// basename（repoName 无纯文件名键）也必 miss → 零动作
	testutil.Equal(t, disable, 0, "basename 兜底不应在正常布局下命中禁用")
	testutil.Equal(t, enable, 0, "不应启用")
	if _, err := os.Stat(filepath.Join(customDir, "foo.ysm.disabled")); err == nil {
		t.Fatal("实例 foo.ysm 被误禁——basename 兜底在正常布局下不应命中")
	}
}

// TestSyncToggleStatus_BasenameFallbackRequiresOutsidePath 从反面验证可达条件：
// 同一套「同名不同路径」夹具，但把仓库条目 Path 注入为**越出 filesRoot 前缀**时，
// repoName 才会写入纯文件名键，basename 兜底才命中。证明「正常布局不命中」不是恒等式，
// 而是有条件的——收紧该兜底会一并砍掉越界条目的唯一关联通道。
func TestSyncToggleStatus_BasenameFallbackRequiresOutsidePath(t *testing.T) {
	_, repoDir, customDir := newToggleEnv(t)

	// 仓库条目落在 filesRoot 之外（异构 scanFn 注入），与上方用例夹具同构
	outsideRepo := filepath.Join(t.TempDir(), "elsewhere", "foo.ysm.ban")
	if err := os.MkdirAll(filepath.Dir(outsideRepo), 0755); err != nil {
		testutil.NoError(t, err, "建越界目录")
	}
	if err := os.WriteFile(outsideRepo, []byte("AAA-outside"), 0644); err != nil {
		testutil.NoError(t, err, "写越界仓库文件")
	}
	writeToggleFiles(t, customDir, map[string]string{
		"sub/foo.ysm": "CCC-instance", // relKey = sub/foo.ysm，与纯文件名键不匹配
	})

	scanFn := func(dir string) []types.ModelEntry {
		return []types.ModelEntry{
			{Name: "foo.ysm.ban", Path: outsideRepo, Hash: computeHash(outsideRepo)},
		}
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	testutil.NoError(t, err, "不应报错")
	testutil.Equal(t, disable, 1, "越界条目场景 basename 兜底应命中禁用")
	testutil.Equal(t, enable, 0, "不应启用")
	if _, err := os.Stat(filepath.Join(customDir, "sub/foo.ysm.disabled")); err != nil {
		t.Errorf("sub/foo.ysm 应经 basename 兜底被禁用: %v", err)
	}
}

// collectToggleRepoIndex 的纯文件名键写入分支是 basename 兜底唯一的可达来源——直接断言
// 索引内容，避免只从黑盒结果推断可达性。
func TestCollectToggleRepoIndex_BaseNameKeyOnlyForOutsidePath(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	_ = os.MkdirAll(customDir, 0755)
	writeToggleFiles(t, repoDir, map[string]string{"a/foo.ysm.ban": "x", "b/foo.ysm": "y"})
	// 实例侧留一个无关文件，避免 collectToggleFileInfos 对空目录的 WalkDir 错误留痕
	writeToggleFiles(t, customDir, map[string]string{"unrelated.ysm": "z"})

	repoHash, repoName, _, err := collectToggleRepoIndex(repoDir, customDir, walkScanFn(repoDir))
	testutil.NoError(t, err, "不应报错")

	testutil.Equal(t, len(repoName), 2, "正常布局应只有两条相对路径键")
	_, hasBasename := repoName["foo.ysm"]
	if hasBasename {
		t.Fatal("正常布局下 repoName 不应含纯文件名键 foo.ysm——basename 兜底会因此恒命中")
	}
	for k := range repoName {
		if !strings.Contains(k, string(filepath.Separator)) && !strings.Contains(k, "/") {
			t.Errorf("repoName 出现非路径键 %q，basename 兜底可达条件不成立", k)
		}
	}
	testutil.Equal(t, len(repoHash), 2, "两条不同内容应各有哈希")
}
