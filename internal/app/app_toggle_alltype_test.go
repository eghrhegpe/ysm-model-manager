package app

import (
	"testing"

	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// ADR-339：启禁同步目标 = 所有 dirLevelSync 类型（ysm/mmd 各子目录/maid/blueprint/litematic），
// 排除 resourcepack/shaderpack/fbx（游戏用 config 列表启停、不认 .disabled，同步无意义）。
// 判据单一事实源 = registry.IsDirLevelSync（resource_types.json 派生），测试按「按标志过滤」的
// 行为不变量断言，不手写类型清单快照（清单随注册表演化）。

func TestToggleSyncTargets_All(t *testing.T) {
	targets := toggleSyncTargets("")
	testutil.Equal(t, len(targets) == 0, false, `toggleSyncTargets("") 应为非空（至少含 ysm）`)
	byId := map[string]bool{}
	for _, d := range targets {
		byId[d.RType] = true
		if !registry.IsDirLevelSync(d.RType) {
			t.Errorf("目标含非 dirLevelSync 类型 %q（应排除）", d.RType)
		}
	}
	if !byId["ysm"] {
		t.Error("ysm（dirLevelSync）应在启禁同步目标内")
	}
	// 非 dirLevelSync 类型必不在（resourcepack/shaderpack 恒为 false）
	for _, rt := range []string{"resourcepack", "shaderpack"} {
		if byId[rt] {
			t.Errorf("%s（非 dirLevelSync）不应在启禁同步目标内", rt)
		}
	}
	// 全集 = 注册表里所有 dirLevelSync 类型（按 IsDirLevelSync 判据，不写死清单）
	want := map[string]bool{}
	for _, d := range registry.AllSubDirs() {
		if registry.IsDirLevelSync(d.RType) {
			want[d.RType] = true
		}
	}
	if len(byId) != len(want) {
		t.Errorf("目标集合大小 %d != 期望 dirLevelSync 全集 %d（got=%v want=%v）",
			len(byId), len(want), keys(byId), keys(want))
	}
}

func TestToggleSyncTargets_Single(t *testing.T) {
	if ts := toggleSyncTargets("ysm"); len(ts) != 1 || ts[0].RType != "ysm" {
		t.Errorf(`toggleSyncTargets("ysm") = %v, 期望 [ysm]`, ts)
	}
	// 非 dirLevelSync 类型 → 空（同步过去无意义）
	if ts := toggleSyncTargets("resourcepack"); len(ts) != 0 {
		t.Errorf(`toggleSyncTargets("resourcepack") = %v, 期望空`, ts)
	}
	// 未知类型 → 空
	if ts := toggleSyncTargets("__nope__"); len(ts) != 0 {
		t.Errorf(`toggleSyncTargets("__nope__") = %v, 期望空`, ts)
	}
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
