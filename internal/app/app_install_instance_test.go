// ===== app_install_instance.go 契约测试（GetSyncScanDirs 结构化告警 + resourceTypesForSync）=====
package app

import (
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// GetSyncScanDirs 契约回归（i18n 修复）：返回结构化 warningCode/warningParams，
// 不再吐拼好的中文 warning 字符串——en/ja 用户可见中文警告的问题修复。
// 空配置（未配置游戏根）走 McRoot=="" 早退路径：返回 error + 空值 struct。
// ⚠️ 必须用 repoApp 桩而非 &App{} 零值：后者触发 LoadAppConfig 惰性读**磁盘真实配置**，
// dev 机（Windows 有 config.json 且 McRoot 非空）与 CI（ubuntu 无配置）结果相反——
// 环境泄漏使本测试在 dev 机恒红。repoApp 预置 configLoaded=true + 空 cache，两态确定。
func TestGetSyncScanDirs_StructuredWarningContract(t *testing.T) {
	a := repoApp(t, types.AppConfig{})
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

// TestResourceTypesForSync 锁 rtype 路径限定的三态语义与共享单例守护
// （2026-09 死代码修复：GetInstanceSyncStatus 曾构造 filtered 却把全集传给
// BuildSyncItems，注释宣称的路径限定从未生效——本测试补上当初缺失的行为锁）。
func TestResourceTypesForSync(t *testing.T) {
	all := []registry.ResourceType{
		{ID: "ysm", Name: "YSM"},
		{ID: "EntityPlayer", Name: "MMD"},
		{ID: "blueprint", Name: "Blueprint"},
	}
	origLen := len(all)

	// rtype 空 → 原样透传（全集语义，前端「全部类型」场景）
	if got := resourceTypesForSync(all, ""); len(got) != origLen {
		t.Errorf("rtype 空应透传全集 %d 项, got %d", origLen, len(got))
	}
	// 命中 → 只保留该类型
	got := resourceTypesForSync(all, "EntityPlayer")
	if len(got) != 1 || got[0].ID != "EntityPlayer" {
		t.Errorf("命中应仅返回 EntityPlayer, got %+v", got)
	}
	// 未知 rtype → 空切片（消费端按类型过滤后本就空，等价且省全盘扫描）
	if got := resourceTypesForSync(all, "no-such"); len(got) != 0 {
		t.Errorf("未知 rtype 应返回空, got %+v", got)
	}
	// 核心守护（code_review 67929360 P2）：入参切片永不被就地截断——
	// LoadRegistry 返回进程级共享单例，截断会永久残害所有消费方。
	if len(all) != origLen || all[0].ID != "ysm" {
		t.Fatalf("入参切片被就地修改（len %d, [0]=%q），共享注册表单例守护破防", len(all), all[0].ID)
	}
}
