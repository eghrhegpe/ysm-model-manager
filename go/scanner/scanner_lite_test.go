// ===== ScanEntriesLite 轻量扫描测试（作者提取专用路径）=====
// 覆盖：与全量扫描同口径的过滤（扩展名/禁用恢复/recycle/.github/ysm.json）、
// 不读文件信息不计算哈希（Size/Hash 恒零值）、不读不写共享 scanCache（双向隔离）。
package scanner

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

func TestScanEntriesLite_FilteringParity(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	write := func(rel string) {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			testutil.NoError(t, err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			testutil.NoError(t, err)
		}
	}
	write("[作者C]模型.ysm")
	write("[作者C]禁用.ysm.ban")
	write("[作者D]模型/ysm.json")
	write("notes.txt")
	write(".github/workflow.yml")
	write(".recycle/[旧]模型.ysm")
	write("[禁]目录.disabled/x.ysm")

	got := ScanEntriesLite(dir)
	byName := map[string]types.ModelEntry{}
	for _, e := range got {
		byName[e.Name] = e
	}
	testutil.Equal(t, len(got), 3, "应 3 个条目")
	e, ok := byName["[作者C]模型.ysm"]
	// OR 型复合条件拆序贯（ok 守卫在前——Equal 失败即 Goexit，后续字段断言仅在其通过后执行）
	testutil.Equal(t, ok, true, "活跃 ysm 应在列且无哈希无 Size: %+v", e)
	testutil.Equal(t, e.Hash, "", "活跃 ysm 应无哈希: %+v", e)
	testutil.Equal(t, e.Size, 0, "活跃 ysm 应无 Size: %+v", e)
	e2, ok2 := byName["[作者C]禁用.ysm.ban"]
	testutil.Equal(t, ok2, true, "禁用文件应在列: %+v", e2)
	testutil.Equal(t, e2.Ext, ".ysm", "禁用文件应恢复扩展名 .ysm: %+v", e2)
	e3, ok3 := byName["[作者D]模型"]
	testutil.Equal(t, ok3, true, "ysm.json 条目应在列: %+v", e3)
	testutil.Equal(t, e3.Ext, ".json", "ysm.json 条目 Name 应取目录基名: %+v", e3)
}

func TestScanEntriesLite_BypassesCacheBothWays(t *testing.T) {
	dirA := t.TempDir()
	if err := os.WriteFile(filepath.Join(dirA, "[甲]a.ysm"), []byte("x"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	got := ScanEntries(dirA)
	testutil.Equal(t, len(got), 1, "前置全量扫描应 1 条，实际 %d", len(got))
	if err := os.WriteFile(filepath.Join(dirA, "[乙]b.ysm"), []byte("x"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	cached, hit := ScanEntriesWithHit(dirA)
	// OR 型复合条件拆序贯
	testutil.Equal(t, hit, true, "全量路径应命中缓存返回 1 条, hit=%v n=%d", hit, len(cached))
	testutil.Equal(t, len(cached), 1, "全量路径应命中缓存返回 1 条, hit=%v n=%d", hit, len(cached))
	lite := ScanEntriesLite(dirA)
	testutil.Equal(t, len(lite), 2, "轻量路径应绕过缓存见 2 条，实际 %d", len(lite))
	dirB := t.TempDir()
	if err := os.WriteFile(filepath.Join(dirB, "[丙]c.ysm"), []byte("x"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	_ = ScanEntriesLite(dirB)
	_, hitB := ScanEntriesWithHit(dirB)
	testutil.Equal(t, hitB, false, "轻量扫描结果不得写入共享 scanCache（无哈希条目会污染同步系统）")
}
