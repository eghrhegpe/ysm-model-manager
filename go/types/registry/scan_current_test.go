package types

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// TestSchemaGuard_ScanCurrentResourceTypes 用守卫扫描当前 resource_types.json，
// 输出所有红线违规。这是诊断测试，不硬断言——用于确认隔壁 AI 三刀后剩余的债。
func TestSchemaGuard_ScanCurrentResourceTypes(t *testing.T) {
	data, err := os.ReadFile("../../resource_types.json")
	if err != nil {
		t.Skipf("无法读取 resource_types.json: %v", err)
	}
	var reg ResourceTypeRegistry
	if err := json.Unmarshal(data, &reg); err != nil {
		t.Fatalf("解析失败: %v", err)
	}
	violations := validateRegistrySchema(&reg)
	if len(violations) == 0 {
		t.Log("当前 resource_types.json 零红线违规 ✅")
		return
	}
	t.Logf("当前 resource_types.json 有 %d 条红线违规:", len(violations))
	for i, v := range violations {
		t.Logf("  [%d] %s", i+1, v)
	}
	shellCount := 0
	subDirCount := 0
	cfgCount := 0
	for _, v := range violations {
		if strings.Contains(v, "壳类型") {
			shellCount++
		}
		if strings.Contains(v, "存储路径冲突") {
			subDirCount++
		}
		if strings.Contains(v, "配置槽查询歧义") {
			cfgCount++
		}
	}
	t.Logf("分类: 壳越权=%d, storageSubDir 冲突=%d, configField 歧义=%d",
		shellCount, subDirCount, cfgCount)
}
