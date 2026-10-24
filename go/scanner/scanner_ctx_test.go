package scanner

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// TestScanEntriesLiteCtx_Cancelled：预取消的 ctx 立即中止 walk，不产出条目（ADR-197）。
func TestScanEntriesLiteCtx_Cancelled(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"a.ysm", "b.ysm", "c.ysm"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			testutil.NoError(t, err)
		}
	}
	// 未取消：应有结果
	got := ScanEntriesLiteCtx(context.Background(), dir)
	testutil.Equal(t, len(got) != 0, true, "Background ctx 应正常扫描, got %d 条", len(got))
	// 预取消：中止 walk，无条目
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	gotCancelled := ScanEntriesLiteCtx(ctx, dir)
	testutil.Equal(t, len(gotCancelled), 0, "预取消 ctx 应返回空, got %d 条", len(gotCancelled))
}

// TestScanEntriesWithHitCtx_CancelledNotCached：取消产生的部分结果不写入缓存——
// 恢复用 Background 重扫时必须真扫（否则 30s TTL 内读到取消污染的空结果）。
func TestScanEntriesWithHitCtx_CancelledNotCached(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "m.ysm"), []byte("x"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	gotCtx, _ := ScanEntriesWithHitCtx(ctx, dir)
	testutil.Equal(t, len(gotCtx), 0, "预取消 ctx 应返回空, got %d 条", len(gotCtx))
	got, hit := ScanEntriesWithHit(dir)
	// OR 型复合条件拆序贯
	testutil.Equal(t, hit, false, "取消后重扫不应命中缓存: hit=%v len=%d", hit, len(got))
	testutil.Equal(t, len(got), 1, "取消后重扫不应命中缓存: hit=%v len=%d", hit, len(got))
}
