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

func TestImportFromBase64_JsonWhitelist(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	rootFn := func(rtype string) string { return root }
	logFn := func(name, src, dst string, size int64, status, msg string) {}
	b64 := base64.StdEncoding.EncodeToString([]byte("{}"))

	// ysm.json 入口清单放行
	if err := ImportFromBase64("ysm.json", b64, ImportOptions{}, rootFn, logFn); err != nil {
		t.Fatalf("ysm.json 应放行: %v", err)
	}
	// 大写 YSM.JSON 放行
	if err := ImportFromBase64("YSM.JSON", b64, ImportOptions{Overwrite: true}, rootFn, logFn); err != nil {
		t.Fatalf("YSM.JSON 应放行: %v", err)
	}
	// 包内 geometry / animation / 语言 json 一律拒绝
	for _, name := range []string{"main.json", "arm.json", "slashblade.animation.json", "zh_cn.json", "en_us.json"} {
		if err := ImportFromBase64(name, b64, ImportOptions{}, rootFn, logFn); err == nil {
			t.Fatalf("%s 应被 ysm.json 白名单拒绝", name)
		}
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

// P3 修复（code_review）：失败清理分支——WriteFileAtomic 任一失败不得留 .import-*.tmp 残渣、
// 不得留半截目标文件（头号反模式回归防线）
func TestImportFromBase64_WriteFailureCleanup(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	rootFn := func(rtype string) string { return root }
	logFn := func(name, src, dst string, size int64, status, msg string) {}
	b64 := base64.StdEncoding.EncodeToString([]byte("modeldata"))

	// 制造落地失败：destPath 的父目录是已存在文件（Rename 到文件内部必然失败）
	blocker := filepath.Join(root, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	// 直接测 WriteFileAtomic：destPath 的 dir 是普通文件 → CreateTemp 失败（应报错且无 tmp 残留）
	err := ImportFromBase64("blocker", b64, ImportOptions{Overwrite: true}, rootFn, logFn)
	if err == nil {
		t.Fatal("目标为文件时导入应失败")
	}
	// 目标目录下不应有 .import-*.tmp 残渣（WriteFileAtomic 清理验证）
	matches, _ := filepath.Glob(filepath.Join(root, ".import-*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("失败后不应有 .import-*.tmp 残留: %v", matches)
	}
	// 正常路径无半截文件：目标存在（overwrite 前内容不变）
	data, err := os.ReadFile(blocker)
	if err != nil || string(data) != "x" {
		t.Fatalf("阻塞文件不应被半截写入: %q %v", string(data), err)
	}
}
