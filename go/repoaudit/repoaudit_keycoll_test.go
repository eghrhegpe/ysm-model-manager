// repoaudit_keycoll_test.go：dirLevel 身份键碰撞告警（P0，2026-10-14 面板接线）。
//
// 与 P2 大小写孪生不同：P0 的「同级同 stem 不同扩展名」（model_a.pmx + model_a.pmd）
// 在**任意文件系统上都是两个物理文件**，端到端夹具可跨平台构造。钉三段：
// ① keyCollisionWarnings 纯函数语义（≥2 不同扩展名告警且点名首末 / 单扩展名组静默——
//
//	纯大小写变体组属 P2 孪生检测器，不重复）；② e2e：Audit 对 PMX/model_a.pmx+model_a.pmd
//	夹具必产 dirLevel 键碰撞告警且恰好一条点名双文件；③ 单扩展名树零误报。
//
// 检测口径（repoaudit.go walk 累积块注释）：只记「判型确定 + dirLevelSync + 非容器扩展」
// 的文件——容器 .zip/.7z 的类型判定走 zipentry 内容指纹、剥扩展名不是其键，不纳入。
package repoaudit

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// ① 纯函数：组内 ≥2 种扩展名 → 一条告警点名首末还原文件名；单扩展名组静默；多组按 (rtype, 组键) 确定性排序。
func TestKeyCollisionWarnings_Pure(t *testing.T) {
	groups := map[string]map[string]map[string]struct{}{
		"EntityPlayer": {
			"repo\\PMX\x00model_a": {".pmx": {}, ".pmd": {}},
			"repo\\PMX\x00solo":    {".pmx": {}}, // 单扩展名 → 静默（P2 的形态）
		},
		"ysm": {
			"repo\\ysm\x00b": {".ysm": {}, ".json": {}, ".7z": {}}, // 3 种 → 点名首末 + 计数
		},
	}
	got := keyCollisionWarnings(groups)
	testutil.Equal(t, len(got), 2, "期望 2 条告警（EntityPlayer/model_a + ysm/b），实际 %d：%v", len(got), got)
	// 确定性排序：rtype 升序（EntityPlayer < ysm）
	// OR 拆序贯：len==2 已由上一 Equal 保证（失败即 Goexit），[0]/[1] 索引安全
	testutil.Equal(t, strings.Contains(got[0], "model_a.pmx"), true, "第 1 条应为 EntityPlayer 组且点名两个文件名：%v", got)
	testutil.Equal(t, strings.Contains(got[0], "model_a.pmd"), true, "第 1 条应为 EntityPlayer 组且点名两个文件名：%v", got)
	testutil.Equal(t, strings.Contains(got[1], "b.ysm"), true, "第 2 条应为 ysm 组且点名首末（.ysm/.7z，.json 省略）：%v", got)
	testutil.Equal(t, strings.Contains(got[1], "b.7z"), true, "第 2 条应为 ysm 组且点名首末（.ysm/.7z，.json 省略）：%v", got)
	// 单扩展名组不得出现
	for _, w := range got {
		testutil.Equal(t, strings.Contains(w, "solo"), false, "单扩展名组误报：%v", got)
	}
}

// ② e2e：同 stem 不同扩展名同级并存必须被 Audit 检出（跨平台可造夹具）。
// 用 EntityPlayer 存储子目录 PMX：TypeByLocation 对 <root>/PMX/*.pmx|*.pmd 判 EntityPlayer
// （dirLevelSync 类型），两文件同 stem model_a、扩展名 .pmx/.pmd 两种 → 碰撞组。
func TestAudit_KeyCollisionDetected(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "PMX"))
	testutil.WriteTestFile(t, filepath.Join(root, "PMX", "model_a.pmx"), "x")
	testutil.WriteTestFile(t, filepath.Join(root, "PMX", "model_a.pmd"), "x")

	res, err := AuditCtx(context.Background(), root)
	testutil.NoError(t, err, "Audit 失败")
	hit := 0
	for _, w := range res.Warnings {
		if strings.Contains(w, "model_a.pmx") && strings.Contains(w, "model_a.pmd") {
			hit++
		}
	}
	testutil.Equal(t, hit, 1, "期望恰好 1 条 dirLevel 键碰撞告警点名双文件，实际 %d：%v", hit, res.Warnings)
}

// ③ 单文件 / 单扩展名树零误报（P0 检测器不得把常规树当碰撞）。
func TestAudit_KeyCollisionNoFalsePositive(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "PMX"))
	testutil.WriteTestFile(t, filepath.Join(root, "PMX", "solo.pmx"), "x")

	res, err := AuditCtx(context.Background(), root)
	testutil.NoError(t, err, "Audit 失败")
	for _, w := range res.Warnings {
		testutil.Equal(t, strings.Contains(w, "dirLevel 键碰撞"), false, "单扩展名树误报键碰撞告警：%v", res.Warnings)
	}
}

// 同 stem 但分属不同 rtype（.pmx=EntityPlayer 与 .ysm=ysm）不得互撞——键空间 per-rtype。
func TestAudit_KeyCollisionAcrossTypesNoWarn(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "PMX"))
	testutil.WriteTestFile(t, filepath.Join(root, "PMX", "duo.pmx"), "x")
	mkdirAll(t, filepath.Join(root, "ysm"))
	testutil.WriteTestFile(t, filepath.Join(root, "ysm", "duo.ysm"), "x")

	res, err := AuditCtx(context.Background(), root)
	testutil.NoError(t, err, "Audit 失败")
	for _, w := range res.Warnings {
		testutil.Equal(t, strings.Contains(w, "duo"), false, "跨 rtype 同 stem 误报（键空间互不相交）：%v", res.Warnings)
	}
}

// mkdirAll 复用同包 repoaudit_casesib_test.go 的定义（同包共用 helper，勿重复声明）
