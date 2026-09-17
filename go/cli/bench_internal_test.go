package cli

// bench_internal_test.go — single-bench 结构化载荷契约（ADR-200 D1/D5 + 性能可观测性 ADR）。
//
// 锁三件事：
//  1. JSON 字段名与前端 SingleBenchPayload（perf-single-bench.ts）逐字对齐——漂移会让面板静默空白；
//  2. total_ms（N 次迭代累计）与 per_iteration_ms（单次平均）双口径齐备——旧实现只有累计，
//     前端把它当「一次加载总耗时」展示（「6ms 谁信」的机制性来源之一）；
//  3. AttachSidecar 注入 output/filesRoot：桥的 data 同时满足结构化消费与「复制原文」。
//
// 与 flow_internal_test.go 同范式（gui-flow 先例）。

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSingleBenchJSON_JSONShape(t *testing.T) {
	s := &singleBenchJSON{
		Model:          "./ysm/player.ysm",
		Iterations:     3,
		TotalMs:        6554.7,
		PerIterationMs: 2184.9,
		Stages: []benchStageJSON{
			{Name: "② JSON 解析", Ms: 1993.66, Status: "bottleneck", Bottleneck: true},
		},
		Bottleneck: "② JSON 解析",
		Hints:      []string{"🔴 瓶颈: JSON 解析"},
		Format:     "YSM",
		SizeBytes:  123456,
	}

	b, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal 失败: %v", err)
	}
	raw := string(b)
	// stdout 载荷不含 sidecar：AttachSidecar 由桥接层在命令返回后注入（ADR-200 D5）
	if strings.Contains(raw, `"output"`) {
		t.Errorf("stdout 载荷不应含 output（sidecar 由桥注入）: %s", raw)
	}
	for _, want := range []string{
		`"model"`, `"iterations"`, `"total_ms"`, `"per_iteration_ms"`,
		`"stages"`, `"name"`, `"ms"`, `"status"`, `"bottleneck"`,
		`"hints"`, `"format"`, `"size_bytes"`,
	} {
		if !strings.Contains(raw, want) {
			t.Errorf("JSON 缺少字段 %s: %s", want, raw)
		}
	}

	// 桥接层路径：SetResult 后 buildJsonData 必须承载结构化对象本体（而非 output 文本）
	ctx := &CmdContext{}
	ctx.SetResult(s)
	data := buildJsonData(ctx, "raw-json-text", "/models")
	got, ok := data.(*singleBenchJSON)
	if !ok {
		t.Fatalf("data 应为 *singleBenchJSON, got %T", data)
	}
	if got.Output != "raw-json-text" || got.FilesRoot != "/models" {
		t.Errorf("sidecar 未注入: output=%q filesRoot=%q", got.Output, got.FilesRoot)
	}
	withSidecar, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal 失败: %v", err)
	}
	for _, want := range []string{`"output"`, `"filesRoot"`} {
		if !strings.Contains(string(withSidecar), want) {
			t.Errorf("桥载荷缺少 %s: %s", want, withSidecar)
		}
	}
}
