package registry

import (
	"log"
	"os"
	"path/filepath"
	"testing"
)

// TestMain 在测试进程启动前，将仓库根 resource_types.json 注入为编译期嵌入基线
// （等价于生产态 embed.go 经根包 main 的注入：go/types/registry 因工具链限制无法使用
// //go:embed，且是独立测试二进制，故在此直接注入仓库根文件中转的本包 bundledRegistryJSON）。
//
// 恢复「外部注册表损坏/为空 → 回退嵌入基线」的兜底语义。若注入失败，
// 边缘回退测试将失去基线并打印告警。
//
// ⚠️ 本文件保持手写自注入、不回退 testutil.InjectRootRegistry（ADR-202 刀2 豁免）：
//   - 依赖方向：go/internal/testutil import 本包（registry.SetBundledRegistryJSON），
//     本包测试若 import testutil 即构成 import cycle（"testutil.go: import cycle not allowed"）。
//   - 本包是被注入者自身，自注入属装配层职责——与 internal/app 手写内联同先例
//     （ADR-191：装配层自有职责，不构成领域包之间的 TestMain 样板重复）。
//   - 其余 12 个领域包（消费方）统一委托 testutil.InjectRootRegistry。
func TestMain(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "..", "resource_types.json")); err == nil {
		SetBundledRegistryJSON(data)
	} else {
		log.Printf("[types/registry_test] 注入测试基线失败: %v（边缘回退测试将失去有效基线）", err)
	}
	os.Exit(m.Run())
}
