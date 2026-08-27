// ===== internal/app 薄壳级单测（零测试层补测）=====
// 配置读写/窗口状态/MC 目录扫描的纯逻辑部分——避开 Wails runtime 与
// 真实用户配置目录（不调用 saveConfig/configPath 写入，不触发 user32 API）
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestOrDefault(t *testing.T) {
	cases := []struct {
		val, fallback, want string
	}{
		{"x", "y", "x"}, // 非空 → val
		{"", "y", "y"},  // 空 → fallback
		{"", "", ""},    // 双空 → ""
	}
	for _, c := range cases {
		if got := orDefault(c.val, c.fallback); got != c.want {
			t.Errorf("orDefault(%q, %q) = %q, 期望 %q", c.val, c.fallback, got, c.want)
		}
	}
}

func TestSafePct(t *testing.T) {
	cases := []struct {
		val, total, want int
	}{
		{50, 100, 50},
		{150, 100, 100}, // 越界上限夹取
		{-10, 100, 0},   // 越界下限夹取
		{50, 0, 50},     // total<=0 兜底 50
		{50, -5, 50},    // total 负值兜底
	}
	for _, c := range cases {
		if got := safePct(c.val, c.total); got != c.want {
			t.Errorf("safePct(%d, %d) = %d, 期望 %d", c.val, c.total, got, c.want)
		}
	}
}

func TestFindConfigFile(t *testing.T) {
	dir := t.TempDir()
	real := filepath.Join(dir, "real.json")
	if err := os.WriteFile(real, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(dir, "missing.json")

	if got := findConfigFile(missing, real); got != real {
		t.Errorf("应返回第一个存在的文件, got %q", got)
	}
	if got := findConfigFile(missing); got != missing {
		t.Errorf("全不存在 → 返回第一个候选, got %q", got)
	}
	if got := findConfigFile(); got != "" {
		t.Errorf("空候选 → 空串, got %q", got)
	}
}

func TestConfigPathFormat(t *testing.T) {
	p := configPath()
	if filepath.Base(p) != "ysm_config.json" {
		t.Errorf("configPath 应以 ysm_config.json 结尾, got %q", p)
	}
	if filepath.Base(filepath.Dir(p)) != "YSM-Model-Manager" {
		t.Errorf("configPath 目录应为 YSM-Model-Manager, got %q", filepath.Dir(p))
	}
}

// configDir：平台数据根缺失（Android 沙盒不可用）时绝不退化为相对路径
// （filepath.Join("", "YSM-Model-Manager") = 相对路径，CWD=/ 只读 → 无意义
// 的 read-only 报错，P1 审核：不静默降级为 "."）
func TestConfigDir_NoRelativeFallback(t *testing.T) {
	saved := pathMgr
	defer func() { pathMgr = saved }()
	pathMgr = nil
	if dir := configDir(); dir != "" {
		t.Errorf("configDir() 应为空串（无相对路径退化）, got %q", dir)
	}
	if p := configPath(); p != "" {
		t.Errorf("configPath() 应为空串, got %q", p)
	}
}

// ValidateMinecraftDir：MC 目录扫描（t.TempDir 构造各场景，纯文件系统）
func TestValidateMinecraftDir(t *testing.T) {
	a := &App{}

	t.Run("含 versions/ 子目录 → 接受", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dir, "versions"), 0o755); err != nil {
			t.Fatal(err)
		}
		got, msg := a.ValidateMinecraftDir(dir)
		if got == "" {
			t.Errorf("含 versions/ 应接受, msg=%q", msg)
		}
	})

	t.Run("含 .minecraft/versions → 返回 .minecraft 子目录", func(t *testing.T) {
		dir := t.TempDir()
		mcSub := filepath.Join(dir, ".minecraft")
		if err := os.MkdirAll(filepath.Join(mcSub, "versions"), 0o755); err != nil {
			t.Fatal(err)
		}
		got, _ := a.ValidateMinecraftDir(dir)
		if got != mcSub {
			t.Errorf("应返回 .minecraft 子目录, got %q", got)
		}
	})

	t.Run("含 instances/ 子目录（PrismLauncher）→ 接受", func(t *testing.T) {
		dir := t.TempDir()
		if err := os.MkdirAll(filepath.Join(dir, "instances"), 0o755); err != nil {
			t.Fatal(err)
		}
		got, msg := a.ValidateMinecraftDir(dir)
		if got == "" {
			t.Errorf("含 instances/ 应接受, msg=%q", msg)
		}
	})

	t.Run("空目录 → 拒绝并给错误消息", func(t *testing.T) {
		dir := t.TempDir()
		got, msg := a.ValidateMinecraftDir(dir)
		if got != "" {
			t.Errorf("空目录应拒绝, got %q", got)
		}
		if msg == "" {
			t.Error("拒绝时应有错误消息")
		}
	})

	t.Run("空串 → 拒绝", func(t *testing.T) {
		got, _ := a.ValidateMinecraftDir("")
		if got != "" {
			t.Error("空串应拒绝")
		}
	})
}

// TestValidUpdateURL 表驱动：覆盖合法域名、后缀绕过攻击、scheme 拒绝
func TestValidUpdateURL(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		// ---- 合法 ----
		{"https://github.com/owner/repo/releases/download/v1.0/app.zip", true},
		{"https://raw.githubusercontent.com/owner/repo/main/app.zip", true},
		{"https://objects.githubusercontent.com/abc/def/app.zip", true},
		{"https://user-images.githubusercontent.com/123/456/app.png", true},
		{"https://www.github.com/owner/repo/releases/latest", true},
		{"https://ghfast.top/files/app.zip", true},
		{"https://gh-proxy.com/d/app.zip", true},
		// 大小写不敏感
		{"https://GITHUB.COM/owner/repo", true},
		{"https://Raw.GitHubusercontent.Com/x/y", true},

		// ---- 后缀绕过攻击（HasSuffix / HasPrefix 漏洞，已修复） ----
		{"https://evil-github.com/download/app.zip", false},
		{"https://attacker.github.com.phish/x", false},
		{"https://malicious-githubusercontent.com/a", false},
		{"https://fake.github.com/releases/app.zip", false},
		{"https://www.github.com.evil.com/x", false},
		{"https://objects.githubusercontent.com.attacker.com/x", false},
		{"https://ghfast.top.evil.com/x", false},
		{"https://gh-proxy.com.evil.com/x", false},

		// ---- 非 https ----
		{"http://github.com/owner/repo/app.zip", false},
		{"ftp://github.com/owner/repo/app.zip", false},
		{"file:///etc/passwd", false},

		// ---- 空/非法 URL ----
		{"", false},
		{"not-a-url", false},
	}
	for _, c := range cases {
		got := validUpdateURL(c.url)
		if got != c.want {
			t.Errorf("validUpdateURL(%q) = %v, 期望 %v", c.url, got, c.want)
		}
	}
}

// requireMcRoot：收敛 8 处「游戏根目录未配置」错误检查的统一守卫（code_review P3）
func TestRequireMcRoot(t *testing.T) {
	if err := requireMcRoot(types.AppConfig{}); err == nil {
		t.Error("空 McRoot 应返回错误")
	} else if err.Error() != "请先设置游戏根目录" {
		t.Errorf("错误消息不符: got %q, 期望 %q", err.Error(), "请先设置游戏根目录")
	}
	if err := requireMcRoot(types.AppConfig{McRoot: "/mc"}); err != nil {
		t.Errorf("非空 McRoot 应返回 nil, got %v", err)
	}
}
