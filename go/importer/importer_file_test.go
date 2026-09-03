// ===== go/importer 文件导入核心单测（ADR-003 补充下沉验证）=====
package importer

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestImportFromBase64_Success(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	b64 := base64.StdEncoding.EncodeToString([]byte("modeldata"))
	dest, _, err := ImportFromBase64("m.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	if err != nil {
		t.Fatalf("导入失败: %v", err)
	}
	if dest != filepath.Join(root, "m.ysm") {
		t.Fatalf("destPath = %q, 期望 %q", dest, filepath.Join(root, "m.ysm"))
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
	_, _, err := ImportFromBase64("m.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	if err == nil {
		t.Fatal("文件已存在应报错")
	}
	// 覆盖模式成功
	_, _, err = ImportFromBase64("m.ysm", b64, ImportOptions{Overwrite: true}, func(rtype string) string { return root },
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
	if _, _, err := ImportFromBase64("../evil.ysm", b64, ImportOptions{}, func(rtype string) string { return "/tmp" },
		func(name, src, dst string, size int64, status, msg string) {}); err == nil {
		t.Fatal("路径穿越文件名应报错")
	}
	if _, _, err := ImportFromBase64("bad.xyz", b64, ImportOptions{}, func(rtype string) string { return "/tmp" },
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
	if _, _, err := ImportFromBase64("ysm.json", b64, ImportOptions{}, rootFn, logFn); err != nil {
		t.Fatalf("ysm.json 应放行: %v", err)
	}
	// 大写 YSM.JSON 放行
	if _, _, err := ImportFromBase64("YSM.JSON", b64, ImportOptions{Overwrite: true}, rootFn, logFn); err != nil {
		t.Fatalf("YSM.JSON 应放行: %v", err)
	}
	// 包内 geometry / animation / 语言 json 一律拒绝
	for _, name := range []string{"main.json", "arm.json", "slashblade.animation.json", "zh_cn.json", "en_us.json"} {
		if _, _, err := ImportFromBase64(name, b64, ImportOptions{}, rootFn, logFn); err == nil {
			t.Fatalf("%s 应被 ysm.json 白名单拒绝", name)
		}
	}
}

func TestDetectContainerType(t *testing.T) {
	// 构造最小 ZIP local file header（PK\x03\x04 + 文件名）
	buildZip := func(name string) []byte {
		hdr := make([]byte, 30)
		hdr[0], hdr[1], hdr[2], hdr[3] = 0x50, 0x4B, 0x03, 0x04
		hdr[26] = byte(len(name))
		return append(hdr, []byte(name)...)
	}
	if got := DetectContainerType(buildZip("pack.mcmeta")); got != "resourcepack" {
		t.Fatalf("pack.mcmeta 应识别为 resourcepack: %s", got)
	}
	if got := DetectContainerType(buildZip("shaders/foo.fsh")); got != "shaderpack" {
		t.Fatalf("shaders/ 应识别为 shaderpack: %s", got)
	}
	if got := DetectContainerType(buildZip("models/thing/body.json")); got != "ysm" {
		t.Fatalf("models/ 应识别为 ysm: %s", got)
	}
	if got := DetectContainerType(buildZip("assets/my_pack/maid_model.json")); got != "maid-model" {
		t.Fatalf("assets/.../maid_model.json 应识别为 maid-model: %s", got)
	}
	if got := DetectContainerType(buildZip("assets/my_pack/chair_model.json")); got != "maid-model" {
		t.Fatalf("assets/.../chair_model.json 应识别为 maid-model: %s", got)
	}
	if got := DetectContainerType([]byte("notzip")); got != "" {
		t.Fatalf("非 ZIP 应返回空（识别不出就是识别不出）: %q", got)
	}
}

// 失败清理分支——WriteFileAtomic 任一失败不得留 .import-*.tmp 残渣、
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

	// 制造落地失败：destPath（root/blocker.ysm）已存在为目录 → CreateTemp 成功后
	// Rename 到目录必然失败（Windows 上 os.Rename 不覆盖已存在目录）
	blocker := filepath.Join(root, "blocker.ysm")
	if err := os.MkdirAll(blocker, 0755); err != nil {
		t.Fatal(err)
	}
	_, _, err := ImportFromBase64("blocker.ysm", b64, ImportOptions{Overwrite: true}, rootFn, logFn)
	if err == nil {
		t.Fatal("目标为目录时导入应失败")
	}
	// 结构化错误码：落地阶段失败 → WRITE_FAILED
	var ae types.AppError
	if !errors.As(err, &ae) {
		t.Fatalf("错误应为 AppError，实际: %v", err)
	}
	if ae.Code != "WRITE_FAILED" {
		t.Fatalf("错误码 = %q, 期望 WRITE_FAILED", ae.Code)
	}
	// 目标目录下不应有 .atomic-*.tmp 残渣（WriteFileAtomic 清理验证）
	matches, _ := filepath.Glob(filepath.Join(root, ".atomic-*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("失败后不应有 .atomic-*.tmp 残留: %v", matches)
	}
	// 原目标未被破坏：阻塞目录仍在
	if info, err := os.Stat(blocker); err != nil || !info.IsDir() {
		t.Fatalf("阻塞目录应原样保留: %v", err)
	}
}
