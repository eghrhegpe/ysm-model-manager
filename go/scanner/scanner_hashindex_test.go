//go:build !rust_backend

// ===== 持久哈希索引 B1 集成测试（ADR-348：两阶段扫描投影·身份投影）=====
// 三段故事：冷扫全真算 → 失效重扫零哈希（索引扛住）→ 改一文件只重算一条；
// 外加开关路径（HashIndexDisabled = 旧全真算行为）
package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

func writeB1Fixture(t *testing.T, dir string) {
	t.Helper()
	for _, n := range []string{"a.ysm", "b.ysm", "c.ysm"} {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("content-"+n), 0o644); err != nil {
			testutil.NoError(t, err)
		}
	}
}

// hashByName2 条目 → name 查哈希的小助手（表驱动断言用）
func hashByName2(entries []types.ModelEntry, name string) (string, bool) {
	for _, e := range entries {
		if e.Name == name {
			return e.Hash, true
		}
	}
	return "", false
}

func TestScanEntries_HashIndexB1_ThreeScanStory(t *testing.T) {
	dir := t.TempDir()
	writeB1Fixture(t, dir)

	// 注入配置（B1 启用）：go/config 单持有点（同 scanTTL 先例）
	cfg := types.AppConfig{}
	config.Set(func() types.AppConfig { return cfg })
	t.Cleanup(func() { config.Set(nil) })
	ResetHashIndexStats()

	// 扫描 1（冷）：3 条全真算
	InvalidateCache()
	e1, _ := ScanEntriesWithHit(dir)
	testutil.Equal(t, len(e1), 3, "冷扫 3 条目")
	for _, e := range e1 {
		testutil.Equal(t, e.Hash != "", true, "冷扫真算哈希 %s", e.Name)
	}
	c1, h1 := HashIndexStatsSnapshot()
	testutil.Equal(t, c1, int64(3), "冷扫 3 次真哈希")
	testutil.Equal(t, h1, int64(0), "冷扫无指纹命中")

	// 扫描 2（缓存清掉 → 真重扫 + 哈希段走索引）：零新增真算
	InvalidateCache()
	e2, _ := ScanEntriesWithHit(dir)
	c2, h2 := HashIndexStatsSnapshot()
	testutil.Equal(t, c2, int64(3), "重扫未新增真哈希（索引扛住）")
	testutil.Equal(t, h2, int64(3), "3 条指纹命中")
	testutil.Equal(t, len(e2), 3, "重扫 3 条目")
	for i := range e1 {
		testutil.Equal(t, e2[i].Hash, e1[i].Hash, "索引供给哈希与真算一致（%s）", e1[i].Name)
	}

	// 扫描 3：b 内容变更（mtime 变）→ 只重算 b
	_ = os.WriteFile(filepath.Join(dir, "b.ysm"), []byte("content-b-v2"), 0o644)
	InvalidateCache()
	e3, _ := ScanEntriesWithHit(dir)
	c3, _ := HashIndexStatsSnapshot()
	testutil.Equal(t, c3, int64(4), "变更文件恰好 1 次真哈希")
	// 未变更条目哈希恒定（指纹命中，值 = 冷扫值）
	for _, e := range e1 {
		if e.Name == "b.ysm" {
			continue
		}
		got, ok := hashByName2(e3, e.Name)
		testutil.Equal(t, ok, true, "%s 在重扫结果中", e.Name)
		testutil.Equal(t, got, e.Hash, "未变更条目（%s）哈希恒定", e.Name)
	}
	// b 变更 → 新哈希非空且 ≠ 旧值
	old, _ := hashByName2(e1, "b.ysm")
	nw, ok := hashByName2(e3, "b.ysm")
	testutil.Equal(t, ok, true, "b 在重扫结果中")
	testutil.Equal(t, nw != "", true, "b 重算出新哈希")
	testutil.Equal(t, nw == old, false, "b 内容变更 → 哈希更新（不得残留旧值）")
}

// TestScanEntries_HashIndexDisabled_LegacyPath：HashIndexDisabled = 旧全真算行为（回退开关）
func TestScanEntries_HashIndexDisabled_LegacyPath(t *testing.T) {
	dir := t.TempDir()
	writeB1Fixture(t, dir)
	cfg := types.AppConfig{HashIndexDisabled: true}
	config.Set(func() types.AppConfig { return cfg })
	t.Cleanup(func() { config.Set(nil) })

	ResetHashIndexStats()
	InvalidateCache()
	_, _ = ScanEntriesWithHit(dir)
	c1, h1 := HashIndexStatsSnapshot()
	testutil.Equal(t, c1, int64(3), "禁用态冷扫全真算")
	testutil.Equal(t, h1, int64(0), "禁用态不走索引")

	// 同目录再扫一次：仍全真算（禁用 = 旧行为，不借索引）
	InvalidateCache()
	_, _ = ScanEntriesWithHit(dir)
	c2, _ := HashIndexStatsSnapshot()
	testutil.Equal(t, c2, int64(6), "禁用态重扫继续全真算（6 累计）")
}
