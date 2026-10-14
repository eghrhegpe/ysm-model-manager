// ===== 真实 maid 包夹具回归（ADR-343 遗留项：maid 数值管线实证）=====
// 仓内 L0 清单机制已有合成夹具测试（archive_maid_l0_test.go 等）；本测试补「真实女仆包
// zip → ParseFromZip 出几何」的数据证据链：fixture 在 upstream/（gitignored，本地样本区），
// 缺失即 skip（CI 无样本不红），本地有样本时钉死「TLM 包可被 Bedrock 几何管线解析」。
package geometry

import (
	"os"
	"path/filepath"
	"testing"
)

// TestParseFromZip_RealMaidFixture：真实 TLM 女仆包（L0 清单 + 多命名空间）几何解析实证。
// fixture 缺失（CI/新克隆）跳过；本地样本存在时断言 BoneCount/CubeCount/SubModels 非空。
func TestParseFromZip_RealMaidFixture(t *testing.T) {
	fixture := filepath.Join("..", "..", "upstream", "[maid-model]多合一女仆包", "touhou_little_maid-1.0.0.zip")
	if _, err := os.Stat(fixture); err != nil {
		t.Skipf("真实夹具缺失（upstream 样本区 gitignored，CI 无此文件）: %v", err)
	}
	data, err := os.ReadFile(fixture)
	if err != nil {
		t.Skipf("读取夹具失败: %v", err)
	}
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("真实 TLM 女仆包应可解析出几何（L0 清单管线），实际返回 nil")
	}
	// 实证数据（2026-10-14 CLI 全链路：search --min-bones 1 → 12903 bones / 13710 cubes）：
	// 断言只钉「非空几何」契约，不钉具体数值（样本可换版本）
	if model.BoneCount == 0 {
		t.Errorf("TLM 女仆包几何应为非空骨骼，实际 BoneCount=0")
	}
	if model.CubeCount == 0 {
		t.Errorf("TLM 女仆包几何应为非空立方体，实际 CubeCount=0")
	}
	if len(model.SubModels) == 0 {
		t.Errorf("TLM 女仆包 L0 清单应派生子模型清单，实际 SubModels 为空")
	}
}
