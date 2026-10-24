// ===== scanner_browse.go 回归锁（止血 2026-10-15 P0-1：全库哈希税）=====
// 覆盖：浏览投影与全量扫描的口径对账（同集合 / Hash 恒空 / Size 同源）、
// 双缓存隔离（browse 命中不污染 scanCache，反之亦然）、InvalidateCache/InvalidatePath
// 双缓存配对失效、取消路径不写缓存。
// 缓存测试不加 t.Parallel()——全局 cacheGen 失效会波及并发测试的在途扫描。
package scanner

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// browseFixture 标准夹具：a.ysm（hashable）/ c.ysm.ban（禁用恢复）/ ysm.json（白名单 json）
// + note.txt（不支持扩展名）+ .recycle/d.ysm（回收站排除）
func browseFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, f := range []string{"a.ysm", "c.ysm.ban", "ysm.json"} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte("data"), perm); err != nil {
			testutil.NoError(t, err)
		}
	}
	_ = os.WriteFile(filepath.Join(dir, "note.txt"), []byte("x"), perm)
	if err := os.MkdirAll(filepath.Join(dir, ".recycle"), 0755); err != nil {
		testutil.NoError(t, err)
	}
	_ = os.WriteFile(filepath.Join(dir, ".recycle", "d.ysm"), []byte("x"), perm)
	return dir
}

// 1. 过滤口径与全量扫描同集合（recycle 排除 / 扩展名白名单 / .ban 恢复 / ysm.json 放行），
// 唯一差异 = Hash 恒空（同步消费口径不变），Size/ModTime/Name 与全量同源
func TestScanEntriesBrowse_ParityNoHash(t *testing.T) {
	dir := browseFixture(t)
	full := ScanEntries(dir)
	browse := ScanEntriesBrowse(dir)

	testutil.Equal(t, len(full), len(browse), "浏览投影条目数应等于全量扫描")

	fullByPath := make(map[string]types.ModelEntry, len(full))
	for _, e := range full {
		fullByPath[e.Path] = e
	}
	for _, e := range browse {
		fe, ok := fullByPath[e.Path]
		// Equal 失败即 Goexit，守卫语义等价：下方 fe 字段比较仅在其通过后执行
		testutil.Equal(t, ok, true, "浏览条目 %s 不在全量扫描结果内（过滤口径漂移）", e.Path)
		if e.Name != fe.Name || e.Size != fe.Size || e.ModTime != fe.ModTime || e.Ext != fe.Ext {
			t.Errorf("浏览条目 %s 与全量扫描字段口径分歧: %+v vs %+v", e.Path, e, fe)
		}
		if e.Hash != "" {
			t.Errorf("浏览条目 %s Hash 应恒空（哈希税只在同步路径），got %q", e.Path, e.Hash)
		}
	}
	// 全量侧对照：ysm hashable，a.ysm 应有非空 SHA256（证分歧点存在且方向正确）
	for _, e := range full {
		if e.Name == "a.ysm" && e.Hash == "" {
			t.Error("全量扫描 a.ysm 应回填 SHA256（同步口径不受浏览投影影响）")
		}
	}
}

// 2. 双缓存隔离：browseCache 命中不写 scanCache（防「无哈希条目入同步缓存」红线），
// scanCache 写入不影响 browseCache 命中态；InvalidateCache 两侧同清
func TestScanEntriesBrowse_CacheIsolation(t *testing.T) {
	dir := browseFixture(t)
	if _, hit := ScanEntriesBrowseWithHit(dir); hit {
		t.Error("browse 首次应 miss")
	}
	if _, hit := ScanEntriesBrowseWithHit(dir); !hit {
		t.Error("browse 二次应命中 browseCache")
	}
	// 全量缓存独立：browse 命中不算全量命中
	if _, hit := ScanEntriesWithHit(dir); hit {
		t.Error("browse 命中不应污染 scanCache（全量应 miss）")
	}
	// 全量写入后 browse 缓存不受影响
	if _, hit := ScanEntriesBrowseWithHit(dir); !hit {
		t.Error("全量扫描写入不应影响 browseCache 命中态")
	}
	InvalidateCache()
	if _, hit := ScanEntriesBrowseWithHit(dir); hit {
		t.Error("InvalidateCache 应失效 browseCache")
	}
	if _, hit := ScanEntriesWithHit(dir); hit {
		t.Error("InvalidateCache 应失效 scanCache")
	}
}

// 3. InvalidatePath 双缓存配对失效（写面派生闸口径：一条失效入口两侧同清）
func TestInvalidatePath_Browse(t *testing.T) {
	dir := browseFixture(t)
	_, _ = ScanEntriesBrowseWithHit(dir)
	_ = os.WriteFile(filepath.Join(dir, "new.ysm"), []byte("x"), perm)

	InvalidatePath(dir)

	browse := ScanEntriesBrowse(dir)
	found := false
	for _, e := range browse {
		if e.Name == "new.ysm" {
			found = true
		}
	}
	if !found {
		t.Error("InvalidatePath 后浏览投影应重扫到新文件")
	}
	// 同步口径侧同失效：全量重扫与浏览重扫条目数一致（两缓存同清）
	full := ScanEntries(dir)
	testutil.Equal(t, len(full), len(browse), "失效后双缓存重扫结果应同集合")
}

// 4. 取消路径（ADR-197 对齐）：已取消 ctx 不写缓存——部分结果进缓存会污染 30s 窗口
func TestScanEntriesBrowse_CtxCancelledNotCached(t *testing.T) {
	dir := browseFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, hit := ScanEntriesBrowseWithHitCtx(ctx, dir); hit {
		t.Error("已取消扫描不应命中缓存")
	}
	// 未取消首扫（真实目录枚举）→ 若取消结果被误写入，此处会命中
	if _, hit := ScanEntriesBrowseWithHitCtx(context.Background(), dir); hit {
		t.Error("已取消扫描的部分结果不得写入 browseCache（ADR-197 口径）")
	}
}
