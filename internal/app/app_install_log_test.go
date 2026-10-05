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

// TestGetLogChannelHealth ADR-322 D1：绑定只透传 logger 健康锁存位，自身不做裁决
// （裁决唯一处在 go/logs markPersistFailure）——本测试锁两件事：
// ① 落盘态（resourceApp 注入 TempDir）报健康，不因「App 层不知道」而误报；
// ② 换成内存态 logger（NewLogger("")）立刻报不健康 + 机器码。
func TestGetLogChannelHealth(t *testing.T) {
	a := resourceApp(t, types.AppConfig{FilesRoot: t.TempDir()})
	if h := a.GetLogChannelHealth(); !h.PersistOK {
		t.Fatalf("落盘态 logger 应报健康, got %+v", h)
	}
	a.logger = logs.NewLogger("")
	h := a.GetLogChannelHealth()
	if h.PersistOK {
		t.Fatal("内存态 logger 应报不健康（元失败必须可观测）")
	}
	if h.Reason != types.ChannelReasonMemoryState {
		t.Errorf("Reason = %q, 期望 %q", h.Reason, types.ChannelReasonMemoryState)
	}
}
