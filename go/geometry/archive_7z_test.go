// ===== ParseFrom7z / ParseComponentsFrom7z / ExtractFirstPNGFrom7z 全路径测试 =====
// 7z 样本由 7-Zip CLI（-mx=0 Copy 存储模式）预生成在 testdata/ 下，保证确定性：
//   - 7z_full.7z   ：ysm.json(model 数组 + texture 数组) + main/arm/arrow/broken 几何
//   - tex_a/tex_b/arrow 纹理 + animations_idle.json + avatar/face.png
//   - 7z_map.7z    ：model map 格式 + texture 对象数组
//   - 7z_str.7z    ：model/texture 单字符串格式
//   - 7z_noym.7z   ：无 ysm.json（含 tex1.png + main.geo.json）
//
// 注：sevenzip 为只读库（无 Writer），无法在测试内构造 7z，故用预生成夹具。
package geometry

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// load7zFixture 读取 testdata 下预生成的 7z 夹具字节
func load7zFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", name))
	testutil.NoError(t, err, "读取 7z 夹具 %s 失败", name)
	return data
}

func TestParseFrom7z_Full(t *testing.T) {
	// 完整路径：ysm.json 数组格式 + main/arm/arrow/broken 几何 + 3 纹理 + 动画 + avatar
	data := load7zFixture(t, "7z_full.7z")
	model, pngs := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "模型应为非 nil")
	// arm.geo.json 被排除（第一人称手臂），broken.geo.json 解析失败跳过 → main(head)+arrow
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（head+arrow，arm 排除、broken 跳过）", model.BoneCount)
	}
	if model.CubeCount != 2 {
		t.Errorf("CubeCount = %d, 期望 2", model.CubeCount)
	}
	// 合并取最大纹理尺寸：main 64 < arrow 128
	if model.TexWidth != 128 {
		t.Errorf("TexWidth = %d, 期望 128（多模型合并取最大）", model.TexWidth)
	}
	// 动画 JSON 不应产生骨骼
	for _, b := range model.Bones {
		if b.Name == "animations" || strings.Contains(b.Name, "idle") {
			t.Errorf("动画 JSON 不应参与骨骼解析: %q", b.Name)
		}
	}
	// 纹理：tex_a/tex_b 按声明序 + arrow 未声明落尾；avatar/ 下 PNG 被排除
	// 守卫下方 TextureNames[i] 循环索引
	testutil.Equal(t, len(pngs), 3, "pngs = %d, 期望 3（avatar/ 排除、动画非图）", len(pngs))
	wantNames := []string{"tex_a", "tex_b", "arrow"}
	for i, want := range wantNames {
		if model.TextureNames[i] != want {
			t.Errorf("TextureNames[%d] = %q, 期望 %q", i, model.TextureNames[i], want)
		}
	}
	// main 的 cube TexSlot 应绑定到 tex_a（声明序 0）
	for _, b := range model.Bones {
		for _, c := range b.Cubes {
			if c.TexSlot != 0 && b.Name != "arrow" {
				t.Errorf("骨骼 %s cube TexSlot = %d, 期望 0", b.Name, c.TexSlot)
			}
		}
	}
}

func TestParseFrom7z_ArmExcluded(t *testing.T) {
	// 7z 合并路径同样排除第一人称手臂模型（与 ZIP 路径口径一致）
	data := load7zFixture(t, "7z_full.7z")
	model, _ := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "模型应为非 nil")
	for _, b := range model.Bones {
		if b.Name == "arm" {
			t.Errorf("arm 骨骼不应出现在 7z 合并结果中（第一人称手臂须排除）")
		}
	}
}

func TestParseFrom7z_NoYsm(t *testing.T) {
	// 无 ysm.json：无 modelOrder 声明，几何文件仍回退解析（ZIP 路径同口径）
	data := load7zFixture(t, "7z_noym.7z")
	model, pngs := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "无 ysm.json 时模型仍应从几何文件回退解析")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
	if len(model.TextureNames) != 1 || model.TextureNames[0] != "tex1" {
		t.Errorf("TextureNames = %v, 期望 [tex1]", model.TextureNames)
	}
}

func TestParseFrom7z_ModelAsMap(t *testing.T) {
	// model map 格式 + texture 对象数组（uv 字段）：声明序即纹理槽
	data := load7zFixture(t, "7z_map.7z")
	model, pngs := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "模型应为非 nil")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
	if len(model.TextureNames) != 1 || model.TextureNames[0] != "tex1" {
		t.Errorf("TextureNames = %v, 期望 [tex1]（uv 对象 basename 去扩展名）", model.TextureNames)
	}
}

func TestParseFrom7z_ModelAsString(t *testing.T) {
	// model/texture 单字符串格式（字符串 texture 不参与声明序）
	data := load7zFixture(t, "7z_str.7z")
	model, pngs := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "模型应为非 nil")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
}

func TestExtractFirstPNGFrom7z_Valid(t *testing.T) {
	// 有效 7z → 提取到第一张 PNG（夹具含 3 张合法 PNG + avatar/ 下 1 张）
	data := load7zFixture(t, "7z_full.7z")
	got := ExtractFirstPNGFrom7z(data, int64(len(data)))
	testutil.Equal(t, len(got) == 0, false, "应提取到 PNG 数据, 得到空")
	if !strings.HasPrefix(string(got), "\x89PNG") {
		t.Errorf("提取数据应含 PNG 魔数, got %q", got[:8])
	}
}

func TestParseComponentsFrom7z_Full(t *testing.T) {
	// 组件路径：含 arm（独立组件）、main 优先、TexSlot 全局化、texNames R1 契约
	data := load7zFixture(t, "7z_full.7z")
	comps, texNames, err := ParseComponentsFrom7z(data, int64(len(data)))
	testutil.NoError(t, err, "ParseComponentsFrom7z 失败")
	// 守卫下方 comps[0..2] 与 texNames[i] 索引
	testutil.Equal(t, len(comps), 3, "组件数 = %d, 期望 3（main/arm/arrow，broken 解析失败跳过）", len(comps))
	testutil.Equal(t, len(texNames), 3, "texNames = %d, 期望 3", len(texNames))
	// main 优先：组件 0 为 head（main），组件 1 为 arm
	if got := comps[0].Bones[0].Name; got != "head" {
		t.Errorf("组件 0 应为 main(head), 得到 %s", got)
	}
	if got := comps[1].Bones[0].Name; got != "arm" {
		t.Errorf("组件 1 应为 arm, 得到 %s", got)
	}
	if got := comps[2].Bones[0].Name; got != "arrow" {
		t.Errorf("组件 2 应为 arrow, 得到 %s", got)
	}
	// texNames：声明组件用声明序纹理名（去扩展名），未声明组件用 basename
	// arm 与 main 共用同一套 player.texture 皮肤（ModernYSM 权威）：
	// arm 的 texNames 置空、ComponentTextures 为空，前端走全局 texArr[0]。
	wantNames := []string{"tex_a", "", "arrow"}
	for i, want := range wantNames {
		if texNames[i] != want {
			t.Errorf("texNames[%d] = %q, 期望 %q", i, texNames[i], want)
		}
	}
	// ADR-114 perComponent：每组件 cube.TexSlot=0（用自己的第 0 张纹理）
	wantSlots := []int{0, 0, 0}
	for i, comp := range comps {
		slot := comp.Bones[0].Cubes[0].TexSlot
		if slot != wantSlots[i] {
			t.Errorf("组件 %d texSlot = %d, 期望 %d", i, slot, wantSlots[i])
		}
		if comp.Bones[0].Cubes[0].CubeTexW == 0 {
			t.Errorf("组件 %d CubeTexW 未设置", i)
		}
	}
}

func TestParseComponentsFrom7z_MapModel(t *testing.T) {
	// map 格式 + 对象纹理：main 声明 → texSlot 0、texNames 去扩展名
	data := load7zFixture(t, "7z_map.7z")
	comps, texNames, err := ParseComponentsFrom7z(data, int64(len(data)))
	testutil.NoError(t, err, "ParseComponentsFrom7z 失败")
	// 守卫下方 comps[0] 索引
	testutil.Equal(t, len(comps), 1, "组件数 = %d, 期望 1（missing.geo.json 未存在于归档中）", len(comps))
	if len(texNames) != 1 || texNames[0] != "tex1" {
		t.Errorf("texNames = %v, 期望 [tex1]", texNames)
	}
	if slot := comps[0].Bones[0].Cubes[0].TexSlot; slot != 0 {
		t.Errorf("texSlot = %d, 期望 0（main 声明序 0）", slot)
	}
}

func TestParseFrom7z_ModelObjects(t *testing.T) {
	// 7z_obj 夹具：model 对象数组（path + name 回退）+ 子目录几何/纹理 + 混合分隔符纹理声明。
	// 覆盖：model 对象分支、texIdxMap basename 剥离（含 "/"）、geoName "/" 剥离、
	// 纹理声明序排序、TexSlot 钳制（模型数 > 纹理声明数）
	data := load7zFixture(t, "7z_obj.7z")
	model, pngs := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "模型应为非 nil")
	// sub/main.geo.json + sub/extra.geo.json（third 未存在于归档中）
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（main+extra）", model.BoneCount)
	}
	// 纹理：sub/tex1.png（字符串 "/"）+ tex2.png（对象 "\\"）→ 按声明序
	// 守卫下方 TextureNames[i] 循环索引
	testutil.Equal(t, len(pngs), 2, "pngs = %d, 期望 2", len(pngs))
	wantNames := []string{"tex1", "tex2"}
	for i, want := range wantNames {
		if model.TextureNames[i] != want {
			t.Errorf("TextureNames[%d] = %q, 期望 %q", i, model.TextureNames[i], want)
		}
	}
	// 子目录几何 basename 命中 texIdxMap：main → 0（tex1），extra → 1（tex2）
	for _, b := range model.Bones {
		want := 0
		if b.Name == "extra" {
			want = 1
		}
		for _, c := range b.Cubes {
			if c.TexSlot != want {
				t.Errorf("骨骼 %s cube TexSlot = %d, 期望 %d（子目录几何声明命中）", b.Name, c.TexSlot, want)
			}
		}
	}
}

func TestParseFrom7z_ModelMapBadValue(t *testing.T) {
	// model map 值为非字符串（123）→ Decoder 中途失败 break，不崩溃、几何回退解析
	data := load7zFixture(t, "7z_badmap.7z")
	model, pngs := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "model map 值类型错误时模型仍应回退解析")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
}

func TestParseFrom7z_InvalidYsm(t *testing.T) {
	// ysm.json 内容非法 → 声明解析失败，几何仍回退解析（与 ZIP 路径同口径）
	data := load7zFixture(t, "7z_invalid.7z")
	model, pngs := ParseFrom7z(data, int64(len(data)))
	testutil.NotNil(t, model, "ysm.json 非法时模型仍应从几何文件回退解析")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 0 {
		t.Errorf("pngs = %d, 期望 0（夹具无纹理）", len(pngs))
	}
}

func TestParseComponentsFrom7z_ModelObjects(t *testing.T) {
	// 组件路径 + 对象数组 model + 子目录几何：texSlot 按声明序、texNames R1 契约
	data := load7zFixture(t, "7z_obj.7z")
	comps, texNames, err := ParseComponentsFrom7z(data, int64(len(data)))
	testutil.NoError(t, err, "ParseComponentsFrom7z 失败")
	// 守卫下方 comps[0]/[1] 与 texNames[i] 索引
	testutil.Equal(t, len(comps), 2, "组件数 = %d, 期望 2（main+extra；third 未存在于归档中）", len(comps))
	wantNames := []string{"tex1", "tex2"}
	for i, want := range wantNames {
		if texNames[i] != want {
			t.Errorf("texNames[%d] = %q, 期望 %q", i, texNames[i], want)
		}
	}
	// ADR-114 perComponent：每组件 cube.TexSlot=0（用自己的第 0 张纹理）
	if slot := comps[0].Bones[0].Cubes[0].TexSlot; slot != 0 {
		t.Errorf("组件 0 texSlot = %d, 期望 0（perComponent）", slot)
	}
	if slot := comps[1].Bones[0].Cubes[0].TexSlot; slot != 0 {
		t.Errorf("组件 1 texSlot = %d, 期望 0（perComponent）", slot)
	}
}

func TestExtractFirstPNGFrom7z_NoPng(t *testing.T) {
	// 有效 7z 但无 PNG（7z_invalid 夹具：仅 ysm.json + main.geo.json）→ nil
	data := load7zFixture(t, "7z_invalid.7z")
	testutil.Nil(t, ExtractFirstPNGFrom7z(data, int64(len(data))), "无 PNG 的 7z 应返回 nil")
}
