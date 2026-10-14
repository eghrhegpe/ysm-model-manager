// ===== 实例侧禁用载体识别（ADR-345 D3）=====
// 病灶：dirLevel 单元的实例侧路径是盲 join（instDir/<rel>）——实例侧是 X.disabled/ 时
// 该路径不存在 → 子项全判 missing → 父夹升 diverged「待推送」→ 一键/行内推送另建
// customDir/X/，X.disabled/ 残留 = 模型复活 + 同一模型两份副本。
// 修后：实例侧路径解析认禁用载体，单元标 ⛔（中立，不进待推送），子项以载体为基准 diff。
package instance

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func TestBuildSyncItems_InstanceDisabledDir_DisabledNotDiverged(t *testing.T) {
	sub := registry.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst", sub)
	// 仓库：X 活跃；实例：X 被用户禁用（整夹改名）——内容一致。
	// 子项只算**模型文件**（ysm.json 与 .ysm；纹理 .png 不在扫描条目里，两信道一致忽略），
	// 故用两个模型文件让 len(children) 有区分度。
	testutil.WriteTestFile(t, filepath.Join(globalDir, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(globalDir, "X", "model.ysm"), "m")
	testutil.WriteTestFile(t, filepath.Join(instDir, "X.disabled", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(instDir, "X.disabled", "model.ysm"), "m")

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []registry.ResourceType{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")

	var unit *types.ResourceSyncItem
	for i := range items {
		if items[i].Name == "X" {
			unit = &items[i]
			break
		}
	}
	testutil.NotNil(t, unit, "未找到 X 单元，items=%+v", items)
	testutil.Equal(t, unit.Status, types.SyncStatusDisabled,
		"实例侧处于禁用态应标 ⛔（中立、不进待推送），实际 %q", unit.Status)
	testutil.Equal(t, len(unit.Children), 2, "应以禁用载体为基准展开子项，实际 %d 项", len(unit.Children))
	for _, ch := range unit.Children {
		testutil.Equal(t, ch.Status, types.SyncStatusSynced,
			"同内容子项应 Synced（不得因载体路径判 missing），子项 %s 实际 %q", ch.Name, ch.Status)
	}
}

// 反向对照：实例侧活跃时不得误判 ⛔，也不得因为载体探测把正常同步判坏。
func TestBuildSyncItems_InstanceActiveDir_Synced(t *testing.T) {
	sub := registry.SubDirMap("ysm")
	if sub == "" {
		t.Skip("ysm 无 InstanceDir 配置，跳过")
	}
	base := t.TempDir()
	globalDir := filepath.Join(base, "global")
	instDir := filepath.Join(base, "inst", sub)
	testutil.WriteTestFile(t, filepath.Join(globalDir, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(instDir, "X", "ysm.json"), "{}")

	ins := &types.VersionInstance{Name: "t", VersionDir: filepath.Join(base, "inst")}
	items := BuildSyncItems(ins, []registry.ResourceType{{ID: "ysm", Icon: "📦"}}, map[string]string{"ysm": globalDir}, "")

	var unit *types.ResourceSyncItem
	for i := range items {
		if items[i].Name == "X" {
			unit = &items[i]
			break
		}
	}
	testutil.NotNil(t, unit, "未找到 X 单元")
	testutil.Equal(t, unit.Status, types.SyncStatusSynced,
		"实例侧活跃 + 内容一致应 Synced，实际 %q", unit.Status)
}
