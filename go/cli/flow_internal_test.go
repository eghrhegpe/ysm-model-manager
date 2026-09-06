package cli

// flow_internal_test.go — gui-flow 结构化载荷序列化契约（ADR-200 D1/D2）。
// 内部测试包：直接断言 guiFlowStructured 的 JSON 字段名与前端 GuiFlowStage
// （perf-cli.ts）逐字对齐——字段名漂移会让前端静默渲染空面板，故机检锁死。

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestGuiFlowStructured_JSONShape(t *testing.T) {
	g := &guiFlowStructured{
		Stages: []guiFlowStageItem{
			{Status: "✅", Name: "① 配置加载", Ms: 1.23, Desc: []string{"仓库根: /models"}},
			{Status: "❌", Name: "③ 模型分析", Ms: 200.5, Desc: []string{"分析失败: x.ysm"}},
		},
		TotalMs: 231.73,
		Failed:  true,
	}
	g.AttachSidecar("raw output", "/models")

	b, err := json.Marshal(g)
	if err != nil {
		t.Fatalf("marshal 失败: %v", err)
	}
	s := string(b)
	for _, want := range []string{
		`"stages"`, `"status"`, `"name"`, `"ms"`, `"desc"`,
		`"total_ms"`, `"failed"`, `"output"`, `"filesRoot"`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("JSON 缺少字段 %s: %s", want, s)
		}
	}
}

func TestBuildGuiFlowStructured_FromResults(t *testing.T) {
	results := []guiFlowResult{
		{Stage: "① 配置加载", Duration: 1500 * time.Microsecond, Success: true,
			Description: "✅ 配置已加载\n   仓库根: /models"},
		{Stage: "③ 模型分析", Duration: 200500 * time.Microsecond, Success: false,
			Description: "❌ 分析失败: x.ysm"},
	}
	g := buildGuiFlowStructured(results, 2317300*time.Microsecond)
	if len(g.Stages) != 2 {
		t.Fatalf("应有 2 个阶段, got %d", len(g.Stages))
	}
	if !g.Failed {
		t.Error("存在失败阶段，Failed 应为 true")
	}
	if g.Stages[0].Status != "✅" || g.Stages[1].Status != "❌" {
		t.Errorf("状态标记错误: %q / %q", g.Stages[0].Status, g.Stages[1].Status)
	}
	if g.Stages[0].Ms != 1.5 {
		t.Errorf("阶段耗时转换错误: got %v want 1.5", g.Stages[0].Ms)
	}
	if g.TotalMs != 2317.3 {
		t.Errorf("总耗时转换错误: got %v want 2317.3", g.TotalMs)
	}
	if len(g.Stages[0].Desc) != 2 || g.Stages[0].Desc[1] != "仓库根: /models" {
		t.Errorf("描述拆分错误: %v", g.Stages[0].Desc)
	}
}
