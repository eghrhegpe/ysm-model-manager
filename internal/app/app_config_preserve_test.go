// SaveAppConfig 字段保全回归（锐评 2026-10-10 配置链路审计）。
// 立因：SaveAppConfig 用**白名单**手工构造 cfg（只列 filesRoot/mcRoot/theme/... +
// 显式拷贝 Mirror/VoxelMaxBlocks/WinX..WinScrH/CustomRoots），凡未列入的字段一律被
// 零值覆盖落盘。历史已两次踩中：VoxelMaxBlocks（曾每次保存重置为 0，修复时补进白名单）、
// 窗口状态——都是「白名单忘带某字段」的同源病。而 go/types AppConfig 现有 8 个运行阈值
// 字段（ScanCacheTTLMs/DownloadTimeoutSec/LogMaxEntries/LogMaxFieldLen/
// LogCorruptRetentionDays/PreviewReadLimitMB/UpdateCheckIntervalMs/UpdateCheckTimeoutMs）
// **全部不在白名单**：用户经 SaveThresholds 设好阈值后，任何一次改主题/链接模式/路径的
// SaveAppConfig 都会把它们清零（回退各包默认）——「设置静默消失」类事故再现。
// 判据：SaveAppConfig 未显式触碰的字段，保存后必须逐字段等于保存前（本测试同时把
// 「以旧为基」的结构性修复钉死，杜绝第九条字段再漏）。
package app

import (
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

func baselineThresholds() types.AppConfig {
	return types.AppConfig{
		FilesRoot:               "C:/repo",
		Mirror:                  "jsdelivr", // 对照组：已在白名单，本就该存活
		VoxelMaxBlocks:          300000,     // 对照组：曾修过一次
		ScanCacheTTLMs:          60000,
		DownloadTimeoutSec:      90,
		LogMaxEntries:           800,
		LogMaxFieldLen:          2048,
		LogCorruptRetentionDays: 14,
		PreviewReadLimitMB:      100,
		UpdateCheckIntervalMs:   3600000,
		UpdateCheckTimeoutMs:    30000,
		WinX:                    42,
	}
}

func TestSaveAppConfig_PreservesThresholdFields(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := newLinkModeApp()
	// 建立基线：全字段落盘 + 进 configCache
	base := baselineThresholds()
	err := a.saveConfig(base)
	testutil.NoError(t, err, "saveConfig 基线")

	// 模拟改主题保存：六个入参里只 theme 非空，其余传空（orDefault 保旧值、不触发 watcher 重建）
	err = a.SaveAppConfig("", "", "", "", "dark", "off")
	testutil.NoError(t, err, "SaveAppConfig")

	got := a.LoadAppConfig()
	// 整数字段逐条断言
	if got.VoxelMaxBlocks != base.VoxelMaxBlocks {
		t.Errorf("VoxelMaxBlocks 被重置: got %d want %d", got.VoxelMaxBlocks, base.VoxelMaxBlocks)
	}
	if got.ScanCacheTTLMs != base.ScanCacheTTLMs {
		t.Errorf("ScanCacheTTLMs 被重置为 %d（应保 %d）——改主题清零扫描 TTL", got.ScanCacheTTLMs, base.ScanCacheTTLMs)
	}
	if got.DownloadTimeoutSec != base.DownloadTimeoutSec {
		t.Errorf("DownloadTimeoutSec 被重置: got %d want %d", got.DownloadTimeoutSec, base.DownloadTimeoutSec)
	}
	if got.LogMaxEntries != base.LogMaxEntries {
		t.Errorf("LogMaxEntries 被重置: got %d want %d", got.LogMaxEntries, base.LogMaxEntries)
	}
	if got.LogMaxFieldLen != base.LogMaxFieldLen {
		t.Errorf("LogMaxFieldLen 被重置: got %d want %d", got.LogMaxFieldLen, base.LogMaxFieldLen)
	}
	if got.LogCorruptRetentionDays != base.LogCorruptRetentionDays {
		t.Errorf("LogCorruptRetentionDays 被重置: got %d want %d", got.LogCorruptRetentionDays, base.LogCorruptRetentionDays)
	}
	if got.PreviewReadLimitMB != base.PreviewReadLimitMB {
		t.Errorf("PreviewReadLimitMB 被重置: got %d want %d", got.PreviewReadLimitMB, base.PreviewReadLimitMB)
	}
	if got.UpdateCheckIntervalMs != base.UpdateCheckIntervalMs {
		t.Errorf("UpdateCheckIntervalMs 被重置: got %d want %d", got.UpdateCheckIntervalMs, base.UpdateCheckIntervalMs)
	}
	if got.UpdateCheckTimeoutMs != base.UpdateCheckTimeoutMs {
		t.Errorf("UpdateCheckTimeoutMs 被重置: got %d want %d", got.UpdateCheckTimeoutMs, base.UpdateCheckTimeoutMs)
	}
	if got.WinX != base.WinX {
		t.Errorf("WinX 被重置: got %d want %d", got.WinX, base.WinX)
	}
	if got.Mirror != base.Mirror {
		t.Errorf("Mirror(对照) 丢: got %q want %q", got.Mirror, base.Mirror)
	}
	// 显式入参字段应被更新
	if got.Theme != "dark" || got.ThemeAuto != "off" {
		t.Errorf("theme/themeAuto 显式入参未生效: %q/%q", got.Theme, got.ThemeAuto)
	}
}

// 以旧为基的等价性护栏：旧白名单构造「不拷贝废弃字段」天然把 YsmRoot 等清零，
// 而启动路径 loadAppConfig 不跑 migrateLegacyConfigFields——废弃字段可留在 configCache。
// 改「以旧为基」后若漏 clearDeprecatedFields，这次保存会把它们重新落盘，破坏
// migrateLegacyConfigFields 的「防双源写入」不变量（值拷贝不含它们 = 与旧构造等价）。
func TestSaveAppConfig_ClearsDeprecatedFields(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := newLinkModeApp()
	// 模拟启动路径残留：configCache 含废弃 YsmRoot（loadAppConfig 不清洗）
	dirty := baselineThresholds()
	dirty.YsmRoot = "C:/legacy/ysm"
	a.configMu.Lock()
	a.configCache = dirty
	a.configLoaded = true
	a.configMu.Unlock()

	err := a.SaveAppConfig("", "", "", "", "dark", "off")
	testutil.NoError(t, err, "SaveAppConfig")
	if got := a.LoadAppConfig().YsmRoot; got != "" {
		t.Errorf("废弃字段 YsmRoot 不得经以旧为基重新落盘（防双源不变量），实得 %q", got)
	}
}
