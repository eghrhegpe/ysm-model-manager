// scanindex_test.go — 持久浏览索引（ADR-352）行为测试。
// 白盒（package scanner）：直接触达表实例/注册面/代际戳。全部串行（全局注册面 +
// config.Set 注入 + 代际守卫是进程级状态，t.Parallel 会互相劈裂语义）。
// 每个用例 defer 复位：SetIndexRoots(nil)（清注册面+删全部表实例，等效 N1 全新进程）、
// config.Set(nil)、SetIndexTrustCapForTest(15min)——不向并行包测试泄漏索引面。
package scanner

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// finishIndexTest 统一复位（defer 首调）：注册面清空（连带删除全部表实例）、
// 配置回落、信任窗回落 15min、观测计数清零。
func finishIndexTest(t *testing.T) {
	t.Helper()
	SetIndexRoots(nil)
	config.Set(nil)
	SetIndexTrustCapForTest(15 * time.Minute)
	ResetScanIndexStats()
}

// writeFixtures 造 3 条目（a.ysm / sub/b.ysm / group/ysm.json 组名派生）+ 1 未知扩展名
// （".notext" 保证不在任何资源类型扩展名并集内——不依赖真实注册表数据文件）
func writeFixtures(t *testing.T, root string) {
	t.Helper()
	files := map[string]string{
		"a.ysm":                "model-a",
		"sub/b.ysm":            "model-b",
		"group/ysm.json":       "{}",
		"ignore/readme.notext": "未知扩展名，不进条目",
	}
	for rel, content := range files {
		p := filepath.Join(root, filepath.FromSlash(rel))
		testutil.NoError(t, os.MkdirAll(filepath.Dir(p), 0o755), "MkdirAll %s", p)
		testutil.NoError(t, os.WriteFile(p, []byte(content), 0o644), "WriteFile %s", p)
	}
}

// entryPaths 排序后的 Path 列表（比较口径）
func entryPaths(entries []types.ModelEntry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Path)
	}
	slices.Sort(out)
	return out
}

// TestScanIndexFastPath 快路径全链：注册+watched → 首走落表+锚定 → TTL 过期免走 serve
// → 定向失效去信任 → 重走重锚 → 免走再服务；子目录浏览不落表（未注册根 no-op）。
func TestScanIndexFastPath(t *testing.T) {
	defer finishIndexTest(t)
	ResetScanIndexStats()
	dir := t.TempDir()
	writeFixtures(t, dir)

	SetIndexRoots([]string{dir})
	MarkIndexRootWatched([]string{dir})
	config.Set(func() types.AppConfig { return types.AppConfig{ScanCacheTTLMs: 1} }) // 1ms TTL 制造快速过期

	// 首走：缓存冷 → 真走（owner hit=false）+ 收尾落表+锚定
	first, hit := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit, false, "首次浏览应真走盘")
	want := []string{
		filepath.Join(dir, "a.ysm"),
		filepath.Join(dir, "group", "ysm.json"),
		filepath.Join(dir, "sub", "b.ysm"),
	}
	got := entryPaths(first)
	testutil.Equal(t, len(got), 3, "首走条目不对")
	testutil.Equal(t, got, want, "首走条目不对")
	// ysm.json 组名派生 = 父目录名
	for _, e := range first {
		if filepath.Base(e.Path) == "ysm.json" {
			testutil.Equal(t, e.Name, "group", "ysm.json 组条目 Name 应为父目录名 group")
		}
	}
	_, statErr := os.Stat(filepath.Join(dir, ScanIndexPath))
	testutil.NoError(t, statErr, "零错误收尾应落持久表 %s", ScanIndexPath)
	// 子目录未注册：浏览不落表、不查表（行为与今日一致）
	_, _ = ScanEntriesBrowseWithHit(filepath.Join(dir, "sub"))
	_, statErr = os.Stat(filepath.Join(dir, "sub", ScanIndexPath))
	testutil.Equal(t, os.IsNotExist(statErr), true, "未注册子目录不得落表")

	// TTL 过期 + 无失效 + watched 根 → 快路径免走（hit=true = owner 未走盘）
	time.Sleep(2 * time.Millisecond)
	second, hit2 := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit2, true, "TTL 过期 + 信任态成立应免走")
	testutil.Equal(t, entryPaths(second), want, "免走重建条目应等价 walk")
	s, _ := ScanIndexStatsSnapshot()
	testutil.Equal(t, s >= 1, true, "免走服务应计 indexServes: got=%d", s)

	// 定向失效 → 去信任（keyVersions 推进）→ 必须重走
	InvalidatePath(dir)
	third, hit3 := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit3, false, "InvalidatePath 后必须重走（信任态已破）")
	_ = third
	// 重走收尾重锚 → 再过 TTL 免走
	time.Sleep(2 * time.Millisecond)
	_, hit4 := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit4, true, "重走重锚后 TTL 过期应再次免走")
}

// TestScanIndexTrustDoesNotSurviveReload N1：表实例重载（模拟重启进程）后
// trusted 恒 false——磁盘表只持久化 records，信任位不落盘，首走才重锚。
func TestScanIndexTrustDoesNotSurviveReload(t *testing.T) {
	defer finishIndexTest(t)
	dir := t.TempDir()
	writeFixtures(t, dir)

	SetIndexRoots([]string{dir})
	MarkIndexRootWatched([]string{dir})
	config.Set(func() types.AppConfig { return types.AppConfig{ScanCacheTTLMs: 1} })

	_, hit := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit, false, "首次应真走")
	// 模拟重启：删内存表实例（磁盘表文件保留）→ 懒开重载 → trusted=false
	indexTables.Delete(dir)
	time.Sleep(2 * time.Millisecond)
	second, hit2 := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit2, false, "重载后信任态不得跨进程采信（N1）")
	_ = second
	// 重载 + 首走重锚后恢复免走
	time.Sleep(2 * time.Millisecond)
	_, hit3 := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit3, true, "重载后零错误首走应重锚免走")
}

// TestScanIndexUnwatchedCapFallsBackToScanTTL 非 watcher 根：信任窗 = scanTTL()
// （外部变更探测零回归）；watched 根 15min 长窗不受影响（对照同 fixture 组）。
func TestScanIndexUnwatchedCapFallsBackToScanTTL(t *testing.T) {
	defer finishIndexTest(t)
	ResetScanIndexStats()
	watchedDir := t.TempDir()
	plainDir := t.TempDir()
	writeFixtures(t, watchedDir)
	writeFixtures(t, plainDir)

	SetIndexRoots([]string{watchedDir, plainDir})
	MarkIndexRootWatched([]string{watchedDir}) // plainDir 未标 watched
	config.Set(func() types.AppConfig { return types.AppConfig{ScanCacheTTLMs: 1} })

	for _, d := range []string{watchedDir, plainDir} {
		_, hit := ScanEntriesBrowseWithHit(d)
		testutil.Equal(t, hit, false, "%s 首次应真走", d)
	}
	time.Sleep(3 * time.Millisecond) // 双表均 TTL 过期

	// watched 根：15min 窗 → 免走
	_, hit := ScanEntriesBrowseWithHit(watchedDir)
	testutil.Equal(t, hit, true, "watched 根超 scanTTL 未超 indexTrustCap 应免走")
	// 未 watched 根：信任窗 = scanTTL() 已过期 → 必须重走
	_, hit = ScanEntriesBrowseWithHit(plainDir)
	testutil.Equal(t, hit, false, "未监控根信任窗取 scanTTL()，过期后应重走")
}

// TestScanIndexCommitGates 维护门白盒：快照推进（walk 期间被失效）与条目级错误
// 计数 >0 均整体放弃维护（不 upsert/prune/刷锚/落盘）——失败结果不得当成功固化。
func TestScanIndexCommitGates(t *testing.T) {
	defer finishIndexTest(t)
	dir := t.TempDir()
	writeFixtures(t, dir)

	SetIndexRoots([]string{dir})
	MarkIndexRootWatched([]string{dir})
	config.Set(func() types.AppConfig { return types.AppConfig{ScanCacheTTLMs: 1} })

	tab := ScanIndexFor(dir)
	_, hit := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit, false, "首走 hit=true")
	snap := func() map[string]scanIndexRecord {
		tab.mu.Lock()
		defer tab.mu.Unlock()
		m := make(map[string]scanIndexRecord, len(tab.records))
		for k, v := range tab.records {
			m[k] = v
		}
		return m
	}
	committed := snap()
	testutil.Equal(t, len(committed), 3, "零错误收尾应 upsert 3 条")
	entries := entryListFromDir(t, dir)

	// 门 1：快照推进（MarkWalkStart 后、CommitWalk 前被定向失效）→ 整体放弃
	tab.MarkWalkStart()
	InvalidatePath(dir)
	tab.CommitWalk(entries, 0)
	got := snap()
	testutil.Equal(t, mapsEqualRecords(got, committed), true, "快照推进后 CommitWalk 必须 no-op")
	// 门 2：条目级错误计数 >0（路径集不完整）→ 整体放弃
	tab.MarkWalkStart()
	tab.CommitWalk(entries, 1)
	got = snap()
	testutil.Equal(t, mapsEqualRecords(got, committed), true, "entryErrs>0 时 CommitWalk 必须 no-op")
	// 正对照：干净窗口零错误 → 正常维护
	os.WriteFile(filepath.Join(dir, "c.ysm"), []byte("model-c"), 0o644)
	tab.MarkWalkStart()
	tab.CommitWalk(append(entries, types.ModelEntry{Name: "c.ysm", Path: filepath.Join(dir, "c.ysm")}), 0)
	got = snap()
	testutil.Equal(t, len(got), 4, "干净窗口应 upsert 至 4 条")
}

// TestScanIndexPruneSelfHeal 残面（S2-4）：信任窗内外部删/增条目以旧记录服务
// （幽灵/缺失条目 ≤cap 窗内可见）；重走收尾按路径集剪枝自愈。
func TestScanIndexPruneSelfHeal(t *testing.T) {
	defer finishIndexTest(t)
	dir := t.TempDir()
	writeFixtures(t, dir)

	SetIndexRoots([]string{dir})
	MarkIndexRootWatched([]string{dir})
	config.Set(func() types.AppConfig { return types.AppConfig{ScanCacheTTLMs: 1} })

	_, hit := ScanEntriesBrowseWithHit(dir)
	testutil.Equal(t, hit, false, "首走 hit=true")
	// 外部变更（无失效事件）：删 b.ysm、增 c.ysm
	os.Remove(filepath.Join(dir, "sub", "b.ysm"))
	os.WriteFile(filepath.Join(dir, "c.ysm"), []byte("model-c"), 0o644)
	time.Sleep(2 * time.Millisecond)

	// 残面：快路径仍按旧记录服务（含幽灵 b.ysm，缺 c.ysm）
	ghosts, _ := ScanEntriesBrowseWithHit(dir)
	ghostSet := map[string]bool{}
	for _, e := range ghosts {
		ghostSet[e.Path] = true
	}
	testutil.Equal(t, ghostSet[filepath.Join(dir, "sub", "b.ysm")], true, "残面语义：信任窗内外部删除的条目仍按旧记录展示")
	testutil.Equal(t, ghostSet[filepath.Join(dir, "c.ysm")], false, "残面语义：信任窗内外部新增的条目不可见")

	// 重走（定向失效破信任）→ 剪枝自愈：幽灵 b.ysm 被删、c.ysm 入库
	InvalidatePath(dir)
	time.Sleep(2 * time.Millisecond)
	fresh, _ := ScanEntriesBrowseWithHit(dir)
	freshSet := map[string]bool{}
	for _, e := range fresh {
		freshSet[e.Path] = true
	}
	testutil.Equal(t, freshSet[filepath.Join(dir, "sub", "b.ysm")], false, "重走收尾应剪枝外部删除的条目")
	testutil.Equal(t, freshSet[filepath.Join(dir, "c.ysm")], true, "重走应入库新增条目")
	// 磁盘表同步自愈
	tab := ScanIndexFor(dir)
	tab.mu.Lock()
	_, ghostStillThere := tab.records[filepath.Join(dir, "sub", "b.ysm")]
	testutil.Equal(t, ghostStillThere, false, "剪枝后磁盘表仍含幽灵条目")
	tab.mu.Unlock()
}

// 辅助：列目录现存条目（维护门正对照用）
func entryListFromDir(t *testing.T, dir string) []types.ModelEntry {
	t.Helper()
	entries, _ := ScanEntriesBrowseWithHit(dir)
	return entries
}

// mapsEqualRecords 记录表内容相等（忽略插入序）
func mapsEqualRecords(a, b map[string]scanIndexRecord) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if bv, ok := b[k]; !ok || bv != v {
			return false
		}
	}
	return true
}
