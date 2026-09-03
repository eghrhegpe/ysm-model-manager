package installer

import (
	"log"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestMain 在测试进程启动前，将仓库根 resource_types.json 注入为 types 包的
// 编译期嵌入基线（与 go/cli、go/packs、go/scanner、internal/app 的 main_test.go
// 同构）。本包 Install/InstallDir 系列测试直接消费 types.LoadRegistry() 做扩展名
// 判定，原依赖 go/types 内 CWD 相对回退——该回退已删除（commit 11bfca3b：
// 生产走 embed 注入、测试应显式注入），4 个测试包当时已补 TestMain，本包被遗漏，
// 导致 Install 测试报「不支持的文件类型 / 支持格式为空」；此处补齐注入。
func TestMain(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		types.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[installer_test] 注入测试基线失败: %v（LoadRegistry 相关测试将失去基线）", err)
	}
	os.Exit(m.Run())
}
