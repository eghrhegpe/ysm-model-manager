// sync_targets_test.go：推送目标三路推导直测（ADR-351 D4 随 PushTargetsForUnit 下沉迁入）。
// 行为面在消费方 go/instance/status_counts_test.go 已有端到端覆盖（Overwrites 断言 ×4 +
// 子集契约）；本文件把纯函数契约钉在本包——路由知识与其实现同包后，重构消费方不再
// 旁路这里的单点语义。
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// TestPushTargetsForUnit_LeafFile 叶子文件：missing → files 无覆盖；diverged → files + overwrites。
func TestPushTargetsForUnit_LeafFile(t *testing.T) {
	files, dirs, ow := PushTargetsForUnit(types.ResourceSyncItem{
		Path: "g/a.ysm", Status: types.SyncStatusMissing, Type: "ysm",
	})
	if len(files) != 1 || files[0] != "g/a.ysm" || len(dirs) != 0 || len(ow) != 0 {
		t.Errorf("missing 叶子：got files=%v dirs=%v overwrites=%v", files, dirs, ow)
	}

	files, _, ow = PushTargetsForUnit(types.ResourceSyncItem{
		Path: "g/a.ysm", Status: types.SyncStatusDiverged, Type: "ysm",
	})
	if len(files) != 1 || len(ow) != 1 || ow[0] != "g/a.ysm" {
		t.Errorf("diverged 叶子：got files=%v overwrites=%v（应为覆盖目标）", files, ow)
	}
}

// TestPushTargetsForUnit_NestedChildren 容器递归：missing/diverged 子项进清单，
// synced/disabled 子项排除（禁用内容不推送——一键安装覆盖 .ban 是数据事故）。
func TestPushTargetsForUnit_NestedChildren(t *testing.T) {
	files, dirs, ow := PushTargetsForUnit(types.ResourceSyncItem{
		Path: "g/f", Status: types.SyncStatusDiverged, IsDir: true, Type: "ysm",
		Children: []types.ResourceSyncItem{
			{Path: "g/f/a.ysm", Status: types.SyncStatusMissing, Type: "ysm"},
			{Path: "g/f/b.ysm", Status: types.SyncStatusDiverged, Type: "ysm"},
			{Path: "g/f/c.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
			{Path: "g/f/d.ysm.ban", Status: types.SyncStatusDisabled, Type: "ysm"},
		},
	})
	if len(files) != 2 || files[0] != "g/f/a.ysm" || files[1] != "g/f/b.ysm" {
		t.Errorf("子项递归：got files=%v（synced/disabled 须排除）", files)
	}
	if len(dirs) != 0 {
		t.Errorf("有可装文件的夹不进 dirs：got %v", dirs)
	}
	if len(ow) != 1 || ow[0] != "g/f/b.ysm" {
		t.Errorf("仅 diverged 子项是覆盖目标：got %v", ow)
	}
}

// TestPushTargetsForUnit_EmptyFolderToDirs 真实空夹（磁盘上存在但夹内无受支持文件）
// → 整夹进 dirs（不退化成把目录塞进 files）；diverged 夹本身是覆盖目标。
func TestPushTargetsForUnit_EmptyFolderToDirs(t *testing.T) {
	dir := t.TempDir() // 空目录：DiffFolderContents 展开为空
	files, ds, ow := PushTargetsForUnit(types.ResourceSyncItem{
		Path: dir, Status: types.SyncStatusDiverged, IsDir: true, Type: "ysm",
	})
	if len(files) != 0 {
		t.Errorf("空夹不应产文件级目标：got %v", files)
	}
	if len(ds) != 1 || ds[0] != dir {
		t.Errorf("空夹应整夹进 dirs：got %v", ds)
	}
	if len(ow) != 1 || ow[0] != dir {
		t.Errorf("diverged 整夹推送 = 覆盖该夹：got %v", ow)
	}
}

// TestPushTargetsForUnit_FolderWithFilesOnDisk 磁盘上真实含文件的夹 → 展开为文件级目标
// （实例侧空串 = 全部按 missing），夹本身不进 dirs。
func TestPushTargetsForUnit_FolderWithFilesOnDisk(t *testing.T) {
	dir := t.TempDir()
	model := filepath.Join(dir, "m.ysm")
	testutil.NoError(t, os.WriteFile(model, []byte("m"), 0o644))
	files, ds, _ := PushTargetsForUnit(types.ResourceSyncItem{
		Path: dir, Status: types.SyncStatusMissing, IsDir: true, Type: "ysm",
	})
	if len(files) != 1 || files[0] != model {
		t.Errorf("夹内文件应展开为文件级目标：got %v", files)
	}
	if len(ds) != 0 {
		t.Errorf("有可装文件的夹不进 dirs：got %v", ds)
	}
}
