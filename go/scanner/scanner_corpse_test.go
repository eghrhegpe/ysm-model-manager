// ===== scanner 的 relink 备份尸体豁免（ADR-342 D6 / 对抗复核 A4）=====
//
// 背景：`isRelinkBackupPath` 的豁免此前只在 go/sync 内部，scanner 只跳 `.recycle`/`.github`/
// 目录级禁用 → 失败 relink 留下的 `<夹名>.relink-bak-<ts>` 子树被照常下钻、填哈希，
// 尸体内模型作为**活跃条目**进 ModelEntry → 被搜索/仓库树/作者提取当成幻影模型消费。
package scanner

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestScanEntries_SkipsRelinkBackupCorpse 走盘路径（ScanEntries 与 ScanEntriesLite 共用
// processScanDirEntry，一处修两处生效）。
func TestScanEntries_SkipsRelinkBackupCorpse(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "live.ysm"), "live")
	testutil.WriteTestFile(t,
		filepath.Join(root, "packA.relink-bak-1700000000000000000", "x.ysm"), "old")

	entries := ScanEntries(root)
	testutil.Equal(t, len(entries), 1, "尸体子树不得进扫描结果，实际 %v", entries)
	testutil.Equal(t, filepath.Base(entries[0].Path), "live.ysm", "活文件应照常扫描")
}

// TestScanEntriesLite_SkipsRelinkBackupCorpse 轻量路径（作者提取专用）同口径。
func TestScanEntriesLite_SkipsRelinkBackupCorpse(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "live.ysm"), "live")
	testutil.WriteTestFile(t, filepath.Join(root, "sub.relink-bak-7", "x.ysm"), "old")

	entries := ScanEntriesLite(root)
	testutil.Equal(t, len(entries), 1, "尸体子树不得进轻量扫描结果，实际 %v", entries)
	testutil.Equal(t, filepath.Base(entries[0].Path), "live.ysm", "活文件应照常扫描")
}
