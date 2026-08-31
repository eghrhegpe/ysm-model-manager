// ===== recycle.go 安全分支覆盖率补测（R24/R26 diff 行）=====
// 通过注入 renameForMove / copyDirForMove / copyFileForMove 确定性触发跨设备回退、
// 复制失败回滚、Restore 符号链接、Empty 守卫等原难覆盖分支。
package recycle

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/internal/testutil"
)

// setupCrossDevice 注入跨设备回退（rename 报 EXDEV → 复制后删），使 moveEx/Restore 走复制分支。
// 收敛各跨设备测试重复的注入样板（jscpd 新增对收敛）。
func setupCrossDevice(tm *TrashManager) {
	tm.renameForMove = func(_, _ string) error { return syscall.EXDEV }
	tm.copyFileForMove = func(s, d string) error { return fsutil.CopyFile(s, d) }
	tm.copyDirForMove = func(s, d string) error {
		return fsutil.CopyDirRecursive(s, d, fsutil.CopyDirOptions{RejectSymlink: false, Overwrite: true, Rollback: false})
	}
}

// makeModelDir 创建待移动的模型目录（测试夹具），收敛跨测试重复的建目录样板。
func makeModelDir(t *testing.T, dir string) string {
	t.Helper()
	modelDir := filepath.Join(dir, "model")
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		t.Fatal(err)
	}
	return modelDir
}

// 跨设备文件 move：rename 报 EXDEV → 回退 copyFileForMove → 源删除 → recycled。
// 覆盖 moveEx 的 IsCrossDeviceErr 判定与文件分支（复制成功路径）。
func TestMove_CrossDevice_File(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	setupCrossDevice(tm)

	src := testutil.CreateTestFile(t, dir, "cdn.ysm", "cross-device content")
	res := tm.MoveEx(src)
	if res.Action != "recycled" {
		t.Fatalf("跨设备文件 move 应 recycled, got %s (%s)", res.Action, res.Reason)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("跨设备 move 后源文件应已删除")
	}
	if got := tm.List(); len(got) != 1 {
		t.Fatalf("回收站应有 1 条, 得到 %d", len(got))
	}
}

// 跨设备目录 move：rename 报 EXDEV → 回退 copyDirForMove → 源删除 → recycled。
// 覆盖 moveEx 目录分支（复制成功路径）。
func TestMove_CrossDevice_Dir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	setupCrossDevice(tm)

	modelDir := makeModelDir(t, dir)
	res := tm.MoveEx(modelDir)
	if res.Action != "recycled" {
		t.Fatalf("跨设备目录 move 应 recycled, got %s (%s)", res.Action, res.Reason)
	}
	if _, err := os.Stat(modelDir); !os.IsNotExist(err) {
		t.Error("跨设备 move 后源目录应已删除")
	}
}

// 跨设备文件 move 复制失败：copyFileForMove 报错 → 清理半截 + 返回错误，源保留（无残留副本）。
// 覆盖文件分支复制失败路径（logHalfCleanup + 错误返回）。
func TestMove_CrossDevice_CopyFail(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	tm.renameForMove = func(_, _ string) error { return syscall.EXDEV }
	tm.copyFileForMove = func(_, _ string) error { return errors.New("copy failed") }

	src := testutil.CreateTestFile(t, dir, "fail.ysm", "x")
	res := tm.MoveEx(src)
	if res.Action != "error" {
		t.Fatalf("复制失败应返回 error, got %s", res.Action)
	}
	if _, err := os.Stat(src); os.IsNotExist(err) {
		t.Error("复制失败回滚后源文件应仍在（无残留副本）")
	}
}

// 跨设备 Restore 文件：rename 报 EXDEV → 回退 copyFileForMove → 源恢复。
// 覆盖 Restore 的 IsCrossDeviceErr 判定与文件分支。
func TestRestore_CrossDevice_File(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	src := testutil.CreateTestFile(t, dir, "r.ysm", "content")
	if err := tm.Move(src); err != nil {
		t.Fatal(err)
	}
	entries := tm.List()
	if len(entries) != 1 {
		t.Fatalf("回收站应有 1 条")
	}
	setupCrossDevice(tm)
	if err := tm.Restore(entries[0].Path); err != nil {
		t.Fatalf("跨设备 restore 失败: %v", err)
	}
	if _, err := os.Stat(src); os.IsNotExist(err) {
		t.Error("跨设备 restore 后源应存在")
	}
}

// Restore 符号链接条目（链接指向回收站内）：读链接目标 → 原位置重建链接 → 删除回收站侧旧链接。
// 与「指向外部」的链接不同（守卫经 EvalSymlinks 解析后拒绝），指向回收站内的历史链接条目
// 可通过 IsInsideResolved 守卫，命中 Restore 的 Lstat 符号链接分支（recycle.go 296-316）。
func TestRestore_SymlinkInside(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	// 在回收站内放真实文件，并建一个指向它的符号链接条目
	targetInside := filepath.Join(tm.RecycleDir(), "real.ysm")
	if err := os.MkdirAll(tm.RecycleDir(), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(targetInside, []byte("target content"), 0644); err != nil {
		t.Fatal(err)
	}
	recEntry := filepath.Join(tm.RecycleDir(), "link.ysm")
	if err := os.Symlink(targetInside, recEntry); err != nil {
		t.Skipf("Symlink 不可用（需权限）: %v", err)
	}
	if err := tm.Restore(recEntry); err != nil {
		t.Fatalf("Restore 站内符号链接失败: %v", err)
	}
	if _, err := os.Lstat(recEntry); !os.IsNotExist(err) {
		t.Error("Restore 后回收站侧链接应已删除")
	}
	// 原位置应重建出指向回收站内真实文件的符号链接
	restored := filepath.Join(dir, "link.ysm")
	if target, err := os.Readlink(restored); err != nil || target != targetInside {
		t.Errorf("Restore 应在原位置重建链接指向 %s, got %q (err %v)", targetInside, target, err)
	}
}

// Empty 守卫：.recycle 被替换为指向外部的 symlink 时应拒绝清空（防 R26 P2-1 误删外部树）。
// 覆盖 Empty 入口 Lstat 符号链接拒绝分支。
func TestEmpty_SymlinkRejected(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	// 把 .recycle 换成指向外部目录的 symlink
	if err := os.RemoveAll(tm.RecycleDir()); err != nil {
		t.Fatal(err)
	}
	ext := t.TempDir()
	if err := os.Symlink(ext, tm.RecycleDir()); err != nil {
		t.Skipf("Symlink 不可用: %v", err)
	}
	if _, err := tm.Empty(); err == nil {
		t.Fatal("清空被 symlink 替换的回收站应拒绝")
	}
}

// 包级 Move 向后兼容函数：recycle.Move(src, filesRoot) → New(filesRoot).Move(src)。
// 覆盖 packagePattern 变更行 block[415-417]（Move 函数体，go/cli/dedup.go 仍调用）。
func TestMove_PackageFunc(t *testing.T) {
	dir := t.TempDir()
	src := testutil.CreateTestFile(t, dir, "pkg.ysm", "pkg move")
	if err := Move(src, dir); err != nil {
		t.Fatalf("recycle.Move 失败: %v", err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("recycle.Move 后源文件应已进入回收站")
	}
	if got := New(dir).List(); len(got) != 1 {
		t.Fatalf("回收站应有 1 条, 得到 %d", len(got))
	}
}

// 跨设备目录 move：源目录内文件持写锁 → os.RemoveAll(src) 删除失败 →
// 回滚已落地的副本（R26 P2-2），恢复「源还在 + 副本已清理」原子语义。
// 覆盖 moveEx 目录分支「源删除失败回滚」变更行（block[171-176]/[179-179]）。
// 注：依赖 Windows 下 os.RemoveAll 对持锁子文件删除失败；若平台共享语义放行删除，
// 本测试会 FAIL（此时该分支仍属防御性不可测，由其它测试兜住）。
func TestMoveEx_CrossDevice_Dir_SourceRemoveLocked(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	setupCrossDevice(tm)
	modelDir := makeModelDir(t, dir)
	locked := filepath.Join(modelDir, "lock.txt")
	if err := os.WriteFile(locked, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 独占写锁：使源目录删除（os.RemoveAll）失败，触发副本回滚分支
	fh, err := os.OpenFile(locked, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()

	res := tm.MoveEx(modelDir)
	if res.Action != "error" {
		t.Fatalf("源删除锁定应返回 error, got %s", res.Action)
	}
	if _, e := os.Stat(modelDir); os.IsNotExist(e) {
		t.Error("源删除失败后源目录应仍保留")
	}
	if got := tm.List(); len(got) != 0 {
		t.Errorf("回滚后回收站应为空, 得到 %d 条", len(got))
	}
}
