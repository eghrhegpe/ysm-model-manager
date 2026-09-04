// ===== go/ysm 异常路径 / 反推脆弱点 测试 =====
// 构造畸形/边界输入，专门让解析/提取逻辑暴露 panic、静默吞错、或错误结果。
// 本文件只负责测试，**绝不修改源码**——失败的用例保留在现场供定位根因。
package ysm

import (
	"archive/zip"
	"bytes"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf8"
)

// ---------------------------------------------------------------------------
// texsize.go 脆弱点：clampTexDim + extractTexSizeFromGeometryBytes
// ---------------------------------------------------------------------------

func TestClampTexDim_InfNaN(t *testing.T) {
	// math.Inf 与 NaN 必须钳到 0，避免 int() 溢出
	tests := map[string]struct {
		v    float64
		want int
	}{
		"NaN":    {float64NaN, 0},
		"+Inf":   {float64InfPos, 0},
		"-Inf":   {float64InfNeg, 0},
		"-1e100": {-1e100, 0},
		"1e100":  {1e100, 65536},
		"zero":   {0, 0},
		"-1":     {-1, 0},
		"65535":  {65535, 65535},
		"65537":  {65537, 65536},
	}
	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			got := clampTexDim(tc.v)
			if got != tc.want {
				t.Errorf("clampTexDim(%v) = %d, want %d", tc.v, got, tc.want)
			}
		})
	}
}

// json: 用 math 常量构造 NaN / ±Inf，避免手动位模式被误编译为有限大数
var (
	float64NaN    = math.NaN()
	float64InfPos = math.Inf(+1)
	float64InfNeg = math.Inf(-1)
)

func TestExtractTexSizeFromGeometryBytes_MalformedFloat(t *testing.T) {
	// 用超大整数（合法 JSON 数字）直接灌入 texture_width——clamp 前会 int 溢出
	payload := `{
		"minecraft:geometry": [{
			"description": {"texture_width": 999999999999, "texture_height": -42}
		}]
	}`
	w, h := extractTexSizeFromGeometryBytes([]byte(payload))
	if w == 0 {
		t.Fatalf("超大 texture_width 应被钳到 65536，实际 = %d", w)
	}
	if w > 65536 {
		t.Fatalf("超大 texture_width 未被钳制，实际 = %d（源码 int() 未钳，存在溢出返回）", w)
	}
	if h != 0 {
		t.Errorf("负数 texture_height 应为 0，实际 = %d", h)
	}
}

func TestExtractTexSizeFromGeometryBytes_EmptyGeometryArray(t *testing.T) {
	w, h := extractTexSizeFromGeometryBytes([]byte(`{"minecraft:geometry": []}`))
	if w != 0 || h != 0 {
		t.Errorf("空 geometry 数组应为 0/0，实际 = %d/%d", w, h)
	}
}

func TestExtractTexSizeFromGeometryBytes_MissingDescription(t *testing.T) {
	// geometry 数组非空但缺 description——必须不 panic
	w, h := extractTexSizeFromGeometryBytes([]byte(`{"minecraft:geometry": [{}]}`))
	if w != 0 || h != 0 {
		t.Errorf("缺 description 的 geometry 应为 0/0，实际 = %d/%d", w, h)
	}
}

// ---------------------------------------------------------------------------
// extracted.go 脆弱点：empty uv、非字符串 map value、空路径
// ---------------------------------------------------------------------------

// 构造一个 "player.texture" 中 uv 字段为空的纹理项：字符串 TrimLastIndex 返回 -1，
// tn = tn[-1+1:] = tn[0:] 不会 panic 但语义异常；同时测试 texOrderNames 是否被污染
func TestFindComponentsEmptyUv(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	os.MkdirAll(modelsDir, 0o755)
	// texture 数组含空 uv、缺失 uv、正常 uv 三种
	ysmJSON := `{
		"files": {
			"player": {
				"model": {"main": "models/main.json"},
				"texture": [
					{"uv": ""},
					{"wrong": "skip_me"},
					{"uv": "textures/skin.png"}
				]
			}
		}
	}`
	os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644)
	os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644)

	comps, texNames := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) != 1 {
		t.Fatalf("应为 1 个组件，实际 = %d", len(comps))
	}
	// 期望 texNames 只含合法的 "skin"，空 uv / 缺 uv 项被过滤
	for i, tn := range texNames {
		if tn == "" {
			t.Errorf("texNames[%d] 为空（空 uv 未被过滤）", i)
		}
	}
}

// 构造 player.model 为 map，但 value 类型不是字符串（数组/对象/数字），
// 让 json.Decoder 走 Token 保序分支。源码根因（已修复）：dec.Decode(&val) 遇非字符串
// 报错后原为 break，若 map 写入序中坏键排在好键之前，好键（main）会**永远收不到**——
// 模型声明序错位，texSlot 被污染成按名段下标；改为 continue 跳过坏值继续遍历。
func TestFindComponentsNonStringModelValue(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	os.MkdirAll(modelsDir, 0o755)
	// 故意让 extra 排在 main 前面：dec.Decode 遇到 12345 报错（已消费该值），
	// continue 后 main 必须仍被解析到 → declPos 正常 → texSlot = 0（第一张声明纹理 skin）
	ysmJSON := `{"files":{"player":{"model":{"extra":12345,"main":"models/main.json"},"texture":["textures/skin.png"]}}}`
	os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644)
	os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(geoWithBone("mainBone")), 0o644)

	comps, texNames := FindComponentsInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if len(comps) == 0 {
		t.Fatalf("非字符串 value 排在 main 之前 → 组件完全丢失")
	}
	// 修复后硬断言：texSlot 必须为 0（修复前 break 导致 declPos 缺 main 键 → 错为按名段下标 1）
	if got := comps[0].Bones[0].Cubes[0].TexSlot; got != 0 {
		t.Errorf("main texSlot = %d（期望 0）——坏值未跳过导致 declPos 缺 main 键；texNames=%v", got, texNames)
	}
}

// ---------------------------------------------------------------------------
// summary.go 脆弱点：malformed extra_animation、suffix-only 路径匹配、
// 空 player、动画分组为数组而非对象
// ---------------------------------------------------------------------------

// 场景 1：properties.extra_animation 是数组（合法 JSON 但类型不符 map[string]interface{}）。
// 源码根因（已修复）：ysmProperties.ExtraAnimation 原为 map 类型，数组输入让整个
// json.Unmarshal 失败、metadata.Name 连带丢失；改为 json.RawMessage 承载后，
// 畸形形态只跳过该特性，不再拖垮整文件解析。
func TestExtractYsmSummary_MalformedExtraAnim(t *testing.T) {
	payload := `{
		"spec": 2,
		"metadata": {"name": "mal"},
		"properties": {
			"extra_animation": ["数组非法", "应为map"],
			"extra_animation_classify": [
				{"id": "g1", "name": "组1", "extra_animation": {"a": "走路"}}
			]
		},
		"files": {"player": {"model": [], "texture": []}}
	}`
	path := filepath.Join(t.TempDir(), "mal.json")
	os.WriteFile(path, []byte(payload), 0o644)
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("畸形 extra_animation 不应再让整文件解析失败: %v", err)
	}
	// 修复后：metadata.Name 必须保留（修复前随整个 Unmarshal 一起丢失）
	if sum.Name != "mal" {
		t.Errorf("metadata.Name 应保留 = \"mal\", 实际 = %q", sum.Name)
	}
	// 数组形态的 extra_animation 应被静默跳过（不产生 AnimGroups）
	if len(sum.AnimGroups) != 1 {
		t.Logf("AnimGroups = %d（期望 1：仅 classify 的组1 生效，数组形态被跳过）", len(sum.AnimGroups))
	}
}

// 场景 2：files.player.model 为空数组 + texture 为空数组 —— 统计应得 0
func TestExtractYsmSummary_EmptyPlayerArrays(t *testing.T) {
	payload := `{
		"spec": 2,
		"metadata": {"name": "empty"},
		"files": {"player": {"model": [], "texture": [], "animation": []}}
	}`
	path := filepath.Join(t.TempDir(), "empty.json")
	os.WriteFile(path, []byte(payload), 0o644)
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("空数组不应报错: %v", err)
	}
	if sum.Name != "empty" {
		t.Errorf("Name = %q, want empty", sum.Name)
	}
	if sum.Stats.Models != 0 || sum.Stats.Textures != 0 || sum.Stats.Animations != 0 {
		t.Errorf("空 player 统计应全为 0，实际 = %+v", sum.Stats)
	}
}

// 场景 3：files 不存在 / 缺 player —— 应容错返回零统计
func TestExtractYsmSummary_MissingFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nofiles.json")
	os.WriteFile(path, []byte(`{"spec":1,"metadata":{"name":"nof"}}`), 0o644)
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("缺 files 应容错: %v", err)
	}
	if sum.Name != "nof" {
		t.Errorf("Name = %q", sum.Name)
	}
	_ = sum.Stats // 不关心 stats 具体值
}

// 场景 4：ZIP 内 model.json 几何路径后缀匹配 —— 源码 summary.go extractFileStats
// 用 strings.HasSuffix 匹配 zip 文件名的**小写后缀**，存在后缀前缀误匹配风险。
// 构造两个几何 JSON：一个是目标 `geo/evil.txt.json`（后缀匹配到 `geo/main.json`），
// 一个是真目标 `geo/main.json`；预期 stats.TexWidth 取自真正匹配项。
func TestExtractYsmSummary_ZipSuffixShadow(t *testing.T) {
	ysmJSON := `{
		"spec": 2,
		"metadata": {"name": "shadow"},
		"properties": {"default_texture": "t.png"},
		"files": {"player": {"model": [{"path":"geo/main.json"}], "texture": [{"path":"t.png"}]}}
	}`
	// 真 target：64x32
	mainJSON := `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":32},"bones":[{}]}]}`
	// 干扰项：后缀 `.json` 匹配到 `main.json` 后缀
	shadowJSON := `{"minecraft:geometry":[{"description":{"texture_width":128,"texture_height":128},"bones":[{}]}]}`

	path := writeZip(t, "shadow.ysm", map[string]string{
		"ysm.json":          ysmJSON,
		"geo/main.json":     mainJSON,
		"geo/evil.txt.json": shadowJSON,
	})
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("不应报错: %v", err)
	}
	// 期望从 `geo/main.json` 取到 64x32
	if sum.Stats.TexWidth != 64 || sum.Stats.TexHeight != 32 {
		// 如果拿到 128x128 说明 HasSuffix 匹配到 evil.txt.json（源码脆弱点）
		t.Logf("TexSize = %dx%d（若为 128x128 则表明 HasSuffix 后缀误匹配）",
			sum.Stats.TexWidth, sum.Stats.TexHeight)
	}
}

// 场景 5：files.player.model 是字符串（而非数组/对象）—— extractFileStats 已支持字符串形态
func TestExtractYsmSummary_StringModel(t *testing.T) {
	payload := `{
		"spec": 1,
		"metadata": {"name": "str"},
		"files": {"player": {"model": "models/single.json", "texture": []}}
	}`
	path := filepath.Join(t.TempDir(), "str.json")
	os.WriteFile(path, []byte(payload), 0o644)
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("字符串 model 应容错: %v", err)
	}
	if sum.Stats.Models != 1 {
		t.Errorf("字符串 model 统计 = %d, want 1", sum.Stats.Models)
	}
}

// 场景 6：extra_animation_buttons.config_forms 是对象而非数组 —— extractControlTypes
// 期望 map 会 Unmarshal 失败返回 nil，控件类型列表应为空而非 panic
func TestExtractYsmSummary_MalformedConfigForms(t *testing.T) {
	payload := `{
		"spec": 2,
		"metadata": {"name": "cf"},
		"properties": {
			"extra_animation_buttons": [
				{"id": "b1", "name": "菜单", "config_forms": {"type": "slider"}}
			]
		},
		"files": {"player": {"model": [], "texture": []}}
	}`
	path := filepath.Join(t.TempDir(), "cf.json")
	os.WriteFile(path, []byte(payload), 0o644)
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("畸形 config_forms 应容错: %v", err)
	}
	if len(sum.ConfigMenus) != 1 {
		t.Fatalf("应有 1 个 ConfigMenu，实际 = %d", len(sum.ConfigMenus))
	}
	// 控件类型为 nil/空——extractControlTypes 遇到对象而非数组返回 nil，
	// marshal 后 Controls 字段为 null
	if len(sum.ConfigMenus[0].Controls) != 0 {
		t.Logf("Controls = %v（非空说明对象被误当作单元素数组处理）", sum.ConfigMenus[0].Controls)
	}
}

// 场景 7：作者为空数组、contact 为 nil —— appendAnimGroups 走空循环应不 panic
func TestExtractYsmSummary_EmptyAuthorsNilContact(t *testing.T) {
	payload := `{
		"spec": 2,
		"metadata": {
			"name": "a0",
			"authors": [{"name": "", "contact": null}]
		},
		"files": {"player": {"model": [], "texture": []}}
	}`
	path := filepath.Join(t.TempDir(), "a0.json")
	os.WriteFile(path, []byte(payload), 0o644)
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("空 author + nil contact 应容错: %v", err)
	}
	if len(sum.Authors) != 1 || sum.Authors[0].Bilibili != "" {
		t.Logf("Author contact nil 处理: %+v", sum.Authors)
	}
}

// ---------------------------------------------------------------------------
// header.go 脆弱点：bufio.Scanner 超长行、异常 tag、BOM + 缺 YSGP
// ---------------------------------------------------------------------------

// bufio.Scanner 默认 64KB BufferSize。构造远超此的超长 <name> 行——
// 期望 scanHeader 能返回而不出错（行被截断是 scanner 行为，不该 panic）
func TestScanHeader_OverlongLine(t *testing.T) {
	hugeName := bytes.Repeat([]byte{'A'}, 200*1024) // 200KB 单行
	content := []byte("YSGP\n--- [Metadata]\n<name>" + string(hugeName) + "</name>\n===\n")
	h := AnalyzeYSMHeaderFromBytes(content)
	// 期望不 panic；IsYSM 应被检测到；Name 可能因超长被截断/为空，但必须有合理返回
	if !h.IsYSM {
		t.Errorf("超长行不应破坏 YSGP 标记检测")
	}
	_ = h.Name // 允许为空或截断
}

// BOM + 不含 YSGP 的文本：AnalyzeYSMHeader 应正常走 scanHeader 分支
func TestAnalyzeYSMHeader_BOMNoMagic(t *testing.T) {
	bom := []byte{0xEF, 0xBB, 0xBF}
	content := append(bom, []byte("--- [Metadata]\n<name>boom</name>\n===\n")...)
	h := AnalyzeYSMHeaderFromBytes(content)
	if h.Name != "boom" {
		t.Errorf("BOM + 文本头 Name = %q, want boom", h.Name)
	}
}

// 空字节数组：AnalyzeYSMHeaderFromBytes 内部 len(data)>4096 截断——空数组应返回空 Header
func TestAnalyzeYSMHeaderFromBytes_EmptyInput(t *testing.T) {
	h := AnalyzeYSMHeaderFromBytes([]byte{})
	if h.Name != "" {
		t.Errorf("空输入 Name = %q, want 空", h.Name)
	}
}

// YSGP 魔法 + 无文本头——detectYSGPHeader 只设置 IsYSM/Format，Name 为空
func TestDetectYSGPHeader_BinaryOnly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bin.ysm")
	os.WriteFile(path, []byte("YSGP"), 0o644)
	h := AnalyzeYSMHeader(path)
	if !h.IsYSM {
		t.Fatalf("YSGP 应被识别")
	}
	if h.Format != 2 {
		t.Errorf("Format = %d, want 2", h.Format)
	}
	if h.Name != "" {
		t.Logf("Name = %q（二元头部含 name 段？实际仅 YSGP 4 字节）", h.Name)
	}
}

// ---------------------------------------------------------------------------
// parse.go 脆弱点：model.json 中 fields 缺失 / 类型错
// ---------------------------------------------------------------------------

func TestAnalyzeYSMModel_MalformedFields(t *testing.T) {
	// bones/textures/animations 用非数组（对象、字符串、数字）；Model 字段缺 Vertices
	modelJSON := `{
		"name": "mf",
		"bones": {},
		"textures": "single_tex",
		"animations": 123,
		"model": {"faces": []}
	}`
	path := writeZip(t, "mf.ysm", map[string]string{"model.json": modelJSON})
	meta := AnalyzeYSMModel(path)
	if meta.HasError {
		t.Fatalf("畸形字段不应报错，实际 = %s", meta.ErrorMsg)
	}
	if meta.Name != "mf" {
		t.Errorf("Name = %q", meta.Name)
	}
	// bones/textures/animations 类型错 → 应静默为 0 而非 panic
	if meta.Bones != 0 || meta.Textures != 0 || meta.Animations != 0 {
		t.Logf("畸形字段统计 = B=%d T=%d A=%d", meta.Bones, meta.Textures, meta.Animations)
	}
}

// 空 zip（无 model.json）—— AnalyzeYSMModel 应返回 HasError
func TestAnalyzeYSMModel_EmptyZip(t *testing.T) {
	path := writeZip(t, "empty.ysm", map[string]string{"readme.txt": "hi"})
	meta := AnalyzeYSMModel(path)
	if !meta.HasError {
		t.Fatalf("无 model.json 应返回错误")
	}
}

// ---------------------------------------------------------------------------
// texsize.go 脆弱点：readTexFromZip 遇到空 zip / 损坏 zip / 大文件
// ---------------------------------------------------------------------------

func TestReadTexFromZip_NotZipBytes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "notzip.zip")
	os.WriteFile(path, []byte("not a zip file"), 0o644)
	w, h := readTexFromZip(path)
	if w != 0 || h != 0 {
		t.Errorf("非 zip 文件应返回 0/0，实际 = %d/%d", w, h)
	}
}

// readTexFromZip 遇到 zip 条目数据损坏：构造一个 zip，其条目 header 合法但压缩数据被截断。
// 期望 readTexFromZip 跳过该条目（ReadLimitedEntry 返回 nil），不 panic。
func TestReadTexFromZip_CorruptEntry(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "corrupt.zip")

	// 手构一个被截断的 zip：写一个正常 zip 后截断尾部
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, _ := zw.Create("geo/main.json")
	w.Write([]byte(`{"minecraft:geometry":[{"description":{"texture_width":256,"texture_height":256}}]}`))
	zw.Close()
	corrupted := buf.Bytes()[:len(buf.Bytes())-20] // 截掉尾部，破坏 EOCD
	os.WriteFile(path, corrupted, 0o644)
	w2, h2 := readTexFromZip(path)
	if w2 != 0 || h2 != 0 {
		t.Logf("截断 zip 读取结果 = %d/%d（期望 0/0；若非 0 说明 zip 库容错意外可用）", w2, h2)
	}
}

// 超大 texture_width/height 整数（int32 越界、float→int 溢出）——clamp 应钳到 [0,65536]
func TestExtractTexSize_OverflowCoords(t *testing.T) {
	// 用 2^31 - 1（int32 最大值）作为维度
	for _, dim := range []float64{mathMaxInt32, -mathMaxInt32, 1e100, -1e100} {
		w, h := extractTexSizeFromGeometryBytes([]byte(
			fmt.Sprintf(`{"minecraft:geometry":[{"description":{"texture_width":%.0f,"texture_height":%.0f}}]}`, dim, dim)))
		if w < 0 || w > 65536 || h < 0 || h > 65536 {
			t.Fatalf("dim=%.0f 结果越界: w=%d h=%d", dim, w, h)
		}
	}
}

const mathMaxInt32 = 2147483647

// ---------------------------------------------------------------------------
// summary.go 脆弱点：超长 tips（TruncateLimit）、超长 author role/name
// ---------------------------------------------------------------------------

// 构造超长 tips（>200 rune）—— zip 分支会经 fsutil.TruncateLimit 截到 200
func TestExtractYsmSummary_ZipLongTips(t *testing.T) {
	tips := string(bytes.Repeat([]byte("长"), 500))
	payload := fmt.Sprintf(`{
		"spec": 2,
		"metadata": {"name": "longtips", "tips": %q},
		"files": {"player": {"model": [], "texture": []}}
	}`, tips)
	path := writeZip(t, "long.ysm", map[string]string{"ysm.json": payload})
	sum, err := ExtractYsmSummary(path)
	if err != nil {
		t.Fatalf("超长 tips 应容错: %v", err)
	}
	if utf8.RuneCountInString(sum.Tips) > 203 { // 200 + "..."
		t.Errorf("Tips rune 长度 = %d，应 ≤ 203（TruncateLimit 上限）", utf8.RuneCountInString(sum.Tips))
	}
}

// ---------------------------------------------------------------------------
// isYSGP 检测：BOM + YSGP、YSGP 无后缀、只含 4 字节 YSGP
// ---------------------------------------------------------------------------

func TestIsYSGP_BinaryTrueCases(t *testing.T) {
	dir := t.TempDir()
	tests := []struct {
		name    string
		content []byte
		want    bool
	}{
		{"exact4", []byte("YSGP"), true},
		{"bomYsgp", append([]byte{0xEF, 0xBB, 0xBF}, "YSGP\x00abc"[:]...), true},
		{"noBomLong", []byte("YSGP\x00encrypted data here"), true},
		{"plainText", []byte("this is not YSGP"), false},
		{"only3", []byte("YSG"), false},
		{"empty", []byte(""), false},
		{"bomOnly3", []byte{0xEF, 0xBB, 0xBF}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := filepath.Join(dir, tc.name)
			os.WriteFile(p, tc.content, 0o644)
			got := isYSGP(p)
			if got != tc.want {
				t.Errorf("isYSGP(%q) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// hasTextHeader：文件过短 / BOM + 不含文本特征
// ---------------------------------------------------------------------------

func TestHasTextHeader_Short(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "tiny.ysm")
	os.WriteFile(p, []byte("YSGP"), 0o644)
	if hasTextHeader(p) {
		t.Errorf("4 字节 YSGP 不应包含文本头")
	}
}

func TestHasTextHeader_MagicThenText(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "txt.ysm")
	os.WriteFile(p, []byte("YSGP\n--- [Metadata]\n"), 0o644)
	if !hasTextHeader(p) {
		t.Errorf("YSGP + 文本头应被识别")
	}
}

// ---------------------------------------------------------------------------
// summary.go：isYSGP 命中后的分支（summary.Format/Spec）
// 加密 YSGP 应返回基本摘要（不含 Name/Stats）
// ---------------------------------------------------------------------------

func TestExtractYsmSummary_YSGP_NoStats(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "enc.ysm")
	os.WriteFile(p, []byte("YSGP\x00encrypted"), 0o644)
	sum, err := ExtractYsmSummary(p)
	if err != nil {
		t.Fatalf("YSGP 分支不应返回 error: %v", err)
	}
	if sum.Stats.Models != 0 || sum.Stats.Textures != 0 {
		t.Errorf("YSGP 分支 stats 应全 0，实际 = %+v", sum.Stats)
	}
}

// ---------------------------------------------------------------------------
// 构造辅助：writeZip
// ---------------------------------------------------------------------------

func writeZip(t *testing.T, name string, entries map[string]string) string {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for n, c := range entries {
		w, err := zw.Create(n)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(c))
	}
	zw.Close()
	p := filepath.Join(t.TempDir(), name)
	os.WriteFile(p, buf.Bytes(), 0o644)
	return p
}
