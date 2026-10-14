// ===== dirLevel 单元内容级判定（ADR-344 D1）=====
// 病灶：syncResourcesDirLevel 原以 map[string]string 只比 key 存在性——仓库侧改过内容的
// 平铺模型文件（身份键相同）恒判 Synced，面板不显示待推送、行内无推送按钮，
// 用户看到「已同步」而实例里始终是旧版本（「推了等于没推」）。
// 本文件钉住三件事：内容不同 → Missing（两条信道）、内容相同 → Synced（反向对照）、
// 跨格式同键（B.ysm vs B.zip）不比内容（防「点了推送也不收敛」的假阳性）。
package sync

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/scanner"
)

// TestSyncResourcesDirLevel_FlatFileContentDiffers_Missing（Walk 信道）：
// 两侧同名 .ysm 而内容/大小均不同 → 必须进 Missing（修前：键存在即 Synced）。
func TestSyncResourcesDirLevel_FlatFileContentDiffers_Missing(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(globalDir, "B.ysm"), "repo-new-content")
	testutil.WriteTestFile(t, filepath.Join(instDir, "B.ysm"), "old")

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	testutil.Equal(t, len(result.Missing), 1,
		"内容不同的平铺模型文件应进 Missing（可推送），got Missing=%v Synced=%v", result.Missing, result.Synced)
	testutil.Equal(t, filepath.Base(result.Missing[0]), "B.ysm", "Missing 应是仓库侧 B.ysm，got %v", result.Missing)
	testutil.Equal(t, len(result.Synced), 0, "同一单元不得既 Missing 又 Synced，got %v", result.Synced)
}

// TestSyncResourcesDirLevel_FlatFileSameContent_Synced 反向对照：
// 内容一致必须仍判 Synced——防「一律 Missing」的过度修复（待推送列表被全库刷屏）。
func TestSyncResourcesDirLevel_FlatFileSameContent_Synced(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(globalDir, "B.ysm"), "same")
	testutil.WriteTestFile(t, filepath.Join(instDir, "B.ysm"), "same")

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	testutil.Equal(t, len(result.Synced), 1, "同内容应 Synced，got Synced=%v Missing=%v", result.Synced, result.Missing)
	testutil.Equal(t, len(result.Missing), 0, "同内容不应 Missing，got %v", result.Missing)
}

// TestSyncResourcesDirLevel_CrossFormatKey_Synced 跨格式对照：
// relKeyDirLevel 按模型身份剥扩展名（B.zip 与 B.ysm 同键），跨格式比字节恒不相等——
// 若比内容会造出「点了推送也不收敛」的假待推送（推送落 B.ysm 后实例里 B.zip 仍在，
// 键与内容双双不变）。故跨格式保持旧语义 Synced。
func TestSyncResourcesDirLevel_CrossFormatKey_Synced(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(globalDir, "B.ysm"), "repo")
	testutil.WriteTestFile(t, filepath.Join(instDir, "B.zip"), "instance-other-format-and-length")

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	testutil.Equal(t, len(result.Synced), 1,
		"同身份键的跨格式文件应保持旧语义 Synced（否则永不收敛），got Synced=%v Missing=%v",
		result.Synced, result.Missing)
}

// TestSyncResourcesDirLevelScan_FlatFileSameSizeDifferentContent_Missing（scan 信道）：
// 同 size 不同内容——Size 兜底看不出来，只有哈希能判；生产链（BuildSyncItems）走这条信道，
// 故必须拿到 scanner 摘要参与判定（ADR-344 D1：哈希来源 = scan 条目）。
func TestSyncResourcesDirLevelScan_FlatFileSameSizeDifferentContent_Missing(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	// 等长不同字节：旧实现「存在即 Synced」，Size 比对同样判 Synced
	testutil.WriteTestFile(t, filepath.Join(globalDir, "B.ysm"), "aaaa")
	testutil.WriteTestFile(t, filepath.Join(instDir, "B.ysm"), "bbbb")

	result := SyncResourcesDirLevelScan(globalDir, instDir, "ysm", scanner.ScanEntriesWithHit)

	testutil.Equal(t, len(result.Missing), 1,
		"scan 信道同 size 不同内容应靠哈希判 Missing，got Missing=%v Synced=%v", result.Missing, result.Synced)
	testutil.Equal(t, filepath.Base(result.Missing[0]), "B.ysm", "Missing 应是仓库侧 B.ysm，got %v", result.Missing)
}

// TestSyncResourcesDirLevelScan_FlatFileSameContent_Synced 反向对照（scan 信道）：
// 摘要相同 → Synced，防哈希路径把「同步中」误判为待推送。
func TestSyncResourcesDirLevelScan_FlatFileSameContent_Synced(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(globalDir, "B.ysm"), "same-bytes")
	testutil.WriteTestFile(t, filepath.Join(instDir, "B.ysm"), "same-bytes")

	result := SyncResourcesDirLevelScan(globalDir, instDir, "ysm", scanner.ScanEntriesWithHit)

	testutil.Equal(t, len(result.Synced), 1, "同内容应 Synced，got Synced=%v Missing=%v", result.Synced, result.Missing)
	testutil.Equal(t, len(result.Missing), 0, "同内容不应 Missing，got %v", result.Missing)
}

// TestSyncResourcesDirLevel_WalkChannel_SameSizeDifferentContent_Synced 锁住已知边界：
// Walk 回退信道（scanFn=nil，仅测试/旧调用方）没有摘要，同 size 不同内容仍判 Synced——
// 与文件级信道 DiffEntry.Hash 空则回退 Size 是同一契约，不是新债务（ADR-344 §后果）。
// 生产链恒注入 scanFn，故用户可见面无此盲区。
func TestSyncResourcesDirLevel_WalkChannel_SameSizeDifferentContent_Synced(t *testing.T) {
	globalDir := t.TempDir()
	instDir := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(globalDir, "B.ysm"), "aaaa")
	testutil.WriteTestFile(t, filepath.Join(instDir, "B.ysm"), "bbbb")

	result := SyncResourcesDirLevel(globalDir, instDir, "ysm")

	testutil.Equal(t, len(result.Synced), 1,
		"Walk 信道无摘要 → 同 size 回退判 Synced（契约见 DiffEntry.Hash），got Missing=%v", result.Missing)
}
