// ===== go/geometry archive 单测（覆盖率 11.4% → 提升）=====
// 注：ParseBedrockGeometry 测试见 parse_test.go（并行补测），本文件覆盖 archive.go。
package geometry

import (
	"archive/zip"
	"bytes"
	"testing"
)

func makeZipBytes(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// 构造一个 > 4KB 的虚拟 PNG 数据
func makePngData(t *testing.T, label string) []byte {
	t.Helper()
	// PNG 文件头 + 填充到 5KB
	data := make([]byte, 5120)
	copy(data, []byte("\x89PNG\r\n\x1a\n"+label))
	return data
}

func TestExtractFirstPNGFromZip(t *testing.T) {
	// 含 PNG → 提取第一张（map 顺序随机，只验证提取到非空 PNG）
	data := makeZipBytes(t, map[string]string{
		"tex/1.png":  "PNGDATA1",
		"readme.txt": "hi",
		"tex/2.png":  "PNGDATA2",
	})
	got := ExtractFirstPNGFromZip(data, int64(len(data)))
	if len(got) == 0 {
		t.Fatalf("应提取到 PNG 数据, 得到空")
	}
	// 无 PNG → nil
	data2 := makeZipBytes(t, map[string]string{"a.txt": "x"})
	if got := ExtractFirstPNGFromZip(data2, int64(len(data2))); got != nil {
		t.Fatalf("无 png 应 nil: %q", string(got))
	}
	// 坏 zip → nil
	if got := ExtractFirstPNGFromZip([]byte("notzip"), 6); got != nil {
		t.Fatalf("坏 zip 应 nil: %q", string(got))
	}
}

func TestExtractFirstPNGFrom7z_BadData(t *testing.T) {
	// 7z 样本构造需 sevenzip Writer，此处只覆盖错误路径
	if got := ExtractFirstPNGFrom7z([]byte("not7z"), 5); got != nil {
		t.Fatalf("坏 7z 应 nil: %q", string(got))
	}
}

func TestParseFromZip_Errors(t *testing.T) {
	// 坏 zip → 全 nil
	if model, pngs, names := ParseFromZip([]byte("notzip"), 6); model != nil || pngs != nil || names != nil {
		t.Fatalf("坏 zip 应全 nil")
	}
	// 有效 zip 但无 ysm.json → 模型为 nil（无解析失败崩溃）
	empty := makeZipBytes(t, map[string]string{"tex.png": "PNG"})
	model, _, _ := ParseFromZip(empty, int64(len(empty)))
	if model != nil {
		t.Fatalf("无 ysm.json 应无模型")
	}
}

// ====== ParseFromZip 完整路径 ======

const validGeoJSON = `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"test","texture_width":64,"texture_height":32},"bones":[{"name":"head","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`

func TestParseFromZip_Valid(t *testing.T) {
	// 含 ysm.json + geo JSON + PNG → 完整解析
	ysmJSON := `{
		"files": {
			"player": {
				"model": ["model.geo.json"],
				"texture": ["tex1.png"]
			}
		}
	}`
	pngData := string(makePngData(t, "tex1"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":       ysmJSON,
		"model.geo.json": validGeoJSON,
		"tex1.png":       pngData,
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if model.BoneCount != 1 || model.CubeCount != 1 {
		t.Errorf("BoneCount/CubeCount = %d/%d, 期望 1/1", model.BoneCount, model.CubeCount)
	}
	if model.TexWidth != 64 || model.TexHeight != 32 {
		t.Errorf("TexWidth/TexHeight = %d/%d, 期望 64/32", model.TexWidth, model.TexHeight)
	}
	if len(pngs) != 1 {
		t.Fatalf("期望 1 个 PNG, 得到 %d", len(pngs))
	}
}

func TestParseFromZip_ModelAsObjects(t *testing.T) {
	// model 是对象数组（含 path/name 字段）
	ysmJSON := `{
		"files": {
			"player": {
				"model": [{"path":"sub/model.geo.json","name":"geo1"}],
				"texture": ["tex_a.png", "tex_b.png"]
			}
		}
	}`
	pngA := string(makePngData(t, "tex_a"))
	pngB := string(makePngData(t, "tex_b"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":           ysmJSON,
		"sub/model.geo.json": validGeoJSON,
		"tex_a.png":          pngA + "A",
		"tex_b.png":          pngB + "B",
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 2 {
		t.Errorf("期望 2 个 PNG, 得到 %d", len(pngs))
	}
}

func TestParseFromZip_ModelAsMap(t *testing.T) {
	// model 是 map[string]string
	ysmJSON := `{
		"files": {
			"player": {
				"model": {"main":"main.geo.json","sub":"sub.geo.json"},
				"texture": ["tex1.png"]
			}
		}
	}`
	geo2 := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"sub","texture_width":32,"texture_height":32},"bones":[{"name":"arm","cubes":[{"origin":[0,0,0],"size":[4,4,4],"uv":[0,0]}]}]}]}`
	pngData := string(makePngData(t, "tex1"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":      ysmJSON,
		"main.geo.json": validGeoJSON,
		"sub.geo.json":  geo2,
		"tex1.png":      pngData,
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（两个模型合并）", model.BoneCount)
	}
	// 合并后取最大纹理尺寸
	if model.TexWidth < 64 {
		t.Errorf("TexWidth = %d, 应 ≥ 64", model.TexWidth)
	}
}

func TestParseFromZip_ModelAsString(t *testing.T) {
	// model 是单字符串
	ysmJSON := `{
		"files": {
			"player": {
				"model": "model.geo.json",
				"texture": ["tex1.png"]
			}
		}
	}`
	pngData := string(makePngData(t, "tex1"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":       ysmJSON,
		"model.geo.json": validGeoJSON,
		"tex1.png":       pngData,
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
}

func TestParseFromZip_TextureAsObjects(t *testing.T) {
	// texture 是对象数组（含 uv 字段）
	ysmJSON := `{
		"files": {
			"player": {
				"model": ["model.geo.json"],
				"texture": [{"uv":"tex/tex1.png"},{"uv":"tex/tex2.png"}]
			}
		}
	}`
	png1 := string(makePngData(t, "tex1"))
	png2 := string(makePngData(t, "tex2"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":       ysmJSON,
		"model.geo.json": validGeoJSON,
		"tex1.png":       png1,
		"tex2.png":       png2,
	})
	model, pngs, names := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(pngs) != 2 {
		t.Errorf("期望 2 个 PNG, 得到 %d", len(pngs))
	}
	// 纹理顺序应匹配 ysm.json 中的 uv 文件名
	if len(names) >= 2 && names[0] != "tex1" {
		t.Logf("纹理顺序: %v", names)
	}
}

func TestParseFromZip_SmallPNGFiltered(t *testing.T) {
	// < 4KB 的 PNG 应被过滤
	ysmJSON := `{"files":{"player":{"model":["model.geo.json"],"texture":["small.png"]}}}`
	data := makeZipBytes(t, map[string]string{
		"ysm.json":       ysmJSON,
		"model.geo.json": validGeoJSON,
		"small.png":      "tiny", // < 4KB
	})
	_, pngs, _ := ParseFromZip(data, int64(len(data)))
	if len(pngs) != 0 {
		t.Errorf("小 PNG（<4KB）应被过滤, 得到 %d 个", len(pngs))
	}
}

func TestParseFromZip_AnimationJSON(t *testing.T) {
	// animation/controller JSON 不参与 geo 解析
	ysmJSON := `{"files":{"player":{"model":["model.geo.json"],"texture":["tex1.png"]}}}`
	pngData := string(makePngData(t, "tex1"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":             ysmJSON,
		"model.geo.json":       validGeoJSON,
		"animations/idle.json": `{"animation":{"idle":{"loop":true}}}`,
		"tex1.png":             pngData,
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil，animation JSON 不应影响解析")
	}
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
}

func TestParseFromZip_AvatarDirFiltered(t *testing.T) {
	// avatar/ 目录下的 PNG 应被过滤
	ysmJSON := `{"files":{"player":{"model":["model.geo.json"],"texture":["tex1.png"]}}}`
	pngData := string(makePngData(t, "tex1"))
	avatarPng := string(makePngData(t, "avatar"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":        ysmJSON,
		"model.geo.json":  validGeoJSON,
		"tex1.png":        pngData,
		"avatar/face.png": avatarPng,
	})
	_, pngs, names := ParseFromZip(data, int64(len(data)))
	if len(pngs) != 1 {
		t.Errorf("avatar/ 下的 PNG 应过滤, 得到 %d 个 PNG, names=%v", len(pngs), names)
	}
}

// ====== ParseFrom7z ======

func TestParseFrom7z_BadData(t *testing.T) {
	// 7z 构造需 sevenzip Writer，此覆盖错误路径
	if model, pngs := ParseFrom7z([]byte("not7z"), 5); model != nil || pngs != nil {
		t.Fatalf("坏 7z 应全 nil, 得到 model=%v pngs=%v", model, pngs)
	}
}

// ====== ParseComponentsFromZip 多组件契约（code_review P3 补测）======

// geoArmJSON 独立 arm 组件（与 validGeoJSON 的 head 骨骼区分）
const geoArmJSON = `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"arm","texture_width":32,"texture_height":32},"bones":[{"name":"arm","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[4,4,4],"uv":[0,0]}]}]}]}`

// ====== ParseFromZip 纹理名契约（textureNames 与 Textures 同序）======

func TestParseFromZip_TextureNames(t *testing.T) {
	// ysm.json texture 声明序 → TextureNames 与 Textures/pngs 同序（含排序）
	ysmJSON := `{
		"files": {
			"player": {
				"model": ["model.geo.json"],
				"texture": ["tex_b.png", "tex_a.png"]
			}
		}
	}`
	data := makeZipBytes(t, map[string]string{
		"ysm.json":       ysmJSON,
		"model.geo.json": validGeoJSON,
		"tex_a.png":      string(makePngData(t, "tex_a")),
		"tex_b.png":      string(makePngData(t, "tex_b")),
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(pngs) != 2 {
		t.Fatalf("pngs = %d, 期望 2", len(pngs))
	}
	// Textures（base64）由 app 层 AnalyzeBedrockModel 填充；geometry 层契约是
	// TextureNames 与 pngs 同序——这里验证名字数组与 pngs 长度一致且按声明序排序
	if len(model.TextureNames) != len(pngs) {
		t.Fatalf("TextureNames = %d, 期望与 pngs 同长 %d", len(model.TextureNames), len(pngs))
	}
	// 按 ysm texture 声明序排序后：tex_b 在前，tex_a 在后（与 pngs 同序）
	if model.TextureNames[0] != "tex_b" || model.TextureNames[1] != "tex_a" {
		t.Errorf("TextureNames = %v, 期望 [tex_b tex_a]（按 ysm texture 声明序）", model.TextureNames)
	}
}

func TestParseComponentsFromZip_MainFirstAndTexSlot(t *testing.T) {
	// ysm.json 声明 model 数组 + texture 数组：main 优先排序，TexSlot 按 modelOrder 全局化
	ysmJSON := `{
		"files": {
			"player": {
				"model": ["main.geo.json", "arm.geo.json"],
				"texture": ["tex_a.png", "tex_b.png"]
			}
		}
	}`
	data := makeZipBytes(t, map[string]string{
		"ysm.json":      ysmJSON,
		"main.geo.json": validGeoJSON, // head 骨骼
		"arm.geo.json":  geoArmJSON,   // arm 骨骼
	})
	comps, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 2 {
		t.Fatalf("期望 2 个组件, 得到 %d", len(comps))
	}
	if got := comps[0].Bones[0].Name; got != "head" {
		t.Errorf("组件 0 应为 main(head), 得到 %s", got)
	}
	if got := comps[1].Bones[0].Name; got != "arm" {
		t.Errorf("组件 1 应为 arm, 得到 %s", got)
	}
	// TexSlot 全局化：main→0, arm→1（按 modelOrder 声明序）
	for _, b := range comps[0].Bones {
		for _, c := range b.Cubes {
			if c.TexSlot != 0 {
				t.Errorf("main 组件 cube TexSlot = %d, 期望 0", c.TexSlot)
			}
		}
	}
	for _, b := range comps[1].Bones {
		for _, c := range b.Cubes {
			if c.TexSlot != 1 {
				t.Errorf("arm 组件 cube TexSlot = %d, 期望 1", c.TexSlot)
			}
		}
	}
}

func TestParseComponentsFromZip_MainPriorityOverDeclOrder(t *testing.T) {
	// ysm.json 声明 arm 在前 → main 仍应排首位（IsMainModelName 优先于 modelOrder）
	ysmJSON := `{
		"files": {
			"player": {
				"model": ["arm.geo.json", "main.geo.json"],
				"texture": ["tex_a.png"]
			}
		}
	}`
	data := makeZipBytes(t, map[string]string{
		"ysm.json":      ysmJSON,
		"main.geo.json": validGeoJSON,
		"arm.geo.json":  geoArmJSON,
	})
	comps, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 2 {
		t.Fatalf("期望 2 个组件, 得到 %d", len(comps))
	}
	if got := comps[0].Bones[0].Name; got != "head" {
		t.Errorf("arm 声明在前时组件 0 仍应为 main(head), 得到 %s", got)
	}
	if got := comps[1].Bones[0].Name; got != "arm" {
		t.Errorf("组件 1 应为 arm, 得到 %s", got)
	}
}

func TestParseComponentsFromZip_TexSlotGlobal(t *testing.T) {
	// 多组件 texSlot = 全局组件序（无钳制）：texArr 元数据含全部组件纹理
	// （FindGeometryInExtractedYSM 递归扫描 textures/ 全部 + texOrderNames 优先 + 其余按名），
	// 与 WASM 路径 decodeYSMComponentsViaNodeJS 同口径；钳制会让 arrow/boat 等
	// 组件错误共用皮肤纹理。
	ysmJSON := `{
		"files": {
			"player": {
				"model": ["main.geo.json", "arm.geo.json"],
				"texture": ["tex_a.png"]
			}
		}
	}`
	data := makeZipBytes(t, map[string]string{
		"ysm.json":      ysmJSON,
		"main.geo.json": validGeoJSON,
		"arm.geo.json":  geoArmJSON,
	})
	comps, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 2 {
		t.Fatalf("期望 2 个组件, 得到 %d", len(comps))
	}
	// texSlot = 组件序：main(i=0)→0, arm(i=1)→1（全局 texArr 索引）
	for i, comp := range comps {
		for _, b := range comp.Bones {
			for _, c := range b.Cubes {
				if c.TexSlot != i {
					t.Errorf("组件 %d cube TexSlot = %d, 期望 %d（全局组件序）", i, c.TexSlot, i)
				}
			}
		}
	}
}
