// ===== moveEx 跨设备回退分支单测（审核 P2/P3 补测）=====
// 覆盖：非跨设备失败直接返回、复制中途失败时半截副本清理（目录/文件两分支）。
// 跨设备复制回退「成功路径」（文件/目录）与 recycle_coverage_test.go 的
// TestMove_CrossDevice_File/Dir 同语义，已收敛至该文件（setupCrossDevice 共享模板 +
// 条目名/内容完整性断言），本文件不再双写（jscpd 收敛）。
// 通过 TrashManager 实例字段注入
// renameForMove/copyDirForMove 确定性触发分支（真实跨设备无法在测试中稳定构造），
// 注入作用域限定在单个实例，不污染同包其他测试。
package recycle

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// newTMWithRenameErr 构造注入 rename 返回指定错误的 TrashManager
func newTMWithRenameErr(t *testing.T, root string, err error) *TrashManager {
	t.Helper()
	tm := New(root)
	tm.renameForMove = func(src, dst string) error { return err }
	return tm
}

func TestMoveEx_RenameNonCrossDeviceError(t *testing.T) {
	dir := t.TempDir()
	src := testutil.CreateTestFile(t, dir, "locked.ysm", "content")
	tm := newTMWithRenameErr(t, dir, os.ErrPermission)

	res := tm.MoveEx(src)
	if res.Action != "error" {
		t.Fatalf("非跨设备 rename 失败应报 error, 得到 %s/%s", res.Action, res.Reason)
	}
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("源文件应保留: %v", err)
	}
	if entries := tm.List(); len(entries) != 0 {
		t.Fatalf("回收站不应有新条目: %v", entries)
	}
}

// 跨设备复制回退「成功路径」已收敛至 recycle_coverage_test.go：
// TestMove_CrossDevice_File（含条目名断言）/ TestMove_CrossDevice_Dir（含整组 fixture +
// 内容完整性断言，对齐本文件原 TestMoveEx_CrossDeviceFile/DirFallback 的增量断言）。

func TestMoveEx_CrossDeviceCopyFails_CleansDst(t *testing.T) {
	dir := t.TempDir()
	modDir := filepath.Join(dir, "mod")
	if err := os.MkdirAll(modDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modDir, "ysm.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	tm := newTMWithRenameErr(t, dir, syscall.EXDEV)
	// 模拟复制中途失败：先写入半截文件再报错，验证 dst 整棵被清理
	tm.copyDirForMove = func(src, dst string) error {
		if err := os.MkdirAll(dst, 0755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dst, "partial.ysm"), []byte("x"), 0644); err != nil {
			return err
		}
		return os.ErrPermission
	}

	res := tm.MoveEx(modDir)
	if res.Action != "error" {
		t.Fatalf("复制失败应报 error, 得到 %s/%s", res.Action, res.Reason)
	}
	// 半截副本应被清理（含 partial.ysm 与其父目录）
	recycleDir := filepath.Join(dir, ".recycle")
	if _, err := os.Stat(filepath.Join(recycleDir, "mod")); !os.IsNotExist(err) {
		t.Fatal("半截副本目录应被清理")
	}
	// 源目录应完好
	if _, err := os.Stat(filepath.Join(modDir, "ysm.json")); err != nil {
		t.Fatalf("源目录应完好: %v", err)
	}
}

// moveEx 文件跨设备回退时复制中途失败：半截文件应被清理，源文件保留
func TestMoveEx_CrossDeviceFileCopyFails_CleansDst(t *testing.T) {
	dir := t.TempDir()
	src := testutil.CreateTestFile(t, dir, "single.ysm", "content")
	tm := newTMWithRenameErr(t, dir, syscall.EXDEV)
	// 模拟文件复制中途失败：先写入半截文件再报错，验证半截文件被清理
	tm.copyFileForMove = func(s, d string) error {
		if err := os.WriteFile(d, []byte("partial"), 0644); err != nil {
			return err
		}
		return os.ErrPermission
	}

	res := tm.MoveEx(src)
	if res.Action != "error" {
		t.Fatalf("复制失败应报 error, 得到 %s/%s", res.Action, res.Reason)
	}
	// 半截副本应被清理
	recycleDir := filepath.Join(dir, ".recycle")
	if _, err := os.Stat(filepath.Join(recycleDir, "single.ysm")); !os.IsNotExist(err) {
		t.Fatal("半截副本文件应被清理")
	}
	// 源文件应完好
	if _, err := os.Stat(src); err != nil {
		t.Fatalf("源文件应完好: %v", err)
	}
}
