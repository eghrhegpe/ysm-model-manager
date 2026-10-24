// ===== fsutil.WriteFileAtomic 失败分支注入测试（包级函数变量 swap）=====
// OS 级失败（ENOSPC/EIO/Close 报错等）无法低成本真实构造，故经 write.go 的
// 包级函数变量注入故障；失败分支的真实清理（Remove 临时文件）保持执行，
// 断言「无 .atomic-*.tmp 残渣 + 目标未损坏」数据安全不变量。
package fsutil

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// noAtomicResidue 断言目录无 .atomic-*.tmp 残渣（WriteFileAtomic 统一前缀）。
func noAtomicResidue(t *testing.T, dir string) {
	t.Helper()
	matches, _ := filepath.Glob(filepath.Join(dir, ".atomic-*.tmp"))
	testutil.Equal(t, len(matches), 0, "失败后不应残留临时文件: %v", matches)
}

func TestWriteFileAtomic_WriteFail(t *testing.T) {
	dir := t.TempDir()
	orig := writeToFile
	writeToFile = func(w io.Writer, data []byte) error {
		if _, err := w.Write(data); err != nil {
			return err
		}
		return errors.New("模拟写入失败 ENOSPC")
	}
	t.Cleanup(func() { writeToFile = orig })

	dst := filepath.Join(dir, "data.json")
	err := WriteFileAtomic(dst, []byte("x"))
	// 原 `err == nil || !errors.Is(err, ErrWriteFailed)` 失败条件与 ErrorIs 完全等价
	testutil.ErrorIs(t, err, ErrWriteFailed, "应报 ErrWriteFailed")
	_, statErr := os.Stat(dst)
	testutil.Equal(t, os.IsNotExist(statErr), true, "写入失败后目标文件不应存在（半截数据装盘）")
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_SyncFail(t *testing.T) {
	dir := t.TempDir()
	orig := syncFile
	syncFile = func(f *os.File) error { return errors.New("模拟 Sync 失败 EIO") }
	t.Cleanup(func() { syncFile = orig })

	err := WriteFileAtomic(filepath.Join(dir, "data.json"), []byte("x"))
	testutil.ErrorIs(t, err, ErrSyncFailed, "应报 ErrSyncFailed")
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_CloseFail(t *testing.T) {
	dir := t.TempDir()
	orig := closeFile
	// 先真实 Close 再报错：Windows 上未关闭的句柄会锁文件，Remove 将失败
	closeFile = func(f *os.File) error {
		f.Close()
		return errors.New("模拟 Close 失败")
	}
	t.Cleanup(func() { closeFile = orig })

	err := WriteFileAtomic(filepath.Join(dir, "data.json"), []byte("x"))
	testutil.ErrorIs(t, err, ErrCloseFailed, "应报 ErrCloseFailed")
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_ChmodFail(t *testing.T) {
	dir := t.TempDir()
	orig := chmodFile
	chmodFile = func(name string, mode os.FileMode) error {
		return errors.New("模拟 Chmod 失败")
	}
	t.Cleanup(func() { chmodFile = orig })

	err := WriteFileAtomic(filepath.Join(dir, "data.json"), []byte("x"))
	testutil.ErrorIs(t, err, ErrChmodFailed, "应报 ErrChmodFailed")
	noAtomicResidue(t, dir)
}

func TestWriteFileAtomic_RenameFail(t *testing.T) {
	dir := t.TempDir()
	orig := renameFile
	renameFile = func(oldpath, newpath string) error {
		return errors.New("模拟 Rename 失败")
	}
	t.Cleanup(func() { renameFile = orig })

	dst := filepath.Join(dir, "data.json")
	err := WriteFileAtomic(dst, []byte("x"))
	testutil.ErrorIs(t, err, ErrRenameFailed, "应报 ErrRenameFailed")
	_, statErr := os.Stat(dst)
	testutil.Equal(t, os.IsNotExist(statErr), true, "落地失败后目标文件不应存在")
	noAtomicResidue(t, dir)
}

// TestWriteFileAtomic_InjectRestore 验证注入点恢复：测试替换后回归原实现，
// 正常写入不受影响（防止包级变量污染后续测试）。
func TestWriteFileAtomic_InjectRestore(t *testing.T) {
	dir := t.TempDir()
	dst := filepath.Join(dir, "data.json")
	testutil.NoError(t, WriteFileAtomic(dst, []byte("ok")), "注入恢复后正常写入失败")
	data, err := os.ReadFile(dst)
	// OR 型复合条件拆序贯
	testutil.NoError(t, err, "内容不符")
	testutil.Equal(t, string(data), "ok", "内容不符: %q", string(data))
}
