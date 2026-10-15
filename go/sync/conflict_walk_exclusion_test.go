// conflict_walk_exclusion_test.go：冲突检测通道的回收站/备份尸体排除（ADR-351 D1）。
// 行为修复验证：collectFileEntries 曾完全缺失该过滤——本测试构造「两侧 .recycle 内
// 同名不同内容文件」的历史幻影冲突现场，断言现被排除；正常文件冲突不受影响。
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestDetectConflicts_RecycleSubtreeExcluded 两端 .recycle 子树内文件不参与冲突比对。
func TestDetectConflicts_RecycleSubtreeExcluded(t *testing.T) {
	localDir := t.TempDir()
	remoteDir := t.TempDir()

	// 两侧回收站内同名不同内容（旧实现产出幻影冲突的现场）
	for _, d := range []string{localDir, remoteDir} {
		if err := os.MkdirAll(filepath.Join(d, ".recycle"), 0o755); err != nil {
			testutil.NoError(t, err)
		}
	}
	testutil.NoError(t, os.WriteFile(filepath.Join(localDir, ".recycle", "a.ysm"), []byte("local-trash"), 0o644))
	testutil.NoError(t, os.WriteFile(filepath.Join(remoteDir, ".recycle", "a.ysm"), []byte("remote-trash"), 0o644))

	report, err := DetectConflicts(localDir, remoteDir, "ysm")
	testutil.NoError(t, err)
	if report.TotalConflicts != 0 {
		t.Errorf("回收站内文件不应参与冲突比对：got %d conflicts, want 0（幻影冲突回归）", report.TotalConflicts)
	}
}

// TestDetectConflicts_RelinkBackupExcluded 备份尸体子树不参与冲突比对。
func TestDetectConflicts_RelinkBackupExcluded(t *testing.T) {
	localDir := t.TempDir()
	remoteDir := t.TempDir()

	bak := "model.relink-bak-1759000000000000000"
	testutil.NoError(t, os.MkdirAll(filepath.Join(localDir, bak), 0o755))
	testutil.NoError(t, os.WriteFile(filepath.Join(localDir, bak, "m.ysm"), []byte("backup-corpse"), 0o644))
	testutil.NoError(t, os.WriteFile(filepath.Join(remoteDir, "m.ysm"), []byte("active"), 0o644))

	report, err := DetectConflicts(localDir, remoteDir, "ysm")
	testutil.NoError(t, err)
	// 备份尸体被剔除后两侧 relPath 键集不相交（local 侧唯一文件在 bak/ 子树内），
	// 不构成冲突；旧实现会按 m.ysm vs bak/m.ysm 各自独有跳过——但尸体照常付哈希且
	// 若两侧尸体形态对称（互为恢复点）则产出幻影冲突。本例钉死「剔除即静默」。
	if report.TotalConflicts != 0 {
		t.Errorf("备份尸体子树不应参与冲突比对：got %d conflicts, want 0", report.TotalConflicts)
	}
}

// TestDetectConflicts_NormalConflictUnaffected 正常冲突（两侧活跃文件同路径异内容）不受闸影响。
func TestDetectConflicts_NormalConflictUnaffected(t *testing.T) {
	localDir := t.TempDir()
	remoteDir := t.TempDir()

	testutil.NoError(t, os.WriteFile(filepath.Join(localDir, "a.ysm"), []byte("local-modified"), 0o644))
	testutil.NoError(t, os.WriteFile(filepath.Join(remoteDir, "a.ysm"), []byte("remote-original"), 0o644))

	report, err := DetectConflicts(localDir, remoteDir, "ysm")
	testutil.NoError(t, err)
	if report.TotalConflicts != 1 || report.Conflicts[0].Type != ConflictContentModified {
		t.Errorf("正常内容冲突应恰好检出 1 个 content_modified：got %d conflicts", report.TotalConflicts)
	}
}
