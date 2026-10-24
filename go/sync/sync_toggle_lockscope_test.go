// sync_toggle_lockscope_test.go：SyncToggleStatus 锁范围回归锁（钉住阶段 1 扫描在锁外）。
//
// 背景：collectToggleRepoIndex（SyncToggleStatus 阶段 1）曾在 InstallLock 临界区内做
// scanFn(filesRoot) 仓库全量扫描（含 SHA256 哈希）+ 实例目录 WalkDir。仓库扫描在
// scanner 缓存冷启动时整段走盘——而 watcher 触发 syncAll 恰是冷启动路径（文件变更后
// scanner 缓存刚失效，下一次 toggle 必冷扫），期间阻塞所有并发同步/安装/推送操作。
// 与同包 RelinkDir 已确立的「锁外扫描 + 锁内仅覆盖操作段」范式不对称：RelinkDir 注释
// 明写「持锁执行会阻塞所有其他同步/安装操作」，并已用 TestRelinkDir_ScanNotHeldLock
// 钉住同一契约；本用例把该契约补到 toggle。
//
// 变异检查：把 collectToggleRepoIndex 的 Lock()/Unlock() 加回 → 本用例立即红。
// 时序确定（扫描在持锁段之前，单线程执行，无并发持锁者），故不使用 t.Parallel()。
package sync

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/installer"
	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// TestSyncToggleStatus_ScanNotHeldLock 钉住 SyncToggleStatus 的锁范围：阶段 1 的仓库
// 全量扫描与实例目录遍历必须在 InstallLock 外执行——持锁扫描会阻塞并发同步/安装/推送。
// 探测法：注入 scanFn 在扫描段内 IsLocked()——锁未被任何 goroutine 持有则返回 false
// （正确，扫描在锁外）；返回 true 说明扫描段被持锁（回归）。
// IsLocked() 精确探测「锁是否被持有」，不依赖 TryLock 的空闲探测语义。
func TestSyncToggleStatus_ScanNotHeldLock(t *testing.T) {
	base := t.TempDir()
	repoDir := filepath.Join(base, "repo")
	customDir := filepath.Join(base, "custom")
	testutil.NoError(t, os.MkdirAll(repoDir, 0755), "建仓库目录")
	testutil.NoError(t, os.MkdirAll(customDir, 0755), "建实例目录")

	// 仓库侧禁用 + 实例侧活跃同名文件 → 触发禁用方向真实改名（阶段 4 动盘，
	// 保证扫描段与操作段都被执行到，探针不空转）
	repoFile := filepath.Join(repoDir, "model.ysm.ban")
	customFile := filepath.Join(customDir, "model.ysm")
	testutil.NoError(t, os.WriteFile(repoFile, []byte("content"), 0644), "写仓库文件")
	testutil.NoError(t, os.WriteFile(customFile, []byte("content"), 0644), "写实例文件")

	scanLocked := false
	scanCalls := 0
	scanFn := func(dir string) []types.ModelEntry {
		scanCalls++
		// 探针依赖 InstallLocker 具体类型为 *installer.LockTracker（IsLocked() 可用）；
		// 若将来换成其他锁实现，类型断言失败会让本测试静默空转、锁范围回归无人发现。
		// fail-fast 显式失败，杜绝「探针退化为恒真 pass」的假绿（同 TestRelinkDir_ScanNotHeldLock）。
		lt, ok := installer.InstallLocker.(*installer.LockTracker)
		// 守卫下方 lt.IsLocked()（Equal 失败即 Goexit，nil lt 不会被解引用）
		testutil.Equal(t, ok, true, "InstallLocker 具体类型非 *installer.LockTracker（实际 %T），锁范围探针失效——请更新本测试的断言策略",
			installer.InstallLocker)
		if lt.IsLocked() {
			scanLocked = true // 锁被持有 → 扫描在锁内 ✗（回归）
		}
		if dir == repoDir {
			return []types.ModelEntry{{
				Name: "model.ysm.ban", Path: repoFile, Hash: computeHash(repoFile),
			}}
		}
		return nil
	}

	disable, enable, err := SyncToggleStatus(customDir, repoDir, scanFn)
	testutil.NoError(t, err, "同步不应报错")
	testutil.Equal(t, disable, 1, "禁用方向应改名 1 个")
	testutil.Equal(t, enable, 0, "无启用方向")
	testutil.Equal(t, scanCalls == 0, false, "scanFn 未被调用——探针未生效，测试空转")
	testutil.Equal(t, scanLocked, false, "SyncToggleStatus 阶段 1 扫描在 InstallLock 内执行（阻塞并发同步/安装/推送）")
}
