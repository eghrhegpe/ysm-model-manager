// ===== Restore 守卫与错误分支补测 =====
// 覆盖：src 不在回收站内（越权）、src == 回收站根（根级守卫）、
// 源缺失时 os.Rename 非跨设备错误直接返回（不尝试复制）。
// 跨设备（EXDEV）复制回退分支通过 renameForMove/copyDirForMove/copyFileForMove
// 注入点确定性触发，见 recycle_restore_crossdev_test.go。
package recycle

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"ysm-model-manager/internal/testutil"
)

// Restore 越权：src 在回收站目录之外应被拒绝
func TestRestore_OutOfRecycleDir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	outside := filepath.Join(t.TempDir(), "x.ysm")
	if err := tm.Restore(outside); err == nil {
		t.Fatal("回收站外路径恢复应被拒绝")
	}
}

// Restore 根级守卫：src == 回收站目录自身应被拒绝（IsInside 相等放行 → 走显式 Clean 相等拒绝）
func TestRestore_RecycleRootRejected(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	// 先移入一个文件确保 .recycle 目录已存在
	src := testutil.CreateTestFile(t, dir, "test.ysm", "x")
	if err := tm.Move(src); err != nil {
		t.Fatal(err)
	}
	if err := tm.Restore(tm.RecycleDir()); err == nil {
		t.Fatal("恢复回收站根目录应被拒绝")
	}
	// 回收站内容不应受影响
	if len(tm.List()) != 1 {
		t.Fatal("回收站内容不应受影响")
	}
}

// Restore 源缺失：os.Rename 返回 ENOENT（非跨设备错误）→ 直接返回，不静默成功
func TestRestore_SourceMissing(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	err := tm.Restore(filepath.Join(tm.RecycleDir(), "missing.ysm"))
	if err == nil {
		t.Fatal("源不存在恢复应报错")
	}
	// 目标位置不应有残留
	if _, statErr := os.Stat(filepath.Join(dir, "missing.ysm")); !os.IsNotExist(statErr) {
		t.Fatalf("目标位置不应有残留文件: %v", statErr)
	}
}

// ===== Restore 跨设备（EXDEV）回退分支单测 =====
// 通过 renameForMove/copyDirForMove/copyFileForMove 注入确定性触发
// （真实跨卷 rename 在单机不可稳定复现），覆盖文件/目录复制回退成功、
// 复制中途失败时半截副本清理、失败后回收站条目保留。

// newTMWithExDEV 构造 root 下 rename 固定返回 EXDEV 的 TrashManager（Restore 注入用）
func newTMWithExDEV(t *testing.T, root string) *TrashManager {
	t.Helper()
	tm := New(root)
	tm.renameForMove = func(src, dst string) error { return syscall.EXDEV }
	return tm
}

// Restore 文件跨设备回退：复制到目标 + 删除回收站条目
func TestRestore_CrossDeviceFileFallback(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	src := testutil.CreateTestFile(t, dir, "keep.ysm", "exdev content")
	if err := tm.Move(src); err != nil {
		t.Fatal(err)
	}
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("前置条件失败：回收站应有 1 个文件, 得到 %d", len(entries))
	}

	rtm := newTMWithExDEV(t, dir)
	if err := rtm.Restore(entries[0].Path); err != nil {
		t.Fatalf("跨设备文件恢复应成功: %v", err)
	}
	// 目标文件已还原且内容完整
	got, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("恢复后源位置文件应存在: %v", err)
	}
	if string(got) != "exdev content" {
		t.Fatalf("内容不一致: 期望 %q, 得到 %q", "exdev content", string(got))
	}
	// 回收站条目应已删除
	if len(tm.List()) != 0 {
		t.Fatal("恢复后回收站应为空")
	}
}

// Restore 文件夹型模型（整组合并条目）跨设备回退：整树复制 + 删除回收站条目
func TestRestore_CrossDeviceDirFallback(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	modelDir := filepath.Join(dir, "模型A")
	if err := os.MkdirAll(filepath.Join(modelDir, "textures"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "textures", "skin.png"), []byte("PNG"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := tm.Move(modelDir); err != nil {
		t.Fatalf("整组移入回收站失败: %v", err)
	}
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("前置条件失败：回收站应有 1 个整组条目, 得到 %d", len(entries))
	}

	rtm := newTMWithExDEV(t, dir)
	if err := rtm.Restore(entries[0].Path); err != nil {
		t.Fatalf("跨设备整组恢复应成功: %v", err)
	}
	// 整树应还原
	if _, err := os.Stat(filepath.Join(dir, "模型A", "ysm.json")); err != nil {
		t.Fatalf("整组还原后 ysm.json 应存在: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "模型A", "textures", "skin.png")); err != nil {
		t.Fatalf("整组还原后 textures/skin.png 应存在: %v", err)
	}
	// 回收站条目应已删除
	if len(tm.List()) != 0 {
		t.Fatal("恢复后回收站应为空")
	}
}

// Restore 跨设备目录复制中途失败：半截副本应被清理，回收站条目保留
func TestRestore_CrossDeviceDirCopyFails_CleansDst(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	modelDir := filepath.Join(dir, "模型B")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := tm.Move(modelDir); err != nil {
		t.Fatalf("整组移入回收站失败: %v", err)
	}
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("前置条件失败：回收站应有 1 个整组条目, 得到 %d", len(entries))
	}

	rtm := newTMWithExDEV(t, dir)
	// 模拟复制中途失败：先写入半截文件再报错，验证 dst 整棵被清理
	rtm.copyDirForMove = func(src, dst string) error {
		if err := os.MkdirAll(dst, 0755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dst, "partial.ysm"), []byte("x"), 0644); err != nil {
			return err
		}
		return os.ErrPermission
	}

	if err := rtm.Restore(entries[0].Path); err == nil {
		t.Fatal("复制失败恢复应报错")
	}
	// 半截副本应被清理
	if _, err := os.Stat(filepath.Join(dir, "模型B")); !os.IsNotExist(err) {
		t.Fatal("半截恢复目录应被清理")
	}
	// 回收站条目应保留（源未删除）
	if len(tm.List()) != 1 {
		t.Fatal("复制失败后回收站条目应保留")
	}
}

// Restore 跨设备文件复制中途失败：半截文件应被清理，回收站条目保留
func TestRestore_CrossDeviceFileCopyFails_CleansDst(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	src := testutil.CreateTestFile(t, dir, "keep.ysm", "exdev content")
	if err := tm.Move(src); err != nil {
		t.Fatal(err)
	}
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("前置条件失败：回收站应有 1 个文件, 得到 %d", len(entries))
	}

	rtm := newTMWithExDEV(t, dir)
	// 模拟复制中途失败：先写入半截文件再报错，验证半截恢复文件被清理
	rtm.copyFileForMove = func(s, d string) error {
		if err := os.WriteFile(d, []byte("partial"), 0644); err != nil {
			return err
		}
		return os.ErrPermission
	}

	if err := rtm.Restore(entries[0].Path); err == nil {
		t.Fatal("复制失败恢复应报错")
	}
	// 半截恢复文件应被清理
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("半截恢复文件应被清理")
	}
	// 回收站条目应保留
	if len(tm.List()) != 1 {
		t.Fatal("复制失败后回收站条目应保留")
	}
}
