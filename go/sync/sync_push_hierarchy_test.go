// ===== 单条推送保层级 + 祖先单元不整体安装（ADR-344 D3/D4）=====
// 病灶一：PushSingleResource 的目录分支走 InstallDirLocked → 落位 customDir/<basename>，
// 嵌套单元（嵌套1/01_taisho_maid）被拍平到实例根；而它正是面板行内推送与一键安装
// MissingDirs 的消费端（internal/app|PushSingleResourceToInstance）。
// 病灶二：混合容器（自身含平铺模型文件 + 子模型夹）在键集里同时登记容器键、容器内平铺
// 文件键与子夹键，PushResources/PullResources 逐条安装会让容器与其子单元重复拷贝
// （计数膨胀 + 双倍 IO），与面板链 pushTargets「只递归子单元」的口径相反。
package sync

import (
	"path/filepath"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// ysmTestDirs 建出「仓库根 + 实例 custom 目录」这一对固定布局
// （实例侧须含 .minecraft 标记——installer 的 installDirAtLocked 守卫要求）。
func ysmTestDirs(t *testing.T) (globalDir, customDir string) {
	t.Helper()
	base := t.TempDir()
	globalDir = filepath.Join(base, "ysm")
	customDir = filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(customDir, ".keep"), "")
	return globalDir, customDir
}

// TestPushSingleResource_NestedDirKeepsRel 嵌套模型夹整夹推送必须保留仓库层级：
// 仓库 嵌套1/01_taisho_maid/{ysm.json,tex.png} → 实例 custom/嵌套1/01_taisho_maid/…
// 修前落位 custom/01_taisho_maid/…（层级丢失 + 跨层同名互踩）。
func TestPushSingleResource_NestedDirKeepsRel(t *testing.T) {
	globalDir, customDir := ysmTestDirs(t)
	nested := filepath.Join(globalDir, "嵌套1", "01_taisho_maid")
	testutil.WriteTestFile(t, filepath.Join(nested, "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(nested, "tex.png"), "png")

	testutil.NoError(t, PushSingleResource(nested, customDir, globalDir, "copy", "ysm"), "推送嵌套模型夹失败")

	testutil.FileExists(t, filepath.Join(customDir, "嵌套1", "01_taisho_maid", "ysm.json"),
		"嵌套模型夹应按仓库层级落位（ADR-344 D3）")
	testutil.FileExists(t, filepath.Join(customDir, "嵌套1", "01_taisho_maid", "tex.png"),
		"整夹推送须带配套纹理（installExts 放行）")
	testutil.FileNotExists(t, filepath.Join(customDir, "01_taisho_maid", "ysm.json"),
		"不得拍平到实例根（层级丢失）")
}

// TestPushSingleResource_YsmJSONKeepsRel ysm.json 分支（取 filePath 的父目录作源夹）
// 同样保层级——三条分支共用同一段落位判定，防「修了目录分支漏了扩展名分支」。
func TestPushSingleResource_YsmJSONKeepsRel(t *testing.T) {
	globalDir, customDir := ysmTestDirs(t)
	testutil.WriteTestFile(t, filepath.Join(globalDir, "rpg", "weapons", "sword", "ysm.json"), "{}")

	testutil.NoError(t,
		PushSingleResource(filepath.Join(globalDir, "rpg", "weapons", "sword", "ysm.json"),
			customDir, globalDir, "copy", "ysm"),
		"推送 ysm.json 失败")

	testutil.FileExists(t, filepath.Join(customDir, "rpg", "weapons", "sword", "ysm.json"),
		"ysm.json 分支应按父目录的仓库层级落位（ADR-344 D3）")
}

// TestPushSingleResource_PmxKeepsRel .pmx 分支（MMD 文件夹级）同样保层级。
func TestPushSingleResource_PmxKeepsRel(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "EntityPlayer")
	customDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(customDir, ".keep"), "")
	testutil.WriteTestFile(t, filepath.Join(globalDir, "mmd", "charA", "char.pmx"), "pmx")

	testutil.NoError(t,
		PushSingleResource(filepath.Join(globalDir, "mmd", "charA", "char.pmx"),
			customDir, globalDir, "copy", "EntityPlayer"),
		"推送 .pmx 失败")

	testutil.FileExists(t, filepath.Join(customDir, "mmd", "charA", "char.pmx"),
		".pmx 分支应按父目录的仓库层级落位（ADR-344 D3）")
}

// TestPushSingleResource_RepoRoot_FallsBackBasename 守卫对照：源夹就是仓库根
// （rel == "."，InstallDirRel 拒绝该形态）时回退 basename 语义，不静默丢推送。
func TestPushSingleResource_RepoRoot_FallsBackBasename(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	customDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(customDir, ".keep"), "")
	testutil.WriteTestFile(t, filepath.Join(globalDir, "solo.ysm"), "solo")

	testutil.NoError(t, PushSingleResource(globalDir, customDir, globalDir, "copy", "ysm"),
		"仓库根作源夹时应回退 basename 落位（不得报错丢推送）")

	testutil.FileExists(t, filepath.Join(customDir, "ysm", "solo.ysm"),
		"rel==\".\" 回退 InstallDir 的 basename 语义")
}

// mixedContainerRepo 造出「混合容器」仓库：容器 嵌套1 自身含平铺 .ysm（令其被判模型夹）
// 且含子模型夹 01_taisho_maid → 键集 = 容器键 + 平铺文件键 + 子夹键（共 3 个单元）。
func mixedContainerRepo(t *testing.T, root string) {
	t.Helper()
	container := filepath.Join(root, "嵌套1")
	testutil.WriteTestFile(t, filepath.Join(container, "动力臂.ysm"), "flat")
	testutil.WriteTestFile(t, filepath.Join(container, "01_taisho_maid", "ysm.json"), "{}")
}

// TestPushResources_MixedContainer_NoAncestorDoubleInstall 混合容器推送：
// 容器键是「键对齐 marker」（与对侧同名叶子目录对齐键集），不是模型单元——
// 整体安装容器会与其子单元重复拷贝同一批文件（修前 count=3，实际 2 个单元）。
func TestPushResources_MixedContainer_NoAncestorDoubleInstall(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(targetDir, ".keep"), "")
	mixedContainerRepo(t, globalDir)

	count, err := PushResources("ysm", globalDir, targetDir, "copy", nil)
	testutil.NoError(t, err, "PushResources 失败")
	testutil.Equal(t, count, 2,
		"祖先容器键不得整体安装（容器 + 平铺文件 + 子夹 = 3 单元，实际应装 2 个：平铺文件与子夹）")

	testutil.FileExists(t, filepath.Join(targetDir, "嵌套1", "动力臂.ysm"), "容器内平铺 .ysm 应落位到容器层级下")
	testutil.FileExists(t, filepath.Join(targetDir, "嵌套1", "01_taisho_maid", "ysm.json"), "子模型夹应落位到容器层级下")
}

// TestPullResources_MixedContainer_NoAncestorDoubleInstall 拉取侧同款（Extra 清单
// 同样含容器 + 子单元）：对称去重，避免「拉取 N 个」计数膨胀与双倍拷贝。
func TestPullResources_MixedContainer_NoAncestorDoubleInstall(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(targetDir, ".keep"), "")
	testutil.WriteTestFile(t, filepath.Join(globalDir, ".keep"), "")
	mixedContainerRepo(t, targetDir)

	count, err := PullResources("ysm", globalDir, targetDir, nil)
	testutil.NoError(t, err, "PullResources 失败")
	testutil.Equal(t, count, 2, "祖先容器键不得整体拉取（Extra 3 单元 → 实际 2 个）")

	testutil.FileExists(t, filepath.Join(globalDir, "嵌套1", "动力臂.ysm"), "容器内平铺 .ysm 应拉回容器层级")
	testutil.FileExists(t, filepath.Join(globalDir, "嵌套1", "01_taisho_maid", "ysm.json"), "子模型夹应拉回容器层级")
}

// TestDropAncestorUnits 判据单测：仅「其下有更深条目」的祖先被剔除；
// 兄弟、根层文件、非前缀同名（a 与 ab）必须原样保留。
func TestDropAncestorUnits(t *testing.T) {
	sep := string(filepath.Separator)
	tests := []struct {
		name string
		in   []string
		want []string
	}{
		{"容器+子单元", []string{"r" + sep + "c", "r" + sep + "c" + sep + "f.ysm", "r" + sep + "c" + sep + "s"}, []string{"r" + sep + "c" + sep + "f.ysm", "r" + sep + "c" + sep + "s"}},
		{"无嵌套", []string{"r" + sep + "a", "r" + sep + "b"}, []string{"r" + sep + "a", "r" + sep + "b"}},
		{"仅前缀同名不误杀", []string{"r" + sep + "a", "r" + sep + "ab"}, []string{"r" + sep + "a", "r" + sep + "ab"}},
		{"单条不特判", []string{"r" + sep + "a"}, []string{"r" + sep + "a"}},
		{"空表", nil, []string{}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := dropAncestorUnits(tt.in)
			testutil.Equal(t, len(got), len(tt.want), "剔除后条数不符：got %v want %v", got, tt.want)
			for i := range tt.want {
				testutil.Equal(t, got[i], tt.want[i], "顺序/内容不符：got %v want %v", got, tt.want)
			}
		})
	}
}
