package packs

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
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
	if got := DetectResourceType("/path/file.unknown", reg); got != "other" {
		t.Errorf("got %q, want 'other'", got)
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

// writeZipPack 构造 ZIP 资源包（pack.mcmeta + 可选 pack.png），返回文件路径
func writeZipPack(t *testing.T, png []byte) string {
	t.Helper()
	entries := map[string]string{
		"pack.mcmeta": `{"pack":{"pack_format":15,"description":"测试"}}`,
	}
	if png != nil {
		entries["pack.png"] = string(png)
	}
	return testutil.WriteZipFile(t, "pack.zip", entries)
}

// ADR-033 截断探测边界回归——pack.png 恰好 10MB 保留、
// 10MB+1 截断置空（limit+1 探测），防未来回退成普通 LimitReader 后损坏缩略图静默展示
func TestReadPackMeta_ZipPackPngAtLimit(t *testing.T) {
	path := writeZipPack(t, bytes.Repeat([]byte{1}, 10<<20))
	_, thumb, err := ReadPackMeta(path)
	if err != nil {
		t.Fatalf("ReadPackMeta() = %v", err)
	}
	if thumb == "" {
		t.Fatal("pack.png 恰好 10MB 应保留缩略图")
	}
}

func TestReadPackMeta_ZipPackPngOverLimit(t *testing.T) {
	path := writeZipPack(t, bytes.Repeat([]byte{1}, (10<<20)+1))
	_, thumb, err := ReadPackMeta(path)
	if err != nil {
		t.Fatalf("ReadPackMeta() = %v", err)
	}
	if thumb != "" {
		t.Fatal("pack.png 超过 10MB 应置空缩略图（截断检测），实际返回了缩略图")
	}
}

func TestReadPackMeta_DirPackPngOverLimit(t *testing.T) {
	dir := t.TempDir()
	metaPath := filepath.Join(dir, "pack.mcmeta")
	if err := os.WriteFile(metaPath, []byte(`{"pack":{"pack_format":15,"description":"测试"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	// 目录形态 pack.png > 10MB：stat 预检跳过
	if err := os.WriteFile(filepath.Join(dir, "pack.png"), bytes.Repeat([]byte{1}, (10<<20)+1), 0644); err != nil {
		t.Fatal(err)
	}
	_, thumb, err := ReadPackMeta(dir)
	if err != nil {
		t.Fatalf("ReadPackMeta(dir) = %v", err)
	}
	if thumb != "" {
		t.Fatal("目录形态 pack.png 超过 10MB 应置空缩略图，实际返回了缩略图")
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

// lang 1MB 上限回归测试——镜像 pack.png 超限模式
// （>1MB 置空返回空 name；恰好 1MB 仍解析；dir/zip 两分支）

func TestReadShaderpackLang_DirOverLimit(t *testing.T) {
	dir := t.TempDir()
	langDir := filepath.Join(dir, "lang")
	if err := os.MkdirAll(langDir, 0755); err != nil {
		t.Fatal(err)
	}
	// >1MB lang 文件
	big := make([]byte, (1<<20)+1024)
	for i := range big {
		big[i] = 'a'
	}
	if err := os.WriteFile(filepath.Join(langDir, "en_US.lang"), big, 0644); err != nil {
		t.Fatal(err)
	}
	resultStr := ReadShaderpackLang(dir)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, _ := result["name"].(string); name != "" {
		t.Errorf(">1MB dir lang 应置空 name，实际 %q", name)
	}
}

func TestReadShaderpackLang_DirExactLimit(t *testing.T) {
	dir := t.TempDir()
	langDir := filepath.Join(dir, "lang")
	if err := os.MkdirAll(langDir, 0755); err != nil {
		t.Fatal(err)
	}
	// 恰好 1MB（含 title 行）仍应解析成功
	exact := make([]byte, (1<<20)-len("title=ok\n"))
	copy(exact, "title=ok\n")
	for i := len("title=ok\n"); i < len(exact); i++ {
		exact[i] = 'b'
	}
	if err := os.WriteFile(filepath.Join(langDir, "en_US.lang"), exact, 0644); err != nil {
		t.Fatal(err)
	}
	resultStr := ReadShaderpackLang(dir)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, _ := result["name"].(string); name == "" {
		t.Error("恰好 1MB dir lang 应解析出 name")
	}
}

func TestReadShaderpackLang_ZipOverLimit(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "shader.zip")
	big := make([]byte, (1<<20)+1024)
	for i := range big {
		big[i] = 'a'
	}
	// 构造含 >1MB lang 的 zip
	data := testutil.MakeZipBytes(t, map[string]string{"lang/en_US.lang": string(big)})
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	resultStr := ReadShaderpackLang(zipPath)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, _ := result["name"].(string); name != "" {
		t.Errorf(">1MB zip lang 应置空 name，实际 %q", name)
	}
}

// ====== 审核补测：sentinel 错误 / 大小写归一 / .json YSM / 未测分支 ======

// 空目录 → ErrPackMetaNotFound（errors.Is 可判定，禁止调用方 strings.Contains 文本匹配）
func TestReadPackMeta_NotFoundIsSentinel(t *testing.T) {
	_, _, err := ReadPackMeta(t.TempDir())
	if !errors.Is(err, ErrPackMetaNotFound) {
		t.Fatalf("空目录错误 = %v, 期望 errors.Is(err, ErrPackMetaNotFound)", err)
	}
}

// 目录 pack.mcmeta > 1MB → ErrPackMetaTooLarge
func TestReadPackMeta_DirMcmetaOverLimitIsSentinel(t *testing.T) {
	dir := t.TempDir()
	big := bytes.Repeat([]byte{'a'}, (1<<20)+1)
	if err := os.WriteFile(filepath.Join(dir, "pack.mcmeta"), big, 0644); err != nil {
		t.Fatal(err)
	}
	_, _, err := ReadPackMeta(dir)
	if !errors.Is(err, ErrPackMetaTooLarge) {
		t.Fatalf("超限错误 = %v, 期望 errors.Is(err, ErrPackMetaTooLarge)", err)
	}
}

// ZIP 内 pack.mcmeta > 1MB → ErrPackMetaTooLarge（与 dir 分支口径一致，
// 而非误导性的「未找到」）
func TestReadPackMeta_ZipMcmetaOverLimit(t *testing.T) {
	big := strings.Repeat("a", (1<<20)+1)
	path := testutil.WriteZipFile(t, "pack.zip", map[string]string{"pack.mcmeta": big})
	_, _, err := ReadPackMeta(path)
	if !errors.Is(err, ErrPackMetaTooLarge) {
		t.Fatalf("zip 超限 mcmeta 错误 = %v, 期望 errors.Is(err, ErrPackMetaTooLarge)", err)
	}
}

// 目录 pack.mcmeta 恰好 1MB 仍应解析成功
func TestReadPackMeta_DirMcmetaExactLimit(t *testing.T) {
	dir := t.TempDir()
	prefix := `{"pack":{"pack_format":15}}`
	exact := make([]byte, (1<<20)-len(prefix))
	copy(exact, prefix)
	for i := len(prefix); i < len(exact); i++ {
		exact[i] = ' '
	}
	if err := os.WriteFile(filepath.Join(dir, "pack.mcmeta"), exact, 0644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadPackMeta(dir); err != nil {
		t.Fatalf("恰好 1MB pack.mcmeta 应成功: %v", err)
	}
}

// UTF-8 BOM 前缀（PowerShell 写入）应被剥离后正常解析
func TestReadPackMeta_ZipBom(t *testing.T) {
	path := testutil.WriteZipFile(t, "pack.zip", map[string]string{
		"pack.mcmeta": "\xEF\xBB\xBF{\"pack\":{\"pack_format\":9,\"description\":\"bom\"}}",
	})
	meta, _, err := ReadPackMeta(path)
	if err != nil {
		t.Fatalf("BOM 前缀应解析成功: %v", err)
	}
	if meta.Pack.PackFormat != 9 {
		t.Errorf("pack_format = %d, want 9", meta.Pack.PackFormat)
	}
}

// 目录 pack.mcmeta 带 BOM 前缀也应解析成功
func TestReadPackMeta_DirBom(t *testing.T) {
	dir := t.TempDir()
	content := "\xEF\xBB\xBF{\"pack\":{\"pack_format\":6,\"description\":\"dir bom\"}}"
	if err := os.WriteFile(filepath.Join(dir, "pack.mcmeta"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	meta, _, err := ReadPackMeta(dir)
	if err != nil {
		t.Fatalf("dir BOM 前缀应解析成功: %v", err)
	}
	if meta.Pack.PackFormat != 6 {
		t.Errorf("pack_format = %d, want 6", meta.Pack.PackFormat)
	}
}

// 非目录非 zip（如 .jar）→ 不 panic，返回 ErrPackMetaNotFound
func TestReadPackMeta_NotZipNoMcmeta(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lib.jar")
	if err := os.WriteFile(path, []byte("jar"), 0644); err != nil {
		t.Fatal(err)
	}
	_, _, err := ReadPackMeta(path)
	if !errors.Is(err, ErrPackMetaNotFound) {
		t.Fatalf(".jar 文件错误 = %v, 期望 errors.Is(err, ErrPackMetaNotFound)", err)
	}
}

// 不存在的路径 → 错误经 %w 包裹，errors.Is(err, os.ErrNotExist) 成立
func TestReadPackMeta_StatErrorWrapped(t *testing.T) {
	_, _, err := ReadPackMeta(filepath.Join(t.TempDir(), "missing.zip"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stat 错误应保留 %%w 链: %v", err)
	}
}

// ====== DetectResourceType 鲁棒性 ======

func TestDetectResourceType_NilRegistry(t *testing.T) {
	if got := DetectResourceType("/path/file.zip", nil); got != "" {
		t.Fatalf("nil registry 应返回 '', 得到 %q", got)
	}
}

func TestDetectResourceType_EmptyRegistry(t *testing.T) {
	reg := &types.ResourceTypeRegistry{}
	if got := DetectResourceType("/path/file.zip", reg); got != "" {
		t.Fatalf("空 registry 应返回 '', 得到 %q", got)
	}
}

// 外部 registry 扩展名大写（.ZIP）不应导致检测静默失效（hasExt 大小写归一）
func TestDetectResourceType_UppercaseRegistryExt(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "resourcepack", Extensions: []string{".ZIP"}, Detector: "extension"},
		},
	}
	if got := DetectResourceType("/path/pack.zip", reg); got != "resourcepack" {
		t.Fatalf("registry 大写扩展名应匹配, 得到 %q", got)
	}
}

// detector 大写（YSM）不应导致内容型检测被跳过
func TestDetectResourceType_UppercaseDetector(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "ysm-model", Extensions: []string{".ysm"}, Detector: "YSM"},
		},
	}
	if got := DetectResourceType("/path/model.ysm", reg); got != "ysm-model" {
		t.Fatalf("大写 detector 应匹配, 得到 %q", got)
	}
}

// ====== hasExt 大小写归一 ======

func TestHasExt_CaseInsensitive(t *testing.T) {
	if !hasExt(".zip", []string{".ZIP", ".JAR"}) {
		t.Error("hasExt('.zip', ['.ZIP']) 应为 true（registry 大写扩展名）")
	}
	if hasExt(".exe", []string{".Zip"}) {
		t.Error("hasExt('.exe', ['.Zip']) 应为 false")
	}
}

// ====== isYsmFile .json 分支 ======

func TestIsYsmFile_YsmJsonFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ysm.json")
	if err := os.WriteFile(path, []byte(`{"spec":2}`), 0644); err != nil {
		t.Fatal(err)
	}
	if !isYsmFile(path) {
		t.Error("ysm.json 应返回 true（注册表声明 .json 为 YSM 扩展）")
	}
}

func TestIsYsmFile_OtherJsonNotYsm(t *testing.T) {
	path := filepath.Join(t.TempDir(), "animation.json")
	if err := os.WriteFile(path, []byte(`{}`), 0644); err != nil {
		t.Fatal(err)
	}
	if isYsmFile(path) {
		t.Error("非 ysm.json 的 .json 不应判为 YSM（scanner 同口径）")
	}
}

// .json 扩展经 DetectResourceType（ysm detector）应正确分类 ysm.json
func TestDetectResourceType_YsmJsonFile(t *testing.T) {
	reg := &types.ResourceTypeRegistry{
		ResourceTypes: []types.ResourceType{
			{ID: "ysm-model", Extensions: []string{".ysm", ".zip", ".json"}, Detector: "ysm"},
		},
	}
	path := filepath.Join(t.TempDir(), "ysm.json")
	if err := os.WriteFile(path, []byte(`{"spec":2}`), 0644); err != nil {
		t.Fatal(err)
	}
	if got := DetectResourceType(path, reg); got != "ysm-model" {
		t.Fatalf("ysm.json 应分类为 ysm-model, 得到 %q", got)
	}
}

// ====== ReadShaderpackLang 未测分支 ======

// zip 内小写 lang/en_us.lang 也应提取显示名
func TestReadShaderpackLang_ZipLowercaseEnUs(t *testing.T) {
	path := testutil.WriteZipFile(t, "pack.zip", map[string]string{
		"lang/en_us.lang": "pack.name=小写路径光影",
	})
	resultStr := ReadShaderpackLang(path)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, _ := result["name"].(string); name == "" {
		t.Error("小写 en_us.lang 应提取到 name")
	}
}

// zip 内 lang 恰好 1MB 仍应解析（dir 分支已有同型测试，zip 分支补齐）
func TestReadShaderpackLang_ZipExactLimit(t *testing.T) {
	prefix := "title=ok\n"
	exact := make([]byte, (1<<20)-len(prefix))
	copy(exact, prefix)
	for i := len(prefix); i < len(exact); i++ {
		exact[i] = 'c'
	}
	path := testutil.WriteZipFile(t, "pack.zip", map[string]string{"lang/en_US.lang": string(exact)})
	resultStr := ReadShaderpackLang(path)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, _ := result["name"].(string); name == "" {
		t.Error("恰好 1MB zip lang 应解析出 name")
	}
}

// zip 内无 lang/en_US.lang（有 lang/zh_CN.lang）→ name 为空
func TestReadShaderpackLang_ZipOnlyZhLang(t *testing.T) {
	path := testutil.WriteZipFile(t, "pack.zip", map[string]string{
		"lang/zh_cn.lang": "pack.name=中文",
	})
	resultStr := ReadShaderpackLang(path)
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(resultStr), &result); err != nil {
		t.Fatalf("返回数据非 JSON: %v", err)
	}
	if name, _ := result["name"].(string); name != "" {
		t.Errorf("仅 zh_CN.lang 时 name 应为空, 得到 %q", name)
	}
}
