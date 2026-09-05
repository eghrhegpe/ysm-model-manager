//go:build windows

// ===== go/importer 复制链失败触发（Windows 共享锁）=====
// 以独占方式（share=0）打开目录，确定性触发两类失败：
//   - 源子目录被锁 → copyDir 递归枚举失败（ReadDir ERROR_SHARING_VIOLATION）
//   - 目标目录被锁 → copyDir 备份 rename 失败（ADR-028 原子替换路径）
//
// 锁不生效的环境（ReadDir 仍成功）直接 Skip；非 Windows 平台无共享锁机制。
package importer

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

// lockDirExclusive 以独占方式打开目录（FILE_FLAG_BACKUP_SEMANTICS + share=0），
// 令后续对该目录的枚举/重命名失败。环境不执行共享锁语义时 Skip。
func lockDirExclusive(t *testing.T, dir string) {
	t.Helper()
	p, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		t.Skipf("UTF16 转换失败: %v", err)
	}
	h, err := syscall.CreateFile(p, syscall.GENERIC_READ, 0, nil,
		syscall.OPEN_EXISTING, syscall.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		t.Skipf("独占打开目录失败: %v", err)
	}
	// 探针：锁应令 ReadDir 失败，否则该环境不执行共享锁语义，跳过测试
	if _, err := os.ReadDir(dir); err == nil {
		syscall.CloseHandle(h)
		t.Skip("环境未执行共享锁（ReadDir 仍成功），跳过")
	}
	t.Cleanup(func() { syscall.CloseHandle(h) })
}

// TestCopyDir_RecursionErrorLocked 源子目录被锁 → 递归枚举失败 → 临时目录清理、目标不落地
func TestCopyDir_RecursionErrorLocked(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "d"), 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(src, "d", "inner.txt"), []byte("i"), 0644)
	lockDirExclusive(t, filepath.Join(src, "d"))

	dst := filepath.Join(base, "out")
	if err := copyDir(src, dst); err == nil {
		t.Fatal("枚举被锁子目录应失败")
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("失败时目标不应被创建: %v", err)
	}
	if n := globCount(t, base, ".tmp_import_*"); n != 0 {
		t.Fatalf("失败后不应残留临时目录，实际 %d 个", n)
	}
}

// TestCopyDir_BackupRenameErrorLocked 目标目录被锁 → 备份 rename 失败 → 目标原样保留、无残留
func TestCopyDir_BackupRenameErrorLocked(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(src, 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("new"), 0644)
	dst := filepath.Join(base, "out")
	_ = os.MkdirAll(dst, 0755)
	_ = os.WriteFile(filepath.Join(dst, "old.txt"), []byte("old"), 0644)
	lockDirExclusive(t, dst)

	if err := copyDir(src, dst); err == nil {
		t.Fatal("备份 rename 被锁阻断应失败")
	}
	// 目标目录原样保留（未备份、未替换）
	data, err := os.ReadFile(filepath.Join(dst, "old.txt"))
	if err != nil || string(data) != "old" {
		t.Fatalf("既有内容应保留: %v %v", err, string(data))
	}
	if n := globCount(t, base, ".tmp_import_*"); n != 0 {
		t.Fatalf("失败后不应残留临时目录，实际 %d 个", n)
	}
	if n := globCount(t, base, "out.import-bak-*"); n != 0 {
		t.Fatalf("失败后不应残留备份目录，实际 %d 个", n)
	}
}

// TestDirectoryCopyImport_CopyDirErrorLocked DirectoryCopyImporter.Import 内部
// copyDir 失败（模型文件夹内子目录被锁 → 递归枚举失败）→ 返回「复制文件夹失败」
func TestDirectoryCopyImport_CopyDirErrorLocked(t *testing.T) {
	base := t.TempDir()
	srcDir := filepath.Join(base, "src")
	modelDir := filepath.Join(srcDir, "model")
	_ = os.MkdirAll(filepath.Join(modelDir, "d"), 0755)
	_ = os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("pmx"), 0644)
	_ = os.WriteFile(filepath.Join(modelDir, "d", "inner.txt"), []byte("i"), 0644)
	lockDirExclusive(t, filepath.Join(modelDir, "d"))

	dstDir := filepath.Join(base, "out")
	err := NewDirectoryCopy("EntityPlayer").Import(modelDir, dstDir)
	if err == nil {
		t.Fatal("copyDir 失败应返回错误消息")
	}
	if !strings.Contains(err.Error(), "复制文件夹失败") {
		t.Fatalf("错误消息 %q 应包含「复制文件夹失败」", err)
	}
	if n := globCount(t, dstDir, ".tmp_import_*"); n != 0 {
		t.Fatalf("失败后不应残留临时目录，实际 %d 个", n)
	}
}
