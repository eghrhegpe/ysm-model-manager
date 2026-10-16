// instance_tree_single_repr_test.go：混合夹单表示（ADR-351 D3 修订，2026-10-16）。
//
// 病史：混合夹（自身直挂平铺模型文件 + 子模型夹）在面板链里同一物理文件有两种
// 表示——marker 的直挂 diff 子项（buildDirLevelChildren）与平铺单元叶子
// （collectEntriesWalk 文件分支任意深度收集后经树化嵌套）——面板双行、侧栏
// dedupeSorted 压重兜底。D3 修订（树化单表示，扫描层零改动）后：混合夹 marker
// 不展开直挂子文件，直挂文件由平铺单元唯一表示；本测试钉死该不变量。
//
// 扫描侧平铺单元不可移除的边界（修订依据，勿再按原案试）：sync_multilayer_test.go
// TestSyncResourcesDirLevel_FlatFileNotAbove_SubfolderKept 钉死「容器内平铺文件
// 必须进 Missing 作独立条目」——CLI PushResources 按清单逐条推送，平铺单元是
// 推送链承重墙；marker 承担跨侧键对齐（防幻影 Missing+Extra）。双登记各有承重。
package instance

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// mixedFolderFixture 构造混合夹：A 直挂 flat.pmx + 子夹 B/deep.pmx（实例侧整夹缺失）。
// 文件写入复用本包 status_counts_test.go|writeFile（MkdirAll + WriteFile）。
func mixedFolderFixture(t *testing.T) (globalDir string, ins types.VersionInstance) {
	t.Helper()
	sub := registry.SubDirMap("EntityPlayer")
	if sub == "" {
		t.Skip("EntityPlayer 无 instanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir = filepath.Join(base, "global")
	instRoot := filepath.Join(base, "inst")
	writeFile(t, filepath.Join(globalDir, "A", "flat.pmx"), "flat")
	writeFile(t, filepath.Join(globalDir, "A", "B", "deep.pmx"), "deep")
	return globalDir, types.VersionInstance{
		Name:       "t",
		VersionDir: instRoot,
		CustomDir:  filepath.Join(instRoot, filepath.FromSlash(sub)),
	}
}

// TestBuildSyncItems_MixedFolderSingleAppearance 验收不变量（ADR-351 D3）：
// 同一物理文件在 BuildSyncItems 产物中至多出现一次——混合夹直挂文件 flat.pmx
// 在容器 A 的 children 里恰好 1 次（旧形态 2 次：marker 子项 + 平铺叶子共存）。
func TestBuildSyncItems_MixedFolderSingleAppearance(t *testing.T) {
	globalDir, ins := mixedFolderFixture(t)
	rt := registry.ResourceType{ID: "EntityPlayer", Icon: "🧍"}

	items := BuildSyncItems(&ins, []registry.ResourceType{rt}, map[string]string{"EntityPlayer": globalDir}, "")

	flat := filepath.Join(globalDir, "A", "flat.pmx")
	containerA := filepath.Join(globalDir, "A")
	deep := filepath.Join(globalDir, "A", "B", "deep.pmx")

	// 顶层唯一容器行（旧形态可能伴生同名 marker 兄弟行）
	topA := 0
	for i := range items {
		if items[i].Path == containerA {
			topA++
		}
	}
	if topA != 1 {
		t.Fatalf("容器 A 应恰有 1 个顶层行，实际 %d（items=%+v）", topA, items)
	}

	// 容器 children：flat 恰 1 次、deep 经子夹行可达、无与容器同 Path 的影子行
	var aRow *types.ResourceSyncItem
	for i := range items {
		if items[i].Path == containerA {
			aRow = &items[i]
		}
	}
	if aRow == nil {
		t.Fatal("未找到容器 A 行")
	}
	flatCount, deepCount, shadowCount := 0, 0, 0
	var walk func(nodes []types.ResourceSyncItem)
	walk = func(nodes []types.ResourceSyncItem) {
		for i := range nodes {
			n := &nodes[i]
			switch n.Path {
			case flat:
				flatCount++
			case deep:
				deepCount++
			case containerA:
				shadowCount++
			}
			if n.Children != nil {
				walk(n.Children)
			}
		}
	}
	walk(aRow.Children)
	if flatCount != 1 {
		t.Errorf("混合夹直挂文件 flat.pmx 应恰出现 1 次，实际 %d（children=%+v）——单表示回归（ADR-351 D3）", flatCount, aRow.Children)
	}
	if deepCount != 1 {
		t.Errorf("子夹文件 deep.pmx 应经子夹行可达恰 1 次，实际 %d", deepCount)
	}
	if shadowCount != 0 {
		t.Errorf("容器 children 内不得有与容器同 Path 的影子行（旧 marker 残留），实际 %d", shadowCount)
	}
}

// TestBuildInstanceStatusCounts_MixedFolderNoDedupeNeeded 侧栏清单天然无重复
// （dedupeSorted 退役后的直接验证：同一文件不再经两种表示进清单）。
func TestBuildInstanceStatusCounts_MixedFolderNoDedupeNeeded(t *testing.T) {
	globalDir, ins := mixedFolderFixture(t)

	st := BuildInstanceStatusCounts(
		[]types.VersionInstance{ins},
		[]registry.ResourceType{{ID: "EntityPlayer", Icon: "🧍"}},
		map[string]string{"EntityPlayer": globalDir},
	)[0]

	seen := map[string]bool{}
	for _, p := range st.Missing {
		if seen[p] {
			t.Errorf("清单重复条目 %s（全清单 %v）——单表示失效，重复安装回归（ADR-351 D3）", p, st.Missing)
		}
		seen[p] = true
	}
	flat := filepath.Join(globalDir, "A", "flat.pmx")
	deep := filepath.Join(globalDir, "A", "B", "deep.pmx")
	if !seen[flat] || !seen[deep] {
		t.Errorf("直挂与子夹文件都应进清单：flat=%v deep=%v（清单 %v）", seen[flat], seen[deep], st.Missing)
	}
}
