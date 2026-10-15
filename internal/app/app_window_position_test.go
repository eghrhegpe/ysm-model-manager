// 窗口位置持久化必须持 configWriteMu（锐评 2026-10-15 P2 补刀）。
//
// 病根：`SaveWindowPosition` 是第 6 个配置写入面，但它做的是「LoadAppConfig 取快照 →
// 改 8 个 Win* 字段 → saveConfig 整份落盘」——**没有持 configWriteMu**。同族的另 5 个
// 写入面（SaveAppConfig / SaveAppConfigPatch / SetDownloadMirror / SaveThresholds /
// SetResourceRoot）都持锁，持锁范围 = 整个 Load→modify→save。漏掉的这一个开了个洞：
//
// 退出时保存窗口位置（app.go|shutdown 调）若与任何一次设置保存并发，两边读到**同一份**
// 快照，各自改不同字段，后写者把前写者的改动整份冲掉——用户刚设好的阈值/镜像源/主题
// 在退出瞬间被窗口坐标覆盖掉，且全程无报错（SaveWindowPosition 内部只 log 不返回错误，
// 这正是它「静默」的第二层原因）。
//
// 判据：并发的窗口位置写入与其它写入面，各自的字段都必须在最终落盘态中存在——
// 无锁时后写者的快照不含前者字段，故此断言对竞态敏感（同 app_config_concurrent_write_test.ts
// 的判据设计：并发 + 逐字段断言，不是快照比对）。
package app

import (
	"strings"
	"sync"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// TestSaveWindowPosition_ConcurrentNoFieldLoss 并发：窗口位置写入 vs 三个既有写入面，
// 各自字段都必须在最终落盘态中存在。
func TestSaveWindowPosition_ConcurrentNoFieldLoss(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := newLinkModeApp()
	base := types.AppConfig{
		FilesRoot: "C:/repo",
		McRoot:    "C:/mc",
		LinkMode:  "copy",
		Theme:     "cyber",
	}
	testutil.NoError(t, a.saveConfig(base), "saveConfig 基线")

	const rounds = 8
	var wg sync.WaitGroup
	errCh := make(chan error, rounds*4)

	for i := 0; i < rounds; i++ {
		wg.Add(4)
		go func() { // ① 窗口位置（本用例的主角：唯一不持锁的那个写入面）
			defer wg.Done()
			a.SaveWindowPosition(100+i, 200+i, 1400+i, 900+i)
		}()
		go func() { // ② 镜像源
			defer wg.Done()
			if err := a.SetDownloadMirror("ghfast.top"); err != nil {
				errCh <- err
			}
		}()
		go func() { // ③ 日志阈值
			defer wg.Done()
			if err := a.SaveThresholds(7200000, 1500); err != nil {
				errCh <- err
			}
		}()
		go func() { // ④ 自定义根
			defer wg.Done()
			if err := a.SetResourceRoot("ysm", "C:/custom-ysm"); err != nil {
				errCh <- err
			}
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Errorf("并发写入报错: %v", err)
	}

	final := a.LoadAppConfig()
	// 窗口位置必须落盘（SaveWindowPosition 自己的字段）
	if final.WinW == 0 {
		t.Errorf("窗口尺寸未落盘: got %dx%d want 非零", final.WinW, final.WinH)
	}
	// 其余三个写入面的字段必须存活 —— 无锁时窗口位置写入的快照不含它们，会被冲回旧值
	if final.Mirror != "ghfast.top" {
		t.Errorf("Mirror 被窗口位置写入覆盖: got %q want %q", final.Mirror, "ghfast.top")
	}
	if final.LogMaxEntries != 1500 {
		t.Errorf("LogMaxEntries 被窗口位置写入覆盖: got %d want %d", final.LogMaxEntries, 1500)
	}
	if final.CustomRoots == nil || !strings.HasSuffix(final.CustomRoots["ysm"], "custom-ysm") {
		t.Errorf("CustomRoots[ysm] 被窗口位置写入覆盖: got %v", final.CustomRoots)
	}
	// 基线字段同样必须存活（窗口位置写入不得把未涉及的字段清零）
	if final.FilesRoot != "C:/repo" || final.McRoot != "C:/mc" || final.Theme != "cyber" {
		t.Errorf("基线字段丢失: got filesRoot=%q mcRoot=%q theme=%q", final.FilesRoot, final.McRoot, final.Theme)
	}
}

// TestSaveWindowPosition_PreservesOtherFields 单线程口径：窗口位置写入不得清零
// 其它字段（尤其 8 个运行阈值——它们不在任何写入面的入参里，全靠「以旧为基」保全）。
func TestSaveWindowPosition_PreservesOtherFields(t *testing.T) {
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	defer func() { pathMgr = orig }()

	a := newLinkModeApp()
	base := types.AppConfig{
		FilesRoot:               "C:/repo",
		LinkMode:                "copy",
		Theme:                   "sakura",
		Mirror:                  "jsdelivr",
		VoxelMaxBlocks:          123456,
		ScanCacheTTLMs:          45_000,
		DownloadTimeoutSec:      600,
		LogMaxEntries:           900,
		LogMaxFieldLen:          2048,
		LogCorruptRetentionDays: 14,
		PreviewReadLimitMB:      80,
		UpdateCheckIntervalMs:   3_600_000,
		UpdateCheckTimeoutMs:    90_000,
	}
	testutil.NoError(t, a.saveConfig(base), "saveConfig 基线")

	a.SaveWindowPosition(50, 60, 1280, 800)

	got := a.LoadAppConfig()
	if got.WinX != 50 || got.WinY != 60 || got.WinW != 1280 || got.WinH != 800 {
		t.Errorf("窗口位置未写入: got %d,%d %dx%d want 50,60 1280x800", got.WinX, got.WinY, got.WinW, got.WinH)
	}
	// 相对坐标必须同步计算（双屏安全：换屏后按百分比还原）
	if got.WinRelX == 0 || got.WinRelY == 0 {
		t.Errorf("相对坐标未计算（换屏后窗口会跳位）: WinRelX=%d WinRelY=%d", got.WinRelX, got.WinRelY)
	}
	// 关键：其余字段一个都不许丢
	if got.FilesRoot != base.FilesRoot || got.Theme != base.Theme || got.Mirror != base.Mirror ||
		got.LinkMode != base.LinkMode {
		t.Errorf("窗口位置写入清零了基础字段: got %+v", got)
	}
	if got.VoxelMaxBlocks != base.VoxelMaxBlocks {
		t.Errorf("VoxelMaxBlocks 被清零: got %d want %d", got.VoxelMaxBlocks, base.VoxelMaxBlocks)
	}
	if got.LogMaxEntries != base.LogMaxEntries || got.LogMaxFieldLen != base.LogMaxFieldLen ||
		got.LogCorruptRetentionDays != base.LogCorruptRetentionDays {
		t.Errorf("日志阈值被清零: got entries=%d fieldLen=%d retention=%d",
			got.LogMaxEntries, got.LogMaxFieldLen, got.LogCorruptRetentionDays)
	}
	if got.ScanCacheTTLMs != base.ScanCacheTTLMs || got.DownloadTimeoutSec != base.DownloadTimeoutSec ||
		got.PreviewReadLimitMB != base.PreviewReadLimitMB {
		t.Errorf("扫描/下载/预览阈值被清零: got ttl=%d timeout=%d preview=%d",
			got.ScanCacheTTLMs, got.DownloadTimeoutSec, got.PreviewReadLimitMB)
	}
	if got.UpdateCheckIntervalMs != base.UpdateCheckIntervalMs || got.UpdateCheckTimeoutMs != base.UpdateCheckTimeoutMs {
		t.Errorf("版本检查阈值被清零: got interval=%d timeout=%d",
			got.UpdateCheckIntervalMs, got.UpdateCheckTimeoutMs)
	}
}
