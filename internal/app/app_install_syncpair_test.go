// ===== app_install_instance.go 五同步入口壳层覆盖（2026-10-16 锐评 P0-① 配对失效注释段）=====
// 五个同步 binding（Sync/Push/Pull × 批量/单条）在 ysmsync 单漏斗内已级联清缓存，
// 壳层的 instance.InvalidateSyncItemsCache + ysmsync.InvalidateSyncScanCaches 为防御
// 纵深（tests/test_sync_write_cache_pairing.ts 派生闸强制保留）。本文件以「仓库 + .minecraft
// 整合包」临时 fixture 让五入口真跑，覆盖其壳层执行段（含配对失效行）。
package app

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// syncPairApp 构造「ysm 仓库 + .minecraft 整合包」fixture：实例 1.20.1 的 ysm custom
// 目录就绪（instanceDir = config/yes_steve_model/custom，与 resolveInstDirTarget 同口径）。
// 返回 (app, ysmRoot, customDir)。
func syncPairApp(t *testing.T) (*App, string, string) {
	t.Helper()
	base := t.TempDir()
	mcRoot := filepath.Join(base, ".minecraft")
	instDir := filepath.Join(mcRoot, "versions", "1.20.1")
	customDir := filepath.Join(instDir, "config", "yes_steve_model", "custom")
	ysmRoot := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	testutil.NoError(t, os.MkdirAll(customDir, 0o755), "fixture 建 custom 目录失败")
	testutil.NoError(t, os.MkdirAll(ysmRoot, 0o755), "fixture 建 ysm 根失败")
	a := scanApp(t, types.AppConfig{FilesRoot: base, McRoot: mcRoot})
	return a, ysmRoot, customDir
}

// TestSyncEntryBindings_CachePairingPath 五入口顺序真跑一遍：
// Toggle（空实例无差异）→ 批量推送 → 单条推送 → 批量拉取 → 单条拉取。
func TestSyncEntryBindings_CachePairingPath(t *testing.T) {
	a, ysmRoot, customDir := syncPairApp(t)
	model := filepath.Join(ysmRoot, "model.ysm")
	testutil.NoError(t, os.WriteFile(model, []byte("m"), 0o644), "fixture 写模型失败")

	// 1) SyncModelToggleStatus：空实例目录无启禁差异 → (0, 0, nil)
	n1, n2, err := a.SyncModelToggleStatus(customDir, ysmRoot)
	testutil.NoError(t, err)
	testutil.Equal(t, n1, 0, "空实例不应有禁用操作")
	testutil.Equal(t, n2, 0, "空实例不应有启用操作")

	// 2) PushResourceToInstance：仓库 1 个模型 → 批量推送到实例
	n, err := a.PushResourceToInstance("ysm", "1.20.1")
	testutil.NoError(t, err)
	testutil.Equal(t, n, 1, "应推送 1 个缺失模型")
	testutil.FileExists(t, filepath.Join(customDir, "model.ysm"))

	// 3) PushSingleResourceToInstance：单条重推同一模型（幂等覆盖安装）
	testutil.NoError(t, a.PushSingleResourceToInstance("ysm", "1.20.1", model), "单条推送不应报错")

	// 4) PullResourceFromInstance：实例侧造仓库没有的 extra → 批量拉回 1 条
	extra := filepath.Join(customDir, "extra.ysm")
	testutil.NoError(t, os.WriteFile(extra, []byte("e"), 0o644), "fixture 写 extra 失败")
	res, pullErr := a.PullResourceFromInstance("ysm", "1.20.1")
	testutil.NoError(t, pullErr, "批量拉取不应报错")
	testutil.Equal(t, res.OK, 1, "应拉回 1 个 extra: %+v", res)
	testutil.Equal(t, res.Failed, 0, "不应有失败条目: %+v", res)
	testutil.FileExists(t, filepath.Join(ysmRoot, "extra.ysm"), "extra 应已落仓库根")

	// 5) PullSingleResourceFromInstance：单条拉取实例侧模型回仓库
	testutil.NoError(t, a.PullSingleResourceFromInstance("ysm", filepath.Join(customDir, "model.ysm"), "1.20.1"),
		"单条拉取不应报错")
	testutil.FileExists(t, filepath.Join(ysmRoot, "model.ysm"))
}

// TestSyncEntryBindings_MissingPrereqs 前置不满足的早退分支：
// 未配 McRoot / 未知整合包——不触达同步核心，仅锁错误交付形态。
func TestSyncEntryBindings_MissingPrereqs(t *testing.T) {
	a, ysmRoot, _ := syncPairApp(t)
	// 去掉 McRoot：requireMcRoot 早退
	noMc := scanApp(t, types.AppConfig{FilesRoot: filepath.Dir(filepath.Dir(ysmRoot))})
	_, err := noMc.PushResourceToInstance("ysm", "1.20.1")
	testutil.ErrorContains(t, err, "游戏根目录", "未配 McRoot 应早退报错")
	// McRoot 在而整合包不存在 → findInstance 失败
	_, err = a.PushResourceToInstance("ysm", "no-such-inst")
	testutil.ErrorContains(t, err, "未找到整合包", "不存在的实例应报错")
	_, pullErr := a.PullResourceFromInstance("ysm", "no-such-inst")
	testutil.ErrorContains(t, pullErr, "未找到整合包", "批量拉取同样早退")
	testutil.ErrorContains(t, a.PullSingleResourceFromInstance("ysm", "x", "no-such-inst"), "未找到整合包",
		"单条拉取同样早退")
	testutil.ErrorContains(t, a.PushSingleResourceToInstance("ysm", "no-such-inst", "x"), "未找到整合包",
		"单条推送同样早退")
}
