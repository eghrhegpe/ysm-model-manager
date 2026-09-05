package types

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// guardViolations 解析注册表 payload 并运行 schema 守卫，返回违规列表。
// 直接调用 validateRegistrySchema，不依赖 LoadRegistry 的全局日志/缓存——
// 单条目注册表同样受检（回归：守卫曾被嵌套在去重 if 内，仅多条目注册表触发，
// 导致单条目违规静默通过）。
func guardViolations(t *testing.T, payload string) []string {
	t.Helper()
	var reg ResourceTypeRegistry
	if err := json.Unmarshal([]byte(payload), &reg); err != nil {
		t.Fatalf("payload 解析失败: %v", err)
	}
	return validateRegistrySchema(&reg)
}

// hasViolation 检查违规列表是否含包含 substr 的条目。
func hasViolation(violations []string, substr string) bool {
	for _, v := range violations {
		if strings.Contains(v, substr) {
			return true
		}
	}
	return false
}

// writeTempRegistry 把 payload 写到临时文件并设为注册表路径（LoadRegistry 集成测试用）。
func writeTempRegistry(t *testing.T, payload string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "resource_types.json")
	if err := os.WriteFile(path, []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	SetRegistryPath(path)
	return path
}

// ===== 守卫 1：storageSubDir 全局唯一 =====

func TestSchemaGuard_DuplicateStorageSubDir_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "storageSubDir": "dup", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "storageSubDir": "dup", "extensions": [".b"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "dup") || !hasViolation(violations, "存储路径冲突") {
		t.Fatalf("期望 storageSubDir 重复违规，实际: %v", violations)
	}
}

func TestSchemaGuard_UniqueStorageSubDir_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "storageSubDir": "alpha", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "storageSubDir": "beta", "extensions": [".b"]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "存储路径冲突") {
		t.Fatalf("唯一 storageSubDir 不应触发冲突违规，实际: %v", violations)
	}
}

// ===== 守卫 2：configField 全局唯一 =====

func TestSchemaGuard_DuplicateConfigField_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "configField": "SharedRoot", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "configField": "SharedRoot", "extensions": [".b"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "SharedRoot") || !hasViolation(violations, "配置槽查询歧义") {
		t.Fatalf("期望 configField 重复违规，实际: %v", violations)
	}
}

// ===== 合法注册表通过（零违规）=====

func TestSchemaGuard_CleanRegistry_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "t1", "name": "T1", "group": "g", "storageSubDir": "t1", "configField": "T1Root", "extensions": [".1"]},
			{"id": "t2", "name": "T2", "group": "g", "storageSubDir": "t2", "configField": "T2Root", "extensions": [".2"]}
		]
	}`
	violations := guardViolations(t, payload)
	if len(violations) != 0 {
		t.Fatalf("合法注册表不应触发任何违规，实际: %v", violations)
	}
}

// ===== 守卫 3：configFallback 引用完整性 =====

func TestSchemaGuard_ConfigFallbackResolves_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "mmd", "name": "MMD", "group": "mmd", "configField": "MmdRoot", "storageSubDir": "mmd", "extensions": [".pmx"]},
			{"id": "vrc", "name": "VRC", "group": "mmd", "configField": "VrcRoot", "configFallback": "MmdRoot", "storageSubDir": "vrc", "extensions": [".vrm"]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "孤儿回退") {
		t.Fatalf("configFallback 指向存在字段不应触发孤儿回退违规，实际: %v", violations)
	}
}

func TestSchemaGuard_ConfigFallbackOrphan_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "vrc", "name": "VRC", "group": "mmd", "configField": "VrcRoot", "configFallback": "GhostRoot", "storageSubDir": "vrc", "extensions": [".vrm"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "GhostRoot") || !hasViolation(violations, "孤儿回退") {
		t.Fatalf("期望 configFallback 孤儿回退违规，实际: %v", violations)
	}
}

// ===== 集成：LoadRegistry 完整链路——守卫只告警不阻断、不改数据 =====

func TestSchemaGuard_LoadRegistryIntegration(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{
				"id": "type-x", "name": "类型X", "group": "g",
				"storageSubDir": "evil",
				"extensions": [".x"]
			},
			{"id": "type-y", "name": "类型Y", "group": "g", "storageSubDir": "ok", "extensions": [".y"]}
		]
	}`
	writeTempRegistry(t, payload)
	defer SetRegistryPath("")

	reg := LoadRegistry()
	if got := len(reg.ResourceTypes); got != 2 {
		t.Fatalf("ResourceTypes 长度 = %d，期望 2", got)
	}
	rt := RegistryType("type-x")
	if rt == nil {
		t.Fatal("RegistryType('type-x') 应为非 nil")
	}
	if rt.StorageSubDir != "evil" {
		t.Errorf("type-x.StorageSubDir = %q，期望 'evil'（守卫不改数据）", rt.StorageSubDir)
	}
}

// ===== 并发安全：守卫/加载在多 goroutine 下不 panic =====

func TestSchemaGuard_ConcurrentLoadNoPanic(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "storageSubDir": "dup", "extensions": [".a"]},
			{"id": "b", "name": "B", "group": "g", "storageSubDir": "dup", "extensions": [".b"]}
		]
	}`
	writeTempRegistry(t, payload)
	defer SetRegistryPath("")

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			LoadRegistry()
		}()
	}
	wg.Wait()
}

// ===== 守卫 4：裸扩展名 last-wins 防护 =====

func TestSchemaGuard_NakedSharedExt_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "naked", "name": "裸类型", "group": "g", "extensions": [".shared"], "detector": "extension"},
			{"id": "other", "name": "其他", "group": "g", "storageSubDir": "other", "extensions": [".shared"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "naked") || !hasViolation(violations, "last-wins 回归源") {
		t.Fatalf("期望裸共享扩展名违规，实际: %v", violations)
	}
}

func TestSchemaGuard_NakedUniqueExt_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "solo", "name": "独占", "group": "g", "extensions": [".solo"], "detector": "extension"}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "last-wins 回归源") {
		t.Fatalf("单一声明者裸扩展名不应触发违规，实际: %v", violations)
	}
}

func TestSchemaGuard_AnchoredSharedExt_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "a", "name": "A", "group": "g", "storageSubDir": "a", "extensions": [".shared"]},
			{"id": "b", "name": "B", "group": "g", "storageSubDir": "b", "extensions": [".shared"]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "last-wins 回归源") {
		t.Fatalf("有锚点的共享扩展名不应触发裸扩展名违规，实际: %v", violations)
	}
}

// ===== 守卫 5：共享 .zip 锚点碰撞需显式 priority =====

func TestSchemaGuard_SharedZipAnchorNeedsPriority_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "bp", "name": "蓝图", "group": "g", "instanceDir": "schematics", "extensions": [".zip"], "detector": "zipentry", "zipEntries": [{"name": ".nbt", "match": "suffix"}]},
			{"id": "lm", "name": "投影", "group": "g", "instanceDir": "schematics", "extensions": [".zip"], "detector": "zipentry", "zipEntries": [{"name": ".litematic", "match": "suffix"}]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "bp") || !hasViolation(violations, "必须显式 priority") {
		t.Fatalf("期望共享 .zip 锚点缺 priority 违规，实际: %v", violations)
	}
}

func TestSchemaGuard_SharedZipAnchorWithPriority_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "bp", "name": "蓝图", "group": "g", "instanceDir": "schematics", "priority": 5, "extensions": [".zip"], "detector": "zipentry", "zipEntries": [{"name": ".nbt", "match": "suffix"}]},
			{"id": "lm", "name": "投影", "group": "g", "instanceDir": "schematics", "priority": 5, "extensions": [".zip"], "detector": "zipentry", "zipEntries": [{"name": ".litematic", "match": "suffix"}]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "必须显式 priority") {
		t.Fatalf("共享 .zip 锚点已显式 priority 不应触发违规，实际: %v", violations)
	}
}

func TestSchemaGuard_UniqueZipAnchor_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "rp", "name": "资源包", "group": "g", "storageSubDir": "resourcepacks", "extensions": [".zip"], "detector": "mcmeta", "zipEntries": [{"name": "pack.mcmeta", "match": "suffix"}]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "必须显式 priority") {
		t.Fatalf("独占锚点的 .zip 类型不应触发违规，实际: %v", violations)
	}
}

// ===== 守卫 6：scanInstance=true 必须声明 fallbackDir =====

func TestSchemaGuard_ScanInstanceRequiresFallbackDir_Warns(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "bp", "name": "蓝图", "group": "g", "instanceDir": "schematics", "scanInstance": true, "extensions": [".nbt"]}
		]
	}`
	violations := guardViolations(t, payload)
	if !hasViolation(violations, "scanInstance=true 必须声明 fallbackDir") {
		t.Fatalf("期望 scanInstance=true 且缺 fallbackDir 触发违规，实际: %v", violations)
	}
}

func TestSchemaGuard_ScanInstanceWithFallbackDir_NoWarn(t *testing.T) {
	payload := `{
		"resourceTypes": [
			{"id": "bp", "name": "蓝图", "group": "g", "instanceDir": "schematics", "scanInstance": true, "fallbackDir": "Sable-Schematics", "extensions": [".nbt"]}
		]
	}`
	violations := guardViolations(t, payload)
	if hasViolation(violations, "必须声明 fallbackDir") {
		t.Fatalf("scanInstance=true 且 fallbackDir 非空不应触发违规，实际: %v", violations)
	}
}
