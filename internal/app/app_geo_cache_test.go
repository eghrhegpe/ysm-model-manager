// ===== geoCache 几何分析结果缓存组件测试 =====
// 覆盖：命中复用 / 文件变动(modtime/size)失效 / 不可 stat 不缓存 / Clear 失效。
package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// fakeModel 测试用几何结果
func fakeModel(bones int) types.BedrockModel {
	return types.BedrockModel{BoneCount: bones}
}

// TestGeoCache_HitReusesResult: 同一 unmodified 文件两次 Get 只算一次
func TestGeoCache_HitReusesResult(t *testing.T) {
	c := newGeoCache()
	p := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(p, []byte("geo"), 0o644); err != nil {
		testutil.NoError(t, err)
	}

	calls := 0
	compute := func() types.BedrockModel {
		calls++
		return fakeModel(5)
	}

	got1 := c.Get(p, compute)
	got2 := c.Get(p, compute)

	if calls != 1 {
		t.Fatalf("缓存命中应只 compute 1 次，实际 %d", calls)
	}
	if got1.BoneCount != 5 || got2.BoneCount != 5 {
		t.Errorf("命中应返回缓存值，got1=%d got2=%d", got1.BoneCount, got2.BoneCount)
	}
	if _, ok := c.Load(p); !ok {
		t.Errorf("缓存应已写入")
	}
}

// TestGeoCache_ModTimeChangeInvalidates: mtime 变化后重新 compute
func TestGeoCache_ModTimeChangeInvalidates(t *testing.T) {
	c := newGeoCache()
	p := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(p, []byte("v1"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	c.Get(p, func() types.BedrockModel { return fakeModel(1) })

	time.Sleep(2 * time.Second) // 确保 mtime 前进（部分 FS 秒级精度）
	if err := os.WriteFile(p, []byte("v2"), 0o644); err != nil {
		testutil.NoError(t, err)
	}

	calls := 0
	got := c.Get(p, func() types.BedrockModel { calls++; return fakeModel(9) })
	if calls != 1 {
		t.Fatalf("mtime 变化应重新 compute，实际 calls=%d", calls)
	}
	if got.BoneCount != 9 {
		t.Errorf("失效后应返回新值 9，got %d", got.BoneCount)
	}
}

// TestGeoCache_SizeChangeInvalidates: size 变化（同 mtime 不可达时）重新 compute
func TestGeoCache_SizeChangeInvalidates(t *testing.T) {
	c := newGeoCache()
	p := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(p, []byte("short"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	c.Get(p, func() types.BedrockModel { return fakeModel(1) })

	// 同字节数不同内容（mtime 可能不变，size 不同也应失效）
	if err := os.WriteFile(p, []byte("longer"), 0o644); err != nil {
		testutil.NoError(t, err)
	}

	calls := 0
	c.Get(p, func() types.BedrockModel { calls++; return fakeModel(7) })
	if calls != 1 {
		t.Fatalf("size 变化应重新 compute，实际 calls=%d", calls)
	}
}

// TestGeoCache_UnstatableNotCached: 不可 stat（不存在）不缓存、每次 compute
func TestGeoCache_UnstatableNotCached(t *testing.T) {
	c := newGeoCache()
	p := filepath.Join(t.TempDir(), "ghost.ysm") // 文件不存在
	calls := 0
	c.Get(p, func() types.BedrockModel { calls++; return fakeModel(0) })
	c.Get(p, func() types.BedrockModel { calls++; return fakeModel(0) })
	if calls != 2 {
		t.Fatalf("不可 stat 文件每次都应 compute，实际 calls=%d", calls)
	}
	if _, ok := c.Load(p); ok {
		t.Errorf("不可 stat 文件不应写入缓存")
	}
}

// TestGeoCache_EmptyResultNotCached: 解析失败（空结果，BoneCount==0）不缓存、每次重试。
// 锐评 2026-10-09：原实现无条件缓存空结果——.ysm WASM 解码临时挂起被固化，模型会在后续
// 搜索里「永久消失」直到 ClearScanCache（假绿）。改为空结果不缓存，成功结果仍正常缓存。
func TestGeoCache_EmptyResultNotCached(t *testing.T) {
	c := newGeoCache()
	p := filepath.Join(t.TempDir(), "bad.ysm")
	if err := os.WriteFile(p, []byte("geo"), 0o644); err != nil {
		t.Error(err)
		return
	}
	calls := 0
	c.Get(p, func() types.BedrockModel { calls++; return fakeModel(0) })
	c.Get(p, func() types.BedrockModel { calls++; return fakeModel(0) })
	if calls != 2 {
		t.Errorf("空结果每次都应重试 compute，实际 calls=%d", calls)
		return
	}
	if _, ok := c.Load(p); ok {
		t.Errorf("空结果不应写入缓存")
	}
	// 恢复成功结果后应正常缓存并复用（不影响 Hit 语义）
	if got := c.Get(p, func() types.BedrockModel { calls++; return fakeModel(7) }); got.BoneCount != 7 {
		t.Errorf("首次成功应返回新结果")
	}
	if got := c.Get(p, func() types.BedrockModel { calls++; return fakeModel(9) }); got.BoneCount != 7 {
		t.Errorf("成功结果应命中缓存并复用旧值，got=%d", got.BoneCount)
	}
}

// TestGeoCache_ClearInvalidatesAll: Clear 后所有键失效
func TestGeoCache_ClearInvalidatesAll(t *testing.T) {
	c := newGeoCache()
	p := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(p, []byte("geo"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	c.Get(p, func() types.BedrockModel { return fakeModel(3) })

	c.Clear()
	if _, ok := c.Load(p); ok {
		t.Errorf("Clear 后应无缓存")
	}
	calls := 0
	c.Get(p, func() types.BedrockModel { calls++; return fakeModel(3) })
	if calls != 1 {
		t.Fatalf("Clear 后应重新 compute，实际 calls=%d", calls)
	}
}

// TestEnsureGeoCache_NewAppInjects: NewApp 已注入 geoCache（非 nil）
func TestEnsureGeoCache_NewAppInjects(t *testing.T) {
	a := NewApp()
	if a.geoCache == nil {
		t.Fatal("NewApp 应注入 geoCache")
	}
	if got := a.ensureGeoCache(); got == nil {
		t.Fatal("ensureGeoCache 不应返回 nil")
	}
}

// TestEnsureGeoCache_RepoAppLazyInit: repoApp（不经 NewApp）兜底惰性初始化
func TestEnsureGeoCache_RepoAppLazyInit(t *testing.T) {
	a := repoApp(t, types.AppConfig{FilesRoot: t.TempDir()})
	if a.geoCache != nil {
		t.Fatal("repoApp 初始 geoCache 应为 nil")
	}
	if got := a.ensureGeoCache(); got == nil {
		t.Fatal("ensureGeoCache 兜底应惰性初始化")
	}
}

// ===== 字节预算封顶（2026-10-14 锐评 P2：原实现无界 map，base64 纹理驻留无上限）=====

// geoTestFile 造一个可 stat 的假几何文件（Get 需先 Stat 成功才走缓存写入路径）
func geoTestFile(t *testing.T, d, name string) string {
	t.Helper()
	p := filepath.Join(d, name)
	if err := os.WriteFile(p, []byte("geo"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

// texturedModel 带 base64 纹理的假几何结果（成本 = 纹理字节数，Bones/Animations 为空）
func texturedModel(bones int, tex string) types.BedrockModel {
	m := fakeModel(bones)
	m.Texture = tex
	return m
}

// TestGeoCache_BudgetEvictsFIFO: 超预算逐出最旧条目；预算内条目保留
func TestGeoCache_BudgetEvictsFIFO(t *testing.T) {
	c := newGeoCacheWithMax(100)
	d := t.TempDir()
	pa := geoTestFile(t, d, "a.ysm")
	pb := geoTestFile(t, d, "b.ysm")
	pc := geoTestFile(t, d, "c.ysm")

	c.Get(pa, func() types.BedrockModel { return texturedModel(1, strings.Repeat("a", 50)) })
	c.Get(pb, func() types.BedrockModel { return texturedModel(2, strings.Repeat("b", 50)) })
	if _, ok := c.Load(pa); !ok {
		t.Fatalf("预算内（50+50=100）不应逐出")
	}
	c.Get(pc, func() types.BedrockModel { return texturedModel(3, strings.Repeat("c", 50)) })

	if _, ok := c.Load(pa); ok {
		t.Errorf("超预算（150>100）应逐出最旧条目 a")
	}
	if _, ok := c.Load(pb); !ok {
		t.Errorf("b 应保留")
	}
	if _, ok := c.Load(pc); !ok {
		t.Errorf("c（新写入）应保留")
	}
	if c.totalBytes != 100 {
		t.Errorf("逐出后成本账应为 100，实际 %d", c.totalBytes)
	}
}

// TestGeoCache_OverBudgetSingleEntryKept: 单条超预算 → 逐出其余、只保留该条（不逐出到 0）
func TestGeoCache_OverBudgetSingleEntryKept(t *testing.T) {
	c := newGeoCacheWithMax(10)
	d := t.TempDir()
	pa := geoTestFile(t, d, "a.ysm")
	pb := geoTestFile(t, d, "b.ysm")

	c.Get(pa, func() types.BedrockModel { return texturedModel(1, strings.Repeat("a", 50)) })
	c.Get(pb, func() types.BedrockModel { return texturedModel(2, strings.Repeat("b", 50)) })

	if _, ok := c.Load(pa); ok {
		t.Errorf("a 应被逐出（b 单条已超预算）")
	}
	if _, ok := c.Load(pb); !ok {
		t.Errorf("单条超预算时该条自身仍保留（不逐出到 0）")
	}
}

// TestGeoCache_OverwriteRebooksCost: 同键覆盖（文件指纹变化重算）先扣旧成本再账新成本
func TestGeoCache_OverwriteRebooksCost(t *testing.T) {
	c := newGeoCacheWithMax(100)
	d := t.TempDir()
	p := filepath.Join(d, "m.ysm")
	if err := os.WriteFile(p, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Get(p, func() types.BedrockModel { return texturedModel(1, strings.Repeat("a", 50)) })

	// 文件内容变（size 变 → 指纹失效）→ 重算出 80 字节纹理：成本账应为 80 而非 50+80
	if err := os.WriteFile(p, []byte("v2-longer"), 0o644); err != nil {
		t.Fatal(err)
	}
	c.Get(p, func() types.BedrockModel { return texturedModel(2, strings.Repeat("a", 80)) })
	if c.totalBytes != 80 {
		t.Fatalf("覆盖后成本账应为 80（先扣旧 50 再账新 80），实际 %d", c.totalBytes)
	}

	// 再来一条 50 字节 → 总 130 > 100 → 逐出 m（槽 0，按当前值 80 扣账）
	q := geoTestFile(t, d, "q.ysm")
	c.Get(q, func() types.BedrockModel { return texturedModel(3, strings.Repeat("q", 50)) })
	if _, ok := c.Load(p); ok {
		t.Errorf("超预算应逐出 m")
	}
	if c.totalBytes != 50 {
		t.Errorf("逐出后成本账应为 50（q），实际 %d", c.totalBytes)
	}
}

// TestGeoCache_ClearResetsBookkeeping: Clear 复位逐出记账（order/head/totalBytes）
func TestGeoCache_ClearResetsBookkeeping(t *testing.T) {
	c := newGeoCacheWithMax(100)
	p := geoTestFile(t, t.TempDir(), "m.ysm")
	c.Get(p, func() types.BedrockModel { return texturedModel(1, strings.Repeat("a", 50)) })

	c.Clear()
	if c.totalBytes != 0 || c.head != 0 || len(c.order) != 0 {
		t.Errorf("Clear 后记账字段应全复位，实际 total=%d head=%d order=%d", c.totalBytes, c.head, len(c.order))
	}
}
