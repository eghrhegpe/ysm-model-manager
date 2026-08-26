package scanner

// ===== tryRustScan 直接单测 =====
// 背景：tryRustScan 的 Rust handled 分支在普通单测（!rust_backend stub 恒 handled=false）
// 下不可达，覆盖率仅 33%。通过 rustScanHook 测试注入制造该路径，覆盖：
//   - handled=false 走 Go 路径
//   - handled=true + cacheable + 版本守卫通过 → 写缓存
//   - handled=true + cacheable 但版本已变 → 不写缓存
//   - handled=true + cacheable=false → 不写缓存
// 并验证 fl.entries 始终填充（供 waiter 取）。

import (
	"path/filepath"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

func resetRustScanHook() {
	rustScanHook = nil
}

func TestTryRustScan_NotHandled(t *testing.T) {
	InvalidateCache()
	defer resetRustScanHook()
	rustScanHook = func(string) ([]types.ModelEntry, bool, bool) {
		return nil, false, false
	}
	dir := t.TempDir()
	fl := &scanFlight{}
	entries, ok := tryRustScan(dir, cacheGen.Load(), 0, time.Now(), fl)
	if ok || entries != nil {
		t.Fatalf("handled=false 应返回 (nil,false), got ok=%v entries=%v", ok, entries)
	}
	if fl.entries != nil {
		t.Fatalf("handled=false 不应填充 fl.entries: %v", fl.entries)
	}
}

func TestTryRustScan_HandledStoresCache(t *testing.T) {
	InvalidateCache()
	defer resetRustScanHook()
	dir := t.TempDir()
	want := []types.ModelEntry{{Name: "a.ysm", Path: dir + "/a.ysm", Ext: ".ysm"}}
	rustScanHook = func(string) ([]types.ModelEntry, bool, bool) {
		return want, true, true
	}
	// 版本守卫通过：使用当前 cacheGen + 当前 keyVersion(0)
	fl := &scanFlight{}
	entries, ok := tryRustScan(dir, cacheGen.Load(), 0, time.Now(), fl)
	if !ok || len(entries) != 1 {
		t.Fatalf("handled=true 应返回 entries+true, got ok=%v entries=%v", ok, entries)
	}
	if len(fl.entries) != 1 {
		t.Fatalf("fl.entries 应填充, got %v", fl.entries)
	}
	// 缓存已写：直接读 scanCache
	v, exists := scanCache.Load(dir)
	if !exists {
		t.Fatal("handled+cacheable+版本通过应写缓存")
	}
	ce := v.(scanCacheEntry)
	if len(ce.entries) != 1 || ce.entries[0].Name != "a.ysm" {
		t.Fatalf("缓存内容不符: %+v", ce.entries)
	}
}

func TestTryRustScan_HandledVersionChangedSkipsCache(t *testing.T) {
	InvalidateCache()
	defer resetRustScanHook()
	dir := t.TempDir()
	want := []types.ModelEntry{{Name: "a.ysm", Path: dir + "/a.ysm", Ext: ".ysm"}}
	rustScanHook = func(string) ([]types.ModelEntry, bool, bool) {
		return want, true, true
	}
	// 捕获启动时版本后，invalidate 使 cacheGen 变化 → 守卫失败
	staleGen := cacheGen.Load()
	InvalidateCache()
	fl := &scanFlight{}
	entries, ok := tryRustScan(dir, staleGen, 0, time.Now(), fl)
	if !ok || len(entries) != 1 {
		t.Fatalf("版本已变仍应返回结果, got ok=%v entries=%v", ok, entries)
	}
	// 版本守卫失败 → 不写缓存
	if _, exists := scanCache.Load(dir); exists {
		t.Fatal("版本已变时不应写缓存")
	}
	// 但 fl.entries 仍填充（Rust 已处理，结果可被 waiter 消费）
	if len(fl.entries) != 1 {
		t.Fatalf("fl.entries 应填充: %v", fl.entries)
	}
}

func TestTryRustScan_NotCacheableSkipsStore(t *testing.T) {
	InvalidateCache()
	defer resetRustScanHook()
	dir := t.TempDir()
	want := []types.ModelEntry{{Name: "a.ysm", Path: dir + "/a.ysm", Ext: ".ysm"}}
	rustScanHook = func(string) ([]types.ModelEntry, bool, bool) {
		return want, false, true // cacheable=false
	}
	fl := &scanFlight{}
	entries, ok := tryRustScan(dir, cacheGen.Load(), 0, time.Now(), fl)
	if !ok || len(entries) != 1 {
		t.Fatalf("handled=true 应返回结果, got ok=%v entries=%v", ok, entries)
	}
	if _, exists := scanCache.Load(dir); exists {
		t.Fatal("cacheable=false 不应写缓存")
	}
	if len(fl.entries) != 1 {
		t.Fatalf("fl.entries 应填充: %v", fl.entries)
	}
}

func TestBuildRepoIndexEntries_RelPathForwardSlash(t *testing.T) {
	repo := filepath.Join(t.TempDir(), "repo")
	entries := []types.ModelEntry{
		{Name: "a.ysm", Path: filepath.Join(repo, "sub", "a.ysm"), Ext: ".ysm", Size: 10, Hash: "h1"},
		{Name: "root.ysm", Path: filepath.Join(repo, "root.ysm"), Ext: ".ysm", Size: 5, Hash: ""},
	}
	list := buildRepoIndexEntries(entries, repo)
	if len(list) != 2 {
		t.Fatalf("应产出 2 条, got %d", len(list))
	}
	// 正斜杠 + 相对路径
	if list[0].Path != "sub/a.ysm" {
		t.Fatalf("list[0].Path = %q, want %q", list[0].Path, "sub/a.ysm")
	}
	if list[0].Name != "a.ysm" || list[0].Size != 10 || list[0].Hash != "h1" {
		t.Fatalf("list[0] 字段不符: %+v", list[0])
	}
	if list[1].Path != "root.ysm" || list[1].Hash != "" {
		t.Fatalf("list[1] = %+v", list[1])
	}
}
