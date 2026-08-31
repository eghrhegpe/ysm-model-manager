// ===== Empty 边界分支补测 =====
// 覆盖：recycleDir 未设置（空字符串）、回收站目录尚不存在（未创建过）。
// RemoveAll/MkdirAll 失败分支依赖系统级删除失败（Windows 上 stdlib 无法
// 稳定构造——只读属性不阻止删除、文件句柄带 FILE_SHARE_DELETE），记为不可测。
package recycle

import (
	"os"
	"strings"
	"testing"
)

// Empty 在 recycleDir 未设置时应返回 (0, nil)（不 panic）
func TestEmpty_RecycleDirUnset(t *testing.T) {
	tm := &TrashManager{}
	count, err := tm.Empty()
	if err != nil {
		t.Fatalf("recycleDir 未设置应返回 nil 错误: %v", err)
	}
	if count != 0 {
		t.Fatalf("应返回 0，得到 %d", count)
	}
}

// Empty 在回收站目录不存在时应返回 (0, nil)
func TestEmpty_RecycleDirNotExist(t *testing.T) {
	dir := t.TempDir()
	tm := New(dir)
	count, err := tm.Empty()
	if err != nil {
		t.Fatalf("回收站不存在应返回 nil 错误: %v", err)
	}
	if count != 0 {
		t.Fatalf("应返回 0，得到 %d", count)
	}
}

// Empty 在 .recycle 是指向外部的 symlink 时应拒绝（R26 P2-1 守卫）
// 威胁模型：.recycle 被替换为指向外部目录的 symlink，os.Stat 跟随返回外部目录 stat（非 NotExist），
// os.RemoveAll 会跟随 symlink 删除外部目录树。Lstat 守卫识别 symlink 并拒绝。
func TestEmpty_RecycleDirIsSymlinkRejected(t *testing.T) {
	dir := t.TempDir()
	external := t.TempDir() // 模拟被 symlink 指向的外部目录
	// 构造 .recycle 为指向 external 的 symlink
	recycleDir := New(dir).RecycleDir()
	if err := os.Symlink(external, recycleDir); err != nil {
		t.Skipf("创建 symlink 失败（权限/平台限制）: %v", err)
	}
	tm := New(dir)
	_, err := tm.Empty()
	if err == nil {
		t.Fatal(".recycle 是 symlink 时应拒绝, 得到 nil 错误")
	}
	if !strings.Contains(err.Error(), "符号链接") {
		t.Fatalf("错误应提及符号链接, 得到: %v", err)
	}
	// 确认 external 目录未被删除（RemoveAll 未执行）
	if _, statErr := os.Stat(external); statErr != nil {
		t.Fatalf("外部目录不应被删除: %v", statErr)
	}
}
