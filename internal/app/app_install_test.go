// ===== app_install.go 单测（覆盖安装/回收相关函数）=====
// 覆盖：countMatchingInDir 同名计数 / isResourcePackFolder 检测 / findRecycleRoot 多类型根命中。
// 避开 Wails runtime 与真实用户配置目录。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// installApp 构造注入 configCache + logger 的 App（AddOpLog 依赖 logger）
func installApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := scanApp(t, cfg)
	return a
}

// TestCountMatchingInDir 统计实例目录中与仓库同名的文件数（大小写不敏感）
func TestCountMatchingInDir(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	inst := filepath.Join(base, "inst")
	for _, d := range []string{repo, inst} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	a := installApp(t, types.AppConfig{})

	t.Run("单个同名文件", func(t *testing.T) {
		os.WriteFile(filepath.Join(repo, "a.ysm"), []byte("1"), 0o644)
		os.WriteFile(filepath.Join(inst, "a.ysm"), []byte("3"), 0o644)
		if got := a.countMatchingInDir(inst, repo); got != 1 {
			t.Errorf("应计 1 个同名文件, got %d", got)
		}
	})
	t.Run("跨大小写同名", func(t *testing.T) {
		os.RemoveAll(inst)
		os.MkdirAll(inst, 0o755)
		os.RemoveAll(repo)
		os.MkdirAll(repo, 0o755)
		os.WriteFile(filepath.Join(repo, "b.ysm"), []byte("2"), 0o644)
		os.WriteFile(filepath.Join(inst, "B.YSM"), []byte("4"), 0o644)
		if got := a.countMatchingInDir(inst, repo); got != 1 {
			t.Errorf("跨大小写应命中 1 个同名文件, got %d", got)
		}
	})
	t.Run("多同名文件", func(t *testing.T) {
		os.RemoveAll(inst)
		os.MkdirAll(inst, 0o755)
		os.RemoveAll(repo)
		os.MkdirAll(repo, 0o755)
		os.WriteFile(filepath.Join(repo, "x.ysm"), []byte("1"), 0o644)
		os.WriteFile(filepath.Join(repo, "y.ysm"), []byte("2"), 0o644)
		os.WriteFile(filepath.Join(inst, "x.ysm"), []byte("3"), 0o644)
		os.WriteFile(filepath.Join(inst, "y.ysm"), []byte("4"), 0o644)
		if got := a.countMatchingInDir(inst, repo); got != 2 {
			t.Errorf("应计 2 个同名文件, got %d", got)
		}
	})
	t.Run("空仓库返回0", func(t *testing.T) {
		os.RemoveAll(repo)
		os.MkdirAll(repo, 0o755)
		os.WriteFile(filepath.Join(inst, "z.ysm"), []byte("5"), 0o644)
		if got := a.countMatchingInDir(inst, repo); got != 0 {
			t.Errorf("空仓库应返回 0, got %d", got)
		}
	})
}

func TestIsResourcePackFolder(t *testing.T) {
	dir := t.TempDir()
	t.Run("含 pack.mcmeta → true", func(t *testing.T) {
		p := filepath.Join(dir, "rp")
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(p, "pack.mcmeta"), []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
		if !fsutil.IsResourcePackFolder(p) {
			t.Error("含 pack.mcmeta 的目录应判定为资源包")
		}
	})
	t.Run("不含 pack.mcmeta → false", func(t *testing.T) {
		p := filepath.Join(dir, "not-rp")
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if fsutil.IsResourcePackFolder(p) {
			t.Error("不含 pack.mcmeta 的目录不应判定为资源包")
		}
	})
	t.Run("目录不存在 → false", func(t *testing.T) {
		if fsutil.IsResourcePackFolder(filepath.Join(dir, "missing")) {
			t.Error("不存在的目录应返回 false")
		}
	})
}

func TestFindRecycleRoot_MultiType(t *testing.T) {
	base := t.TempDir()
	rp := filepath.Join(base, "resourcepacks")
	if err := os.MkdirAll(rp, 0o755); err != nil {
		t.Fatal(err)
	}
	a := installApp(t, types.AppConfig{
		FilesRoot: base,
		CustomRoots: map[string]string{
			"resourcepack": rp,
		},
	})

	t.Run("resourcepack 根内命中", func(t *testing.T) {
		got := a.findRecycleRoot(filepath.Join(rp, "某包.zip"))
		if got != rp {
			t.Fatalf("resourcepack 子目录应命中, got %q", got)
		}
	})

	t.Run("FilesRoot 默认命中", func(t *testing.T) {
		// ysm 子目录在 FilesRoot 内 → 应命中默认根
		ysm := filepath.Join(base, registry.GroupStorageRoot("ysm"))
		if err := os.MkdirAll(ysm, 0o755); err != nil {
			t.Fatal(err)
		}
		got := a.findRecycleRoot(filepath.Join(ysm, "m.ysm"))
		if got != ysm {
			t.Fatalf("ysm 子目录应命中, got %q", got)
		}
	})
}
