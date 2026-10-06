// ===== 拆解护栏（gocyclo 存量债清偿前建立）=====
// 本文件在拆解 scanHeader / parsePlayerModel / appendAnimGroupsAndConfigs 之前写好，
// 先对**未拆解实现**跑绿，再拆——拆解只许搬运代码，不许改变这里的任何断言。
//
// 为什么需要它（三个函数都有间接覆盖，但断言强度不足）：
//   - scanHeader：header_test.go 覆盖了「正常头部」的全字段，但没钉「行分派归属」——
//     缩进 `<name>` 归作者还是元数据、`--- [Export]` 段吞不吞字段、tips 段里的
//     `<tag>` 行进不进 tips。这些正是拆解要提取的边界。
//   - parsePlayerModel：经 FindGeometry/FindComponents 有大量间接覆盖（断言的是
//     **消费方规范化后**的产物），本文件直接钉它自己的契约——**抛回原始值不裁剪**，
//     以及 model map 写入序 / mapOrig / filesObj 三件此前无任何直接断言的产出。
//   - appendAnimGroupsAndConfigs：parity golden 只对账了「已分类组 + 显式 name」，
//     `_loose` 兜底组、`#id` 查名、已分类项排除三条路径**零断言**。
package ysm

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// ===== scanHeader：行分派归属 =====

// 缩进的 `<name>` 不满足「行首即 <」的首个 `<` 分支，必须落到作者块；
// 且 `--- [Metadata]` 段内的 `<name>` 因「段已选定」规则不得回写 AuthorName。
func TestScanHeader_IndentedTagGoesToAuthorNotMetadata(t *testing.T) {
	input := "YSGP\n  <name>IndentedAuthor</name>\n--- [Metadata]\n<name>MetaName</name>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if h.Name != "MetaName" {
		t.Errorf("Name = %q, want MetaName（Metadata 段字段）", h.Name)
	}
	if h.AuthorName != "IndentedAuthor" {
		t.Errorf("AuthorName = %q, want IndentedAuthor（缩进行落作者块）——"+
			"若为 MetaName 说明段内 <name> 回写了作者字段", h.AuthorName)
	}
}

// `--- [Tips]` 段内形如 `<tag>value` 的行被「段已选定」规则整体吞掉：
// 既不入 tips 文本，也不落作者块。
func TestScanHeader_SectionTagLineConsumedNotTips(t *testing.T) {
	input := "YSGP\n--- [Tips]\n<name>TipName</name>\nplain tip\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if strings.Contains(h.Tips, "TipName") {
		t.Errorf("Tips = %q 不应含 TipName——段内 <tag> 行须被吞掉", h.Tips)
	}
	if h.Tips != "plain tip" {
		t.Errorf("Tips = %q, want %q", h.Tips, "plain tip")
	}
	if h.AuthorName != "" {
		t.Errorf("AuthorName = %q, want \"\"——段内行不得落作者块", h.AuthorName)
	}
}

// 未知段名走 default 清空 currentSection，其后非标签行成为 preamble（→ Tips）。
func TestScanHeader_UnknownSectionResetsToPreamble(t *testing.T) {
	input := "YSGP\n--- [Metadata]\n<name>Known</name>\n--- [Weird]\nloose line\n<unknown-tag>v</unknown-tag>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if h.Name != "Known" {
		t.Errorf("Name = %q, want Known", h.Name)
	}
	want := "loose line\n<unknown-tag>v</unknown-tag>"
	if h.Tips != want {
		t.Errorf("Tips = %q, want %q（未知段后清空 → 两行都进 preamble）", h.Tips, want)
	}
}

// `--- [Export]` 段无字段（吞标签）；`<format>/<crypto>` 只在 `--- [Codec]` 段生效；
// `--- [Source]`（SHA-256/Source 特征）同样吞标签且不得泄漏进 Tips。
func TestScanHeader_ExportAndSourceSectionsSwallowTags(t *testing.T) {
	input := "YSGP\n--- [Export]\n<format>9</format>\n<crypto>9</crypto>\n" +
		"--- [Codec]\n<format>3</format>\n" +
		"--- [Source]\n<sha-256>deadbeef</sha-256>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if h.Format != 3 {
		t.Errorf("Format = %d, want 3（Export 段的 9 必须被吞，Codec 段才生效）", h.Format)
	}
	if h.Crypto != 0 {
		t.Errorf("Crypto = %d, want 0（Export 段无 crypto 字段）", h.Crypto)
	}
	if h.Tips != "" {
		t.Errorf("Tips = %q, want \"\"（Export/Source 段行不得进 preamble）", h.Tips)
	}
}

// `<free>false</free>` → HasFree=true 但 IsFree=false（标签存在性 ≠ 值）；
// 作者块 `<name>` 只填首个非空（后续不覆盖）。
func TestScanHeader_FreeFalseAndAuthorNameFirstWins(t *testing.T) {
	input := "YSGP\n--- [Metadata]\n<free>false</free>\n" +
		"--- [Authors]\n<name>First</name>\n<name>Second</name>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if !h.HasFree {
		t.Error("HasFree should be true（<free> 标签存在）")
	}
	if h.IsFree {
		t.Error("IsFree should be false（值为 false）")
	}
	if h.AuthorName != "First" {
		t.Errorf("AuthorName = %q, want First（后者不得覆盖前者）", h.AuthorName)
	}
}

// 空 `<license>` 不得清空已解析到的 license（空值是「未声明」而非「置空」）。
func TestScanHeader_EmptyLicenseDoesNotClobber(t *testing.T) {
	input := "YSGP\n--- [Metadata]\n<license>MIT</license>\n<license></license>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if h.License != "MIT" {
		t.Errorf("License = %q, want MIT（空标签不得置空）", h.License)
	}
}

// ===== parsePlayerModel：原始声明契约 =====

// parsePlayerModel 的契约是「抛回原始值，规范化留消费方」：不得去扩展名、不得转小写、
// 不得把反斜杠转成正斜杠，且必须保留来源标记 isStr；model map 必须保 JSON 写入序。
func TestParsePlayerModel_RawDeclarationsNotNormalized(t *testing.T) {
	data := []byte(`{"spec":2,"files":{
		"player":{
			"model":{"main":"models/Main.GEO.JSON","arm":"models\\Arm.json"},
			"texture":[{"uv":"Textures\\Skin.PNG"},"Sub/Other.JPG"]
		},
		"projectiles":[{"match":["x"],"model":"models/p.json"}]
	}}`)

	pm := parsePlayerModel(data)
	if pm == nil {
		t.Fatal("parsePlayerModel 不应返回 nil")
	}

	// model map：写入序（main 先声明）必须保序
	if want := []string{"models/Main.GEO.JSON", `models\Arm.json`}; !reflect.DeepEqual(pm.names, want) {
		t.Errorf("names = %q, want %q（写入序丢失或值被规范化）", pm.names, want)
	}
	if pm.mapOrig["main"] != "models/Main.GEO.JSON" || pm.mapOrig["arm"] != `models\Arm.json` {
		t.Errorf("mapOrig = %v, want main/arm 两键原值", pm.mapOrig)
	}
	if len(pm.mapOrig) != 2 {
		t.Errorf("mapOrig 键数 = %d, want 2", len(pm.mapOrig))
	}

	// texture：原始值 + 来源标记，一律不得裁剪/去扩展名/转小写
	want := []texDeclItem{
		{value: `Textures\Skin.PNG`},
		{value: "Sub/Other.JPG", isStr: true},
	}
	if !reflect.DeepEqual(pm.texDecl, want) {
		t.Errorf("texDecl = %+v, want %+v（原始值契约被破坏）", pm.texDecl, want)
	}

	// filesObj 保留 player 之外的全部段（projectiles/vehicles 供 Components 消费）
	if _, ok := pm.filesObj["projectiles"]; !ok {
		t.Errorf("filesObj 应保留 projectiles 段, got keys %v", keysOf(pm.filesObj))
	}
}

// model map 的非字符串 value（数字/对象）Decode 报错但不得 break——
// 后续好键（main/arm）必须全保留，坏键不写进 mapOrig。
func TestParsePlayerModel_NonStringMapValueKeepsLaterKeys(t *testing.T) {
	data := []byte(`{"files":{"player":{"model":{"bad":123,"main":"models/main.json","boom":{"a":1},"arm":"models/arm.json"}}}}`)

	pm := parsePlayerModel(data)
	if pm == nil {
		t.Fatal("parsePlayerModel 不应返回 nil")
	}
	if want := []string{"models/main.json", "models/arm.json"}; !reflect.DeepEqual(pm.names, want) {
		t.Errorf("names = %q, want %q（坏值后必须 continue 而非 break）", pm.names, want)
	}
	if len(pm.mapOrig) != 2 || pm.mapOrig["main"] == "" || pm.mapOrig["arm"] == "" {
		t.Errorf("mapOrig = %v, want 仅 main/arm", pm.mapOrig)
	}
}

// 裸字符串 model 走 default 分支去引号；map 形态之外不得设 mapOrig。
func TestParsePlayerModel_BareStringModel(t *testing.T) {
	pm := parsePlayerModel([]byte(`{"files":{"player":{"model":"models/main.json"}}}`))
	if pm == nil {
		t.Fatal("parsePlayerModel 不应返回 nil")
	}
	if want := []string{"models/main.json"}; !reflect.DeepEqual(pm.names, want) {
		t.Errorf("names = %q, want %q（裸字符串应去引号入 names）", pm.names, want)
	}
	if pm.mapOrig != nil {
		t.Errorf("mapOrig = %v, want nil（非 map 分支不得设）", pm.mapOrig)
	}
}

// files.player 畸形（非对象）：解析失败只跳过该段，filesObj 仍须可供其他段消费。
func TestParsePlayerModel_MalformedPlayerKeepsFilesObj(t *testing.T) {
	pm := parsePlayerModel([]byte(`{"files":{"player":"not-an-object","projectiles":[]}}`))
	if pm == nil {
		t.Fatal("player 段畸形不应返回 nil（filesObj 仍可供其他段消费）")
	}
	if pm.names != nil || pm.mapOrig != nil || pm.texDecl != nil {
		t.Errorf("畸形 player 不得产出任何字段, got names=%v mapOrig=%v texDecl=%v",
			pm.names, pm.mapOrig, pm.texDecl)
	}
	if _, ok := pm.filesObj["projectiles"]; !ok {
		t.Errorf("filesObj 应保留 projectiles 段, got keys %v", keysOf(pm.filesObj))
	}
}

// 整份 ysm.json 非法 / files 非对象 → nil（调用方据此走 fallback 链）。
func TestParsePlayerModel_InvalidJSONReturnsNil(t *testing.T) {
	if pm := parsePlayerModel([]byte("{not json")); pm != nil {
		t.Errorf("非法 JSON 应返回 nil, got %+v", pm)
	}
	if pm := parsePlayerModel([]byte(`{"files":"not-an-object"}`)); pm != nil {
		t.Errorf("files 非对象应返回 nil, got %+v", pm)
	}
}

func keysOf(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ===== appendAnimGroupsAndConfigs：分组归属 / 顺序 / 名称回退 =====

// 覆盖 parity golden 未触及的三条路径：
//  1. classify 组 name 为空 → 按 "#"+ID 到 properties.extra_animation 查中文名；
//  2. `_loose` 兜底组：未分类的直接动画（非 # 键、非已分类、字符串值、非空非 #）；
//  3. 排序固定（按键升序）与「已分类项不得重复出现在 _loose」。
func TestAppendAnimGroupsAndConfigs_LooseGroupAndNameFallback(t *testing.T) {
	const payload = `{
	  "spec": 2,
	  "metadata": {"name": "anim"},
	  "properties": {
	    "extra_animation": {
	      "#sit": "坐姿",
	      "walk": "走路",
	      "idle": "待机",
	      "zzz": "末位动画",
	      "aaa": "首位动画",
	      "empty": "",
	      "ref": "#sit",
	      "num": 42
	    },
	    "extra_animation_classify": [
	      {"id": "sit", "extra_animation": {"walk": "走路"}}
	    ],
	    "extra_animation_buttons": [
	      {"id": "b1", "name": "菜单", "config_forms": [{"type": "slider"}, {"type": "toggle"}]}
	    ]
	  },
	  "files": {"player": {"model": [], "texture": []}}
	}`

	path := filepath.Join(t.TempDir(), "model.json")
	if err := os.WriteFile(path, []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}

	wantGroups := []AnimGroup{
		// name 空 → 经 "#sit" 查到 "坐姿"
		{ID: "sit", Name: "坐姿", Items: []string{"走路"}},
		// 兜底组：walk 已被分类排除；#sit 键跳过；empty 空值跳过；ref 值为 # 跳过；
		// num 非字符串跳过；余下 aaa/idle/zzz 按键升序
		{ID: "_loose", Name: "其他动画", Items: []string{"首位动画", "待机", "末位动画"}},
	}
	if !reflect.DeepEqual(sum.AnimGroups, wantGroups) {
		t.Errorf("AnimGroups = %+v\n           want %+v", sum.AnimGroups, wantGroups)
	}

	wantMenus := []ConfigMenu{{ID: "b1", Name: "菜单", Controls: []string{"slider", "toggle"}}}
	if !reflect.DeepEqual(sum.ConfigMenus, wantMenus) {
		t.Errorf("ConfigMenus = %+v, want %+v", sum.ConfigMenus, wantMenus)
	}
}

// classify 组的 items 全是内部引用（# 开头）时整组跳过，且该组不得阻断后续组。
func TestAppendAnimGroupsAndConfigs_AllInternalRefsGroupSkipped(t *testing.T) {
	const payload = `{
	  "spec": 2,
	  "metadata": {"name": "refs"},
	  "properties": {
	    "extra_animation": {"#a": "甲", "#b": "乙", "solo": "独奏"},
	    "extra_animation_classify": [
	      {"id": "onlyrefs", "name": "内部组", "extra_animation": {"x": "#a", "y": "#b"}},
	      {"id": "real", "name": "实组", "extra_animation": {"z": "实项"}}
	    ]
	  },
	  "files": {"player": {"model": [], "texture": []}}
	}`

	path := filepath.Join(t.TempDir(), "model.json")
	if err := os.WriteFile(path, []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}

	want := []AnimGroup{
		{ID: "real", Name: "实组", Items: []string{"实项"}},
		{ID: "_loose", Name: "其他动画", Items: []string{"独奏"}},
	}
	if !reflect.DeepEqual(sum.AnimGroups, want) {
		t.Errorf("AnimGroups = %+v\n           want %+v（内部引用组须整组跳过）", sum.AnimGroups, want)
	}
}
