package cli

// scan_bench_test.go — 扫描基准（Go walk 单引擎）：
// 归属判定、载荷形状、守卫、缓存命中的诚实回报。

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/scanner"
)

// TestScanEngineDelta_Attribution 归属判定的三种结果。
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
		{"Go 处理", scanner.ScanEngineStat{}, scanner.ScanEngineStat{GoWalk: 1}, "go", "", true},
		{
			"缓存命中（没人走引擎）→ 不是测量",
			scanner.ScanEngineStat{GoWalk: 3}, scanner.ScanEngineStat{GoWalk: 3}, "", scanBenchReasonCacheHit, false,
		},
		{
			"并发交叉（计数差非 1）→ 归属不可判定",
			scanner.ScanEngineStat{}, scanner.ScanEngineStat{GoWalk: 2}, "", scanBenchReasonInterfered, false,
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

// TestRunScanBench_JSONPayloadShapeAndHonesty 默认构建下：Go 有实测，未采集时带原因 token 而非 0ms。
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
	if len(payload.Engines) != 1 || payload.Engines[0].Engine != "go" {
		t.Fatalf("载荷应只含 go 一项: %+v", payload.Engines)
	}
	goEngine := payload.Engines[0]
	if !goEngine.Used || len(goEngine.RunsMs) != 2 || goEngine.Entries == 0 {
		t.Errorf("Go 侧应有 2 次样本与条目数: %+v", goEngine)
	}
	if goEngine.MedianMs < 0 || goEngine.P95Ms < goEngine.MedianMs {
		t.Errorf("分位数应满足 0 <= median <= p95: %+v", goEngine)
	}
	if payload.Parity.Comparable {
		t.Errorf("单引擎不得声明可比: %+v", payload.Parity)
	}
}

// TestRunScanBench_CacheHitIsNotAMeasurement 缓存命中那一次不得计进样本——否则「省下的时间」会被当成扫描速度。
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

// TestRunScanBench_TextModeDoesNotFabricate 文本报告不得把未采集写成 0.00ms。
func TestRunScanBench_TextModeDoesNotFabricate(t *testing.T) {
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ctx := &CmdContext{FilesRoot: root, Args: []string{"--iterations", "1"}}
	var err error
	out := captureOutput(t, func() { err = runScanBench(ctx) })
	if err != nil {
		t.Fatalf("scan-bench 文本模式报错: %v", err)
	}
	if strings.Contains(out, "0.00ms") {
		t.Errorf("未采集不得渲染成 0.00ms:\n%s", out)
	}
}
