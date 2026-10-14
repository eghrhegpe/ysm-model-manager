// repoaudit_casesib_test.go：大小写孪生路径告警（P2，2026-10-14）。
//
// 覆盖面说明（诚实边界）：同目录仅大小写不同的 Pack/ 与 pack/ 在大小写不敏感
// 文件系统（Windows/NTFS，本仓 CI 与主战场）上**物理无法创建**（第二次 Mkdir 命中
// 同一目录），端到端孪生夹具只能在大小写敏感文件系统（Linux）上构造。故本测试钉住
// 可跨平台验证的两段逻辑：①③④ caseSiblingWarnings 纯函数语义（分组→告警确定性，
// 含 2026-10-14 扩面后的「祖先目录大小写分叉」形态）；② 常规仓库树零误报。
// 折叠面 = 小写**相对路径**（与 go/sync relKey/relKeyDirLevel 的键折叠面同构）。
package repoaudit

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// ① 纯函数：同组多原路径 → 一条告警点名首末；单原路径组静默；多组按折叠键排序。
func TestCaseSiblingWarnings_Pure(t *testing.T) {
	groups := map[string]map[string]struct{}{
		"mmd/pack": {"mmd/Pack": {}, "mmd/pack": {}},
		"mmd/anim": {"mmd/Anim": {}, "mmd/anim": {}},
		"ysm/solo": {"ysm/solo": {}}, // 单原路径 → 不得告警
	}
	got := caseSiblingWarnings(groups)
	if len(got) != 2 {
		t.Fatalf("期望 2 条告警（pack 组 + anim 组），实际 %d：%v", len(got), got)
	}
	// 确定性排序：按折叠键（mmd/anim < mmd/pack）
	if !strings.Contains(got[0], "mmd/anim") {
		t.Fatalf("第 1 条应为 anim 组（折叠键序）：%v", got)
	}
	if !strings.Contains(got[1], "mmd/Pack") || !strings.Contains(got[1], "mmd/pack") {
		t.Fatalf("第 2 条应为 pack 组且点名组内首末原路径：%v", got)
	}
}

// ② 常规仓库树（无孪生）：Audit 不得发大小写告警（Windows 主战场零误报锁）。
func TestAudit_CaseSiblingNoFalsePositive(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "mmd", "PMX"))
	testutil.WriteTestFile(t, filepath.Join(root, "mmd", "PMX", "model.pmx"), "x")
	mkdirAll(t, filepath.Join(root, "ysm"))
	testutil.WriteTestFile(t, filepath.Join(root, "ysm", "model.ysm"), "x")

	res, err := AuditCtx(context.Background(), root)
	if err != nil {
		t.Fatalf("Audit 失败: %v", err)
	}
	for _, w := range res.Warnings {
		if strings.Contains(w, "大小写孪生") {
			t.Fatalf("常规树误报大小写孪生告警：%v", res.Warnings)
		}
	}
}

// ③ 单原路径组静默（防「每个条目都告警」回归）。
func TestCaseSiblingWarnings_SingleNameSilent(t *testing.T) {
	groups := map[string]map[string]struct{}{
		"a": {"a": {}},
	}
	if got := caseSiblingWarnings(groups); len(got) != 0 {
		t.Fatalf("单原路径组不得告警：%v", got)
	}
}

// ④ 祖先目录大小写分叉（2026-10-14 扩面）：A/x.ysm 与 a/x.ysm 小写相对路径同键，
// 必须告警——旧 (父目录, 基名) 分组形态下此例两条分属不同父目录组、双双漏网。
func TestCaseSiblingWarnings_AncestorCaseSplit(t *testing.T) {
	groups := map[string]map[string]struct{}{
		"a/x.ysm": {"A/x.ysm": {}, "a/x.ysm": {}},
	}
	got := caseSiblingWarnings(groups)
	if len(got) != 1 {
		t.Fatalf("祖先分叉须 1 条告警，实际 %d：%v", len(got), got)
	}
	if !strings.Contains(got[0], "A/x.ysm") || !strings.Contains(got[0], "a/x.ysm") {
		t.Fatalf("告警须点名两侧原路径：%v", got)
	}
}

func mkdirAll(t *testing.T, p string) {
	t.Helper()
	if err := os.MkdirAll(p, 0o755); err != nil {
		testutil.NoError(t, err)
	}
}
