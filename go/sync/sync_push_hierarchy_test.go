// ===== 单条推送保层级 + 祖先单元不整体安装（ADR-344 D3/D4）=====
// 病灶一：PushSingleResource 的目录分支走 InstallDirLocked → 落位 customDir/<basename>，
// 嵌套单元（嵌套1/01_taisho_maid）被拍平到实例根；而它正是面板行内推送与一键安装
// MissingDirs 的消费端（internal/app|PushSingleResourceToInstance）。
// 病灶二：混合容器（自身含平铺模型文件 + 子模型夹）在键集里同时登记容器键、容器内平铺
// 文件键与子夹键，PushResources/PullResources 逐条安装会让容器与其子单元重复拷贝
// （计数膨胀 + 双倍 IO），与面板链 pushTargets「只递归子单元」的口径相反。
package sync

import (
	"os"
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
// 断言**配套纹理**同落：这是「ysm.json 分支真的触发了整夹安装」的唯一证据——
// 若 `IsYsmEntryJSON` 又退回传全路径（恒 false → 单文件 Install），json 自身仍会按 rel
// 落位、测试照样绿（复核 P3-4 实证的假绿缺口），纹理则必丢。
func TestPushSingleResource_YsmJSONKeepsRel(t *testing.T) {
	globalDir, customDir := ysmTestDirs(t)
	modelDir := filepath.Join(globalDir, "rpg", "weapons", "sword")
	testutil.WriteTestFile(t, filepath.Join(modelDir, "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(modelDir, "tex.png"), "png")

	testutil.NoError(t,
		PushSingleResource(filepath.Join(modelDir, "ysm.json"), customDir, globalDir, "copy", "ysm"),
		"推送 ysm.json 失败")

	testutil.FileExists(t, filepath.Join(customDir, "rpg", "weapons", "sword", "ysm.json"),
		"ysm.json 分支应按父目录的仓库层级落位（ADR-344 D3）")
	testutil.FileExists(t, filepath.Join(customDir, "rpg", "weapons", "sword", "tex.png"),
		"ysm.json 分支必须整夹安装（配套纹理同落）——否则说明该分支又变回死分支（ADR-344 D3b）")
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

// TestPushSingleResource_RepoRootDir_Refused 守卫对照：源夹就是仓库根时**显式拒绝**
// （不得回退 basename 语义——那会把整座仓库装进 customDir/<仓库夹名>，ADR-344 D3c）。
func TestPushSingleResource_RepoRootDir_Refused(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	customDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(customDir, ".keep"), "")
	testutil.WriteTestFile(t, filepath.Join(globalDir, "solo.ysm"), "solo")

	err := PushSingleResource(globalDir, customDir, globalDir, "copy", "ysm")
	testutil.NotNil(t, err, "源目录是仓库根时必须拒绝（整仓推送）")
	testutil.ErrorContains(t, err, "根级", "错误文案须点名根级入口，前端据此给可执行建议")

	// 拒绝即零落地：basename 回退的产物 customDir/ysm/ 不得存在
	testutil.FileNotExists(t, filepath.Join(customDir, "ysm", "solo.ysm"),
		"拒绝后不得留下整仓落地产物")
}

// TestPushSingleResource_RootYsmJSON_Refused 根级 ysm.json 的面板行内推送（ADR-344 D3c 回归锁）。
// P0 实证（修复前）：仓库根放 ysm.json + 其他模型/，PushSingleResource(<repo>/ysm.json,…)
// 返回 err=nil 且 customDir/ysm/其他模型/B.ysm 落地——整仓静默复制进整合包。
// 触发链：根级 ysm.json 是 ysm 合法 dirLevel 文件单元 → 面板 missing 行有推送按钮 →
// internal/app|PushSingleResourceToInstance 直进（该调用点没有导入链的根级兜底守）。
func TestPushSingleResource_RootYsmJSON_Refused(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	customDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(customDir, ".keep"), "")
	testutil.WriteTestFile(t, filepath.Join(globalDir, "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(globalDir, "其他模型", "B.ysm"), "other")

	err := PushSingleResource(filepath.Join(globalDir, "ysm.json"), customDir, globalDir, "copy", "ysm")
	testutil.NotNil(t, err, "根级 ysm.json 必须被拒绝（整仓推送会污染整合包）")
	testutil.ErrorContains(t, err, "根级", "错误文案须点名根级入口")

	testutil.FileNotExists(t, filepath.Join(customDir, "ysm", "其他模型", "B.ysm"),
		"无关模型不得随根级 ysm.json 落地（P0：整仓复制）")
	entries, readErr := os.ReadDir(customDir)
	testutil.NoError(t, readErr, "读实例目录失败")
	testutil.Equal(t, len(entries), 1, "拒绝后实例目录只应有占位文件，实际 %d 项", len(entries))
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

	res := PullResources("ysm", globalDir, targetDir, nil)
	testutil.Equal(t, res.OK, 2, "祖先容器键不得整体拉取（Extra 3 单元 → 实际 2 个）")
	testutil.Equal(t, res.Failed, 0, "不应有失败条目（首个失败: %s）", res.FirstError)

	testutil.FileExists(t, filepath.Join(globalDir, "嵌套1", "动力臂.ysm"), "容器内平铺 .ysm 应拉回容器层级")
	testutil.FileExists(t, filepath.Join(globalDir, "嵌套1", "01_taisho_maid", "ysm.json"), "子模型夹应拉回容器层级")
}

// TestPushSingleResource_DstDisabled_Refused 目标侧已禁用（customDir/X.disabled 存在、
// customDir/X 不存在）时不得推送：整夹安装会另建同名活跃副本 → 模型复活 + 同一模型两份
// （ADR-345 D4）。拒绝优于静默复制，且禁用载体必须毫发无损。
func TestPushSingleResource_DstDisabled_Refused(t *testing.T) {
	globalDir, customDir := ysmTestDirs(t)
	testutil.WriteTestFile(t, filepath.Join(globalDir, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(customDir, "X.disabled", "ysm.json"), "{}")

	err := PushSingleResource(filepath.Join(globalDir, "X"), customDir, globalDir, "copy", "ysm")
	testutil.NotNil(t, err, "目标侧处于禁用态时必须拒绝推送（否则另建活跃副本）")

	testutil.FileNotExists(t, filepath.Join(customDir, "X", "ysm.json"), "不得新建活跃副本")
	testutil.FileExists(t, filepath.Join(customDir, "X.disabled", "ysm.json"), "禁用载体不得被触碰")
}

// TestPushResources_DstDisabled_NoRevival 批量推送遇「实例侧整夹禁用」时**不得复活**：
// 单元级解法是禁用载体在 dirLevel 键里与活跃夹同键（relKeyDirLevel 剥尾段后缀）→ 判 Synced
// → 批量清单里没有它，压根不会去装。故此处断言的是**结果**（不新建活跃副本、不报错），
// 而非 ErrPartialSync。install 级的 D4 守卫是第二道防线（面板/拖拽/CLI 直接指定路径时命中），
// 由 TestPushSingleResource_DstDisabled_Refused 覆盖。
func TestPushResources_DstDisabled_NoRevival(t *testing.T) {
	base := t.TempDir()
	globalDir := filepath.Join(base, "ysm")
	targetDir := filepath.Join(base, "inst", ".minecraft", "config", "yes_steve_model", "custom")
	testutil.WriteTestFile(t, filepath.Join(targetDir, "X.disabled", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(globalDir, "X", "ysm.json"), "{}")

	count, err := PushResources("ysm", globalDir, targetDir, "copy", nil)
	testutil.NoError(t, err, "禁用载体与活跃夹同键 → 无待推送项，不应报错")
	testutil.Equal(t, count, 0, "不应有安装动作，实际 %d", count)

	testutil.FileNotExists(t, filepath.Join(targetDir, "X", "ysm.json"), "不得新建活跃副本（模型复活）")
	testutil.FileExists(t, filepath.Join(targetDir, "X.disabled", "ysm.json"), "禁用载体不得被触碰")
}

// TestPushSingleResource_DisabledAncestor_Refused 复核 P1-2 回归锁：实例把**容器夹**整体禁用
// （`custom/X.disabled/`，模型夹在其下 `X/sub`）时，推 `X/sub` 不得新建活跃副本——
// 只查目标自身孪生会落空（探针实证 err=nil 且复活）。必须上溯祖先载体。
func TestPushSingleResource_DisabledAncestor_Refused(t *testing.T) {
	globalDir, customDir := ysmTestDirs(t)
	testutil.WriteTestFile(t, filepath.Join(globalDir, "X", "sub", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(customDir, "X.disabled", "sub", "ysm.json"), "{}")

	err := PushSingleResource(filepath.Join(globalDir, "X", "sub"), customDir, globalDir, "copy", "ysm")
	testutil.NotNil(t, err, "祖先容器处于禁用态时必须拒绝推送（否则另建活跃副本）")

	testutil.FileNotExists(t, filepath.Join(customDir, "X", "sub", "ysm.json"), "不得新建活跃副本")
	testutil.FileExists(t, filepath.Join(customDir, "X.disabled", "sub", "ysm.json"), "禁用载体不得被触碰")
}

// TestPushSingleResource_StrayFileTwinNotRefused 同名杂散**文件** `X.disabled` 不是禁用载体，
// 不得据此拒绝正常推送（复核 P2-1：类型不敏感会误拒）。
func TestPushSingleResource_StrayFileTwinNotRefused(t *testing.T) {
	globalDir, customDir := ysmTestDirs(t)
	testutil.WriteTestFile(t, filepath.Join(globalDir, "X", "ysm.json"), "{}")
	testutil.WriteTestFile(t, filepath.Join(customDir, "X.disabled"), "stray")

	testutil.NoError(t, PushSingleResource(filepath.Join(globalDir, "X"), customDir, globalDir, "copy", "ysm"),
		"杂散同名文件不是禁用意图，不应拒绝推送")
	testutil.FileExists(t, filepath.Join(customDir, "X", "ysm.json"), "正常推送应落位")
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
