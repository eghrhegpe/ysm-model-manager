// ===== ReadShaderpackLangParts 直调特征测试 =====
//
// 覆盖现状澄清：ReadShaderpackLangParts 此前只有两个调用方
// （同包 ReadShaderpackLang 与 internal/app/resource_bindings.go 的 App 绑定），
// 测试侧全部经 ReadShaderpackLang 间接进入——执行到了函数体，但从不构造
// 「空行 / 纯空白行 / # 注释行 / 无 '=' 行 / 空 key / 空 value」这些被 continue
// 跳过的输入，因此这些分支虽在覆盖报告里算「已执行」，却没有任何断言约束它们
// （静默解析错的典型温床：跳行逻辑写歪了，测试仍绿）。
//
// 本文件直接调用 ReadShaderpackLangParts，逐条钉住 .lang 解析契约。
package packs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeLangDir 在临时目录下建 lang/en_US.lang，返回包根目录。
func writeLangDir(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	langDir := filepath.Join(dir, "lang")
	if err := os.MkdirAll(langDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(langDir, "en_US.lang"), []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestReadShaderpackLangParts_ParseEdges 钉住跳行/取值/显示名选择契约：
// 只有「含 '=' 且 key、value 均非空」的行入 entries；显示名取首个命中的
// pack.name / shaderpack.name / title / *.title，后续命中不覆盖。
func TestReadShaderpackLangParts_ParseEdges(t *testing.T) {
	dir := writeLangDir(t, strings.Join([]string{
		"",                     // 空行
		"   ",                  // 纯空白行（TrimSpace 后为空）
		"# 注释行",                // '#' 前缀
		"no_equals_sign",       // 无 '='
		"=orphan_value",        // 空 key
		"orphan_key=",          // 空 value
		"  spaced.key  =  v  ", // 两侧空白应 TrimSpace
		"pack.name=首个显示名",
		"shaderpack.name=第二个显示名", // name 已定位，不覆盖
		"other.title=第三个显示名",     // 同上
		"bare=裸 key 不是显示名",
	}, "\n"))

	name, entries := ReadShaderpackLangParts(dir)

	want := map[string]string{
		"spaced.key":      "v",
		"pack.name":       "首个显示名",
		"shaderpack.name": "第二个显示名",
		"other.title":     "第三个显示名",
		"bare":            "裸 key 不是显示名",
	}
	if len(entries) != len(want) {
		t.Fatalf("entries 应恰好 %d 条（跳过的行一律不入表）, 得到 %d: %v", len(want), len(entries), entries)
	}
	for k, v := range want {
		if entries[k] != v {
			t.Errorf("entries[%q] = %q, 期望 %q", k, entries[k], v)
		}
	}
	for _, k := range []string{"no_equals_sign", "orphan_key"} {
		if v, ok := entries[k]; ok {
			t.Errorf("被跳过的行不应入表: entries[%q] = %q", k, v)
		}
	}
	if name != "首个显示名" {
		t.Errorf("name = %q, 期望「首个显示名」（首个命中即定，后续不覆盖）", name)
	}
}

// TestReadShaderpackLangParts_DisplayNameKeys 钉显示名 key 的精确匹配口径：
// 裸 title / *.title 合法；pack.namespace、*.subtitle 不得误判为显示名；
// 无任何显示名 key 时 name 为空但 entries 仍完整。
func TestReadShaderpackLangParts_DisplayNameKeys(t *testing.T) {
	dir := writeLangDir(t, "pack.namespace=ns\nsomeshader.subtitle=副标题\ntitle=裸标题\n")
	name, entries := ReadShaderpackLangParts(dir)
	if name != "裸标题" {
		t.Errorf("name = %q, 期望「裸标题」（裸 title 合法，pack.namespace/.subtitle 不是）", name)
	}
	if entries["pack.namespace"] != "ns" || entries["someshader.subtitle"] != "副标题" {
		t.Errorf("entries 应保留全部合法 key, 得到 %v", entries)
	}

	dir2 := writeLangDir(t, "pack.namespace=ns\n")
	name2, entries2 := ReadShaderpackLangParts(dir2)
	if name2 != "" {
		t.Errorf("无显示名 key 时 name 应为空, 得到 %q", name2)
	}
	if entries2["pack.namespace"] != "ns" {
		t.Errorf("entries 应保留, 得到 %v", entries2)
	}
}

// TestReadShaderpackLangParts_NonZipFile 钉「非目录非 .zip 一律不解析」契约：
// 普通文件（哪怕内含合法 lang 文本）不得被当作光影包读取；路径缺失同样返回空。
func TestReadShaderpackLangParts_NonZipFile(t *testing.T) {
	dir := t.TempDir()
	plain := filepath.Join(dir, "not-a-pack.txt")
	if err := os.WriteFile(plain, []byte("pack.name=不该被读到的名字"), 0644); err != nil {
		t.Fatal(err)
	}
	name, entries := ReadShaderpackLangParts(plain)
	if name != "" || len(entries) != 0 {
		t.Errorf("普通文件不应被解析: name=%q entries=%v", name, entries)
	}

	name2, entries2 := ReadShaderpackLangParts(filepath.Join(dir, "missing.zip"))
	if name2 != "" || len(entries2) != 0 {
		t.Errorf("缺失路径应返回空: name=%q entries=%v", name2, entries2)
	}
}
