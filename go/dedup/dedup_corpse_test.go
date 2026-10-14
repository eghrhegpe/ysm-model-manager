// ===== dedup 的 relink 备份尸体豁免（ADR-342 D6 / 对抗复核 A4）=====
//
// 背景（数据丢失形状）：`cli/dedup clean` 保留 `Group.Files[0]`（按 Path 排序）、其余移回收站。
// `packA.relink-bak-1\x.ysm` 的 `.`(0x2E) < `\`(0x5C)，Path 排序**尸体先于活模型** →
// 一旦仓库里存在尸体副本，clean 会保留尸体、把活模型移进回收站。修法是在扫描源头豁免尸体，
// 让它根本不进分组（而不是事后在 clean 里挑）。
package dedup

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestFindDuplicateFiles_IgnoresRelinkBackupCorpse 尸体不得参与去重分组。
func TestFindDuplicateFiles_IgnoresRelinkBackupCorpse(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "a.ysm"), "same-content")
	// 同内容尸体副本：若进分组，Path 排序会让它排在活文件之前 → clean 保尸体删活模型
	testutil.WriteTestFile(t, filepath.Join(root, "a.relink-bak-1", "a.ysm"), "same-content")

	groups, err := FindDuplicateFiles(root, true)
	testutil.NoError(t, err, "FindDuplicateFiles 不应报错")
	testutil.Equal(t, len(groups), 0,
		"尸体不得参与去重（否则 clean 可能保尸体删活模型），实际分组 %v", groups)
}

// TestFindDuplicateFiles_StillFindsRealDuplicates 负向对照：真实重复仍须被检出，
// 防「顺手把整个扫描面跳过」式假修复。
func TestFindDuplicateFiles_StillFindsRealDuplicates(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "a.ysm"), "same-content")
	testutil.WriteTestFile(t, filepath.Join(root, "b.ysm"), "same-content")

	groups, err := FindDuplicateFiles(root, true)
	testutil.NoError(t, err, "FindDuplicateFiles 不应报错")
	testutil.Equal(t, len(groups), 1, "真实重复必须仍被检出，实际 %v", groups)
	testutil.Equal(t, len(groups[0].Files), 2, "重复组应含两个文件，实际 %v", groups[0].Files)
}
