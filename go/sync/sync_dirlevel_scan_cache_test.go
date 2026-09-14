// ===== scan-hit 衍生结果缓存（90300 #1）验证 =====
// 断言：SyncResourcesDirLevelScan 对同一 (rootDir, rtype) 的 scanFn 结果被
// syncDirLevelScanCache 缓存，BuildSyncItems 周期内重复调用不再重算 derivation。
package sync

import (
	"os"
	"path/filepath"
	"sync"
	"testing"

	"ysm-model-manager/go/types"
)

// TestSyncDirLevelScan_HitReusesScanDerivation 注入计数 scanFn：
// 首次调用扫描两目录（global+instance）各一次；二次调用应全部命中缓存，
// scanFn 调用计数不增长（衍生 map 不再重算）。
func TestSyncDirLevelScan_HitReusesScanDerivation(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instanceDir := filepath.Join(base, "instance")
	for _, d := range []string{globalDir, instanceDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// 放一个模型文件使 scanFn 返回的 entries 非空（命中 collectEntriesFromScan）
	modelFile := filepath.Join(globalDir, "a.ysm")
	if err := os.WriteFile(modelFile, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	calls := 0
	scanFn := func(dir string) ([]types.ModelEntry, bool) {
		mu.Lock()
		calls++
		mu.Unlock()
		// 仅对已知目录返回非空命中；其余返回空（回退 Walk）
		if dir == globalDir || dir == instanceDir {
			return []types.ModelEntry{{Name: "a.ysm", Path: modelFile, Ext: ".ysm"}}, true
		}
		return nil, false
	}

	const rtype = "ysm"
	first := SyncResourcesDirLevelScan(globalDir, instanceDir, rtype, scanFn)
	// 首次：globalDir + instanceDir 各触发一次 scanFn（均为命中路径）
	if first.Synced == nil && first.Missing == nil && first.Extra == nil {
		t.Fatalf("首次同步应产出结果，got %+v", first)
	}
	firstCalls := calls

	// 二次调用：同 (globalDir, instanceDir, rtype) 应全部命中 syncDirLevelScanCache，
	// 不再对任何目录触发 scanFn。
	_ = SyncResourcesDirLevelScan(globalDir, instanceDir, rtype, scanFn)
	if calls != firstCalls {
		t.Fatalf("二次同步应命中缓存、scanFn 调用不应增长：首次=%d 二次后=%d", firstCalls, calls)
	}
}
