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
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
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
	if e, ok := byName["[作者C]模型.ysm"]; !ok || e.Hash != "" || e.Size != 0 {
		t.Fatalf("活跃 ysm 应在列且无哈希无 Size: %+v", e)
	}
	if e, ok := byName["[作者C]禁用.ysm.ban"]; !ok || e.Ext != ".ysm" {
		t.Fatalf("禁用文件应恢复扩展名 .ysm: %+v", e)
	}
	if e, ok := byName["[作者D]模型"]; !ok || e.Ext != ".json" {
		t.Fatalf("ysm.json 条目 Name 应取目录基名: %+v", e)
	}
}

func TestScanEntriesLite_BypassesCacheBothWays(t *testing.T) {
	dirA := t.TempDir()
	if err := os.WriteFile(filepath.Join(dirA, "[甲]a.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := ScanEntries(dirA); len(got) != 1 {
		t.Fatalf("前置全量扫描应 1 条，实际 %d", len(got))
	}
	if err := os.WriteFile(filepath.Join(dirA, "[乙]b.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if cached, hit := ScanEntriesWithHit(dirA); !hit || len(cached) != 1 {
		t.Fatalf("全量路径应命中缓存返回 1 条, hit=%v n=%d", hit, len(cached))
	}
	if lite := ScanEntriesLite(dirA); len(lite) != 2 {
		t.Fatalf("轻量路径应绕过缓存见 2 条，实际 %d", len(lite))
	}
	dirB := t.TempDir()
	if err := os.WriteFile(filepath.Join(dirB, "[丙]c.ysm"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = ScanEntriesLite(dirB)
	if _, hit := ScanEntriesWithHit(dirB); hit {
		t.Fatal("轻量扫描结果不得写入共享 scanCache（无哈希条目会污染同步系统）")
	}
}
