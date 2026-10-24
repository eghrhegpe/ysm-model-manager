package texture_cache

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
	"ysm-model-manager/go/internal/testutil"
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
	testutil.NoError(t, os.WriteFile(path, data, 0644))
	testutil.NoError(t, os.Chtimes(path, mod, mod))
	return path
}

func TestPrune_EmptyCacheDir(t *testing.T) {
	setCacheDir(t)
	setLimits(t, 1024, time.Hour, 0)
	res, err := Prune()
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 0, "空目录不应删除任何文件")
}

func TestPrune_CacheDirUnavailable(t *testing.T) {
	old := CacheDir
	t.Cleanup(func() { CacheDir = old })
	CacheDir = func() string { return "" }
	res, err := Prune()
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 0, "缓存目录不可用时应 no-op")
}

func TestPrune_SkipsNonKtx2(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, 0, 0) // 无容量上限、无 TTL：只应验证扩展名过滤
	writeCacheFile(t, dir, "aaa.ktx2", []byte("x"), time.Now())
	writeCacheFile(t, dir, "notes.txt", []byte("x"), time.Now().Add(-100*time.Hour))
	res, err := Prune()
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 0, "非 .ktx2 不应参与淘汰")
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
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 2, "应删 2 个最旧文件")
	testutil.Equal(t, res.FreedBytes, 300, "应释放 300B")
	testutil.Equal(t, res.Remaining, 300, "剩余应为 300B")
	testutil.FileNotExists(t, filepath.Join(dir, "aaa.ktx2"), "aaa 应被删（最旧）")
	testutil.FileNotExists(t, filepath.Join(dir, "bbb.ktx2"), "bbb 应被删")
	testutil.FileExists(t, filepath.Join(dir, "ccc.ktx2"), "ccc 应保留（最新）")
}

func TestPrune_TTL_ExpiredRemoved_FreshKept(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, time.Hour, 0) // 1 小时 TTL，无容量上限
	writeCacheFile(t, dir, "old.ktx2", []byte("x"), time.Now().Add(-2*time.Hour))
	writeCacheFile(t, dir, "new.ktx2", []byte("x"), time.Now())
	res, err := Prune()
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 1, "应只删超龄的 1 个")
	testutil.FileNotExists(t, filepath.Join(dir, "old.ktx2"), "old 应被删（超龄）")
	testutil.FileExists(t, filepath.Join(dir, "new.ktx2"), "new 应保留（新鲜）")
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
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 3, "应删 3 个（1 超龄 + 2 超容量）")
	testutil.Equal(t, res.Remaining, 100, "剩余应为 100B")
}

func TestWriteCached_TriggersPrune(t *testing.T) {
	setCacheDir(t)
	setLimits(t, 250, 0, 0) // interval=0 → 每次写都触发；容量 250
	for i := 0; i < 4; i++ {
		testutil.NoError(t, WriteCached(fmt.Sprintf("hash%d", i), make([]byte, 100)))
	}
	// 每次写后 prune 到 ≤250：写满 4 个（400B）后应只剩最新的 2 个（200B）
	stats := GetCacheStats()
	testutil.Equal(t, stats.FileCount, 2, "写路径自动淘汰后应剩 2 个")
	testutil.Equal(t, stats.TotalSize, 200, "剩余应 200B")
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
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 0, "删除失败不应计数")
	testutil.Equal(t, res.FreedBytes, 0, "删除失败不应虚报释放字节")
	// 删除失败不得低估 Remaining：总 160B 应如实保留
	testutil.Equal(t, res.Remaining, 160, "删除失败后剩余应为 160B（不虚报）")
	_ = dir
}

func TestPrune_TTLRemoveFailure_KeepsExpired(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, time.Hour, 0)
	writeCacheFile(t, dir, "old.ktx2", []byte("x"), time.Now().Add(-2*time.Hour))
	failRemove(t)
	res, err := Prune()
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 0, "删除失败不应计数 removed")
	testutil.Equal(t, res.FreedBytes, 0, "删除失败不应虚报释放字节 freed")
	testutil.FileExists(t, filepath.Join(dir, "old.ktx2"), "删除失败的超龄文件应留在磁盘")
	// 超龄文件仍计入 Remaining（如实反映磁盘现状）
	testutil.Equal(t, res.Remaining, 1, "剩余应含超龄未删文件（1B）")
}

func TestPrune_OrphanTmp_ExpiredCleaned(t *testing.T) {
	dir := setCacheDir(t)
	setLimits(t, 0, time.Hour, 0) // 1 小时 TTL
	writeCacheFile(t, dir, "old.ktx2.tmp", []byte("x"), time.Now().Add(-2*time.Hour))
	writeCacheFile(t, dir, "fresh.ktx2.tmp", []byte("x"), time.Now())
	res, err := Prune()
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 1, "应清 1 个超龄 .tmp 残留")
	testutil.FileNotExists(t, filepath.Join(dir, "old.ktx2.tmp"), "超龄 .tmp 残留应被清")
	testutil.FileExists(t, filepath.Join(dir, "fresh.ktx2.tmp"), "新鲜 .tmp 应保留（可能仍在写入）")
	// 口径钉死（P4 清偿 2026-10-12）：.tmp 不是缓存条目——KeptCount 与
	// FreedBytes/Remaining/ListCacheFiles/GetCacheStats 同定义，只计 .ktx2。
	// 本例零 .ktx2，删一个 .tmp 留一个 .tmp → 条目保留数恒 0。
	testutil.Equal(t, res.KeptCount, 0, "KeptCount 不应计入 .tmp 残留（条目口径）")
}

func TestPrune_TmpNotCountedInCapacity(t *testing.T) {
	dir := setCacheDir(t)
	now := time.Now()
	writeCacheFile(t, dir, "a.ktx2", make([]byte, 100), now)
	writeCacheFile(t, dir, "b.ktx2", make([]byte, 100), now)
	writeCacheFile(t, dir, "partial.ktx2.tmp", make([]byte, 300), now)
	setLimits(t, 150, 0, 0) // 容量 150：ktx2 总 200 > 150 → 删最旧 a
	res, err := Prune()
	testutil.NoError(t, err)
	testutil.Equal(t, res.RemovedCount, 1, "应只删 1 个 ktx2")
	testutil.FileNotExists(t, filepath.Join(dir, "a.ktx2"), "a 应被容量淘汰删除")
	testutil.FileExists(t, filepath.Join(dir, "partial.ktx2.tmp"), "新鲜 .tmp 不应被容量淘汰删除")
	// Remaining 只计 .ktx2（100B），不含 tmp
	testutil.Equal(t, res.Remaining, 100, "剩余应只计 ktx2=100B")
	// 口径钉死（P4 清偿）：留 b.ktx2=1 条目；partial.ktx2.tmp 存留不计入 KeptCount
	// （原实现 KeptCount = totalFiles(3) − RemovedCount(1) = 2 混入 .tmp，与上条自相矛盾）
	testutil.Equal(t, res.KeptCount, 1, "KeptCount 应只计保留的 .ktx2 条目=1")
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
	testutil.NoError(t, WriteCached("newhash", make([]byte, 50)))
	deadline := time.Now().Add(2 * time.Second)
	for pruneInFlight.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	testutil.FileExists(t, filepath.Join(dir, "old.ktx2"), "取消 ctx 后后台淘汰应放弃——旧文件不应被删")
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
	testutil.NoError(t, WriteCached("newhash", make([]byte, 50)))
	deadline := time.Now().Add(2 * time.Second)
	for pruneInFlight.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	testutil.FileNotExists(t, filepath.Join(dir, "old.ktx2"), "live ctx 下后台淘汰应执行——超限旧文件应被删")
}
