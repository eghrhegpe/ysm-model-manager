package types

import (
	"testing"
)

func TestAllExts(t *testing.T) {
	exts := AllExts()
	if len(exts) == 0 {
		t.Fatal("AllExts() = 空")
	}
	// .zip 应只出现一次（去重）
	count := 0
	for _, e := range exts {
		if e == ".zip" {
			count++
		}
	}
	if count != 1 {
		t.Errorf(".zip 出现 %d 次，期望 1 次（去重）", count)
	}
	// 已知扩展名存在于结果中
	known := []string{".ysm", ".vrca", ".nbt"}
	for _, ext := range known {
		found := false
		for _, e := range exts {
			if e == ext {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("AllExts() 缺少 %q", ext)
		}
	}
}

func TestIsSupportedExt(t *testing.T) {
	// 支持的扩展名
	if !IsSupportedExt(".ysm") {
		t.Error("IsSupportedExt('.ysm') = false, 期望 true")
	}
	if !IsSupportedExt(".YSM") {
		t.Error("IsSupportedExt('.YSM') = false, 期望 true（大小写不敏感）")
	}
	if !IsSupportedExt(".zip") {
		t.Error("IsSupportedExt('.zip') = false, 期望 true")
	}
	// 不支持的扩展名
	if IsSupportedExt(".xyz") {
		t.Error("IsSupportedExt('.xyz') = true, 期望 false")
	}
	if IsSupportedExt(".txt") {
		t.Error("IsSupportedExt('.txt') = true, 期望 false")
	}
}

func TestExtBelongsTo(t *testing.T) {
	// .ysm 应属于 ysm
	ids := ExtBelongsTo(".ysm")
	if len(ids) != 1 || ids[0] != "ysm" {
		t.Errorf("ExtBelongsTo('.ysm') = %v, 期望 [ysm]", ids)
	}
	// .zip 应属于 resourcepack、shaderpack 和 ysm（yml 也支持 zip）
	ids = ExtBelongsTo(".zip")
	if len(ids) != 3 {
		t.Errorf("ExtBelongsTo('.zip') = %v, 期望 [resourcepack shaderpack ysm]（共 3 个）", ids)
	}
	// 应包含三个类型（顺序不定）
	hasYSM := false
	hasRP := false
	hasSP := false
	for _, id := range ids {
		switch id {
		case "ysm": hasYSM = true
		case "resourcepack": hasRP = true
		case "shaderpack": hasSP = true
		}
	}
	if !hasYSM || !hasRP || !hasSP {
		t.Errorf("ExtBelongsTo('.zip') 缺少某些类型: %v", ids)
	}
	// 不支持扩展名
	if ids := ExtBelongsTo(".xyz"); len(ids) != 0 {
		t.Errorf("ExtBelongsTo('.xyz') = %v, 期望 []", ids)
	}
}

func TestSupportedExtsForType(t *testing.T) {
	// 已知类型
	exts := SupportedExtsForType("ysm")
	if len(exts) == 0 {
		t.Fatal("SupportedExtsForType('ysm') = 空")
	}
	if !contains(exts, ".ysm") {
		t.Error("SupportedExtsForType('ysm') 缺少 .ysm")
	}
	// 大小写不敏感（向后兼容）
	exts = SupportedExtsForType("YSM")
	if len(exts) == 0 {
		t.Error("SupportedExtsForType('YSM') = 空（大小写不敏感）")
	}
	// 未知类型
	if exts := SupportedExtsForType("unknown"); exts != nil {
		t.Errorf("SupportedExtsForType('unknown') = %v, 期望 nil", exts)
	}
}

func TestStorageSubDir(t *testing.T) {
	// 已知类型
	expectedIDs := []string{"ysm", "mmd-skin", "vrchat-avatar", "resourcepack", "shaderpack", "create-blueprint"}
	for _, id := range expectedIDs {
		dir := StorageSubDir(id)
		if dir == "" {
			t.Errorf("StorageSubDir(%q) = 空字符串", id)
		}
	}
	// StorageSubDir 应返回 JSON 中的 storageSubDir
	if got := StorageSubDir("resourcepack"); got != "resourcepacks" {
		t.Errorf("StorageSubDir('resourcepack') = %q, 期望 'resourcepacks'", got)
	}
	if got := StorageSubDir("ysm"); got != "ysm" {
		t.Errorf("StorageSubDir('ysm') = %q, 期望 'ysm'", got)
	}
	// 未知类型应返回自身
	if got := StorageSubDir("unknown"); got != "unknown" {
		t.Errorf("StorageSubDir('unknown') = %q, 期望 'unknown'", got)
	}
}

func TestSubDirMap(t *testing.T) {
	// 已知类型
	if got := SubDirMap("resourcepack"); got != "resourcepacks" {
		t.Errorf("SubDirMap('resourcepack') = %q, 期望 'resourcepacks'", got)
	}
	if got := SubDirMap("ysm"); got != "config/yes_steve_model/custom" {
		t.Errorf("SubDirMap('ysm') = %q, 期望 'config/yes_steve_model/custom'", got)
	}
	// 未知类型
	if got := SubDirMap("unknown"); got != "" {
		t.Errorf("SubDirMap('unknown') = %q, 期望 ''", got)
	}
}

func TestSubDirAll(t *testing.T) {
	m := SubDirAll()
	// 应覆盖所有已知类型
	expected := []string{"ysm", "mmd-skin", "vrchat-avatar", "resourcepack", "shaderpack", "create-blueprint"}
	for _, id := range expected {
		if _, ok := m[id]; !ok {
			t.Errorf("SubDirAll 缺少类型 %q", id)
		}
	}
	// scanDir 值应与 JSON 一致
	if m["resourcepack"] != "resourcepacks" {
		t.Errorf("SubDirAll['resourcepack'] = %q, 期望 'resourcepacks'", m["resourcepack"])
	}
	if m["ysm"] != "config/yes_steve_model/custom" {
		t.Errorf("SubDirAll['ysm'] = %q, 期望 'config/yes_steve_model/custom'", m["ysm"])
	}
}

func TestAllSubDirs(t *testing.T) {
	entries := AllSubDirs()
	entryMap := make(map[string]string)
	for _, e := range entries {
		entryMap[e.RType] = e.SubDir
	}
	// 应覆盖所有已知类型
	expected := []string{"ysm", "mmd-skin", "vrchat-avatar", "resourcepack", "shaderpack", "create-blueprint"}
	for _, id := range expected {
		if _, ok := entryMap[id]; !ok {
			t.Errorf("AllSubDirs 缺少类型 %q", id)
		}
	}
	// SubDir 值应与 JSON scanDir 一致
	if entryMap["resourcepack"] != "resourcepacks" {
		t.Errorf("AllSubDirs resourcepack = %q, 期望 'resourcepacks'", entryMap["resourcepack"])
	}
}

func TestSupportedExtsForTypeUnknown(t *testing.T) {
	// 未知类型返回 nil
	if got := SupportedExtsForType("non-existent-type"); got != nil {
		t.Errorf("SupportedExtsForType('non-existent-type') = %v, 期望 nil", got)
	}
}

func contains(slice []string, s string) bool {
	for _, v := range slice {
		if v == s {
			return true
		}
	}
	return false
}
