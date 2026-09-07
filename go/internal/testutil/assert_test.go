// ===== testutil 自测 =====
// 覆盖边界：断言失败分支走 t.Fatalf → runtime.Goexit，进程内不可优雅捕获
// （recover 拦不住 Goexit），故只测：
//   - prefixFromArgs 纯函数全分支（含 Sprintf 展开、非 string 忽略）
//   - 各断言的正常契约路径（不误杀合法输入）
//
// 失败终止行为由 5 个消费包测试的失败断言反证（断言若失效，消费测试即红）。
package testutil

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestPrefixFromArgs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		args []any
		want string
	}{
		{"无参数", nil, ""},
		{"单 string", []any{"下载失败"}, "下载失败: "},
		{"string + 参数 Sprintf", []any{"normalizeScanKey(%q)", "/a/b/"}, `normalizeScanKey("/a/b/"): `},
		{"带 %% 的 string（单 string 不做格式化，%% 原样保留）", []any{"进度 100%%"}, "进度 100%%: "},
		{"带 %% 的 string + 参数（走 Sprintf 折叠）", []any{"进度 %d%%", 100}, "进度 100%: "},
		{"非 string 首参忽略", []any{42, "x"}, ""},
		{"空 string", []any{""}, ": "},
		{"零值占位符无参数", []any{"(%v)"}, "(%v): "},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := prefixFromArgs(c.args...)
			if got != c.want {
				t.Fatalf("prefixFromArgs(%v) = %q, want %q", c.args, got, c.want)
			}
		})
	}
}

func TestNoError_Pass(t *testing.T) {
	t.Parallel()
	NoError(t, nil)
	NoError(t, nil, "带上下文")
}

func TestErrorContains_Pass(t *testing.T) {
	t.Parallel()
	ErrorContains(t, errors.New("download failed: 404 未找到"), "404")
	ErrorContains(t, errors.New("boom"), "boom", "带上下文")
}

func TestEqual_Pass(t *testing.T) {
	t.Parallel()
	Equal(t, 1, 1)
	Equal(t, "x", "x", "带上下文")
	// 走 cmp.Diff 深比较路径（slice）
	Equal(t, []string{"a", "b"}, []string{"a", "b"})
}

func TestFileExists_Pass(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	FileExists(t, path)
	FileExists(t, path, "带上下文")
	FileExists(t, dir) // 目录也算存在
}

func TestFileNotExists_Pass(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	FileNotExists(t, filepath.Join(dir, "missing.txt"))
	FileNotExists(t, filepath.Join(dir, "missing.txt"), "带上下文")
}
