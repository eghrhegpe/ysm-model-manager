package scanner

// scan_engine_test.go — 引擎归属记账 + 「强制 Go」开关（ADR-262 D3 跨引擎对照）。
//
// 无需 rust_backend 构建即可测：`rustScanHook` 是既有的「引擎替身」注入点（生产恒 nil），
// 用它制造 handled=true 分支，再断言归属计数与开关压制效果。真 Rust 的整树对照由
// `//go:build rust_backend` 的用例负责（见 scan_engine_rust_test.go）。

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

func TestScanEngineStats_AttributesRustOnlyWhenHandled(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(dir, "hero.ysm"), "hero")

	// Rust 替身：handled=true → 应记 Rust，且不得走 Go walk
	setRustScanHook(func(string) ([]types.ModelEntry, bool, bool) {
		return []types.ModelEntry{{Path: filepath.Join(dir, "hero.ysm"), Name: "hero", Ext: ".ysm"}}, true, true
	})
	defer setRustScanHook(nil)

	ResetScanEngineStats()
	InvalidateCache()
	_ = ScanEntries(dir)
	got := ScanEngineStats()
	if got.Rust != 1 {
		t.Errorf("Rust 真处理过应记 1, got %+v", got)
	}
	if got.GoWalk != 0 {
		t.Errorf("Rust 已处理时不该走 Go walk, got %+v", got)
	}

	// 替身返回 handled=false（= 运行期不可用，生产会静默回退）→ 必须记 Go walk，不记 Rust
	setRustScanHook(func(string) ([]types.ModelEntry, bool, bool) { return nil, false, false })
	ResetScanEngineStats()
	InvalidateCache()
	_ = ScanEntries(dir)
	got = ScanEngineStats()
	if got.GoWalk != 1 || got.Rust != 0 {
		t.Errorf("handled=false 应归 Go walk（不得记到 Rust 头上）, got %+v", got)
	}
}

func TestForceGoEngine_SuppressesRustPath(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(dir, "hero.ysm"), "hero")

	called := false
	setRustScanHook(func(string) ([]types.ModelEntry, bool, bool) {
		called = true
		return []types.ModelEntry{{Path: filepath.Join(dir, "hero.ysm")}}, true, true
	})
	defer setRustScanHook(nil)

	SetForceGoEngine(true)
	defer SetForceGoEngine(false)
	if !ForceGoEngine() {
		t.Fatal("开关应可读回")
	}

	ResetScanEngineStats()
	InvalidateCache()
	entries := ScanEntries(dir)
	if called {
		t.Error("强制 Go 时不得触碰 Rust 路径（钩子被压制）——否则「对照」的 Go 端不纯")
	}
	got := ScanEngineStats()
	if got.GoWalk != 1 || got.Rust != 0 {
		t.Errorf("强制 Go 应记 1 次 walk、0 次 Rust, got %+v", got)
	}
	if len(entries) != 1 {
		t.Errorf("强制 Go 仍应产出结果, got %d", len(entries))
	}

	// 复位后必须完全恢复生产分发（开关不得有残留副作用）
	SetForceGoEngine(false)
	ResetScanEngineStats()
	InvalidateCache()
	_ = ScanEntries(dir)
	if !called {
		t.Error("复位后应恢复 Rust 分发")
	}
	if got := ScanEngineStats(); got.Rust != 1 || got.GoWalk != 0 {
		t.Errorf("复位后应记 Rust, got %+v", got)
	}
}
