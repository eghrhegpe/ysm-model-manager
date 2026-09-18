package cli

// scan_bench_test.go — 扫描引擎基准（Go / Rust 对照，ADR-262 D3）：
// 归属判定、一致性比对、载荷形状、守卫。真 Rust 侧由 scan_bench_rust_test.go（构建标签）负责。

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// TestScanEngineDelta_Attribution 归属判定的四种结果——这是「不把 Go 的耗时记到 Rust 头上」的判据本体。
func TestScanEngineDelta_Attribution(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		before scanner.ScanEngineStat
		after  scanner.ScanEngineStat
		engine string
		reason string
		ok     bool
	}{
		{"Rust 处理", scanner.ScanEngineStat{}, scanner.ScanEngineStat{Rust: 1}, "rust", "", true},
		{"Go 处理", scanner.ScanEngineStat{}, scanner.ScanEngineStat{GoWalk: 1}, "go", "", true},
		{
			"缓存命中（没人走引擎）→ 不是测量",
			scanner.ScanEngineStat{Rust: 3}, scanner.ScanEngineStat{Rust: 3}, "", scanBenchReasonCacheHit, false,
		},
		{
			"并发交叉（两个都动了）→ 归属不可判定",
			scanner.ScanEngineStat{}, scanner.ScanEngineStat{Rust: 1, GoWalk: 1}, "", scanBenchReasonInterfered, false,
		},
	}
	for _, tc := range cases {
		gotEngine, gotReason, gotOK := scanEngineDelta(tc.before, tc.after)
		if gotEngine != tc.engine || gotReason != tc.reason || gotOK != tc.ok {
			t.Errorf("%s: got (%q, %q, %v), want (%q, %q, %v)",
				tc.name, gotEngine, gotReason, gotOK, tc.engine, tc.reason, tc.ok)
		}
	}
}

func TestCompareScanEngines_Parity(t *testing.T) {
	t.Parallel()
	a := types.ModelEntry{Path: "x/a.ysm", Name: "a", Ext: ".ysm", Size: 10, Hash: "h1"}
	b := types.ModelEntry{Path: "x/b.ysm", Name: "b", Ext: ".ysm", Size: 20, Hash: "h2"}

	if got := compareScanEngines(nil, []types.ModelEntry{a}); got.Comparable {
		t.Error("单侧数据不得声明可比（比的是空气）")
	}
	if got := compareScanEngines([]types.ModelEntry{a, b}, []types.ModelEntry{a, b}); !got.Comparable || !got.Match {
		t.Errorf("相同集合应一致: %+v", got)
	}
	onlyGo := compareScanEngines([]types.ModelEntry{a, b}, []types.ModelEntry{a})
	if !onlyGo.Comparable || onlyGo.Match || len(onlyGo.OnlyGo) != 1 || onlyGo.OnlyGo[0] != "x/b.ysm" {
		t.Errorf("应报「仅 Go 扫到」: %+v", onlyGo)
	}
	onlyRust := compareScanEngines([]types.ModelEntry{a}, []types.ModelEntry{a, b})
	if onlyRust.Match || len(onlyRust.OnlyRust) != 1 {
		t.Errorf("应报「仅 Rust 扫到」: %+v", onlyRust)
	}
	// 路径相同但字段不同（如哈希算法分叉）必须报出，不能只看条数
	badHash := b
	badHash.Hash = "different"
	diff := compareScanEngines([]types.ModelEntry{a, b}, []types.ModelEntry{a, badHash})
	if diff.Match || len(diff.FieldDiff) != 1 || diff.FieldDiff[0] != "x/b.ysm" {
		t.Errorf("字段分叉应报出: %+v", diff)
	}
}

// TestRunScanBench_JSONPayloadShapeAndHonesty 默认构建（无 rust_backend）下：
// Go 有实测，Rust 必须**未采集 + 原因 token**（绝不填 0.00ms），且 stdout 是纯 JSON。
func TestRunScanBench_JSONPayloadShapeAndHonesty(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ctx := &CmdContext{FilesRoot: root, Args: []string{"--iterations", "2", "--format", "json"}}

	var err error
	out := captureOutput(t, func() { err = runScanBench(ctx) })
	if err != nil {
		t.Fatalf("scan-bench 报错: %v", err)
	}
	var payload scanBenchJSON
	if err := json.Unmarshal([]byte(out), &payload); err != nil {
		t.Fatalf("stdout 不是纯 JSON: %v\n%s", err, out)
	}
	if payload.Spec.BuildBackend != scanner.ScanBackend {
		t.Errorf("spec 应回显构建期后端: got %q want %q", payload.Spec.BuildBackend, scanner.ScanBackend)
	}
	if len(payload.Engines) != 2 || payload.Engines[0].Engine != "go" || payload.Engines[1].Engine != "rust" {
		t.Fatalf("载荷应含 go/rust 两项且顺序固定: %+v", payload.Engines)
	}
	goEngine := payload.Engines[0]
	if !goEngine.Used || len(goEngine.RunsMs) != 2 || goEngine.Entries == 0 {
		t.Errorf("Go 侧应有 2 次样本与条目数: %+v", goEngine)
	}
	if goEngine.MedianMs < 0 || goEngine.P95Ms < goEngine.MedianMs {
		t.Errorf("分位数应满足 0 <= median <= p95: %+v", goEngine)
	}
	rustEngine := payload.Engines[1]
	if scanner.ScanBackend == "go" {
		// stub 构建：Rust 不存在 = 构建期事实，token 必须是 unavailable 而不是 fell_back
		if rustEngine.Used || rustEngine.Reason != scanBenchReasonUnavailable {
			t.Errorf("默认构建应报「未启用 rust_backend」: %+v", rustEngine)
		}
		if len(rustEngine.RunsMs) != 0 || rustEngine.MedianMs != 0 {
			t.Errorf("未采集不得带样本/数值（0 会被读成「快到测不出」）: %+v", rustEngine)
		}
		if payload.Parity.Comparable {
			t.Errorf("单侧采集不得声明可比: %+v", payload.Parity)
		}
	}
}

// TestRunScanBench_CacheHitIsNotAMeasurement 缓存命中那一次不得计进样本——否则「省下的时间」会被当成引擎速度。
// 手法：直接对照 measureScanEngine 的行为——先扫一次把结果写进缓存，再故意不清缓存地量一次。
func TestRunScanBench_CacheHitIsNotAMeasurement(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	scanner.InvalidateCache()
	_ = scanner.ScanEntries(root) // 预热缓存
	if obj := measureEngineWithoutInvalidate(root); len(obj.RunsMs) != 0 || obj.Skipped == 0 {
		t.Fatalf("缓存命中应记为 skipped 而非样本: %+v", obj)
	}
	if obj := measureEngineWithoutInvalidate(root); obj.Reason != scanBenchReasonCacheHit {
		t.Errorf("缓存命中应给出 cache_hit token: %+v", obj)
	}
}

// measureEngineWithoutInvalidate 与 measureScanEngine 同路径但**不**失效缓存，用于制造缓存命中。
func measureEngineWithoutInvalidate(root string) scanBenchEngineJSON {
	before := scanner.ScanEngineStats()
	_ = scanner.ScanEntries(root)
	after := scanner.ScanEngineStats()
	if _, reason, ok := scanEngineDelta(before, after); ok {
		return scanBenchEngineJSON{Used: true}
	} else {
		return scanBenchEngineJSON{Used: false, Reason: reason, Skipped: 1}
	}
}

func TestRunScanBench_Guards(t *testing.T) {
	cases := []struct {
		name   string
		root   string
		args   []string
		expect string
	}{
		{"缺 files-root", "", []string{"--format", "json"}, "files-root"},
		{"迭代次数非正", "fixtures", []string{"--iterations", "0"}, "iterations"},
		{"输出格式非法", "fixtures", []string{"--format", "yaml"}, "--format 必须是 text 或 json"},
	}
	for _, tc := range cases {
		ctx := &CmdContext{FilesRoot: tc.root, Args: tc.args}
		err := runScanBench(ctx)
		if err == nil || !strings.Contains(err.Error(), tc.expect) {
			t.Errorf("%s: want 含 %q, got %v", tc.name, tc.expect, err)
		}
	}
}

// TestRunScanBench_TextModeDoesNotFabricate 文本报告同样不得把未采集写成 0.00ms。
func TestRunScanBench_TextModeDoesNotFabricate(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ctx := &CmdContext{FilesRoot: root, Args: []string{"--iterations", "1"}}
	var err error
	out := captureOutput(t, func() { err = runScanBench(ctx) })
	if err != nil {
		t.Fatalf("scan-bench 文本模式报错: %v", err)
	}
	if scanner.ScanBackend == "go" {
		if !strings.Contains(out, "未采集") || !strings.Contains(out, "未启用 rust_backend") {
			t.Errorf("文本报告应说明 Rust 未采集及原因:\n%s", out)
		}
	}
	if strings.Contains(out, "rust  中位 0.00ms") {
		t.Errorf("未采集不得渲染成 0.00ms:\n%s", out)
	}
}
