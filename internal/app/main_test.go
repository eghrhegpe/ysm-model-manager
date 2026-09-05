package app

import (
	"log"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestMain 注入仓库根 resource_types.json 为 types 包测试基线
// （commit 11bfca3b 删 CWD 回退后测试须显式注入）。
// 内联而非复用 go/internal/testutil.InjectRootRegistry：该包为嵌套 internal，
// 仅 go/ 子树可 import（ADR-191）——app 作为装配层拥有自己的注入胶水属合理职责。
func TestMain(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		types.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[app] 注入测试基线失败: %v（LoadRegistry 相关测试将失去基线）", err)
	}
	os.Exit(m.Run())
}
