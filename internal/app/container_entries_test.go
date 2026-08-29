// ===== container_entries_test.go — ADR-132 遗留 1 容器内条目枚举 + 体素读取测试 =====
package app

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// makeContainerZip 构建临时容器 zip（name → 内容字节）。
func makeContainerZip(t *testing.T, files map[string][]byte) string {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "container.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for name, content := range files {
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()
	return p
}

// gzNbtBytes gzip 压缩一个 NBT compound（内联最小构造：根 compound 空名）
func gzNbtBytes(t *testing.T) []byte {
	t.Helper()
	// TAG_Compound "" { TAG_Int "Version" 5 }：
	// 0x0A + name(2 字节 len=0) + children + TAG_End(0x00)
	var body bytes.Buffer
	body.Write([]byte{0x03})         // TAG_Int
	body.Write([]byte{0, 7})         // name len
	body.WriteString("Version")      // name
	body.Write([]byte{0, 0, 0, 5})   // 5
	body.Write([]byte{0x00})         // TAG_End
	root := []byte{0x0A, 0x00, 0x00} // TAG_Compound + 空名 len
	root = append(root, body.Bytes()...)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// gzSchematicBytes 构造最小 v2 schematic（Width/Height/Length + BlockData 1 方块）
func gzSchematicBytes(t *testing.T) []byte {
	t.Helper()
	// 构造 { Width:2, Height:1, Length:1, BlockData:[1,0]（varint 2 方块：stone + air）,
	// Palette:{minecraft:stone:1} }
	var body bytes.Buffer
	body.Write([]byte{0x03, 0, 5}) // TAG_Int "Width"
	body.WriteString("Width")
	body.Write([]byte{0, 0, 0, 2})
	body.Write([]byte{0x03, 0, 6}) // "Height"
	body.WriteString("Height")
	body.Write([]byte{0, 0, 0, 1})
	body.Write([]byte{0x03, 0, 6}) // "Length"
	body.WriteString("Length")
	body.Write([]byte{0, 0, 0, 1})
	body.Write([]byte{0x07, 0, 9}) // TAG_Byte_Array "BlockData"
	body.WriteString("BlockData")
	body.Write([]byte{0, 0, 0, 2}) // len 2
	body.Write([]byte{1, 0})       // stone + air
	body.Write([]byte{0x0A, 0, 7}) // TAG_Compound "Palette"
	body.WriteString("Palette")
	body.Write([]byte{0x03, 0, 15}) // TAG_Int "minecraft:stone"
	body.WriteString("minecraft:stone")
	body.Write([]byte{0, 0, 0, 1})
	body.Write([]byte{0x00})         // Palette end
	body.Write([]byte{0x00})         // root end
	root := []byte{0x0A, 0x00, 0x00} // TAG_Compound + 空名 len
	root = append(root, body.Bytes()...)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestListContainerEntries(t *testing.T) {
	a := &App{}
	nbt := gzNbtBytes(t)
	p := makeContainerZip(t, map[string][]byte{
		"builds/house.nbt":       nbt,
		"builds/tower.litematic": nbt,
		"maps/area.schematic":    nbt,
		"readme.txt":             []byte("hi"),
		"builds/note.json":       []byte("{}"),
	})
	got := a.ListContainerEntries(p, ".nbt,.litematic,.schematic")
	var entries []string
	if err := json.Unmarshal([]byte(got), &entries); err != nil {
		t.Fatalf("ListContainerEntries 返回非法 JSON: %v", err)
	}
	want := []string{"builds/house.nbt", "builds/tower.litematic", "maps/area.schematic"}
	if len(entries) != len(want) {
		t.Fatalf("期望 %d 条，实际 %d: %v", len(want), len(entries), entries)
	}
	for i := range want {
		if entries[i] != want[i] {
			t.Errorf("entries[%d] = %q，期望 %q", i, entries[i], want[i])
		}
	}
}

func TestListContainerEntries_ExtFilter(t *testing.T) {
	a := &App{}
	nbt := gzNbtBytes(t)
	p := makeContainerZip(t, map[string][]byte{
		"a.nbt":       nbt,
		"b.litematic": nbt,
		"c.schematic": nbt,
		"d.txt":       []byte("x"),
	})
	// 单扩展名过滤（无点前缀也生效）
	got := a.ListContainerEntries(p, "nbt")
	var entries []string
	if err := json.Unmarshal([]byte(got), &entries); err != nil {
		t.Fatalf("非法 JSON: %v", err)
	}
	if len(entries) != 1 || entries[0] != "a.nbt" {
		t.Errorf("仅 .nbt 期望 [a.nbt]，实际 %v", entries)
	}
	// 空 exts → 放行全部非目录
	gotAll := a.ListContainerEntries(p, "")
	if err := json.Unmarshal([]byte(gotAll), &entries); err != nil {
		t.Fatalf("空 exts 非法 JSON: %v", err)
	}
	if len(entries) != 4 {
		t.Errorf("空 exts 期望 4 条，实际 %v", entries)
	}
}

func TestListContainerEntries_EmptyAndBad(t *testing.T) {
	a := &App{}
	// 坏 zip / 不存在 → "[]"
	if got := a.ListContainerEntries(filepath.Join(t.TempDir(), "nope.zip"), ".nbt"); got != "[]" {
		t.Errorf("不存在文件期望 []，实际 %q", got)
	}
	// 空容器 → "[]"
	p := makeContainerZip(t, map[string][]byte{"readme.txt": []byte("x")})
	if got := a.ListContainerEntries(p, ".nbt"); got != "[]" {
		t.Errorf("无匹配期望 []，实际 %q", got)
	}
}

func TestGetVoxelDataInContainer(t *testing.T) {
	a := &App{}
	nbt := gzNbtBytes(t)
	p := makeContainerZip(t, map[string][]byte{
		"builds/house.nbt":       nbt,
		"builds/tower.litematic": nbt,
		"maps/area.schematic":    gzSchematicBytes(t),
	})
	// .nbt 分支：BuildNbtVoxelDataFromRoot（无 size/blocks/palette → error JSON 契约）
	raw := a.GetVoxelDataInContainer(p, "builds/house.nbt", ".nbt")
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("GetVoxelDataInContainer .nbt 返回非法 JSON: %v", err)
	}
	if _, hasErr := m["error"]; !hasErr {
		t.Errorf("非 structure NBT 期望 error 字段，实际 %q", raw)
	}
	// .litematic 分支（默认）：Version-only root → Size [0,0,0] 空数据（合法）
	rawL := a.GetVoxelDataInContainer(p, "builds/tower.litematic", ".litematic")
	var mL map[string]any
	if err := json.Unmarshal([]byte(rawL), &mL); err != nil {
		t.Fatalf("GetVoxelDataInContainer .litematic 返回非法 JSON: %v", err)
	}
	if _, hasErr := mL["error"]; hasErr {
		t.Errorf(".litematic 空数据不应报 error，实际 %q", rawL)
	}
	if sz, ok := mL["size"]; ok {
		if arr, ok := sz.([]any); ok && len(arr) != 3 {
			t.Errorf("size 应为 3 元素，实际 %v", sz)
		}
	}
	// .schematic 分支：Width 2 Height 1 Length 1 → 1 个方块组
	rawS := a.GetVoxelDataInContainer(p, "maps/area.schematic", ".schematic")
	var mS map[string]any
	if err := json.Unmarshal([]byte(rawS), &mS); err != nil {
		t.Fatalf("GetVoxelDataInContainer .schematic 返回非法 JSON: %v", err)
	}
	if _, hasErr := mS["error"]; hasErr {
		t.Fatalf(".schematic 正常数据不应报 error，实际 %q", rawS)
	}
	if groups, ok := mS["groups"].([]any); ok {
		if len(groups) == 0 {
			t.Errorf(".schematic 应有 1 个 stone 方块组，实际空 groups")
		}
	}
}

func TestGetVoxelDataInContainer_Guard(t *testing.T) {
	a := &App{}
	nbt := gzNbtBytes(t)
	p := makeContainerZip(t, map[string][]byte{"a.nbt": nbt})
	for _, entry := range []string{
		"../etc/passwd",
		"a\\b.nbt",
		"/abs/a.nbt",
		"missing.nbt",
	} {
		raw := a.GetVoxelDataInContainer(p, entry, ".nbt")
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatalf("非法条目 %q 返回非法 JSON: %v", entry, err)
		}
		if _, hasErr := m["error"]; !hasErr {
			t.Errorf("非法条目 %q 期望 error 字段，实际 %q", entry, raw)
		}
	}
}

func TestGetVoxelDataInContainer_BadZip(t *testing.T) {
	a := &App{}
	raw := a.GetVoxelDataInContainer(filepath.Join(t.TempDir(), "nope.zip"), "a.nbt", ".nbt")
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("坏 zip 期望 error JSON，实际 %q", raw)
	}
	if _, hasErr := m["error"]; !hasErr {
		t.Errorf("坏 zip 期望 error 字段，实际 %q", raw)
	}
}

func TestContainerExtMatch_Edge(t *testing.T) {
	// 大小写不敏感
	if !containerExtMatch("a.TXT", map[string]bool{".txt": true}) {
		t.Error("大小写应匹配（ToLower）")
	}
	if containerExtMatch("noext", map[string]bool{".txt": true}) {
		t.Error("无扩展名不应匹配")
	}
	if !containerExtMatch("a.txt", map[string]bool{".txt": true}) {
		t.Error(".txt 应匹配")
	}
	if !containerExtMatch("whatever", map[string]bool{}) {
		t.Error("空白名单放行全部")
	}
}

func TestParseContainerExts_Edge(t *testing.T) {
	got := parseContainerExts(" .nbt , litematic ,, ")
	if !got[".nbt"] || !got[".litematic"] {
		t.Errorf("解析应补点并去空白: %v", got)
	}
	if len(parseContainerExts("")) != 0 {
		t.Error("空串 → 空白名单")
	}
}

func TestContainerEntrySafe_Edge(t *testing.T) {
	for _, ok := range []string{"a.nbt", "sub/dir/b.litematic", "名字.nbt"} {
		if !containerEntrySafe(ok) {
			t.Errorf("合法条目 %q 应放行", ok)
		}
	}
	for _, bad := range []string{"", "/abs", "a\\b", "..", "a/../b", "a/.."} {
		if containerEntrySafe(bad) {
			t.Errorf("非法条目 %q 应拒绝", bad)
		}
	}
}
