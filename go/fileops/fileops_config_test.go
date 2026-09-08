// ===== fileops 包 0% 覆盖函数补测（previewReadLimit / 配置源收敛 go/config）=====
package fileops

import (
	"testing"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/types"
)

func TestPreviewReadLimit_NilFallback(t *testing.T) {
	config.Set(nil)
	t.Cleanup(func() { config.Set(nil) })

	// 未注入配置源时回退默认值 maxPreviewRead (50MB)
	if got := previewReadLimit(); got != maxPreviewRead {
		t.Errorf("config=nil 时 previewReadLimit() = %d, 期望 %d", got, maxPreviewRead)
	}
}

func TestPreviewReadLimit_Injected(t *testing.T) {
	config.Set(nil)
	t.Cleanup(func() { config.Set(nil) })

	config.Set(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 100}
	})

	got := previewReadLimit()
	expected := int64(100) << 20
	if got != expected {
		t.Errorf("注入 PreviewReadLimitMB=100 后 previewReadLimit() = %d, 期望 %d", got, expected)
	}
}

func TestPreviewReadLimit_ZeroValueFallback(t *testing.T) {
	config.Set(nil)
	t.Cleanup(func() { config.Set(nil) })

	// 注入但字段为 0 → 应回退默认
	config.Set(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 0}
	})

	if got := previewReadLimit(); got != maxPreviewRead {
		t.Errorf("PreviewReadLimitMB=0 时应回退默认: got=%d, want=%d", got, maxPreviewRead)
	}
}

func TestPreviewReadLimit_Override(t *testing.T) {
	config.Set(nil)
	t.Cleanup(func() { config.Set(nil) })

	config.Set(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 50}
	})
	if previewReadLimit() != int64(50)<<20 {
		t.Error("第一次注入未生效")
	}

	// 再覆盖
	config.Set(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 200}
	})
	if got := previewReadLimit(); got != int64(200)<<20 {
		t.Errorf("覆盖后 previewReadLimit() = %d, 期望 %d", got, int64(200)<<20)
	}
}

func TestPreviewReadLimit_NilAfterSet(t *testing.T) {
	config.Set(nil)
	t.Cleanup(func() { config.Set(nil) })

	config.Set(func() types.AppConfig {
		return types.AppConfig{PreviewReadLimitMB: 75}
	})
	// 复位为未注入
	config.Set(nil)

	if got := previewReadLimit(); got != maxPreviewRead {
		t.Errorf("config.Set(nil) 后应回退默认: got=%d, want=%d", got, maxPreviewRead)
	}
}
