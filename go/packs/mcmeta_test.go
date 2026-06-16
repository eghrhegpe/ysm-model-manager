package packs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestHasExt(t *testing.T) {
	tests := []struct {
		ext  string
		exts []string
		want bool
	}{
		{".zip", []string{".zip", ".jar"}, true},
		{".jar", []string{".zip", ".jar"}, true},
		{".exe", []string{".zip"}, false},
	}
	for _, tc := range tests {
		got := hasExt(tc.ext, tc.exts)
		if got != tc.want {
			t.Errorf("hasExt(%q, %v) = %v, want %v", tc.ext, tc.exts, got, tc.want)
		}
	}
}

func TestDetectResourceType_ExtensionOnly(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "test-type", Extensions: []string{".foo"}, Detector: "extension"},
			{ID: "other-type", Extensions: []string{".bar"}, Detector: "extension"},
		},
	}
	if got := DetectResourceType("/path/file.foo", reg); got != "test-type" {
		t.Errorf("got %q, want test-type", got)
	}
	if got := DetectResourceType("/path/file.bar", reg); got != "other-type" {
		t.Errorf("got %q, want other-type", got)
	}
	if got := DetectResourceType("/path/file.unknown", reg); got != "" {
		t.Errorf("got %q, want ''", got)
	}
}

func TestReadPackMeta_Dir(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "pack.mcmeta")
	metaContent := `{"pack":{"pack_format":15,"description":"测试资源包"}}`
	if err := os.WriteFile(metaPath, []byte(metaContent), 0644); err != nil {
		t.Fatal(err)
	}

	meta, thumb, err := ReadPackMeta(dir)
	if err != nil {
		t.Fatalf("ReadPackMeta(dir) = %v", err)
	}
	if meta.Pack.PackFormat != 15 {
		t.Errorf("pack_format = %d, want 15", meta.Pack.PackFormat)
	}
	if meta.Desc() != "测试资源包" {
		t.Errorf("description = %q, want '测试资源包'", meta.Desc())
	}
	if thumb != "" {
		t.Errorf("thumb = %q, want empty", thumb)
	}
}

func TestReadPackMeta_DirWithThumb(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "pack.mcmeta")
	if err := os.WriteFile(metaPath, []byte(`{"pack":{"pack_format":1,"description":"with thumb"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	pngPath := filepath.Join(dir, "pack.png")
	if err := os.WriteFile(pngPath, []byte("fake-png-data"), 0644); err != nil {
		t.Fatal(err)
	}

	_, thumb, err := ReadPackMeta(dir)
	if err != nil {
		t.Fatalf("ReadPackMeta() = %v", err)
	}
	if thumb == "" {
		t.Fatal("thumb = empty, want base64 data")
	}
}

func TestReadPackMeta_NotFound(t *testing.T) {
	dir := t.TempDir()
	_, _, err := ReadPackMeta(dir)
	if err == nil {
		t.Fatal("ReadPackMeta(empty dir) = nil, want error")
	}
}

func TestReadPackMeta_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "pack.mcmeta")
	if err := os.WriteFile(metaPath, []byte(`not json`), 0644); err != nil {
		t.Fatal(err)
	}
	_, _, err := ReadPackMeta(dir)
	if err == nil {
		t.Fatal("ReadPackMeta(invalid JSON) = nil, want error")
	}
}

func TestReadShaderpackLang_Dir(t *testing.T) {
	dir := t.TempDir()
	langDir := filepath.Join(dir, "lang")
	if err := os.MkdirAll(langDir, 0755); err != nil {
		t.Fatal(err)
	}
	langContent := "pack.name=光影测试包\ntitle=My Shader\nsome.key=任意值"
	if err := os.WriteFile(filepath.Join(langDir, "en_US.lang"), []byte(langContent), 0644); err != nil {
		t.Fatal(err)
	}

	resultStr := ReadShaderpackLang(dir)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, ok := result["name"].(string); !ok || name == "" {
		t.Errorf("name = %q, 期望非空", name)
	}
}

func TestReadShaderpackLang_NotFound(t *testing.T) {
	dir := t.TempDir()
	resultStr := ReadShaderpackLang(dir)
	var result map[string]interface{}
	json.Unmarshal([]byte(resultStr), &result)
	if name, _ := result["name"].(string); name != "" {
		t.Errorf("name = %q, 期望空", name)
	}
}

func TestReadShaderpackLang_SupportedFormats(t *testing.T) {
	// [int] 格式
	fr := types.FormatRange{}
	if err := fr.UnmarshalJSON([]byte(`5`)); err != nil {
		t.Fatal(err)
	}
	if fr.Min != 5 || fr.Max != 5 {
		t.Errorf("[int] → Min=%d Max=%d, want 5,5", fr.Min, fr.Max)
	}
	// [int, int] 格式
	fr = types.FormatRange{}
	if err := fr.UnmarshalJSON([]byte(`[3,7]`)); err != nil {
		t.Fatal(err)
	}
	if fr.Min != 3 || fr.Max != 7 {
		t.Errorf("[int,int] → Min=%d Max=%d, want 3,7", fr.Min, fr.Max)
	}
	// 对象格式
	fr = types.FormatRange{}
	if err := fr.UnmarshalJSON([]byte(`{"min_inclusive":1,"max_inclusive":2}`)); err != nil {
		t.Fatal(err)
	}
	if fr.Min != 1 || fr.Max != 2 {
		t.Errorf("对象 → Min=%d Max=%d, want 1,2", fr.Min, fr.Max)
	}
}
