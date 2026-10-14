// ===== repoaudit 的 relink 备份尸体豁免（ADR-342 D6 / 对抗复核 A4）=====
//
// 背景：`AuditCtx` 的 walk 只跳 `.recycle` → 失败 relink 留下的 `<夹名>.relink-bak-<ts>`
// 子树被计入 TotalFiles/命中率/评分，与「回收站口径统一」的同一处注释自相矛盾。
package repoaudit

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestAudit_SkipsRelinkBackupCorpse 尸体不计入资源统计。
func TestAudit_SkipsRelinkBackupCorpse(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "live.ysm"), "live")
	testutil.WriteTestFile(t, filepath.Join(root, "sub.relink-bak-9", "x.ysm"), "old")

	res, err := Audit(root)
	testutil.NoError(t, err, "Audit 不应报错")
	testutil.Equal(t, res.Resources.TotalFiles, 1,
		"尸体子树不应计入 TotalFiles（否则体检报告虚高），实际 %d", res.Resources.TotalFiles)
}

// TestAudit_StillCountsNestedFiles 负向对照：正常嵌套文件仍应计入。
func TestAudit_StillCountsNestedFiles(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "live.ysm"), "live")
	testutil.WriteTestFile(t, filepath.Join(root, "nested", "other.ysm"), "other")

	res, err := Audit(root)
	testutil.NoError(t, err, "Audit 不应报错")
	testutil.Equal(t, res.Resources.TotalFiles, 2, "正常嵌套文件应计入，实际 %d", res.Resources.TotalFiles)
}
