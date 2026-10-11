// 回收站删除半侧标签键清理（审计 G1 收口，2026-10-11）。
// 语义分界：
//   - **永久删除**（DeleteFromRecycle / EmptyRecycleBin）→ 必须 PruneKeys：
//     条目永灭，原始路径旧键成**永久孤儿**——同名重导/同步回拉即复活旧标签
//     （PruneKeys 立因病）。
//   - **移入回收站**（MoveToRecycle）→ **刻意不 prune**：临时态，Restore 自愈
//     （文件回原路径、键复活）；prune 反而丢用户标签。
//
// 路径不自算：原始路径由回收站侧条目经 rel 反推（.recycle/<rel> 镜像资源根
// 相对路径，与 go-recycle 卡「回收站在盘上的结构」同律），与 Restore 落点推导同源。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

func TestDeleteFromRecycle_PrunesTagKeys(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	src := filepath.Join(repo, "fox.ysm")
	touch(t, src)
	err := a.SetModelTags(src, []string{"狐"})
	testutil.NoError(t, err, "SetModelTags")
	// 移入回收站：临时孤儿态（条目可恢复），键保留
	err = a.MoveToRecycle(src)
	testutil.NoError(t, err, "MoveToRecycle")
	got, _ := a.GetModelTags(src)
	testutil.Equal(t, len(got), 1, "条目永久删除前标签键应保留（restore 自愈），实得 %v", got)
	recEntry := filepath.Join(repo, ".recycle", "fox.ysm")
	err = a.DeleteFromRecycle(recEntry)
	testutil.NoError(t, err, "DeleteFromRecycle")
	if got, _ := a.GetModelTags(src); len(got) != 0 {
		t.Errorf("条目永久删除后标签键应清理，实得 %v", got)
	}
}

func TestDeleteFromRecycle_DirGroupPrunesSubtree(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	dirA := filepath.Join(repo, "modelA")
	ysmA := filepath.Join(dirA, "ysm.json")
	texA := filepath.Join(dirA, "sub", "face.png")
	touch(t, ysmA)
	touch(t, texA)
	err := a.SetModelTags(ysmA, []string{"主"})
	testutil.NoError(t, err, "SetModelTags")
	err = a.SetModelTags(texA, []string{"纹理"})
	testutil.NoError(t, err, "SetModelTags")
	// 整目录组移入回收站后永久删除 → 子树剪枝盖住组内全部键
	err = a.MoveToRecycle(dirA)
	testutil.NoError(t, err, "MoveToRecycle")
	recEntry := filepath.Join(repo, ".recycle", "modelA")
	err = a.DeleteFromRecycle(recEntry)
	testutil.NoError(t, err, "DeleteFromRecycle")
	if got, _ := a.GetModelTags(ysmA); len(got) != 0 {
		t.Errorf("目录组永久删除后 ysm.json 键应清理，实得 %v", got)
	}
	if got, _ := a.GetModelTags(texA); len(got) != 0 {
		t.Errorf("目录组永久删除后子文件键应清理（子树剪枝），实得 %v", got)
	}
}

func TestEmptyRecycleBin_PrunesTagKeys(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	fileSrc := filepath.Join(repo, "a.ysm")
	dirSrc := filepath.Join(repo, "modelB")
	touch(t, fileSrc)
	touch(t, filepath.Join(dirSrc, "ysm.json"))
	err := a.SetModelTags(fileSrc, []string{"独"})
	testutil.NoError(t, err, "SetModelTags")
	err = a.SetModelTags(filepath.Join(dirSrc, "ysm.json"), []string{"组"})
	testutil.NoError(t, err, "SetModelTags")
	err = a.MoveToRecycle(fileSrc)
	testutil.NoError(t, err, "MoveToRecycle")
	err = a.MoveToRecycle(dirSrc)
	testutil.NoError(t, err, "MoveToRecycle")
	_, err = a.EmptyRecycleBin()
	testutil.NoError(t, err, "EmptyRecycleBin")
	if got, _ := a.GetModelTags(fileSrc); len(got) != 0 {
		t.Errorf("清空回收站后文件条目键应清理，实得 %v", got)
	}
	if got, _ := a.GetModelTags(filepath.Join(dirSrc, "ysm.json")); len(got) != 0 {
		t.Errorf("清空回收站后目录组条目键应清理，实得 %v", got)
	}
}

func TestMoveToRecycle_NotPruned(t *testing.T) {
	// 反模式锁：移入回收站是临时态——prune 即丢标签，Restore 才是自愈出口
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	src := filepath.Join(repo, "keep.ysm")
	touch(t, src)
	err := a.SetModelTags(src, []string{"留"})
	testutil.NoError(t, err, "SetModelTags")
	err = a.MoveToRecycle(src)
	testutil.NoError(t, err, "MoveToRecycle")
	if got, _ := a.GetModelTags(src); len(got) != 1 || got[0] != "留" {
		t.Errorf("移入回收站后键应保留（restore 自愈，prune 即丢标签），实得 %v", got)
	}
	// Restore 自愈闭环
	recEntry := filepath.Join(repo, ".recycle", "keep.ysm")
	err = a.RestoreFromRecycle(recEntry, repo)
	testutil.NoError(t, err, "RestoreFromRecycle")
	if _, err := os.Lstat(src); err != nil {
		t.Errorf("恢复后文件应回原位: %v", err)
	}
	if got, _ := a.GetModelTags(src); len(got) != 1 {
		t.Errorf("恢复后标签应复现，实得 %v", got)
	}
}
