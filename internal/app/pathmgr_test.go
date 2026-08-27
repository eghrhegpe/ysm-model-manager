// ===== PathManager 回退链单测（code_review P3 补测）=====
// defaultRepoRoot nil 安全 / GetRepoRoot 三级回退顺序（specificRoot > FilesRoot >
// 平台默认）/ desktop 空串契约 / rtype=="" 与子目录拼接 / repoDirAccessible 校验。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// fakePathMgr 可注入的 pathManager（测 GetRepoRoot 平台默认回退，不依赖真实平台）
type fakePathMgr struct {
	appData string
	repo    string
}

func (f fakePathMgr) AppDataRoot() (string, error) { return f.appData, nil }
func (f fakePathMgr) DefaultRepoRoot() string      { return f.repo }

func TestDefaultRepoRoot_NilSafe(t *testing.T) {
	// nil pathMgr → 空串（无平台实现时安全失败）
	orig := pathMgr
	pathMgr = nil
	defer func() { pathMgr = orig }()
	if got := defaultRepoRoot(); got != "" {
		t.Errorf("nil pathMgr 时 defaultRepoRoot() = %q, 期望空串", got)
	}
}

func TestRepoDirAccessible(t *testing.T) {
	dir := t.TempDir()
	if !repoDirAccessible(dir) {
		t.Errorf("存在的目录 %s 应可访问", dir)
	}
	if repoDirAccessible(filepath.Join(dir, "不存在")) {
		t.Error("不存在的目录不应可访问")
	}
	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if repoDirAccessible(file) {
		t.Error("文件（非目录）不应可访问")
	}
}

// repoApp 构造注入 configCache 的 App（specificRoot 经 resource_types.json 注册表驱动）
func repoApp(t *testing.T, cfg types.AppConfig) *App {
	t.Helper()
	a := &App{}
	a.configMu.Lock()
	a.configCache = cfg
	a.configLoaded = true
	a.configMu.Unlock()
	return a
}

func TestGetRepoRoot_FallbackChain(t *testing.T) {
	base := t.TempDir()
	// 构造三层根：FilesRoot + 类型子目录；specificRoot 用真实注册表类型
	cfg := types.AppConfig{FilesRoot: base}

	t.Run("specificRoot 优先于 FilesRoot", func(t *testing.T) {
		// ysm 类型无专属覆写 → 走 FilesRoot；此处用带 CustomRoots 条目的类型验证优先序
		cfg2 := types.AppConfig{
			FilesRoot: base,
			CustomRoots: map[string]string{
				"resourcepack": filepath.Join(base, "rp-override"),
			},
		}
		a := repoApp(t, cfg2)
		got, err := a.GetRepoRoot("resourcepack")
		if err != nil {
			t.Fatal(err)
		}
		if got != cfg2.CustomRoots["resourcepack"] {
			t.Errorf("specificRoot 应优先, got %q want %q", got, cfg2.CustomRoots["resourcepack"])
		}
	})

	t.Run("FilesRoot + 子目录", func(t *testing.T) {
		a := repoApp(t, cfg)
		got, err := a.GetRepoRoot("ysm")
		if err != nil {
			t.Fatal(err)
		}
		// ADR-092 两层路由：FilesRoot/{group}/{storageSubDir}
		want := filepath.Join(base, types.GroupStorageRoot("ysm"))
		if got != want {
			t.Errorf("FilesRoot+子目录, got %q want %q", got, want)
		}
	})

	t.Run("rtype 空串返回 FilesRoot 根", func(t *testing.T) {
		a := repoApp(t, cfg)
		got, err := a.GetRepoRoot("")
		if err != nil {
			t.Fatal(err)
		}
		if got != base {
			t.Errorf("rtype 空串应返回 FilesRoot 根, got %q", got)
		}
	})
}

func TestGetRepoRoot_PlatformDefault(t *testing.T) {
	// 桌面契约：defaultRepoRoot() 为空 → 未配置 FilesRoot 时返回空（不静默回退）
	orig := pathMgr
	defer func() { pathMgr = orig }()

	t.Run("desktop 空默认根 → 返回空", func(t *testing.T) {
		pathMgr = fakePathMgr{repo: ""}
		a := repoApp(t, types.AppConfig{})
		got, err := a.GetRepoRoot("ysm")
		if err != nil {
			t.Fatal(err)
		}
		if got != "" {
			t.Errorf("desktop 未配置应返回空, got %q", got)
		}
	})

	t.Run("平台默认根存在且可读 → 回退", func(t *testing.T) {
		root := t.TempDir()
		pathMgr = fakePathMgr{repo: root}
		a := repoApp(t, types.AppConfig{})
		got, err := a.GetRepoRoot("ysm")
		if err != nil {
			t.Fatal(err)
		}
		// ADR-092 两层路由：FilesRoot/{group}/{storageSubDir}
		want := filepath.Join(root, types.GroupStorageRoot("ysm"))
		if got != want {
			t.Errorf("平台默认回退+子目录, got %q want %q", got, want)
		}
	})

	t.Run("平台默认根不可访问 → 返回空", func(t *testing.T) {
		root := filepath.Join(t.TempDir(), "不存在")
		pathMgr = fakePathMgr{repo: root}
		a := repoApp(t, types.AppConfig{})
		got, err := a.GetRepoRoot("ysm")
		if err != nil {
			t.Fatal(err)
		}
		if got != "" {
			t.Errorf("默认根不存在应返回空（保留未配置信号）, got %q", got)
		}
	})
}

// TestFilesRootForSync 整合包同步基准目录解析：
// 扁平化架构下，所有类型统一走 GetRepoRoot，返回 FilesRoot/{group}/{storageSubDir}。
// MMD 子类型（EntityPlayer 等）各自独立，专属 CustomRoots 优先。
func TestFilesRootForSync(t *testing.T) {
	base := t.TempDir()

	t.Run("EntityPlayer 走 group/storageSubDir", func(t *testing.T) {
		a := repoApp(t, types.AppConfig{FilesRoot: base})
		got, err := a.filesRootForSync("EntityPlayer")
		if err != nil {
			t.Fatal(err)
		}
		// 用生产函数派生期望值（而非手写快照），注册表改了测试自动跟
		want := filepath.Join(base, types.GroupStorageRoot("EntityPlayer"))
		if got != want {
			t.Errorf("filesRootForSync(EntityPlayer) 应为 group/storageSubDir, got %q want %q", got, want)
		}
	})

	t.Run("专属 CustomRoots 优先", func(t *testing.T) {
		override := filepath.Join(base, "mmd-override")
		a := repoApp(t, types.AppConfig{
			FilesRoot: base,
			CustomRoots: map[string]string{
				"EntityPlayer": override,
			},
		})
		got, err := a.filesRootForSync("EntityPlayer")
		if err != nil {
			t.Fatal(err)
		}
		if got != override {
			t.Errorf("专属 CustomRoots 应优先, got %q want %q", got, override)
		}
	})

	t.Run("YSM 走 GetRepoRoot", func(t *testing.T) {
		a := repoApp(t, types.AppConfig{FilesRoot: base})
		got, err := a.filesRootForSync("ysm")
		if err != nil {
			t.Fatal(err)
		}
		want := filepath.Join(base, types.GroupStorageRoot("ysm"))
		if got != want {
			t.Errorf("ysm 应走 GetRepoRoot, got %q want %q", got, want)
		}
	})

	t.Run("FilesRoot 为空回退 GetRepoRoot（不 panic）", func(t *testing.T) {
		a := repoApp(t, types.AppConfig{})
		got, err := a.filesRootForSync("EntityPlayer")
		if err != nil {
			t.Fatal(err)
		}
		want, _ := a.GetRepoRoot("EntityPlayer")
		if got != want {
			t.Errorf("FilesRoot 空应回退 GetRepoRoot, got %q want %q", got, want)
		}
	})
}

// TestGlobalRootSuspicious 仓库侧宽目录探测：含 mods/config/saves/resourcepacks/
// shaderpacks 或 FilesRoot 特征（minecraft-mod/schematics）→ 判定过宽；专门的
// 蓝图子目录（仅 .nbt / 普通 schematics）不应误报。
func TestGlobalRootSuspicious(t *testing.T) {
	base := t.TempDir()

	// 普通专门目录（无宽目录特征）→ false
	dedicated := filepath.Join(base, "blueprints")
	if err := os.MkdirAll(dedicated, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dedicated, "a.nbt"), []byte("n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if globalRootSuspicious(dedicated) {
		t.Errorf("专门蓝图目录不应判为过宽: %s", dedicated)
	}

	// Minecraft 实例根特征：含 mods 子目录 → true
	inst := filepath.Join(base, "mc-instance")
	_ = os.MkdirAll(filepath.Join(inst, "mods"), 0o755)
	if !globalRootSuspicious(inst) {
		t.Errorf("含 mods 的目录应判为过宽: %s", inst)
	}

	// FilesRoot 总根特征：minecraft-mod/schematics → true
	fsroot := filepath.Join(base, "filesroot")
	_ = os.MkdirAll(filepath.Join(fsroot, "minecraft-mod", "schematics"), 0o755)
	if !globalRootSuspicious(fsroot) {
		t.Errorf("FilesRoot 总根应判为过宽: %s", fsroot)
	}

	// config 子目录 → true
	cfgDir := filepath.Join(base, "with-config")
	_ = os.MkdirAll(filepath.Join(cfgDir, "config"), 0o755)
	if !globalRootSuspicious(cfgDir) {
		t.Errorf("含 config 的目录应判为过宽: %s", cfgDir)
	}

	// 空串 / 不存在目录 → false
	if globalRootSuspicious("") {
		t.Error("空串不应判为过宽")
	}
	if globalRootSuspicious(filepath.Join(base, "no-such")) {
		t.Error("不存在目录不应判为过宽")
	}
}
