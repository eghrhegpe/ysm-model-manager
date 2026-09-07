package texture_cache

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// setCacheDir 把 CacheDir 指向临时目录，测试结束自动还原
func setCacheDir(t *testing.T) string {
	t.Helper()
	old := CacheDir
	t.Cleanup(func() { CacheDir = old })
	dir := t.TempDir()
	CacheDir = func() string { return dir }
	return dir
}

// setLimits 覆盖淘汰阈值，测试结束自动还原
func setLimits(t *testing.T, maxBytes int64, maxAge, interval time.Duration) {
	t.Helper()
	oldBytes, oldAge, oldInterval := maxCacheBytes, maxEntryAge, pruneInterval
	t.Cleanup(func() {
		maxCacheBytes, maxEntryAge, pruneInterval = oldBytes, oldAge, oldInterval
	})
	SetCacheLimits(maxBytes, maxAge, interval)
}

// writeCacheFile 写一个缓存文件并设置 mtime（控制 TTL/容量排序）
func writeCacheFile(t *testing.T, dir, name string, data []byte, mod time.Time) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPrune_EmptyCacheDir(t *testing.T) {
	setCacheDir(t)
	setLimits(t, 1024, time.Hour, 0)
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 0 {
		t.Fatalf("空目录不应删除任何文件，got %d", res.RemovedCount)
	}
}

func TestPrune_CacheDirUnavailable(t *testing.T) {
	old := CacheDir
	t.Cleanup(func() { CacheDir = old })
	CacheDir = func() string { return "" }
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 0 {
		t.Fatalf("缓存目录不可用时应 no-op，got %d", res.RemovedCount)
	}
}

func TestPrune_SkipsNonKtx2(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, 0, 0) // 无容量上限、无 TTL：只应验证扩展名过滤
	writeCacheFile(t, dir, "aaa.ktx2", []byte("x"), time.Now())
	writeCacheFile(t, dir, "notes.txt", []byte("x"), time.Now().Add(-100*time.Hour))
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 0 {
		t.Fatalf("非 .ktx2 不应参与淘汰，got %d", res.RemovedCount)
	}
}

func TestPrune_OverCapacity_DeletesOldest(t *testing.T) {
	dir := setCacheDir(t)
	base := time.Now().Add(-time.Minute)
	// mtime 递增：aaa 最旧 → ccc 最新
	writeCacheFile(t, dir, "aaa.ktx2", make([]byte, 100), base)
	writeCacheFile(t, dir, "bbb.ktx2", make([]byte, 200), base.Add(time.Minute))
	writeCacheFile(t, dir, "ccc.ktx2", make([]byte, 300), base.Add(2*time.Minute))
	// 上限 400：总 600 超限 → 删 aaa(100) 剩 500 仍超 → 删 bbb(200) 剩 300 ≤400
	setLimits(t, 400, 0, 0)
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 2 {
		t.Fatalf("应删 2 个最旧文件，got %d", res.RemovedCount)
	}
	if res.FreedBytes != 300 {
		t.Fatalf("应释放 300B，got %d", res.FreedBytes)
	}
	if res.Remaining != 300 {
		t.Fatalf("剩余应为 300B，got %d", res.Remaining)
	}
	if _, err := os.Stat(filepath.Join(dir, "aaa.ktx2")); !os.IsNotExist(err) {
		t.Fatal("aaa 应被删（最旧）")
	}
	if _, err := os.Stat(filepath.Join(dir, "bbb.ktx2")); !os.IsNotExist(err) {
		t.Fatal("bbb 应被删")
	}
	if _, err := os.Stat(filepath.Join(dir, "ccc.ktx2")); err != nil {
		t.Fatal("ccc 应保留（最新）")
	}
}

func TestPrune_TTL_ExpiredRemoved_FreshKept(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, time.Hour, 0) // 1 小时 TTL，无容量上限
	writeCacheFile(t, dir, "old.ktx2", []byte("x"), time.Now().Add(-2*time.Hour))
	writeCacheFile(t, dir, "new.ktx2", []byte("x"), time.Now())
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 1 {
		t.Fatalf("应只删超龄的 1 个，got %d", res.RemovedCount)
	}
	if _, err := os.Stat(filepath.Join(dir, "old.ktx2")); !os.IsNotExist(err) {
		t.Fatal("old 应被删（超龄）")
	}
	if _, err := os.Stat(filepath.Join(dir, "new.ktx2")); err != nil {
		t.Fatal("new 应保留（新鲜）")
	}
}

func TestPrune_CombinedTTLAndCapacity(t *testing.T) {
	dir := setCacheDir(t)
	now := time.Now()
	// 一个超龄大文件 + 三个新鲜文件
	writeCacheFile(t, dir, "expired.ktx2", make([]byte, 500), now.Add(-2*time.Hour))
	writeCacheFile(t, dir, "f1.ktx2", make([]byte, 100), now)
	writeCacheFile(t, dir, "f2.ktx2", make([]byte, 100), now)
	writeCacheFile(t, dir, "f3.ktx2", make([]byte, 100), now)
	// TTL 1 小时先删 expired(500)；容量 150 再删最旧：f1(100) → 剩 200 仍超 → f2(100) → 剩 100
	setLimits(t, 150, time.Hour, 0)
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 3 {
		t.Fatalf("应删 3 个（1 超龄 + 2 超容量），got %d", res.RemovedCount)
	}
	if res.Remaining != 100 {
		t.Fatalf("剩余应为 100B，got %d", res.Remaining)
	}
}

func TestWriteCached_TriggersPrune(t *testing.T) {
	setCacheDir(t)
	setLimits(t, 250, 0, 0) // interval=0 → 每次写都触发；容量 250
	for i := 0; i < 4; i++ {
		if err := WriteCached(fmt.Sprintf("hash%d", i), make([]byte, 100)); err != nil {
			t.Fatal(err)
		}
	}
	// 每次写后 prune 到 ≤250：写满 4 个（400B）后应只剩最新的 2 个（200B）
	stats := GetCacheStats()
	if stats.FileCount != 2 {
		t.Fatalf("写路径自动淘汰后应剩 2 个，got %d", stats.FileCount)
	}
	if stats.TotalSize != 200 {
		t.Fatalf("剩余应 200B，got %d", stats.TotalSize)
	}
}

// failRemove 注入删除失败桩（P2 记账失真回归）
func failRemove(t *testing.T) {
	t.Helper()
	old := removeFile
	removeFile = func(string) error { return errors.New("injected delete failure") }
	t.Cleanup(func() { removeFile = old })
}

func TestPrune_RemoveFailure_NoFalseAccounting(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 100, 0, 0) // 容量 100，无 TTL
	writeCacheFile(t, dir, "aaa.ktx2", make([]byte, 80), time.Now())
	writeCacheFile(t, dir, "bbb.ktx2", make([]byte, 80), time.Now())
	failRemove(t) // 删除全部失败
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 0 {
		t.Fatalf("删除失败不应计数，got %d", res.RemovedCount)
	}
	if res.FreedBytes != 0 {
		t.Fatalf("删除失败不应虚报释放字节，got %d", res.FreedBytes)
	}
	// 删除失败不得低估 Remaining：总 160B 应如实保留
	if res.Remaining != 160 {
		t.Fatalf("删除失败后剩余应为 160B（不虚报），got %d", res.Remaining)
	}
	_ = dir
}

func TestPrune_TTLRemoveFailure_KeepsExpired(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, time.Hour, 0)
	writeCacheFile(t, dir, "old.ktx2", []byte("x"), time.Now().Add(-2*time.Hour))
	failRemove(t)
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 0 || res.FreedBytes != 0 {
		t.Fatalf("删除失败不应记账，got removed=%d freed=%d", res.RemovedCount, res.FreedBytes)
	}
	if _, err := os.Stat(filepath.Join(dir, "old.ktx2")); err != nil {
		t.Fatal("删除失败的超龄文件应留在磁盘")
	}
	// 超龄文件仍计入 Remaining（如实反映磁盘现状）
	if res.Remaining != 1 {
		t.Fatalf("剩余应含超龄未删文件（1B），got %d", res.Remaining)
	}
}

func TestPrune_OrphanTmp_ExpiredCleaned(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, time.Hour, 0) // 1 小时 TTL
	writeCacheFile(t, dir, "old.ktx2.tmp", []byte("x"), time.Now().Add(-2*time.Hour))
	writeCacheFile(t, dir, "fresh.ktx2.tmp", []byte("x"), time.Now())
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 1 {
		t.Fatalf("应清 1 个超龄 .tmp 残留，got %d", res.RemovedCount)
	}
	if _, err := os.Stat(filepath.Join(dir, "old.ktx2.tmp")); !os.IsNotExist(err) {
		t.Fatal("超龄 .tmp 残留应被清")
	}
	if _, err := os.Stat(filepath.Join(dir, "fresh.ktx2.tmp")); err != nil {
		t.Fatal("新鲜 .tmp 应保留（可能仍在写入）")
	}
}

func TestPrune_TmpNotCountedInCapacity(t *testing.T) {
	dir := setCacheDir(t)
	now := time.Now()
	writeCacheFile(t, dir, "a.ktx2", make([]byte, 100), now)
	writeCacheFile(t, dir, "b.ktx2", make([]byte, 100), now)
	writeCacheFile(t, dir, "partial.ktx2.tmp", make([]byte, 300), now)
	setLimits(t, 150, 0, 0) // 容量 150：ktx2 总 200 > 150 → 删最旧 a
	res, err := Prune()
	if err != nil {
		t.Fatal(err)
	}
	if res.RemovedCount != 1 {
		t.Fatalf("应只删 1 个 ktx2，got %d", res.RemovedCount)
	}
	if _, err := os.Stat(filepath.Join(dir, "a.ktx2")); !os.IsNotExist(err) {
		t.Fatal("a 应被容量淘汰删除")
	}
	if _, err := os.Stat(filepath.Join(dir, "partial.ktx2.tmp")); err != nil {
		t.Fatal("新鲜 .tmp 不应被容量淘汰删除")
	}
	// Remaining 只计 .ktx2（100B），不含 tmp
	if res.Remaining != 100 {
		t.Fatalf("剩余应只计 ktx2=100B，got %d", res.Remaining)
	}
}

// code_review 9e1a74a28 #4/#5（P3）：SetShutdownCtx/异步淘汰中止分支零测试——补取消
// ctx 跳过淘汰 + live ctx 正常淘汰两用例；SetShutdownCtx(context.TODO()) cleanup 复位全局
// （nil 真清除语义）防跨测试泄漏。interval>0 走后台 goroutine，轮询 pruneInFlight
// 复位作为 goroutine 结束标志。
func TestWriteCached_ShutdownCtx_Cancelled_SkipsPrune(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 100, 0, time.Hour)                      // interval>0 → 异步分支；容量 100 制造应淘汰场景
	lastPrune = time.Time{}                              // 清限频状态：interval=0 的前序测试会更新包级 lastPrune，
	t.Cleanup(func() { SetShutdownCtx(context.TODO()) }) // 不清则「距上次 < 间隔」跳过 → 不 fork goroutine
	// 预置超限旧文件（200B > 上限 100，正常容量淘汰会删它）
	writeCacheFile(t, dir, "old.ktx2", make([]byte, 200), time.Now().Add(-time.Hour))
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // 已取消：分叉的淘汰应立即放弃
	SetShutdownCtx(ctx)
	if err := WriteCached("newhash", make([]byte, 50)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for pruneInFlight.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := os.Stat(filepath.Join(dir, "old.ktx2")); err != nil {
		t.Fatalf("取消 ctx 后后台淘汰应放弃——旧文件不应被删: %v", err)
	}
}

func TestWriteCached_ShutdownCtx_Live_Prunes(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 100, 0, time.Hour)
	lastPrune = time.Time{} // 同上：清限频状态防前序测试污染跳过
	t.Cleanup(func() { SetShutdownCtx(context.TODO()) })
	writeCacheFile(t, dir, "old.ktx2", make([]byte, 200), time.Now().Add(-time.Hour))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	SetShutdownCtx(ctx) // live ctx：淘汰正常执行
	if err := WriteCached("newhash", make([]byte, 50)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for pruneInFlight.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if _, err := os.Stat(filepath.Join(dir, "old.ktx2")); err == nil {
		t.Fatal("live ctx 下后台淘汰应执行——超限旧文件应被删")
	}
}
