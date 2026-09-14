package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/texture_cache"
)

// cache_test.go — cache-diag 写副作用的回归红线。
// 诊断命令是只读语义：历史上先误调 ClearCache() 全量清空用户缓存
// （P0 #1），改成 WriteCached 后又在写路径触发 maybePrune 后台淘汰
// （缓存超限时真实删除已编码 KTX2）。探针方案必须绕开整条写路径。

// TestWriteCacheProbe_NoIndexPollution：探针不得写入 .ktx2 索引条目。
// 进索引即意味着走了 WriteCached 语义 → 触发 maybePrune 淘汰。
func TestWriteCacheProbe_NoIndexPollution(t *testing.T) {
	cacheDir := withTempCache(t)

	path, err := writeCacheProbe([]byte("probe-payload"))
	if err != nil {
		t.Fatalf("writeCacheProbe: %v", err)
	}
	defer os.Remove(path)

	// ① 探针落在缓存目录内（否则测的不是缓存目录可写性）
	if filepath.Dir(path) != cacheDir {
		t.Errorf("探针应落在缓存目录 %s, 实际 %s", cacheDir, path)
	}
	// ② 内容可回读且一致
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("探针不可读: %v", err)
	}
	if string(got) != "probe-payload" {
		t.Errorf("探针内容不符: %q", got)
	}
	// ③ 不进索引：非 .ktx2 名 + HasCached 恒 false
	if strings.HasSuffix(path, ".ktx2") {
		t.Errorf("探针不得使用 .ktx2 扩展名（会进缓存索引并触发淘汰）: %s", path)
	}
	if ok, err := texture_cache.HasCached(filepath.Base(path)); err != nil || ok {
		t.Errorf("探针不得写入缓存索引: ok=%v err=%v", ok, err)
	}
}

// TestWriteCacheProbe_DirUnavailable：缓存目录不可用时须报错，不得静默通过。
func TestWriteCacheProbe_DirUnavailable(t *testing.T) {
	withTempCache(t)
	old := texture_cache.CacheDir
	texture_cache.CacheDir = func() string { return "" }
	defer func() { texture_cache.CacheDir = old }()

	if _, err := writeCacheProbe([]byte("x")); err == nil {
		t.Error("缓存目录不可用时 writeCacheProbe 应返回错误")
	}
}

// TestWriteCacheProbe_DistinctPaths：并发/重复调用不互相覆盖。
func TestWriteCacheProbe_DistinctPaths(t *testing.T) {
	withTempCache(t)

	seen := make(map[string]bool)
	for i := 0; i < 3; i++ {
		p, err := writeCacheProbe([]byte("p"))
		if err != nil {
			t.Fatalf("writeCacheProbe #%d: %v", i, err)
		}
		defer os.Remove(p)
		if seen[p] {
			t.Errorf("探针路径重复: %s", p)
		}
		seen[p] = true
	}
}
