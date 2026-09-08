package scanner

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// BenchmarkScanEntriesCold measures the complete production scan path. Running
// it with -tags rust_backend exercises the embedded Rust bridge; without the
// tag it provides the Go baseline against the same generated model tree.
func BenchmarkScanEntriesCold(b *testing.B) {
	const (
		fileCount = 2000
		dirCount  = 20
	)

	root := b.TempDir()
	payload := bytes.Repeat([]byte("YSM scanner benchmark payload\n"), 128)
	for i := 0; i < fileCount; i++ {
		dir := filepath.Join(root, fmt.Sprintf("group-%02d", i%dirCount))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatal(err)
		}
		path := filepath.Join(dir, fmt.Sprintf("model-%04d.ysm", i))
		if err := os.WriteFile(path, payload, 0o644); err != nil {
			b.Fatal(err)
		}
	}

	b.ReportAllocs()
	b.SetBytes(int64(fileCount * len(payload)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		InvalidateCache()
		b.StartTimer()

		entries := ScanEntries(root)
		if len(entries) != fileCount {
			b.Fatalf("ScanEntries returned %d entries, want %d", len(entries), fileCount)
		}
	}
}

// BenchmarkScanEntriesWarm 缓存热路径：预热一次冷扫把结果 Store 进 30s TTL 缓存后，
// 连续读缓存不再走盘。与 BenchmarkScanEntriesCold（每轮 InvalidateCache 冷扫）并跑
// （go test -bench ScanEntries -benchmem）可量化 TTL 收益：warm 应远快于 cold 且
// 零文件 I/O 分配。命中判定用 ScanEntriesWithHit；TTL 过期/他方 InvalidateCache
// 导致的 cache miss 只记录不 fail（重扫本身仍是正确行为）。
func BenchmarkScanEntriesWarm(b *testing.B) {
	const (
		fileCount = 2000
		dirCount  = 20
	)

	root := b.TempDir()
	payload := bytes.Repeat([]byte("YSM scanner benchmark payload\n"), 128)
	for i := 0; i < fileCount; i++ {
		dir := filepath.Join(root, fmt.Sprintf("group-%02d", i%dirCount))
		if err := os.MkdirAll(dir, 0o755); err != nil {
			b.Fatal(err)
		}
		path := filepath.Join(dir, fmt.Sprintf("model-%04d.ysm", i))
		if err := os.WriteFile(path, payload, 0o644); err != nil {
			b.Fatal(err)
		}
	}

	// 预热（计时外）：走一次冷扫，结果 Store 进 30s TTL 缓存
	entries := ScanEntries(root)
	if len(entries) != fileCount {
		b.Fatalf("预热 ScanEntries returned %d entries, want %d", len(entries), fileCount)
	}
	if _, hit := ScanEntriesWithHit(root); !hit {
		b.Fatal("预热后应命中 30s TTL 缓存，hit=false")
	}

	b.ReportAllocs()
	b.SetBytes(int64(fileCount * len(payload)))
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		entries, hit := ScanEntriesWithHit(root)
		if len(entries) != fileCount {
			b.Fatalf("ScanEntries returned %d entries, want %d", len(entries), fileCount)
		}
		if !hit {
			b.Logf("iteration %d: cache miss（TTL 过期或被失效），本轮为冷扫", i)
		}
	}
}
