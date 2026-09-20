package cli

import (
	"testing"

	"ysm-model-manager/go/types/registry"
)

// perf_manifest_registry_test.go — perfTypeManifest（Go 侧「CLI 可分析类型」登记处）
// 与 resource_types.json（类型命名的单一事实源，经 registry 加载）的对齐护栏。
//
// 立因（2026-09-20 审核）：1c5a654d9 修的是「maid-model 漏登记」这一颗雷——用户在前端
// 目标集 selector 里显式选「女仆」跑基准，cliAnalyzable 判 false → unsupported。根因是
// perfTypeManifest 是 Go 硬编码 map，resource_types.json 是外部 JSON，两张表同仓不同步
// 机制：id 改名/删除后 manifest 悬空、误删登记都会静默复现假阴性。本文件把「登记面」
// 的三种漂移变成机检，而不是靠注释教训。

// TestPerfTypeManifest_IdsExistInRegistry 反向悬空护栏：
// manifest 登记的每个类型 id 必须真实存在于 registry（resource_types.json）。
// 若某 id 在 resource_types.json 里被改名/删除而 manifest 未同步，cliAnalyzable
// 将永远不可达——两张表漂移且无人察觉（classifyForScan 依赖 registry，不会再吐出该 id）。
func TestPerfTypeManifest_IdsExistInRegistry(t *testing.T) {
	t.Parallel()
	reg := registry.LoadRegistry()
	ids := make(map[string]bool, len(reg.ResourceTypes))
	for _, rt := range reg.ResourceTypes {
		ids[rt.ID] = true
	}
	for rtype := range perfTypeManifest {
		if !ids[rtype] {
			t.Errorf("perfTypeManifest 登记的 %q 不在 resource_types.json 类型 id 全集里（改名/删除未同步？）", rtype)
		}
	}
}

// TestPerfTypeManifest_AnalyzableHasStages 登记完整性护栏：
// CliAnalyzable=true 却 ExpectedStages=0，会让「阶段链断裂」断言（ExpectedStages 长度）
// 形同虚设——登记可分析却未声明应产出几段，等于只登了半张表。
func TestPerfTypeManifest_AnalyzableHasStages(t *testing.T) {
	t.Parallel()
	for rtype, entry := range perfTypeManifest {
		if entry.CliAnalyzable && entry.ExpectedStages == 0 {
			t.Errorf("perfTypeManifest[%q].CliAnalyzable=true 但 ExpectedStages=0（登记可分析却未声明阶段链长度）", rtype)
		}
	}
}

// TestPerfTypeManifest_KnownAnalyzableTypes 误删护栏：
// 钉死当前已知的 CLI 可分析类型（解析器在 Go 侧：WASM 解码 / geometry 容器与 maid L0 清单），
// 防止误删登记复现 maid-model 假阴性（1c5a654d9 修的那颗雷的「漏登记」方向）。
//
// ⚠️ 这是回归护栏的**已知事实期望**，不是第二份运行时真值：新增第三条 CLI 分析链路时，
// manifest 与此期望须**同步追加**——测试变红即提醒「你改了可分析清单，请确认期望是否跟进」。
func TestPerfTypeManifest_KnownAnalyzableTypes(t *testing.T) {
	t.Parallel()
	known := []string{"ysm", "maid-model"}
	for _, rtype := range known {
		if !perfTypeManifest[rtype].CliAnalyzable {
			t.Errorf("已知 CLI 可分析类型 %q 从 perfTypeManifest 丢失或 CliAnalyzable=false（漏登记/误删？）", rtype)
		}
	}
}
