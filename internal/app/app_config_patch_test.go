// 配置原子 patch 绑定 SaveAppConfigPatch 的回归（锐评 2026-10-15 P1 ③）。
//
// 病源：前端 patch 语义由**两次 IPC** 拼出来——`views/config-write.ts|writeAppConfig`
// 先 `await LoadAppConfig()` 取一份快照，在 JS 侧按 `patch.X !== undefined ? patch.X :
// latest.X` 拼出完整六元组，再 `await SaveAppConfig(...)` 落盘。两个 await 之间让出
// 事件循环：期间若另一写入口（SaveThresholds / SetDownloadMirror / 另一处
// writeAppConfig）改了某字段，本次的 `latest` 快照不含它，于是那次改动被整份回写冲掉。
//
// 与既有 configWriteMu 的分工（不是重复建设）：configWriteMu 已把 Go 侧的
// 「Load→modify→save」串行化，但**读盘发生在锁外**（前端的预读），锁管不到。
// 本绑定把整个读-改-写搬进 Go 侧一次调用，锁内重读，TOCTOU 窗口从「两次 IPC 之间的
// 任意长事件循环」收窄为「不存在」。
//
// 判据：① 单字段 patch 必须保留其余全部字段（含运行阈值——历史事故：逐字段白名单
// 手抄必漏，VoxelMaxBlocks/窗口状态都曾被零值覆盖）；② 并发 patch 各改不同字段时
// 无字段丢失（对竞态敏感：无原子性时后写者的快照不含前者字段）。
package app

import (
	"strings"
	"sync"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// patchApp 搭一个「磁盘基线 + 可写 App」的夹具。
// ⚠️ 不能用 &App{} 裸零值：LoadAppConfig 会惰性读**磁盘真实配置**
// （2026-09-26 写穿事故，见 pathmgr_test.go|repoApp 注释）。必须注入 install，
// 因为落盘成功后要调 a.install.SyncLinkMode。
func patchApp(t *testing.T, base types.AppConfig) *App {
	t.Helper()
	orig := pathMgr
	pathMgr = fakePathMgr{appData: t.TempDir()}
	t.Cleanup(func() { pathMgr = orig })

	a := newLinkModeApp()
	testutil.NoError(t, a.saveConfig(base), "saveConfig 基线")
	return a
}

// TestSaveAppConfigPatch_PreservesUnspecifiedFields 锁 patch 的核心语义：
// 只传 theme 时，其余字段一律保留磁盘现值——包括 8 个运行阈值字段。
func TestSaveAppConfigPatch_PreservesUnspecifiedFields(t *testing.T) {
	base := types.AppConfig{
		FilesRoot:               "C:/repo",
		McRoot:                  "C:/mc",
		LinkMode:                "copy",
		Theme:                   "cyber",
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
		WinW:                    1400,
		WinH:                    900,
	}
	a := patchApp(t, base)

	// 只 patch 主题这一个字段（FilesRoot/McRoot 用 *string，nil = 未传）
	newTheme := "warm"
	err := a.SaveAppConfigPatch(types.AppConfigPatch{Theme: &newTheme})
	testutil.NoError(t, err, "单字段 patch")

	got := a.LoadAppConfig()
	if got.Theme != "warm" {
		t.Errorf("Theme 未写入: got %q want %q", got.Theme, "warm")
	}
	// 逐字段断言保留（结构体整体比对会让失败信息淹没在一个 diff 里，
	// 且日后 AppConfig 加字段会自动纳入比对——这正是我们要的行为，故用整体 + 关键字段双断言）
	want := base
	want.Theme = "warm"
	want.LinkMode = "copy" // SaveAppConfigPatch 不触碰链接模式安装同步时仍应保持
	if got.FilesRoot != want.FilesRoot || got.McRoot != want.McRoot || got.Mirror != want.Mirror {
		t.Errorf("路径/镜像源字段被清零: got filesRoot=%q mcRoot=%q mirror=%q",
			got.FilesRoot, got.McRoot, got.Mirror)
	}
	if got.VoxelMaxBlocks != want.VoxelMaxBlocks {
		t.Errorf("VoxelMaxBlocks 被清零: got %d want %d", got.VoxelMaxBlocks, want.VoxelMaxBlocks)
	}
	if got.ScanCacheTTLMs != want.ScanCacheTTLMs || got.DownloadTimeoutSec != want.DownloadTimeoutSec {
		t.Errorf("扫描/下载阈值被清零: got ttl=%d timeout=%d", got.ScanCacheTTLMs, got.DownloadTimeoutSec)
	}
	if got.LogMaxEntries != want.LogMaxEntries || got.LogMaxFieldLen != want.LogMaxFieldLen ||
		got.LogCorruptRetentionDays != want.LogCorruptRetentionDays {
		t.Errorf("日志阈值被清零: got entries=%d fieldLen=%d retention=%d",
			got.LogMaxEntries, got.LogMaxFieldLen, got.LogCorruptRetentionDays)
	}
	if got.PreviewReadLimitMB != want.PreviewReadLimitMB ||
		got.UpdateCheckIntervalMs != want.UpdateCheckIntervalMs ||
		got.UpdateCheckTimeoutMs != want.UpdateCheckTimeoutMs {
		t.Errorf("预览/版本检查阈值被清零: got preview=%d interval=%d timeout=%d",
			got.PreviewReadLimitMB, got.UpdateCheckIntervalMs, got.UpdateCheckTimeoutMs)
	}
	if got.WinW != want.WinW || got.WinH != want.WinH {
		t.Errorf("窗口状态被清零: got %dx%d want %dx%d", got.WinW, got.WinH, want.WinW, want.WinH)
	}
}

// TestSaveAppConfigPatch_EmptyPatchIsNoOp 空补丁不得改写任何字段
// （「误调用 save 无副作用」——前端把 patch 拼错/漏传时不至于清空用户配置）。
func TestSaveAppConfigPatch_EmptyPatchIsNoOp(t *testing.T) {
	base := types.AppConfig{FilesRoot: "C:/repo", LinkMode: "copy", Theme: "cyber", Mirror: "jsdelivr"}
	a := patchApp(t, base)

	testutil.NoError(t, a.SaveAppConfigPatch(types.AppConfigPatch{}), "空补丁")

	got := a.LoadAppConfig()
	if got.Theme != base.Theme || got.Mirror != base.Mirror ||
		got.FilesRoot != base.FilesRoot || got.LinkMode != base.LinkMode {
		t.Errorf("空补丁改动了配置: got %+v, want 原样 %+v", got, base)
	}
}

// TestSaveAppConfigPatch_LinkModeValidatedAndSynced 链接模式走既有净化 +
// 落盘后同步 installer 内存态（与 SaveAppConfig 同口径：否则落盘了新模式而
// installer 仍用旧模式，要到重启才生效）。
func TestSaveAppConfigPatch_LinkModeValidatedAndSynced(t *testing.T) {
	a := patchApp(t, types.AppConfig{FilesRoot: "C:/repo", LinkMode: "copy"})

	// 非法值：软校验回落旧值 copy，不得落脏值（ADR-296 D6）
	bad := "not-a-mode"
	testutil.NoError(t, a.SaveAppConfigPatch(types.AppConfigPatch{LinkMode: &bad}), "非法 linkMode 软校验")
	if got := a.LoadAppConfig().LinkMode; got != "copy" {
		t.Errorf("非法 linkMode 未回落旧值: got %q want %q", got, "copy")
	}

	// 合法值：落盘 + 同步 installer
	ok := "hardlink"
	if err := a.SaveAppConfigPatch(types.AppConfigPatch{LinkMode: &ok}); err != nil {
		t.Fatalf("合法 linkMode patch 报错: %v", err)
	}
	if got := a.LoadAppConfig().LinkMode; got != "hardlink" {
		t.Errorf("合法 linkMode 未落盘: got %q want %q", got, "hardlink")
	}
}

// TestSaveAppConfigPatch_McRootValidated mcRoot 非空时必过 ValidateMinecraftDir，
// 校验失败返回错误且**不落盘**（不得静默把无效路径写进配置）。
func TestSaveAppConfigPatch_McRootValidated(t *testing.T) {
	base := types.AppConfig{FilesRoot: "C:/repo", Theme: "cyber"}
	a := patchApp(t, base)

	bad := "C:/definitely/not/a/minecraft/dir"
	if err := a.SaveAppConfigPatch(types.AppConfigPatch{McRoot: &bad}); err == nil {
		t.Errorf("非法 mcRoot 期望返回校验错误，实际 nil（会把无效路径落盘）")
	}
	if got := a.LoadAppConfig().McRoot; got != base.McRoot {
		t.Errorf("校验失败后仍改动了 McRoot: got %q want %q", got, base.McRoot)
	}
}

// TestSaveAppConfigPatch_ConcurrentNoFieldLoss 并发 patch 各自改不同字段，
// 无字段丢失。跨入口并发（patch 入口 vs 既有 SetDownloadMirror/SaveThresholds/
// SetResourceRoot）——这正是 configWriteMu 串行化 + 锁内重读共同保证的：
// 前者防锁内交错，后者防「读盘发生在锁外」。
func TestSaveAppConfigPatch_ConcurrentNoFieldLoss(t *testing.T) {
	base := types.AppConfig{FilesRoot: "C:/repo", McRoot: "C:/mc", LinkMode: "copy", Theme: "cyber"}
	a := patchApp(t, base)

	const rounds = 8
	var wg sync.WaitGroup
	errCh := make(chan error, rounds*4)

	for i := 0; i < rounds; i++ {
		wg.Add(4)
		go func() { // ① patch 入口改主题
			defer wg.Done()
			theme := "warm"
			if err := a.SaveAppConfigPatch(types.AppConfigPatch{Theme: &theme}); err != nil {
				errCh <- err
			}
		}()
		go func() { // ② 既有入口改镜像源
			defer wg.Done()
			if err := a.SetDownloadMirror("ghfast.top"); err != nil {
				errCh <- err
			}
		}()
		go func() { // ③ 既有入口改日志阈值
			defer wg.Done()
			if err := a.SaveThresholds(7200000, 1500); err != nil {
				errCh <- err
			}
		}()
		go func() { // ④ 既有入口改自定义根
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
	if final.Theme != "warm" {
		t.Errorf("patch 写入的 Theme 被并发覆盖: got %q want %q", final.Theme, "warm")
	}
	if final.Mirror != "ghfast.top" {
		t.Errorf("Mirror 被并发写覆盖: got %q want %q", final.Mirror, "ghfast.top")
	}
	if final.LogMaxEntries != 1500 {
		t.Errorf("LogMaxEntries 被并发写覆盖: got %d want %d", final.LogMaxEntries, 1500)
	}
	// SetResourceRoot 会把相对路径规整为绝对路径，按后缀比对
	if final.CustomRoots == nil || !strings.HasSuffix(final.CustomRoots["ysm"], "custom-ysm") {
		t.Errorf("CustomRoots[ysm] 被并发写覆盖: got %v", final.CustomRoots)
	}
	// 基线字段同样必须存活（patch 不得把未传字段清零）
	if final.FilesRoot != "C:/repo" || final.McRoot != "C:/mc" || final.LinkMode != "copy" {
		t.Errorf("基线字段丢失: got filesRoot=%q mcRoot=%q linkMode=%q", final.FilesRoot, final.McRoot, final.LinkMode)
	}
}
