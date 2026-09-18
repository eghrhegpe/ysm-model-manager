package cli

// flow_estimated_test.go — gui-flow 的实测/估算口径（ADR-262 D2/D8）。
//
// 锁两件事（2026-09-17 修复）：
//  1. **模型只分析一次**：此前 ⑤ 数据准备与 ⑥ 渲染预估各自再调一次 AnalyzeBedrockModel，
//     同一份分析被计 3 次耗时（③⑤⑥ 的 ms 里都有它）——⑤⑥ 的"阶段耗时"因此不是自己的工作量的度量；
//  2. **估算与实测分离**：⑤ 的 IPC 传输按 50MB/s 假设、⑥ 无渲染管线纯套公式，二者都必须
//     kind=estimated + estimated_ms + note（假设/公式），且**不计入 total_ms**；
//     ⑥ 的 ms 必须为 0（没有实测工作量），不再借用重复分析的耗时。

import (
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// flowFakeApp gui-flow 测试桩：嵌入 nil AppService，仅覆盖流程实际调用的方法
// （LoadAppConfig / ScanModelEntries / AnalyzeBedrockModel，并计数后者）。
type flowFakeApp struct {
	AppService
	analyzeCalls atomic.Int64
	entries      []types.ModelEntry
}

func (f *flowFakeApp) LoadAppConfig() types.AppConfig { return types.AppConfig{} }

func (f *flowFakeApp) ScanModelEntries(dir string) []types.ModelEntry { return f.entries }

func (f *flowFakeApp) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	f.analyzeCalls.Add(1)
	return types.BedrockModel{Bones: []types.Bone2D{{}}, Textures: []string{"tex"}}
}

// runGUIFlowForTest 造一个真实可读的模型文件并跑完整 gui-flow（--verbose 打开 ⑥）。
func runGUIFlowForTest(t *testing.T) (*CmdContext, *flowFakeApp) {
	t.Helper()
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "a.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-ysm-bytes-for-hash"), 0o644); err != nil {
		t.Fatalf("写模型文件失败: %v", err)
	}
	fake := &flowFakeApp{entries: []types.ModelEntry{{Path: modelPath, Name: "a", Ext: ".ysm"}}}
	ctx := &CmdContext{
		App:       fake,
		FilesRoot: dir,
		Args:      []string{"--model", modelPath, "--verbose"},
	}
	var err error
	_ = captureOutput(t, func() { err = runGUIFlow(ctx) })
	if err != nil {
		t.Fatalf("gui-flow 应全程成功（各阶段无失败）: %v", err)
	}
	return ctx, fake
}

func TestGUIFlow_AnalyzesModelExactlyOnce(t *testing.T) {
	ctx, fake := runGUIFlowForTest(t)
	if got := fake.analyzeCalls.Load(); got != 1 {
		t.Errorf("同一模型每次运行只应分析一次（③ 分析后 ⑤⑥ 复用），实际 %d 次", got)
	}
	structured, ok := ctx.result.(*guiFlowStructured)
	if !ok {
		t.Fatalf("SetResult 应为 *guiFlowStructured, got %T", ctx.result)
	}
	// ⑦ 阶段里 ⑥ 必须存在（--verbose 打开），且不能把重复分析耗时算进来
	for _, s := range structured.Stages {
		if s.Name == "⑥ 渲染预估" && s.Ms != 0 {
			t.Errorf("⑥ 无实测工作量，ms 应为 0，got %.2f", s.Ms)
		}
	}
}

func TestGUIFlow_EstimatedStagesSeparatedFromMeasured(t *testing.T) {
	ctx, _ := runGUIFlowForTest(t)
	structured, ok := ctx.result.(*guiFlowStructured)
	if !ok {
		t.Fatalf("SetResult 应为 *guiFlowStructured, got %T", ctx.result)
	}

	byName := map[string]guiFlowStageItem{}
	for _, s := range structured.Stages {
		byName[s.Name] = s
	}

	six, ok := byName["⑥ 渲染预估"]
	if !ok {
		t.Fatalf("--verbose 下应有 ⑥ 渲染预估: %+v", structured.Stages)
	}
	if six.Kind != "estimated" {
		t.Errorf("⑥ 无渲染管线，kind 应为 estimated, got %q", six.Kind)
	}
	if six.EstimatedMs <= 0 {
		t.Errorf("⑥ 应给出估算值 estimated_ms>0, got %.2f", six.EstimatedMs)
	}
	if six.Note == "" {
		t.Error("⑥ 必须标注估算公式与区间（ADR-262 D2）")
	}

	five, ok := byName["⑤ 数据准备"]
	if !ok {
		t.Fatalf("应有 ⑤ 数据准备: %+v", structured.Stages)
	}
	if five.Kind != "measured" {
		t.Errorf("⑤ 的阶段耗时是实测的序列化工作，kind 应为 measured, got %q", five.Kind)
	}
	// 能测的不要估（ADR-262 D2）：载荷大小与序列化耗时是实测，只有传输时间是估算
	if !strings.Contains(five.Note, "实测") || !strings.Contains(five.Note, "假设") {
		t.Errorf("⑤ 的 note 应同时说明「实测了什么」与「假设了什么」: %q", five.Note)
	}
	if desc := strings.Join(five.Desc, "\n"); !strings.Contains(desc, "载荷(实测 JSON)") {
		t.Errorf("⑤ 描述应展示实测载荷大小: %q", desc)
	}
	if five.EstimatedMs >= 1 {
		t.Errorf("⑤ 的估算应只剩传输时间（小模型远小于 1ms），got %.3f", five.EstimatedMs)
	}

	// 实测阶段默认 kind=measured（空值兜底）
	for _, name := range []string{"① 配置加载", "② 模型扫描", "③ 模型分析", "④ 纹理缓存"} {
		if got := byName[name].Kind; got != "measured" {
			t.Errorf("%s 的 kind 应为 measured, got %q", name, got)
		}
		if byName[name].EstimatedMs != 0 {
			t.Errorf("%s 不应带估算值: %.2f", name, byName[name].EstimatedMs)
		}
	}

	// total_ms 是实测墙钟，估算单独合计、不得混入
	if structured.EstimatedMs <= 0 {
		t.Error("顶层 estimated_ms 应为各阶段估算合计")
	}
	// total_ms 是实测墙钟，估算单独合计、不得混入。
	// 断言用「实测总耗时 < 估算合计」而非「total_ms > 0」：测试机上墙钟可能不足 1µs 被截断为 0
	// （不是错误），而估算值（⑥ 首帧百 ms 量级）远大于它——若估算被混进 total，这条必然先炸。
	if structured.TotalMs >= structured.EstimatedMs {
		t.Errorf("total_ms(%.3f) 应远小于估算合计(%.3f)——估算不得混入实测总耗时",
			structured.TotalMs, structured.EstimatedMs)
	}
}

// TestBuildGuiFlowStructured_EstimatedTotal 估算合计与 kind 兜底的纯函数契约。
func TestBuildGuiFlowStructured_EstimatedTotal(t *testing.T) {
	t.Parallel()
	results := []guiFlowResult{
		{Stage: "③ 模型分析", Duration: 10 * time.Millisecond, Success: true, Description: "ok"},
		{Stage: "⑤ 数据准备", Duration: 2 * time.Millisecond, Success: true, Description: "ok",
			Kind: "measured", Estimated: 30 * time.Millisecond, Note: "50MB/s 假设"},
		{Stage: "⑥ 渲染预估", Success: true, Description: "ok",
			Kind: "estimated", Estimated: 70 * time.Millisecond, Note: "公式粗估"},
	}
	g := buildGuiFlowStructured(results, 12*time.Millisecond)
	if g.EstimatedMs != 100 {
		t.Errorf("估算合计应为 30+70=100ms, got %.2f", g.EstimatedMs)
	}
	if g.TotalMs != 12 {
		t.Errorf("total_ms 应只含实测墙钟, got %.2f", g.TotalMs)
	}
	if g.Stages[0].Kind != "measured" {
		t.Errorf("空 Kind 应兜底为 measured, got %q", g.Stages[0].Kind)
	}
	if g.Stages[2].Kind != "estimated" || g.Stages[2].EstimatedMs != 70 {
		t.Errorf("⑥ 应保留 kind/estimated_ms: %+v", g.Stages[2])
	}
}

// TestScanRateSuffix 诚实红线（与 singleBenchReadNote 同族）：
// 小仓库扫描常在时钟粒度内完成（time.Since = 0），n/0s 会打成「+Inf models/sec」。
// 立因（2026-09-18，e2e 真实渲染抓出）：GUI ② 阶段描述里真的出现了「发现 1 个模型 (+Inf models/sec)」。
func TestScanRateSuffix(t *testing.T) {
	t.Parallel()
	if got := scanRateSuffix(5, 0); got != "" {
		t.Errorf("零时长不得报速率, got %q", got)
	}
	if got := scanRateSuffix(5, -time.Millisecond); got != "" {
		t.Errorf("负时长不得报速率, got %q", got)
	}
	if got := scanRateSuffix(100, time.Second); !strings.Contains(got, "100 models/sec") {
		t.Errorf("100/1s 应为 100 models/sec, got %q", got)
	}
}

// TestGUIFlow_StructuredNoNonFinite 真实链路的粗保护：结构化载荷的任何阶段描述都不得出现
// Inf/NaN（估算公式与速率若被 0 除，会原样进 GUI 与 AI 复盘）。
func TestGUIFlow_StructuredNoNonFinite(t *testing.T) {
	ctx, _ := runGUIFlowForTest(t)
	g, ok := ctx.result.(*guiFlowStructured)
	if !ok {
		t.Fatalf("gui-flow 应设置结构化载荷, got %T", ctx.result)
	}
	for _, s := range g.Stages {
		for _, line := range s.Desc {
			for _, bad := range []string{"Inf", "NaN"} {
				if strings.Contains(line, bad) {
					t.Errorf("阶段 %q 描述不得出现 %q: %q", s.Name, bad, line)
				}
			}
		}
	}
}
