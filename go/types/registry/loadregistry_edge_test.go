package types

import (
	"os"
	"path/filepath"
	"testing"
)

// 探测 LoadRegistry 在畸形 JSON 输入下的回退与缓存行为。
// 所有用例均仅创建/修改本文件，不改源码。

const baselineExt = ".ysm"
const baselineID = "ysm"

func TestLoadRegistry_Edge_EmptyArray(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(path, []byte(`{"resourceTypes": []}`), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	// 修复后：空数组 → 视为损坏、回退嵌入基线（而非静默缓存空表）
	if len(reg.ResourceTypes) == 0 {
		t.Fatal("空数组应触发回退嵌入基线，实际 ResourceTypes 仍为空")
	}
	if !IsSupportedExt(baselineExt) {
		t.Errorf("回退后 IsSupportedExt(%q) 应为 true", baselineExt)
	}
	if RegistryType(baselineID) == nil {
		t.Error("回退后 RegistryType 应返回非 nil")
	}
	t.Log("FIXED(BUG-1): 空数组已触发回退嵌入基线，下游查询正常。")
}

func TestLoadRegistry_Edge_NullArray(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(path, []byte(`{"resourceTypes": null}`), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	// 修复后：null → 视为损坏、回退嵌入基线
	if len(reg.ResourceTypes) == 0 {
		t.Fatal("null 应触发回退嵌入基线，实际 ResourceTypes 为空")
	}
	if !IsSupportedExt(baselineExt) {
		t.Errorf("回退后 IsSupportedExt(%q) 应为 true", baselineExt)
	}
	t.Log("FIXED(BUG-4): null 已触发回退嵌入基线。")
}

func TestLoadRegistry_Edge_EntryMissingExtensions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	payload := `{
		"resourceTypes": [
			{"id": "ysm", "name": "YSM", "extensions": [".ysm"], "storageSubDir": "models"},
			{"id": "broken", "name": "Broken", "storageSubDir": "broken"}
		]
	}`
	if err := os.WriteFile(path, []byte(payload), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if got := len(reg.ResourceTypes); got != 2 {
		t.Fatalf("ResourceTypes 长度 = %d，期望 2", got)
	}
	if !IsSupportedExt(".ysm") {
		t.Error("IsSupportedExt('.ysm') 应为 true")
	}
	if got := RegistryType("broken"); got == nil {
		t.Fatal("RegistryType('broken') 应为非 nil")
	} else {
		if got.StorageSubDir != "broken" {
			t.Errorf("broken.StorageSubDir = %q，期望 'broken'", got.StorageSubDir)
		}
		if got.Extensions != nil {
			t.Errorf("broken.Extensions 应为 nil，实际 %v", got.Extensions)
		}
	}
	if IsSupportedExt(".broken") {
		t.Error("IsSupportedExt('.broken') 应为 false（broken 无 extensions）")
	}
	if StorageSubDir("broken") != "broken" {
		t.Errorf("StorageSubDir('broken') = %q，期望 'broken'", StorageSubDir("broken"))
	}
	t.Log("FIXED(soft, BUG-2): entry 缺 extensions 属数据质量问题（当前 resource_types.json 7 条全绿），LoadRegistry 已不 crash，仅跳过该类型。")
}

func TestLoadRegistry_Edge_DuplicateID(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	payload := `{
		"resourceTypes": [
			{"id": "ysm", "name": "YSM v1", "extensions": [".ysm", ".v1"], "storageSubDir": "models-v1"},
			{"id": "ysm", "name": "YSM v2", "extensions": [".ysm", ".v2"], "storageSubDir": "models-v2"}
		]
	}`
	if err := os.WriteFile(path, []byte(payload), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	// 修复后：重复 id 去重，last-wins（与 ExtBelongsTo 语义对齐）
	if got := StorageSubDir("ysm"); got != "models-v2" {
		t.Fatalf("StorageSubDir('ysm') = %q，期望 'models-v2'（last-wins 去重）", got)
	}
	if got := ExtBelongsTo(".ysm"); len(got) != 1 || got[0] != "ysm" {
		t.Fatalf("ExtBelongsTo('.ysm') = %v，期望长度 1（去重后仅一个 ysm）", got)
	}
	// .v1 被去重丢弃，.v2 保留
	if got := ExtBelongsTo(".v1"); len(got) != 0 {
		t.Fatalf("ExtBelongsTo('.v1') = %v，v1 应被 last-wins 丢弃", got)
	}
	if got := ExtBelongsTo(".v2"); len(got) != 1 || got[0] != "ysm" {
		t.Fatalf("ExtBelongsTo('.v2') = %v", got)
	}
	t.Log("FIXED(BUG-3): 重复 id 已去重（last-wins），RegistryType 与 ExtBelongsTo 语义一致。")
}

func TestLoadRegistry_Edge_MalformedJSON_Fallback(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(path, []byte(`{not json`), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if len(reg.ResourceTypes) == 0 {
		t.Fatal("回退到嵌入基线后 ResourceTypes 不应为空")
	}
	if !IsSupportedExt(baselineExt) {
		t.Errorf("回退后 IsSupportedExt(%q) 应为 true", baselineExt)
	}
	t.Log("OK: 畸形 JSON 正确回退到嵌入基线。")
}

func TestLoadRegistry_Edge_ExtraFields_Ignored(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	payload := `{
		"resourceTypes": [
			{"id": "ysm", "extensions": [".ysm"], "storageSubDir": "models", "garbage": "noise", "extra": [1, 2, 3]}
		],
		"unknownTopLevel": "ignored"
	}`
	if err := os.WriteFile(path, []byte(payload), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if got := len(reg.ResourceTypes); got != 1 {
		t.Fatalf("ResourceTypes 长度 = %d，期望 1", got)
	}
	if rt := RegistryType("ysm"); rt == nil {
		t.Fatal("RegistryType('ysm') 应存在")
	} else {
		if rt.Extensions[0] != ".ysm" {
			t.Errorf("ysm.Extensions[0] = %q，期望 '.ysm'", rt.Extensions[0])
		}
	}
	t.Log("OK: 额外未知字段被 encoding/json 静默忽略（预期行为）。")
}

func TestLoadRegistry_Edge_CacheIdentity(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	payload := `{"resourceTypes": [{"id": "ysm", "extensions": [".ysm"]}]}`
	if err := os.WriteFile(path, []byte(payload), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	a := LoadRegistry()
	b := LoadRegistry()
	if a != b {
		t.Fatal("LoadRegistry 应返回同一缓存实例（指针相等）")
	}
	t.Log("OK: LoadRegistry 缓存生效，返回同一指针。")
}

func TestLoadRegistry_Edge_ResetToBaseline(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	// 空数组 → 修复后触发回退，不再污染
	if err := os.WriteFile(path, []byte(`{"resourceTypes": []}`), 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")
	reg := LoadRegistry()
	// 修复后：LoadRegistry 已自动回退嵌入基线，下游仍可用
	if len(reg.ResourceTypes) == 0 {
		t.Fatal("空数组应触发回退嵌入基线，实际 ResourceTypes 为空")
	}
	if !IsSupportedExt(baselineExt) {
		t.Errorf("回退后 IsSupportedExt(%q) 应为 true", baselineExt)
	}
	// 切回默认路径 → 应走 loadRegistryBytes 默认链 → embedded
	SetRegistryPath("")
	reg2 := LoadRegistry()
	if len(reg2.ResourceTypes) == 0 {
		t.Fatal("SetRegistryPath('') 恢复后 ResourceTypes 不应为空")
	}
	if !IsSupportedExt(baselineExt) {
		t.Errorf("恢复后 IsSupportedExt(%q) 应为 true", baselineExt)
	}
	t.Log("FIXED(BUG-1): SetRegistryPath 切换不再污染缓存；空注册表自动回退基线。")
}

func TestLoadRegistry_Edge_EmptyFile_Fallback(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(path, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if len(reg.ResourceTypes) == 0 {
		t.Fatal("空文件回退后 ResourceTypes 不应为空")
	}
	if !IsSupportedExt(baselineExt) {
		t.Errorf("空文件回退后 IsSupportedExt(%q) 应为 true", baselineExt)
	}
	t.Log("OK: 空文件被 json.Unmarshal 拒绝，正确回退嵌入基线。")
}
