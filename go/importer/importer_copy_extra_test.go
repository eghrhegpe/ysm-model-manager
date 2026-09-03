// ===== go/importer 复制链错误分支补充单测 =====
// 覆盖 importer.go 中 copyDir / copyFile 的失败分支：
// 目标路径被目录/文件占位（MkdirAll/Create/Symlink 失败）、
// 子目录递归错误上抛、复制源为目录时 io.Copy 失败与半截文件清理。
// copyDirContents 已于锐评 #11 删除（生产零调用，语义归 fsutil.CopyDirRecursive；
// 其错误分支测试随之移除——fsutil 自身已有 CopyDirRecursive 错误路径覆盖）。
// 需要 Windows 共享锁触发的分支见 importer_copy_lock_windows_test.go。
package importer

import (
	"os"
	"path/filepath"
	"testing"
)

// ===== copyDir =====

func TestCopyDir_MkdirTempError(t *testing.T) {
	// dst 父级是文件 → MkdirTemp 失败
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	blocker := filepath.Join(base, "afile")
	_ = os.WriteFile(blocker, []byte("x"), 0644)
	if err := copyDir(src, filepath.Join(blocker, "sub", "out")); err == nil {
		t.Fatal("dst 父级为文件时 MkdirTemp 应失败")
	}
}

func TestCopyDir_CopyErrorKeepsDst(t *testing.T) {
	// 源为文件 → ReadDir 失败；临时目录应被清理，既有目标不受影响
	base := t.TempDir()
	srcFile := filepath.Join(base, "afile")
	_ = os.WriteFile(srcFile, []byte("x"), 0644)
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(dst, 0755)
	_ = os.WriteFile(filepath.Join(dst, "keep.txt"), []byte("keep"), 0644)
	if err := copyDir(srcFile, dst); err == nil {
		t.Fatal("源为文件时 copyDir 应失败")
	}
	if _, err := os.Stat(filepath.Join(dst, "keep.txt")); err != nil {
		t.Fatalf("既有目标不应被影响: %v", err)
	}
	if n := globCount(t, base, ".tmp_import_*"); n != 0 {
		t.Fatalf("失败后不应残留临时目录，实际 %d 个", n)
	}
}

// ===== copyFile =====

func TestCopyFile_IOCopyErrorCleanup(t *testing.T) {
	// 源为目录：os.Open 成功但 io.Copy 失败（Windows: Incorrect function；Unix: EISDIR）
	// → 半截目标文件应被清理，不留损坏文件
	base := t.TempDir()
	srcDir := filepath.Join(base, "srcdir")
	_ = os.MkdirAll(srcDir, 0755)
	dst := filepath.Join(base, "out", "f.txt")
	if err := copyFile(srcDir, dst); err == nil {
		t.Fatal("复制目录句柄应报错")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("失败后半截目标文件应被清理: %v", err)
	}
}
