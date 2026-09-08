package app

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types/registry"
)

// TestMain 注入仓库根 resource_types.json 为 types 包测试基线
// （commit 11bfca3b 删 CWD 回退后测试须显式注入）。
// 内联而非复用 go/internal/testutil.InjectRootRegistry：该包为嵌套 internal，
// 仅 go/ 子树可 import（ADR-191）——app 作为装配层拥有自己的注入胶水属合理职责。
// 注入失败必须终止整个测试套件，否则后续所有依赖注册表的测试都在盲跑。
func TestMain(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		registry.SetBundledRegistryJSON(data)
	} else {
		fmt.Fprintf(os.Stderr, "FATAL: registry injection failed: %v\n", err)
		os.Exit(1)
	}
	os.Exit(m.Run())
}
