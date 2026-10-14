// instance_content_diverged_test.go：fileLevel 面板链内容级判定回归锁（2026-10-15 锐评）。
//
// 背景（口径漂移，非新增语义）：BuildSyncItems 的 dirLevel 分支早已注入 scanner 缓存哈希
// （SyncResourcesDirLevelScan，ADR-344 D1 修的正是「仓库侧改过内容仍恒判 Synced」），
// 而 fileLevel 分支走 ysmsync.SyncResources（scanFn=nil → 恒无哈希 → Size 兜底）。
// 同一目录对的另一消费入口 internal/app|App.SyncResources（CLI 列表 / 推送门禁）却注入
// a.scanModelEntries（D2′-a：「消除『改内容不改大小』假绿」）。于是：
//   - 仓库 pack.zip 被改内容不改大小 → 面板 Synced（假绿，用户不重推，游戏里跑旧包）
//   - 同问题 CLI `instances list`/推送清单判 Missing——两路对同一事实答案相反。
//
// 修复 = fileLevel 分支注入同款 scanner 缓存化 scanFn（哈希在 scanner 侧并行预算、30s
// 缓存复用，不触 hashlock 红线；app 层 406 行同款注入已是先例）。
//
// 变异检查：把注入退回 SyncResources(nil) → 本文件两条用例立即红。
package instance

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// writePackPair 造 resourcepack 双侧标准目录，同名同尺寸不同内容（Size 兜底必假绿、
// 哈希判定必 diverged 的判别对）。
func writePackPair(t *testing.T, base string) (globalDir, instDir string) {
	t.Helper()
	sub := registry.SubDirMap("resourcepack")
	if sub == "" {
		t.Skip("resourcepack 无 instanceDir 配置，跳过")
	}
	globalDir = filepath.Join(base, "global")
	instDir = filepath.Join(filepath.Join(base, "inst"), sub)
	testutil.NoError(t, os.MkdirAll(globalDir, 0755), "建全局目录")
	testutil.NoError(t, os.MkdirAll(instDir, 0755), "建实例目录")
	// 同长度异内容：Size 判定恒一致（旧假绿根因），哈希判定必不同
	testutil.NoError(t, os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("AAAA"), 0644), "写全局 pack")
	testutil.NoError(t, os.WriteFile(filepath.Join(instDir, "pack.zip"), []byte("BBBB"), 0644), "写实例 pack")
	return globalDir, instDir
}

func findItem(items []types.ResourceSyncItem, name string) *types.ResourceSyncItem {
	for i := range items {
		if items[i].Name == name {
			return &items[i]
		}
	}
	return nil
}

// TestBuildSyncItems_FileLevelSameSizeDiffContent_NotFakeSynced 面板链同大小异内容：
// pack.zip 行必须 Diverged（Missing 的语义邻居、可推送更新），不得恒判 Synced。
func TestBuildSyncItems_FileLevelSameSizeDiffContent_NotFakeSynced(t *testing.T) {
	base := t.TempDir()
	globalDir, _ := writePackPair(t, base)
	ins := &types.VersionInstance{VersionDir: filepath.Join(base, "inst")}

	items := BuildSyncItems(ins,
		[]registry.ResourceType{{ID: "resourcepack", Icon: "🎨"}},
		map[string]string{"resourcepack": globalDir}, "")

	it := findItem(items, "pack.zip")
	if it == nil {
		t.Fatalf("面板应列出 pack.zip，实际 %+v", items)
	}
	if it.Status == types.SyncStatusSynced {
		t.Fatal("同大小异内容的 pack.zip 被判 Synced——fileLevel 内容级判定未生效（假绿，2026-10-15 锐评病灶）")
	}
	if it.Status != types.SyncStatusDiverged {
		t.Errorf("期望 Diverged（两侧均有、内容不同），实际 %q", it.Status)
	}
}

// TestBuildSyncItems_FileLevelSameContent_StillSynced 负向对照：同内容同大小仍须 Synced
// （修复不得把假绿翻成假红）。
func TestBuildSyncItems_FileLevelSameContent_StillSynced(t *testing.T) {
	base := t.TempDir()
	sub := registry.SubDirMap("resourcepack")
	if sub == "" {
		t.Skip("resourcepack 无 instanceDir 配置，跳过")
	}
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(filepath.Join(base, "inst"), sub)
	testutil.NoError(t, os.MkdirAll(globalDir, 0755), "建全局目录")
	testutil.NoError(t, os.MkdirAll(instDir, 0755), "建实例目录")
	testutil.NoError(t, os.WriteFile(filepath.Join(globalDir, "pack.zip"), []byte("SAME"), 0644), "写全局 pack")
	testutil.NoError(t, os.WriteFile(filepath.Join(instDir, "pack.zip"), []byte("SAME"), 0644), "写实例 pack")

	ins := &types.VersionInstance{VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins,
		[]registry.ResourceType{{ID: "resourcepack", Icon: "🎨"}},
		map[string]string{"resourcepack": globalDir}, "")

	it := findItem(items, "pack.zip")
	if it == nil {
		t.Fatalf("面板应列出 pack.zip，实际 %+v", items)
	}
	if it.Status != types.SyncStatusSynced {
		t.Errorf("同内容应 Synced（不得过度报警），实际 %q", it.Status)
	}
}
