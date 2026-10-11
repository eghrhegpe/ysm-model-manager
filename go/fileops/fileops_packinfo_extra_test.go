// ===== GetPackInfo 解析分支补测 =====
// 覆盖：非法 JSON、lang 字段覆盖 name/description（含空值不覆盖分支）、
// ysm-pack.png 图片读取、Abs 解析失败（NUL 字符路径）。
package fileops

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ysm-pack.json 为非法 JSON → 返回空 PackInfo
func TestGetPackInfo_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "ysm-pack.json")
	if err := os.WriteFile(jsonPath, []byte(`not-json{{{`), 0644); err != nil {
		testutil.NoError(t, err)
	}
	info := GetPackInfo("", dir)
	if info.Name != "" || info.Description != "" {
		t.Fatalf("非法 JSON 应返回空 PackInfo: %+v", info)
	}
}

// lang 覆盖 name/description（lang 与原始值均非空）+ ysm-pack.png 读取
func TestGetPackInfo_LangOverrideAndImage(t *testing.T) {
	dir := t.TempDir()
	// lang 两个条目值完全一致 → 遍历序随机也不影响断言
	content := `{"name":"原始名","description":"原始描述",
		"lang":{"en":{"name":"LangName","description":"LangDesc"},
		        "zh_cn":{"name":"LangName","description":"LangDesc"}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm-pack.json"), []byte(content), 0644); err != nil {
		testutil.NoError(t, err)
	}
	pngPath := filepath.Join(dir, "ysm-pack.png")
	if err := os.WriteFile(pngPath, []byte("PNGDATA"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	info := GetPackInfo("", dir)
	if info.Name != "LangName" || info.Description != "LangDesc" {
		t.Fatalf("lang 应覆盖 name/description: %+v", info)
	}
	if !strings.HasPrefix(info.ImageBase64, "data:image/png;base64,") {
		t.Fatalf("应读取 ysm-pack.png 生成 data URI: %q", info.ImageBase64)
	}
}

// lang 条目 name 为空时不覆盖原始 name；description 非空时覆盖
func TestGetPackInfo_LangEmptyNameNoOverride(t *testing.T) {
	dir := t.TempDir()
	content := `{"name":"原始名","description":"原始描述",
		"lang":{"en":{"name":"","description":"EN only"}}}`
	if err := os.WriteFile(filepath.Join(dir, "ysm-pack.json"), []byte(content), 0644); err != nil {
		testutil.NoError(t, err)
	}
	info := GetPackInfo("", dir)
	if info.Name != "原始名" {
		t.Fatalf("空 lang name 不应覆盖原始名: %+v", info)
	}
	if info.Description != "EN only" {
		t.Fatalf("非空 lang description 应覆盖: %+v", info)
	}
}

// Abs 解析失败（NUL 字符）→ 返回空 PackInfo，不 panic
func TestGetPackInfo_AbsError(t *testing.T) {
	info := GetPackInfo("", "a\x00b")
	if info.Name != "" || info.Description != "" {
		t.Fatalf("Abs 失败应返回空 PackInfo: %+v", info)
	}
}
