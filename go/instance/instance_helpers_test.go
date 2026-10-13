package instance

// ===== instance 抽出子函数直接单测 =====
// 背景：BuildSyncItems 拆出 fileSize / buildDirLevelChildren / nestDirLevelTree 等
// 子函数（e6c81ba4），此处为它们补直接单测，覆盖间接路径摸不到的边界分支
// （nest 的 __self 防御分支、路径不可归属兜底、fileSize Stat 失败、dirLevel 全局夹缺失）。

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/internal/testutil"
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
		testutil.NoError(t, err)
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
		testutil.NoError(t, err)
	}
	flat := []types.ResourceSyncItem{
		// 先插容器 a（来自全局侧 a/b.ysm + a/c.ysm）
		{Path: filepath.Join(a, "b.ysm"), Name: "b.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
		{Path: filepath.Join(a, "c.ysm"), Name: "c.ysm", Status: types.SyncStatusMissing, Type: "ysm"},
		// 再插叶子 a 自身（来自实例侧 Extra）
		{Path: instDir + string(filepath.Separator) + "a", Name: "a", Status: types.SyncStatusOptional, Type: "ysm"},
	}
	out := nestDirLevelTree(flat, globalDir, instDir, "ysm")
	if len(out) != 1 || !out[0].IsDir || out[0].Name != "a" {
		t.Fatalf("应保留容器 a: %+v", out)
	}
	// __self 防御：同段名既是叶子（实例侧 Extra 的 instDir/a）又是中间容器（全局侧 a/b.ysm）。
	// 叶子被收进容器的 __self 内部槽位，展示时仍以其原名 "a" 出现（内部 map 键 __self 不外显）。
	// 本例容器含 missing 子项 → 聚合 diverged → 容器 Path 取全局根（globalDir/a），与实例叶子的
	// instDir/a 不同：属「两侧各有一个同名夹」的真实对象，故保留 __self 行。
	// 同路径的自身 marker（混合夹：既有平铺模型文件又有子模型夹）不属此列，由 absorbSelfMarker
	// 吸收——见 TestNestDirLevelTree_SamePathSelfMarkerMerged。
	foundLeafA := false
	foundB := false
	foundC := false
	for _, c := range out[0].Children {
		switch {
		case c.Name == "a" && !c.IsDir && c.Path == filepath.Join(instDir, "a"):
			foundLeafA = true
		case c.Name == "b.ysm":
			foundB = true
		case c.Name == "c.ysm":
			foundC = true
		}
	}
	if !foundLeafA || !foundB || !foundC {
		t.Fatalf("容器 a 应含叶子 a(实例侧) 与 b.ysm/c.ysm, got %+v", out[0].Children)
	}
}

func TestFileSize_ExistingAndMissing(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "f.bin")
	if err := os.WriteFile(p, make([]byte, 1024), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// fileSize 已收敛至 fsutil.FileSize（锐评 #17）
	if got := fsutil.FileSize(p); got != 1024 {
		t.Fatalf("fsutil.FileSize = %d, want 1024", got)
	}
	if got := fsutil.FileSize(filepath.Join(dir, "nope.bin")); got != 0 {
		t.Fatalf("缺失文件 fsutil.FileSize 应为 0, got %d", got)
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

// 同路径目录 marker（混合夹：既含平铺模型文件、又含子模型夹）必须并入容器，
// 不得渲染成「同名目录嵌在自己里面」——扫描侧为与对侧键集对齐会把容器自身也登记成条目
// （sync_dirlevel.go 的目录 marker），展示层原样吐行就多出一行同名影子目录；且其 Path 与
// 容器 Path 相同 → 前端 dirOpen 共用一个 key，点一次容器会连带展开影子行。
// 2026-09 实测：整合包同步页出现 `2.大学学姐 > 2.大学学姐`（真实仓库混合夹布局）。
func TestNestDirLevelTree_SamePathSelfMarkerMerged(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	a := filepath.Join(globalDir, "a")
	sub := filepath.Join(a, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		testutil.NoError(t, err)
	}
	marker := types.ResourceSyncItem{
		Path: a, Name: "a", Status: types.SyncStatusSynced, Type: "ysm", IsDir: true,
		// 容器的子项：直接文件（Name 无 "/"）+ 子夹内文件（RelPath 形态，带 "/"）
		Children: []types.ResourceSyncItem{
			{Path: filepath.Join(a, "loose.ysm"), Name: "loose.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
			{Path: filepath.Join(sub, "in.ysm"), Name: "sub/in.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
		},
	}
	flat := []types.ResourceSyncItem{
		marker,
		{Path: sub, Name: "sub", Status: types.SyncStatusSynced, Type: "ysm", IsDir: true},
	}
	out := nestDirLevelTree(flat, globalDir, instDir, "ysm")
	if len(out) != 1 || !out[0].IsDir || out[0].Name != "a" {
		t.Fatalf("应只剩一个容器 a: %+v", out)
	}
	names := make([]string, 0, len(out[0].Children))
	for _, c := range out[0].Children {
		names = append(names, c.Name)
	}
	want := map[string]bool{"loose.ysm": false, "sub": false}
	for _, n := range names {
		if n == "a" {
			t.Fatalf("容器 a 不应含自身 marker 的影子行「a」: %v", names)
		}
		if n == "sub/in.ysm" {
			t.Fatalf("子夹内文件应由子夹节点展示，不应上提到容器: %v", names)
		}
		if _, ok := want[n]; ok {
			want[n] = true
		}
	}
	for n, hit := range want {
		if !hit {
			t.Fatalf("容器 a 应含 %q, got %v", n, names)
		}
	}
	// marker 行被吸收后，容器不得再含 Path 等于自身的子项（前端 dirOpen key 冲突的根因）
	for _, c := range out[0].Children {
		if c.Path == out[0].Path {
			t.Fatalf("容器子项 Path 不得等于容器 Path: %+v", c)
		}
	}
}

// ===== ADR-333：防御键移出段名命名空间 =====
// nestDirLevelTree 两处防御分支曾用段名字面量 "__self" 作 children 键，与真实目录名共享
// 命名空间：模型树里存在名为 __self 的真实子目录时，防御节点与真实节点互相覆盖 → 静默丢失
// 一整棵真实子树（无报错）。修法 = 键取 NUL 前缀常量（NUL 被 OS 禁止出现在路径中，
// 碰撞在数学上不成立）。以下两例分别钉住分支 B（叶子写入已存在的真实容器）与
// 分支 A（真实容器先占位、防御分支再写），均要求真实 __self 子树完整存活。

// 分支 B：先建真实容器 __self，且其内部已存在名为 __self 的**嵌套子夹**
// （这是覆盖能发生的必要条件——防御键写入 existing.children["__self"] 时，
// 该键必须已被真实嵌套子夹占用才会覆盖），再插叶子 __self（实例侧 Extra）。
// 旧实现：防御叶子覆盖真实嵌套子夹节点 → real 子树整体消失。
func TestNestDirLevelTree_SelfKeyNoCollisionWithRealDir_LeafOverContainer(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	real := filepath.Join(globalDir, "__self")
	nested := filepath.Join(real, "__self") // 真实嵌套子夹（关键：它占用 children["__self"] 键）
	if err := os.MkdirAll(nested, 0755); err != nil {
		testutil.NoError(t, err)
	}
	flat := []types.ResourceSyncItem{
		// 先建真实容器 __self 及其嵌套子夹 __self（含存活文件 keep.ysm）
		{Path: filepath.Join(nested, "keep.ysm"), Name: "keep.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
		// 再插叶子 __self（实例侧独有同名夹）——触发「同段名既是叶子又已是容器」分支
		{Path: filepath.Join(instDir, "__self"), Name: "__self", Status: types.SyncStatusOptional, Type: "ysm"},
	}
	out := nestDirLevelTree(flat, globalDir, instDir, "ysm")

	// 收集整棵树名字：真实嵌套子夹及其存活文件必须可见（被旧实现吃掉的就是它们）
	seen := map[string]bool{}
	var walk func(items []types.ResourceSyncItem)
	walk = func(items []types.ResourceSyncItem) {
		for _, it := range items {
			seen[it.Name] = true
			if strings.ContainsRune(it.Name, 0) {
				t.Fatalf("防御键外显为段名（键不外显契约被破坏）: %+v", it)
			}
			walk(it.Children)
		}
	}
	walk(out)
	if !seen["keep.ysm"] {
		t.Fatalf("真实嵌套 __self 子夹的子树被防御键覆盖丢失（ADR-333 回归）: %v", seen)
	}
	// 实例侧叶子 __self 同样不得丢（防御目的是保它，不是替真实目录挡路）
	leafKept := false
	var findLeaf func(items []types.ResourceSyncItem)
	findLeaf = func(items []types.ResourceSyncItem) {
		for _, it := range items {
			if !it.IsDir && it.Path == filepath.Join(instDir, "__self") {
				leafKept = true
			}
			findLeaf(it.Children)
		}
	}
	findLeaf(out)
	if !leafKept {
		t.Fatalf("实例侧叶子 __self 应保留: %v", seen)
	}
}

// 分支 A（`nxt.leaf != nil` 防御）经实证确认在旧键下本就安全，故本例是「行为不变」的记录锁
// 而非缺陷回归锁：叶子节点进入该分支时 children 必为 nil（叶子没有子节点），防御写入的键
// 不会覆盖任何既有键；该键随即在 treeChildren 的 leaf 分支被原样输出（键不外显）。
// 保留价值：① 钉住分支 A 未被 ADR-333 改动波及；② 若将来防御节点形态变化（允许带 children），
// 本例会因「防御键落到真实同名段上」而变红，届时需重新评估。
func TestNestDirLevelTree_SelfKeyBranchA_UnaffectedByKeyChange(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst")
	real := filepath.Join(globalDir, "__self")
	if err := os.MkdirAll(real, 0755); err != nil {
		testutil.NoError(t, err)
	}
	flat := []types.ResourceSyncItem{
		// 第 1 条：让 __self 作为叶子占位（末段，无 children）
		{Path: real, Name: "__self", Status: types.SyncStatusOptional, Type: "ysm"},
		// 第 2 条：同名段又作容器下钻 → 命中 `nxt.leaf != nil` 防御分支
		{Path: filepath.Join(instDir, "__self", "x.ysm"), Name: "x.ysm", Status: types.SyncStatusSynced, Type: "ysm"},
	}
	out := nestDirLevelTree(flat, globalDir, instDir, "ysm")

	leafKept, drilled := false, false
	var walk func(items []types.ResourceSyncItem)
	walk = func(items []types.ResourceSyncItem) {
		for _, it := range items {
			if strings.ContainsRune(it.Name, 0) {
				t.Fatalf("防御键外显为段名（键不外显契约被破坏）: %+v", it)
			}
			if !it.IsDir && it.Path == real {
				leafKept = true
			}
			if it.Name == "x.ysm" {
				drilled = true
			}
			walk(it.Children)
		}
	}
	walk(out)
	if !leafKept {
		t.Fatalf("分支 A 防御后叶子 __self 丢失: %+v", out)
	}
	if !drilled {
		t.Fatalf("下钻出的 x.ysm 应可见: %+v", out)
	}
}

// 契约级断言：selfLeafKey 取 NUL 前缀——NUL 被 OS 禁止出现在路径/目录名中，
// 故与任何真实段名碰撞在数学上不成立。此例防「有人图省事改回段名字面量」。
func TestSelfLeafKey_UsesNulPrefix(t *testing.T) {
	if len(selfLeafKey) == 0 || selfLeafKey[0] != 0 {
		t.Fatalf("selfLeafKey 必须以 NUL 前缀（真实段名数学上不可能等于它）: %q", selfLeafKey)
	}
	if strings.ContainsRune(selfLeafKey, filepath.Separator) {
		t.Fatalf("selfLeafKey 不得含路径分隔符（会被误判为多段路径）: %q", selfLeafKey)
	}
}
