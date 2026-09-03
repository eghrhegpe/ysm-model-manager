package paths

import (
	"errors"
	"path/filepath"
	"runtime"
	"testing"
)

// TestRelInside 覆盖 RelInside 核心语义：正常子路径 / 等值 / 越界 / 空输入 /
// sentinel 错误分类（锐评 #19 收敛 sync_push 手写判定后补的契约测试）。
func TestRelInside(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("路径形态断言按 Unix 语义编写")
	}
	base := "/repo"

	cases := []struct {
		name    string
		base    string
		path    string
		wantRel string
		wantErr bool
		errIs   error // 非 nil 时断言 errors.Is
	}{
		{name: "子路径", base: base, path: "/repo/a/b.ysm", wantRel: filepath.Join("a", "b.ysm")},
		{name: "等值返回点", base: base, path: "/repo", wantRel: "."},
		{name: "直接子项", base: base, path: "/repo/x", wantRel: "x"},
		{name: "父目录越界", base: base, path: "/other", wantErr: true, errIs: ErrNotInside},
		{name: "同级越界", base: base, path: "/repo-sibling/y", wantErr: true, errIs: ErrNotInside},
		{name: "空路径", base: base, path: "", wantErr: true, errIs: ErrEmptyPath},
		{name: "空基准", base: "", path: "/repo/a", wantErr: true, errIs: ErrEmptyBase},
		{name: "含点前缀名不误伤", base: base, path: "/repo/..foo/y", wantRel: filepath.Join("..foo", "y")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rel, err := RelInside(c.base, c.path)
			if c.wantErr {
				if err == nil {
					t.Fatalf("RelInside(%q, %q) = (%q, nil)，期望报错", c.base, c.path, rel)
				}
				if c.errIs != nil && !errors.Is(err, c.errIs) {
					t.Errorf("错误应可 errors.Is 到 %v，实际 %v", c.errIs, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("RelInside(%q, %q) 不应报错: %v", c.base, c.path, err)
			}
			if rel != c.wantRel {
				t.Errorf("RelInside(%q, %q) = %q, want %q", c.base, c.path, rel, c.wantRel)
			}
		})
	}
}

// TestRelInside_MapBack 验证 rel 可安全 Join 回 base 还原原路径（映射类调用的核心用法）。
func TestRelInside_MapBack(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("路径形态断言按 Unix 语义编写")
	}
	src := "/repo/vendor/char/model.ysm"
	rel, err := RelInside("/repo", src)
	if err != nil {
		t.Fatal(err)
	}
	if got := filepath.Join("/repo", rel); got != src {
		t.Errorf("Join(base, rel) = %q, want 还原 %q", got, src)
	}
}
