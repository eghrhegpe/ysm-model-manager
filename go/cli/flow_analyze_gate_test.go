package cli

// flow_analyze_gate_test.go — gui-flow 的 ④⑤⑥ 门控：**没有真分析结果就不许产出派生阶段**。
//
// 立因（2026-09-18）：`runGUIFlow` 原以扩展名门控派生阶段（`ext != ".pmx" && ext != ".pmd"`），
// 而 `runPhaseModelAnalyze` 只在 PMX/PMD 上短路。于是：
//   - `--model x.vrm`（或 FBX/GLTF/litematic）→ ③ 走正常分支、`AnalyzeBedrockModel` 解析不出骨头
//     → ③ 报「❌ 分析失败」，**但 ④⑤⑥ 照跑**，在一份空 `types.BedrockModel{}` 上产出
//     「纹理缓存 / 数据准备 / 渲染预估」三个阶段——这些 ms 是**空模型数据当实测**，违反 ADR-262 D3/D8；
//   - 损坏的 `.ysm` 同理（③ 失败但 ④⑤⑥ 仍产出假阶段）——按**类型**门控救不了这一类，
//     因为类型判定会说「ysm 可分析」。
//
// 故门控依据改为「**是否真分析出了模型**」（`len(model.Bones) > 0`）：它比类型谓词更强，
// 同时覆盖「前端专属类型」与「解析失败的模型」两种空数据来源，且顺带删掉了 flow.go 里
// 最后一张扩展名表（`ext == ".pmx" || ext == ".pmd"` 的分派仍在 ③ 内，但语义已从
// 「哪些扩展名跳过」变为「CLI 有没有该类型的解析链路」= cliAnalyzable，见 perf_targets.go）。

import (
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// emptyAnalyzeApp 覆盖流程序列：能配、能扫，但**分析恒返回空模型**
// （代表「解析器不在 CLI」与「模型损坏」两种情形——它们的共同点是没有真数据）。
type emptyAnalyzeApp struct {
	flowFakeApp
}

func (f *emptyAnalyzeApp) AnalyzeBedrockModel(string) types.BedrockModel {
	f.analyzeCalls.Add(1)
	return types.BedrockModel{} // 0 bones：没有任何可用来测的东西
}

// flowStageNames 取结构化载荷的阶段名集合（断言的是载荷，不是人类文案）。
func flowStageNames(t *testing.T, ctx *CmdContext) map[string]guiFlowStageItem {
	t.Helper()
	structured, ok := ctx.result.(*guiFlowStructured)
	if !ok {
		t.Fatalf("SetResult 应为 *guiFlowStructured, got %T", ctx.result)
	}
	out := map[string]guiFlowStageItem{}
	for _, s := range structured.Stages {
		out[s.Name] = s
	}
	return out
}

// derivedPhaseNames 派生阶段（依赖一份真分析结果才有意义的三个）。
var derivedPhaseNames = []string{"④ 纹理缓存", "⑤ 数据准备", "⑥ 渲染预估"}

// TestGUIFlow_UnanalyzableTypeSkipsDerivedPhases 解析器只在前端的类型（VRM/FBX/GLTF/litematic）
// 必须走「CLI 不模拟」分支，且**不得**产出 ④⑤⑥。
func TestGUIFlow_UnanalyzableTypeSkipsDerivedPhases(t *testing.T) {
	fake := &emptyAnalyzeApp{}
	ctx := &CmdContext{
		App:       fake,
		FilesRoot: t.TempDir(),
		Args:      []string{"--model", "/repo/x.vrm", "--verbose"},
	}
	var err error
	out := captureOutput(t, func() { err = runGUIFlow(ctx) })
	_ = err // 该路径 ③ 判成功（明确告知限制而非报错），此处不依赖返回值

	if !strings.Contains(out, "只在前端 3D adapter") {
		t.Errorf("不可分析类型应明确告知「解析器只在前端」, 输出:\n%s", out)
	}
	if strings.Contains(out, "分析失败") {
		t.Errorf("不可分析类型不应报「分析失败」（那是误导——CLI 本就没有该链路）, 输出:\n%s", out)
	}
	if fake.analyzeCalls.Load() != 0 {
		t.Errorf("不可分析类型不应调 AnalyzeBedrockModel（必然空模型）, 实际调用 %d 次", fake.analyzeCalls.Load())
	}

	byName := flowStageNames(t, ctx)
	for _, name := range derivedPhaseNames {
		if s, ok := byName[name]; ok {
			t.Errorf("%s 不得产出（无真分析结果时它是空模型数据当实测）: %+v", name, s)
		}
	}
}

// TestGUIFlow_EmptyAnalysisSkipsDerivedPhases ③ 分析不出东西时（损坏的 ysm / 空模型），
// ④⑤⑥ 一律不得产出——按**类型**门控挡不住这一类。
func TestGUIFlow_EmptyAnalysisSkipsDerivedPhases(t *testing.T) {
	fake := &emptyAnalyzeApp{}
	ctx := &CmdContext{
		App:       fake,
		FilesRoot: t.TempDir(),
		Args:      []string{"--model", "/repo/broken.ysm", "--verbose"},
	}
	out := captureOutput(t, func() { _ = runGUIFlow(ctx) })

	if fake.analyzeCalls.Load() != 1 {
		t.Errorf("③ 应恰好分析一次, 实际 %d 次", fake.analyzeCalls.Load())
	}
	if !strings.Contains(out, "分析失败") {
		t.Errorf("解析不出内容时应如实报分析失败, 输出:\n%s", out)
	}

	byName := flowStageNames(t, ctx)
	if s := byName["③ 模型分析"]; s.Status != "❌" {
		t.Errorf("③ 应如实标失败（不得因后续阶段存在而显得成功）: %+v", s)
	}
	for _, name := range derivedPhaseNames {
		if s, ok := byName[name]; ok {
			t.Errorf("%s 不得产出（③ 没有分析出模型，其数据是空的）: %+v", name, s)
		}
	}
}

// TestGUIFlow_AnalyzableModelKeepsDerivedPhases 正向护栏：真能分析时 ④⑤⑥ 必须照常产出
// （防止「一刀切跳过」把好路径也砍掉）。
func TestGUIFlow_AnalyzableModelKeepsDerivedPhases(t *testing.T) {
	ctx, _ := runGUIFlowForTest(t)
	byName := flowStageNames(t, ctx)
	for _, name := range derivedPhaseNames {
		if _, ok := byName[name]; !ok {
			t.Errorf("%s 应照常产出（模型可分析且有真数据）——门控不得误伤正向路径", name)
		}
	}
	if s := byName["③ 模型分析"]; s.Status != "✅" {
		t.Errorf("③ 应成功: %+v", s)
	}
}
