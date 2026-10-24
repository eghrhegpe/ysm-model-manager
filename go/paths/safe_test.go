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
	"ysm-model-manager/go/internal/testutil"
)

func TestIsInside(t *testing.T) {
	base := filepath.Join(t.TempDir(), "repo")

	t.Run("目录内文件 → nil", func(t *testing.T) {
		inside := filepath.Join(base, "sub", "model.ysm")
		testutil.NoError(t, IsInside(base, inside), "期望 nil")
	})

	t.Run("路径相等 → nil", func(t *testing.T) {
		testutil.NoError(t, IsInside(base, base), "期望 nil")
	})

	t.Run("目录外（.. 穿越）→ ErrPathEscalation", func(t *testing.T) {
		outside := filepath.Join(base, "..", "evil.ysm")
		err := IsInside(base, outside)
		testutil.NotNil(t, err, "期望错误, got nil")
		var esc *ErrPathEscalation
		// sentinel 指针类型走 errors.As 布尔化，避免 go-cmp 反射比较
		testutil.Equal(t, errors.As(err, &esc), true, "期望 ErrPathEscalation, got %T: %v", err, err)
	})

	t.Run("同级不同目录 → 拒绝", func(t *testing.T) {
		sibling := filepath.Join(filepath.Dir(base), "other", "x.ysm")
		testutil.NotNil(t, IsInside(base, sibling), "期望错误")
	})

	t.Run("大小写差异（Windows 放行 / POSIX 拒绝）", func(t *testing.T) {
		inside := filepath.Join(base, "SUB", "model.ysm")
		// 大小写不同的基准路径
		baseMixed := strings.ToUpper(base)
		if runtime.GOOS == "windows" {
			// Windows：filepath.Rel 大小写不敏感 → 放行
			testutil.NoError(t, IsInside(baseMixed, inside), "期望 nil（大小写不敏感）")
		} else {
			// POSIX：filepath.Rel 大小写敏感 → baseMixed 与 inside 首字节分歧，
			// rel 为 ../../../tmp/... 逃逸 → 必须拒绝（P2 修复：原无条件断言 Windows
			// 语义，Linux/macOS 上该用例必然 FAIL——实现正确、测试错误）
			testutil.NotNil(t, IsInside(baseMixed, inside), "POSIX 大小写敏感：期望错误")
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
		// 回归：相对路径首段 / 单段（原漏检——只查 sep+marker+sep 中间段与后缀）
		{filepath.Join("minecraft", "mods"), true},
		{filepath.Join(".minecraft", "mods"), true},
		{"minecraft", true},
		// 回归：..foo 类合法名不得被误判为 minecraft 段
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
	testutil.NoError(t, IsInside(base, inside), "..foo 合法名应放行")
	// 真逃逸：base/../evil 必须拒绝
	outside := filepath.Join(base, "..", "evil.ysm")
	testutil.NotNil(t, IsInside(base, outside), ".. 逃逸应拒绝")
	// 深层逃逸：跨两层以上（rel = ../../evil.ysm）——注意 filepath.Join 会折叠中间段，
	// 需用真实四层回溯才能产出 `../../` 前缀（code_review P3：原 `base/a/../..` 被折叠后
	// 与浅层 `outside` 相同，未真正覆盖深层分支）
	deep := filepath.Join(base, "a", "b", "c", "..", "..", "..", "..", "evil.ysm")
	testutil.NotNil(t, IsInside(base, deep), "深层 .. 逃逸应拒绝")
}

func TestErrPathEscalation_Error(t *testing.T) {
	e := &ErrPathEscalation{Path: "/x", BaseDir: "/base", Reason: "测试"}
	if !strings.Contains(e.Error(), "路径越权") {
		t.Errorf("错误文案应含「路径越权」, got %q", e.Error())
	}
}

// ===== Trap #11 补测：sentinel 分类（errors.Is，禁止文本匹配）=====

// 未覆盖分支补测：空基准目录必须显式拒绝（ErrEmptyBase）
func TestIsInside_EmptyBaseDir(t *testing.T) {
	err := IsInside("", "model.ysm")
	testutil.NotNil(t, err, "空基准目录应被拒绝, got nil")
	testutil.ErrorIs(t, err, ErrEmptyBase, "期望分类 ErrEmptyBase")
	var esc *ErrPathEscalation
	// sentinel 指针类型走 errors.As 布尔化，避免 go-cmp 反射比较
	testutil.Equal(t, errors.As(err, &esc), true, "期望 errors.As 命中 ErrPathEscalation, got %T: %v", err, err)
}

// 未覆盖分支补测：基准目录含 NUL 字节必须拒绝（ErrNULByte，与路径侧同哨兵）
func TestIsInside_NULInBaseDir(t *testing.T) {
	err := IsInside("repo\x00base", "model.ysm")
	testutil.NotNil(t, err, "含 NUL 的基准目录应被拒绝, got nil")
	testutil.ErrorIs(t, err, ErrNULByte, "期望分类 ErrNULByte")
}

// 各失败分支的 sentinel 分类正确性（errors.Is 程序化契约，不依赖文案）
func TestIsInside_SentinelClassification(t *testing.T) {
	base := filepath.Join(t.TempDir(), "repo")

	// 空路径 → ErrEmptyPath
	testutil.ErrorIs(t, IsInside(base, ""), ErrEmptyPath, "空路径应分类 ErrEmptyPath")
	// 路径含 NUL → ErrNULByte
	testutil.ErrorIs(t, IsInside(base, filepath.Join(base, "a")+"\x00../../etc"), ErrNULByte, "NUL 路径应分类 ErrNULByte")
	// 目录外（.. 穿越）→ ErrNotInside
	testutil.ErrorIs(t, IsInside(base, filepath.Join(base, "..", "evil.ysm")), ErrNotInside, "越权应分类 ErrNotInside")
	// 目录外（前缀相似兄弟目录 /repo2，防 /repo 误匹配）→ ErrNotInside
	testutil.ErrorIs(t, IsInside(base, filepath.Join(filepath.Dir(base), "repo2", "x.ysm")), ErrNotInside, "兄弟目录应分类 ErrNotInside")
	// 正常放行 → nil（且不被任何哨兵命中）
	testutil.NoError(t, IsInside(base, filepath.Join(base, "sub", "model.ysm")), "目录内应放行")
	// 目录内路径 errors.Is(ErrNotInside) 必须为 false（反向验证分类无误伤）；
	// err 为 nil 时 errors.Is 安全返回 false，不短路依赖
	testutil.Equal(t, errors.Is(IsInside(base, filepath.Join(base, "sub", "model.ysm")), ErrNotInside), false, "目录内路径不得命中 ErrNotInside")
}

// Windows 专属：跨驱动器触发 filepath.Rel 错误分支 → ErrRelFailed，
// 且底层 Rel 错误需经 Unwrap 链保留（具体类型随 Go 版本而异——新版本返回
// errors.New 而非 *PathError，故不按具体类型断言，只验证链结构）
func TestIsInside_RelFailureSentinel_Windows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows only: 跨驱动器 Rel 错误是 Windows 特性")
	}
	err := IsInside(`C:\repo`, `D:\evil\file.ysm`)
	testutil.NotNil(t, err, "跨驱动器应被拒绝, got nil")
	testutil.ErrorIs(t, err, ErrRelFailed, "期望分类 ErrRelFailed")
	u1 := errors.Unwrap(err) // *fmt.wrapError（ErrRelFailed + 底层 Rel 错误）
	u2 := errors.Unwrap(u1)  // 底层 Rel 错误（Unwrap(nil) 安全返回 nil）
	// OR 型复合条件拆序贯：逐层非 nil（原 if u1==nil || u2==nil）
	testutil.NotNil(t, u1, "期望 Unwrap 链 [ErrPathEscalation → wrapError → Rel 错误], got %v", err)
	testutil.NotNil(t, u2, "期望 Unwrap 链第二层（Rel 错误）非 nil, got %v", err)
}

// IsInsideResolved：解析两侧 symlink 后再判定（BUG-1）。无 symlink 场景下结论
// 必须与纯词法 IsInside 完全一致；空路径/NUL 等哨兵分类仍需透传（先词法快速失败，
// 通过的才解析真实路径二次复核）。
func TestIsInsideResolved_NoSymlinkSameAsIsInside(t *testing.T) {
	base := filepath.Join(t.TempDir(), "repo")

	testutil.NoError(t, IsInsideResolved(base, filepath.Join(base, "sub", "model.ysm")), "目录内应放行")
	testutil.NoError(t, IsInsideResolved(base, base), "相等应放行")
	testutil.ErrorIs(t, IsInsideResolved(base, filepath.Join(base, "..", "evil.ysm")), ErrNotInside, "词法逃逸应拒绝并分类 ErrNotInside")
	testutil.ErrorIs(t, IsInsideResolved(base, ""), ErrEmptyPath, "空路径应分类 ErrEmptyPath")
	testutil.ErrorIs(t, IsInsideResolved("", "model.ysm"), ErrEmptyBase, "空基准应分类 ErrEmptyBase")
}
