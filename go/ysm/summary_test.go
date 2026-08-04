// ===== go/ysm summary 辅助函数单测（零覆盖包补测）=====
package ysm

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// ====== truncate ======

func TestTruncate_Short(t *testing.T) {
	got := truncate("hello", 10)
	if got != "hello" {
		t.Errorf("truncate('hello', 10) = %q, want 'hello'", got)
	}
}

func TestTruncate_Exact(t *testing.T) {
	got := truncate("hello", 5)
	if got != "hello" {
		t.Errorf("truncate('hello', 5) = %q, want 'hello'", got)
	}
}

func TestTruncate_Long(t *testing.T) {
	got := truncate("hello world", 5)
	want := "hello..."
	if got != want {
		t.Errorf("truncate('hello world', 5) = %q, want %q", got, want)
	}
}

func TestTruncate_Empty(t *testing.T) {
	got := truncate("", 5)
	if got != "" {
		t.Errorf("truncate('', 5) = %q, want ''", got)
	}
}

func TestTruncate_ZeroMax(t *testing.T) {
	got := truncate("hello", 0)
	if got != "..." {
		t.Errorf("truncate('hello', 0) = %q, want '...'", got)
	}
}

// ====== extractKeys ======

func TestExtractKeys_Object(t *testing.T) {
	raw := json.RawMessage(`{"key1":1,"key2":2}`)
	keys := extractKeys(raw)
	if len(keys) != 2 {
		t.Fatalf("期望 2 个 key, 得到 %d", len(keys))
	}
	m := make(map[string]bool)
	for _, k := range keys {
		m[k] = true
	}
	if !m["key1"] || !m["key2"] {
		t.Errorf("keys 应包含 key1, key2, 得到 %v", keys)
	}
}

func TestExtractKeys_Array(t *testing.T) {
	raw := json.RawMessage(`[1,2,3]`)
	keys := extractKeys(raw)
	if len(keys) != 3 {
		t.Fatalf("期望 3 个 key, 得到 %d", len(keys))
	}
	for i, k := range keys {
		want := "动画 1"
		if i == 1 {
			want = "动画 2"
		}
		if i == 2 {
			want = "动画 3"
		}
		if k != want {
			t.Errorf("keys[%d] = %q, want %q", i, k, want)
		}
	}
}

func TestExtractKeys_Empty(t *testing.T) {
	if keys := extractKeys(nil); keys != nil {
		t.Errorf("nil 应返回 nil, 得到 %v", keys)
	}
	if keys := extractKeys(json.RawMessage("")); keys != nil {
		t.Errorf("空字符串应返回 nil, 得到 %v", keys)
	}
}

func TestExtractKeys_InvalidJSON(t *testing.T) {
	keys := extractKeys(json.RawMessage("{invalid"))
	if keys != nil {
		t.Errorf("非法 JSON 应返回 nil, 得到 %v", keys)
	}
}

// ====== extractDisplayValues ======

func TestExtractDisplayValues_Valid(t *testing.T) {
	raw := json.RawMessage(`{"a":"hello","b":"world","c":"#ref"}`)
	vals := extractDisplayValues(raw)
	if len(vals) != 2 {
		t.Fatalf("期望 2 个值, 得到 %d: %v", len(vals), vals)
	}
	// map 顺序随机，用集合断言
	m := make(map[string]bool)
	for _, v := range vals {
		m[v] = true
	}
	if !m["hello"] || !m["world"] {
		t.Errorf("期望包含 hello 和 world, 得到 %v", vals)
	}
}

func TestExtractDisplayValues_Empty(t *testing.T) {
	if vals := extractDisplayValues(nil); vals != nil {
		t.Errorf("nil 应返回 nil, 得到 %v", vals)
	}
	if vals := extractDisplayValues(json.RawMessage("")); vals != nil {
		t.Errorf("空字符串应返回 nil, 得到 %v", vals)
	}
}

func TestExtractDisplayValues_NotObject(t *testing.T) {
	vals := extractDisplayValues(json.RawMessage(`[1,2,3]`))
	if vals != nil {
		t.Errorf("数组输入应返回 nil, 得到 %v", vals)
	}
}

func TestExtractDisplayValues_AllRefs(t *testing.T) {
	raw := json.RawMessage(`{"a":"#ref1","b":"#ref2"}`)
	vals := extractDisplayValues(raw)
	if len(vals) != 0 {
		t.Errorf("全部 # 开头应返回空, 得到 %v", vals)
	}
}

func TestExtractDisplayValues_NonStringValues(t *testing.T) {
	raw := json.RawMessage(`{"a":123,"b":true,"c":"valid"}`)
	vals := extractDisplayValues(raw)
	if len(vals) != 1 || vals[0] != "valid" {
		t.Errorf("期望 [valid], 得到 %v", vals)
	}
}

// ====== extractKeySet ======

func TestExtractKeySet_Valid(t *testing.T) {
	raw := json.RawMessage(`{"a":1,"b":2,"c":3}`)
	set := extractKeySet(raw)
	if len(set) != 3 {
		t.Fatalf("期望 3 个键, 得到 %d", len(set))
	}
	if !set["a"] || !set["b"] || !set["c"] {
		t.Errorf("集应包含 a,b,c, 得到 %v", set)
	}
}

func TestExtractKeySet_Empty(t *testing.T) {
	if set := extractKeySet(nil); set != nil {
		t.Errorf("nil 应返回 nil, 得到 %v", set)
	}
	if set := extractKeySet(json.RawMessage("")); set != nil {
		t.Errorf("空字符串应返回 nil, 得到 %v", set)
	}
}

func TestExtractKeySet_NotObject(t *testing.T) {
	set := extractKeySet(json.RawMessage(`[1,2]`))
	if set != nil {
		t.Errorf("非对象输入应返回 nil, 得到 %v", set)
	}
}

// ====== extractControlTypes ======

func TestExtractControlTypes_Valid(t *testing.T) {
	raw := json.RawMessage(`[{"type":"slider"},{"type":"toggle"},{}]`)
	types := extractControlTypes(raw)
	if len(types) != 3 {
		t.Fatalf("期望 3 个类型, 得到 %d: %v", len(types), types)
	}
	if types[0] != "slider" || types[1] != "toggle" || types[2] != "unknown" {
		t.Errorf("期望 [slider toggle unknown], 得到 %v", types)
	}
}

func TestExtractControlTypes_Empty(t *testing.T) {
	if types := extractControlTypes(nil); types != nil {
		t.Errorf("nil 应返回 nil, 得到 %v", types)
	}
	if types := extractControlTypes(json.RawMessage("")); types != nil {
		t.Errorf("空字符串应返回 nil, 得到 %v", types)
	}
}

func TestExtractControlTypes_NotArray(t *testing.T) {
	types := extractControlTypes(json.RawMessage(`{"type":"slider"}`))
	if types != nil {
		t.Errorf("非数组输入应返回 nil, 得到 %v", types)
	}
}

// ====== extractTexSizeFromGeometry ======

func TestExtractTexSizeFromGeometry_Valid(t *testing.T) {
	data := []byte(`{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"test","texture_width":64,"texture_height":32}}]}`)
	w, h := extractTexSizeFromGeometry(data)
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestExtractTexSizeFromGeometry_NoGeometry(t *testing.T) {
	data := []byte(`{}`)
	w, h := extractTexSizeFromGeometry(data)
	if w != 0 || h != 0 {
		t.Errorf("空 geometry 应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestExtractTexSizeFromGeometry_InvalidJSON(t *testing.T) {
	data := []byte(`{not json}`)
	w, h := extractTexSizeFromGeometry(data)
	if w != 0 || h != 0 {
		t.Errorf("非法 JSON 应返回 0,0, 得到 %d,%d", w, h)
	}
}

func TestExtractTexSizeFromGeometry_EmptyGeometry(t *testing.T) {
	data := []byte(`{"minecraft:geometry":[]}`)
	w, h := extractTexSizeFromGeometry(data)
	if w != 0 || h != 0 {
		t.Errorf("空 geometry 数组应返回 0,0, 得到 %d,%d", w, h)
	}
}

// ====== extractFileStats ======

func TestExtractFileStats_Full(t *testing.T) {
	raw := json.RawMessage(`{
		"player": {
			"texture": ["tex1.png", "tex2.png"],
			"animation": [{"name":"idle"},{"name":"walk"}],
			"model": [{"path":"model.geo.json"},{"path":"model2.geo.json"}]
		}
	}`)
	stats, geoFiles := extractFileStats(raw)
	if stats.Textures != 2 {
		t.Errorf("Textures = %d, 期望 2", stats.Textures)
	}
	if stats.Animations != 2 {
		t.Errorf("Animations = %d, 期望 2", stats.Animations)
	}
	if stats.Models != 2 {
		t.Errorf("Models = %d, 期望 2", stats.Models)
	}
	if len(geoFiles) != 2 || geoFiles[0] != "model.geo.json" {
		t.Errorf("geoFiles = %v, 期望 [model.geo.json model2.geo.json]", geoFiles)
	}
}

func TestExtractFileStats_NoPlayer(t *testing.T) {
	raw := json.RawMessage(`{"other":{}}`)
	stats, geoFiles := extractFileStats(raw)
	if stats.Textures != 0 || stats.Animations != 0 || stats.Models != 0 {
		t.Errorf("无 player 应返回空 stats, 得到 %+v", stats)
	}
	if geoFiles != nil {
		t.Errorf("geoFiles 应 nil, 得到 %v", geoFiles)
	}
}

func TestExtractFileStats_InvalidJSON(t *testing.T) {
	raw := json.RawMessage(`{invalid}`)
	stats, geoFiles := extractFileStats(raw)
	if stats.Textures != 0 || geoFiles != nil {
		t.Errorf("非法 JSON 应返回空, 得到 %+v, %v", stats, geoFiles)
	}
}

func TestExtractFileStats_AnimationAsObject(t *testing.T) {
	raw := json.RawMessage(`{
		"player": {
			"texture": ["t1.png"],
			"animation": {"idle":{},"walk":{}},
			"model": [{"path":"m.geo.json"}]
		}
	}`)
	stats, _ := extractFileStats(raw)
	if stats.Animations != 2 {
		t.Errorf("动画对象应有 2 个, 得到 %d", stats.Animations)
	}
}

func TestExtractFileStats_ModelAsObject(t *testing.T) {
	raw := json.RawMessage(`{
		"player": {
			"texture": ["t1.png"],
			"model": {"main":"m.geo.json","sub":"s.geo.json"}
		}
	}`)
	stats, _ := extractFileStats(raw)
	if stats.Models != 2 {
		t.Errorf("模型对象应有 2 个, 得到 %d", stats.Models)
	}
}

// ====== isYSGP ======

func TestIsYSGP_Yes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.ysm")
	if err := os.WriteFile(path, []byte("YSGP\n--- [Metadata]\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if !isYSGP(path) {
		t.Error("YSGP 开头应返回 true")
	}
}

func TestIsYSGP_WithBOM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bom.ysm")
	if err := os.WriteFile(path, []byte("\xef\xbb\xbfYSGP\n--- [Metadata]\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if !isYSGP(path) {
		t.Error("BOM+YSGP 应返回 true")
	}
}

func TestIsYSGP_NotYSGP(t *testing.T) {
	path := filepath.Join(t.TempDir(), "normal.ysm")
	if err := os.WriteFile(path, []byte("NOTYSGP"), 0644); err != nil {
		t.Fatal(err)
	}
	if isYSGP(path) {
		t.Error("非 YSGP 应返回 false")
	}
}

func TestIsYSGP_EmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.ysm")
	if err := os.WriteFile(path, []byte(""), 0644); err != nil {
		t.Fatal(err)
	}
	if isYSGP(path) {
		t.Error("空文件应返回 false")
	}
}

func TestIsYSGP_NonExistent(t *testing.T) {
	if isYSGP("/nonexistent/path.ysm") {
		t.Error("不存在文件应返回 false")
	}
}

func TestIsYSGP_TooShort(t *testing.T) {
	path := filepath.Join(t.TempDir(), "short.ysm")
	if err := os.WriteFile(path, []byte("YSG"), 0644); err != nil {
		t.Fatal(err)
	}
	if isYSGP(path) {
		t.Error("短于 4 字节（不含 BOM）应返回 false")
	}
}