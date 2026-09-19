package cli

// bench_concurrent_json_test.go — concurrent-bench 结构化出口的契约（ADR-262 D1/D5）。
//
// 立因：本命令此前**只有文本**，GUI 无从消费（想显示加速比只能正则解析中文表格）。
// 本文件锁四件事：
//  1. `--format json` 的 stdout 可被 json.Unmarshal 直接吃掉（人类文案一律不进 stdout）；
//  2. 载荷字段齐备且是**实测**值：速度比来自两次真实计时，判决 token 由 Go 单点给出
//     （前端不得自算阈值）；没测到的部分（无候选文件）如实**缺席**而非填 0；
//  3. text 模式不设结构化载荷（ctx.result 保持 nil）——两条线互不污染；
//  4. 并行档位不重复、不越界（新加的结构化出口不该天生带重复项）。
//
// ⚠️ JSON 用例串行执行：captureOutput 接管的是**进程级** stdout，与并行用例互相污染
// （同 bench_baseline_test.go 的教训）。故本文件不用 t.Parallel()。

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// benchTimedFakeApp 给分析加一点真实耗时。
// 纯计数桩的耗时常为 0（Windows 单调时钟粒度），于是「实测值 > 0」这类断言
// 测的是**时钟粒度**而不是被测逻辑——同 bench_baseline 的教训（假 app 太快量不出来）。
type benchTimedFakeApp struct {
	benchScanFakeApp
	delay time.Duration
}

// 与 benchFakeApp 同口径：Bones 必须物化（只填 BoneCount 的替身在自动挑选路径上会被
// hasGeometry 判成空模型，测的是替身失真而非被测逻辑）。
func (f *benchTimedFakeApp) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	f.analyzeCalls.Add(1)
	time.Sleep(f.delay)
	return types.BedrockModel{BoneCount: 1, Bones: []types.Bone2D{{}}}
}

// writeConcurrentBenchFixture 造一个含 n 个 .ysm 的小仓库（内容够非空即可）。
func writeConcurrentBenchFixture(t *testing.T, n int) (root string, paths []string) {
	t.Helper()
	root = t.TempDir()
	for i := 0; i < n; i++ {
		p := filepath.Join(root, string(rune('a'+i))+".ysm")
		if err := os.WriteFile(p, []byte("bench-bytes-"+p), 0o644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, p)
	}
	return root, paths
}

func TestRunConcurrentBenchJSON_ShapeAndPurity(t *testing.T) {
	root, paths := writeConcurrentBenchFixture(t, 3)
	ctx := &CmdContext{
		App:       &benchTimedFakeApp{benchScanFakeApp: benchScanFakeApp{paths: paths}, delay: 200 * time.Microsecond},
		FilesRoot: root,
		Args:      []string{"--workers", "4", "--max-models", "5", "--format", "json"},
	}

	// 进程级 stdout 接管（既有 captureOutput(t, fn) 形态）：串行执行，勿加 t.Parallel
	var runErr error
	console := captureOutput(t, func() { runErr = runConcurrentBench(ctx) })
	if runErr != nil {
		t.Fatalf("JSON 模式应成功: %v", runErr)
	}

	// ① stdout 纯度：可被 json.Unmarshal 直接吃掉（带任何人类文案都会失败）
	var out concurrentBenchJSON
	if err := json.Unmarshal([]byte(console), &out); err != nil {
		t.Fatalf("stdout 必须是纯 JSON（不可混入人类文案）: %v\n输出: %s", err, console)
	}
	// ⚠️ 不把 💡/📈 一律列为禁词：`hints[]` 是**结构化字段**，其值本就是中文散文（含 emoji）。
	// 纯度契约是「stdout 可被 json.Unmarshal 吃掉」（上面已证），这里只查报告**标题**级标记。
	for _, forbidden := range []string{"⚡ 并发能力基准测试", "📊 Phase", "📈 性能对比表", "汇总报告"} {
		if strings.Contains(console, forbidden) {
			t.Errorf("JSON 模式 stdout 混入人类文案 %q: %s", forbidden, console)
		}
	}

	// ② 字段齐备（前端契约靠这些键名；顺序无所谓）
	for _, want := range []string{
		`"target"`, `"order"`, `"workers"`, `"max_models"`, `"model_count"`, `"models"`,
		`"serial"`, `"total_ms"`, `"per_model_ms"`,
		`"parallel"`, `"speedup"`, `"verdict"`,
	} {
		if !strings.Contains(console, want) {
			t.Errorf("载荷缺少字段 %s: %s", want, console)
		}
	}
	// ②′ 三旋钮回显（ADR-262 D3 修订）：本载荷是扁平的（无 spec 包装），与 max_models 并列
	if out.Target != perfTargetRepo || out.Order != perfOrderPath || out.MaxModels != 5 {
		t.Errorf("默认目标集应回显 target=repo / order=path / max_models=5: %+v", out)
	}
	// path 序不统计体量：size_source 不该凭空出现（omitempty 的诚实性）
	if strings.Contains(console, "size_source") {
		t.Errorf("path 序不得回显 size_source: %s", console)
	}
	// ③ 实测而非占位：串行耗时是真实计时（>0），模型身份块给 relPath 而非绝对路径
	if out.Serial.TotalMs <= 0 {
		t.Errorf("串行耗时应为实测正值, got %v", out.Serial.TotalMs)
	}
	if out.ModelCount != 3 || len(out.Models) != 3 {
		t.Fatalf("应报告 3 个参与模型, got count=%d models=%d", out.ModelCount, len(out.Models))
	}
	for _, m := range out.Models {
		if m.RelPath == "" || filepath.IsAbs(m.RelPath) {
			t.Errorf("模型身份块应给相对路径（跨机器可比）, got %q", m.RelPath)
		}
		if m.Rtype != "ysm" {
			t.Errorf("rtype 应来自 registry 判定为 ysm, got %q", m.Rtype)
		}
	}

	// ④ 档位：不重复、不越界，且判决 token 落在 Go 单点的四种取值内
	if len(out.Parallel) != 2 {
		t.Fatalf("--workers 4 应有 2 个档位（2 与 4，去重后）, got %d: %+v", len(out.Parallel), out.Parallel)
	}
	seen := map[int]bool{}
	for _, p := range out.Parallel {
		if seen[p.Workers] {
			t.Errorf("档位重复: workers=%d 出现两次", p.Workers)
		}
		seen[p.Workers] = true
		if p.Workers > out.Workers {
			t.Errorf("档位越界: workers=%d > 目标 %d", p.Workers, out.Workers)
		}
		switch p.Verdict {
		case "excellent", "good", "fair", "none":
		default:
			t.Errorf("判决 token 必须在 Go 单点的四类内, got %q", p.Verdict)
		}
	}
	if len(out.Hints) == 0 {
		t.Error("并发建议应结构化保留（供 CLI/AI 消费）")
	}

	// ⑤ 双出口（ADR-200 D5）：桥的 data 承载对象本体
	payload, ok := ctx.result.(*concurrentBenchJSON)
	if !ok || payload == nil {
		t.Fatalf("应通过 SetResult 交出 *concurrentBenchJSON, got %T", ctx.result)
	}
	if payload.ModelCount != 3 {
		t.Errorf("桥侧载荷与 stdout 应为同一份数据, got %d", payload.ModelCount)
	}
}

func TestRunConcurrentBenchJSON_FileReadAbsentWhenNoCandidate(t *testing.T) {
	// ⚠️ 夹具必须**总量够大**：单个 512KB 文件的读取常在时钟粒度下量到 0.00ms
	// （实测 SerialMs/ParallelMs 在 0 ~ 0.6ms 间随机为 0），那是「测时钟」不是「测逻辑」，
	// 会把断言变成 flaky。30 × 512KB（≈15MB，恰为 benchFileLimit 上限）才稳定可测。
	root := t.TempDir()
	for i := 0; i < benchFileLimit; i++ {
		p := filepath.Join(root, fmt.Sprintf("m%02d.ysm", i))
		if err := os.WriteFile(p, make([]byte, 512*1024), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	model := filepath.Join(root, "m00.ysm")

	// 有候选文件 → file_read 块存在且是实测正值
	out := collectConcurrentBenchJSON(&benchScanFakeApp{paths: []string{model}}, []string{model},
		perfTargetSpec{Target: perfTargetRepo, Order: perfOrderPath, MaxModels: 5}, 4, root)
	if out.FileRead == nil {
		t.Fatal(".ysm 是合格候选文件，file_read 应存在")
	}
	if out.FileRead.FileCount != benchFileLimit {
		t.Errorf("候选数应为 %d（benchFileLimit 封顶）, got %d", benchFileLimit, out.FileRead.FileCount)
	}
	if out.FileRead.SerialMs <= 0 || out.FileRead.ParallelMs <= 0 || out.FileRead.Speedup <= 0 {
		t.Errorf("file_read 应为实测正值, got %+v", out.FileRead)
	}

	// 无候选文件 → 整块缺席（不是填 0 假装测过）
	empty := t.TempDir()
	out2 := collectConcurrentBenchJSON(&benchScanFakeApp{paths: []string{model}}, []string{model},
		perfTargetSpec{Target: perfTargetRepo, Order: perfOrderPath, MaxModels: 5}, 4, empty)
	raw, _ := json.Marshal(out2)
	if strings.Contains(string(raw), "file_read") {
		t.Errorf("无候选文件时应整块缺席（omitempty 的诚实性）, got %s", raw)
	}
}

func TestRunConcurrentBench_TextModeLeavesNoPayload(t *testing.T) {
	root, paths := writeConcurrentBenchFixture(t, 2)
	ctx := &CmdContext{
		App:       &benchScanFakeApp{paths: paths},
		FilesRoot: root,
		Args:      []string{"--workers", "2", "--max-models", "5"},
	}
	var runErr error
	captureOutput(t, func() { runErr = runConcurrentBench(ctx) })
	if runErr != nil {
		t.Fatalf("text 模式应成功: %v", runErr)
	}
	if ctx.result != nil {
		t.Errorf("text 模式不应设置结构化载荷（否则桥会把文本模式当 JSON 消费）, got %T", ctx.result)
	}
}

func TestRunConcurrentBench_FormatValidation(t *testing.T) {
	root, paths := writeConcurrentBenchFixture(t, 1)
	ctx := &CmdContext{
		App:       &benchScanFakeApp{paths: paths},
		FilesRoot: root,
		Args:      []string{"--format", "yaml"},
	}
	err := runConcurrentBench(ctx)
	if err == nil || !strings.Contains(err.Error(), "--format") {
		t.Errorf("非法 --format 应报参数错误, got %v", err)
	}
}
