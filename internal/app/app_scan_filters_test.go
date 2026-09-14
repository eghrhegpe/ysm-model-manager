package app

import (
	"testing"

	"ysm-model-manager/go/types"
)

// TestModelMatchesFilters 表驱动覆盖 modelMatchesFilters（SearchModels 的过滤核心，
// 纯函数不依赖 *App，是高级搜索/adv-filter 的数值范围判定单一事实源）。
func TestModelMatchesFilters(t *testing.T) {
	t.Parallel()
	mk := func(bones, cubes, w, h int) types.BedrockModel {
		return types.BedrockModel{BoneCount: bones, CubeCount: cubes, TexWidth: w, TexHeight: h}
	}
	cases := []struct {
		name                                   string
		model                                  types.BedrockModel
		minBones, maxBones, minCubes, maxCubes int
		minTex, maxTex                         int
		want                                   bool
	}{
		{"无过滤全通过", mk(3, 5, 64, 64), 0, 0, 0, 0, 0, 0, true},
		{"零骨骼直接拒", mk(0, 1, 64, 64), 0, 0, 0, 0, 0, 0, false},
		{"minBones 卡下限", mk(2, 5, 64, 64), 3, 0, 0, 0, 0, 0, false},
		{"minBones 边界等于通过", mk(3, 5, 64, 64), 3, 0, 0, 0, 0, 0, true},
		{"maxBones 卡上限", mk(10, 5, 64, 64), 0, 8, 0, 0, 0, 0, false},
		{"maxBones 边界等于通过", mk(8, 5, 64, 64), 0, 8, 0, 0, 0, 0, true},
		{"minCubes 卡下限", mk(3, 4, 64, 64), 0, 0, 5, 0, 0, 0, false},
		{"maxCubes 卡上限", mk(3, 9, 64, 64), 0, 0, 0, 8, 0, 0, false},
		{"minTex 看宽高任一不足", mk(3, 5, 32, 64), 0, 0, 0, 0, 64, 0, false},
		{"minTex 宽高都达标", mk(3, 5, 64, 64), 0, 0, 0, 0, 64, 0, true},
		{"maxTex 看宽高任一超", mk(3, 5, 128, 64), 0, 0, 0, 0, 0, 64, false},
		{"maxTex 宽高都不超", mk(3, 5, 64, 64), 0, 0, 0, 0, 0, 64, true},
		{"组合区间命中", mk(5, 8, 128, 128), 3, 10, 5, 12, 64, 256, true},
		{"组合区间骨骼越界", mk(1, 8, 128, 128), 3, 10, 5, 12, 64, 256, false},
		{"maxTex=-? 0 不约束", mk(3, 5, 9999, 9999), 0, 0, 0, 0, 0, 0, true},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := modelMatchesFilters(c.model, c.minBones, c.maxBones, c.minCubes, c.maxCubes, c.minTex, c.maxTex)
			if got != c.want {
				t.Errorf("modelMatchesFilters = %v, want %v (model=%+v)", got, c.want, c.model)
			}
		})
	}
}

// TestAllScanRoots 验证 allScanRoots 汇聚所有扫描/移动校验根（FilesRoot + McRoot +
// 6 专属根 + CustomRoots），且不纳入空串（避免脏根进入守卫）。
func TestAllScanRoots(t *testing.T) {
	t.Parallel()
	cfg := types.AppConfig{
		FilesRoot:        "/files",
		McRoot:           "/mc",
		ResourcepackRoot: "/rp",
		ShaderpackRoot:   "/sp",
		SchematicRoot:    "/sch",
		LitematicRoot:    "/lit",
		MmdRoot:          "/mmd",
		VrcRoot:          "/vrc",
		CustomRoots:      map[string]string{"a": "/custom1", "b": "", "c": "/custom2"},
	}
	roots := allScanRoots(cfg)
	// 8 固定根 + 2 有效 CustomRoots = 10；空串 CustomRoot 必须被丢弃。
	if len(roots) != 10 {
		t.Fatalf("期望 10 个根, got %d: %v", len(roots), roots)
	}
	want := map[string]bool{
		"/files": true, "/mc": true, "/rp": true, "/sp": true, "/sch": true,
		"/lit": true, "/mmd": true, "/vrc": true, "/custom1": true, "/custom2": true,
	}
	for _, r := range roots {
		if !want[r] {
			t.Errorf("意外根: %s（全量=%v）", r, roots)
		}
	}
}
