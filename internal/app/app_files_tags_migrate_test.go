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
)

func touch(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// ysmRepoRoot 返回 app 层重命名守卫实际认的仓库根（GetRepoRoot("ysm")，= FilesRoot
// 派生的 GroupStorageRoot 子目录）——测试文件必须落在此根内，isPathInRoot 才放行。
func ysmRepoRoot(t *testing.T, a *App) string {
	t.Helper()
	root, err := a.GetRepoRoot("ysm")
	if err != nil || root == "" {
		t.Fatalf("GetRepoRoot(ysm) 应可用，得 %q %v", root, err)
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestRenameFile_TagsFollow(t *testing.T) {
	base := t.TempDir()
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	repo := ysmRepoRoot(t, a)
	src := filepath.Join(repo, "a.ysm")
	touch(t, src)
	if err := a.SetModelTags(src, []string{"联动"}); err != nil {
		t.Fatal(err)
	}
	newAbs := filepath.Join(repo, "b.ysm")
	if err := a.RenameFile(src, "b.ysm"); err != nil {
		t.Fatalf("RenameFile: %v", err)
	}
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
	if err := a.RenameFile(src, "z.ysm"); err != nil {
		t.Fatal(err)
	}
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

	if err := a.RenameDir(dirA, "modelB"); err != nil {
		t.Fatalf("RenameDir: %v", err)
	}
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
	if err := a.MoveModelFile(ysmA, dstDir); err != nil {
		t.Fatalf("MoveModelFile: %v", err)
	}
	// move 提升：src=ysm.json → from=父夹 modelA → to=nested/modelA，子键整体跟随
	movedYsm := filepath.Join(dstDir, "modelA", "ysm.json")
	movedTex := filepath.Join(dstDir, "modelA", "sub", "face.png")
	if _, err := os.Lstat(movedYsm); err != nil {
		t.Fatalf("文件应真实搬到 plan.to 下: %v", err)
	}
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
	if err := a.CopyModelFile(src, dstDir); err != nil {
		t.Fatalf("CopyModelFile: %v", err)
	}
	dst := filepath.Join(dstDir, "m.ysm")
	if _, err := os.Lstat(dst); err != nil {
		t.Fatalf("复制目标应存在: %v", err)
	}
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
	if err := a.MoveModelFile(src, dstDir); err != nil {
		t.Fatalf("MoveModelFile: %v", err)
	}
	if got, _ := a.GetModelTags(filepath.Join(dstDir, "clean.ysm")); len(got) != 0 {
		t.Errorf("无标签模型移动后应仍无标签，实得 %v", got)
	}
}
