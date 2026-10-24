// ===== go/importer 文件导入核心单测（ADR-003 补充下沉验证）=====
package importer

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

func TestImportFromBase64_Success(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		testutil.NoError(t, err)
	}
	b64 := base64.StdEncoding.EncodeToString([]byte("modeldata"))
	dest, _, err := ImportFromBase64("m.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "导入失败")
	testutil.Equal(t, dest, filepath.Join(root, "m.ysm"), "destPath")
	data, err := os.ReadFile(filepath.Join(root, "m.ysm"))
	testutil.NoError(t, err, "文件写入错误")
	testutil.Equal(t, string(data), "modeldata", "文件写入错误")
}

func TestImportFromBase64_FileExists(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		testutil.NoError(t, err)
	}
	_ = os.WriteFile(filepath.Join(root, "m.ysm"), []byte("old"), 0644)
	b64 := base64.StdEncoding.EncodeToString([]byte("new"))
	_, _, err := ImportFromBase64("m.ysm", b64, ImportOptions{}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NotNil(t, err, "文件已存在应报错")
	// 覆盖模式成功
	_, _, err = ImportFromBase64("m.ysm", b64, ImportOptions{Overwrite: true}, func(rtype string) string { return root },
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NoError(t, err, "覆盖导入失败")
	data, _ := os.ReadFile(filepath.Join(root, "m.ysm"))
	testutil.Equal(t, string(data), "new", "覆盖后内容错误")
}

func TestImportFromBase64_Invalid(t *testing.T) {
	b64 := base64.StdEncoding.EncodeToString([]byte("x"))
	_, _, err := ImportFromBase64("../evil.ysm", b64, ImportOptions{}, func(rtype string) string { return "/tmp" },
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NotNil(t, err, "路径穿越文件名应报错")
	_, _, err = ImportFromBase64("bad.xyz", b64, ImportOptions{}, func(rtype string) string { return "/tmp" },
		func(name, src, dst string, size int64, status, msg string) {})
	testutil.NotNil(t, err, "不支持扩展名应报错")
}

func TestImportFromBase64_JsonWhitelist(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		testutil.NoError(t, err)
	}
	rootFn := func(rtype string) string { return root }
	logFn := func(name, src, dst string, size int64, status, msg string) {}
	b64 := base64.StdEncoding.EncodeToString([]byte("{}"))

	// ysm.json 入口清单放行
	_, _, err := ImportFromBase64("ysm.json", b64, ImportOptions{}, rootFn, logFn)
	testutil.NoError(t, err, "ysm.json 应放行")
	// 大写 YSM.JSON 放行
	_, _, err = ImportFromBase64("YSM.JSON", b64, ImportOptions{Overwrite: true}, rootFn, logFn)
	testutil.NoError(t, err, "YSM.JSON 应放行")
	// 包内 geometry / animation / 语言 json 一律拒绝
	for _, name := range []string{"main.json", "arm.json", "slashblade.animation.json", "zh_cn.json", "en_us.json"} {
		_, _, werr := ImportFromBase64(name, b64, ImportOptions{}, rootFn, logFn)
		testutil.NotNil(t, werr, "%s 应被 ysm.json 白名单拒绝", name)
	}
}

func TestDetectContainerType(t *testing.T) {
	// 标准 ZIP fixture（buildZipStd 见 importer_reverse_test.go：zip.NewWriter 写
	// 完整 central directory——DetectContainerType 已收敛 zip.NewReader，锐评 #16）
	got := DetectContainerType(buildZipStd(zipEntry{"pack.mcmeta", nil}))
	testutil.Equal(t, got, "resourcepack", "pack.mcmeta 应识别为 resourcepack")
	got = DetectContainerType(buildZipStd(zipEntry{"shaders/foo.fsh", nil}))
	testutil.Equal(t, got, "shaderpack", "shaders/ 应识别为 shaderpack")
	got = DetectContainerType(buildZipStd(zipEntry{"models/thing/body.json", nil}))
	testutil.Equal(t, got, "ysm", "models/ 应识别为 ysm")
	got = DetectContainerType(buildZipStd(zipEntry{"assets/my_pack/maid_model.json", nil}))
	testutil.Equal(t, got, "maid-model", "assets/.../maid_model.json 应识别为 maid-model")
	got = DetectContainerType(buildZipStd(zipEntry{"assets/my_pack/chair_model.json", nil}))
	testutil.Equal(t, got, "maid-model", "assets/.../chair_model.json 应识别为 maid-model")
	got = DetectContainerType([]byte("notzip"))
	testutil.Equal(t, got, "", "非 ZIP 应返回空（识别不出就是识别不出）")
}

// 失败清理分支——WriteFileAtomic 任一失败不得留 .import-*.tmp 残渣、
// 不得留半截目标文件（头号反模式回归防线）
func TestImportFromBase64_WriteFailureCleanup(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "repo")
	if err := os.MkdirAll(root, 0755); err != nil {
		testutil.NoError(t, err)
	}
	rootFn := func(rtype string) string { return root }
	logFn := func(name, src, dst string, size int64, status, msg string) {}
	b64 := base64.StdEncoding.EncodeToString([]byte("modeldata"))

	// 制造落地失败：destPath（root/blocker.ysm）已存在为目录 → CreateTemp 成功后
	// Rename 到目录必然失败（Windows 上 os.Rename 不覆盖已存在目录）
	blocker := filepath.Join(root, "blocker.ysm")
	if err := os.MkdirAll(blocker, 0755); err != nil {
		testutil.NoError(t, err)
	}
	_, _, err := ImportFromBase64("blocker.ysm", b64, ImportOptions{Overwrite: true}, rootFn, logFn)
	testutil.NotNil(t, err, "目标为目录时导入应失败")
	// 结构化错误码：落地阶段失败 → WRITE_FAILED
	testutil.Equal(t, appErrCode(t, err), types.ErrorCode("WRITE_FAILED"), "错误码")
	// 目标目录下不应有 .atomic-*.tmp 残渣（WriteFileAtomic 清理验证）
	matches, _ := filepath.Glob(filepath.Join(root, ".atomic-*.tmp"))
	testutil.Equal(t, len(matches), 0, "失败后不应有 .atomic-*.tmp 残留: %v", matches)
	// 原目标未被破坏：阻塞目录仍在
	info, err := os.Stat(blocker)
	testutil.NoError(t, err, "阻塞目录应原样保留")
	testutil.Equal(t, info.IsDir(), true, "阻塞目录应原样保留")
}
