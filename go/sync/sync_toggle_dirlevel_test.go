// ===== 目录粒度启禁同步（ADR-345 D1）=====
// 病灶（探针实证）：目录级禁用载体在 toggle 两条边都不可见——仓库索引建在 scanner 上，
// 而 scanner 按 ADR-038 D3.7 对禁用目录 SkipDir（仓库禁用夹零条目）；实例侧只收文件、
// IsDisableSuffix 又只看尾段（X.disabled/ysm.json 的尾段是 ysm.json）。
// 结果：禁用方向与启用方向都返回 0/0/nil「同步完成」，实例状态纹丝不动。
package sync

import (
	"path/filepath"
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
func TestSyncToggleStatus_DirLevelAmbiguousNoOp(t *testing.T) {
	repo, inst := toggleFixture(t)
	testutil.WriteTestFile(t, filepath.Join(repo, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(repo, "X.disabled", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(repo, "Y", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(inst, "X", "ysm.json"), "{}")

	disabled, enabled, err := SyncToggleStatus(inst, repo, scanFnFor)
	testutil.NoError(t, err, "歧义场景不应报错")
	testutil.Equal(t, disabled+enabled, 0, "两侧并存时不得动作（保守），got 禁用=%d 启用=%d", disabled, enabled)
	testutil.FileExists(t, filepath.Join(inst, "X", "ysm.json"), "实例应原样不动")
	testutil.FileNotExists(t, filepath.Join(inst, "X.disabled"), "不得凭空造出禁用载体")
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
