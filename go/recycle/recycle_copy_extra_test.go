// ===== copyDirRecursive 补测 =====
// 覆盖：目录树含符号链接时复制链接本身（不跟随）；目标父路径组件为文件
// 时 MkdirAll 失败直接报错。
// WalkDir 遍历错误分支需构造目录读取失败（Windows 上需 ACL 操作，不可
// 稳定复现），记为不可测。
package recycle

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// 目录树复制：文件 + 子目录 + 符号链接混合，符号链接应复制链接本身（不跟随目标）
func TestCopyDirRecursive_WithSymlink(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(filepath.Join(src, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	fileA := filepath.Join(src, "a.ysm")
	if err := os.WriteFile(fileA, []byte("A"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "sub", "b.ysm"), []byte("B"), 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(src, "link.ysm")
	if err := os.Symlink(fileA, link); err != nil {
		t.Skipf("os.Symlink 不可用（需权限）: %v", err)
	}

	dst := filepath.Join(dir, "dst")
	if err := copyDirRecursive(src, dst); err != nil {
		t.Fatalf("复制失败: %v", err)
	}
	// 普通文件与子目录应完整复制
	if _, err := os.Stat(filepath.Join(dst, "a.ysm")); err != nil {
		t.Fatalf("a.ysm 应复制: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dst, "sub", "b.ysm")); err != nil {
		t.Fatalf("sub/b.ysm 应复制: %v", err)
	}
	// 符号链接应复制为链接本身（ModeSymlink），目标为原链接目标
	dstLink := filepath.Join(dst, "link.ysm")
	fi, err := os.Lstat(dstLink)
	if err != nil {
		t.Fatalf("link.ysm 应存在: %v", err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Fatal("link.ysm 应为符号链接（不跟随复制内容）")
	}
	got, err := os.Readlink(dstLink)
	testutil.NoError(t, err)
	if got != fileA {
		t.Fatalf("链接目标 = %q, 期望 %q", got, fileA)
	}
}

// 目标父路径组件为文件时 MkdirAll 失败应报错
func TestCopyDirRecursive_MkdirAllError(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src")
	if err := os.MkdirAll(src, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a.ysm"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(dir, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyDirRecursive(src, filepath.Join(blocker, "sub", "dst")); err == nil {
		t.Fatal("目标父路径组件为文件时应报错")
	}
}
