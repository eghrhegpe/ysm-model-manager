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

// TestRtypeDisplayName_FallbackTokens 兜底 token 必须有人话标签。
//
// 立因（2026-09-21 审核）：`typeLabel`（前端）写作 `s.rtype_label ? label : rtype` 后接
// `<span class="perf-matrix-id">${rtype}</span>`——载荷不发 label 时，两处都渲染同一个
// token，表格里印出「container container」「other other」。
// 载荷之所以不发 label，是 `rtypeDisplayName` 对未登记 id 返回空串；而 `container`/`other`
// 是 `classifyForScan` 的**诚实兜底**（共享扩展名 .zip 被 14 类型声明，不猜任意类型），
// 恰恰总是未登记。数据是对的（诚实不猜），失真的是渲染——故人话归 Go 这个单点。
//
// 断言双向：①兜底 token 有非空标签；②标签不等于 id（否则前端仍会印两遍同样的话）。
func TestRtypeDisplayName_FallbackTokens(t *testing.T) {
	t.Parallel()
	for _, tok := range []string{"container", "other"} {
		got := rtypeDisplayName(tok)
		if got == "" {
			t.Errorf("兜底 token %q 无显示名——载荷不发 rtype_label，前端会印出 %q %q（同一 token 两遍）", tok, tok, tok)
			continue
		}
		if got == tok {
			t.Errorf("兜底 token %q 的显示名与 id 相同——前端仍会印出 %q %q，人话必须与 token 有别", tok, tok, tok)
		}
	}
	// 未登记且非兜底的 id 仍返回空串：不给「长得像类型的垃圾 token」编人话
	if rtypeDisplayName("no-such-type-xyz") != "" {
		t.Error("非兜底的未登记 id 不应有显示名（编人话会掩盖真正的拼写漂移）")
	}
}
