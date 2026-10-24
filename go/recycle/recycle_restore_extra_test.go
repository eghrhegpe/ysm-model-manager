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

	"ysm-model-manager/go/internal/testutil"
)

// Restore 越权：src 在回收站目录之外应被拒绝
func TestRestore_OutOfRecycleDir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	outside := filepath.Join(t.TempDir(), "x.ysm")
	err := tm.Restore(outside)
	testutil.NotNil(t, err, "回收站外路径恢复应被拒绝")
}

// Restore 根级守卫：src == 回收站目录自身应被拒绝（IsInside 相等放行 → 走显式 Clean 相等拒绝）
func TestRestore_RecycleRootRejected(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	// 先移入一个文件确保 .recycle 目录已存在
	src := testutil.CreateTestFile(t, dir, "test.ysm", "x")
	testutil.NoError(t, tm.Move(src))
	err := tm.Restore(tm.RecycleDir())
	testutil.NotNil(t, err, "恢复回收站根目录应被拒绝")
	// 回收站内容不应受影响
	testutil.Equal(t, len(tm.List()), 1, "回收站内容不应受影响")
}

// Restore 源缺失：os.Rename 返回 ENOENT（非跨设备错误）→ 直接返回，不静默成功
func TestRestore_SourceMissing(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	err := tm.Restore(filepath.Join(tm.RecycleDir(), "missing.ysm"))
	testutil.NotNil(t, err, "源不存在恢复应报错")
	// 目标位置不应有残留
	testutil.FileNotExists(t, filepath.Join(dir, "missing.ysm"), "目标位置不应有残留文件")
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
	testutil.NoError(t, tm.Move(src))
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "前置条件失败：回收站应有 1 个文件, 得到 %d", len(entries))

	rtm := newTMWithExDEV(t, dir)
	testutil.NoError(t, rtm.Restore(entries[0].Path), "跨设备文件恢复应成功")
	// 目标文件已还原且内容完整
	got, err := os.ReadFile(src)
	testutil.NoError(t, err, "恢复后源位置文件应存在")
	testutil.Equal(t, string(got), "exdev content", "内容不一致")
	// 回收站条目应已删除
	testutil.Equal(t, len(tm.List()), 0, "恢复后回收站应为空")
}

// Restore 文件夹型模型（整组合并条目）跨设备回退：整树复制 + 删除回收站条目
func TestRestore_CrossDeviceDirFallback(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	modelDir := filepath.Join(dir, "模型A")
	testutil.NoError(t, os.MkdirAll(filepath.Join(modelDir, "textures"), 0755))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), 0644))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "model.pmx"), []byte("x"), 0644))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "textures", "skin.png"), []byte("PNG"), 0644))
	testutil.NoError(t, tm.Move(modelDir), "整组移入回收站失败")
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "前置条件失败：回收站应有 1 个整组条目, 得到 %d", len(entries))

	rtm := newTMWithExDEV(t, dir)
	testutil.NoError(t, rtm.Restore(entries[0].Path), "跨设备整组恢复应成功")
	// 整树应还原
	testutil.FileExists(t, filepath.Join(dir, "模型A", "ysm.json"), "整组还原后 ysm.json 应存在")
	testutil.FileExists(t, filepath.Join(dir, "模型A", "textures", "skin.png"), "整组还原后 textures/skin.png 应存在")
	// 回收站条目应已删除
	testutil.Equal(t, len(tm.List()), 0, "恢复后回收站应为空")
}

// Restore 跨设备目录复制中途失败：半截副本应被清理，回收站条目保留
func TestRestore_CrossDeviceDirCopyFails_CleansDst(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	modelDir := filepath.Join(dir, "模型B")
	testutil.NoError(t, os.MkdirAll(modelDir, 0755))
	testutil.NoError(t, os.WriteFile(filepath.Join(modelDir, "ysm.json"), []byte(`{"spec":1}`), 0644))
	testutil.NoError(t, tm.Move(modelDir), "整组移入回收站失败")
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "前置条件失败：回收站应有 1 个整组条目, 得到 %d", len(entries))

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

	err := rtm.Restore(entries[0].Path)
	testutil.NotNil(t, err, "复制失败恢复应报错")
	// 半截副本应被清理
	testutil.FileNotExists(t, filepath.Join(dir, "模型B"), "半截恢复目录应被清理")
	// 回收站条目应保留（源未删除）
	testutil.Equal(t, len(tm.List()), 1, "复制失败后回收站条目应保留")
}

// Restore 跨设备文件复制中途失败：半截文件应被清理，回收站条目保留
func TestRestore_CrossDeviceFileCopyFails_CleansDst(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	src := testutil.CreateTestFile(t, dir, "keep.ysm", "exdev content")
	testutil.NoError(t, tm.Move(src))
	entries := tm.List()
	testutil.Equal(t, len(entries), 1, "前置条件失败：回收站应有 1 个文件, 得到 %d", len(entries))

	rtm := newTMWithExDEV(t, dir)
	// 模拟复制中途失败：先写入半截文件再报错，验证半截恢复文件被清理
	rtm.copyFileForMove = func(s, d string) error {
		if err := os.WriteFile(d, []byte("partial"), 0644); err != nil {
			return err
		}
		return os.ErrPermission
	}

	err := rtm.Restore(entries[0].Path)
	testutil.NotNil(t, err, "复制失败恢复应报错")
	// 半截恢复文件应被清理
	testutil.FileNotExists(t, src, "半截恢复文件应被清理")
	// 回收站条目应保留
	testutil.Equal(t, len(tm.List()), 1, "复制失败后回收站条目应保留")
}

// 符号链接恢复：建链失败时回收站条目必须保住（锐评 2026-10-15 修正）。
//
// 病灶：原实现先 os.Remove(src) 再 os.Symlink(target, dst)，建链失败时靠
// os.Symlink(target, src) 回滚；**两次建链都失败**则条目永久丢失——用户看到
// 「恢复失败」，回收站里也没有了。现改为先建 dst、成功后才删 src，建链失败时
// src 分毫未动。
//
// ⚠️ 判别力（防假绿灯）：注入「恒失败」的建链实现。单次失败在新旧两序下都会被
// 回滚救回（旧序回滚重建 src 成功 → 条目仍在），只有恒失败才能把两种顺序区分开——
// 旧序会把 src 删掉后两次建链皆败（本用例转红），新序第一次失败即返回（转绿）。
func TestRestoreSymlinkEntry_LinkFailureKeepsRecycleEntry(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	testutil.NoError(t, os.MkdirAll(tm.RecycleDir(), 0755))
	target := filepath.Join(dir, "target.ysm")
	testutil.NoError(t, os.WriteFile(target, []byte("x"), 0644))
	src := filepath.Join(tm.RecycleDir(), "link.ysm")
	if err := os.Symlink(target, src); err != nil {
		t.Skipf("Symlink 不可用（需权限）: %v", err)
	}
	dst := filepath.Join(dir, "link.ysm")
	// 恒失败：把「建链失败 + 回滚建链也失败」压成一次注入
	tm.symlinkForRestore = func(_, _ string) error { return os.ErrPermission }

	handled, err := tm.restoreSymlinkEntry(src, dst)
	testutil.Equal(t, handled, true, "符号链接条目应由 restoreSymlinkEntry 接管")
	testutil.NotNil(t, err, "建链失败应报错（不得静默成功）")
	// 核心断言：回收站条目分毫未动（旧序此处已被 os.Remove 删掉）
	info, lerr := os.Lstat(src)
	testutil.NoError(t, lerr, "建链失败后回收站条目必须保留（旧序的永久丢失窗口）")
	testutil.Equal(t, info.Mode()&os.ModeSymlink == 0, false, "回收站条目应仍是符号链接")
	got, rerr := os.Readlink(src)
	testutil.NoError(t, rerr, "回收站链接目标读取失败")
	testutil.Equal(t, got, target, "回收站链接目标应不变")
	// 落点不得留下任何半成品
	testutil.FileNotExists(t, dst, "建链失败不应在落点留下任何东西")
}
