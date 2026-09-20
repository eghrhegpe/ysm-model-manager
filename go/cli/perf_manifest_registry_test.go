package cli

import (
	"testing"

	"ysm-model-manager/go/types/registry"
)

// perf_manifest_registry_test.go — 「CLI 可分析类型」的登记面护栏。
//
// 设计变更（2026-09-21）：可分析性（有无 CLI 解析链路）的事实源从 Go 硬编码的
// perfTypeManifest 迁至 resource_types.json 的 `cliAnalyzable` 声明——理由是前端
// 目标集选择器也要消费同一份数据（ADR-269 D3 同步 JSON 通路），Go/前端双写
// 必然漂移。perfTypeManifest 现在只剩「阶段链产出口径」（ExpectedStages / Note）。
//
// 于是本文件的职责相应收窄为**声明面**的护栏：JSON 里谁被标了 cliAnalyzable、
// 是否与已知事实一致。阶段链一致性（可分析 ↔ ExpectedStages）由
// bench_matrix_test.go|TestPerfTypeManifest_Consistent 覆盖，此处不重复。

// TestCliAnalyzable_DeclaredSetIsKnown 声明面护栏（漏标/误标）：
// resource_types.json 里 cliAnalyzable=true 的类型必须恰好是已知的两条 Go 侧解析链路
// （ysm 的 WASM 解码 / maid-model 的 geometry maid L0 清单）。
//
// 两个方向都拦：**漏标**复现 1c5a654d9 的 maid-model 假阴性（前端选得中、Go 判 unsupported）；
// **误标**让选择器渲染出必然失败的选项（选了才报「CLI 无解析器」）——那正是这次要清的账。
// PMX/PMD/VRM/FBX/GLTF 的解析器只在前端 3D adapter，CLI 拿到是空模型，不得标 true。
//
// ⚠️ 新增第三条 CLI 分析链路时，JSON 声明与此期望须**同步追加**——测试变红即提醒
// 「可分析清单变了，请确认期望是否跟进」。
func TestCliAnalyzable_DeclaredSetIsKnown(t *testing.T) {
	t.Parallel()
	known := map[string]bool{"ysm": true, "maid-model": true}
	declared := map[string]bool{}
	for _, rt := range registry.LoadRegistry().ResourceTypes {
		if rt.CliAnalyzable {
			declared[rt.ID] = true
		}
	}
	for id := range known {
		if !declared[id] {
			t.Errorf("已知 CLI 可分析类型 %q 未在 resource_types.json 标 cliAnalyzable=true（漏标 → 前端选择器缺项 + 运行判 unsupported）", id)
		}
	}
	for id := range declared {
		if !known[id] {
			t.Errorf("resource_types.json 把 %q 标为 cliAnalyzable=true，但它不在已知解析链路清单里（误标 → 前端选择器渲染必然失败的选项）", id)
		}
	}
}

// TestPerfTypeManifest_IdsExistInRegistry manifest 的 key 必须是真实类型：
// 拼写漂移或类型被删后，阶段链断言会静默失效（查不到就零值，看不出问题）。
func TestPerfTypeManifest_IdsExistInRegistry(t *testing.T) {
	t.Parallel()
	ids := make(map[string]bool, len(registry.LoadRegistry().ResourceTypes))
	for _, rt := range registry.LoadRegistry().ResourceTypes {
		ids[rt.ID] = true
	}
	for rtype := range perfTypeManifest {
		if !ids[rtype] {
			t.Errorf("perfTypeManifest 登记的 %q 不在 resource_types.json 类型 id 全集里（改名/删除未同步？）", rtype)
		}
	}
}
