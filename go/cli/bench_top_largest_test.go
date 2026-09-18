package cli

// bench_top_largest_test.go — 「全库前 N 大」目标集（ADR-262 D3 第三种目标集）。
//
// 锁四件事：
//  1. 排名用**模型占用**而不是入口文件大小：目录式模型的 ModelEntry.Size 是 115B 级清单，
//     按它排会把最大的解包模型排到最后（本文件用「按占用」与「按清单大小」序**相反**的命名做判别）；
//  2. 同体量按路径升序兜底 → 目标集确定可复现；
//  3. 候选池是**全库**：CLI 不可分析的类型照实入选并标 unsupported，不静默丢（否则「最大的模型」
//     恰好是 PMX 时用户看到的是空报告而无人解释）；
//  4. 载荷回显口径：spec.top_largest / spec.size_source，models[] 按排名顺序。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/internal/app"
)

// writeFileBytes 在指定路径写指定字节数的文件（造体量差）。
func writeFileBytes(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, size), 0o644); err != nil {
		t.Fatal(err)
	}
}

// 判别性设计：目录式模型的名字故意与「按占用排序」相反——
//   - `m_packed.ysm` 30KB（打包文件，占用 = 文件大小）
//   - `z_big` 目录式：清单 11B + 内部 5000B（占用 5011B，但 ModelEntry.Size 只有 11B）
//   - `a_small` 目录式：只有清单（占用 11B）
//
// 按占用：m_packed → z_big → a_small
// 按清单大小：m_packed → a_small → z_big（字典序兜底）——两者不同，故此用例能抓住「按 Size 排」的错。
func TestScanTopLargestTargets_RanksByFootprintNotManifestSize(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	packed := filepath.Join(root, "m_packed.ysm")
	writeFileBytes(t, packed, 30000)
	bigDir := writeDirFormYsm(t, root, "z_big")
	writeFileBytes(t, filepath.Join(root, "z_big", "models", "main.json"), 5000)
	smallDir := writeDirFormYsm(t, root, "a_small")

	targets, found := scanTopLargestTargets(root, 3)
	if len(targets) != 3 {
		t.Fatalf("应取到 3 条, got %d: %+v", len(targets), targets)
	}
	want := []string{packed, bigDir, smallDir}
	for i, w := range want {
		if targets[i].Path != w {
			t.Fatalf("第 %d 名应为 %s（按占用降序）, got %s\n完整: %+v", i+1, w, targets[i].Path, targets)
		}
	}
	if targets[1].Footprint <= targets[2].Footprint {
		t.Errorf("目录式模型占用必须含内部文件: z_big=%d a_small=%d", targets[1].Footprint, targets[2].Footprint)
	}
	if found["ysm"] != 3 {
		t.Errorf("found 应统计全库该类型总数（未截断）, got %+v", found)
	}
}

func TestScanTopLargestTargets_TieBreakByPathAndCap(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	// 同占用（清单同长）→ 只能靠路径升序保证可复现
	bEntry := writeDirFormYsm(t, root, "b_model")
	aEntry := writeDirFormYsm(t, root, "a_model")

	targets, _ := scanTopLargestTargets(root, 1)
	if len(targets) != 1 || targets[0].Path != aEntry {
		t.Fatalf("截断应保留路径较小者, got %+v", targets)
	}

	targets2, _ := scanTopLargestTargets(root, 5)
	if len(targets2) != 2 {
		t.Fatalf("上限大于候选数时返回全部, got %d", len(targets2))
	}
	if targets2[0].Path != aEntry || targets2[1].Path != bEntry {
		t.Errorf("同占用应按路径升序, got %s / %s", targets2[0].Path, targets2[1].Path)
	}

	// 参数守卫：非正数不返回目标（避免「前 0 大」跑出空报告还标成功）
	if got, _ := scanTopLargestTargets(root, 0); got != nil {
		t.Errorf("n=0 应返回 nil, got %+v", got)
	}
	if got, _ := scanTopLargestTargets("", 3); got != nil {
		t.Errorf("filesRoot 为空应返回 nil, got %+v", got)
	}
}

func TestScanTopLargestTargets_IncludesNonAnalyzableTypes(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	writeDirFormYsm(t, root, "a_model")
	// PMX 只在**前端 3D adapter** 有解析器（CLI 拿到空模型）：仍应入选全库池，由载荷标 unsupported
	pmx := filepath.Join(root, "mmd", "PMX", "角色.pmx")
	writeFileBytes(t, pmx, 90000)

	targets, found := scanTopLargestTargets(root, 2)
	if len(targets) != 2 {
		t.Fatalf("应取 2 条, got %+v", targets)
	}
	if targets[0].Path != pmx {
		t.Errorf("最大者应是 90KB 的 PMX（不因 CLI 不可分析而被静默排除）, got %s", targets[0].Path)
	}
	if targets[0].Rtype == "ysm" {
		t.Errorf("PMX 的类型判定应来自 classifyForScan, got %q", targets[0].Rtype)
	}
	if found[targets[0].Rtype] != 1 {
		t.Errorf("found 应含不可分析类型的计数, got %+v", found)
	}
}

func TestRunSingleBenchTopLargest_JSONShape(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ctx := &CmdContext{App: &app.App{}, FilesRoot: root, Args: []string{"--top-largest", "2", "--format", "json"}}

	var err error
	out := captureOutput(t, func() { err = runSingleBench(ctx) })
	if err != nil {
		t.Fatalf("--top-largest 报错: %v", err)
	}
	var m singleBenchMatrixJSON
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatalf("载荷不是纯 JSON: %v\n%s", err, out)
	}
	if m.Spec.TopLargest != 2 {
		t.Errorf("spec.top_largest 应回显 2, got %d", m.Spec.TopLargest)
	}
	if m.Spec.SizeSource != perfSizeSourceDirTotal {
		t.Errorf("spec.size_source 应回显口径 token %q, got %q", perfSizeSourceDirTotal, m.Spec.SizeSource)
	}
	if m.Spec.AllTypes || m.Spec.Rtype != "" {
		t.Errorf("前 N 大不是按类型取样: all_types=%v rtype=%q", m.Spec.AllTypes, m.Spec.Rtype)
	}
	if len(m.Models) != 2 {
		t.Fatalf("应采集 2 条, got %d", len(m.Models))
	}
	for _, p := range m.Models {
		if len(p.Stages) != 7 {
			t.Errorf("目录式 ysm 应产出 7 阶段: %s → %d", p.Model, len(p.Stages))
		}
	}
	if m.Spec.Analyzed != 2 || m.Spec.Unsupported != 0 {
		t.Errorf("fixtures 全是可分析类型: %+v", m.Spec)
	}
	if len(m.Spec.Types) != 1 || m.Spec.Types[0].Rtype != "ysm" {
		t.Errorf("types 汇总应只有 ysm: %+v", m.Spec.Types)
	}
	if m.Spec.Types[0].Found < 2 {
		t.Errorf("found 应是全库该类型总数（未截断）, got %d", m.Spec.Types[0].Found)
	}
}

// 载荷里的 models[] 必须按排名顺序（前 N 大的意义就在「谁最大」，
// 顺序若按类型归并就丢了这个信息），且与独立扫描的结果一致。
func TestRunSingleBenchTopLargest_ModelOrderMatchesRanking(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ranked, _ := scanTopLargestTargets(root, 2)
	if len(ranked) < 2 {
		t.Skipf("fixtures 不足 2 条模型: %+v", ranked)
	}
	ctx := &CmdContext{App: &app.App{}, FilesRoot: root, Args: []string{"--top-largest", "2", "--format", "json"}}
	var err error
	out := captureOutput(t, func() { err = runSingleBench(ctx) })
	if err != nil {
		t.Fatalf("--top-largest 报错: %v", err)
	}
	var m singleBenchMatrixJSON
	if err := json.Unmarshal([]byte(out), &m); err != nil {
		t.Fatal(err)
	}
	for i, p := range m.Models {
		if p.Model != ranked[i].Path {
			t.Errorf("models[%d] 应为排名第 %d 的 %s, got %s", i, i+1, ranked[i].Path, p.Model)
		}
	}
}

func TestSingleBench_TopLargest_MutualExclusionAndGuards(t *testing.T) {
	root := t.TempDir()
	writeDirFormYsm(t, root, "a_model")
	cases := []struct {
		name string
		args []string
		want string
	}{
		{"--model 与 --top-largest 互斥", []string{"--model", "x.ysm", "--top-largest", "3", "--format", "json"}, "互斥"},
		{"--rtype 与 --top-largest 互斥", []string{"--rtype", "ysm", "--top-largest", "3", "--format", "json"}, "互斥"},
		{"--all-types 与 --top-largest 互斥", []string{"--all-types", "--top-largest", "3", "--format", "json"}, "互斥"},
		{"--max-models 与 --top-largest 互斥（都表示取几条）", []string{"--top-largest", "3", "--max-models", "2", "--format", "json"}, "互斥"},
		{"前 N 大拒绝 text 输出", []string{"--top-largest", "3"}, "仅支持 --format json"},
		{"前 N 大需要 files-root", []string{"--top-largest", "3", "--format", "json"}, "files-root"},
	}
	for _, tc := range cases {
		ctx := &CmdContext{App: &app.App{}, FilesRoot: root, Args: tc.args}
		if strings.HasSuffix(tc.name, "files-root") {
			ctx.FilesRoot = ""
		}
		err := runSingleBench(ctx)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: want 含 %q, got %v", tc.name, tc.want, err)
		}
	}
}
