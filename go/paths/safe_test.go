// ===== go/paths 单测（零覆盖包补测）=====
// IsInside：路径防穿越（../ 拒绝 / 大小写不敏感 / 目录外拒绝）
// ContainsMinecraftMarker：.minecraft / minecraft 标记检测
package paths

import (
	"errors"
	"path/filepath"
	"runtime"
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

	t.Run("大小写差异（Windows 放行 / POSIX 拒绝）", func(t *testing.T) {
		inside := filepath.Join(base, "SUB", "model.ysm")
		// 大小写不同的基准路径
		baseMixed := strings.ToUpper(base)
		if runtime.GOOS == "windows" {
			// Windows：filepath.Rel 大小写不敏感 → 放行
			if err := IsInside(baseMixed, inside); err != nil {
				t.Fatalf("期望 nil（大小写不敏感）, got %v", err)
			}
		} else {
			// POSIX：filepath.Rel 大小写敏感 → baseMixed 与 inside 首字节分歧，
			// rel 为 ../../../tmp/... 逃逸 → 必须拒绝（P2 修复：原无条件断言 Windows
			// 语义，Linux/macOS 上该用例必然 FAIL——实现正确、测试错误）
			if err := IsInside(baseMixed, inside); err == nil {
				t.Fatal("POSIX 大小写敏感：期望错误, got nil")
			}
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
		// P3 修复回归：相对路径首段 / 单段（原漏检——只查 sep+marker+sep 中间段与后缀）
		{filepath.Join("minecraft", "mods"), true},
		{filepath.Join(".minecraft", "mods"), true},
		{"minecraft", true},
		// P3 修复回归：..foo 类合法名不得被误判为 minecraft 段
		{filepath.Join("minecrafters", "x"), false},
	}
	for _, c := range cases {
		if got := ContainsMinecraftMarker(c.path); got != c.want {
			t.Errorf("ContainsMinecraftMarker(%q) = %v, 期望 %v", c.path, got, c.want)
		}
	}
}

// P3 补测：..foo 合法文件名不得被 IsInside 误判为 .. 逃逸（原裸 HasPrefix(rel, "..") 误杀）
func TestIsInside_DotDotFooNoFalsePositive(t *testing.T) {
	base := filepath.Join(t.TempDir(), "repo")
	inside := filepath.Join(base, "my..file.ysm")
	if err := IsInside(base, inside); err != nil {
		t.Fatalf("..foo 合法名应放行, got %v", err)
	}
	// 真逃逸：base/../evil 必须拒绝
	outside := filepath.Join(base, "..", "evil.ysm")
	if err := IsInside(base, outside); err == nil {
		t.Fatal(".. 逃逸应拒绝, got nil")
	}
	// 深层逃逸：跨两层以上（rel = ../../evil.ysm）——注意 filepath.Join 会折叠中间段，
	// 需用真实四层回溯才能产出 `../../` 前缀（code_review P3：原 `base/a/../..` 被折叠后
	// 与浅层 `outside` 相同，未真正覆盖深层分支）
	deep := filepath.Join(base, "a", "b", "c", "..", "..", "..", "..", "evil.ysm")
	if err := IsInside(base, deep); err == nil {
		t.Fatal("深层 .. 逃逸应拒绝, got nil")
	}
}

func TestErrPathEscalation_Error(t *testing.T) {
	e := &ErrPathEscalation{Path: "/x", BaseDir: "/base", Reason: "测试"}
	if !strings.Contains(e.Error(), "路径越权") {
		t.Errorf("错误文案应含「路径越权」, got %q", e.Error())
	}
}
