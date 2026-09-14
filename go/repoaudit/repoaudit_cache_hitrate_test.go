// ===== 缓存命中率（真口径）测试 =====
// 覆盖：命中率按「本仓库纹理内容哈希查缓存」统计，与 cache-verify 同口径。
package repoaudit

import (
	"fmt"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/texture_cache"
)

// setTempCacheDir 把 texture_cache.CacheDir 指向临时目录（测试隔离，不碰真实用户缓存）。
func setTempCacheDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	old := texture_cache.CacheDir
	t.Cleanup(func() { texture_cache.CacheDir = old })
	texture_cache.CacheDir = func() string { return dir }
	return dir
}

// TestAudit_CacheHitRate_ContentHashBased 钉住真命中率口径。
//
// 旧实现（已删）用「全局缓存目录文件数 / 本仓库纹理数」——分子是跨仓库共享的内容
// 哈希池、分母是本仓库纹理，不同源无因果关系，比例必然 >100% 被截断成假绿 100%。
// 现实现逐纹理算内容哈希后查缓存集，分子分母同源，命中率天然 ∈ [0,100]。
func TestAudit_CacheHitRate_ContentHashBased(t *testing.T) {
	cacheDir := setTempCacheDir(t)
	repo := t.TempDir()

	// 3 个纹理：前 2 个内容已缓存，第 3 个未缓存
	cached1 := filepath.Join(repo, "cached1.png")
	cached2 := filepath.Join(repo, "cached2.png")
	missed := filepath.Join(repo, "missed.png")
	testutil.WriteTestFileBytes(t, cached1, []byte("texture-content-A"))
	testutil.WriteTestFileBytes(t, cached2, []byte("texture-content-B"))
	testutil.WriteTestFileBytes(t, missed, []byte("texture-content-C"))

	// 按内容哈希真实写入缓存（模拟 KTX2 已压缩入库）
	for _, p := range []string{cached1, cached2} {
		hash, err := texture_cache.TextureHash(p)
		if err != nil {
			t.Fatalf("TextureHash(%s): %v", p, err)
		}
		if err := texture_cache.WriteCached(hash, []byte("fake-ktx2")); err != nil {
			t.Fatalf("WriteCached(%s): %v", p, err)
		}
	}
	_ = cacheDir

	result, err := Audit(repo)
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}

	if result.Cache.Hits != 2 {
		t.Errorf("命中数应为 2, got %d", result.Cache.Hits)
	}
	if result.Cache.Misses != 1 {
		t.Errorf("未命中数应为 1, got %d", result.Cache.Misses)
	}
	if result.Cache.CacheScanErrors != 0 {
		t.Errorf("探测失败数应为 0, got %d", result.Cache.CacheScanErrors)
	}
	want := 2.0 / 3.0 * 100
	if diff := result.Cache.HitRate - want; diff > 0.01 || diff < -0.01 {
		t.Errorf("命中率应为 %.2f%%, got %.2f%%", want, result.Cache.HitRate)
	}
	// 关键回归护栏：命中率不得超过 100（旧实现靠截断掩盖，说明口径错了）
	if result.Cache.HitRate > 100 || result.Cache.HitRate < 0 {
		t.Errorf("命中率越界（口径错误信号）: %f", result.Cache.HitRate)
	}
	if result.Cache.CacheSampled {
		t.Error("3 个纹理未达采样上限，不应标记 sampled")
	}
}

// TestAudit_CacheHitRate_NoTextures 无纹理时不报命中率（避免 0/0）。
func TestAudit_CacheHitRate_NoTextures(t *testing.T) {
	setTempCacheDir(t)
	repo := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(repo, "model.ysm"), []byte(`{"format_version":"1.16.0"}`))

	result, err := Audit(repo)
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if result.Cache.Hits != 0 || result.Cache.Misses != 0 || result.Cache.HitRate != 0 {
		t.Errorf("无纹理时命中率维度应全零, got hits=%d misses=%d rate=%f",
			result.Cache.Hits, result.Cache.Misses, result.Cache.HitRate)
	}
	if result.Cache.CacheSampled {
		t.Error("无纹理不应标记 sampled")
	}
}

// TestAudit_CacheHitRate_GlobalCacheDoesNotInflate 核心回归护栏：
// 缓存目录里堆满**与本仓库无关**的条目时，命中率不得被抬高。
// 旧实现分子取全局缓存文件数 → 缓存越满「命中率」越高直至假绿 100%。
func TestAudit_CacheHitRate_GlobalCacheDoesNotInflate(t *testing.T) {
	cacheDir := setTempCacheDir(t)
	repo := t.TempDir()

	// 仓库只有 1 个纹理，且**未**缓存
	only := filepath.Join(repo, "only.png")
	testutil.WriteTestFileBytes(t, only, []byte("uncached-content"))

	// 缓存目录里塞 50 个与本仓库无关的条目（模拟别的仓库/别的类型堆的 KTX2）
	for i := range 50 {
		if err := texture_cache.WriteCached(fmt.Sprintf("other-repo-hash-%02d", i), []byte("other-repo-ktx2")); err != nil {
			t.Fatalf("WriteCached: %v", err)
		}
	}
	_ = cacheDir

	result, err := Audit(repo)
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}

	// 旧实现此处会算出 50/1*100 → 截断成 100%（假绿）。正确口径：0 命中。
	if result.Cache.Hits != 0 {
		t.Errorf("无关缓存条目不得计入本仓库命中, got hits=%d", result.Cache.Hits)
	}
	if result.Cache.Misses != 1 {
		t.Errorf("未命中数应为 1, got %d", result.Cache.Misses)
	}
	if result.Cache.HitRate != 0 {
		t.Errorf("本仓库无任何缓存命中时命中率应为 0%%, got %.1f%%", result.Cache.HitRate)
	}
}

// TestMeasureCacheHitRate_SamplingLimit 注入极小采样上限，验证 sampled 标记生效
// 且统计基数被钳制到上限。
func TestMeasureCacheHitRate_SamplingLimit(t *testing.T) {
	setTempCacheDir(t)
	repo := t.TempDir()
	for i := range 5 {
		testutil.WriteTestFileBytes(t, filepath.Join(repo, string(rune('a'+i))+".png"), []byte("c"))
	}

	// 注入极小采样上限，验证 sampled 标记生效
	old := cacheHitSampleLimit
	t.Cleanup(func() { cacheHitSampleLimit = old })
	cacheHitSampleLimit = 2

	result, err := Audit(repo)
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if !result.Cache.CacheSampled {
		t.Error("纹理数达采样上限时应标记 CacheSampled（前端据此显示「≈」）")
	}
	// 采样后统计基数应等于上限（或更少）
	if got := result.Cache.Hits + result.Cache.Misses; got != 2 {
		t.Errorf("采样基数应为 2, got %d", got)
	}
}

// TestMeasureCacheHitRate_CacheDirUnavailable 缓存目录不可用（CacheDir()==""，
// 即配置根不可用）时全部纹理计为探测失败，而非静默当作「0% 命中」（故障 ≠ 未缓存）。
func TestMeasureCacheHitRate_CacheDirUnavailable(t *testing.T) {
	// 覆盖 CacheDir 使其返回 ""（模拟平台配置根不可用）
	oldDir := texture_cache.CacheDir
	t.Cleanup(func() { texture_cache.CacheDir = oldDir })
	texture_cache.CacheDir = func() string { return "" }

	repo := t.TempDir()
	for i := range 3 {
		testutil.WriteTestFileBytes(t, filepath.Join(repo, string(rune('a'+i))+".png"), []byte("c"))
	}

	result, err := Audit(repo)
	if err != nil {
		t.Fatalf("Audit: %v", err)
	}
	if result.Cache.CacheScanErrors != 3 {
		t.Errorf("缓存目录不可用时应全部计为探测失败, got scanErrs=%d", result.Cache.CacheScanErrors)
	}
	if result.Cache.Hits != 0 || result.Cache.Misses != 0 {
		t.Errorf("缓存目录不可用时不得产生命中/未命中数, got hits=%d misses=%d",
			result.Cache.Hits, result.Cache.Misses)
	}
	if result.Cache.HitRate != 0 {
		t.Errorf("缓存目录不可用时命中率应为 0（无统计基数）, got %.1f%%", result.Cache.HitRate)
	}
}
