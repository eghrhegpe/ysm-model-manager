// sync_walk_test.go：统一剔除闸单元测试（ADR-351 D1）。
package sync

import (
	"path/filepath"
	"testing"
)

// TestSkipExcludedDir 闸的三态：root 放行 / 剔除子树 SkipDir / 正常目录放行。
func TestSkipExcludedDir(t *testing.T) {
	const root = `D:\repo`
	cases := []struct {
		name string
		root string
		p    string
		want error
	}{
		{"根目录自身恒放行", root, root, nil},
		{"回收站目录 → SkipDir", root, filepath.Join(root, ".recycle"), filepath.SkipDir},
		{"回收站大小写不敏感", root, filepath.Join(root, ".Recycle"), filepath.SkipDir},
		{"备份尸体目录 → SkipDir", root, filepath.Join(root, "model.relink-bak-1759000000000000000"), filepath.SkipDir},
		{"正常模型夹放行", root, filepath.Join(root, "model"), nil},
		{"嵌套正常目录放行", root, filepath.Join(root, "分类", "model"), nil},
		{"非根的 .recycle 段（深层）→ SkipDir", root, filepath.Join(root, "sub", ".recycle"), filepath.SkipDir},
		{"闸不做前缀检查（根外路径照常按段判）", `D:\repo`, `D:\repo-other\.recycle`, filepath.SkipDir},
	}
	for _, c := range cases {
		if got := skipExcludedDir(c.root, c.p); got != c.want {
			t.Errorf("%s: skipExcludedDir(%q, %q) = %v, want %v", c.name, c.root, c.p, got, c.want)
		}
	}
}

// TestWalkExcluded 段级谓词：回收站任意深度 + 备份尸体段含标记；正常文件名不误伤。
func TestWalkExcluded(t *testing.T) {
	cases := []struct {
		p    string
		want bool
	}{
		{`D:\repo\model\my.ysm`, false},
		{`D:\repo\.recycle\deep\sub\a.ysm`, true},                 // 回收站子树任意深度
		{`D:\repo\m.relink-bak-1\a.ysm`, true},                    // 备份目录内文件
		{`D:\repo\my.recycle.backup.ysm`, false},                  // 文件名含 .recycle 不误伤
		{filepath.Join("repo", "model.relink-bak-123.ysm"), true}, // 段含备份标记（与 fsutil.IsRelinkBackupPath 同口径：形态而非独立段名）
	}
	for _, c := range cases {
		if got := walkExcluded(c.p); got != c.want {
			t.Errorf("walkExcluded(%q) = %v, want %v", c.p, got, c.want)
		}
	}
}
