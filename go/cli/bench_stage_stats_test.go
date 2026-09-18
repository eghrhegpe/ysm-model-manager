package cli

// bench_stage_stats_test.go — 阶段样本统计与 runtime 归属（ADR-262 D2）。
//
// ADR-262 D2 要求每个阶段必须携带 `runtime`（go|rust|wasm|js|three）与样本统计
// （n / median / p95，实测才允许有分位数）。此前二者皆缺：
//   - `singleBenchStage` 只有 Name/Duration/Bytes/Notes/Failed，`stages` 是 N 轮平均，
//     样本被 `avgBenchStages` 当场平均掉 —— 「无样本统计、无方差可言」（ADR-262 §背景 #6）；
//   - 阶段没有归属字段，Go / Rust / WASM / Three 的耗时构成是黑箱，
//     「Rust 扫描器与 WASM 解析器的收益可被度量」这一正面后果无从兑现（ADR-262 §后果）。
//
// 本文件锁三件事：
//  1. `collectStageStats` 的分位数口径（最近秩法）与结构不变量 `p95 >= median`（ADR-262 D6）；
//  2. runtime 归属在聚合（avgBenchStages）与出荷（stagesToJSON）两段都不丢；
//  3. gui-flow 的 runtime 归属：扫描阶段报**实际扫描后端**（非想当然的 go）、
//     ⑥ 渲染预估归 three（它是 Three.js 阶段的估算，估算性质由 kind 承载）。

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// stageSamples 造一组「同一阶段在 N 轮迭代中的样本」。
func stageSamples(name string, durs ...time.Duration) [][]singleBenchStage {
	out := make([][]singleBenchStage, 0, len(durs))
	for _, d := range durs {
		out = append(out, []singleBenchStage{{Name: name, Duration: d, Runtime: "go"}})
	}
	return out
}

func TestCollectStageStats_NearestRank(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		durs       []time.Duration
		wantN      int
		wantMedian float64
		wantP95    float64
	}{
		// n=1 退化但如实：median=p95=该唯一样本，消费者据 n 自行判断可信度
		{name: "n=1 退化", durs: []time.Duration{7 * time.Millisecond}, wantN: 1, wantMedian: 7, wantP95: 7},
		// 最近秩：median 取 ceil(0.5*2)-1=0 号，p95 取 ceil(1.9)-1=1 号
		{name: "n=2", durs: []time.Duration{1 * time.Millisecond, 2 * time.Millisecond}, wantN: 2, wantMedian: 1, wantP95: 2},
		// 升序输入只是巧合规避排序问题，故用例全部乱序给
		{name: "n=3", durs: []time.Duration{3 * time.Millisecond, 1 * time.Millisecond, 2 * time.Millisecond}, wantN: 3, wantMedian: 2, wantP95: 3},
		{name: "n=4", durs: []time.Duration{40 * time.Millisecond, 10 * time.Millisecond, 30 * time.Millisecond, 20 * time.Millisecond}, wantN: 4, wantMedian: 20, wantP95: 40},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := collectStageStats(stageSamples("① 文件读取", tc.durs...))
			st, ok := got["① 文件读取"]
			if !ok {
				t.Fatalf("缺少阶段统计: %+v", got)
			}
			if st.N != tc.wantN {
				t.Errorf("n = %d, 期望 %d", st.N, tc.wantN)
			}
			if st.Median != tc.wantMedian {
				t.Errorf("median = %v, 期望 %v", st.Median, tc.wantMedian)
			}
			if st.P95 != tc.wantP95 {
				t.Errorf("p95 = %v, 期望 %v", st.P95, tc.wantP95)
			}
			// ADR-262 D6：断言只锁结构不变量。最近秩对 p 单调 → 该不变量对任意 n 恒成立
			if st.P95 < st.Median {
				t.Errorf("p95(%.2f) 必须 >= median(%.2f)", st.P95, st.Median)
			}
		})
	}
}

// TestCollectStageStats_RaggedAndEmpty 阶段并非每轮都出现（如失败提前返回）时，
// n 必须如实反映实际出现次数，而不是迭代轮数。
func TestCollectStageStats_RaggedAndEmpty(t *testing.T) {
	t.Parallel()

	if got := collectStageStats(nil); len(got) != 0 {
		t.Errorf("空输入应得空表, got %+v", got)
	}

	// 1 轮有 ①②，另 1 轮只有 ①（② 因读盘失败而未产出）→ ② 的 n 应为 1
	ragged := [][]singleBenchStage{
		{{Name: "① 文件读取", Duration: time.Millisecond}, {Name: "② JSON 解析", Duration: 2 * time.Millisecond}},
		{{Name: "① 文件读取", Duration: 3 * time.Millisecond}},
	}
	got := collectStageStats(ragged)
	if got["① 文件读取"].N != 2 {
		t.Errorf("① 的 n 应为 2, got %d", got["① 文件读取"].N)
	}
	if got["② JSON 解析"].N != 1 {
		t.Errorf("② 只出现 1 次，n 应为 1（不得填迭代轮数 2）, got %d", got["② JSON 解析"].N)
	}
}

// TestAvgBenchStages_CarriesRuntime runtime 是阶段归属，聚合时不得丢（与 Notes/Failed 同等待遇）。
func TestAvgBenchStages_CarriesRuntime(t *testing.T) {
	t.Parallel()
	all := [][]singleBenchStage{
		{{Name: "② 模型扫描", Duration: time.Millisecond, Runtime: "rust"}},
		{{Name: "② 模型扫描", Duration: 2 * time.Millisecond}}, // 次轮未填（首轮非空优先）
	}
	avg := avgBenchStages(all)
	if len(avg) != 1 {
		t.Fatalf("应有 1 个阶段, got %d", len(avg))
	}
	if avg[0].Runtime != "rust" {
		t.Errorf("runtime 应在聚合中保留（首个非空优先）, got %q", avg[0].Runtime)
	}
}

// TestStagesToJSON_CarriesStatsAndRuntime 出荷载荷必须同时带 runtime 与样本统计。
func TestStagesToJSON_CarriesStatsAndRuntime(t *testing.T) {
	t.Parallel()
	all := [][]singleBenchStage{
		{{Name: "② JSON 解析", Duration: 10 * time.Millisecond, Runtime: "go"}},
		{{Name: "② JSON 解析", Duration: 30 * time.Millisecond, Runtime: "go"}},
		{{Name: "② JSON 解析", Duration: 20 * time.Millisecond, Runtime: "go"}},
	}
	avg := avgBenchStages(all)
	stages, bottleneck := stagesToJSON(avg, all)
	if len(stages) != 1 {
		t.Fatalf("应有 1 个阶段, got %d", len(stages))
	}
	if stages[0].Runtime != "go" {
		t.Errorf("runtime 应为 go, got %q", stages[0].Runtime)
	}
	if stages[0].Stats == nil {
		t.Fatalf("stats 不得缺省: %+v", stages[0])
	}
	if stages[0].Stats.N != 3 || stages[0].Stats.Median != 20 || stages[0].Stats.P95 != 30 {
		t.Errorf("stats 应为 n=3/median=20/p95=30, got %+v", *stages[0].Stats)
	}
	if bottleneck != "② JSON 解析" {
		t.Errorf("bottleneck 应为 ② JSON 解析, got %q", bottleneck)
	}

	// 无样本（如纯汇总路径传 nil）时不得产出 stats —— 不伪造 n=0 的统计
	noSamples, _ := stagesToJSON(avg, nil)
	if noSamples[0].Stats != nil {
		t.Errorf("无样本时 stats 应为 nil（不产出无从计算的统计）, got %+v", *noSamples[0].Stats)
	}
}

// TestRunSingleModelBench_RuntimeAttribution single-bench 全链路跑在 Go 侧
// （读盘 / AnalyzeBedrockModel / 校验 / 几何 / 纹理 / 序列化 / 缓存），归属必须如实报 go。
func TestRunSingleModelBench_RuntimeAttribution(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-ysm"), 0o644); err != nil {
		t.Fatalf("写模型文件失败: %v", err)
	}
	fake := &flowFakeApp{entries: []types.ModelEntry{{Path: modelPath, Name: "m", Ext: ".ysm"}}}
	stages := runSingleModelBench(fake, modelPath, dir)
	if len(stages) == 0 {
		t.Fatal("应产出阶段")
	}
	for _, s := range stages {
		if s.Runtime != "go" {
			t.Errorf("single-bench 阶段 %q 归属应为 go, got %q", s.Name, s.Runtime)
		}
	}
}

// TestGUIFlow_RuntimeAttribution gui-flow 的归属不能一股脑填 go：
// ② 模型扫描走的是**实际扫描后端**（rust_backend 构建下是 Rust），⑥ 渲染预估算的是 Three.js 首帧。
func TestGUIFlow_RuntimeAttribution(t *testing.T) {
	ctx, _ := runGUIFlowForTest(t)
	structured, ok := ctx.result.(*guiFlowStructured)
	if !ok {
		t.Fatalf("SetResult 应为 *guiFlowStructured, got %T", ctx.result)
	}

	byName := map[string]guiFlowStageItem{}
	for _, s := range structured.Stages {
		byName[s.Name] = s
	}

	// ② 扫描后端来自 scanner 的构建期事实，不得硬编码 "go"
	if got := byName["② 模型扫描"].Runtime; got != scanner.ScanBackend {
		t.Errorf("② 模型扫描 runtime 应为 scanner.ScanBackend(%q), got %q", scanner.ScanBackend, got)
	}
	// ⑥ 是 Three.js 首帧的估算 → 归属 three（估算性质由 kind=estimated 承载）
	if got := byName["⑥ 渲染预估"].Runtime; got != "three" {
		t.Errorf("⑥ 渲染预估 runtime 应为 three, got %q", got)
	}
	// 其余 Go 侧阶段
	for _, name := range []string{"① 配置加载", "③ 模型分析", "④ 纹理缓存", "⑤ 数据准备"} {
		if got := byName[name].Runtime; got != "go" {
			t.Errorf("%s runtime 应为 go, got %q", name, got)
		}
	}
}

// TestBuildGuiFlowStructured_CarriesRuntime 纯函数契约：runtime 必须从 guiFlowResult 透传到载荷。
func TestBuildGuiFlowStructured_CarriesRuntime(t *testing.T) {
	t.Parallel()
	results := []guiFlowResult{
		{Stage: "① 配置加载", Duration: time.Millisecond, Success: true, Description: "ok", Runtime: "go"},
		{Stage: "⑥ 渲染预估", Success: true, Description: "ok", Kind: "estimated", Runtime: "three"},
	}
	g := buildGuiFlowStructured(results, time.Millisecond)
	if g.Stages[0].Runtime != "go" || g.Stages[1].Runtime != "three" {
		t.Errorf("runtime 未透传: %+v", g.Stages)
	}
}
