// ===== maid-model L0 清单（maid_model.json model[]）测试 =====
// 目标：验证 L0 清单优先于 L1 文件枚举——
//
//	当 maid_model.json 含合法 model[] 数组时，geoFiles 只收集清单内条目，
//	且只绑定清单指定的纹理；L0 缺失/非法时回退 L1 全量枚举。
package geometry

import (
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// maidMiniGeo 返回最小合法 geometry（1 骨骼 1 方块），cube.texture=i 可区分 subModel texSlot
func maidMiniGeo(id string, cubeTex int) string {
	tpl := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"__ID__","texture_width":64,"texture_height":32},"bones":[{"name":"body","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0],"texture":__TEX__}]}]}]}`
	s := strings.ReplaceAll(tpl, "__ID__", id)
	s = strings.ReplaceAll(s, "__TEX__", strconv.Itoa(cubeTex))
	return s
}

// maidEntriesMixed 构造：L0 清单列了 2 个模型（reimu + marisa），
// 但 zip 里还有 1 个"多余"的 junk_geo.json —— L0 生效时 junk 应被排除。
func maidEntriesMixed() []rawZipEntry {
	maidModelJSON := `{
		"pack_name": "双角色测试包",
		"model": [
			{"name": "reimu",  "model": "models/reimu.geo.json",  "texture": "textures/reimu.png"},
			{"name": "marisa", "model": "models/marisa.geo.json", "texture": "textures/marisa.png"}
		]
	}`
	return []rawZipEntry{
		{name: "assets/touhou/maid_model.json", method: 0, data: maidModelJSON},
		{name: "assets/touhou/models/reimu.geo.json", method: 0, data: maidMiniGeo("reimu", 0)},
		{name: "assets/touhou/models/marisa.geo.json", method: 0, data: maidMiniGeo("marisa", 1)},
		// junk：不在 L0 清单里 → L0 生效时应被排除
		{name: "assets/touhou/models/junk_geo.json", method: 0, data: maidMiniGeo("junk", 2)},
		// 清单声明的纹理
		{name: "assets/touhou/textures/reimu.png", method: 0, data: "REIMU-PNG"},
		{name: "assets/touhou/textures/marisa.png", method: 0, data: "MARISA-PNG"},
		// junk 纹理 → L0 生效时应被排除
		{name: "assets/touhou/textures/junk.png", method: 0, data: "JUNK-PNG"},
		// 其他命名空间（应整体跳过）
		{name: "assets/other/maid_model.json", method: 0, data: `{"model":[{"name":"alien","model":"a.geo.json","texture":"a.png"}]}`},
		{name: "assets/other/a.geo.json", method: 0, data: maidMiniGeo("alien", 0)},
		{name: "assets/other/a.png", method: 0, data: "ALIEN"},
	}
}

func TestMaidL0_ManifestPriority(t *testing.T) {
	data := makeZipRaw(t, maidEntriesMixed())
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "L0 清单合法时模型不应为 nil")
	// 断言 1：只收了 2 个 geometry（reimu + marisa），junk 被排除
	// → Bones 聚合：reimu 1 bone + marisa 1 bone = 2
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（L0 清单只列 reimu+marisa，junk 应排除）", model.BoneCount)
	}
	// 断言 2：只绑定了 2 张纹理（reimu + marisa），junk 纹理被排除
	if len(pngs) != 2 {
		t.Errorf("pngs = %d, 期望 2（L0 清单只列 2 张纹理）", len(pngs))
	}
	// 断言 3：SubModels 与 L0 清单同序同命名（守卫下方 SubModels[0]/[1] 索引）
	testutil.Equal(t, len(model.SubModels), 2, "SubModels = %d, 期望 2", len(model.SubModels))
	if model.SubModels[0].Name != "reimu" {
		t.Errorf("SubModels[0].Name = %q, 期望 reimu", model.SubModels[0].Name)
	}
	if model.SubModels[1].Name != "marisa" {
		t.Errorf("SubModels[1].Name = %q, 期望 marisa", model.SubModels[1].Name)
	}
	if model.SubModels[0].SourcePath != "assets/touhou/models/reimu.geo.json" {
		t.Errorf("SubModels[0].SourcePath = %q", model.SubModels[0].SourcePath)
	}
}

func TestMaidL0_MissingFallback_L1(t *testing.T) {
	// 无 maid_model.json 的场景 → 回退 L1（全量枚举 geometry JSON）
	entries := []rawZipEntry{
		{name: "assets/any/a.geo.json", method: 0, data: maidMiniGeo("a", 0)},
		{name: "assets/any/b.geo.json", method: 0, data: maidMiniGeo("b", 0)},
		{name: "assets/any/a.png", method: 0, data: "A"},
		{name: "assets/any/b.png", method: 0, data: "B"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "L1 兜底时模型不应为 nil")
	// L1：所有 geometry 都被收 → 2 bone
	if model.BoneCount != 2 {
		t.Errorf("L1 兜底 BoneCount = %d, 期望 2", model.BoneCount)
	}
	// L1：所有 png 都被收 → 2
	if len(pngs) != 2 {
		t.Errorf("L1 兜底 pngs = %d, 期望 2", len(pngs))
	}
	// L1：SubModels 从 geoFiles 派生（Name = 文件名去后缀）
	testutil.Equal(t, len(model.SubModels), 2, "L1 兜底 SubModels = %d, 期望 2", len(model.SubModels))
}

func TestMaidL0_EmptyModelArray_Fallback(t *testing.T) {
	// maid_model.json 存在，但 model[] 为空 → L0 无效，回退 L1
	entries := []rawZipEntry{
		{name: "assets/ns/maid_model.json", method: 0, data: `{"model":[],"pack_name":"空清单"}`},
		{name: "assets/ns/x.geo.json", method: 0, data: maidMiniGeo("x", 0)},
		{name: "assets/ns/x.png", method: 0, data: "X"},
	}
	data := makeZipRaw(t, entries)
	model, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "L0 空清单时应回退 L1，模型不应为 nil")
	if model.BoneCount != 1 {
		t.Errorf("L0 空清单回退 BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(model.SubModels) != 1 || model.SubModels[0].Name != "x" {
		t.Errorf("L0 空清单回退 SubModels = %+v，期望 [{Name:x}]", model.SubModels)
	}
}

func TestMaidL0_MalformedJSON_Fallback(t *testing.T) {
	// maid_model.json JSON 语法损坏 → L0 失效，回退 L1（不崩溃）
	entries := []rawZipEntry{
		{name: "assets/ns/maid_model.json", method: 0, data: `{model:[ this is not json`},
		{name: "assets/ns/good.geo.json", method: 0, data: maidMiniGeo("good", 0)},
		{name: "assets/ns/good.png", method: 0, data: "GOOD"},
	}
	data := makeZipRaw(t, entries)
	model, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "L0 畸形 JSON 时应回退 L1，模型不应为 nil")
	if model.BoneCount != 1 {
		t.Errorf("L0 畸形 JSON 回退 BoneCount = %d, 期望 1", model.BoneCount)
	}
}

// ===== 以下 3 个测试对应实战比对出的 3 个真实世界 bug =====

// ① model_list 键（TLM 真实格式）：当前实现只认 model[] → 忽略；
//
//	修复后 model[] 和 model_list[] 都认，合并取非空。
func TestMaidL0_ModelListKey(t *testing.T) {
	manifest := `{
		"pack_name": "蔚蓝档案-阿露",
		"model_list": [
			{"model_id": "ba_aru:aru", "name": "阿露"},
			{"model_id": "ba_aru:kayoko", "name": "佳代子"}
		]
	}`
	entries := []rawZipEntry{
		{name: "assets/ba_aru/maid_model.json", method: 0, data: manifest},
		// model_id → entity/<name>.json 路径推断
		{name: "assets/ba_aru/models/entity/aru.json", method: 0, data: maidMiniGeo("aru", 0)},
		{name: "assets/ba_aru/models/entity/kayoko.json", method: 0, data: maidMiniGeo("kayoko", 1)},
		// junk
		{name: "assets/ba_aru/models/entity/unused.json", method: 0, data: maidMiniGeo("unused", 2)},
		{name: "assets/ba_aru/textures/entity/aru.png", method: 0, data: "ARU"},
		{name: "assets/ba_aru/textures/entity/kayoko.png", method: 0, data: "KAYOKO"},
		{name: "assets/ba_aru/textures/entity/unused.png", method: 0, data: "UNUSED"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "model_list[] 应被识别为 L0 清单，模型不应为 nil")
	// 2 model_list 条目 × 每个 1 bone = 2，unused 被排除
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（aru + kayoko）", model.BoneCount)
	}
	if len(pngs) != 2 {
		t.Errorf("pngs = %d, 期望 2", len(pngs))
	}
	// 守卫下方 SubModels[0]/[1] 索引
	testutil.Equal(t, len(model.SubModels), 2, "SubModels = %d, 期望 2", len(model.SubModels))
	if model.SubModels[0].Name != "阿露" || model.SubModels[1].Name != "佳代子" {
		t.Errorf("SubModels = %+v，期望 [阿露 佳代子]", model.SubModels)
	}
}

// ② 多命名空间选"清单最长者"为真正的命名空间：
//
//	touhou_little_maid.zip 里 credits 目录的 maid_model.json 比主清单先出现，
//	原"首次匹配"策略会把 maidNs 锁到 credits，主清单被忽略。
//	修复：遍历所有 maid_model.json，选 model/model_list 数最多的那个。
func TestMaidL0_MultiNs_PickLongestManifest(t *testing.T) {
	creditsManifest := `{"pack_name":"鸣谢","model_list":[{"model_id":"credits:sazuki","name":"sazuki dev"}]}`
	mainManifest := `{
		"pack_name": "Touhou Little Maid 主包",
		"model_list": [
			{"model_id": "touhou:reimu",  "name": "灵梦"},
			{"model_id": "touhou:marisa", "name": "魔理沙"},
			{"model_id": "touhou:flandre","name": "芙兰朵露"}
		]
	}`
	entries := []rawZipEntry{
		// credits 的 maid_model.json 先出现（模拟 zip 内按字母序）——原实现会错选它
		{name: "assets/credits_authors/maid_model.json", method: 0, data: creditsManifest},
		{name: "assets/credits_authors/models/entity/sazuki.json", method: 0, data: maidMiniGeo("sazuki", 0)},
		{name: "assets/credits_authors/textures/entity/sazuki.png", method: 0, data: "SAZUKI"},
		// 真正主包（清单更长 → 应被选中）
		{name: "assets/touhou/maid_model.json", method: 0, data: mainManifest},
		{name: "assets/touhou/models/entity/reimu.json", method: 0, data: maidMiniGeo("reimu", 0)},
		{name: "assets/touhou/models/entity/marisa.json", method: 0, data: maidMiniGeo("marisa", 1)},
		{name: "assets/touhou/models/entity/flandre.json", method: 0, data: maidMiniGeo("flandre", 2)},
		{name: "assets/touhou/textures/entity/reimu.png", method: 0, data: "REIMU"},
		{name: "assets/touhou/textures/entity/marisa.png", method: 0, data: "MARISA"},
		{name: "assets/touhou/textures/entity/flandre.png", method: 0, data: "FLANDRE"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "主包有 3 条目清单应命中")
	// 选对了主命名空间 → BoneCount=3（reimu+marisa+flandre），不是 1
	if model.BoneCount != 3 {
		t.Errorf("BoneCount = %d, 期望 3（应选清单最长的主命名空间 touhou，不是 credits）", model.BoneCount)
	}
	if len(pngs) != 3 {
		t.Errorf("pngs = %d, 期望 3", len(pngs))
	}
	// 守卫下方 SubModels[0] 索引
	testutil.Equal(t, len(model.SubModels), 3, "SubModels = %d, 期望 3", len(model.SubModels))
	if model.SubModels[0].Name != "灵梦" {
		t.Errorf("SubModels[0].Name = %q，期望 灵梦", model.SubModels[0].Name)
	}
}

// ③ model_id → zip 路径推断：当清单条目的 model/ texture 字段缺席时，
//
//	按"命名空间 + 候选后缀 + model_id 后缀去 namespace:"的方式还原 zip 路径。
//	这里还覆盖 fallback：清单声明了 model_id 但对应路径不存在时，
//	从该命名空间的 geoFiles 集合按 basename 模糊再匹配一次（防止后缀不匹配）。
func TestMaidL0_ModelIdPathInfer(t *testing.T) {
	manifest := `{
		"model_list": [
			{"model_id": "mypack:hero", "name": "勇者"},
			{"model_id": "mypack:heroine", "name": "女主角"}
		]
	}`
	// 故意用非常规路径：models/main/ 而不是 models/entity/ —— 触发 basename 后备匹配
	entries := []rawZipEntry{
		{name: "assets/mypack/maid_model.json", method: 0, data: manifest},
		{name: "assets/mypack/models/main/hero.json", method: 0, data: maidMiniGeo("hero", 0)},
		{name: "assets/mypack/models/main/heroine.json", method: 0, data: maidMiniGeo("heroine", 1)},
		{name: "assets/mypack/textures/hero.png", method: 0, data: "HERO"},
		{name: "assets/mypack/textures/heroine.png", method: 0, data: "HEROINE"},
		{name: "assets/mypack/models/main/junk.json", method: 0, data: maidMiniGeo("junk", 2)}, // 应排除
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "路径推断 + basename 后备应命中")
	if model.BoneCount != 2 {
		t.Errorf("BoneCount = %d, 期望 2（hero + heroine，junk 排除）", model.BoneCount)
	}
	if len(pngs) != 2 {
		t.Errorf("pngs = %d, 期望 2", len(pngs))
	}
	// 守卫下方 SubModels[0]/[1] 索引
	testutil.Equal(t, len(model.SubModels), 2, "SubModels = %d, 期望 2", len(model.SubModels))
	if model.SubModels[0].Name != "勇者" || model.SubModels[1].Name != "女主角" {
		t.Errorf("SubModels = %+v", model.SubModels)
	}
}

// ===== TestParseFromZipEntry 单 subPath 抽取单角色 Bones =====
// 策略：用 maidEntriesMixed() 构造 L0 2 角色 zip，取每个 SubModel.SourcePath，
// 调 ParseFromZipEntry(srcPath) → 应得 单 BoneCount=1（不是合并 2），且 pngs 仍全量。
func TestParseFromZipEntry(t *testing.T) {
	data := makeZipRaw(t, maidEntriesMixed())
	full, _, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, full, "合并解析应为非 nil")
	testutil.Equal(t, len(full.SubModels), 2, "SubModels = %d, 期望 2（L0）", len(full.SubModels))

	for i, sm := range full.SubModels {
		g, pngs := ParseFromZipEntry(data, int64(len(data)), sm.SourcePath)
		// 守卫下方 g.BoneCount 索引
		testutil.NotNil(t, g, "sub[%d] name=%s sourcePath=%q 未命中 geo", i, sm.Name, sm.SourcePath)
		// 角色单抽：BoneCount 应 = 1（不是合并的 2）
		if g.BoneCount != 1 {
			t.Errorf("sub[%d] BoneCount = %d, 期望 1（单模型）", i, g.BoneCount)
		}
		if len(g.Bones) != 1 {
			t.Errorf("sub[%d] len(Bones) = %d, 期望 1", i, len(g.Bones))
		}
		// pngs 仍全量（L0 清单只有 2 张纹理）
		if len(pngs) != 2 {
			t.Errorf("sub[%d] pngs = %d, 期望 2（切角色不换 PNG 集合）", i, len(pngs))
		}
	}

	// 未命中 → nil
	g, _ := ParseFromZipEntry(data, int64(len(data)), "does/not/exist.json")
	if g != nil {
		t.Errorf("未命中路径期望返回 nil, 实际 BoneCount=%d", g.BoneCount)
	}
	// subPath 空 → nil
	g, _ = ParseFromZipEntry(data, int64(len(data)), "")
	if g != nil {
		t.Errorf("空 subPath 期望返回 nil, 实际 BoneCount=%d", g.BoneCount)
	}
}

// ===== TestParseFromZipEntry_MatchDegradation 三层匹配降级 =====
// 构造 3 组形态不同的 subPath：绝对路径 / 含命名空间冒号前缀形式 / 仅 basename，
// 都应最终命中到同一个 geoFile。
func TestParseFromZipEntry_MatchDegradation(t *testing.T) {
	entries := []rawZipEntry{
		{name: "assets/droneeee/models/entity/drone.json", method: 0, data: maidMiniGeo("drone", 0)},
		{name: "assets/droneeee/textures/entity/drone.png", method: 0, data: "D"},
		// 清单没声明，但 geoFiles 也会收集（L1 兜底，collectArchiveFiles 会收）
		{name: "assets/droneeee/models/entity/satellite.geo.json", method: 0, data: maidMiniGeo("sat", 1)},
	}
	data := makeZipRaw(t, entries)

	cases := []struct {
		name    string
		subPath string
	}{
		{"1-abs", "assets/droneeee/models/entity/drone.json"},
		{"2-nsStrip 命名空间前缀剥离", "droneeee/models/entity/drone.json"}, // trimAssets 会剥离 droneeee/ → 等同
		{"3-basename 模糊", "drone"},
		{"4-basename+.json", "drone.json"},
		{"5-反斜杠 Windows 形式", "assets\\droneeee\\models\\entity\\drone.json"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g, pngs := ParseFromZipEntry(data, int64(len(data)), c.subPath)
			// 守卫下方 g.BoneCount 索引
			testutil.NotNil(t, g, "case %q subPath=%q 未命中", c.name, c.subPath)
			if g.BoneCount != 1 {
				t.Errorf("case %q BoneCount = %d", c.name, g.BoneCount)
			}
			if len(pngs) != 1 {
				t.Errorf("case %q pngs = %d, 期望 1", c.name, len(pngs))
			}
		})
	}
}

// ===== TestMatchGeoEntryBySubPath_EdgeCases =====
func TestMatchGeoEntryBySubPath_EdgeCases(t *testing.T) {
	gfs := []geoEntry{
		{name: "assets/touhou/models/reimu.geo.json", data: []byte("x")},
		{name: "assets/touhou/models/marisa.json", data: []byte("x")},
	}
	if _, ok := matchGeoEntryBySubPath(gfs, ""); ok {
		t.Error("空 subPath 应返回 ok=false")
	}
	if _, ok := matchGeoEntryBySubPath(nil, "reimu"); ok {
		t.Error("nil geoFiles 应返回 ok=false")
	}
	// 完全不相关路径
	if _, ok := matchGeoEntryBySubPath(gfs, "models/nope.json"); ok {
		t.Error("不相关 subPath 应返回 ok=false")
	}
}

// ===== 分支级锁测试：resolveL0Model / resolveL0Texture 三条此前零覆盖的路径 =====
// 定位：「L0 子域收进 struct」重构前的行为锚点补缺——以下分支若在搬迁中语义漂移，
// 现有黑盒/白盒测试均不会报警，故单独成组锁定。

// TestMaidL0_BasenameFallback_NonTemplatePath 锁定 basename 模糊回扫分支：
// model_id 的目标文件刻意放在 7 个模型候选模板 / 5 个纹理候选模板全部脱靶的
// 自定义目录下，必须走 lazyBuildBasenameIdx → nsGeoBasenames/nsPngBasenames 兜底。
// 注意：models/main/、textures/ 根目录都在候选模板覆盖内（ModelIdPathInfer 走的是
// 模板 #2/#3，并非回扫），不能拿来测本分支。
func TestMaidL0_BasenameFallback_NonTemplatePath(t *testing.T) {
	manifest := `{
		"model_list": [
			{"model_id": "mypack:hero", "name": "勇者"}
		]
	}`
	entries := []rawZipEntry{
		{name: "assets/mypack/maid_model.json", method: 0, data: manifest},
		// custom_models/ custom_textures/ 不在任何候选模板内 → 强制触发 basename 回扫
		{name: "assets/mypack/custom_models/hero.geo.json", method: 0, data: maidMiniGeo("hero", 0)},
		{name: "assets/mypack/custom_textures/hero.png", method: 0, data: "HERO"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "basename 回扫应命中，模型不应为 nil")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1（纹理也应走 basename 回扫命中）", len(pngs))
	}
	// 原复合条件拆序贯（len 守卫下方 SubModels[0] 索引）
	testutil.Equal(t, len(model.SubModels), 1, "SubModels = %+v, 期望 1 个", model.SubModels)
	testutil.Equal(t, model.SubModels[0].Name, "勇者", "SubModels = %+v, 期望 [{Name:勇者}]", model.SubModels)
	// 回扫返回的是全量小写绝对路径（lazyBuildBasenameIdx 内 low 变量）
	if model.SubModels[0].SourcePath != "assets/mypack/custom_models/hero.geo.json" {
		t.Errorf("SourcePath = %q, 期望回扫命中的小写绝对路径", model.SubModels[0].SourcePath)
	}
}

// TestMaidL0_ModelNsPrefixedExplicitPath 锁定 stripNsPrefix 混合写法分支：
// 显式路径自带本命名空间前缀（"nsBase:path"，droneeee 一类混合写法的实战形态），
// 应剥掉 "nsBase:" 后按形式 A 直接命中；纹理同理。
func TestMaidL0_ModelNsPrefixedExplicitPath(t *testing.T) {
	manifest := `{
		"model": [
			{"name": "drone",
			 "model":   "mypack:models/entity/drone.json",
			 "texture": "mypack:textures/entity/drone.png"}
		]
	}`
	entries := []rawZipEntry{
		{name: "assets/mypack/maid_model.json", method: 0, data: manifest},
		{name: "assets/mypack/models/entity/drone.json", method: 0, data: maidMiniGeo("drone", 0)},
		{name: "assets/mypack/textures/entity/drone.png", method: 0, data: "DRONE"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "带 nsBase 前缀的显式路径应命中，模型不应为 nil")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
	// 原复合条件拆序贯（len 守卫下方 SubModels[0] 索引）
	testutil.Equal(t, len(model.SubModels), 1, "SubModels = %+v, 期望 1 个", model.SubModels)
	testutil.Equal(t, model.SubModels[0].Name, "drone", "SubModels = %+v, 期望 [{Name:drone}]", model.SubModels)
	if model.SubModels[0].SourcePath != "assets/mypack/models/entity/drone.json" {
		t.Errorf("SourcePath = %q, 期望剥前缀后的形式 A 路径", model.SubModels[0].SourcePath)
	}
}

// TestMaidL0_ModelForeignNs_TreatedAsModelId 锁定「冒号前缀 ≠ 本命名空间」分支：
// item.Model 形如 "otherpack:hero" 时 stripNsPrefix 不剥（前缀不符）、形式 A 未命中，
// 应回退为 model_id 推断（resolveL0Model 的 mid 兜底），取冒号后名字部分
// 走候选字典命中本命名空间同名文件。
func TestMaidL0_ModelForeignNs_TreatedAsModelId(t *testing.T) {
	manifest := `{
		"model": [
			{"name": "foreign", "model": "otherpack:hero", "texture": "textures/entity/hero.png"}
		]
	}`
	entries := []rawZipEntry{
		{name: "assets/mypack/maid_model.json", method: 0, data: manifest},
		{name: "assets/mypack/models/entity/hero.json", method: 0, data: maidMiniGeo("hero", 0)},
		{name: "assets/mypack/textures/entity/hero.png", method: 0, data: "HERO"},
	}
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	testutil.NotNil(t, model, "外来命名空间冒号写法应经 model_id 推断命中，模型不应为 nil")
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
	// 原复合条件拆序贯（len 守卫下方 SubModels[0] 索引）
	testutil.Equal(t, len(model.SubModels), 1, "SubModels = %+v, 期望 1 个", model.SubModels)
	testutil.Equal(t, model.SubModels[0].Name, "foreign", "SubModels = %+v, 期望 [{Name:foreign}]", model.SubModels)
	if model.SubModels[0].SourcePath != "assets/mypack/models/entity/hero.json" {
		t.Errorf("SourcePath = %q, 期望候选字典命中的 hero.json", model.SubModels[0].SourcePath)
	}
}

// ===== L0 升格纯工具函数单测（TDD，先补绿再动刀）=====

func TestL0_StripNsPrefix_AllBranches(t *testing.T) {
	// 动态构造"当前平台原生绝对路径"：避免写死 Unix / Windows 任一方的格式。
	// （filepath.IsAbs 在 Windows 上对 "/tmp/x.json" 返回 false，不能拿来写死。）
	cwd, err := filepath.Abs(".")
	testutil.NoError(t, err, "filepath.Abs 失败")
	// 用真实目录拼接出干净的平台原生绝对路径（Unix: /…/platform/abs.json，
	// Windows: C:\…\platform\abs.json）。此前 cwd[:1]+":\platform\abs.json" 在 Unix
	// 会拼出垃圾路径 /:\platform\abs.json，且 IsAbs fallback 在所有平台都不可达。
	platformAbs := filepath.Join(filepath.Dir(cwd), "platform", "abs.json")
	platformAbsValue := "mypack:" + platformAbs
	wantPlatformAbs := platformAbsValue // 绝对路径后缀，不剥

	tests := []struct {
		name   string
		value  string
		nsBase string
		want   string
	}{
		{"空值透传", "", "mypack", ""},
		{"nsBase 空透传", "models/a.json", "", "models/a.json"},
		{"前缀匹配·非绝对路径·剥", "droneeee:models/entity/x.json", "droneeee", "models/entity/x.json"},
		{"前缀匹配·后缀原生绝对路径·不剥", platformAbsValue, "mypack", wantPlatformAbs},
		{"前缀不匹配·不剥", "other:models/a.json", "mypack", "other:models/a.json"},
		{"无冒号·透传", "models/a.json", "mypack", "models/a.json"},
		{"前缀匹配·下一段开头带冒号", "ns:sub:rest", "ns", "sub:rest"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := l0StripNsPrefix(tt.value, tt.nsBase)
			if got != tt.want {
				t.Errorf("l0StripNsPrefix(%q, %q) = %q, want %q", tt.value, tt.nsBase, got, tt.want)
			}
		})
	}
}

func TestL0_ExtractName_AllBranches(t *testing.T) {
	tests := []struct {
		name     string
		modelID  string
		fallback string
		want     string
	}{
		{"modelID 空·回退 fallback", "", "fb", "fb"},
		{"标准 ns:name", "mypack:hero", "fb", "hero"},
		{"无冒号·整体作 name", "hero", "fb", "hero"},
		{"多冒号·只切第一段", "a:b:c", "fb", "b:c"},
		{"冒号开头·空前缀", ":ghost", "fb", "ghost"},
		{"冒号结尾·空 name", "mypack:", "fb", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := l0ExtractName(tt.modelID, tt.fallback)
			if got != tt.want {
				t.Errorf("l0ExtractName(%q, %q) = %q, want %q", tt.modelID, tt.fallback, got, tt.want)
			}
		})
	}
}
