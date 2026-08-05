// ===== moveEx 跨设备回退分支单测（审核 P2/P3 补测）=====
// 覆盖：非跨设备失败直接返回、目录/文件跨设备复制回退成功、
// 复制中途失败时半截副本清理。通过 TrashManager 实例字段注入
// renameForMove/copyDirForMove 确定性触发分支（真实跨设备无法在测试中稳定构造），
// 注入作用域限定在单个实例，不污染同包其他测试。
package recycle

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
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
	src := createTestFile(t, dir, "locked.ysm", "content")
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

func TestMoveEx_CrossDeviceFileFallback(t *testing.T) {
	dir := t.TempDir()
	src := createTestFile(t, dir, "single.ysm", "content")
	tm := newTMWithRenameErr(t, dir, syscall.EXDEV)

	res := tm.MoveEx(src)
	if res.Action != "recycled" {
		t.Fatalf("跨设备文件回退应 recycled, 得到 %s/%s", res.Action, res.Reason)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("源文件应已被删除")
	}
	entries := tm.List()
	if len(entries) != 1 || entries[0].Name != "single.ysm" {
		t.Fatalf("回收站应恰有 single.ysm, 得到 %v", entries)
	}
}

func TestMoveEx_CrossDeviceDirFallback(t *testing.T) {
	dir := t.TempDir()
	modDir := filepath.Join(dir, "mod")
	if err := os.MkdirAll(modDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modDir, "ysm.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modDir, "model.pmx"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	tm := newTMWithRenameErr(t, dir, syscall.EXDEV)

	res := tm.MoveEx(modDir)
	if res.Action != "recycled" {
		t.Fatalf("跨设备目录回退应 recycled, 得到 %s/%s", res.Action, res.Reason)
	}
	if _, err := os.Stat(modDir); !os.IsNotExist(err) {
		t.Fatal("源目录应已被删除")
	}
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("回收站应有 1 个整组条目, 得到 %d", len(entries))
	}
	if entries[0].Name != "mod" {
		t.Errorf("条目名 = %q, 期望 mod", entries[0].Name)
	}
	// 目录内文件应完整复制（ADR-038 D3.4 整组保留）
	if _, err := os.Stat(filepath.Join(entries[0].Path, "model.pmx")); err != nil {
		t.Fatalf("目录内文件未复制: %v", err)
	}
}

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
