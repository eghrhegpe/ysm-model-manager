package app

import (
	"log"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestMain 在测试进程启动前，将仓库根 resource_types.json 注入为 types 包的
// 编译期嵌入基线（与 go/types/main_test.go 同构）。本包测试直接消费
// types.LoadRegistry()（app_container_cache_test / app_resource_bindings_test 等），
// 原依赖 go/types 内 CWD 相对回退（../../resource_types.json）读取注册表——
// 该回退已删除（Go 评审 #11：生产走 embed 注入、测试应显式注入），故在此补齐注入，
// 消除对进程 CWD 的隐式依赖。注入失败仅告警，边缘测试将失去基线。
func TestMain(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		types.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[app_test] 注入测试基线失败: %v（LoadRegistry 相关测试将失去基线）", err)
	}
	os.Exit(m.Run())
}
