// ===== recycle 绑定 InstallLock 行覆盖补测（推送门禁 36.4% → 过线）=====
// R24 给 MoveToRecycle/RestoreFromRecycle/DeleteFromRecycle/EmptyRecycleBin
// 加了 InstallLock，既有测试只覆盖 MoveToRecycle——其余绑定的 Lock/Unlock
// 变更行零覆盖拖低 check-go-diff-coverage。此处用最小路径（错误/空目录分支）
// 逐一执行，命中加锁行即可。
// （MoveToRecycleEx 已随 Deprecated 绑定清理删除：其「findRecycleRoot 失败无
// ysmRoot 兜底」语义无前端消费，见 go-design-critique 动刀记录）
package app

import (
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/internal/testutil"
)

func TestRestoreFromRecycle_NotExist(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	// 幽灵条目：各根回收站均不包含 → 循环全 miss → 兜底 Restore 也报错
	testutil.NotNil(t, a.RestoreFromRecycle(filepath.Join(t.TempDir(), "ghost.ysm"), ysmRoot), "恢复不存在的条目应报错")
}

func TestDeleteFromRecycle_NotExist(t *testing.T) {
	a, _, _ := packApp(t)
	// 幽灵条目：不在任何回收站内 → 各根 Delete 越权报错 → 兜底也报错
	testutil.NotNil(t, a.DeleteFromRecycle(filepath.Join(t.TempDir(), "ghost.ysm")), "删除不存在的条目应报错")
}

func TestEmptyRecycleBin_NoRecycleDir(t *testing.T) {
	a, _, _ := packApp(t)
	// 无 .recycle 目录：各根 recycle.Empty 返回 0 无错 → total=0 无错
	n, err := a.EmptyRecycleBin()
	testutil.NoError(t, err, "无回收站目录不应报错")
	testutil.Equal(t, n, 0, "无回收站目录应返回 0")
}

// MoveToRecycle 成功路径（R24 加锁行）：src 落在资源根内 → findRecycleRoot 命中 →
// recycle.Move 成功 → scanner.InvalidateCache()。覆盖变更行。
func TestMoveToRecycle_Success(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	src := filepath.Join(ysmRoot, "recycle-me.ysm")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, a.MoveToRecycle(src), "回收失败")
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
		testutil.NoError(t, err)
	}
	testutil.NoError(t, a.MoveToRecycle(src), "预置回收失败")
	entries := a.ListRecycleBin("")
	testutil.Equal(t, len(entries), 1, "ListRecycleBin 应列出 1 条")
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
		testutil.NoError(t, err)
	}
	testutil.NoError(t, a.MoveToRecycle(src), "预置回收失败")
	// 传入 ysmRoot 的父目录：recyclePath 包含回收根 → 该根被保留（双向 IsInside）
	parent := filepath.Dir(ysmRoot)
	testutil.Equal(t, len(a.ListRecycleBin(parent)), 1, "传父目录应命中 1 条")
}

func TestListRecycleBin_ScopedByRecyclePath(t *testing.T) {
	a, ysmRoot, _ := packApp(t)
	src := filepath.Join(ysmRoot, "scoped.ysm")
	if err := os.WriteFile(src, []byte("data"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	testutil.NoError(t, a.MoveToRecycle(src), "预置回收失败")

	testutil.Equal(t, len(a.ListRecycleBin(ysmRoot)), 1, "传所属根应列出 1 条")
	testutil.Equal(t, len(a.ListRecycleBin("")), 1, "传空串应退回全量 1 条")
	testutil.Equal(t, len(a.ListRecycleBin(t.TempDir())), 0, "传无关根目录应列出 0 条")
}
