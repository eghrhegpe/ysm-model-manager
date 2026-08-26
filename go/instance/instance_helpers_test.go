package instance

// ===== instance 抽出子函数直接单测 =====
// 背景：BuildSyncItems 拆出 fileSize / buildDirLevelChildren / nestDirLevelTree 等
// 子函数（e6c81ba4），此处为它们补直接单测，覆盖间接路径摸不到的边界分支
// （nest 的 __self 防御分支、路径不可归属兜底、fileSize Stat 失败、dirLevel 全局夹缺失）。

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestNestDirLevelTree_Empty(t *testing.T) {
	base := t.TempDir()
	out := nestDirLevelTree(nil, filepath.Join(base, "g"), filepath.Join(base, "i"), "ysm")
	if len(out) != 0 {
		t.Fatalf("空输入应返回空, got %d", len(out))
	}
}

func TestNestDirLevelTree_FlatRootLeaf(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	leaf := types.ResourceSyncItem{Path: filepath.Join(globalDir, "m.ysm"), Name: "m.ysm", Status: types.SyncStatusSynced, Type: "ysm"}
	out := nestDirLevelTree([]types.ResourceSyncItem{leaf}, globalDir, filepath.Join(base, "inst"), "ysm")
	if len(out) != 1 || out[0].Name != "m.ysm" || out[0].IsDir {
		t.Fatalf("根下叶子应原样返回: %+v", out)
	}
}

func TestNestDirLevelTree_NestedContainer(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	a := filepath.Join(globalDir, "a")
	if err := os.MkdirAll(a, 0755); err != nil {
		t.Fatal(err)
	}
	flat := []types.ResourceSyncItem{
		{Path: filepath.Join(a, "b.ysm"), Name: "b.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
		{Path: filepath.Join(a, "c.ysm"), Name: "c.ysm", Status: types.SyncStatusMissing, Type: "ysm"},
	}
	out := nestDirLevelTree(flat, globalDir, instDir, "ysm")
	if len(out) != 1 {
		t.Fatalf("应有一个容器, got %d: %+v", len(out), out)
	}
	cont := out[0]
	if !cont.IsDir || cont.Name != "a" || cont.Status != types.SyncStatusDiverged {
		t.Fatalf("容器 a 应 isDir 且 diverged: %+v", cont)
	}
	if len(cont.Children) != 2 {
		t.Fatalf("容器 a 应有 2 个子项, got %d", len(cont.Children))
	}
	// 子项按名排序：b.ysm, c.ysm
	if cont.Children[0].Name != "b.ysm" || cont.Children[1].Name != "c.ysm" {
		t.Fatalf("子项顺序: %q, %q", cont.Children[0].Name, cont.Children[1].Name)
	}
}

func TestNestDirLevelTree_PathUnattributableFallsBackFlat(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	// 路径不在任一 root 下 → 防御性平铺顶层
	outside := filepath.Join(base, "outside", "x.ysm")
	leaf := types.ResourceSyncItem{Path: outside, Name: "x.ysm", Status: types.SyncStatusOptional, Type: "ysm"}
	out := nestDirLevelTree([]types.ResourceSyncItem{leaf}, globalDir, instDir, "ysm")
	if len(out) != 1 || out[0].Path != outside || out[0].IsDir {
		t.Fatalf("不可归属路径应平铺顶层: %+v", out)
	}
}

func TestNestDirLevelTree_SameSegmentLeafAndContainer(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	a := filepath.Join(globalDir, "a")
	if err := os.MkdirAll(a, 0755); err != nil {
		t.Fatal(err)
	}
	flat := []types.ResourceSyncItem{
		// 先插容器 a（来自全局侧 a/b.ysm）
		{Path: filepath.Join(a, "b.ysm"), Name: "b.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
		// 再插叶子 a 自身（来自实例侧 Extra）
		{Path: instDir + string(filepath.Separator) + "a", Name: "a", Status: types.SyncStatusOptional, Type: "ysm"},
	}
	out := nestDirLevelTree(flat, globalDir, instDir, "ysm")
	if len(out) != 1 || !out[0].IsDir || out[0].Name != "a" {
		t.Fatalf("应保留容器 a: %+v", out)
	}
	// __self 防御：同段名既是叶子（实例侧 Extra 的 instDir/a）又是中间容器（全局侧 a/b.ysm）。
	// 叶子被收进容器的 __self 内部槽位，展示时仍以其原名 "a" 出现（内部 map 键 __self 不外显）。
	foundLeafA := false
	foundB := false
	for _, c := range out[0].Children {
		switch {
		case c.Name == "a" && !c.IsDir && c.Path == filepath.Join(instDir, "a"):
			foundLeafA = true
		case c.Name == "b.ysm":
			foundB = true
		}
	}
	if !foundLeafA || !foundB {
		t.Fatalf("容器 a 应同时含叶子 a(实例侧) 与 b.ysm, got %+v", out[0].Children)
	}
}

func TestFileSize_ExistingAndMissing(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.bin")
	if err := os.WriteFile(p, make([]byte, 1024), 0644); err != nil {
		t.Fatal(err)
	}
	if got := fileSize(p); got != 1024 {
		t.Fatalf("fileSize = %d, want 1024", got)
	}
	if got := fileSize(filepath.Join(dir, "nope.bin")); got != 0 {
		t.Fatalf("缺失文件 fileSize 应为 0, got %d", got)
	}
}

func TestBuildDirLevelChildren_MissingGlobalDir(t *testing.T) {
	base := t.TempDir()
	// 全局夹不存在 → 返回 nil（无子项可预览）
	out := buildDirLevelChildren(filepath.Join(base, "no-such"), filepath.Join(base, "inst"), "ysm", "📦", filepath.Join(base, "no-such"))
	if out != nil {
		t.Fatalf("全局夹缺失应返回 nil, got %d", len(out))
	}
}
