package geometry

import (
	"testing"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/internal/testutil"
)

// ===== 2026-08-26 审查修复专项：确定性/口径统一行为锁 =====

// resolveComponentTexName 前缀兜底多命中（_1/_2/_3 多合一包）必须确定性：
// Go map 迭代序随机，直接 for-range 首个命中会让同一输入不同运行绑到不同纹理
// （parse.go geometry.* 键选取同类问题已修，此处为漏网点）。
// 修复口径：候选收集后 sort.Strings 取字典序最小（= _1 第一张）。
func TestResolveComponentTexName_PrefixFallback_Deterministic(t *testing.T) {
	pngNameMap := map[string]int{
		"asuma_toki_3": 2,
		"asuma_toki_1": 0,
		"asuma_toki_2": 1,
	}
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		got := resolveComponentTexName("asuma_toki", "models/entity/asuma_toki.json", nil, pngNameMap, false)
		if got == "" {
			t.Fatalf("第 %d 次迭代前缀兜底未命中", i)
		}
		seen[got] = true
	}
	if len(seen) != 1 {
		t.Fatalf("前缀兜底多命中不确定: 50 次迭代出现 %v", seen)
	}
	if got := resolveComponentTexName("asuma_toki", "", nil, pngNameMap, false); got != "asuma_toki_1" {
		t.Errorf("应取字典序最小 asuma_toki_1, 实际 %q", got)
	}
}

// detectMaidNs 与 collectMaidManifest 必须同口径（"最长清单即主包"）：
// 多命名空间包组件视图与合并预览选中的 ns 分叉会让两侧过滤结果不一致。
// 构造：ns_a 清单 1 条在前、ns_b 清单 3 条在后 → 都应选 ns_b。
func TestDetectMaidNs_MatchesLongestManifestHeuristic(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		"credits/ns_a/maid_model.json": `{"model":[{"name":"a1","model_id":"a1"}]}`,
		"main/ns_b/maid_model.json":    `{"model_list":[{"name":"b1","model_id":"b1"},{"name":"b2","model_id":"b2"},{"name":"b3","model_id":"b3"}]}`,
	})
	r, err := container.OpenZipBytes(data, int64(len(data)))
	testutil.NoError(t, err)
	defer r.Close()
	entries := r.Entries()

	wantMerged, manifest := collectMaidManifest(entries, "")
	if wantMerged != "main/ns_b/" || len(manifest) != 3 {
		t.Fatalf("前置失效: collectMaidManifest = %q, %d 条", wantMerged, len(manifest))
	}
	if got := detectMaidNs(entries); got != wantMerged {
		t.Errorf("detectMaidNs = %q, 应与 collectMaidManifest 同口径 %q（最长清单即主包）", got, wantMerged)
	}
}

// 组件路径声明序排序键必须大小写不敏感（对齐合并版 sortByModelOrder 双侧 ToLower）：
// Windows 工具产出的混合大小写 zip 条目名未归一化会让声明序静默失效、退化为字典序。
func TestSortGeoFilesMainFirst_CaseInsensitiveOrderMap(t *testing.T) {
	modelOrder := []string{"models/wolf.json", "models/entity/fox.json"}
	geoFiles := []geoEntry{
		{name: "Models/Entity/Fox.JSON"},
		{name: "Models/Wolf.JSON"},
	}
	orderMap, _ := buildOrderAndPngIndex(modelOrder, nil)
	sortGeoFilesMainFirst(geoFiles, orderMap, modelOrder)
	if geoFiles[0].name != "Models/Wolf.JSON" {
		t.Errorf("wolf 声明序在前应排首, 实际 %v", []string{geoFiles[0].name, geoFiles[1].name})
	}
}
