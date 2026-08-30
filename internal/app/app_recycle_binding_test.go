// ===== recycle 四绑定 InstallLock 行覆盖补测（推送门禁 36.4% → 过线）=====
// R24 给 MoveToRecycle/MoveToRecycleEx/RestoreFromRecycle/DeleteFromRecycle/
// EmptyRecycleBin 加了 InstallLock，既有测试只覆盖 MoveToRecycle——其余四绑定
// 的 Lock/Unlock 变更行零覆盖拖低 check-go-diff-coverage。此处用最小路径
// （错误/空目录分支）逐一执行四绑定，命中加锁行即可。
package app

import (
	"path/filepath"
	"testing"
)

func TestMoveToRecycleEx_OutsideAllRoots(t *testing.T) {
	a, _, _ := packApp(t)
	// src 在所有资源根之外 → findRecycleRoot 返回空 → "error" 分支（不加锁行同样执行）
	action, _ := a.MoveToRecycleEx(filepath.Join(t.TempDir(), "ghost.ysm"))
	if action != "error" {
		t.Fatalf("根外路径应返回 error, got %q", action)
	}
}

func TestRestoreFromRecycle_NotExist(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	// 幽灵条目：各根回收站均不包含 → 循环全 miss → 兜底 Restore 也报错
	if err := a.RestoreFromRecycle(filepath.Join(t.TempDir(), "ghost.ysm"), ysmRoot); err == nil {
		t.Fatal("恢复不存在的条目应报错")
	}
}

func TestDeleteFromRecycle_NotExist(t *testing.T) {
	a, _, _ := packApp(t)
	// 幽灵条目：不在任何回收站内 → 各根 Delete 越权报错 → 兜底也报错
	if err := a.DeleteFromRecycle(filepath.Join(t.TempDir(), "ghost.ysm")); err == nil {
		t.Fatal("删除不存在的条目应报错")
	}
}

func TestEmptyRecycleBin_NoRecycleDir(t *testing.T) {
	a, _, _ := packApp(t)
	// 无 .recycle 目录：各根 recycle.Empty 返回 0 无错 → total=0 无错
	n, err := a.EmptyRecycleBin("")
	if err != nil {
		t.Fatalf("无回收站目录不应报错: %v", err)
	}
	if n != 0 {
		t.Fatalf("无回收站目录应返回 0, got %d", n)
	}
}
