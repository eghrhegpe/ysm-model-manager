package instance

import (
	"log"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

// TestMain 测试进程启动前将仓库根 resource_types.json 注入为 types 包编译期
// 嵌入基线，与 go/cli、go/packs、go/scanner、go/installer、internal/app 的
// main_test.go 同构。本包测试经本包函数消费 types.LoadRegistry()（扩展名/类型
// 判定）；commit 11bfca3b 删除 go/types 的 CWD 相对回退后（生产走 root embed
// 注入、测试须显式注入），本包曾缺注入导致注册表空表、判定全线失效——此处补齐。
func TestMain(m *testing.M) {
	if data, err := os.ReadFile(filepath.Join("..", "..", "resource_types.json")); err == nil {
		types.SetBundledRegistryJSON(data)
	} else {
		log.Printf("[instance_test] 注入测试基线失败: %v（LoadRegistry 相关测试将失去基线）", err)
	}
	os.Exit(m.Run())
}
