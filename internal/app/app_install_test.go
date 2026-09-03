// ===== app_install.go 薄壳级单测（零测试层补测）=====
// 覆盖：countMatchingInDir 同名计数 / isResourcePackFolder 检测 / findRecycleRoot 多类型根命中。
// 避开 Wails runtime 与真实用户配置目录。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// installApp 构造注入 configCache + logger 的 App（AddOpLog 依赖 logger）
func installApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := scanApp(t, cfg)
	return a
}

func TestCountMatchingInDir(t *testing.T) {
	base := t.TempDir()
	repo := filepath.Join(base, "repo")
	inst := filepath.Join(base, "inst")
	for _, d := range []string{repo, inst} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// 仓库：a.ysm / b.ysm
	if err := os.WriteFile(filepath.Join(repo, "a.ysm"), []byte("1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "b.ysm"), []byte("2"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 实例：a.ysm（同名）/ c.ysm（独有）/ d.ZIP（大小写不敏感同名）
	if err := os.WriteFile(filepath.Join(inst, "a.ysm"), []byte("3"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inst, "c.ysm"), []byte("4"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inst, "d.ZIP"), []byte("5"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := installApp(t, types.AppConfig{})
	if got := a.countMatchingInDir(inst, repo); got != 1 {
		t.Errorf("应计 1 个同名文件（a.ysm）, got %d", got)
	}
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
		if !isResourcePackFolder(p) {
			t.Error("含 pack.mcmeta 的目录应判定为资源包")
		}
	})
	t.Run("不含 pack.mcmeta → false", func(t *testing.T) {
		p := filepath.Join(dir, "not-rp")
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		if isResourcePackFolder(p) {
			t.Error("不含 pack.mcmeta 的目录不应判定为资源包")
		}
	})
	t.Run("目录不存在 → false", func(t *testing.T) {
		if isResourcePackFolder(filepath.Join(dir, "missing")) {
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
		FilesRoot:        base,
		ResourcepackRoot: rp,
	})

	t.Run("resourcepack 根内命中", func(t *testing.T) {
		got := a.findRecycleRoot(filepath.Join(rp, "某包.zip"))
		if got != rp {
			t.Fatalf("resourcepack 子目录应命中, got %q", got)
		}
	})

	t.Run("未配置根不参与（空跳过）", func(t *testing.T) {
		// ShaderpackRoot 未配置 → 不参与候选；路径落到 FilesRoot 内 → 命中 ysm 子目录
		ysm := filepath.Join(base, types.GroupStorageRoot("ysm"))
		if err := os.MkdirAll(ysm, 0o755); err != nil {
			t.Fatal(err)
		}
		got := a.findRecycleRoot(filepath.Join(ysm, "m.ysm"))
		if got != ysm {
			t.Fatalf("ysm 子目录应命中, got %q", got)
		}
	})
}
