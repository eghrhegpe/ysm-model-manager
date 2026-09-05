// ===== ZIP 错误分支 / 畸形输入 / 分隔符归一化测试 =====
// 目标：补 ParseFromZip / ParseComponentsFromZip / ExtractFirstPNGFromZip 未覆盖分支：
//   - f.Open() 报错（不支持的压缩算法 method=99）：ysm.json / 几何 / 纹理 / 动画 各条目
//   - ysm.json 非法 JSON / model map 值类型错误（Decoder 中途失败）
//   - 路径分隔符：条目名含反斜杠（Windows 归档）时排序与 TexSlot 绑定
//   - 未声明几何/纹理的排序兜底分支（return oki / return hasI）
//
// 说明：archive/zip.Writer 拒绝写入 method=99（ErrAlgorithm），故用 makeZipRaw
// 手工拼装 ZIP 结构触发 f.Open() 错误分支。
package geometry

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"hash/crc32"
	"testing"

	"ysm-model-manager/internal/testutil"
)

// rawZipEntry 手工 ZIP 条目（method 可指定任意值）
type rawZipEntry struct {
	name   string
	method uint16
	data   string
}

func putU16(b *bytes.Buffer, v uint16) { _ = binary.Write(b, binary.LittleEndian, v) }
func putU32(b *bytes.Buffer, v uint32) { _ = binary.Write(b, binary.LittleEndian, v) }

// makeZipRaw 手工拼装 ZIP 字节：本地文件头 + 中央目录 + EOCD（无 data descriptor）。
// method=99 为未注册压缩算法：zip.NewReader 可正常读目录，f.Open() 立即返回
// ErrAlgorithm（"zip: unsupported compression algorithm"）。
func makeZipRaw(t *testing.T, entries []rawZipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	var cd bytes.Buffer
	var cdOffset int64
	for _, e := range entries {
		crc := crc32.ChecksumIEEE([]byte(e.data))
		off := buf.Len()
		// 本地文件头
		putU32(&buf, 0x04034b50)
		putU16(&buf, 20) // version needed
		putU16(&buf, 0)  // flags（无 data descriptor）
		putU16(&buf, e.method)
		putU16(&buf, 0)    // mod time
		putU16(&buf, 0x21) // mod date（1980-01-01）
		putU32(&buf, crc)
		putU32(&buf, uint32(len(e.data)))
		putU32(&buf, uint32(len(e.data)))
		putU16(&buf, uint16(len(e.name)))
		putU16(&buf, 0) // extra len
		buf.WriteString(e.name)
		buf.WriteString(e.data)
		// 中央目录项
		putU32(&cd, 0x02014b50)
		putU16(&cd, 20) // version made by
		putU16(&cd, 20) // version needed
		putU16(&cd, 0)  // flags
		putU16(&cd, e.method)
		putU16(&cd, 0)    // mod time
		putU16(&cd, 0x21) // mod date
		putU32(&cd, crc)
		putU32(&cd, uint32(len(e.data)))
		putU32(&cd, uint32(len(e.data)))
		putU16(&cd, uint16(len(e.name)))
		putU16(&cd, 0) // extra len
		putU16(&cd, 0) // comment len
		putU16(&cd, 0) // disk number
		putU16(&cd, 0) // internal attrs
		putU32(&cd, 0) // external attrs
		putU32(&cd, uint32(off))
		cd.WriteString(e.name)
	}
	cdOffset = int64(buf.Len())
	buf.Write(cd.Bytes())
	// EOCD
	putU32(&buf, 0x06054b50)
	putU16(&buf, 0) // disk number
	putU16(&buf, 0) // cd start disk
	putU16(&buf, uint16(len(entries)))
	putU16(&buf, uint16(len(entries)))
	putU32(&buf, uint32(cd.Len()))
	putU32(&buf, uint32(cdOffset))
	putU16(&buf, 0) // comment len
	return buf.Bytes()
}

// validGeoNoTex validGeoJSON 的变体：cube 显式 texture=3（区分默认 0 与绑定结果）
const validGeoTex3 = `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"test","texture_width":64,"texture_height":32},"bones":[{"name":"head","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0],"texture":3}]}]}]}`

func TestMakeZipRaw_Sanity(t *testing.T) {
	// 自检：makeZipRaw 生成的 method=0 ZIP 可被 archive/zip 正常读取
	raw := makeZipRaw(t, []rawZipEntry{{name: "a.txt", method: 0, data: "hello"}})
	r, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatalf("自检失败: makeZipRaw 产物无法解析: %v", err)
	}
	if len(r.File) != 1 || r.File[0].Name != "a.txt" {
		t.Fatalf("自检失败: 条目异常 %+v", r.File)
	}
	rc, err := r.File[0].Open()
	if err != nil {
		t.Fatalf("自检失败: Open 报错: %v", err)
	}
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(rc)
	if buf.String() != "hello" {
		t.Fatalf("自检失败: 内容 = %q", buf.String())
	}
	// method=99 条目：Open 应报错（ErrAlgorithm）
	raw2 := makeZipRaw(t, []rawZipEntry{{name: "bad.dat", method: 99, data: "x"}})
	r2, err := zip.NewReader(bytes.NewReader(raw2), int64(len(raw2)))
	if err != nil {
		t.Fatalf("自检失败: method=99 目录解析应成功: %v", err)
	}
	if _, err := r2.File[0].Open(); err == nil {
		t.Fatalf("自检失败: method=99 条目 Open 应报错")
	}
}

// zipRawValid 最小完整归档：ysm.json(数组声明) + model.geo.json + tex1.png
func zipRawValid() []rawZipEntry {
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":["tex1.png"]}}}`
	return []rawZipEntry{
		{name: "ysm.json", method: 0, data: ysm},
		{name: "model.geo.json", method: 0, data: validGeoJSON},
		{name: "tex1.png", method: 0, data: "PNG-DATA"},
	}
}

func TestParseFromZip_YsmOpenError(t *testing.T) {
	// ysm.json 条目 Open 失败（method=99）→ 跳过声明，几何文件仍回退解析
	entries := zipRawValid()
	entries[0].method = 99
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("ysm.json Open 失败时模型仍应从几何文件回退解析")
	}
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1（纹理收集独立于 ysm 解析）", len(pngs))
	}
}

func TestParseFromZip_GeoOpenError(t *testing.T) {
	// 几何条目 Open 失败 → 跳过该几何；无其他几何时模型为 nil（不崩溃）
	entries := zipRawValid()
	entries[1].method = 99
	data := makeZipRaw(t, entries)
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model != nil {
		t.Fatalf("唯一几何条目 Open 失败时模型应为 nil, got %+v", model)
	}
}

func TestParseFromZip_PngOpenError(t *testing.T) {
	// 纹理条目 Open 失败 → 跳过该纹理，几何不受影响
	entries := zipRawValid()
	entries[2].method = 99
	data := makeZipRaw(t, entries)
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(pngs) != 0 {
		t.Errorf("pngs = %d, 期望 0（纹理 Open 失败被跳过）", len(pngs))
	}
}

func TestParseFromZip_AnimOpenError(t *testing.T) {
	// 动画条目 Open 失败 → continue，不影响模型解析
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":["tex1.png"]}}}`
	data := makeZipRaw(t, []rawZipEntry{
		{name: "ysm.json", method: 0, data: ysm},
		{name: "model.geo.json", method: 0, data: validGeoJSON},
		{name: "animations/idle.json", method: 99, data: "x"},
		{name: "tex1.png", method: 0, data: "PNG-DATA"},
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil || model.BoneCount != 1 {
		t.Fatalf("动画条目 Open 失败不应影响模型解析, model=%v", model)
	}
}

func TestExtractFirstPNGFromZip_OpenError(t *testing.T) {
	// 唯一 PNG 条目 Open 失败 → nil（不崩溃）
	data := makeZipRaw(t, []rawZipEntry{{name: "tex1.png", method: 99, data: "x"}})
	if got := ExtractFirstPNGFromZip(data, int64(len(data))); got != nil {
		t.Fatalf("PNG Open 失败应返回 nil, got %q", got)
	}
}

func TestParseComponentsFromZip_YsmOpenError(t *testing.T) {
	// 组件路径：ysm.json Open 失败 → 几何回退为未声明组件（不报错）
	entries := zipRawValid()
	entries[0].method = 99
	data := makeZipRaw(t, entries)
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("应无错误: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1（几何回退）", len(comps))
	}
	if len(texNames) != 1 || texNames[0] != "model" {
		t.Errorf("texNames = %v, 期望 [model]（未声明组件用 basename）", texNames)
	}
}

func TestParseFromZip_InvalidYsmJSON(t *testing.T) {
	// ysm.json 内容非法 JSON → 声明解析失败，几何仍回退解析
	ysm := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       "{not json",
		"model.geo.json": validGeoJSON,
	})
	model, _, _ := ParseFromZip(ysm, int64(len(ysm)))
	if model == nil {
		t.Fatal("ysm.json 非法时模型仍应从几何文件回退解析")
	}
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
}

func TestParseFromZip_ModelMapBadValue(t *testing.T) {
	// model map 值为非字符串（123）→ Decoder 中途失败 break，不崩溃、后续回退解析
	ysm := `{"files":{"player":{"model":{"main":123},"texture":["tex1.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-DATA",
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("model map 值类型错误时模型仍应回退解析")
	}
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1", model.BoneCount)
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
}

func TestParseFromZip_BackslashEntryNames(t *testing.T) {
	// 反斜杠分隔的归档条目名（Windows 工具产物）：排序与 TexSlot 绑定须与
	// 正斜杠声明同口径（buildComponents 已归一化；合并路径曾漏归一化 → 绑定失效）
	ysm := `{"files":{"player":{"model":["a/first.geo.json","b/second.geo.json"],"texture":["tex_a.png"]}}}`
	firstGeo := validGeoTex3 // cube texture=3：绑定失败时 TexSlot 保持 3
	secondGeo := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"second","texture_width":32,"texture_height":32},"bones":[{"name":"second","cubes":[{"origin":[0,0,0],"size":[4,4,4],"uv":[0,0],"texture":2}]}]}]}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":           ysm,
		"b\\second.geo.json": secondGeo,
		"a\\first.geo.json":  firstGeo,
		"tex_a.png":          "PNG-A",
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	// 声明序 a 在前 → 合并结果 first(head) 应排在 second 前（排序查询键归一化）
	if len(model.Bones) != 2 {
		t.Fatalf("BoneCount = %d, 期望 2", len(model.Bones))
	}
	if model.Bones[0].Name != "head" {
		t.Errorf("Bones[0] = %q, 期望 head（声明序 a/first 在前）", model.Bones[0].Name)
	}
	if model.Bones[1].Name != "second" {
		t.Errorf("Bones[1] = %q, 期望 second", model.Bones[1].Name)
	}
	// TexSlot 绑定：first → tex_a(0)，second → 0（钳制共享 tex_a）
	for _, b := range model.Bones {
		for _, c := range b.Cubes {
			if c.TexSlot != 0 {
				t.Errorf("骨骼 %s cube TexSlot = %d, 期望 0（反斜杠条目名应命中 texIdxMap）", b.Name, c.TexSlot)
			}
		}
	}
	if len(pngs) != 1 {
		t.Errorf("pngs = %d, 期望 1", len(pngs))
	}
}

func TestParseFromZip_UndeclaredGeoAndPng(t *testing.T) {
	// 未声明几何（排序 return oki 分支）与未声明纹理（return hasI 分支）：
	// 声明项在前、未声明项稳定落尾；纹理名与 pngs 同序
	// 注：声明文件不能用 arm（合并路径按 IsArmModelName 排除），用 declared.geo.json
	ysm := `{"files":{"player":{"model":["declared.geo.json"],"texture":["tex1.png"]}}}`
	declaredGeo := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"declared","texture_width":32,"texture_height":32},"bones":[{"name":"declared","cubes":[{"origin":[0,0,0],"size":[4,4,4],"uv":[0,0]}]}]}]}`
	bigGeo := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"big","texture_width":128,"texture_height":128},"bones":[{"name":"big","cubes":[{"origin":[0,0,0],"size":[2,2,2],"uv":[0,0]}]}]}]}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":          ysm,
		"main.geo.json":     validGeoJSON, // 未声明（纹理 64）
		"declared.geo.json": declaredGeo,  // 声明（纹理 32）
		"extra.json":        bigGeo,       // 未声明（纹理 128，合并取最大）
		"tex1.png":          "PNG-1",
		"extra.png":         "PNG-X", // 未声明纹理
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	// 声明项 declared 排前，未声明项按稳定序落尾（map 写入序随机 → 只校验集合）
	if len(model.Bones) != 3 {
		t.Fatalf("BoneCount = %d, 期望 3（declared/main/extra 合并）", len(model.Bones))
	}
	if model.Bones[0].Name != "declared" {
		t.Errorf("Bones[0] = %q, 期望 declared（声明项优先）", model.Bones[0].Name)
	}
	gotTail := map[string]bool{model.Bones[1].Name: true, model.Bones[2].Name: true}
	if !gotTail["head"] || !gotTail["big"] {
		t.Errorf("未声明项 = %v, 期望包含 head 与 big", gotTail)
	}
	// 合并取最大纹理尺寸（extra 128）
	if model.TexWidth != 128 {
		t.Errorf("TexWidth = %d, 期望 128（多模型合并取最大）", model.TexWidth)
	}
	// 纹理：声明 tex1 在前，未声明 extra 落尾；TextureNames 与 pngs 同序
	if len(pngs) != 2 {
		t.Fatalf("pngs = %d, 期望 2", len(pngs))
	}
	if len(model.TextureNames) != 2 || model.TextureNames[0] != "tex1" || model.TextureNames[1] != "extra" {
		t.Errorf("TextureNames = %v, 期望 [tex1 extra]", model.TextureNames)
	}
}

func TestParseFromZip_TextureMixedSeparators(t *testing.T) {
	// 纹理声明含正/反斜杠混合路径：basename 归一化后排序命中（对象反斜杠 + 字符串正斜杠）
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":[{"uv":"sub\\tex1.png"},"sub/tex2.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-1",
		"tex2.png":       "PNG-2",
		"extra.png":      "PNG-X", // 未声明 → hasI=false 兜底分支
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(pngs) != 3 {
		t.Fatalf("pngs = %d, 期望 3", len(pngs))
	}
	want := []string{"tex1", "tex2", "extra"}
	for i, w := range want {
		if model.TextureNames[i] != w {
			t.Errorf("TextureNames[%d] = %q, 期望 %q", i, model.TextureNames[i], w)
		}
	}
}

func TestParseFromZip_ModelArrayNameOnly(t *testing.T) {
	// model 数组对象仅含 name（无 path）→ 回退用 name（P2 语义）
	ysm := `{"files":{"player":{"model":[{"name":"model.geo.json"}],"texture":["tex1.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-DATA",
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil || model.BoneCount != 1 {
		t.Fatalf("模型解析异常: %v", model)
	}
	if model.TextureNames[0] != "tex1" {
		t.Errorf("TextureNames = %v, 期望 [tex1]", model.TextureNames)
	}
}

func TestParseFromZip_TexSlotBoundToTexOrder(t *testing.T) {
	// 多模型 + 多纹理：TexSlot 按 modelOrder 声明序绑定（geometry 文件自带 texture 被覆盖）
	ysm := `{"files":{"player":{"model":["main.geo.json","arm.geo.json"],"texture":["tex_a.png","tex_b.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":      ysm,
		"main.geo.json": validGeoTex3, // cube texture=3 → 绑定后应为 0
		"arm.geo.json":  geoArmJSON,
		"tex_a.png":     "PNG-A",
		"tex_b.png":     "PNG-B",
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	for _, b := range model.Bones {
		for _, c := range b.Cubes {
			switch b.Name {
			case "head":
				if c.TexSlot != 0 {
					t.Errorf("head cube TexSlot = %d, 期望 0（覆盖几何文件自带 texture=3）", c.TexSlot)
				}
			case "arm":
				if c.TexSlot != 1 {
					t.Errorf("arm cube TexSlot = %d, 期望 1", c.TexSlot)
				}
			}
		}
	}
}

func TestParseComponentsFromZip_BackslashEntryNames(t *testing.T) {
	// 组件路径的反斜杠条目名（buildComponents 已归一化，作为合并路径修复的参照）
	ysm := `{"files":{"player":{"model":["a/first.geo.json","b/second.geo.json"],"texture":["tex_a.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":           ysm,
		"b\\second.geo.json": `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"second","texture_width":32,"texture_height":32},"bones":[{"name":"second","cubes":[{"origin":[0,0,0],"size":[4,4,4],"uv":[0,0]}]}]}]}`,
		"a\\first.geo.json":  validGeoJSON,
	})
	comps, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 2 {
		t.Fatalf("组件数 = %d, 期望 2", len(comps))
	}
	if comps[0].Bones[0].Name != "head" {
		t.Errorf("组件 0 = %q, 期望 head（声明序 a 在前）", comps[0].Bones[0].Name)
	}
}

func TestParseComponentsFromZip_ModelMapBadValue(t *testing.T) {
	// model map 值非法 → modelOrder 空 → 组件按未声明处理（texSlot=len(texOrder)+段序）
	ysm := `{"files":{"player":{"model":{"main":123},"texture":["tex1.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":      ysm,
		"main.geo.json": validGeoJSON,
		"tex1.png":      "PNG-DATA",
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	// ADR-114 perComponent：未声明组件 cube.TexSlot=0（用自己的第 0 张）
	if slot := comps[0].Bones[0].Cubes[0].TexSlot; slot != 0 {
		t.Errorf("texSlot = %d, 期望 0（perComponent）", slot)
	}
	if len(texNames) != 1 || texNames[0] != "main" {
		t.Errorf("texNames = %v, 期望 [main]（未声明用 basename）", texNames)
	}
}

func TestParseComponentsFromZip_NoDeclarations(t *testing.T) {
	// ysm.json 无 model/texture 声明 → 组件按 main 优先 + 路径字典序 + 未声明段槽位
	ysm := `{"files":{"player":{}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":      ysm,
		"arm.geo.json":  geoArmJSON,
		"main.geo.json": validGeoJSON,
		"arrow.json":    miniGeo,
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 3 {
		t.Fatalf("组件数 = %d, 期望 3", len(comps))
	}
	// main 优先 + 字典序
	if comps[0].Bones[0].Name != "head" {
		t.Errorf("组件 0 = %q, 期望 head（main 优先）", comps[0].Bones[0].Name)
	}
	// ADR-114 perComponent：无纹理声明时 cube.TexSlot=0（每组件用自己的第 0 张）
	// arm 与 main 共用皮肤（ModernYSM 权威）：texNames 置空、不填 ComponentTextures。
	for i, want := range []string{"main", "", "arrow"} {
		if texNames[i] != want {
			t.Errorf("texNames[%d] = %q, 期望 %q", i, texNames[i], want)
		}
		if slot := comps[i].Bones[0].Cubes[0].TexSlot; slot != 0 {
			t.Errorf("组件 %d texSlot = %d, 期望 0（perComponent）", i, slot)
		}
	}
}

func TestParseComponentsFromZip_TextureObjects(t *testing.T) {
	// collectArchiveFiles 纹理对象数组分支（uv 字段，含路径剥离 + 去扩展名）
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":[{"uv":"tex/tex1.png"}]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-DATA",
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	if len(texNames) != 1 || texNames[0] != "tex1" {
		t.Errorf("texNames = %v, 期望 [tex1]（uv 对象 basename 去扩展名）", texNames)
	}
	if slot := comps[0].Bones[0].Cubes[0].TexSlot; slot != 0 {
		t.Errorf("texSlot = %d, 期望 0", slot)
	}
}

func TestParseComponentsFromZip_ModelObjectsNameOnly(t *testing.T) {
	// collectArchiveFiles model 数组对象仅 name → 回退 name 声明（Path 为空分支）
	ysm := `{"files":{"player":{"model":[{"name":"model.geo.json"}],"texture":["tex1.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-DATA",
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	if slot := comps[0].Bones[0].Cubes[0].TexSlot; slot != 0 {
		t.Errorf("texSlot = %d, 期望 0（name 回退声明命中）", slot)
	}
	if len(texNames) != 1 || texNames[0] != "tex1" {
		t.Errorf("texNames = %v, 期望 [tex1]", texNames)
	}
}

func TestParseComponentsFromZip_TextureEmptyUV(t *testing.T) {
	// texture 对象 uv 为空 → 条目被跳过（不 panic，texOrder 空则组件按未声明处理）
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":[{"uv":""}]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	if len(texNames) != 1 {
		t.Fatalf("texNames = %d, 期望 1", len(texNames))
	}
}

// ====== collectArchiveFiles 与 ParseFromZip 剩余错误/边界分支 ======

func TestParseComponentsFromZip_InvalidYsmJSON(t *testing.T) {
	// ysm.json 内容非法 → 声明解析失败，几何回退为未声明组件（不报错）
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       "{bad json",
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-DATA",
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("应无错误: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1（几何回退）", len(comps))
	}
	if len(texNames) != 1 || texNames[0] != "model" {
		t.Errorf("texNames = %v, 期望 [model]", texNames)
	}
}

func TestParseComponentsFromZip_ModelAsString(t *testing.T) {
	// model 单字符串格式（collectArchiveFiles 字符串分支）
	ysm := `{"files":{"player":{"model":"model.geo.json","texture":["tex1.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-DATA",
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	if slot := comps[0].Bones[0].Cubes[0].TexSlot; slot != 0 {
		t.Errorf("texSlot = %d, 期望 0（字符串声明命中）", slot)
	}
	if len(texNames) != 1 || texNames[0] != "tex1" {
		t.Errorf("texNames = %v, 期望 [tex1]", texNames)
	}
}

func TestParseComponentsFromZip_TextureBackslashUV(t *testing.T) {
	// texture 对象 uv 含反斜杠路径（collectArchiveFiles "\\" 剥离分支）
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":[{"uv":"sub\\tex1.png"}]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"tex1.png":       "PNG-DATA",
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 1 {
		t.Fatalf("组件数 = %d, 期望 1", len(comps))
	}
	if len(texNames) != 1 || texNames[0] != "tex1" {
		t.Errorf("texNames = %v, 期望 [tex1]（反斜杠路径剥离）", texNames)
	}
}

func TestParseComponentsFromZip_EntryOpenErrors(t *testing.T) {
	// 动画/几何/纹理条目 Open 均失败（method=99）→ 全部跳过，有效几何仍解析
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":["tex1.png"]}}}`
	data := makeZipRaw(t, []rawZipEntry{
		{name: "ysm.json", method: 0, data: ysm},
		{name: "model.geo.json", method: 0, data: validGeoJSON},
		{name: "animations/idle.json", method: 99, data: "x"},
		{name: "bad.geo.json", method: 99, data: "x"},
		{name: "tex1.png", method: 99, data: "x"},
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("应无错误: %v", err)
	}
	if len(comps) != 1 || comps[0].Bones[0].Name != "head" {
		t.Fatalf("组件 = %+v, 期望仅 model(head) 成功解析", comps)
	}
	if len(texNames) != 1 {
		t.Errorf("texNames = %v, 期望 1 个", texNames)
	}
}

func TestParseComponentsFromZip_PngBackslashName(t *testing.T) {
	// PNG 条目名含反斜杠（collectArchiveFiles "\\" 剥离分支）
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":["tex1.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"sub\\tex1.png":  "PNG-DATA",
	})
	_, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
}

func TestParseFromZip_PngSubdirAndBackslashNames(t *testing.T) {
	// PNG 条目名含 "/" 与 "\\" 两种分隔符：basename 剥离后纹理名正确
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":["tex1.png","tex2.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":       ysm,
		"model.geo.json": validGeoJSON,
		"sub/tex1.png":   "PNG-1",
		"sub\\tex2.png":  "PNG-2",
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if len(pngs) != 2 {
		t.Fatalf("pngs = %d, 期望 2", len(pngs))
	}
	if len(model.TextureNames) != 2 || model.TextureNames[0] != "tex1" || model.TextureNames[1] != "tex2" {
		t.Errorf("TextureNames = %v, 期望 [tex1 tex2]", model.TextureNames)
	}
}

func TestParseFromZip_InvalidGeoSkipped(t *testing.T) {
	// 几何文件内容非法 JSON → ParseBedrockGeometry nil → 跳过（g==nil 分支），
	// 有效几何仍合并；无有效几何时模型为 nil 但不崩溃
	ysm := `{"files":{"player":{"model":["model.geo.json","broken.geo.json"],"texture":["tex1.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":        ysm,
		"model.geo.json":  validGeoJSON,
		"broken.geo.json": "{not json",
		"tex1.png":        "PNG-DATA",
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil || model.BoneCount != 1 {
		t.Fatalf("非法几何应被跳过、有效几何应合并, model=%v", model)
	}
	// 全部几何非法 → 模型 nil（无崩溃）
	allBad := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":        ysm,
		"model.geo.json":  "{not json",
		"broken.geo.json": "{not json",
	})
	model2, _, _ := ParseFromZip(allBad, int64(len(allBad)))
	if model2 != nil {
		t.Fatalf("全部几何非法时模型应为 nil, got %+v", model2)
	}
}

// TestBuildComponents_ModelTexNameMap 验证：共享纹理的多个组件（foxcar/mule）
// 用 modelTexName basename→texName 映射后不再因 texOrder 去重而索引漂移。
// 复现 wine_fox 根因：modelOrder 有 8 项，texOrder 去重后只有 7 项，
// 按索引查表 foxcar 错贴 minecart.png、minecart 错贴 boat.png。
func TestBuildComponents_ModelTexNameMap(t *testing.T) {
	// 构造 ysm.json：player 声明 main+arm，vehicles 段 foxcar（horse+mule 共享）+ minecart + boat
	// modelOrder（保留重复）：[main, arm, foxcar, foxcar, minecart, boat]
	// texOrder（当前去重逻辑）：[skin, skin_white, arrow, trident, foxcar, minecart, boat] = 7 项
	// 按旧索引查表：foxcar(index=2)→arrow.png ❌、minecart(index=4)→foxcar.png ❌、boat(index=5)→minecart.png ❌
	// vehicles 段补充：每个 vehicle 独立声明纹理，用于 modelTexName 映射构建。
	ysm := `{
		"files": {
			"player": {
				"model": ["models/main.json", "models/arm.json", "models/foxcar.json", "models/foxcar.json", "models/minecart.json", "models/boat.json"],
				"texture": [
					{"uv": "textures/skin.png"},
					{"uv": "textures/skin_white.png"},
					{"uv": "textures/arrow.png"},
					{"uv": "textures/trident.png"},
					{"uv": "textures/foxcar.png"},
					{"uv": "textures/foxcar.png"},
					{"uv": "textures/minecart.png"},
					{"uv": "textures/boat.png"}
				]
			},
			"vehicles": {
				"minecraft:horse": {"model":"models/foxcar.json","texture":"textures/foxcar.png"},
				"minecraft:mule":  {"model":"models/foxcar.json","texture":"textures/foxcar.png"},
				"minecraft:minecart": {"model":"models/minecart.json","texture":"textures/minecart.png"},
				"minecraft:boat":   {"model":"models/boat.json","texture":"textures/boat.png"}
			}
		}
	}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":                ysm,
		"models/main.json":        miniGeo,
		"models/arm.json":         miniGeo,
		"models/foxcar.json":      miniGeo,
		"models/minecart.json":    miniGeo,
		"models/boat.json":        miniGeo,
		"textures/skin.png":       "SKIN",
		"textures/skin_white.png": "SKIN_W",
		"textures/arrow.png":      "ARROW",
		"textures/trident.png":    "TRIDENT",
		"textures/foxcar.png":     "FOXCAR",
		"textures/minecart.png":   "MINECART",
		"textures/boat.png":       "BOAT",
	})
	comps, texNames, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip 失败: %v", err)
	}
	if len(comps) != 5 {
		t.Fatalf("组件数 = %d, 期望 5（main/arm/foxcar/minecart/boat）", len(comps))
	}
	// main 优先
	if comps[0].SourceName != "main" {
		t.Errorf("组件 0 SourceName = %q, 期望 main", comps[0].SourceName)
	}
	// 关键断言：每个组件的 ComponentTextures 应绑定正确的同名纹理
	// arm 除外：arm 与 main 共用同一套 player.texture 皮肤（ModernYSM 权威），
	// 不填 ComponentTextures，前端走全局 texArr[0]。
	wantCompTex := map[string]string{
		"main":     "SKIN",
		"foxcar":   "FOXCAR",
		"minecart": "MINECART",
		"boat":     "BOAT",
	}
	for _, c := range comps {
		want, ok := wantCompTex[c.SourceName]
		if !ok {
			continue
		}
		gotArr, has := c.ComponentTextures[c.SourceName]
		if !has || len(gotArr) == 0 {
			t.Errorf("组件 %s 应有 ComponentTextures[%s] 条目", c.SourceName, c.SourceName)
			continue
		}
		// base64 data URI 编码了 PNG 数据，直接断言编码结果
		expectedBase64 := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte(want))
		if gotArr[0] != expectedBase64 {
			t.Errorf("组件 %s ComponentTextures[%s][0] = %.80q，期望 %q",
				c.SourceName, c.SourceName, gotArr[0], expectedBase64)
		}
	}
	// texNames：每组件一个期望纹理名（用于 R1 契约校验）
	// arm 与 main 共用同一套 player.texture 皮肤（ModernYSM 权威）：
	// arm 的 texNames 置空、ComponentTextures 为空，前端走全局 texArr[0]。
	wantTexNames := []string{"skin", "", "foxcar", "minecart", "boat"}
	if len(texNames) != len(wantTexNames) {
		t.Errorf("texNames 长度 = %d, 期望 %d", len(texNames), len(wantTexNames))
	}
	for i, want := range wantTexNames {
		if i >= len(texNames) {
			break
		}
		if texNames[i] != want {
			t.Errorf("texNames[%d] = %q, 期望 %q", i, texNames[i], want)
		}
	}
}

// TestTextureCategories_CaseInsensitiveReorder 验证：texOrder 已小写（475/495 行）但
// pngNames 保留 zip 原始大小写（如 textures/Skin.png）时，TextureCategories 重排比较
// 必须大小写不敏感——否则大写纹理名匹配失败 → ordered[i] 全空 → 分类静默丢失
// （code review P2，同函数 958/966 行排序比较器均已 ToLower，此处保持口径一致）。
func TestTextureCategories_CaseInsensitiveReorder(t *testing.T) {
	ysm := `{"files":{"player":{"model":["model.geo.json"],"texture":["textures/Skin.png"]}}}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":          ysm,
		"model.geo.json":    validGeoJSON,
		"textures/Skin.png": "PNG-DATA", // 大写 S：texOrder 会存 skin.png，pngNames 保留 Skin
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型不应为 nil")
	}
	if len(model.TextureNames) != 1 || model.TextureNames[0] != "Skin" {
		t.Fatalf("TextureNames = %v, 期望 [Skin]", model.TextureNames)
	}
	if len(model.TextureCategories) != 1 {
		t.Fatalf("TextureCategories 长度 = %d, 期望 1（大写纹理名分类不得丢失）", len(model.TextureCategories))
	}
	if model.TextureCategories[0] != "player" {
		t.Errorf("TextureCategories[0] = %q, 期望 player", model.TextureCategories[0])
	}
}

// TestTextureCategories_L0Rebuild 验证：L0（maid_model.json）覆盖 texOrder 时 texCategories
// 必须同步重建（code review P3）——不重建则仍对应 ysm 派生旧 texOrder：
// ysm 只声明 1 张纹理（texCategories 长 1），L0 声明 2 张 → 重排第二项 j=1 越界 → 分类丢失。
func TestTextureCategories_L0Rebuild(t *testing.T) {
	ysm := `{"files":{"player":{"model":["main.geo.json"],"texture":["textures/Skin.png"]}}}`
	maid := `{
		"pack_name": "L0 分类测试",
		"model": [
			{"name": "reimu", "model": "models/reimu.geo.json", "texture": "textures/Reimu.png"},
			{"name": "marisa", "model": "models/marisa.geo.json", "texture": "textures/Marisa.png"}
		]
	}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"ysm.json":                             ysm,
		"assets/touhou/maid_model.json":        maid,
		"assets/touhou/models/reimu.geo.json":  validGeoJSON,
		"assets/touhou/models/marisa.geo.json": validGeoJSON,
		"assets/touhou/textures/Reimu.png":     "PNG-DATA",
		"assets/touhou/textures/Marisa.png":    "PNG-DATA",
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("L0 清单合法时模型不应为 nil")
	}
	// L0 生效：texOrder 被 maid_model.json 清单覆盖为 2 项，texCategories 应同步重建为 2 项全 player
	if len(model.TextureNames) != 2 {
		t.Fatalf("TextureNames 长度 = %d, 期望 2（L0 清单 2 张纹理）", len(model.TextureNames))
	}
	if len(model.TextureCategories) != 2 {
		t.Fatalf("TextureCategories 长度 = %d, 期望 2（L0 覆盖后须同步重建）", len(model.TextureCategories))
	}
	for i, cat := range model.TextureCategories {
		if cat != "player" {
			t.Errorf("TextureCategories[%d] = %q, 期望 player（L0 清单纹理全为主模型皮肤）", i, cat)
		}
	}
}
