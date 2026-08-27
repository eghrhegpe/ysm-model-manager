// ===== app_install_instance.go 契约测试（GetSyncScanDirs 结构化告警）=====
package app

import (
	"encoding/json"
	"testing"
)

// GetSyncScanDirs 契约回归（i18n 修复）：返回结构化 warningCode/warningParams，
// 不再吐拼好的中文 warning 字符串——en/ja 用户可见中文警告的问题修复。
// 空 App（未配置游戏根）走 McRoot=="" 早退路径：验证 JSON 形状 + 旧字段移除。
func TestGetSyncScanDirs_StructuredWarningContract(t *testing.T) {
	a := &App{}
	got := a.GetSyncScanDirs("litematic", "x")
	if !json.Valid([]byte(got)) {
		t.Fatalf("GetSyncScanDirs 输出非法 JSON: %s", got)
	}
	var parsed struct {
		Global        string            `json:"global"`
		Instance      string            `json:"instance"`
		WarningCode   string            `json:"warningCode"`
		WarningParams map[string]string `json:"warningParams"`
		Warning       string            `json:"warning"`
	}
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("解析失败: %v (json=%s)", err, got)
	}
	if parsed.WarningCode != "" {
		t.Errorf("空配置路径 warningCode 应为空串, got %q", parsed.WarningCode)
	}
	if parsed.WarningParams == nil {
		t.Errorf("空配置路径 warningParams 应为空 map（非 nil）, got %v", parsed.WarningParams)
	}
	if parsed.Warning != "" {
		t.Errorf("契约回归：不应再返回拼好的 warning 字符串（i18n 直出修复）, got %q", parsed.Warning)
	}
}
