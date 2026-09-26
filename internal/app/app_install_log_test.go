package app

import (
	"testing"

	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/types"
)

// TestGetLogCaps 锐评⑤：诊断页检索窗口单源——两类 cap 均为正值，
// Runtime 与 app.go 构造 runtimeLogs 时传入的 DefaultRuntimeCap 一致；
// Op 随 AppConfig.LogMaxEntries 动态（这里只锁正值契约）。
func TestGetLogCaps(t *testing.T) {
	a := resourceApp(t, types.AppConfig{FilesRoot: t.TempDir()})
	a.runtimeLogs = logs.NewRuntimeBuffer(logs.DefaultRuntimeCap) // resourceApp 只装 logger，runtimeLogs 需显式构造
	caps := a.GetLogCaps()
	if caps.Op <= 0 {
		t.Fatalf("Op cap = %d, 期望正值（logMaxEntries 默认或配置值）", caps.Op)
	}
	if caps.Runtime != logs.DefaultRuntimeCap {
		t.Fatalf("Runtime cap = %d, 期望 %d（app.go 构造口径）", caps.Runtime, logs.DefaultRuntimeCap)
	}
}
