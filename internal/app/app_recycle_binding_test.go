// ===== recycle 四绑定 InstallLock 行覆盖补测（推送门禁 36.4% → 过线）=====
// R24 给 MoveToRecycle/MoveToRecycleEx/RestoreFromRecycle/DeleteFromRecycle/
// EmptyRecycleBin 加了 InstallLock，既有测试只覆盖 MoveToRecycle——其余四绑定
// 的 Lock/Unlock 变更行零覆盖拖低 check-go-diff-coverage。此处用最小路径
// （错误/空目录分支）逐一执行四绑定，命中加锁行即可。
package app

import (
	"os"
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

// MoveToRecycleEx 成功路径（R24 加锁行）：src 落在资源根内 → findRecycleRoot 命中 →
// recycle.New(root).MoveEx 成功 → scanner.InvalidateCache()。覆盖变更行 block[55-56]。
func TestMoveToRecycleEx_Success(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	src := filepath.Join(ysmRoot, "recycle-me.ysm")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	action, reason := a.MoveToRecycleEx(src)
	if action != "recycled" {
		t.Fatalf("应 recycled, got %q (%s)", action, reason)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Error("回收后源文件应已进入回收站")
	}
}

// ListRecycleBin 遍历各资源根（R24 加锁行）：move 一个文件进回收站后列出，
// 覆盖变更行 block[179-180]（for _, e := range recycle.New(r).List()）。
func TestListRecycleBin_IteratesRoots(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	src := filepath.Join(ysmRoot, "list-me.ysm")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if action, _ := a.MoveToRecycleEx(src); action != "recycled" {
		t.Fatalf("预置回收失败: %s", action)
	}
	entries := a.ListRecycleBin("")
	if len(entries) != 1 {
		t.Fatalf("ListRecycleBin 应列出 1 条, 得到 %d", len(entries))
	}
}

// ===== ListRecycleBin 的 recyclePath 作用域过滤 =====
// 后端契约曾打折：recyclePath 参数在函数体内零引用（恒遍历所有根），
// 逼前端 features/recycle-bin.ts 自建 isPathInRoot 做路径前缀补位。
// 此处锁定"传参即过滤、空串退回全量"的语义，防止该参数再次被架空。
// 路径包含判定复用 go/paths.IsInside（双向：recyclePath 在根内 或 根在 recyclePath 内），
// 不在此重复测试 paths 包自身已覆盖的边界。

func TestListRecycleBin_ScopeIncludesParentRelation(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	src := filepath.Join(ysmRoot, "scoped.ysm")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if action, _ := a.MoveToRecycleEx(src); action != "recycled" {
		t.Fatalf("预置回收失败: %s", action)
	}
	// 传入 ysmRoot 的父目录：recyclePath 包含回收根 → 该根被保留（双向 IsInside）
	parent := filepath.Dir(ysmRoot)
	if got := len(a.ListRecycleBin(parent)); got != 1 {
		t.Fatalf("传父目录应命中 1 条, 得到 %d", got)
	}
}

func TestListRecycleBin_ScopedByRecyclePath(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	src := filepath.Join(ysmRoot, "scoped.ysm")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if action, _ := a.MoveToRecycleEx(src); action != "recycled" {
		t.Fatalf("预置回收失败: %s", action)
	}

	if got := len(a.ListRecycleBin(ysmRoot)); got != 1 {
		t.Fatalf("传所属根应列出 1 条, 得到 %d", got)
	}
	if got := len(a.ListRecycleBin("")); got != 1 {
		t.Fatalf("传空串应退回全量 1 条, 得到 %d", got)
	}
	if got := len(a.ListRecycleBin(t.TempDir())); got != 0 {
		t.Fatalf("传无关根目录应列出 0 条, 得到 %d", got)
	}
}
