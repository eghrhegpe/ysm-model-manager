// ===== moveEx / Delete 守卫与错误分支补测 =====
// 覆盖：recycleDir 未设置、src 不在资源根下（越权）、源缺失（Lstat 失败）、
// Delete 回收站外路径、Delete 源缺失。
package recycle

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// moveEx 在 recycleDir 未设置时应报错（fail-fast 守卫）
func TestMoveEx_RecycleDirUnset(t *testing.T) {
	tm := &TrashManager{}
	res := tm.MoveEx("C:\\whatever\\x.ysm")
	if res.Action != "error" {
		t.Fatalf("recycleDir 未设置应报 error, 得到 %s/%s", res.Action, res.Reason)
	}
}

// moveEx 越权：src 不在资源根目录下应被拒绝
func TestMoveEx_OutsideRoot(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	outside := filepath.Join(t.TempDir(), "x.ysm")
	if err := tm.Move(outside); err == nil {
		t.Fatal("资源根外路径移动应被拒绝")
	}
}

// moveEx 根级守卫：src == 资源根目录自身应被拒绝（IsInside 相等放行 → 敀显式 Clean 相等拒绝）
func TestMoveEx_SrcIsRootDir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	if err := tm.Move(dir); err == nil {
		t.Fatal("移动资源根目录自身应被拒绝")
	}
	// 回收站目录不应被创建（守卫在 MkdirAll 之前）
	if _, err := os.Stat(tm.RecycleDir()); !os.IsNotExist(err) {
		t.Fatal("守卫拒绝后回收站目录不应被创建")
	}
}

// moveEx 源缺失：Lstat 失败直接返回错误
func TestMoveEx_SourceMissing(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	if err := tm.Move(filepath.Join(dir, "nope.ysm")); err == nil {
		t.Fatal("源不存在应报错")
	}
}

// Delete 越权：src 在回收站之外应被拒绝（不删除）
func TestDelete_OutsideRecycleDir(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	outside := testutil.CreateTestFile(t, t.TempDir(), "keep.ysm", "x")
	if err := tm.Delete(outside); err == nil {
		t.Fatal("回收站外路径删除应被拒绝")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("回收站外文件不应被删除: %v", err)
	}
}

// Delete 源缺失：Lstat 失败应报错（而非静默成功）
func TestDelete_Missing(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	if err := tm.Delete(filepath.Join(tm.RecycleDir(), "nope.ysm")); err == nil {
		t.Fatal("不存在的文件删除应报错")
	}
}
