// 锐评 2026-10-16 回归锁：「不消费 Hash 的调用方不得走带哈希扫描入口」。
//
// 病灶：止血 2026-10-15 把树切到浏览投影（ScanEntriesBrowse，无 SHA256）时，
// SearchModels 与创作者头像链仍留在哈希入口——冷搜索/冷开创作者频道时逐文件读
// 全量字节算 SHA256，而两条链的返回值从头到尾不碰 ModelEntry.Hash（哈希只服务
// go/sync 内容匹配）。本锁把「没走哈希段」变成可回归的行为断言：
//   ① scanner 哈希索引真算计数增量 == 0（冷扫后 .ysm-hash-index.json 不存在——
//     带哈希路径收尾必 Save，浏览投影路径全程不触碰索引）；
//   ② 结果语义不缩水（分流/Type 派生仍生效，防「切了投影丢了刀 1 派生」）。
//
// ⚠️ 本文件测试**刻意不加 t.Parallel**：HashIndexStats 是包级全局计数，串行测试
// 体执行窗口与并行批次互斥（Go 调度语义），并行同族测试会污染增量断言。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// assertNoHashActivity 复位哈希计数 → 执行 fn → 断言「真算/免读盘命中」零增量
// 且本根从未落过哈希索引文件（双判据：计数防走哈希段，文件防绕过计数直写索引）。
func assertNoHashActivity(t *testing.T, root string, fn func()) {
	t.Helper()
	scanner.ResetHashIndexStats()
	comp0, hits0 := scanner.HashIndexStatsSnapshot()
	fn()
	comp1, hits1 := scanner.HashIndexStatsSnapshot()
	if comp1 != comp0 || hits1 != hits0 {
		t.Fatalf("本条链不应触发 SHA256 哈希段：真算增量 %d，索引命中增量 %d（判据：无哈希消费方走浏览投影，锐评 2026-10-16）",
			comp1-comp0, hits1-hits0)
	}
	if _, err := os.Stat(filepath.Join(root, scanner.HashIndexPath)); err == nil {
		t.Fatalf("扫描根出现 %s——带哈希路径才会创建/Save 该文件，本链必须走浏览投影", scanner.HashIndexPath)
	}
}

// TestSearchModels_ColdScanNoHashTax：冷搜索（关键词 + 数值条件全路径）不付哈希税。
func TestSearchModels_ColdScanNoHashTax(t *testing.T) {
	base := t.TempDir()
	ysmRoot := filepath.Join(base, "ysm", "models")
	if err := os.MkdirAll(ysmRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	writeYsmModelFixture(t, ysmRoot, "lockmodel", 2)
	writeYsmModelFixture(t, ysmRoot, "locktiny", 1)
	if err := os.WriteFile(filepath.Join(ysmRoot, "extra.ysm"), []byte("non-geometric-payload"), 0o644); err != nil {
		t.Fatal(err)
	}

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	assertNoHashActivity(t, base, func() {
		results := a.SearchModels(base, types.SearchFilters{MinBones: 1})
		// 数值条件路径不缩水：两个可解析几何条目必须经 Type 分流进分析器并命中
		// （切浏览投影后刀 1 的 Type 派生仍生效——enrichScanEntries 单点共用）。
		if len(results) < 2 {
			t.Fatalf("数值路径结果应 ≥2（两个几何 fixture），got %d", len(results))
		}
		for _, r := range results {
			if r.BoneCount < 1 {
				t.Fatalf("数值路径混入零骨骼结果：%+v", r)
			}
		}
	})
}

// TestBatchExtractCreatorAvatars_ColdScanNoHashTax：头像批量链冷扫不付哈希税
// （只消费 Name/Path/ModTime——ModTime 由浏览投影照常下发，Lite 入口才是零值陷阱）。
func TestBatchExtractCreatorAvatars_ColdScanNoHashTax(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "[avatarlock]model.ysm"), []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := scanApp(t, types.AppConfig{FilesRoot: base})
	assertNoHashActivity(t, root, func() {
		_, err := a.BatchExtractCreatorAvatars()
		if err != nil {
			t.Fatalf("BatchExtractCreatorAvatars: %v", err)
		}
	})
}
