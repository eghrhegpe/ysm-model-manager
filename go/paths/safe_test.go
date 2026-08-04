// ===== go/paths 单测（零覆盖包补测）=====
// IsInside：路径防穿越（../ 拒绝 / 大小写不敏感 / 目录外拒绝）
// ContainsMinecraftMarker：.minecraft / minecraft 标记检测
package paths

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsInside(t *testing.T) {
	base := filepath.Join(t.TempDir(), "repo")

	t.Run("目录内文件 → nil", func(t *testing.T) {
		inside := filepath.Join(base, "sub", "model.ysm")
		if err := IsInside(base, inside); err != nil {
			t.Fatalf("期望 nil, got %v", err)
		}
	})

	t.Run("路径相等 → nil", func(t *testing.T) {
		if err := IsInside(base, base); err != nil {
			t.Fatalf("期望 nil, got %v", err)
		}
	})

	t.Run("目录外（.. 穿越）→ ErrPathEscalation", func(t *testing.T) {
		outside := filepath.Join(base, "..", "evil.ysm")
		err := IsInside(base, outside)
		if err == nil {
			t.Fatal("期望错误, got nil")
		}
		var esc *ErrPathEscalation
		if !errors.As(err, &esc) {
			t.Fatalf("期望 ErrPathEscalation, got %T: %v", err, err)
		}
	})

	t.Run("同级不同目录 → 拒绝", func(t *testing.T) {
		sibling := filepath.Join(filepath.Dir(base), "other", "x.ysm")
		if err := IsInside(base, sibling); err == nil {
			t.Fatal("期望错误, got nil")
		}
	})

	t.Run("大小写不敏感（Windows 语义）→ nil", func(t *testing.T) {
		inside := filepath.Join(base, "SUB", "model.ysm")
		// 大小写不同的基准路径
		baseMixed := strings.ToUpper(base)
		if err := IsInside(baseMixed, inside); err != nil {
			t.Fatalf("期望 nil（大小写不敏感）, got %v", err)
		}
	})
}

func TestContainsMinecraftMarker(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{filepath.Join("a", ".minecraft", "mods"), true},
		{filepath.Join("a", "minecraft", "mods"), true}, // PrismLauncher 无点
		{filepath.Join("a", ".minecraft"), true},        // 后缀
		{filepath.Join("a", "models", "x.ysm"), false},
		{filepath.Join("a", "minecrafters", "x"), false}, // 非独立段
	}
	for _, c := range cases {
		if got := ContainsMinecraftMarker(c.path); got != c.want {
			t.Errorf("ContainsMinecraftMarker(%q) = %v, 期望 %v", c.path, got, c.want)
		}
	}
}

func TestErrPathEscalation_Error(t *testing.T) {
	e := &ErrPathEscalation{Path: "/x", BaseDir: "/base", Reason: "测试"}
	if !strings.Contains(e.Error(), "路径越权") {
		t.Errorf("错误文案应含「路径越权」, got %q", e.Error())
	}
}
