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
		// ysm 类型无 ConfigField 专属覆写 → 走 FilesRoot；此处用带专属字段的类型验证优先序
		// （registry 类型如 resourcepack 有 ConfigField=ResourcepackRoot）
		cfg2 := types.AppConfig{
			FilesRoot:        base,
			ResourcepackRoot: filepath.Join(base, "rp-override"),
		}
		a := repoApp(t, cfg2)
		got, err := a.GetRepoRoot("resourcepack")
		if err != nil {
			t.Fatal(err)
		}
		if got != cfg2.ResourcepackRoot {
			t.Errorf("specificRoot 应优先, got %q want %q", got, cfg2.ResourcepackRoot)
		}
	})

	t.Run("FilesRoot + 子目录", func(t *testing.T) {
		a := repoApp(t, cfg)
		got, err := a.GetRepoRoot("ysm")
		if err != nil {
			t.Fatal(err)
		}
		want := filepath.Join(base, types.StorageSubDir("ysm"))
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
		want := filepath.Join(root, types.StorageSubDir("ysm"))
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
