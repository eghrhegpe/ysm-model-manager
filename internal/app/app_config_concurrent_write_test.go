// 配置写入并发串行化回归（锐评 2026-10-15 P2）。
//
// 病源：配置写入的形态是 LoadAppConfig()（取内存/磁盘快照）→ 改若干字段 →
// saveConfig(cfg)（整份落盘）。原实现里 configMu 只护 configCache 这份**内存副本**
// 的读写，事务整体跨在锁之外；且磁盘写入面有 5 宽（SaveAppConfig / SetDownloadMirror /
// SaveThresholds / SetResourceRoot / ResetResourceRoot），前端各调用点独立 void 不串行。
//
// 可复现后果：两个写并发读到**同一份**快照，各自改不同字段，后写者把「改前的快照」
// 整份落盘 = 前写者的改动被静默覆盖，用户改了设置却在重启后看到旧值。
// 前端侧更易触发：主题连点两次（bindThemeCardClicks 显式 void 不 await）。
//
// 判据：并发的多个写入，各自的字段都必须在最终落盘态中存在——
// 无锁时后写者的快照不含前者字段，故此断言对竞态敏感。
package app

import (
	"strings"
	"sync"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// TestConfigWrites_ConcurrentDoNotLoseFields 用多个不同写入口并发写入不同字段，
// 验证 configWriteMu 把「读-改-写」串行化后无字段丢失。
func TestConfigWrites_ConcurrentDoNotLoseFields(t *testing.T) {
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

	// 三个写入口 × 各自字段，并发发起（不选 mcRoot：它过 ValidateMinecraftDir
	// 需真实存在的目录，测试里必然校验失败、与本用例无关）：
	// ① SetDownloadMirror→ 改 Mirror
	// ② SaveThresholds   → 改 LogMaxEntries
	// ③ SetResourceRoot  → 改 CustomRoots[rtype]
	const rounds = 8
	var wg sync.WaitGroup
	errCh := make(chan error, rounds*3)

	for i := 0; i < rounds; i++ {
		wg.Add(3)
		go func() {
			defer wg.Done()
			if err := a.SetDownloadMirror("jsdelivr"); err != nil {
				errCh <- err
			}
		}()
		go func() {
			defer wg.Done()
			if err := a.SaveThresholds(3600000, 800); err != nil {
				errCh <- err
			}
		}()
		go func() {
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
	if final.Mirror != "jsdelivr" {
		t.Errorf("Mirror 被并发写覆盖: got %q want %q", final.Mirror, "jsdelivr")
	}
	if final.LogMaxEntries != 800 {
		t.Errorf("LogMaxEntries 被并发写覆盖: got %d want %d", final.LogMaxEntries, 800)
	}
	// SetResourceRoot 会把相对路径规整为绝对路径，故按后缀比对而非全等
	if final.CustomRoots == nil || !strings.HasSuffix(final.CustomRoots["ysm"], "custom-ysm") {
		t.Errorf("CustomRoots[ysm] 被并发写覆盖: got %v", final.CustomRoots)
	}
	// 基线字段同样必须存活（与 app_config_preserve_test 的单线程口径一致）
	if final.FilesRoot != "C:/repo" {
		t.Errorf("FilesRoot 基线丢失: got %q want %q", final.FilesRoot, "C:/repo")
	}
	if final.McRoot != "C:/mc" {
		t.Errorf("McRoot 基线丢失: got %q want %q", final.McRoot, "C:/mc")
	}
	if final.Theme != "cyber" {
		t.Errorf("Theme 基线丢失: got %q want %q", final.Theme, "cyber")
	}
	if final.LinkMode != "copy" {
		t.Errorf("LinkMode 基线丢失: got %q want %q", final.LinkMode, "copy")
	}
}
