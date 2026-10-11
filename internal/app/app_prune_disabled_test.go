package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// repoRootFor 返回指定 rtype 的实际仓库根（GetRepoRoot 派生 FilesRoot/{group}/{storageSubDir}），
// 并建好目录——测试文件必须落在此根内，DeleteResourcePack/DeleteModelFile 守卫才放行
// （口径同 app_files_tags_migrate_test.go|ysmRepoRoot）。
func repoRootFor(t *testing.T, a *App, rtype string) string {
	t.Helper()
	root, err := a.GetRepoRoot(rtype)
	if err != nil || root == "" {
		t.Fatalf("GetRepoRoot(%q) 应可用，得 %q %v", rtype, root, err)
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	return root
}

// TestDeleteResourcePack_DisabledFilePrunesBasePath 锁「禁用态删除补清规范路径标签键」：
// 启禁是可逆往返、标签不 relocate（TestToggleEnable_TagRoundTripPreservesBasePath），
// 但删 .disabled 文件时标签键停在规范路径上成孤儿——必须一并清（防同名重建复活旧标签）。
// 锐评 2026-10-11 复盘补漏。
// 不加 t.Parallel()：repoApp 走包级全局 configDirOverride（无锁），并行会互踩。
func TestDeleteResourcePack_DisabledFilePrunesBasePath(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	root := repoRootFor(t, a, "ysm")

	sub := filepath.Join(root, "X")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	canonical := filepath.Join(sub, "model.ysm")
	if err := os.WriteFile(canonical, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := a.SetModelTags(canonical, []string{"联动"}); err != nil {
		t.Fatalf("打标应成功: %v", err)
	}
	if _, err := a.ToggleEnable(canonical); err != nil {
		t.Fatalf("禁用应成功: %v", err)
	}
	if _, err := os.Stat(canonical + ".disabled"); err != nil {
		t.Fatalf("禁用后应有 .disabled 文件: %v", err)
	}

	// 删除禁用态文件（文件型资源，绝对路径）
	if err := a.DeleteResourcePack(canonical+".disabled", "ysm"); err != nil {
		t.Fatalf("删除禁用文件应成功: %v", err)
	}
	if got, _ := a.GetModelTags(canonical); len(got) != 0 {
		t.Errorf("删除禁用文件后规范路径标签应清空（防复活）, got %v", got)
	}
}

// TestDeleteResourcePack_DisabledDirPrunesBasePath 目录型：整组禁用后父目录名带 .disabled，
// 标签键仍在规范路径（去后缀的目录名下），删整夹后规范路径子树键必须清空。
// 用 maid-model（isDir=true），入口文件 ysm.json 在整夹内——ToggleEnable 走提升分支
// 把父目录 Group 改名 Group.disabled。
func TestDeleteResourcePack_DisabledDirPrunesBasePath(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base})
	// rtype 传 maid-model（isDir=true）触发目录分支；目录守卫用 rtype 自身根，
	// 非 ysm 根下的目录型资源也能删（修复前硬编码 a.ysmRoot() 会误拒）。
	root := repoRootFor(t, a, "maid-model")

	dir := filepath.Join(root, "Group")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	canonical := filepath.Join(dir, "ysm.json")
	if err := os.WriteFile(canonical, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := a.SetModelTags(canonical, []string{"联动"}); err != nil {
		t.Fatalf("打标应成功: %v", err)
	}
	// 目录级禁用：父目录名变 Group.disabled
	disabledDir := dir + ".disabled"
	if _, err := a.ToggleEnable(canonical); err != nil {
		t.Fatalf("禁用应成功: %v", err)
	}
	if _, err := os.Stat(disabledDir); err != nil {
		t.Fatalf("整组禁用后应有 .disabled 目录: %v", err)
	}

	if err := a.DeleteResourcePack(filepath.Join(disabledDir, "ysm.json"), "maid-model"); err != nil {
		t.Fatalf("删除禁用整夹应成功: %v", err)
	}
	if got, _ := a.GetModelTags(canonical); len(got) != 0 {
		t.Errorf("删除禁用整夹后规范路径标签应清空, got %v", got)
	}
}
