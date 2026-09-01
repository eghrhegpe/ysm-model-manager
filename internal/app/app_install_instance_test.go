// ===== app_install_instance.go 契约测试（GetSyncScanDirs 结构化告警）=====
package app

import (
	"testing"
)

// GetSyncScanDirs 契约回归（i18n 修复）：返回结构化 warningCode/warningParams，
// 不再吐拼好的中文 warning 字符串——en/ja 用户可见中文警告的问题修复。
// 空 App（未配置游戏根）走 McRoot=="" 早退路径：返回 error + 空值 struct。
func TestGetSyncScanDirs_StructuredWarningContract(t *testing.T) {
	a := &App{}
	got, err := a.GetSyncScanDirs("litematic", "x")
	if err == nil {
		t.Fatal("空配置（未配置游戏根）应返回 error")
	}
	if got.WarningCode != "" {
		t.Errorf("空配置路径 warningCode 应为空串, got %q", got.WarningCode)
	}
	if got.WarningParams == nil {
		t.Errorf("空配置路径 warningParams 应为空 map（非 nil）, got %v", got.WarningParams)
	}
}
