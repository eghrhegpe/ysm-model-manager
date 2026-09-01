// ===== app_sync.go（同步冲突检测/解决绑定）契约测试 =====
// 覆盖：缺失目录时返回 Go error 必须非 nil（防假阴性「✅ 无冲突」）、
// 空冲突报告合法（code_review P2 回归）。
package app

import (
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// 未配置游戏根目录 → 必须返回 error，而非「空冲突报告」——
// 否则前端把「无法扫描」当「✅ 未检测到同步冲突」假阴性（code_review P2）。
func TestDetectConflicts_NoMcRoot_ReturnsError(t *testing.T) {
	a := repoApp(t, types.AppConfig{}) // McRoot 空
	if _, err := a.DetectConflicts("ysm", "test-instance"); err == nil {
		t.Fatal("错误响应必须返回非 nil error，避免假阴性（code_review P2）")
	}
}

// 未配置游戏根目录时 ResolveConflicts 也必须返回 error。
func TestResolveConflicts_NoMcRoot_ReturnsError(t *testing.T) {
	a := repoApp(t, types.AppConfig{})
	if _, err := a.ResolveConflicts(`[]`, "force_remote", "ysm", "test-instance"); err == nil {
		t.Fatal("ResolveConflicts 错误响应必须返回非 nil error")
	}
}

// TestDetectConflicts_NoFilesRoot_ReturnsError 验证全局资源目录缺失时必须返回 error
func TestDetectConflicts_NoFilesRoot_ReturnsError(t *testing.T) {
	// McRoot 必须有效才能走到 filesRootForSync 检查
	base := t.TempDir()
	// FilesRoot 空 → GetRepoRoot 返回空 → filesRootForSync 失败
	a := repoApp(t, types.AppConfig{FilesRoot: "", McRoot: base})

	if _, err := a.DetectConflicts("ysm", "test-instance"); err == nil {
		t.Fatal("错误响应必须返回非 nil error")
	}
}

// TestDetectConflicts_NoInstance_ReturnsError 验证整合包实例缺失时必须返回 error
func TestDetectConflicts_NoInstance_ReturnsError(t *testing.T) {
	base := t.TempDir()
	// McRoot 有效，FilesRoot 也有效（为了通过前置检查），但 instanceName 不存在
	a := repoApp(t, types.AppConfig{FilesRoot: base, McRoot: base})

	_, err := a.DetectConflicts("ysm", "non-existent-instance")
	if err == nil {
		t.Fatal("错误响应必须返回非 nil error")
	}
	// 进一步断言错误信息内容
	if !strings.Contains(err.Error(), "未找到整合包") {
		t.Errorf("错误信息应包含 '未找到整合包', got %q", err.Error())
	}
}
