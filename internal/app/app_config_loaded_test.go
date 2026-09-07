// ===== configLoaded=true 在 readJSONFile 失败时仍被设置的回归测试 =====
// 问题：LoadAppConfig 中 readJSONFile 失败后 configLoaded 仍被设为 true，配置永久丢失
// 修复：仅在 readJSONFile 成功后才设 configLoaded = true
package app

import (
	"testing"
)

// TestLoadAppConfig_ReadFailureDoesNotSetLoaded 验证：配置文件读取失败时，
// configLoaded 保持 false，下次 LoadAppConfig 会重试读取。
// 旧实现：readJSONFile 失败后 configLoaded 仍被设为 true → 配置永久丢失。
func TestLoadAppConfig_ReadFailureDoesNotSetLoaded(t *testing.T) {
	// 设置 pathMgr = nil 使 configPath() 返回空串 → readJSONFile 必然失败
	orig := pathMgr
	pathMgr = nil
	defer func() { pathMgr = orig }()

	a := &App{}
	a.LoadAppConfig()

	a.configMu.RLock()
	loaded := a.configLoaded
	a.configMu.RUnlock()

	if loaded {
		t.Fatal("readJSONFile 失败时 configLoaded 不应被设为 true（旧 bug：配置永久丢失）")
	}
}
