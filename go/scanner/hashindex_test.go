//go:build !rust_backend

// ===== 持久哈希索引测试（ADR-348 B1）=====
package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

func TestHashIndex_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	h1 := OpenHashIndex(dir)
	h1.Record("/repo/a.ysm", 100, 1000, "h-a")
	h1.Record("/repo/b.ysm", 200, 2000, "h-b")
	h1.Save()

	// 重开实例：从盘恢复（实例无内存共享）
	h2 := OpenHashIndex(dir)
	_, ok := h2.Lookup("/repo/a.ysm", 100, 1000)
	testutil.Equal(t, ok, true, "重载后指纹命中")
	v, _ := h2.Lookup("/repo/b.ysm", 200, 2000)
	testutil.Equal(t, v, "h-b", "重载后哈希值")
}

func TestHashIndex_FingerprintMismatchMisses(t *testing.T) {
	dir := t.TempDir()
	h := OpenHashIndex(dir)
	h.Record("/repo/a.ysm", 100, 1000, "h-a")
	// size 变 / mtime 变 → 内容变更 → 必须 miss（强制重算）
	v, ok := h.Lookup("/repo/a.ysm", 101, 1000)
	testutil.Equal(t, v, "", "size 变指纹")
	testutil.Equal(t, ok, false, "size 变指纹 miss")
	_, ok = h.Lookup("/repo/a.ysm", 100, 1001)
	testutil.Equal(t, ok, false, "mtime 变指纹 miss")
	v, ok = h.Lookup("/repo/a.ysm", 100, 1000)
	testutil.Equal(t, v, "h-a", "双指纹一致命中")
	testutil.Equal(t, ok, true, "双指纹一致命中 ok")
	// 空哈希不入索引（Record 守卫）
	h.Record("/repo/big.ysm", 999, 1, "")
	v, _ = h.Lookup("/repo/big.ysm", 999, 1)
	testutil.Equal(t, v, "", "空哈希条目不产生命中")
}

func TestHashIndex_PruneHealsGonePaths(t *testing.T) {
	dir := t.TempDir()
	h := OpenHashIndex(dir)
	h.Record("/repo/a.ysm", 1, 1, "h-a")
	h.Record("/repo/b.ysm", 2, 2, "h-b")
	h.Prune(map[string]struct{}{"/repo/a.ysm": {}}) // b 已删除
	h.Save()
	h2 := OpenHashIndex(dir)
	v, _ := h2.Lookup("/repo/b.ysm", 2, 2)
	testutil.Equal(t, v, "", "剪枝后消失路径不命中")
	v, _ = h2.Lookup("/repo/a.ysm", 1, 1)
	testutil.Equal(t, v, "h-a", "存活路径照常")
}

func TestHashIndex_CorruptFileSelfHeals(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, HashIndexPath)
	_ = os.WriteFile(p, []byte("{not-json"), 0o644)
	h := OpenHashIndex(dir)
	testutil.Equal(t, h.loadEmpty, true, "坏表标记（首记即重写）")
	h.Record("/repo/a.ysm", 1, 1, "h-a")
	h.Save()
	// 重写后可正常重开
	h2 := OpenHashIndex(dir)
	v, _ := h2.Lookup("/repo/a.ysm", 1, 1)
	testutil.Equal(t, v, "h-a", "坏表自愈重写")
}

func TestHashIndex_SaveDirtyGating(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, HashIndexPath)
	h := OpenHashIndex(dir)
	// 无变更不写盘（稳态近零写）
	h.Save()
	_, err := os.Stat(p)
	testutil.Equal(t, err != nil, true, "clean 态 Save 不落盘")
	h.Record("/repo/a.ysm", 1, 1, "h-a")
	h.Save()
	_, err = os.Stat(p)
	testutil.Equal(t, err, nil, "dirty 态落盘")
}

func TestHashIndexFor_SameInstancePerRoot(t *testing.T) {
	dir := t.TempDir()
	sameA := HashIndexFor(dir)
	sameB := HashIndexFor(dir)
	testutil.Equal(t, sameA == sameB, true, "同根同实例")
	testutil.Equal(t, HashIndexFor(dir) != HashIndexFor(t.TempDir()), true, "异根异实例")
}
