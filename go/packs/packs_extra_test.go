// ===== go/packs 补充单测 =====
package packs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// ====== isYsmFile ======

func TestIsYsmFile_YsmExt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "model.ysm")
	if err := os.WriteFile(path, []byte("ysm"), 0644); err != nil {
		t.Fatal(err)
	}
	if !isYsmFile(path) {
		t.Error(".ysm 应直接返回 true")
	}
}

func TestIsYsmFile_7zExt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "model.7z")
	if err := os.WriteFile(path, []byte("not7z"), 0644); err != nil {
		t.Fatal(err)
	}
	if !isYsmFile(path) {
		t.Error(".7z 应直接返回 true（注册表声明为 YSM 扩展名）")
	}
}

func TestIsYsmFile_ZipWithYsmJson(t *testing.T) {
	path := makeZip(t, map[string]string{"sub/ysm.json": `{"spec":2}`})
	if !isYsmFile(path) {
		t.Error("含 ysm.json 的 zip 应返回 true")
	}
}

func TestIsYsmFile_ZipWithModels(t *testing.T) {
	path := makeZip(t, map[string]string{"models/head.geo.json": `{}`})
	if !isYsmFile(path) {
		t.Error("含 models/ 的 zip 应返回 true")
	}
}

func TestIsYsmFile_ZipWithoutYsm(t *testing.T) {
	path := makeZip(t, map[string]string{"readme.txt": "hello"})
	if isYsmFile(path) {
		t.Error("不含 YSM 内容的 zip 应返回 false")
	}
}

func TestIsYsmFile_OtherExt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file.txt")
	if err := os.WriteFile(path, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if isYsmFile(path) {
		t.Error(".txt 应返回 false")
	}
}

func TestIsYsmFile_BadZip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.zip")
	if err := os.WriteFile(path, []byte("notzip"), 0644); err != nil {
		t.Fatal(err)
	}
	if isYsmFile(path) {
		t.Error("坏 zip 应返回 false")
	}
}

// ====== hasMcmeta ======

func TestHasMcmeta_Yes(t *testing.T) {
	path := makeZip(t, map[string]string{"pack.mcmeta": `{"pack":{"pack_format":15}}`})
	if !hasMcmeta(path) {
		t.Error("含 pack.mcmeta 的 zip 应返回 true")
	}
}

func TestHasMcmeta_No(t *testing.T) {
	path := makeZip(t, map[string]string{"readme.txt": "hello"})
	if hasMcmeta(path) {
		t.Error("无 pack.mcmeta 的 zip 应返回 false")
	}
}

func TestHasMcmeta_NotZip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file.txt")
	if err := os.WriteFile(path, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if hasMcmeta(path) {
		t.Error("非 zip 应返回 false")
	}
}

// ====== hasShaders ======

func TestHasShaders_Yes(t *testing.T) {
	path := makeZip(t, map[string]string{"shaders/anything.glsl": "data"})
	if !hasShaders(path) {
		t.Error("含 shaders/ 的 zip 应返回 true")
	}
}

func TestHasShaders_No(t *testing.T) {
	path := makeZip(t, map[string]string{"readme.txt": "hello"})
	if hasShaders(path) {
		t.Error("无 shaders/ 的 zip 应返回 false")
	}
}

func TestHasShaders_NotZip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file.txt")
	if err := os.WriteFile(path, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if hasShaders(path) {
		t.Error("非 zip 应返回 false")
	}
}

// ====== ReadPackMeta from ZIP ======

func TestReadPackMeta_Zip(t *testing.T) {
	path := makeZip(t, map[string]string{
		"pack.mcmeta": `{"pack":{"pack_format":12,"description":"ZIP pack"}}`,
		"pack.png":    "png-data",
	})
	meta, thumb, err := ReadPackMeta(path)
	if err != nil {
		t.Fatalf("ReadPackMeta(zip) 失败: %v", err)
	}
	if meta.Pack.PackFormat != 12 {
		t.Errorf("pack_format = %d, 期望 12", meta.Pack.PackFormat)
	}
	if meta.Desc() != "ZIP pack" {
		t.Errorf("description = %q, 期望 'ZIP pack'", meta.Desc())
	}
	if thumb == "" {
		t.Error("thumb 不应为空")
	}
}

func TestReadPackMeta_ZipNoMcmeta(t *testing.T) {
	path := makeZip(t, map[string]string{"readme.txt": "hello"})
	_, _, err := ReadPackMeta(path)
	if err == nil {
		t.Error("无 pack.mcmeta 的 zip 应报错")
	}
}

func TestReadPackMeta_ZipBadZip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.zip")
	if err := os.WriteFile(path, []byte("notzip"), 0644); err != nil {
		t.Fatal(err)
	}
	_, _, err := ReadPackMeta(path)
	if err == nil {
		t.Error("坏 zip 应报错")
	}
}

// ====== ReadShaderpackLang from ZIP ======

func TestReadShaderpackLang_Zip(t *testing.T) {
	path := makeZip(t, map[string]string{
		"lang/en_US.lang": "pack.name=光影包标题\nsome.key=任意值",
	})
	resultStr := ReadShaderpackLang(path)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, ok := result["name"].(string); !ok || name == "" {
		t.Errorf("name = %q, 期望非空", name)
	}
}

func TestReadShaderpackLang_ZipNoLang(t *testing.T) {
	path := makeZip(t, map[string]string{"readme.txt": "hello"})
	resultStr := ReadShaderpackLang(path)
	var result map[string]interface{}
	json.Unmarshal([]byte(resultStr), &result)
	if name, _ := result["name"].(string); name != "" {
		t.Errorf("无 lang 文件时 name 应为空, 得到 %q", name)
	}
}

// ====== DetectResourceType with detectors ======

func TestDetectResourceType_YsmDetector(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "ysm-model", Extensions: []string{".ysm", ".zip"}, Detector: "ysm"},
		},
	}
	// .ysm 直接匹配
	if got := DetectResourceType("/path/model.ysm", reg); got != "ysm-model" {
		t.Errorf(".ysm 应匹配 ysm-model, 得到 %q", got)
	}
	// .zip 含 ysm.json → 匹配
	zipPath := makeZip(t, map[string]string{"ysm.json": `{"spec":2}`})
	if got := DetectResourceType(zipPath, reg); got != "ysm-model" {
		t.Errorf("含 ysm.json 的 .zip 应匹配 ysm-model, 得到 %q", got)
	}
	// .zip 不含 ysm → 不匹配
	emptyZip := makeZip(t, map[string]string{"readme.txt": "hello"})
	if got := DetectResourceType(emptyZip, reg); got != "" {
		t.Errorf("不含 ysm 的 .zip 应不匹配, 得到 %q", got)
	}
}

func TestDetectResourceType_NoMatch(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "test", Extensions: []string{".foo"}, Detector: "extension"},
		},
	}
	if got := DetectResourceType("/path/file.unknown", reg); got != "" {
		t.Errorf("不匹配应返回空, 得到 %q", got)
	}
}