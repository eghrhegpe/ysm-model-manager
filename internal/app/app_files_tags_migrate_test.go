// 标签随文件改名/移动/复制跟随（桌面端 rekey 接线端到端，锐评 2026-10-10）。
// 验证「接线不自算路径」的核心保证：app 绑定搬迁后，用**文件真实新落点**查 GetTags 命中、
// 旧落点空。ysm.json 提升为整夹移动的 subtree 迁移是重点回归场景（标签 key 打在
// .../modelA/ysm.json，move 提升 from=父夹 → 子键须整体迁到 .../nested/modelA/ysm.json）。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

func touch(t *testing.T, p string) {
	t.Helper()
	err := os.MkdirAll(filepath.Dir(p), 0o755)
	testutil.NoError(t, err, "MkdirAll")
	err = os.WriteFile(p, []byte("x"), 0o644)
	testutil.NoError(t, err, "WriteFile")
}

// ysmRepoRoot 返回 app 层重命名守卫实际认的仓库根（GetRepoRoot("ysm")，= FilesRoot
// 派生的 GroupStorageRoot 子目录）——测试文件必须落在此根内，isPathInRoot 才放行。
func ysmRepoRoot(t *testing.T, a *App) string {
	t.Helper()
	root, err := a.GetRepoRoot("ysm")
	testutil.NoError(t, err, "GetRepoRoot(ysm)")
	testutil.Equal(t, root != "", true, "GetRepoRoot(ysm) 应可用")
	err = os.MkdirAll(root, 0o755)
	testutil.NoError(t, err, "MkdirAll")
	return root
}

func TestRenameFile_TagsFollow(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	src := filepath.Join(repo, "a.ysm")
	touch(t, src)
	err := a.SetModelTags(src, []string{"联动"})
	testutil.NoError(t, err, "SetModelTags")
	newAbs := filepath.Join(repo, "b.ysm")
	err = a.RenameFile(src, "b.ysm")
	testutil.NoError(t, err, "RenameFile")
	if got, _ := a.GetModelTags(newAbs); len(got) != 1 || got[0] != "联动" {
		t.Errorf("改名后新路径应有标签，实得 %v", got)
	}
	if got, _ := a.GetModelTags(src); len(got) != 0 {
		t.Errorf("改名后旧路径应无标签（move 语义删旧键），实得 %v", got)
	}
	// ListByTag 跟随到新路径
	paths, _ := a.ListByTag("联动")
	if len(paths) != 1 || paths[0] != newAbs {
		t.Errorf("ListByTag 应返回新路径，实得 %v", paths)
	}
}

func TestRenameFile_SiblingPrefixNotTouched(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	src := filepath.Join(repo, "m.ysm")
	sib := filepath.Join(repo, "m.ysm.bak") // 字符串前缀陷阱：m.ysm ⊂ m.ysm.bak
	touch(t, src)
	touch(t, sib)
	_ = a.SetModelTags(src, []string{"改我"})
	_ = a.SetModelTags(sib, []string{"别碰"})
	err := a.RenameFile(src, "z.ysm")
	testutil.NoError(t, err, "RenameFile")
	if got, _ := a.GetModelTags(sib); len(got) != 1 || got[0] != "别碰" {
		t.Errorf("同前缀兄弟键 subtree=false 不该被动，实得 %v", got)
	}
}

func TestRenameDir_TagsFollowSubtree(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	dirA := filepath.Join(repo, "modelA")
	touch(t, filepath.Join(dirA, "ysm.json"))
	touch(t, filepath.Join(dirA, "sub", "face.png"))
	// 标签打在 ysm.json（ysm 夹模型 entry.Path 指向清单文件）
	ysmA := filepath.Join(dirA, "ysm.json")
	_ = a.SetModelTags(ysmA, []string{"联动"})
	sibling := filepath.Join(repo, "modelAbc")
	touch(t, filepath.Join(sibling, "ysm.json"))
	sibYsm := filepath.Join(sibling, "ysm.json")
	_ = a.SetModelTags(sibYsm, []string{"无关"})

	err := a.RenameDir(dirA, "modelB")
	testutil.NoError(t, err, "RenameDir")
	newYsm := filepath.Join(repo, "modelB", "ysm.json")
	if got, _ := a.GetModelTags(newYsm); len(got) != 1 || got[0] != "联动" {
		t.Errorf("夹改名后新路径 ysm.json 应继承标签，实得 %v", got)
	}
	// 兄弟 modelAbc 不被 modelA 前缀误伤
	if got, _ := a.GetModelTags(sibYsm); len(got) != 1 || got[0] != "无关" {
		t.Errorf("同前缀兄弟夹不该被误迁，实得 %v", got)
	}
}

func TestMoveModelFile_YsmJsonLiftsEntireFolder(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	dirA := filepath.Join(repo, "modelA")
	ysmA := filepath.Join(dirA, "ysm.json")
	texA := filepath.Join(dirA, "sub", "face.png")
	touch(t, ysmA)
	touch(t, texA)
	_ = a.SetModelTags(ysmA, []string{"主"})
	_ = a.SetModelTags(texA, []string{"纹理"})

	dstDir := filepath.Join(repo, "nested")
	err := a.MoveModelFile(ysmA, dstDir)
	testutil.NoError(t, err, "MoveModelFile")
	// move 提升：src=ysm.json → from=父夹 modelA → to=nested/modelA，子键整体跟随
	movedYsm := filepath.Join(dstDir, "modelA", "ysm.json")
	movedTex := filepath.Join(dstDir, "modelA", "sub", "face.png")
	testutil.FileExists(t, movedYsm, "文件应真实搬到 plan.to 下")
	if got, _ := a.GetModelTags(movedYsm); len(got) != 1 || got[0] != "主" {
		t.Errorf("提升整夹移动后 ysm.json 标签应跟随新落点，实得 %v", got)
	}
	if got, _ := a.GetModelTags(movedTex); len(got) != 1 || got[0] != "纹理" {
		t.Errorf("子文件标签应跟随，实得 %v", got)
	}
	if got, _ := a.GetModelTags(ysmA); len(got) != 0 {
		t.Errorf("move 语义旧键应删，实得 %v", got)
	}
}

func TestCopyModelFile_KeepsSource(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	src := filepath.Join(repo, "m.ysm")
	touch(t, src)
	_ = a.SetModelTags(src, []string{"复制我"})
	dstDir := filepath.Join(repo, "out")
	err := a.CopyModelFile(src, dstDir)
	testutil.NoError(t, err, "CopyModelFile")
	dst := filepath.Join(dstDir, "m.ysm")
	testutil.FileExists(t, dst, "复制目标应存在")
	if got, _ := a.GetModelTags(src); len(got) != 1 {
		t.Errorf("copy=true 源标签必须保留，实得 %v", got)
	}
	if got, _ := a.GetModelTags(dst); len(got) != 1 || got[0] != "复制我" {
		t.Errorf("copy 目标应得标签副本，实得 %v", got)
	}
}

func TestMoveModelFile_NoTagsNoOp(t *testing.T) {
	// 未打过标签的模型移动：迁移 no-op，不打日志、不报错（绝大多数路径）
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	src := filepath.Join(repo, "clean.ysm")
	touch(t, src)
	dstDir := filepath.Join(repo, "out")
	err := a.MoveModelFile(src, dstDir)
	testutil.NoError(t, err, "MoveModelFile")
	if got, _ := a.GetModelTags(filepath.Join(dstDir, "clean.ysm")); len(got) != 0 {
		t.Errorf("无标签模型移动后应仍无标签，实得 %v", got)
	}
}
