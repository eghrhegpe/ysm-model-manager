package config

import (
	"sync"
	"testing"

	"github.com/google/go-cmp/cmp"

	"ysm-model-manager/go/types"
)

func TestGet_NilFallback(t *testing.T) {
	Set(nil)
	defer Set(nil)

	if got := Get(); !cmp.Equal(got, types.AppConfig{}) {
		t.Errorf("未注入时应返回零值 AppConfig\ndiff:\n%s", cmp.Diff(got, types.AppConfig{}))
	}
}

func TestSetGet_Injected(t *testing.T) {
	Set(nil)
	defer Set(nil)

	Set(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 100}
	})
	if mb := Get().PreviewReadLimitMB; mb != 100 {
		t.Errorf("注入后 Get().PreviewReadLimitMB = %d, 期望 100", mb)
	}
}

func TestSetNilAfterSet(t *testing.T) {
	Set(nil)
	defer Set(nil)

	Set(func() types.AppConfig { return types.AppConfig{DownloadTimeoutSec: 9} })
	Set(nil)
	if got := Get(); !cmp.Equal(got, types.AppConfig{}) {
		t.Errorf("Set(nil) 后应回退零值\ndiff:\n%s", cmp.Diff(got, types.AppConfig{}))
	}
}

// TestConcurrentSetGet 验证 atomic 守卫在并发读写下无数据竞争（配合 go test -race）。
// 原 4 包 `var configFunc` 无同步原语，此场景会触发 -race 报错。
func TestConcurrentSetGet(t *testing.T) {
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		idx := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				Set(func() types.AppConfig { return types.AppConfig{PreviewReadLimitMB: idx + 1} })
				_ = Get()
			}
		}()
	}
	wg.Wait()
	Set(nil)
}
