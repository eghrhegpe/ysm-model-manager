package types

import (
	"log"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types/registry"
)

// TestMain 在测试进程启动前，将仓库根 resource_types.json 注入为编译期嵌入基线
// （等价于生产态 embed.go 经根包 main 的注入：go/types 因工具链限制无法使用 //go:embed，
// 故由根包 main 读取 root embed 后注入 registry.SetBundledRegistryJSON）。
//
// 恢复「外部注册表损坏/为空 → 回退嵌入基线」的兜底语义——该语义曾是已删除的手工副本
// resource_types_embed.go 提供的；单源化后，测试态的「嵌入基线」即仓库根文件本身，
// 与运行时 bundledRegistryJSON 同源，漂移归零。若注入失败，边缘回退测试将失去基线并打印告警。
func TestMain(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		registry.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[types_test] 注入测试基线失败: %v（边缘回退测试将失去有效基线）", err)
	}
	os.Exit(m.Run())
}
