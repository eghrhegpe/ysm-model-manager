// ===== 根级守卫测试（技术债排期 #1-3 的回归护栏，code_review P3 补测）=====
// MoveToRecycle 整仓入回收站 / findRecycleRoot 段语义——注入 configCache 提供 roots
package app

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/testutil"
)

// guardedApp 构造注入 configCache 的 App（各资源根指向 temp 子目录），复用 repoApp 注入样板
func guardedApp(t *testing.T) (*App, string) {
	t.Helper()
	base := t.TempDir()
	// ADR-092 两层路由：ysm 根在 FilesRoot/{group}/{storageSubDir}
	ysm := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysm, 0755); err != nil {
		testutil.NoError(t, err)
	}
	a := repoApp(t, types.AppConfig{
		FilesRoot:        base,
		ResourcepackRoot: filepath.Join(base, "resourcepacks"),
		ShaderpackRoot:   filepath.Join(base, "shaderpacks"),
		SchematicRoot:    filepath.Join(base, "schematics"),
		MmdRoot:          filepath.Join(base, "mmd"),
		VrcRoot:          filepath.Join(base, "vrc"),
	})
	return a, ysm
}

// migratedApp 构造迁移后状态的 App（废弃字段已清空，CustomRoots 为唯一事实源）
func migratedApp(t *testing.T, customRoots map[string]string) (*App, string) {
	t.Helper()
	base := t.TempDir()
	ysm := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(ysm, 0755); err != nil {
		testutil.NoError(t, err)
	}
	a := repoApp(t, types.AppConfig{
		FilesRoot:   base,
		CustomRoots: customRoots,
	})
	return a, ysm
}

func TestMoveToRecycle_RootRejected(t *testing.T) {
	a, ysm := guardedApp(t)
	err := a.MoveToRecycle(ysm)
	testutil.NotNil(t, err, "MoveToRecycle(资源根) 应拒绝")
	if !strings.Contains(err.Error(), "资源根目录整体移入回收站") {
		t.Fatalf("应提示根级拒绝, got %v", err)
	}
	// 根目录未被移走（.recycle 不应出现在根本身下）
	if _, err := os.Stat(filepath.Join(ysm, ".recycle")); err == nil {
		t.Fatal("根目录不得被移入回收站")
	}
}

func TestFindRecycleRoot_RootNotMatched(t *testing.T) {
	a, ysm := guardedApp(t)
	// src == root → 不判命中（返回 ""，调用方 fallback ysmRoot 后 Clean 相等拒绝）
	if got := a.findRecycleRoot(ysm); got != "" {
		t.Fatalf("src==root 不应判命中, got %q", got)
	}
	// src 在根内合法子目录 → 命中
	sub := filepath.Join(ysm, "..foo", "m.ysm") // ..foo 合法名（精确段比较不误拒）
	if got := a.findRecycleRoot(sub); got != ysm {
		t.Fatalf("..foo 子目录应命中根, got %q", got)
	}
	// 外部路径 → 不命中
	outside := filepath.Join(filepath.Dir(ysm), "..", "outside", "x.ysm")
	if got := a.findRecycleRoot(outside); got != "" {
		t.Fatalf("外部路径不应命中, got %q", got)
	}
}

// TestFindRecycleRoot_CustomRootsIncluded 回归护栏（codereview 批次3 P2）：
// migrateLegacyConfigFields 已清空废弃字段（ResourcepackRoot 等），回收站根列表
// 必须纳入 CustomRoots——否则迁移后 MMD/VRC 等自定义根下的回收条目静默消失。
func TestFindRecycleRoot_CustomRootsIncluded(t *testing.T) {
	mmdCustom := filepath.Join(t.TempDir(), "mmd-custom")
	if err := os.MkdirAll(mmdCustom, 0755); err != nil {
		testutil.NoError(t, err)
	}
	a, _ := migratedApp(t, map[string]string{"mmd": mmdCustom})

	inCustom := filepath.Join(mmdCustom, "model", "char.pmx")
	if got := a.findRecycleRoot(inCustom); got != mmdCustom {
		t.Fatalf("CustomRoots 内的文件应命中自定义根, got %q want %q", got, mmdCustom)
	}
	// allRecycleRoots 同样须包含 CustomRoots 条目（ListRecycleBin/Restore 等依赖它）
	cfg := a.LoadAppConfig()
	roots := a.allRecycleRoots(cfg)
	found := false
	for _, r := range roots {
		if r == mmdCustom {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("allRecycleRoots 应包含 CustomRoots 条目 %q, got %v", mmdCustom, roots)
	}
}

// TestFindRecycleRoot_EmptyCustomRoots 验证空 CustomRoots 时行为正确
func TestFindRecycleRoot_EmptyCustomRoots(t *testing.T) {
	a, ysm := migratedApp(t, map[string]string{})
	// 无 CustomRoots，只应有默认 ysm 根
	cfg := a.LoadAppConfig()
	roots := a.allRecycleRoots(cfg)
	if len(roots) != 1 || roots[0] != ysm {
		t.Fatalf("空 CustomRoots 应只返回默认根 %q, got %v", ysm, roots)
	}
}

// TestRecycleRoots_SameAsAllRecycleRoots（2026-10-15 锐评收敛）：
// 「根级自卫 / 归属判定」看的根集合与「列表 / 清空」看的根集合**必须同答**——两者分叉正是
// bf3c8a2e2 修的那类绕过的复发通道（守卫看的根集合 ≠ 归属判定看的根集合）。
// 原实现是两份逐字相近的枚举，注释自己写着「各自拼 roots 会漂移」；现 recycleRoots 直接
// 委托 allRecycleRoots，本用例把「同答」钉成不变量：任何一侧单独加派生根即当场转红。
func TestRecycleRoots_SameAsAllRecycleRoots(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{
		FilesRoot:   base,
		CustomRoots: map[string]string{"mmd": filepath.Join(base, "mmd"), "vrc": filepath.Join(base, "vrc")},
	})
	got := append([]string(nil), a.recycleRoots()...)
	want := a.allRecycleRoots(a.LoadAppConfig())
	sort.Strings(got)
	sort.Strings(want)
	if len(got) != len(want) {
		t.Fatalf("两份根枚举集合不一致（分叉即绕过复发通道）: recycleRoots=%v allRecycleRoots=%v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("两份根枚举集合不一致: recycleRoots=%v allRecycleRoots=%v", got, want)
		}
	}
	// 非空自检：枚举确实覆盖默认根 + 两个 CustomRoot，防「两边都空」的假绿
	if len(got) != 3 {
		t.Fatalf("根枚举应含默认根 + 2 个 CustomRoot（共 3）, got %v", got)
	}
}

// TestFindRecycleRoot_MostSpecificRootWins（2026-10-15 归属规则收敛）：
// 归属 = **最具体（最深）匹配根**，与 app_files.go|toggleRootFor 同一条规则。原「首个命中」
// 实现在两个互相嵌套的 CustomRoots 下结论随 Go map 遍历序**随机漂移**（同一文件的回收站
// 落点在内层/外层之间不定），故本用例反复求值 50 次——旧实现被抓住的概率 ≈ 1-2⁻⁵⁰。
func TestFindRecycleRoot_MostSpecificRootWins(t *testing.T) {
	base := t.TempDir()
	outer := filepath.Join(base, "mmd")
	inner := filepath.Join(outer, "entity")
	a := repoApp(t, types.AppConfig{
		FilesRoot:   base,
		CustomRoots: map[string]string{"mmd": outer, "entityplayer": inner},
	})

	src := filepath.Join(inner, "char.pmx")
	for i := 0; i < 50; i++ {
		if got := a.findRecycleRoot(src); got != inner {
			t.Fatalf("第 %d 次：应稳定命中最深根 %q，实得 %q（「首个命中」实现随 map 遍历序漂移）", i, inner, got)
		}
	}
	// 防「一律取最内层」的误读：外层根直属文件仍归外层根
	if got := a.findRecycleRoot(filepath.Join(outer, "loose.pmx")); got != outer {
		t.Fatalf("外层根直属文件应归外层根 %q，实得 %q", outer, got)
	}
	// 一概念一规则：同一路径在启禁链（toggleRootFor）与回收链（findRecycleRoot）必须同答，
	// 否则又是「同概念两套口径」。两函数根集合不同，但**规则**必须一致。
	if got, want := a.findRecycleRoot(src), a.toggleRootFor(src); got != want {
		t.Fatalf("回收链归属 %q 与启禁链归属 %q 不一致（最具体根规则漂移）", got, want)
	}
}

// TestMoveToRecycle_OuterCustomRootCannotAdoptInnerRoot 核心回归锁（2026-10-15 复核实测复现）：
// 守卫若只比「findRecycleRoot 返回的那一个根」，外层 CustomRoot 严格包含 ysmRoot 时即被绕过——
// findRecycleRoot 对 rel=="." 是 continue（不判命中），于是跳过内层根、返回外层根，src（内层根）
// 与外层根不相等 → 整个 ysmRoot 被 rename 进外层根的 .recycle（可恢复，但属整仓库级误动）。
// 判据改为「src 不得等于任一已知根」后必须拒绝，且磁盘上分毫未动。
// 与 TestMoveToRecycle_RootRejected 的分工：那条只覆盖「无外层根本时 src==ysmRoot」，
// 构不出本绕过条件（见前置断言）。
func TestMoveToRecycle_OuterCustomRootCannotAdoptInnerRoot(t *testing.T) {
	base := t.TempDir()
	// FilesRoot=base，且另一个类型的 CustomRoot 也指向 base → 外层根严格包含 ysmRoot
	a := repoApp(t, types.AppConfig{FilesRoot: base, CustomRoots: map[string]string{"maid-model": base}})
	ysm := filepath.Join(base, registry.GroupStorageRoot("ysm"))
	if err := os.MkdirAll(filepath.Join(ysm, "Group", "sub"), 0o755); err != nil {
		testutil.NoError(t, err)
	}
	payload := filepath.Join(ysm, "Group", "sub", "a.ysm")
	if err := os.WriteFile(payload, []byte("payload"), 0o644); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(filepath.Join(ysm, "ysm.json"), []byte("{}"), 0o644); err != nil {
		testutil.NoError(t, err)
	}

	// 前置断言：夹具确实构成绕过条件（归属判定跳过内层根、选中外层根）。
	// 少了这条，夹具没搭出场景时会「假绿」——守卫压根没被考验。
	if got := a.findRecycleRoot(ysm); got != base {
		t.Fatalf("夹具异常：findRecycleRoot(ysmRoot) 应返回外层根 %q 才构成绕过条件, got %q", base, got)
	}

	err := a.MoveToRecycle(ysm)
	testutil.NotNil(t, err, "外层 CustomRoot 不得让内层仓库根被整体移入回收站")
	if !strings.Contains(err.Error(), "资源根目录整体移入回收站") {
		t.Fatalf("应提示根级拒绝, got %v", err)
	}
	// 内层根仍在原位、内容完整
	testutil.FileExists(t, filepath.Join(ysm, "ysm.json"), "拒绝后 ysmRoot 入口文件必须仍在")
	testutil.FileExists(t, payload, "拒绝后 ysmRoot 内文件必须仍在")
	// 外层根的 .recycle 下不得出现被收编的仓库根（落点 = <外层根>/.recycle/<Rel(base,ysm)>）
	adopted := filepath.Join(base, ".recycle", registry.GroupStorageRoot("ysm"))
	if _, serr := os.Stat(adopted); !os.IsNotExist(serr) {
		t.Errorf("外层根 .recycle 不得收编内层仓库根 %s: %v", adopted, serr)
	}
}

// TestMoveToRecycle_NormalFileStillWorks 防误伤：新增的「src 不得等于任一已知根」循环不得把
// 普通路径误判成根（尤其外层 CustomRoot 存在、根集合有多条时）。顺带锁「归属语义未变」：
// 内层根内的文件仍落进**内层根**的 .recycle——本次修复只堵绕过，不动归属。
// （既有 TestMoveToRecycle_Success 只用单根配置且未断言 .recycle 落点，故另立本例而非改它。）
func TestMoveToRecycle_NormalFileStillWorks(t *testing.T) {
	base := t.TempDir()
	a := repoApp(t, types.AppConfig{FilesRoot: base, CustomRoots: map[string]string{"maid-model": base}})
	root := repoRootFor(t, a, "ysm")
	src := filepath.Join(root, "Group", "model.ysm")
	if err := os.MkdirAll(filepath.Dir(src), 0o755); err != nil {
		testutil.NoError(t, err)
	}
	if err := os.WriteFile(src, []byte("payload"), 0o644); err != nil {
		testutil.NoError(t, err)
	}

	testutil.NoError(t, a.MoveToRecycle(src), "普通文件仍应能移入回收站")
	if _, serr := os.Stat(src); !os.IsNotExist(serr) {
		t.Errorf("回收后源文件应已移走, got %v", serr)
	}
	testutil.FileExists(t, filepath.Join(root, ".recycle", "Group", "model.ysm"),
		"回收后文件应落在内层根 .recycle（归属语义未变）")
}
