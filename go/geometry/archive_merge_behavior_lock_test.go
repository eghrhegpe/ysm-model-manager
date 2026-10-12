// ===== 合并解析（⑥ bones merge / ⑦ L1 SubModels 兜底）白盒行为锁定测试 =====
// 现有分支测试（archive_branch_test.go）走公开 ParseFromZip 黑盒，已锁合并序/TexSlot 绑定
// 与最大纹理尺寸；本文件补充两个黑盒摸不到的中间产物锚点，供「⑥⑦ 阶段子域收编」重构
// 前必须保持逐字节/逐值不变的判定锚点：
//
//	⑥ 每个 cube 的 CubeTexW/H 取「各自源文件」的 texture 尺寸（非合并后最大值）
//	   → 合并只让 geo.TexWidth/TexHeight 取最大，cube 级仍保留源口径。
//	⑦ L1 兜底 SubModel 的 TexSlot 必须钳制在 pngs 长度范围内（防越界槽位）。
package geometry

import (
	"strconv"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// mergeGeo 返回单骨骼单方块的合法 geometry，texture_width/height 可自定义、cube.texture=i
// （CubeTexW/H 依源文件锁定；TexSlot 绑定走 texIdxMap，此 helper 不依赖 bundle 声明）。
func mergeGeo(id string, texW, texH, cubeTex int) string {
	tpl := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"__ID__","texture_width":__W__,"texture_height":__H__},"bones":[{"name":"__ID__","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0],"texture":__TEX__}]}]}]}`
	s := strings.ReplaceAll(tpl, "__ID__", id)
	s = strings.ReplaceAll(s, "__W__", strconv.Itoa(texW))
	s = strings.ReplaceAll(s, "__H__", strconv.Itoa(texH))
	s = strings.ReplaceAll(s, "__TEX__", strconv.Itoa(cubeTex))
	return s
}

// TestMergeBehavior_CubeTexDimsFromOwnFileMaxTexSize：多文件合并时，
// 每个 cube 的 CubeTexW/H 记录各自源文件尺寸（a=64×32、b=128×64），
// geo 级 TexWidth/TexHeight 取最大（128×64）。重构搬 ⑥ 时不得把 cube 级
// 口径"顺手统一"成合并最大，否则行为变。
func TestMergeBehavior_CubeTexDimsFromOwnFileMaxTexSize(t *testing.T) {
	entries := openZipEntries(t, map[string]string{
		"models/a.geo.json": mergeGeo("boneA", 64, 32, 0),
		"models/b.geo.json": mergeGeo("boneB", 128, 64, 1),
	})
	geo, _, _, _ := parseModelFromEntries(entries, "zip")
	testutil.NotNil(t, geo, "模型不应为 nil")
	// geo 级尺寸取最大
	if geo.TexWidth != 128 || geo.TexHeight != 64 {
		t.Fatalf("geo TexWidth/Height = %d×%d, 期望 128×64（取最大）", geo.TexWidth, geo.TexHeight)
	}
	// cube 级尺寸保留各自源文件口径
	if len(geo.Bones) != 2 {
		t.Fatalf("BoneCount = %d, 期望 2", len(geo.Bones))
	}
	want := map[string][2]int{"boneA": {64, 32}, "boneB": {128, 64}}
	for _, b := range geo.Bones {
		dim, ok := want[b.Name]
		if !ok {
			t.Fatalf("出现未预料的骨骼 %q", b.Name)
		}
		if len(b.Cubes) != 1 {
			t.Fatalf("骨骼 %s cubes = %d, 期望 1", b.Name, len(b.Cubes))
		}
		c := b.Cubes[0]
		if c.CubeTexW != dim[0] || c.CubeTexH != dim[1] {
			t.Errorf("骨骼 %s cube CubeTexW/H = %d×%d, 期望 %d×%d（依源文件）",
				b.Name, c.CubeTexW, c.CubeTexH, dim[0], dim[1])
		}
	}
}

// TestMergeBehavior_L1SubModelTexSlotClampedToPngs：无 L0 清单时走 L1 兜底，
// SubModel.TexSlot 按 geoFiles 序号取，但必须钳制在 pngs 长度范围内（geo 文件多于
// 纹理时，越界槽位压到 len(pngs)-1）。3 geo + 1 png → 全部槽位钳到 0。
func TestMergeBehavior_L1SubModelTexSlotClampedToPngs(t *testing.T) {
	entries := openZipEntries(t, map[string]string{
		"models/a.geo.json": mergeGeo("boneA", 32, 32, 0),
		"models/b.geo.json": mergeGeo("boneB", 32, 32, 0),
		"models/c.geo.json": mergeGeo("boneC", 32, 32, 0),
		"textures/skin.png": "SKIN",
	})
	pngsCount := 1
	geo, pngs, _, _ := parseModelFromEntries(entries, "zip")
	testutil.NotNil(t, geo, "模型不应为 nil")
	if len(pngs) != pngsCount {
		t.Fatalf("pngs = %d, 期望 %d", len(pngs), pngsCount)
	}
	if len(geo.SubModels) != 3 {
		t.Fatalf("SubModels = %d, 期望 3（L1 兜底派生自 3 个 geo 文件）", len(geo.SubModels))
	}
	for i, sm := range geo.SubModels {
		if sm.TexSlot != 0 {
			t.Errorf("SubModels[%d].TexSlot = %d, 期望 0（3 geo 1 png，全部钳到 len(pngs)-1）",
				i, sm.TexSlot)
		}
	}
}
