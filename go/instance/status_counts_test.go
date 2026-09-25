// ===== ADR-310 侧栏计数入口单测（面板链为单一事实源）=====
// 断言的是「用户可见口径」而非内部实现：
//   - 修改过的文件 → 红（missing），不再被误判成橙（extra）——ADR-310 S1
//   - .ban 禁用项 → 独立 disabled 桶，不再蒸发/计入 synced——S4
//   - 计数单位 = 面板单元（dirLevel=模型夹，fileLevel=文件）——S2
//   - Missing 清单仍是「仓库侧文件绝对路径」（一键安装 runDownloadMissing 契约）——§3 决策
package instance

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// writeFile 建目录 + 写文件（测试夹具，失败即 Fatal）
func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

// TestBuildInstanceStatusCounts_DirLevelFoldAndLists dirLevel 类型（EntityPlayer，模型夹为单元）：
// 单元计数与文件级 Missing 清单双契约一次钉死。
func TestBuildInstanceStatusCounts_DirLevelFoldAndLists(t *testing.T) {
	sub := registry.SubDirMap("EntityPlayer")
	if sub == "" {
		t.Skip("EntityPlayer 无 instanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instRoot := filepath.Join(base, "inst")
	instDir := filepath.Join(instRoot, filepath.FromSlash(sub))

	// synced 单元：两侧同名同内容（放两个模型文件进去——计数必须按「夹」=1，不是文件数 2）
	writeFile(t, filepath.Join(globalDir, "m1", "model.pmx"), "x")
	writeFile(t, filepath.Join(globalDir, "m1", "model.pmd"), "x")
	writeFile(t, filepath.Join(instDir, "m1", "model.pmx"), "x")
	writeFile(t, filepath.Join(instDir, "m1", "model.pmd"), "x")
	// missing 单元：仓库有、实例没有（整夹缺失，夹内 2 个文件 → 计数 1 / 清单 2）
	writeFile(t, filepath.Join(globalDir, "m2", "model.pmx"), "x")
	writeFile(t, filepath.Join(globalDir, "m2", "model2.pmd"), "x")
	// extra 单元：实例独有
	writeFile(t, filepath.Join(instDir, "m3", "extra.pmx"), "x")
	// 分叉单元：两侧同名、内容不同（大小不同 → size 兜底判定，不依赖哈希可得性）
	writeFile(t, filepath.Join(globalDir, "m5", "model.pmx"), "aaaa")
	writeFile(t, filepath.Join(instDir, "m5", "model.pmx"), "bb")
	// 禁用单元：实例侧 .ban 平铺文件（旧 relKey 链剥后缀会误计 synced）
	writeFile(t, filepath.Join(instDir, "banned.pmx.ban"), "x")

	ins := types.VersionInstance{Name: "t", VersionDir: instRoot, CustomDir: instDir}
	got := BuildInstanceStatusCounts(
		[]types.VersionInstance{ins},
		[]registry.ResourceType{{ID: "EntityPlayer", Icon: "🧍"}},
		map[string]string{"EntityPlayer": globalDir},
	)
	if len(got) != 1 {
		t.Fatalf("应返回 1 个实例状态，实际 %d", len(got))
	}
	st := got[0]

	if st.Name != "t" {
		t.Fatalf("Name 应为 t，实际 %q", st.Name)
	}
	if st.CustomDir != instDir {
		t.Fatalf("CustomDir 应为 %q，实际 %q", instDir, st.CustomDir)
	}
	// 单元计数：synced=m1（夹内 2 文件仍算 1 单元），missing=m2+分叉 m5（diverged 折叠进红）
	if st.Synced != 1 {
		t.Fatalf("Synced 应为 1（m1 模型夹 = 1 单元，非夹内 2 文件），实际 %d", st.Synced)
	}
	if st.MissingCount != 2 {
		t.Fatalf("MissingCount 应为 2（m2 缺失 + m5 分叉折叠），实际 %d", st.MissingCount)
	}
	// 单元路径清单：Optional/Legacy → Extra；Disabled → Disabled
	if want := []string{filepath.Join(instDir, "m3")}; !reflect.DeepEqual(sortedCopy(st.Extra), want) {
		t.Fatalf("Extra 单元路径应为 %v，实际 %v", want, st.Extra)
	}
	if want := []string{filepath.Join(instDir, "banned.pmx.ban")}; !reflect.DeepEqual(sortedCopy(st.Disabled), want) {
		t.Fatalf("Disabled 应为 %v，实际 %v", want, st.Disabled)
	}
	// Missing 清单 = 仓库侧文件级绝对路径（缺夹展开成夹内文件，一键安装据此逐条 Install）
	// 顺序无关断言：实现内部按路径排序，测试只比较集合
	want := []string{
		filepath.Join(globalDir, "m2", "model.pmx"),
		filepath.Join(globalDir, "m2", "model2.pmd"),
		filepath.Join(globalDir, "m5", "model.pmx"),
	}
	if !reflect.DeepEqual(sortedCopy(st.Missing), want) {
		t.Fatalf("Missing 文件清单应为 %v，实际 %v", want, st.Missing)
	}
	// 计数（单元）与清单（文件）粒度刻意不同：m2 一个单元 → 两条文件路径
	if len(st.Missing) <= st.MissingCount {
		t.Fatalf("整夹缺失应展开成多条文件路径（清单 %d > 计数 %d 才符合 §3 决策）", len(st.Missing), st.MissingCount)
	}
	if st.Status != "missing" {
		t.Fatalf("Status 应为 missing（红优先），实际 %q", st.Status)
	}
	// 死字段不再填充（前端零消费者，ADR-296 已记录）
	if len(st.Files) != 0 {
		t.Fatalf("Files 应为空（前端零消费者），实际 %d 条", len(st.Files))
	}
}

// TestBuildInstanceStatusCounts_FileLevel 文件级类型（fbx）：单元=文件，清单与计数同粒度。
func TestBuildInstanceStatusCounts_FileLevel(t *testing.T) {
	sub := registry.SubDirMap("fbx")
	if sub == "" {
		t.Skip("fbx 无 instanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instRoot := filepath.Join(base, "inst")
	instDir := filepath.Join(instRoot, filepath.FromSlash(sub))

	writeFile(t, filepath.Join(globalDir, "a.fbx"), "x")
	writeFile(t, filepath.Join(instDir, "a.fbx"), "x")   // synced
	writeFile(t, filepath.Join(globalDir, "b.fbx"), "x") // missing
	writeFile(t, filepath.Join(instDir, "c.fbx"), "x")   // extra

	ins := types.VersionInstance{Name: "t", VersionDir: instRoot, CustomDir: instDir}
	got := BuildInstanceStatusCounts(
		[]types.VersionInstance{ins},
		[]registry.ResourceType{{ID: "fbx", Icon: "🦴"}},
		map[string]string{"fbx": globalDir},
	)
	if len(got) != 1 {
		t.Fatalf("应返回 1 个实例状态，实际 %d", len(got))
	}
	st := got[0]
	if st.Synced != 1 || st.MissingCount != 1 {
		t.Fatalf("Synced/MissingCount 应为 1/1，实际 %d/%d", st.Synced, st.MissingCount)
	}
	if want := []string{filepath.Join(globalDir, "b.fbx")}; !reflect.DeepEqual(st.Missing, want) {
		t.Fatalf("Missing 应为 %v，实际 %v", want, st.Missing)
	}
	if want := []string{filepath.Join(instDir, "c.fbx")}; !reflect.DeepEqual(st.Extra, want) {
		t.Fatalf("Extra 应为 %v，实际 %v", want, st.Extra)
	}
	if st.Status != "missing" {
		t.Fatalf("Status 应为 missing，实际 %q", st.Status)
	}
}

// TestBuildInstanceStatusCounts_EmptyInputs 导出入口自守卫：无实例/无类型/根缺失都不 panic。
func TestBuildInstanceStatusCounts_EmptyInputs(t *testing.T) {
	if got := BuildInstanceStatusCounts(nil, nil, nil); len(got) != 0 {
		t.Fatalf("无实例应返回空，实际 %d", len(got))
	}
	ins := types.VersionInstance{Name: "t", VersionDir: t.TempDir()}
	// 无资源类型 → 该实例零计数、complete（与面板链空输入口径一致）
	got := BuildInstanceStatusCounts([]types.VersionInstance{ins}, nil, map[string]string{})
	if len(got) != 1 {
		t.Fatalf("应返回 1 个实例状态，实际 %d", len(got))
	}
	if got[0].Synced != 0 || got[0].MissingCount != 0 || got[0].Status != "complete" {
		t.Fatalf("空类型应零计数 complete，实际 %+v", got[0])
	}
}

// TestBuildInstanceStatusCounts_RepoBannedUnitIsDisabled 迁移自旧链
// TestGetInstanceStatus_BannedModelsSkipped：仓库侧 .ban 单元既不蒸发（旧 relKey 链剥后缀
// 会误计 synced）也不进待推送清单（否则一键安装会覆盖用户刻意禁用的内容）。
func TestBuildInstanceStatusCounts_RepoBannedUnitIsDisabled(t *testing.T) {
	sub := registry.SubDirMap("EntityPlayer")
	if sub == "" {
		t.Skip("EntityPlayer 无 instanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instRoot := filepath.Join(base, "inst")
	instDir := filepath.Join(instRoot, filepath.FromSlash(sub))

	writeFile(t, filepath.Join(globalDir, "m1", "model.pmx"), "x")
	writeFile(t, filepath.Join(instDir, "m1", "model.pmx"), "x")  // synced
	writeFile(t, filepath.Join(globalDir, "banned.pmx.ban"), "x") // 仓库侧禁用平铺单元

	ins := types.VersionInstance{Name: "t", VersionDir: instRoot, CustomDir: instDir}
	got := BuildInstanceStatusCounts(
		[]types.VersionInstance{ins},
		[]registry.ResourceType{{ID: "EntityPlayer", Icon: "🧍"}},
		map[string]string{"EntityPlayer": globalDir},
	)
	st := got[0]
	if st.Synced != 1 {
		t.Fatalf("Synced 应为 1（仅 m1），实际 %d（.ban 不得计入 synced）", st.Synced)
	}
	if st.MissingCount != 0 || len(st.Missing) != 0 {
		t.Fatalf("禁用单元不得进待推送：MissingCount=%d Missing=%v", st.MissingCount, st.Missing)
	}
	if want := []string{filepath.Join(globalDir, "banned.pmx.ban")}; !reflect.DeepEqual(sortedCopy(st.Disabled), want) {
		t.Fatalf("Disabled 应为 %v，实际 %v", want, st.Disabled)
	}
	if st.Status != "complete" {
		t.Fatalf("仅剩禁用项应判 complete（禁用非待推送差异），实际 %q", st.Status)
	}
	// 清单确定性：map 迭代序不得泄漏到输出（迁移自旧链 Missing 排序断言）
	if !sort.StringsAreSorted(st.Missing) || !sort.StringsAreSorted(st.Extra) || !sort.StringsAreSorted(st.Disabled) {
		t.Fatalf("三份清单必须有序输出：Missing=%v Extra=%v Disabled=%v", st.Missing, st.Extra, st.Disabled)
	}
}

// TestBuildInstanceStatusCounts_MissingListIsFileLevelOnly 清单必须恒为仓库侧**文件级**
// 路径——绝不吐目录。反例（子代理审计 D1/D2，均为真实可达形态）：
//   - D1 容器子位的 dirLevel 叶子夹 children 为空（maid-model 夹内 assets/**.json 不被
//     IsTypeModelFile 命中）→ 旧实现直接吐夹路径；该夹路径经 sync.ts → InstallResourceToInstance
//     对 isDir 类型会走 InstallDir(其父目录)，把**兄弟模型包整棵**装进实例（过度安装），
//     夹直接位于仓库根时则落到 installer.Install(目录) → 必判「不支持的文件类型」；
//   - D2 fileLevel 资源包夹（isDir=false）夹内只有 pack.mcmeta → 展开为空，同样不得吐目录。
//
// 计数照旧把该单元算 1（与面板可见行一致）；「单元 1 / 可装文件 0」是 ADR-310 §3
// 记明的粒度差，面板可单行推送（PushSingleResourceToInstance 支持文件夹），侧栏一键安装不负责。
func TestBuildInstanceStatusCounts_MissingListIsFileLevelOnly(t *testing.T) {
	assertNoDirEntries := func(t *testing.T, label string, paths []string) {
		t.Helper()
		for _, p := range paths {
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				t.Fatalf("%s：清单不得含目录路径，实际含 %s", label, p)
			}
		}
	}

	t.Run("D1 容器子位的空 children 叶子夹", func(t *testing.T) {
		sub := registry.SubDirMap("maid-model")
		if sub == "" {
			t.Skip("maid-model 无 instanceDir 配置，跳过")
		}
		base := t.TempDir()
		globalDir := filepath.Join(base, "global")
		instRoot := filepath.Join(base, "inst")
		// 仓库：中间目录 vendor 下的模型夹 packA（仅含 pack.mcmeta + 不被类型白名单命中的 json）
		writeFile(t, filepath.Join(globalDir, "vendor", "packA", "pack.mcmeta"), `{"pack":{"pack_format":15}}`)
		writeFile(t, filepath.Join(globalDir, "vendor", "packA", "assets", "ns", "maid_model.json"), `{}`)

		ins := types.VersionInstance{
			Name:       "t",
			VersionDir: instRoot,
			CustomDir:  filepath.Join(instRoot, filepath.FromSlash(sub)),
		}
		st := BuildInstanceStatusCounts(
			[]types.VersionInstance{ins},
			[]registry.ResourceType{{ID: "maid-model", Icon: "🧹"}},
			map[string]string{"maid-model": globalDir},
		)[0]
		if st.MissingCount == 0 {
			t.Fatalf("该夹应被面板链判为待推送单元，实际 MissingCount=0（状态 %q）", st.Status)
		}
		assertNoDirEntries(t, "D1", st.Missing)
		// 夹内文件（pack.mcmeta / assets/**.json）均不被 maid-model 类型白名单命中 →
		// 单元算 1、可装文件 0：ADR-310 §3 记明的粒度差（不是漏装——面板可单行推送该夹，
		// 一键安装走文件清单故确无可装项），旧实现此处的目录路径才是真缺陷
		if len(st.Missing) != 0 {
			t.Fatalf("夹内无可推送文件，清单应为空，实际 %v", st.Missing)
		}
	})

	t.Run("D2 资源包夹无可推送文件", func(t *testing.T) {
		sub := registry.SubDirMap("resourcepack")
		if sub == "" {
			t.Skip("resourcepack 无 instanceDir 配置，跳过")
		}
		base := t.TempDir()
		globalDir := filepath.Join(base, "global")
		instRoot := filepath.Join(base, "inst")
		writeFile(t, filepath.Join(globalDir, "rpA", "pack.mcmeta"), `{"pack":{"pack_format":15}}`)

		ins := types.VersionInstance{
			Name:       "t",
			VersionDir: instRoot,
			CustomDir:  filepath.Join(instRoot, filepath.FromSlash(sub)),
		}
		st := BuildInstanceStatusCounts(
			[]types.VersionInstance{ins},
			[]registry.ResourceType{{ID: "resourcepack", Icon: "🎨"}},
			map[string]string{"resourcepack": globalDir},
		)[0]
		if st.MissingCount != 1 {
			t.Fatalf("资源包夹缺失应计 1 个单元，实际 %d", st.MissingCount)
		}
		if st.Status != "missing" {
			t.Fatalf("Status 应为 missing，实际 %q", st.Status)
		}
		assertNoDirEntries(t, "D2", st.Missing)
		// pack.mcmeta 不是 resourcepack 的模型文件（白名单仅 .zip/.7z）、夹内无 zip →
		// 单元算 1、可装文件 0（同 D1：粒度差，不吐目录）
		if len(st.Missing) != 0 {
			t.Fatalf("夹内无可推送文件，清单应为空，实际 %v", st.Missing)
		}
	})
}

// TestBuildInstanceStatusCounts_ListDeduped 混合夹（自身含平铺模型文件 + 子夹）在面板链里
// 会把同一平铺文件重复列示两次（absorbSelfMarker 并入 + 独立叶子共存，见知识卡已知限制），
// 清单必须去重——否则一键安装对同一文件装两遍、条数与实际待装数不符。
func TestBuildInstanceStatusCounts_ListDeduped(t *testing.T) {
	sub := registry.SubDirMap("EntityPlayer")
	if sub == "" {
		t.Skip("EntityPlayer 无 instanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instRoot := filepath.Join(base, "inst")
	// 混合夹 A：自身平铺文件 flat.pmx + 子夹 B/deep.pmx，实例侧整夹缺失
	writeFile(t, filepath.Join(globalDir, "A", "flat.pmx"), "flat")
	writeFile(t, filepath.Join(globalDir, "A", "B", "deep.pmx"), "deep")

	ins := types.VersionInstance{
		Name:       "t",
		VersionDir: instRoot,
		CustomDir:  filepath.Join(instRoot, filepath.FromSlash(sub)),
	}
	st := BuildInstanceStatusCounts(
		[]types.VersionInstance{ins},
		[]registry.ResourceType{{ID: "EntityPlayer", Icon: "🧍"}},
		map[string]string{"EntityPlayer": globalDir},
	)[0]

	if st.MissingCount != 1 {
		t.Fatalf("整夹缺失应计 1 个单元，实际 %d", st.MissingCount)
	}
	seen := map[string]bool{}
	for _, p := range st.Missing {
		if seen[p] {
			t.Fatalf("清单重复条目 %s（全清单 %v）——会导致重复安装", p, st.Missing)
		}
		seen[p] = true
	}
	if len(st.Missing) == 0 {
		t.Fatal("两个平铺/子夹文件都缺失，清单不应为空")
	}
	if !sort.StringsAreSorted(st.Missing) {
		t.Fatalf("去重后仍须有序，实际 %v", st.Missing)
	}
	// 钉住上游 quirk 的存在性证据（证明本测试非空转）：面板链顶层容器子项里
	// flat.pmx 重复出现，侧栏清单去重后只剩一条
	raw := BuildSyncItems(&ins, []registry.ResourceType{{ID: "EntityPlayer", Icon: "🧍"}},
		map[string]string{"EntityPlayer": globalDir}, "")
	flat := filepath.Join(globalDir, "A", "flat.pmx")
	dup := 0
	for i := range raw {
		for j := range raw[i].Children {
			if raw[i].Children[j].Path == flat {
				dup++
			}
		}
	}
	t.Logf("面板链顶层单元 %d 个；flat.pmx 在子项出现 %d 次；侧栏清单 %v", len(raw), dup, st.Missing)
	if dup < 2 {
		t.Skipf("面板链本次未复现重复列示（dup=%d）——该回归防的是 absorbSelfMarker 混合夹形态，形态变化时此断言自然失效", dup)
	}
}

// sortedCopy 复制并排序，屏蔽实现内部排序策略差异
func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}
