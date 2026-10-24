// ===== FindGeometryInExtractedYSM 分支补测（extracted.go:50）=====
// 对齐 extracted_test.go（arm 排除）与 extracted_fixture_test.go（目录式 fixture）
// 的构造方式：t.TempDir 内自建 ysm.json + 模型文件。覆盖：缺 ysm.json、
// player.model 三种格式（map/数组/字符串）、纹理声明序、textures/ 与同目录纹理、
// 多层兜底（ysm.json 自带几何 / minecraft.geometry 包裹 / 裸几何元素 / WalkDir 递归）、
// 路径穿越防护、多模型合并 TexSlot 赋值。
package ysm

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/internal/testutil"
)

// writeExtractedFixture 在 t.TempDir 下按 rel 路径写文件（自动建父目录），
// 返回 ysm.json 完整路径。files 的 key 为相对路径（正斜杠），value 为内容。
func writeExtractedFixture(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for rel, content := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			testutil.NoError(t, err)
		}
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			testutil.NoError(t, err)
		}
	}
	return filepath.Join(dir, "ysm.json")
}

// geometryJSON 构造单骨骼有效几何 JSON（ParseBedrockGeometry 可解析）
func geometryJSON(name string) string {
	return `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"` +
		name + `","texture_width":64,"texture_height":32},"bones":[{"name":"` + name +
		`","cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`
}

func TestFindGeometryInExtractedYSM_MissingYsmJson(t *testing.T) {
	// ysm.json 不存在 → readFileLimited 返回 nil → (nil, nil)
	model, tex := FindGeometryInExtractedYSM(filepath.Join(t.TempDir(), "ysm.json"))
	if model != nil || tex != nil {
		t.Errorf("缺失 ysm.json 应返回 nil,nil, 得到 %v, %v", model, tex)
	}
}

func TestFindGeometryInExtractedYSM_ModelMapExcludesArm(t *testing.T) {
	// player.model map 格式：main 优先 + arm 排除（第一人称手臂不合并）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":{"main":"models/main.geo.json","arm":"models/arm.geo.json"}}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"models/arm.geo.json":  geometryJSON("arm"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	testutil.NotNil(t, model, "模型应为非 nil")
	if len(model.Bones) != 1 || model.Bones[0].Name != "main" {
		t.Errorf("应仅合并 main 骨骼, 得到 %d 根", len(model.Bones))
	}
	// 合并时 TexSlot=0、CubeTexW/H 写入（extracted.go:211-215）
	c := model.Bones[0].Cubes[0]
	if c.TexSlot != 0 || c.CubeTexW != 64 || c.CubeTexH != 32 {
		t.Errorf("main cube 应 TexSlot=0 64x32, 得到 slot=%d %dx%d", c.TexSlot, c.CubeTexW, c.CubeTexH)
	}
}

func TestFindGeometryInExtractedYSM_ModelArrayAllLoaded(t *testing.T) {
	// player.model 数组格式：按声明序加载全部模型（arm 排除按名）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":              `{"files":{"player":{"model":["models/main.geo.json","models/extra.geo.json"],"texture":["tex_a.png","tex_b.png"]}}}`,
		"models/main.geo.json":  geometryJSON("main"),
		"models/extra.geo.json": geometryJSON("extra"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	testutil.NotNil(t, model, "模型应为非 nil")
	// 守卫下方 Bones[0]/Bones[1] 索引（Equal 失败即 Goexit，短路语义保持）
	testutil.Equal(t, len(model.Bones), 2, "应合并 2 根骨骼, 实际 %d", len(model.Bones))
	// 纹理声明 2 项 → maxTexIdx=1：main TexSlot=0、extra TexSlot=1
	if c := model.Bones[0].Cubes[0]; c.TexSlot != 0 {
		t.Errorf("main cube TexSlot = %d, 期望 0", c.TexSlot)
	}
	if c := model.Bones[1].Cubes[0]; c.TexSlot != 1 {
		t.Errorf("extra cube TexSlot = %d, 期望 1", c.TexSlot)
	}
}

func TestFindGeometryInExtractedYSM_ModelStringFormat(t *testing.T) {
	// player.model 单字符串格式
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":"models/main.geo.json"}}}`,
		"models/main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原条件 `model == nil || len != 1` 拆序贯（NotNil 先行保证下方索引安全）
	testutil.NotNil(t, model, "字符串格式应加载 main, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "字符串格式应加载 main, 实际 %d 根骨骼", len(model.Bones))
}

func TestFindGeometryInExtractedYSM_TextureOrderFromYsm(t *testing.T) {
	// player.texture 数组（字符串 + {"uv":...} 对象混合）：texData 与 TextureNames
	// 按 ysm.json 声明序排序，uv 路径去目录取 basename
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":["models/main.geo.json"],"texture":[{"uv":"textures/a.png"},"b.jpg"]}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"textures/a.png":       "PNGDATA-A",
		"textures/b.jpg":       "JPEGDATA-B",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	testutil.NotNil(t, model, "模型应为非 nil")
	// 守卫下方 texData[0]/[1] 索引
	testutil.Equal(t, len(texData), 2, "texData = %d, 期望 2", len(texData))
	if string(texData[0]) != "PNGDATA-A" || string(texData[1]) != "JPEGDATA-B" {
		t.Errorf("texData 应按声明序 [a.png, b.jpg]")
	}
	// TextureNames 去扩展名
	if len(model.TextureNames) != 2 || model.TextureNames[0] != "a" || model.TextureNames[1] != "b" {
		t.Errorf("TextureNames = %v, 期望 [a b]", model.TextureNames)
	}
}

func TestFindGeometryInExtractedYSM_TextureTgaInTexturesDir(t *testing.T) {
	// textures/ 递归遍历含 .tga；声明序 [tex_b.png, tex_a.tga] → 排序后 tex_b 在前
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":["models/main.geo.json"],"texture":["tex_b.png","tex_a.tga"]}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"textures/tex_a.tga":   "TGADATA",
		"textures/tex_b.png":   "PNGDATA-B",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	// 原条件拆序贯；len 守卫下方 texData[0]/[1] 索引
	testutil.NotNil(t, model, "textures/ 下 png+tga 应解析出模型, 实际 %v", model)
	testutil.Equal(t, len(texData), 2, "textures/ 下 png+tga 应读 2 张, 实际 %d", len(texData))
	if string(texData[0]) != "PNGDATA-B" || string(texData[1]) != "TGADATA" {
		t.Errorf("纹理应按声明序 [tex_b.png, tex_a.tga]")
	}
	if len(model.TextureNames) != 2 || model.TextureNames[0] != "tex_b" || model.TextureNames[1] != "tex_a" {
		t.Errorf("TextureNames = %v, 期望 [tex_b tex_a]", model.TextureNames)
	}
}

func TestFindGeometryInExtractedYSM_TextureSameDir(t *testing.T) {
	// 无 textures/ 目录 → 兜底扫描 ysm.json 同目录 png/jpg（.tga 不入同目录段）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":      `{"files":{"player":{"model":"main.geo.json","texture":["tex_b.jpg","tex_a.png"]}}}`,
		"main.geo.json": geometryJSON("main"),
		"tex_a.png":     "PNGDATA-A",
		"tex_b.jpg":     "JPEGDATA-B",
		"ignore.tga":    "TGADATA",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	testutil.NotNil(t, model, "模型应为非 nil")
	// 守卫下方 texData[0]/[1] 索引
	testutil.Equal(t, len(texData), 2, "同目录纹理应读 2 张（tga 不入同目录段）, 实际 %d", len(texData))
	if string(texData[0]) != "JPEGDATA-B" || string(texData[1]) != "PNGDATA-A" {
		t.Errorf("纹理应按声明序 [tex_b.jpg, tex_a.png]")
	}
}

func TestFindGeometryInExtractedYSM_GeometryInYsmJson(t *testing.T) {
	// 模型文件缺失 → 兜底解析 ysm.json 自身（含 minecraft:geometry）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": geometryJSON("embedded"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原复合条件拆序贯（NotNil 先行保证 Bones[0] 索引安全）
	testutil.NotNil(t, model, "应兜底解析 ysm.json 内嵌几何, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "应兜底解析 ysm.json 内嵌几何, 实际 %d 根", len(model.Bones))
	testutil.Equal(t, model.Bones[0].Name, "embedded", "应兜底解析 ysm.json 内嵌几何")
}

func TestFindGeometryInExtractedYSM_MinecraftGeometryWrapper(t *testing.T) {
	// 兜底 2：ysm.json 含 minecraft: {geometry:[...]} 包裹 → 包裹后解析
	elem := `{"description":{"identifier":"wrapped","texture_width":32,"texture_height":32},"bones":[{"name":"wbone","cubes":[]}]}`
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": `{"minecraft":{"geometry":[` + elem + `]}}`,
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原复合条件拆序贯
	testutil.NotNil(t, model, "minecraft.geometry 包裹兜底应解析出模型, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "minecraft.geometry 包裹兜底应解析出 1 根骨骼, 实际 %d", len(model.Bones))
	testutil.Equal(t, model.Bones[0].Name, "wbone", "minecraft.geometry 包裹兜底应解析出 wbone")
}

func TestFindGeometryInExtractedYSM_BareGeometryFallback(t *testing.T) {
	// 兜底 4：ysm.json 自身为裸几何元素（无 minecraft:geometry 包裹）→ 包裹后解析
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": `{"format_version":"1.16.0","description":{"identifier":"bare","texture_width":32,"texture_height":32},"bones":[{"name":"barebone","cubes":[]}]}`,
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原复合条件拆序贯
	testutil.NotNil(t, model, "裸几何兜底应解析出模型, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "裸几何兜底应解析出 1 根骨骼, 实际 %d", len(model.Bones))
	testutil.Equal(t, model.Bones[0].Name, "barebone", "裸几何兜底应解析出 barebone")
}

func TestFindGeometryInExtractedYSM_WalkDirRecursive(t *testing.T) {
	// 兜底 3：WalkDir 递归子目录（排除 animations/controller/avatar）找几何
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":                 `{"files":{}}`,
		"sub/deep/model.geo.json":  geometryJSON("deep"),
		"animations/idle.geo.json": geometryJSON("animBone"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原复合条件拆序贯
	testutil.NotNil(t, model, "WalkDir 应找到子目录几何, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "WalkDir 应找到 1 根骨骼, 实际 %d", len(model.Bones))
	testutil.Equal(t, model.Bones[0].Name, "deep", "WalkDir 应找到 sub/deep/model.geo.json 的 deep 骨骼")
}

func TestFindGeometryInExtractedYSM_MissingModelFileFallback(t *testing.T) {
	// 声明模型文件不存在 → 模型循环跳过 → 兜底 WalkDir 命中同目录几何
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":      `{"files":{"player":{"model":"models/gone.geo.json"}}}`,
		"main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原复合条件拆序贯
	testutil.NotNil(t, model, "缺失声明模型后应兜底找到模型, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "缺失声明模型后应兜底找到 1 根骨骼, 实际 %d", len(model.Bones))
	testutil.Equal(t, model.Bones[0].Name, "main", "缺失声明模型后应兜底找到 main")
}

func TestFindGeometryInExtractedYSM_PathTraversalRejected(t *testing.T) {
	// 模型名路径穿越（../）→ 拒绝加载外部文件（日志 + continue），不 panic
	dir := t.TempDir()
	ysmPath := filepath.Join(dir, "mod", "ysm.json")
	if err := os.MkdirAll(filepath.Dir(ysmPath), 0755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(ysmPath, []byte(`{"files":{"player":{"model":"../evil.geo.json"}}}`), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 越界文件确实存在于 ysm.json 目录之外
	if err := os.WriteFile(filepath.Join(dir, "evil.geo.json"), []byte(geometryJSON("evil")), 0644); err != nil {
		testutil.NoError(t, err)
	}
	model, tex := FindGeometryInExtractedYSM(ysmPath)
	// 注：裸几何兜底（extracted.go:293-297）会把任意合法 JSON ysm.json 包裹成
	// 零骨骼模型，故此处不断言 nil，只断言越界文件未被加载（无 evil 骨骼）
	if model != nil {
		for _, b := range model.Bones {
			if b.Name == "evil" {
				t.Errorf("路径穿越模型不应被加载, 发现骨骼 %q", b.Name)
			}
		}
	}
	if tex != nil {
		t.Errorf("路径穿越场景 texData 应为 nil, 得到 %v", tex)
	}
}

func TestFindGeometryInExtractedYSM_InvalidYsmJsonWalkDir(t *testing.T) {
	// ysm.json 非法 JSON → 解析跳过 → 兜底 WalkDir 命中几何
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":      `{bad json`,
		"main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原复合条件拆序贯
	testutil.NotNil(t, model, "非法 ysm.json 应兜底找到模型, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "非法 ysm.json 应兜底找到 1 根骨骼, 实际 %d", len(model.Bones))
}

func TestFindGeometryInExtractedYSM_ModelMapExtraKeyMergeAndClamp(t *testing.T) {
	// map 格式非 main 键（extra）排序入列 + 模型数多于纹理声明时 TexSlot 钳制
	// （extracted.go:203-205：ti > maxTexIdx → 钳到最后一张声明纹理）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":              `{"files":{"player":{"model":{"main":"models/main.geo.json","extra":"models/extra.geo.json","arm":"models/arm.geo.json"},"texture":["tex_a.png"]}}}`,
		"models/main.geo.json":  geometryJSON("main"),
		"models/extra.geo.json": geometryJSON("extra"),
		"models/arm.geo.json":   geometryJSON("arm"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	testutil.NotNil(t, model, "模型应为非 nil")
	// 守卫下方 Bones 遍历中 Cubes[0] 索引
	testutil.Equal(t, len(model.Bones), 2, "应合并 main+extra 2 根骨骼（arm 排除）, 实际 %d", len(model.Bones))
	// 纹理声明仅 1 项 → maxTexIdx=0：main 与 extra 的 TexSlot 均钳到 0
	for _, b := range model.Bones {
		if c := b.Cubes[0]; c.TexSlot != 0 {
			t.Errorf("骨骼 %s cube TexSlot = %d, 期望 0（钳制）", b.Name, c.TexSlot)
		}
	}
	if model.BoneCount != 2 || model.CubeCount != 2 {
		t.Errorf("BoneCount/CubeCount = %d/%d, 期望 2/2", model.BoneCount, model.CubeCount)
	}
}

func TestFindGeometryInExtractedYSM_PlayerKeySkipAndParseError(t *testing.T) {
	// files 含非 player 键（跳过）+ player 值非对象（解析失败跳过）——
	// 两分支均走 continue，不 panic；任意 JSON 不再被裸几何兜底包成
	// 零骨骼假模型（extracted.go looksLikeGeometry 守卫，P 级修复）→ 返回 nil
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": `{"files":{"player":42,"weapon":{"model":"models/w.geo.json"}}}`,
	})
	model, tex := FindGeometryInExtractedYSM(ysmPath)
	testutil.Nil(t, model, "非几何 JSON 不应产出模型（修复后 nil）, 实际 %+v", model)
	if tex != nil {
		t.Errorf("无纹理场景 texData 应为 nil, 得到 %v", tex)
	}
}

func TestFindGeometryInExtractedYSM_ModelMapNonStringValue(t *testing.T) {
	// map 格式 value 非字符串（数字）→ Decode 失败跳过继续（extracted.go:98-99），
	// mm 为空 map → 模型循环不加载 → 兜底 WalkDir 命中
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":{"main":123,"extra":"models/main.geo.json"}}}}`,
		"models/main.geo.json": geometryJSON("main"),
	})
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	// 原复合条件拆序贯
	testutil.NotNil(t, model, "非字符串 map value 跳过后应兜底找到模型, 实际 %v", model)
	testutil.Equal(t, len(model.Bones), 1, "非字符串 map value 跳过后应兜底找到 1 根骨骼, 实际 %d", len(model.Bones))
	testutil.Equal(t, model.Bones[0].Name, "main", "非字符串 map value 跳过后应兜底找到 main")
}

func TestFindGeometryInExtractedYSM_TextureBackslashAndPartialOrder(t *testing.T) {
	// uv 反斜杠路径取 basename（extracted.go:135-137）+ 字符串条目正斜杠
	// （144-146）+ 未声明纹理排末尾（sort 比较器 hasI 单边分支, 352 行）
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":             `{"files":{"player":{"model":["models/main.geo.json"],"texture":["tex_a.png",{"uv":"tex\\tex_b.png"},"sub/tex_c.png"]}}}`,
		"models/main.geo.json": geometryJSON("main"),
		"textures/tex_a.png":   "PNGDATA-A",
		"textures/tex_b.png":   "PNGDATA-B",
		"textures/tex_c.png":   "PNGDATA-C",
		"textures/stray.png":   "PNGDATA-S",
	})
	model, texData := FindGeometryInExtractedYSM(ysmPath)
	testutil.NotNil(t, model, "模型应为非 nil")
	// 守卫下方 texData[i] 循环索引
	testutil.Equal(t, len(texData), 4, "应读 4 张纹理, 实际 %d", len(texData))
	// 声明序 [tex_a, tex_b, tex_c]，未声明 stray 落尾
	want := []string{"PNGDATA-A", "PNGDATA-B", "PNGDATA-C", "PNGDATA-S"}
	for i, w := range want {
		testutil.Equal(t, string(texData[i]), w, "texData[%d] 应为 %q", i, w)
	}
	if len(model.TextureNames) != 4 || model.TextureNames[3] != "stray" {
		t.Errorf("TextureNames = %v, 期望末尾为 stray", model.TextureNames)
	}
}

func TestFindGeometryInExtractedYSM_WalkDirDepthLimit(t *testing.T) {
	// 递归搜索深度上限 10 层（extracted.go:266-268）：第 11 层起 SkipDir，
	// 深度 12 的几何不会被发现；{"files":{}} 非几何 JSON 不再被裸几何兜底
	// 包成假模型（looksLikeGeometry 守卫）→ 返回 nil
	files := map[string]string{"ysm.json": `{"files":{}}`}
	deep := "d1/d2/d3/d4/d5/d6/d7/d8/d9/d10/d11/d12/model.geo.json"
	files[deep] = geometryJSON("deep")
	ysmPath := writeExtractedFixture(t, files)
	model, _ := FindGeometryInExtractedYSM(ysmPath)
	testutil.Nil(t, model, "深度受限 + 非几何 ysm.json 应返回 nil, 实际 %+v", model)
}

// geometry.IsArmModelName 直测（2026-08-26 跨包收敛：本地副本删除，单一实现在
// go/geometry/archive.go，此处锁 ysm 消费方口径与权威注释一致）：arm.json /
// arm.geo.json（含路径前缀、大写变体）→ true，其余（main.json、army.json 等）→ false
func TestIsArmModelName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"arm.json", true},
		{"arm.geo.json", true},
		{"models/arm.json", true},
		{"models\\arm.geo.json", true},
		{"ARM.JSON", true},
		{"Arm.Geo.Json", true},
		{"main.json", false},
		{"army.json", false},
		{"arm_geo.json", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := geometry.IsArmModelName(tc.name); got != tc.want {
			t.Errorf("geometry.IsArmModelName(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// FindComponentsInExtractedYSM 对非法 ysm.json 应容错：解析跳过 → 空组件、
// 空纹理名，不 panic（extracted.go:406 json.Unmarshal 失败分支）
func TestFindComponentsInExtractedYSM_InvalidYsmJson(t *testing.T) {
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json": `{bad json`,
	})
	comps, texNames := FindComponentsInExtractedYSM(ysmPath)
	if len(comps) != 0 {
		t.Errorf("非法 ysm.json 应解析出 0 组件, 得到 %d", len(comps))
	}
	if len(texNames) != 0 {
		t.Errorf("非法 ysm.json 应解析出空纹理名, 得到 %v", texNames)
	}
}

// FindComponentsInExtractedYSM 字符串 model 格式 + 补扫 models/ 目录：
// player.model 单字符串 → 组件 0 = main；models/ 未声明的 arm/arrow 作为补扫组件，
// texNames = [声明纹理名(skin), 未声明组件 basename(arm, arrow)]（extracted.go:449-456, 538-553）
func TestFindComponentsInExtractedYSM_StringModelPlusModelsDir(t *testing.T) {
	ysmPath := writeExtractedFixture(t, map[string]string{
		"ysm.json":           `{"files":{"player":{"model":"models/main.json","texture":["textures/skin.png"]}}}`,
		"models/main.json":   geometryJSON("main"),
		"models/arm.json":    geometryJSON("arm"),
		"models/arrow.json":  geometryJSON("arrow"),
		"textures/skin.png":  "SKINDATA",
		"textures/arrow.png": "ARROWDATA",
		"textures/arm.png":   "ARMDATA",
	})
	comps, texNames := FindComponentsInExtractedYSM(ysmPath)
	// 守卫下方 comps[0]/[1]/[2] 索引
	testutil.Equal(t, len(comps), 3, "应解析 3 组件（main + 补扫 arm/arrow）, 实际 %d", len(comps))
	if comps[0].SourceName != "main" {
		t.Errorf("组件 0 应为 main, got %q", comps[0].SourceName)
	}
	// main 已声明 → 贴声明纹理 skin（texSlot=0）；arm 与 main 共用同一套皮肤
	// （第一人称手持视角的独立手臂几何，不填 ComponentTextures、texNames 置空）；
	// arrow 未声明 → 按名段命中同名 png（textures/arrow.png）→ ADR-114 perComponent 接管。
	wantNames := []string{"skin", "", ""}
	for i, w := range wantNames {
		testutil.Equal(t, texNames[i], w, "texNames[%d] 应为 %q", i, w)
	}
	// 组件 TexSlot：main=0（声明序贴 texArr）；arm=0（与 main 共用 texArr[0] 默认皮肤）；
	// arrow perComponent 接管 → TexSlot=0（用自己的第 0 张，全局槽位不消费）
	for i, slot := range []int{0, 0, 0} {
		if got := comps[i].Bones[0].Cubes[0].TexSlot; got != slot {
			t.Errorf("组件 %d (%s) cube TexSlot = %d, 期望 %d", i, comps[i].SourceName, got, slot)
		}
	}
	// arm 不填 ComponentTextures（与 main 共用全局 texArr[0] 皮肤——权威来源见 isArmModelName 注释）
	if len(comps[1].ComponentTextures) != 0 {
		t.Errorf("arm 组件不应填 ComponentTextures（与 main 共用皮肤）, got %v", comps[1].ComponentTextures)
	}
	// arrow 仍走 perComponent 同名纹理兜底（data URI），键 = 组件 basename
	ct, ok := comps[2].ComponentTextures["arrow"]
	if !ok || len(ct) != 1 || !strings.HasPrefix(ct[0], "data:image/png;base64,") {
		t.Errorf("组件 arrow 应有 perComponent 纹理 [1 张 data URI], got %v", comps[2].ComponentTextures)
	}
}

// ===== 兜底 3 WalkDir 候选预算（2026-08-26 审查修复：畸形大目录防逐个试解析 DoS）=====

func TestResolveBedrockGeometryFallback_ProbeBudgetExhausted(t *testing.T) {
	// maxFallbackGeoProbes 个垃圾 json 先耗尽预算（字典序在 sub/ 前），
	// 预算外合法 geo 不再尝试 → 兜底 3 落空、兜底 4 也不命中 → nil
	data := []byte(`{"load":{"name":"x"}}`) // 兜底 1/2/4 全 miss 的 ysm.json
	files := map[string]string{"ysm.json": string(data)}
	for i := 0; i < maxFallbackGeoProbes; i++ {
		files[fmt.Sprintf("garbage_%02d.json", i)] = fmt.Sprintf(`{"junk":%d}`, i)
	}
	files["sub/real.geo.json"] = geometryJSON("real")
	dir := filepath.Dir(writeExtractedFixture(t, files))
	if m := resolveBedrockGeometryFallback(data, filepath.Join(dir, "ysm.json"), dir); m != nil {
		t.Errorf("候选预算耗尽后应停止扫描返回 nil, 得到骨骼 %v", m.Bones)
	}
}

func TestResolveBedrockGeometryFallback_ProbeBudgetWithinLimit(t *testing.T) {
	// 预算内：5 个垃圾 + 合法 geo → 正常命中
	data := []byte(`{"load":{"name":"x"}}`)
	files := map[string]string{"ysm.json": string(data)}
	for i := 0; i < 5; i++ {
		files[fmt.Sprintf("garbage_%02d.json", i)] = fmt.Sprintf(`{"junk":%d}`, i)
	}
	files["zz.geo.json"] = geometryJSON("hit")
	dir := filepath.Dir(writeExtractedFixture(t, files))
	m := resolveBedrockGeometryFallback(data, filepath.Join(dir, "ysm.json"), dir)
	// 原复合条件拆序贯；骨骼数守卫下方 Bones[0] 索引
	testutil.NotNil(t, m, "预算内应命中合法 geo, 实际 %v", m)
	testutil.Equal(t, len(m.Bones) == 0, false, "预算内应命中合法 geo（骨骼数应 > 0）, 实际 %d", len(m.Bones))
	testutil.Equal(t, m.Bones[0].Name, "hit", "预算内应命中合法 geo")
}
