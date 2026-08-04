// ===== go/importer 文件导入核心单测（ADR-003 补充下沉验证）=====
package importer

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestImportFromBase64_Success(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	b64 := base64.StdEncoding.EncodeToString([]byte("modeldata"))
	err := ImportFromBase64("m.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("导入失败: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(root, "m.ysm"))
	if err != nil || string(data) != "modeldata" {
		t.Fatalf("文件写入错误: %v %q", err, string(data))
	}
}

func TestImportFromBase64_FileExists(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(root, "m.ysm"), []byte("old"), 0644)
	b64 := base64.StdEncoding.EncodeToString([]byte("new"))
	err := ImportFromBase64("m.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("文件已存在应报错")
	}
	// 覆盖模式成功
	err = ImportFromBase64("m.ysm", b64, ImportOptions{Overwrite: true}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("覆盖导入失败: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "m.ysm"))
	if string(data) != "new" {
		t.Fatalf("覆盖后内容错误: %q", string(data))
	}
}

func TestImportFromBase64_Invalid(t *testing.T) {
	b64 := base64.StdEncoding.EncodeToString([]byte("x"))
	if err := ImportFromBase64("../evil.ysm", b64, ImportOptions{}, func(rtype string) string { return "/tmp" },
		func(name, src, dst string, size int64, status, msg string) {}); err == nil {
		t.Fatal("路径穿越文件名应报错")
	}
	if err := ImportFromBase64("bad.xyz", b64, ImportOptions{}, func(rtype string) string { return "/tmp" },
		func(name, src, dst string, size int64, status, msg string) {}); err == nil {
		t.Fatal("不支持扩展名应报错")
	}
}

func TestDetectZipType(t *testing.T) {
	// 构造最小 ZIP local file header（PK\x03\x04 + 文件名）
	buildZip := func(name string) []byte {
		hdr := make([]byte, 30)
		hdr[0], hdr[1], hdr[2], hdr[3] = 0x50, 0x4B, 0x03, 0x04
		hdr[26] = byte(len(name))
		return append(hdr, []byte(name)...)
	}
	if got := DetectZipType(buildZip("pack.mcmeta")); got != "resourcepack" {
		t.Fatalf("pack.mcmeta 应识别为 resourcepack: %s", got)
	}
	if got := DetectZipType(buildZip("shaders/foo.fsh")); got != "shaderpack" {
		t.Fatalf("shaders/ 应识别为 shaderpack: %s", got)
	}
	if got := DetectZipType(buildZip("models/thing/body.json")); got != "ysm" {
		t.Fatalf("models/ 应识别为 ysm: %s", got)
	}
	if got := DetectZipType([]byte("notzip")); got != "ysm" {
		t.Fatalf("非 ZIP 应默认 ysm: %s", got)
	}
}
