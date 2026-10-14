// ===== 目录粒度启禁同步（ADR-345 D1）=====
// 病灶（探针实证）：目录级禁用载体在 toggle 两条边都不可见——仓库索引建在 scanner 上，
// 而 scanner 按 ADR-038 D3.7 对禁用目录 SkipDir（仓库禁用夹零条目）；实例侧只收文件、
// IsDisableSuffix 又只看尾段（X.disabled/ysm.json 的尾段是 ysm.json）。
// 结果：禁用方向与启用方向都返回 0/0/nil「同步完成」，实例状态纹丝不动。
package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// toggleFixture 建出「仓库 + 实例」并返回 Paths。
func toggleFixture(t *testing.T) (repo, inst string) {
	t.Helper()
	base := t.TempDir()
	return filepath.Join(base, "repo"), filepath.Join(base, "inst")
}

// TestSyncToggleStatus_DirLevelDisable 仓库侧禁用整夹 → 实例侧应整夹改名（禁用方向）。
func TestSyncToggleStatus_DirLevelDisable(t *testing.T) {
	repo, inst := toggleFixture(t)
	// 仓库：X 已禁用 + Y 活跃（Y 用来保证仓库索引非空——索引为空会直接报「未找到模型文件」）
	testutil.WriteTestFile(t, filepath.Join(repo, "X.disabled", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(repo, "Y", "ysm.json"), "{}")
	// 实例：两者都活跃
	testutil.WriteTestFile(t, filepath.Join(inst, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "Y", "ysm.json"), "{}")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "目录粒度禁用不应报错")
	testutil.Equal(t, disabled, 1, "应禁用 1 个目录单元（X），got 禁用=%d 启用=%d", disabled, enabled)
	testutil.Equal(t, enabled, 0, "不应有启用动作，got %d", enabled)

	testutil.FileExists(t, filepath.Join(inst, "X.disabled", "ysm.json"), "实例 X 应整夹改名为 X.disabled")
	testutil.FileNotExists(t, filepath.Join(inst, "X", "ysm.json"), "改名后不应残留活跃 X")
	testutil.FileExists(t, filepath.Join(inst, "Y", "ysm.json"), "已同步的 Y 不得被牵动")
}

// TestSyncToggleStatus_DirLevelEnable 仓库侧活跃 → 实例侧禁用载体应整夹改回活跃（启用方向）。
func TestSyncToggleStatus_DirLevelEnable(t *testing.T) {
	repo, inst := toggleFixture(t)
	testutil.WriteTestFile(t, filepath.Join(repo, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "X.disabled", "ysm.json"), "{}")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "目录粒度启用不应报错")
	testutil.Equal(t, enabled, 1, "应启用 1 个目录单元（X.disabled → X），got 禁用=%d 启用=%d", disabled, enabled)
	testutil.Equal(t, disabled, 0, "不应有禁用动作，got %d", disabled)

	testutil.FileExists(t, filepath.Join(inst, "X", "ysm.json"), "实例 X.disabled 应整夹改回 X")
	testutil.FileNotExists(t, filepath.Join(inst, "X.disabled", "ysm.json"), "改名后不应残留禁用载体")
}

// TestSyncToggleStatus_DirLevelAmbiguousNoOp 仓库侧活跃与载体并存 → 保守不动作（不猜）。
// 夹具关键：实例侧放的是**禁用载体**——若实现把「并存」判成「应活跃」（早前的死分支 bug，
// 复核 P1-1 实证 禁用 0 启用 1），这里就会被强制启用；实例侧若是活跃夹则两种实现都不动作，
// 测试将失去区分力（这正是旧版假绿的原因）。
func TestSyncToggleStatus_DirLevelAmbiguousNoOp(t *testing.T) {
	repo, inst := toggleFixture(t)
	testutil.WriteTestFile(t, filepath.Join(repo, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(repo, "X.disabled", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(repo, "Y", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "X.disabled", "ysm.json"), "{}")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "歧义场景不应报错")
	testutil.Equal(t, disabled+enabled, 0, "两侧并存时不得动作（保守），got 禁用=%d 启用=%d", disabled, enabled)
	testutil.FileExists(t, filepath.Join(inst, "X.disabled", "ysm.json"), "实例应原样不动（不得被强制启用）")
	testutil.FileNotExists(t, filepath.Join(inst, "X", "ysm.json"), "不得凭空造出活跃副本")
}

// TestSyncToggleStatus_DirCarrierIsFileIgnored 仓库侧只有**同名杂散文件** `X.disabled`
// （不是目录载体）时，不得把实例的活跃模型夹整夹改名禁用（复核 P2-1）。
func TestSyncToggleStatus_DirCarrierIsFileIgnored(t *testing.T) {
	repo, inst := toggleFixture(t)
	testutil.WriteTestFile(t, filepath.Join(repo, "X.disabled"), "stray")
	testutil.WriteTestFile(t, filepath.Join(repo, "Y", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "X", "ysm.json"), "{}")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "杂散文件场景不应报错")
	testutil.Equal(t, disabled+enabled, 0, "杂散文件不是禁用意图，不得改名，got 禁用=%d 启用=%d", disabled, enabled)
	testutil.FileExists(t, filepath.Join(inst, "X", "ysm.json"), "活跃模型夹不得被整夹改名")
}

// TestSyncToggleStatus_RepoOnlyDisabledDir 仓库里**只有禁用夹**（索引为空）时，
// 禁用方向仍须生效——早前的空索引早退会直接报「仓库中未找到模型文件」（复核 P2-2）。
func TestSyncToggleStatus_RepoOnlyDisabledDir(t *testing.T) {
	repo, inst := toggleFixture(t)
	testutil.WriteTestFile(t, filepath.Join(repo, "X.disabled", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "X", "ysm.json"), "{}")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "仓库只有禁用夹时不应报「未找到模型文件」（空索引早退须让位于目录载体）")
	testutil.Equal(t, disabled, 1, "禁用方向应生效，got 禁用=%d 启用=%d", disabled, enabled)
	testutil.FileExists(t, filepath.Join(inst, "X.disabled", "ysm.json"), "实例应整夹改名禁用")
}

// TestPrecomputeRelKeyMissHashes_SkipsDirs 目录候选不进阶段 2 哈希（复核 P3-1：
// computeHash(目录) 恒空串、纯浪费一次 os.Open；目录分支也不读哈希）。
func TestPrecomputeRelKeyMissHashes_SkipsDirs(t *testing.T) {
	inst := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(inst, "X", "a.ysm"), "a")
	infos := collectToggleFileInfos(inst)
	sawDir := false
	for _, fi := range infos {
		if fi.isDir {
			sawDir = true
		}
	}
	testutil.Equal(t, sawDir, true, "目录候选应存在（前置条件）")

	hashes := precomputeRelKeyMissHashes(infos, strings.ToLower(filepath.Clean(inst))+string(filepath.Separator), map[string]bool{})
	for p := range hashes {
		fi, statErr := os.Stat(p)
		testutil.NoError(t, statErr, "哈希表 key 应指向真实路径: %s", p)
		testutil.Equal(t, fi.IsDir(), false, "哈希表不得含目录：%s", p)
	}
}

// TestSyncToggleStatus_DirLevelUnknownNoOp 仓库侧完全没有该单元 → 不动作（不越权改实例）。
func TestSyncToggleStatus_DirLevelUnknownNoOp(t *testing.T) {
	repo, inst := toggleFixture(t)
	testutil.WriteTestFile(t, filepath.Join(repo, "Y", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "Y", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "Z.disabled", "ysm.json"), "{}")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "未知单元不应报错")
	testutil.Equal(t, disabled+enabled, 0, "仓库没有的单元不得被改名，got 禁用=%d 启用=%d", disabled, enabled)
	testutil.FileExists(t, filepath.Join(inst, "Z.disabled", "ysm.json"), "未知单元应原样保留")
}

// TestSyncToggleStatus_DirLevelDisableSingleDirRename 断言禁用方向是**整目录改名一次**：
// 若实现退化成「把夹内文件逐个改名」（`X/ysm.json` → `X/ysm.json.disabled`）即为粒度错位。
func TestSyncToggleStatus_DirLevelDisableSingleDirRename(t *testing.T) {
	repo, inst := toggleFixture(t)
	testutil.WriteTestFile(t, filepath.Join(repo, "X.disabled", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(repo, "Y", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "X", "tex.png"), "png")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "目录粒度禁用不应报错")
	testutil.Equal(t, disabled, 1, "应是 1 次目录改名（不是夹内逐文件改名），got 禁用=%d 启用=%d", disabled, enabled)
	testutil.FileExists(t, filepath.Join(inst, "X.disabled", "tex.png"), "整夹改名应带上配套纹理")
	testutil.FileNotExists(t, filepath.Join(inst, "X", "ysm.json.disabled"), "不得退化成夹内文件级改名")
}

// TestSyncToggleStatus_FileLevelRegression 文件级链路回归对照（本刀只补目录粒度）。
func TestSyncToggleStatus_FileLevelRegression(t *testing.T) {
	repo, inst := toggleFixture(t)
	// 启用方向：仓库 a.pmx 活跃、实例 a.pmx.ban
	testutil.WriteTestFile(t, filepath.Join(repo, "a.pmx"), "pmx")
	testutil.WriteTestFile(t, filepath.Join(inst, "a.pmx.ban"), "pmx")
	// 禁用方向：仓库 b.pmx.disabled、实例 b.pmx
	testutil.WriteTestFile(t, filepath.Join(repo, "b.pmx.disabled"), "pmx")
	testutil.WriteTestFile(t, filepath.Join(inst, "b.pmx"), "pmx")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "文件级启禁不应报错")
	testutil.Equal(t, enabled, 1, "a.pmx.ban 应启用，got 启用=%d", enabled)
	testutil.Equal(t, disabled, 1, "b.pmx 应禁用，got 禁用=%d", disabled)
	testutil.FileExists(t, filepath.Join(inst, "a.pmx"), "启用后应有 a.pmx")
	testutil.FileExists(t, filepath.Join(inst, "b.pmx.disabled"), "禁用后应有 b.pmx.disabled")
}

// scanFnFor 生产口径的 scanFn（直接用 scanner，含 Name 语义与**目录级禁用 SkipDir**）：
// 手写替身会漏掉这两点——探针阶段第一版手写 scanFn 就因此给出过假结论。
func scanFnFor(root string) []types.ModelEntry {
	entries, _ := scanner.ScanEntriesWithHit(root)
	return entries
}
