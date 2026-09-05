package watcher

import (
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// TestMain 注入仓库根 resource_types.json 为 types 包测试基线
// （统一实现见 testutil.InjectRootRegistry；commit 11bfca3b 删 CWD 回退后测试须显式注入）。
func TestMain(m *testing.M) {
	testutil.InjectRootRegistry(m)
}
