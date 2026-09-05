//go:build !race

package types_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"ysm-model-manager/go/types"
)

// TestResourceTypesEmbedJSONConsistency 验证单源化契约：
// LoadRegistry()（单源：仓库根 resource_types.json，经 root embed.go 注入 go/types 的 bundledRegistryJSON，
// build 即同步）产出的注册表，与直接解码仓库根 resource_types.json 得到的注册表逐类型完全一致。
//
// 旧设计存在两份副本（root JSON + 手工 embeddedRegistryJSON），不同步会弹平大类或卡死新格式同步；
// 单源化后二者同源，旧手工副本已删除。TestMain 已将根文件注入 bundledRegistryJSON，
// 此处再强制 SetRegistryPath 指向根文件并清空包级缓存，使 LoadRegistry 重读根文件——
// 从而验证「文件→结构体」与「LoadRegistry→结构体」两条路径零差异。
// 任一字段漂移（误改某处、漏改结构标签、副本再次分裂）即失败，永久消灭双副本漂移。
func TestResourceTypesEmbedJSONConsistency(t *testing.T) {
	// 读取仓库根 resource_types.json（单一事实来源）
	jsonPath := filepath.Join("..", "..", "resource_types.json")
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatalf("read resource_types.json: %v", err)
	}

	// 直接解码根文件 → 结构体（与 LoadRegistry 同构，避免 map/struct 字段不对称）
	var fileReg types.ResourceTypeRegistry
	if err := json.Unmarshal(raw, &fileReg); err != nil {
		t.Fatalf("parse resource_types.json: %v", err)
	}
	if len(fileReg.ResourceTypes) == 0 {
		t.Fatalf("root resource_types.json decoded to 0 types (unexpected)")
	}

	// 强制 LoadRegistry 重读根文件（清空包级缓存、指向根路径），走应用真实加载路径
	types.SetRegistryPath(jsonPath)
	defer types.SetRegistryPath("")
	reg := types.LoadRegistry()
	if len(reg.ResourceTypes) == 0 {
		t.Fatalf("LoadRegistry() returned 0 types (fallback baseline empty?)")
	}

	// 按 id 建索引比对（忽略顺序，去重不改变语义）
	byIDFile := make(map[string]types.ResourceType, len(fileReg.ResourceTypes))
	for _, rt := range fileReg.ResourceTypes {
		if _, dup := byIDFile[rt.ID]; dup {
			t.Fatalf("root resource_types.json 含重复 id %q（数据缺陷，需先修源）", rt.ID)
		}
		byIDFile[rt.ID] = rt
	}
	byIDReg := make(map[string]types.ResourceType, len(reg.ResourceTypes))
	for _, rt := range reg.ResourceTypes {
		byIDReg[rt.ID] = rt
	}

	for id, fv := range byIDFile {
		rv, ok := byIDReg[id]
		if !ok {
			t.Errorf("id %q present in root JSON but missing in LoadRegistry()", id)
			continue
		}
		if !reflect.DeepEqual(fv, rv) {
			t.Errorf("mismatch for id %q\n  root JSON:   %+v\n  LoadRegistry: %+v", id, fv, rv)
		}
	}
	for id := range byIDReg {
		if _, ok := byIDFile[id]; !ok {
			t.Errorf("id %q present in LoadRegistry() but missing in root JSON", id)
		}
	}
}
