// ===== app.go emitRepoFsChanged 定向失效单测（ADR-352 ⑥ 配对）=====
// watcher onChange 段只刷 UI，空实例时 ClearScanCache 不跑——emitRepoFsChanged 须
// 定向去信任 ysm 根（InvalidateScanPath），否则浏览索引信任态被陈旧扫描缓存永久挡住。
// 本文件锁「emitRepoFsChanged 后 ysm 根扫描缓存失效」与「ysmRoot 为空时守卫短路」。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// TestEmitRepoFsChanged_InvalidatesYsmRoot 事件派发段（a.app.Event.Emit）需 Wails
// runtime，headless 下 a.app==nil 静默丢弃——只锁缓存失效行为不变量。
func TestEmitRepoFsChanged_InvalidatesYsmRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	testutil.NoError(t, os.MkdirAll(root, 0o755), "fixture 建根失败")
	testutil.NoError(t, os.WriteFile(filepath.Join(root, "a.ysm"), []byte("{}"), 0o644), "fixture 写模型失败")
	a := scanApp(t, types.AppConfig{FilesRoot: base})

	first, hit := a.scanModelEntriesWithHit(root)
	testutil.Equal(t, hit, false, "首次扫描不应命中缓存")
	testutil.Equal(t, len(first), 1, "fixture 应扫出 1 个文件")
	_, hit2 := a.scanModelEntriesWithHit(root)
	testutil.Equal(t, hit2, true, "TTL 窗口内二次扫描应命中缓存")

	a.emitRepoFsChanged() // a.app==nil：事件静默丢弃；ysm 根定向失效照常执行

	_, hit3 := a.scanModelEntriesWithHit(root)
	testutil.Equal(t, hit3, false, "emitRepoFsChanged 后 ysm 根缓存应被定向失效（InvalidateScanPath）")
}

// TestEmitRepoFsChanged_EmptyRootShortCircuit ysmRoot 未配置（""）时守卫短路：
// 不进 InvalidateScanPath、不 panic（CLI/测试 &App{} 直构形态的行为边界）。
func TestEmitRepoFsChanged_EmptyRootShortCircuit(t *testing.T) {
	a := scanApp(t, types.AppConfig{})
	testutil.Equal(t, a.ysmRoot(), "", "未配置 FilesRoot 时 ysmRoot 应为空串")
	a.emitRepoFsChanged() // 仅断言不 panic：root=="" 短路 + a.app==nil 事件丢弃
}
