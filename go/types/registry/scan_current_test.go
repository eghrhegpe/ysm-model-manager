package registry

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	// 此处只能用**根桥** internal/testutil：go/internal/testutil 依赖本包（registry），
	// 本包测试再引它会成 test 导入环（go: import cycle not allowed in test）。
	"ysm-model-manager/internal/testutil"
)

// TestSchemaGuard_ScanCurrentResourceTypes 用守卫扫描当前 resource_types.json，
// 发现红线违规即失败（CI 不能容忍静默 pass）。用于拦截 AI 三刀后遗留的债。
func TestSchemaGuard_ScanCurrentResourceTypes(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile("../../../resource_types.json")
	if err != nil {
		t.Skipf("无法读取 resource_types.json: %v", err)
	}
	var reg ResourceTypeRegistry
	err = json.Unmarshal(data, &reg)
	testutil.NoError(t, err, "解析失败")
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
		if strings.Contains(v, "配置槽归属歧义") {
			cfgCount++
		}
	}
	t.Logf("分类: 壳越权=%d, storageSubDir 冲突=%d, configField 歧义=%d",
		shellCount, subDirCount, cfgCount)
	t.Fail() // 有违规 → 让 CI 红，不能只打日志
}
