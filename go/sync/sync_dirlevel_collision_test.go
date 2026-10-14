// sync_dirlevel_collision_test.go：dirLevel 同键纯文件/文件碰撞 fail-loud 回归锁。
//
// 背景（sync_dirlevel.go 头注释「已知限制」末项）：同级「不同扩展名同名文件」
// （如 model_a.pmx + model_a.pmd）经 relKeyDirLevel 剥扩展名后同键，map last-write-wins
// 静默丢一个——同步面板从此看不见被丢的那个物理模型。本测试钉住「碰撞不再静默」：
// 键表仍按模型身份归一（跨格式同身份匹配是设计语义，不动），但被覆盖方必须进
// collect 返回的碰撞清单，并由 syncResourcesDirLevel 汇入 ResourceSyncResult.Warnings。
//
// 变异检查（2026-10-14 已执行）：upsertDirLevelUnit 的碰撞记录摘除（append 替换为
// 丢弃表达式，保持编译通过）→ 三个「期望 1 条」用例立即红（实测 3 FAIL），复原后回绿。
package sync

import (
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/scanner"
)

// writeCollisionPair 造一对同级同身份不同扩展名的平铺模型文件（rtype=EntityPlayer 下
// .pmx/.pmd 均为裸扩展名，无需真实 zip 容器）。
func writeCollisionPair(t *testing.T, root string) {
	t.Helper()
	testutil.WriteTestFile(t, filepath.Join(root, "model_a.pmd"), "x")
	testutil.WriteTestFile(t, filepath.Join(root, "model_a.pmx"), "x")
}

// TestCollectEntriesWalk_KeyCollisionLoud Walk 信道：碰撞必被记录，且不改变键表内容
// （survivor 仍按 last-write-wins 为字典序更晚的 .pmx——语义不变，只加可见性）。
func TestCollectEntriesWalk_KeyCollisionLoud(t *testing.T) {
	root := t.TempDir()
	writeCollisionPair(t, root)

	units, collisions, _ := collectEntriesWalk(root, "EntityPlayer", nil)
	if len(collisions) != 1 {
		t.Fatalf("期望 1 条碰撞记录，实际 %d：%v", len(collisions), collisions)
	}
	c := collisions[0]
	if !strings.Contains(c, "model_a.pmd") || !strings.Contains(c, "model_a.pmx") {
		t.Fatalf("碰撞记录须点名两侧物理文件，实际：%s", c)
	}
	u, ok := units["model_a"]
	if !ok {
		t.Fatal("键表缺 model_a（last-write-wins 语义被破坏？）")
	}
	if !strings.HasSuffix(u.Path, ".pmx") {
		t.Fatalf("survivor 应为字典序更晚的 .pmx（行为不变），实际 %s", u.Path)
	}

	// 负向对照：无碰撞树必须零记录（不得误报）
	solo := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(solo, "only.pmx"), "x")
	if _, cols, _ := collectEntriesWalk(solo, "EntityPlayer", nil); len(cols) != 0 {
		t.Fatalf("无碰撞树误报：%v", cols)
	}
}

// TestCollectEntriesFromScan_KeyCollisionLoud scan 信道：同 Walk 口径（两信道判定强度
// 一致是 ADR-344 契约，碰撞可见性不得劈裂）。
func TestCollectEntriesFromScan_KeyCollisionLoud(t *testing.T) {
	root := t.TempDir()
	writeCollisionPair(t, root)

	entries, _ := scanner.ScanEntriesWithHit(root)
	if len(entries) != 2 {
		t.Fatalf("期望 scanner 出 2 条（pmx+pmd），实际 %d", len(entries))
	}
	units, collisions := collectEntriesFromScan(entries, root, "EntityPlayer")
	if len(collisions) != 1 {
		t.Fatalf("期望 1 条碰撞记录，实际 %d：%v", len(collisions), collisions)
	}
	if _, ok := units["model_a"]; !ok {
		t.Fatal("键表缺 model_a")
	}
}

// TestSyncResultsDirLevel_KeyCollisionInWarnings 端到端：全局侧碰撞必须进
// ResourceSyncResult.Warnings（诊断信道，不影响四桶判定）；实例侧无碰撞 → 零记录。
func TestSyncResultsDirLevel_KeyCollisionInWarnings(t *testing.T) {
	global := t.TempDir()
	writeCollisionPair(t, global)
	instance := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(instance, "model_a.pmx"), "x") // 与 survivor 同格式同尺寸

	res := SyncResourcesDirLevel(global, instance, "EntityPlayer")
	if len(res.Warnings) != 1 {
		t.Fatalf("期望 1 条 Warnings（全局侧碰撞），实际 %d：%v", len(res.Warnings), res.Warnings)
	}
	if !strings.Contains(res.Warnings[0], "model_a") {
		t.Fatalf("Warnings 未点名碰撞键：%v", res.Warnings)
	}
	// 四桶判定行为不变：survivor .pmx 与实例同格式同尺寸 → Synced，无 Missing/Extra
	if len(res.Missing) != 0 || len(res.Extra) != 0 {
		t.Fatalf("碰撞不得扰动四桶判定：Missing=%v Extra=%v", res.Missing, res.Extra)
	}
	if !anySuffix(res.Synced, "model_a.pmx") {
		t.Fatalf("Synced 应含 model_a.pmx 绝对路径，实际 %v", res.Synced)
	}
}

// 零碰撞树的结果 Warnings 必须为空（omitempty 保持旧 JSON 载荷洁净）。
func TestSyncResultsDirLevel_NoCollisionNoWarning(t *testing.T) {
	global := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(global, "solo.pmx"), "x")
	instance := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(instance, "solo.pmx"), "x")

	res := SyncResourcesDirLevel(global, instance, "EntityPlayer")
	if len(res.Warnings) != 0 {
		t.Fatalf("零碰撞树不得产 Warnings：%v", res.Warnings)
	}
}

// dirLevelResult 自身不产 Warnings（碰撞记录归 collect 层，归并层只透传）。
func TestDirLevelResult_WarningsUntouched(t *testing.T) {
	res := dirLevelResult(
		map[string]dirLevelUnit{"a": {Path: "g/a.pmx", Rel: "a.pmx"}},
		map[string]dirLevelUnit{"a": {Path: "i/a.pmx", Rel: "a.pmx"}},
	)
	if len(res.Warnings) != 0 {
		t.Fatalf("dirLevelResult 自身不得产 Warnings（碰撞在 collect 层记录）：%v", res.Warnings)
	}
}

func anySuffix(list []string, suffix string) bool {
	for _, s := range list {
		if strings.HasSuffix(s, suffix) {
			return true
		}
	}
	return false
}
