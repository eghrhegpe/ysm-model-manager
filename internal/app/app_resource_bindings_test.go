// ===== resource_bindings.go 薄壳级单测（零测试层补测）=====
// 覆盖：specificRoot 专属路径优先级 / voxelMaxBlocks 配置回退 / repoDirAccessible
// 目录可读判定 / GetDefaultRepoRoot 平台默认根。避开 Wails runtime 与真实配置目录。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestSpecificRoot_Priority(t *testing.T) {
	base := t.TempDir()

	t.Run("CustomRoots 专属路径优先", func(t *testing.T) {
		cfg := types.AppConfig{
			FilesRoot: base,
			CustomRoots: map[string]string{
				"resourcepack": filepath.Join(base, "rp-override"),
			},
		}
		got := specificRoot(cfg, "resourcepack")
		if got != cfg.CustomRoots["resourcepack"] {
			t.Errorf("CustomRoots 专属路径应优先, got %q want %q", got, cfg.CustomRoots["resourcepack"])
		}
	})

	t.Run("无 CustomRoots 条目时返回空", func(t *testing.T) {
		cfg := types.AppConfig{FilesRoot: base}
		if got := specificRoot(cfg, "ysm"); got != "" {
			t.Errorf("ysm 类型无专属条目应返回空, got %q", got)
		}
	})

	t.Run("未知类型返回空", func(t *testing.T) {
		cfg := types.AppConfig{FilesRoot: base}
		if got := specificRoot(cfg, "not-a-type"); got != "" {
			t.Errorf("未知类型应返回空, got %q", got)
		}
	})
}

// TestMigrateLegacyConfigFields 验证一次性迁移逻辑：将旧字段值搬到 CustomRoots，清空旧字段
func TestMigrateLegacyConfigFields(t *testing.T) {
	t.Run("迁移 YsmRoot 到 CustomRoots", func(t *testing.T) {
		base := t.TempDir()
		originalPath := filepath.Join(base, "ysm-override")
		cfg := types.AppConfig{
			FilesRoot: base,
			YsmRoot:   originalPath,
		}

		migrateLegacyConfigFields(&cfg)

		if cfg.CustomRoots["ysm"] != originalPath {
			t.Errorf("YsmRoot 应迁移到 CustomRoots['ysm'], got %q want %q", cfg.CustomRoots["ysm"], originalPath)
		}
		// 旧字段应被清空
		if cfg.YsmRoot != "" {
			t.Errorf("迁移后 YsmRoot 应被清空, got %q", cfg.YsmRoot)
		}
	})

	t.Run("迁移 MmdRoot 到多个 CustomRoots 条目", func(t *testing.T) {
		base := t.TempDir()
		cfg := types.AppConfig{
			FilesRoot: base,
			MmdRoot:   filepath.Join(base, "mmd-override"),
		}

		migrateLegacyConfigFields(&cfg)

		// MmdRoot 被多个类型（EntityPlayer, SceneModel 等）引用
		registry := types.LoadRegistry()
		for _, rt := range registry.ResourceTypes {
			if rt.ConfigField == "MmdRoot" {
				if cfg.CustomRoots[rt.ID] == "" {
					t.Errorf("类型 %s 的 MmdRoot 应迁移到 CustomRoots[%s]", rt.ID, rt.ID)
				}
			}
		}
		// 旧字段应被清空
		if cfg.MmdRoot != "" {
			t.Errorf("迁移后 MmdRoot 应被清空, got %q", cfg.MmdRoot)
		}
	})

	t.Run("CustomRoots 已有值时不覆盖", func(t *testing.T) {
		base := t.TempDir()
		existingPath := filepath.Join(base, "existing")
		cfg := types.AppConfig{
			FilesRoot: base,
			CustomRoots: map[string]string{
				"ysm": existingPath,
			},
			YsmRoot: filepath.Join(base, "new-override"),
		}

		migrateLegacyConfigFields(&cfg)

		if cfg.CustomRoots["ysm"] != existingPath {
			t.Errorf("已有 CustomRoots 条目不应被覆盖, got %q want %q", cfg.CustomRoots["ysm"], existingPath)
		}
	})

	t.Run("无旧字段值时不迁移", func(t *testing.T) {
		base := t.TempDir()
		cfg := types.AppConfig{
			FilesRoot: base,
		}

		migrateLegacyConfigFields(&cfg)

		// CustomRoots 应为空 map
		if len(cfg.CustomRoots) != 0 {
			t.Errorf("无旧字段值时 CustomRoots 应为空, got %v", cfg.CustomRoots)
		}
	})
}

func TestVoxelMaxBlocks_Fallback(t *testing.T) {
	t.Run("配置值为 0 → 默认 200000", func(t *testing.T) {
		a := repoApp(t, types.AppConfig{})
		if got := a.voxelMaxBlocks(); got != 200000 {
			t.Errorf("默认体素上限应为 200000, got %d", got)
		}
	})

	t.Run("配置值 >0 → 使用配置值", func(t *testing.T) {
		a := repoApp(t, types.AppConfig{VoxelMaxBlocks: 42})
		if got := a.voxelMaxBlocks(); got != 42 {
			t.Errorf("配置体素上限应为 42, got %d", got)
		}
	})
}

func TestRepoDirAccessible_File(t *testing.T) {
	// 目录存在/不存在判定已在 pathmgr_test.go 覆盖，这里只补「文件路径不算目录」边界
	dir := t.TempDir()
	p := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if repoDirAccessible(p) {
		t.Error("文件路径不应判定为可读目录")
	}
}

func TestGetDefaultRepoRoot(t *testing.T) {
	orig := pathMgr
	defer func() { pathMgr = orig }()

	t.Run("平台默认根为空 → 返回空", func(t *testing.T) {
		pathMgr = fakePathMgr{repo: ""}
		a := repoApp(t, types.AppConfig{})
		if got := a.GetDefaultRepoRoot(); got != "" {
			t.Errorf("默认根为空应返回空, got %q", got)
		}
	})

	t.Run("平台默认根可读 → 返回并创建", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "repo")
		pathMgr = fakePathMgr{repo: root}
		a := repoApp(t, types.AppConfig{})
		got := a.GetDefaultRepoRoot()
		if got != root {
			t.Errorf("应返回平台默认根, got %q want %q", got, root)
		}
		if _, err := os.Stat(root); err != nil {
			t.Errorf("默认根应被创建, err=%v", err)
		}
	})
}
