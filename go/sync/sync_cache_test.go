// ===== 同步目录扫描缓存测试 =====
package sync

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"ysm-model-manager/go/scanner"
)

func TestSyncScanCache_LoadStore(t *testing.T) {
	var cache sync.Map
	root := filepath.Join(t.TempDir(), "scan")
	key := syncDirectoryScanKey{kind: "folder", root: root, rtype: "ysm"}
	storeSyncScanCache(&cache, key, map[string]string{"a": filepath.Join(root, "a")})

	got, ok := loadSyncScanCache[map[string]string](&cache, key)
	if !ok || got["a"] != filepath.Join(root, "a") {
		t.Fatalf("缓存应命中并返回值，got=%v ok=%v", got, ok)
	}
}

func TestSyncScanCache_ScannerInvalidateClears(t *testing.T) {
	// 钩子注册已从隐式 init 改为显式调用（app 层启动时注册），测试自备同款前置
	RegisterInvalidationHook()
	// t.Cleanup 保证即使测试 panic 也能恢复钩子状态
	t.Cleanup(func() { RegisterInvalidationHook() }) // 重新注册以恢复默认状态
	root := filepath.Join(t.TempDir(), "scanner-clear")
	key := syncDirectoryScanKey{kind: "folder", root: root, rtype: "ysm"}
	syncFolderScanCache.Store(key, &syncDirectoryScanEntry{
		value:     map[string]string{"a": filepath.Join(root, "a")},
		expiresAt: time.Now().Add(time.Hour),
	})

	scanner.InvalidateCache()
	if _, ok := syncFolderScanCache.Load(key); ok {
		t.Fatal("scanner.InvalidateCache 应触发 sync 失效钩子清空同步扫盘缓存")
	}
}

func TestSyncResources_UsesSyncResourcesCacheAndInvalidate(t *testing.T) {
	global := t.TempDir()
	inst := t.TempDir()
	rtype := "resourcepack"
	sentinelPath := filepath.Join(global, "sentinel.zip")
	cacheKey := syncDirectoryScanKey{kind: "resources", root: global, rtype: rtype}
	syncResourcesScanCache.Store(cacheKey, &syncDirectoryScanEntry{
		value: map[string]DiffEntry{
			"sentinel.zip": {Path: sentinelPath, Size: 1},
		},
		expiresAt: time.Now().Add(time.Hour),
	})

	result := SyncResources(global, inst, rtype)
	found := false
	for _, p := range result.Missing {
		if p == sentinelPath {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("命中同步扫盘缓存时应从缓存反推 Missing sentinel，实际 %+v", result.Missing)
	}

	InvalidateSyncScanCaches()
	result = SyncResources(global, inst, rtype)
	for _, p := range result.Missing {
		if p == sentinelPath {
			t.Fatal("失效后不应再返回缓存中的 sentinel")
		}
	}
}

// TestCollectEntriesWalkCached_FailedWalkNotCached 钉住「Walk 失败不入缓存」契约：
// partialFail 时残缺 entries 不得被缓存 30s 当权威（原 os.Stat 守卫与子树完整性无关，
// 属假守卫）。用「目录不存在」作为 Walk 必错的最短路径（首回调即 err，partialFail 必置位）；
// Windows（CI 为 windows-latest）无法可靠构造「stat 成功但子树读失败」——chmod 000
// 对目录不生效，故以 root 不存在钉住同一判定分支。
func TestCollectEntriesWalkCached_FailedWalkNotCached(t *testing.T) {
	nonexistent := filepath.Join(t.TempDir(), "no-such-dir")
	_ = collectEntriesWalkCached(nonexistent, "ysm")
	key := syncDirectoryScanKey{kind: "dirlevel", root: nonexistent, rtype: "ysm"}
	if _, ok := syncDirLevelScanCache.Load(key); ok {
		t.Fatal("Walk 失败的目录不应入缓存（残缺结果被当权威）")
	}
}

// TestCollectFolderFiles_FailedWalkNotCached 同款契约测试（collectFolderFiles 侧）。
func TestCollectFolderFiles_FailedWalkNotCached(t *testing.T) {
	nonexistent := filepath.Join(t.TempDir(), "no-such-folder")
	_ = collectFolderFiles(nonexistent, "ysm")
	key := syncDirectoryScanKey{kind: "folder", root: nonexistent, rtype: "ysm"}
	if _, ok := syncFolderScanCache.Load(key); ok {
		t.Fatal("Walk 失败的目录不应入缓存（残缺结果被当权威）")
	}
}
