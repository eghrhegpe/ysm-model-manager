// ===== go/geometry archive 单测（零覆盖包补测）=====
// ExtractFirstPNGFromZip：zip 提取第一张 PNG（预览用，50MB 上限）
package geometry

import (
	"archive/zip"
	"bytes"
	"testing"
)

// 构造 zip：文件名 → 内容
func buildZip(t *testing.T, files map[string][]byte) []byte {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestExtractFirstPNGFromZip(t *testing.T) {
	pngData := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3}
	zipData := buildZip(t, map[string][]byte{
		"textures/icon.png": pngData,
		"model.geo.json":    []byte("{}"),
	})
	got := ExtractFirstPNGFromZip(zipData, int64(len(zipData)))
	if !bytes.Equal(got, pngData) {
		t.Fatalf("期望提取第一个 PNG, got %v", got)
	}
}

func TestExtractFirstPNGFromZip_NoPNG(t *testing.T) {
	zipData := buildZip(t, map[string][]byte{"a.json": []byte("{}")})
	if got := ExtractFirstPNGFromZip(zipData, int64(len(zipData))); got != nil {
		t.Fatalf("无 PNG 应返回 nil, got %v", got)
	}
}

func TestExtractFirstPNGFromZip_InvalidZip(t *testing.T) {
	if got := ExtractFirstPNGFromZip([]byte("not a zip"), 10); got != nil {
		t.Fatalf("非法 zip 应返回 nil, got %v", got)
	}
}
