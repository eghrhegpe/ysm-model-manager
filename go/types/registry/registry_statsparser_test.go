// registry_statsparser_test.go：statsParser 声明的消费面（ADR-346 刀 2）——
// 单一事实源 = resource_types.json（EntityPlayer/SceneModel 声明 "mmd"），
// Go 侧经 StatsParserFor 单点出口读取，SearchModels 分析阶段据此分流。
package registry

import (
	"testing"
)

func TestStatsParserFor(t *testing.T) {
	cases := map[string]string{
		"EntityPlayer": "mmd",
		"SceneModel":   "mmd",
		"ysm":          "", // 默认 Bedrock 管线（不声明 = 空）
		"maid-model":   "",
		"resourcepack": "",
	}
	for id, want := range cases {
		if got := StatsParserFor(id); got != want {
			t.Errorf("StatsParserFor(%q) = %q，期望 %q", id, got, want)
		}
	}
}
