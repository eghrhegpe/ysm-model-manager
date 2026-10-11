// ===== testutil 转发层自测（单一事实源已上移根 internal/testutil，G3 清偿 2026-10-11）=====
// 本包 8 个断言函数为对根 internal/testutil 的纯转发；`prefixFromArgs` 私有 helper
// 随实现上移，其全分支自测随迁根侧（internal/testutil/testutil_test.go）。本文件保留
// 各断言的正常契约路径（*_Pass）——兼作**转发链冒烟**：转发若退化（如被复制成双份
// 逻辑），这些契约测试仍会钉住行为。失败分支走 t.Fatalf → runtime.Goexit，进程内
// 不可优雅捕获，由消费包测试的失败断言反证。
package testutil

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

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

func TestNil_Pass(t *testing.T) {
	t.Parallel()
	Nil(t, nil)
	Nil(t, (*struct{ A int })(nil)) // typed nil 指针
	Nil(t, []string(nil))           // nil 切片
	Nil(t, map[string]int(nil))     // nil map
	Nil(t, nil, "带上下文")
}

func TestNotNil_Pass(t *testing.T) {
	t.Parallel()
	NotNil(t, &struct{ A int }{1})
	NotNil(t, []string{})
	NotNil(t, map[string]int{})
	NotNil(t, 0) // 非 nilable 零值也算非 nil
	NotNil(t, &struct{ A int }{}, "带上下文")
}
