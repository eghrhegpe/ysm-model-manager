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
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestCopyDir_RecursionErrorLocked 源子目录被锁 → 递归枚举失败 → 临时目录清理、目标不落地
// （目录锁经 testutil.LockDirExclusive 构造，环境不支持时自动 Skip）
func TestCopyDir_RecursionErrorLocked(t *testing.T) {
	base := t.TempDir()
	src := filepath.Join(base, "src")
	_ = os.MkdirAll(filepath.Join(src, "d"), 0755)
	_ = os.WriteFile(filepath.Join(src, "a.txt"), []byte("a"), 0644)
	_ = os.WriteFile(filepath.Join(src, "d", "inner.txt"), []byte("i"), 0644)
	testutil.LockDirExclusive(t, filepath.Join(src, "d"))

	dst := filepath.Join(base, "out")
	err := copyDir(src, dst)
	testutil.NotNil(t, err, "枚举被锁子目录应失败")
	testutil.FileNotExists(t, dst, "失败时目标不应被创建")
	testutil.Equal(t, globCount(t, base, ".tmp_import_*"), 0, "失败后不应残留临时目录")
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
	testutil.LockDirExclusive(t, dst)

	err := copyDir(src, dst)
	testutil.NotNil(t, err, "备份 rename 被锁阻断应失败")
	// 目标目录原样保留（未备份、未替换）
	data, err := os.ReadFile(filepath.Join(dst, "old.txt"))
	testutil.NoError(t, err, "既有内容应保留")
	testutil.Equal(t, string(data), "old", "既有内容应保留")
	testutil.Equal(t, globCount(t, base, ".tmp_import_*"), 0, "失败后不应残留临时目录")
	testutil.Equal(t, globCount(t, base, "out.import-bak-*"), 0, "失败后不应残留备份目录")
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
	testutil.LockDirExclusive(t, filepath.Join(modelDir, "d"))

	dstDir := filepath.Join(base, "out")
	err := NewDirectoryCopy("EntityPlayer").Import(modelDir, dstDir)
	testutil.ErrorContains(t, err, "复制文件夹失败", "copyDir 失败应返回错误消息")
	testutil.Equal(t, globCount(t, dstDir, ".tmp_import_*"), 0, "失败后不应残留临时目录")
}
