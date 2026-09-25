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

// sortedCopy 复制并排序，屏蔽实现内部排序策略差异
func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}
