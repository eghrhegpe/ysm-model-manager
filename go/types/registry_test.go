package types

import (
	"encoding/json"
	"os"
	"sort"
	"testing"
)

// loadRegistry 从 resource_types.json 加载注册表
func loadRegistry(t *testing.T) *ResourceTypeRegistry {
	t.Helper()
	data, err := os.ReadFile("../../resource_types.json")
	if err != nil {
		t.Fatalf("读取 resource_types.json 失败: %v", err)
	}
	var reg ResourceTypeRegistry
	if err := json.Unmarshal(data, &reg); err != nil {
		t.Fatalf("解析 resource_types.json 失败: %v", err)
	}
	return &reg
}

// registryIDs 返回注册表中所有类型 ID
func registryIDs(reg *ResourceTypeRegistry) []string {
	var ids []string
	for _, rt := range reg.ResourceTypes {
		ids = append(ids, rt.ID)
	}
	sort.Strings(ids)
	return ids
}

func TestResourceExtsMatchesRegistry(t *testing.T) {
	reg := loadRegistry(t)
	extMap := ResourceExts

	for _, rt := range reg.ResourceTypes {
		got := extMap[rt.ID]
		if got == nil {
			t.Errorf("ResourceExts 缺少类型 %q", rt.ID)
			continue
		}
		// 排序后比较
		sort.Strings(got)
		want := append([]string{}, rt.Extensions...)
		sort.Strings(want)
		if len(got) != len(want) {
			t.Errorf("ResourceExts[%q] = %v, 期望 %v", rt.ID, got, want)
			continue
		}
		for i := range got {
			if got[i] != want[i] {
				t.Errorf("ResourceExts[%q][%d] = %q, 期望 %q", rt.ID, i, got[i], want[i])
			}
		}
	}

	// 反向检查：ResourceExts 中不应有注册表不存在的类型
	ids := registryIDs(reg)
	for k := range extMap {
		found := false
		for _, id := range ids {
			if k == id {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("ResourceExts 包含注册表未定义的类型 %q", k)
		}
	}
}

func TestStorageSubDirMatchesRegistry(t *testing.T) {
	// resource_types.json 没有 storageSubDir 字段，但 id 和 subdir 之间有约定映射
	// 这里只验证 6 种已知类型都覆盖
	expectedIDs := []string{"ysm", "mmd-skin", "vrchat-avatar", "resourcepack", "shaderpack", "create-blueprint"}
	for _, id := range expectedIDs {
		dir := StorageSubDir(id)
		if dir == "" {
			t.Errorf("StorageSubDir(%q) = 空字符串", id)
		}
	}
	// 未知类型应返回自身
	if got := StorageSubDir("unknown"); got != "unknown" {
		t.Errorf("StorageSubDir('unknown') = %q, 期望 'unknown'", got)
	}
}

func TestSubDirAllMatchesRegistry(t *testing.T) {
	reg := loadRegistry(t)
	subMap := SubDirAll()
	ids := registryIDs(reg)

	// SubDirAll 应覆盖所有注册表类型
	for _, id := range ids {
		if _, ok := subMap[id]; !ok {
			t.Errorf("SubDirAll 缺少类型 %q", id)
		}
	}
	// 反向检查
	for k := range subMap {
		found := false
		for _, id := range ids {
			if k == id {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("SubDirAll 包含注册表未定义的类型 %q", k)
		}
	}
}

func TestAllSubDirsMatchesRegistry(t *testing.T) {
	reg := loadRegistry(t)
	entries := AllSubDirs()
	ids := registryIDs(reg)

	entryMap := make(map[string]bool)
	for _, e := range entries {
		entryMap[e.RType] = true
	}
	for _, id := range ids {
		if !entryMap[id] {
			t.Errorf("AllSubDirs 缺少类型 %q", id)
		}
	}
	for _, e := range entries {
		found := false
		for _, id := range ids {
			if e.RType == id {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("AllSubDirs 包含注册表未定义的类型 %q (SubDir=%q)", e.RType, e.SubDir)
		}
	}
}

func TestSupportedExtsForType(t *testing.T) {
	reg := loadRegistry(t)
	for _, rt := range reg.ResourceTypes {
		got := SupportedExtsForType(rt.ID)
		if len(got) == 0 {
			t.Errorf("SupportedExtsForType(%q) = 空", rt.ID)
			continue
		}
		sort.Strings(got)
		want := append([]string{}, rt.Extensions...)
		sort.Strings(want)
		if len(got) != len(want) {
			t.Errorf("SupportedExtsForType(%q) = %v, 期望 %v (不匹配 resource_types.json)", rt.ID, got, want)
		}
	}
}

func TestIsSupportedExt(t *testing.T) {
	reg := loadRegistry(t)
	// 收集所有注册表中的扩展名
	known := map[string]bool{}
	for _, rt := range reg.ResourceTypes {
		for _, e := range rt.Extensions {
			known[e] = true
		}
	}
	// 验证所有注册表扩展名都被 IsSupportedExt 支持
	for ext := range known {
		if !IsSupportedExt(ext) {
			t.Errorf("IsSupportedExt(%q) = false, 应在 resource_types.json 中", ext)
		}
	}
	// 验证不支持的扩展名
	if IsSupportedExt(".xyz") {
		t.Error("IsSupportedExt('.xyz') = true, 期望 false")
	}
}
