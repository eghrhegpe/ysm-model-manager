package cli

// bench_matrix_test.go — 类型矩阵（ADR-262 D3）：按 registry 类型挑样本、挑几个、跑谁不跑谁。
//
// 锁四件事：
//  1. 目标集由 Go 侧从 `scanner.ScanEntries` + `classifyForScan` 派生（发现权/类型判定各自单点），
//     排序确定（路径字典序）——测试与 AI 断言要可复现；
//  2. 矩阵**不伪造数字**：CLI 无解析器的类型（如 EntityPlayer/PMX）只出身份，stages 为空并给出
//     解释性 hint，而不是拿空模型的阶段耗时冒充实测；
//  3. 目录式模型（解包 YSM 目录）在矩阵里天然可用（scanner 折叠为 <dir>/ysm.json）；
//  4. `scanFirstModel` 认目录式入口（原实现只认扩展名白名单，纯解包仓库会「未找到模型」）。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/internal/app"
)

// writeDirFormYsm 造一个最小目录式 YSM 模型（ysm.json 清单；内容对分类与身份判定足够）。
func writeDirFormYsm(t *testing.T, root, name string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("建目录失败: %v", err)
	}
	entry := filepath.Join(dir, "ysm.json")
	if err := os.WriteFile(entry, []byte(`{"files":{}}`), 0o644); err != nil {
		t.Fatalf("写 ysm.json 失败: %v", err)
	}
	return entry
}

func TestScanBenchTargets_DeterministicAndTyped(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	writeDirFormYsm(t, root, "c_model")
	writeDirFormYsm(t, root, "a_model")
	writeDirFormYsm(t, root, "b_model")
	// CLI 不可分析的类型：默认目标集（rtype 空）不得收录，防「自动挑首个模型」挑到跑不动的
	pmxDir := filepath.Join(root, "mmd", "PMX")
	if err := os.MkdirAll(pmxDir, 0o755); err != nil {
		t.Fatal(err)
	}
	pmx := filepath.Join(pmxDir, "角色.pmx")
	if err := os.WriteFile(pmx, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	all := scanBenchTargets(root, "", 10)
	if len(all) != 3 {
		t.Fatalf("默认目标集应只含 CLI 可分析类型（3 个 ysm），got %d: %v", len(all), all)
	}
	if filepath.Base(filepath.Dir(all[0])) != "a_model" {
		t.Errorf("目标集应按路径字典序确定性排序, got %v", all)
	}

	limited := scanBenchTargets(root, "ysm", 2)
	if len(limited) != 2 {
		t.Fatalf("maxModels=2 应取前 2 个, got %d", len(limited))
	}
	if limited[0] != all[0] || limited[1] != all[1] {
		t.Errorf("截断应作用于排序后的前缀: %v vs %v", limited, all)
	}

	// 显式按不可分析类型扫：必须返回（由调用方标注 unsupported，而不是静默空结果）
	ep := scanBenchTargets(root, "EntityPlayer", 5)
	if len(ep) != 1 || ep[0] != pmx {
		t.Errorf("显式 rtype 应返回命中条目（含 CLI 不可分析类型）: got %v", ep)
	}
}

func TestScanFirstModel_DirForm(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	entry := writeDirFormYsm(t, root, "shen-fengling")
	if got := scanFirstModel(root); got != entry {
		t.Errorf("纯解包仓库应识别目录式入口 ysm.json: got %q want %q", got, entry)
	}
}

func TestSingleBench_MatrixByRtype_YsmFixtures(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ctx := &CmdContext{App: &app.App{}, FilesRoot: root}

	var err error
	out := captureOutput(t, func() { err = runSingleBenchMatrixJSON(ctx, "ysm", 2, 1) })
	if err != nil {
		t.Fatalf("矩阵模式报错: %v", err)
	}
	var m singleBenchMatrixJSON
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("矩阵载荷不是 JSON: %v\n%s", err, out)
	}
	if m.Spec.Rtype != "ysm" || !m.Spec.CliAnalyzable {
		t.Errorf("spec 应回显 ysm 且 cli_analyzable=true: %+v", m.Spec)
	}
	if m.Spec.MaxModels != 2 || m.Spec.Iterations != 1 {
		t.Errorf("spec 应回显实验规格: %+v", m.Spec)
	}
	if len(m.Models) != 2 || m.Spec.Analyzed != 2 || m.Spec.Unsupported != 0 {
		t.Fatalf("应采集 2 个模型: models=%d spec=%+v", len(m.Models), m.Spec)
	}
	for _, p := range m.Models {
		if p.Identity.Rtype != "ysm" || p.Identity.Form != "dir" {
			t.Errorf("身份块应为 ysm/dir: %+v", p.Identity)
		}
		if !strings.HasSuffix(filepath.ToSlash(p.Model), "/ysm.json") {
			t.Errorf("目录式目标应归一化为 <dir>/ysm.json: %q", p.Model)
		}
		if len(p.Stages) < 6 {
			t.Errorf("可分析类型应跑满阶段链: %d 阶段 %+v", len(p.Stages), p.Stages)
		}
	}
}

func TestSingleBench_Matrix_UnsupportedTypeNotFaked(t *testing.T) {
	root := t.TempDir()
	pmxDir := filepath.Join(root, "mmd", "PMX")
	if err := os.MkdirAll(pmxDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pmxDir, "角色.pmx"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx := &CmdContext{App: &app.App{}, FilesRoot: root}

	var err error
	out := captureOutput(t, func() { err = runSingleBenchMatrixJSON(ctx, "EntityPlayer", 5, 1) })
	if err != nil {
		t.Fatalf("矩阵模式报错: %v", err)
	}
	var m singleBenchMatrixJSON
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("矩阵载荷不是 JSON: %v\n%s", err, out)
	}
	if m.Spec.CliAnalyzable || m.Spec.Unsupported != 1 || m.Spec.Analyzed != 0 {
		t.Errorf("CLI 无解析器的类型应标 unsupported 且不采集: %+v", m.Spec)
	}
	if len(m.Models) != 1 {
		t.Fatalf("应出 1 条身份记录（不静默丢弃）: %d", len(m.Models))
	}
	got := m.Models[0]
	if got.Identity.Rtype != "EntityPlayer" || got.Identity.RtypeSource != "location" {
		t.Errorf("MMD 容器应按目录归属判 EntityPlayer: %+v", got.Identity)
	}
	if len(got.Stages) != 0 {
		t.Errorf("不可分析类型不得产出阶段耗时（空模型数据不是实测）: %+v", got.Stages)
	}
	if len(got.Hints) == 0 || !strings.Contains(got.Hints[0], "未采集") {
		t.Errorf("应给出解释性 hint: %+v", got.Hints)
	}
}

func TestSingleBench_Matrix_TextModeRejected(t *testing.T) {
	root := t.TempDir()
	writeDirFormYsm(t, root, "a_model")
	ctx := &CmdContext{App: &app.App{}, FilesRoot: root, Args: []string{"--rtype", "ysm"}}
	err := runSingleBench(ctx)
	if err == nil || !strings.Contains(err.Error(), "仅支持 --format json") {
		t.Errorf("矩阵模式在 text 输出下应明确拒绝, got %v", err)
	}
}

func TestSingleBench_ModelAndRtypeMutuallyExclusive(t *testing.T) {
	ctx := &CmdContext{
		App:       &app.App{},
		FilesRoot: t.TempDir(),
		Args:      []string{"--model", "x.ysm", "--rtype", "ysm", "--format", "json"},
	}
	err := runSingleBench(ctx)
	if err == nil || !strings.Contains(err.Error(), "互斥") {
		t.Errorf("--model 与 --rtype 应互斥, got %v", err)
	}
}

// TestPerfTypeManifest_Consistent 样本清单必须与 registry 一致：
// 清单 key 拼错 / 类型被删、可分析类型却没声明阶段链，都会让矩阵的自检依据失效。
func TestPerfTypeManifest_Consistent(t *testing.T) {
	t.Parallel()
	known := map[string]bool{}
	for _, rt := range registry.LoadRegistry().ResourceTypes {
		known[rt.ID] = true
	}
	for id, entry := range perfTypeManifest {
		if !known[id] {
			t.Errorf("清单登记了 registry 里不存在的类型 %q（拼写漂移或类型已删）", id)
		}
		if entry.CliAnalyzable && entry.ExpectedStages <= 0 {
			t.Errorf("可分析类型 %q 必须声明期望阶段链长度", id)
		}
		if !entry.CliAnalyzable && entry.ExpectedStages != 0 {
			t.Errorf("不可分析类型 %q 不应声明阶段链长度", id)
		}
	}
	if !cliAnalyzable("ysm") {
		t.Error("ysm 应有 CLI 分析链路")
	}
	if cliAnalyzable("EntityPlayer") {
		t.Error("EntityPlayer 的解析器在前端 adapter，CLI 不应判为可分析")
	}
	if rtypeDisplayName("ysm") == "" {
		t.Error("类型显示名应取自 registry")
	}
}

func TestSingleBench_AllTypes_Fixtures(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ctx := &CmdContext{App: &app.App{}, FilesRoot: root}

	var err error
	out := captureOutput(t, func() { err = runSingleBenchAllTypesJSON(ctx, 2, 1) })
	if err != nil {
		t.Fatalf("--all-types 报错: %v", err)
	}
	var m singleBenchMatrixJSON
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("矩阵载荷不是 JSON: %v\n%s", err, out)
	}
	if !m.Spec.AllTypes || m.Spec.Rtype != "" {
		t.Errorf("--all-types 应置 all_types 且不填单类型 rtype: %+v", m.Spec)
	}
	if len(m.Spec.Types) != 1 {
		t.Fatalf("fixtures 只有 ysm 类型, types 应为 1 项: %+v", m.Spec.Types)
	}
	sum := m.Spec.Types[0]
	if sum.Rtype != "ysm" || !sum.CliAnalyzable || sum.RtypeLabel != "YSM 模型" {
		t.Errorf("类型汇总应取自清单 + registry: %+v", sum)
	}
	if sum.Found < 2 || sum.Analyzed != 2 || sum.Unsupported != 0 {
		t.Errorf("应按 max-models=2 采集 2 条且 found 为截断前总数: %+v", sum)
	}
	if sum.ExpectedStages != 7 || sum.StageMismatch {
		t.Errorf("实际阶段链应与清单声明（7 段）一致: %+v", sum)
	}
	for _, p := range m.Models {
		if len(p.Stages) != 7 {
			t.Errorf("目录式 ysm 应产出 7 阶段: %d %+v", len(p.Stages), p.Stages)
		}
	}
}

func TestSingleBench_AllTypes_MutualExclusion(t *testing.T) {
	root := t.TempDir()
	writeDirFormYsm(t, root, "a_model")
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"--model 与 --all-types 互斥", []string{"--model", "x.ysm", "--all-types", "--format", "json"}, "互斥"},
		{"--rtype 与 --all-types 互斥", []string{"--rtype", "ysm", "--all-types", "--format", "json"}, "互斥"},
		{"矩阵模式拒绝 text 输出", []string{"--all-types"}, "仅支持 --format json"},
	}
	for _, tc := range cases {
		ctx := &CmdContext{App: &app.App{}, FilesRoot: root, Args: tc.args}
		err := runSingleBench(ctx)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: got %v", tc.name, err)
		}
	}
}
