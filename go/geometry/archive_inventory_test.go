package geometry

import (
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// ===== 文件归属识别（parseGlobalResources 轻量版：只识别不解析）=====

// zip 内文件归属分类端到端验证：ParseFromZip 后 geo.FileInventory 分类正确
func TestFileInventory_Classified(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":                                 `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":                         minimalMainJSON,
		"textures/skin.png":                        tinyPNG(),
		"animations/main.animation.json":           `{"animations":{}}`,
		"animations/arm.animation_controller.json": `{"format_version":"1.10.0"}`,
		"lang/zh_CN.lang":                          `model.name=测试`,
		"include/head.inc":                         `{ "head" }`,
		"avatar/wmdj.jpg":                          `fake-jpg`,
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "ParseFromZip 返回 nil")
	inv := geo.FileInventory
	testutil.NotNil(t, inv, "期望 geo.FileInventory 非 nil（parseModelFromEntries 挂载）")
	checkInv(t, inv)
}

// 组件路径：ParseComponentsFromZip 每个组件模型都应挂同一 zip 清单
func TestFileInventory_ComponentsPath(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":                       `{"files":{"player":{"model":{"main":"models/main.json","arm":"models/arm.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":               minimalMainJSON,
		"models/arm.json":                `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":64},"bones":[{"name":"arm","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[2,2,2],"uv":[0,0]}]}]}]}`,
		"textures/skin.png":              tinyPNG(),
		"animations/main.animation.json": `{"animations":{}}`,
	})
	models, _, err := ParseComponentsFromZip(data, int64(len(data)))
	testutil.NoError(t, err, "ParseComponentsFromZip")
	if len(models) < 2 {
		t.Fatalf("期望至少 2 个组件, 实际 %d", len(models))
	}
	for _, m := range models {
		if m.FileInventory == nil {
			t.Errorf("组件 %s: 期望 FileInventory 非 nil", m.SourceName)
		} else if len(m.FileInventory.Animations) != 1 {
			t.Errorf("组件 %s: Animations = %d, 期望 1", m.SourceName, len(m.FileInventory.Animations))
		}
	}
}

// 直接测 classifyFileInventory：无 ysm.json 声明的文件归属（含旧格式几何识别）
func TestClassifyFileInventory_Direct(t *testing.T) {
	inv := classifyFileInventory(nil)
	testutil.NotNil(t, inv, "classifyFileInventory 不应返回 nil")
	// 空 entries → 全空
	if len(inv.Animations) != 0 || len(inv.Controllers) != 0 || len(inv.LangFiles) != 0 {
		t.Errorf("空 entries 应全空: %+v", inv)
	}
}

// 旧格式 info.json 元数据兜底（无 ysm.json 场景，Modern YSM parseLegacyMetadata 同口径）
func TestParseLegacyMetadata(t *testing.T) {
	// 1. 无 ysm.json + info.json → geo.Metadata 从 info.json 解析（name/tips/license(字符串)/authors(字符串数组)）
	data := makeZipWithFiles(t, map[string]string{
		"models/main.json":  minimalMainJSON,
		"textures/skin.png": tinyPNG(),
		"info.json": `{
  "name": "旧格式测试模型",
  "tips": "无 ysm.json 的旧包",
  "license": "CC BY-NC-SA 4.0",
  "authors": ["完美冻结", "星屑海螺"]
}`,
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "无 ysm.json 旧格式包应仍能解析出 geo（L1 枚举）")
	m := geo.Metadata
	testutil.NotNil(t, m, "期望 info.json 元数据挂载")
	if m.Name != "旧格式测试模型" {
		t.Errorf("Name = %q, 期望 旧格式测试模型", m.Name)
	}
	if m.License == nil || m.License.Type != "CC BY-NC-SA 4.0" {
		t.Errorf("License = %+v, 期望 type=CC BY-NC-SA 4.0（字符串映射）", m.License)
	}
	if len(m.Authors) != 2 || m.Authors[0].Name != "完美冻结" || m.Authors[1].Name != "星屑海螺" {
		t.Errorf("Authors = %+v, 期望 2 条字符串数组映射", m.Authors)
	}
	if m.Tips == "" {
		t.Error("期望 Tips 非空")
	}
}

func TestParseLegacyMetadata_NoInfoJSON(t *testing.T) {
	// 无 ysm.json 也无 info.json → geo.Metadata nil（容错）
	data := makeZipWithFiles(t, map[string]string{
		"models/main.json":  minimalMainJSON,
		"textures/skin.png": tinyPNG(),
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "geo 应为非 nil")
	if geo.Metadata != nil {
		t.Errorf("无 info.json 应 nil, 实际 %+v", geo.Metadata)
	}
}

func TestParseLegacyMetadata_NewFormatNotOverridden(t *testing.T) {
	// 有 ysm.json 且含 metadata → info.json 不覆盖（新格式优先）
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":          `{"metadata":{"name":"新格式名"},"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":  minimalMainJSON,
		"textures/skin.png": tinyPNG(),
		"info.json":         `{"name":"旧格式名"}`,
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "geo 应为非 nil")
	if geo.Metadata == nil || geo.Metadata.Name != "新格式名" {
		t.Errorf("新格式 metadata 应优先（info.json 不覆盖）, 实际 %+v", geo.Metadata)
	}
}

func TestParseLegacyMetadata_Malformed(t *testing.T) {
	// info.json 畸形（非 JSON）→ nil（容错不阻断）
	data := makeZipWithFiles(t, map[string]string{
		"models/main.json":  minimalMainJSON,
		"textures/skin.png": tinyPNG(),
		"info.json":         "not-json{{{",
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "geo 应为非 nil（畸形 info.json 不阻断）")
	if geo.Metadata != nil {
		t.Errorf("畸形 info.json 应 nil, 实际 %+v", geo.Metadata)
	}
}

func TestParseLegacyMetadata_NestedInfoJSONIgnored(t *testing.T) {
	// code review P2：嵌套/无关 *info.json 不参与——textures/skin_info.json
	// 有 name 也不得挂载（旧格式约定根级 info.json）
	data := makeZipWithFiles(t, map[string]string{
		"models/main.json":        minimalMainJSON,
		"textures/skin.png":       tinyPNG(),
		"textures/skin_info.json": `{"name":"皮肤信息"}`,
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "geo 应为非 nil")
	if geo.Metadata != nil {
		t.Errorf("嵌套 skin_info.json 不应挂载, 实际 %+v", geo.Metadata)
	}
}

func TestParseLegacyMetadata_EmptyPlaceholder_Continues(t *testing.T) {
	// code review P2：空占位 {} 不得早退抑制后续候选——INFO.json（大小写变体）
	// 有效时应取到（continue 而非 return nil）
	data := makeZipWithFiles(t, map[string]string{
		"models/main.json":  minimalMainJSON,
		"textures/skin.png": tinyPNG(),
		"info.json":         `{}`,
		"INFO.json":         `{"name":"大写有效"}`,
	})
	geo, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, geo, "geo 应为非 nil")
	if geo.Metadata == nil || geo.Metadata.Name != "大写有效" {
		t.Errorf("空占位后应继续找到有效候选, 实际 %+v", geo.Metadata)
	}
}

// isLegacyGeometryName 的 .geo 变体识别（code review P3：与 IsMainModelName/IsArmModelName 同口径）
func TestIsLegacyGeometryName(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"models/main.json", true},
		{"models/main.geo.json", true}, // Blockbench 导出约定变体
		{"models/arm.json", true},
		{"models/arm.geo.json", true},
		{"models/arrow.json", true},
		{"info.json", true},
		{"models/player.json", false}, // 非约定名
		{"animations/main.animation.json", false},
		{"ysm.json", false},
	}
	for _, c := range cases {
		if got := isLegacyGeometryName(c.path); got != c.want {
			t.Errorf("isLegacyGeometryName(%q) = %v, 期望 %v", c.path, got, c.want)
		}
	}
}

// checkInv 断言 FileInventory 分类（与 fixture 文件对应）
func checkInv(t *testing.T, inv *types.FileInventory) {
	t.Helper()
	has := func(list []string, sub string) bool {
		for _, s := range list {
			if strings.Contains(strings.ToLower(s), sub) {
				return true
			}
		}
		return false
	}
	if !has(inv.Animations, "main.animation.json") {
		t.Errorf("Animations 应含 main.animation.json, 实际 %v", inv.Animations)
	}
	if !has(inv.Controllers, "animation_controller.json") {
		t.Errorf("Controllers 应含 arm.animation_controller.json, 实际 %v", inv.Controllers)
	}
	if !has(inv.LangFiles, ".lang") {
		t.Errorf("LangFiles 应含 zh_CN.lang, 实际 %v", inv.LangFiles)
	}
	if !has(inv.IncFiles, ".inc") {
		t.Errorf("IncFiles 应含 head.inc, 实际 %v", inv.IncFiles)
	}
	if !has(inv.Avatars, "avatar/") {
		t.Errorf("Avatars 应含 avatar/wmdj.jpg, 实际 %v", inv.Avatars)
	}
	if !has(inv.LegacyModels, "main.json") {
		t.Errorf("LegacyModels 应含 main.json, 实际 %v", inv.LegacyModels)
	}
	// ysm.json 不得进任何类
	for _, list := range [][]string{inv.Animations, inv.Controllers, inv.LangFiles, inv.IncFiles, inv.Avatars, inv.LegacyModels} {
		for _, s := range list {
			if strings.Contains(strings.ToLower(s), "ysm.json") {
				t.Errorf("ysm.json 不应进任何分类: %s ∈ %v", s, list)
			}
		}
	}
}
