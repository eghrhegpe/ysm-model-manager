// ===== geoCache 几何分析结果缓存组件测试 =====
// 覆盖：命中复用 / 文件变动(modtime/size)失效 / 不可 stat 不缓存 / Clear 失效。
package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"ysm-model-manager/go/types"
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
		t.Fatal(err)
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
		t.Fatal(err)
	}
	c.Get(p, func() types.BedrockModel { return fakeModel(1) })

	time.Sleep(2 * time.Second) // 确保 mtime 前进（部分 FS 秒级精度）
	if err := os.WriteFile(p, []byte("v2"), 0o644); err != nil {
		t.Fatal(err)
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
		t.Fatal(err)
	}
	c.Get(p, func() types.BedrockModel { return fakeModel(1) })

	// 同字节数不同内容（mtime 可能不变，size 不同也应失效）
	if err := os.WriteFile(p, []byte("longer"), 0o644); err != nil {
		t.Fatal(err)
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

// TestGeoCache_ClearInvalidatesAll: Clear 后所有键失效
func TestGeoCache_ClearInvalidatesAll(t *testing.T) {
	c := newGeoCache()
	p := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(p, []byte("geo"), 0o644); err != nil {
		t.Fatal(err)
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
