package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// benchFakeApp 计数型测试桩：仅覆盖基准链路用到的 AnalyzeBedrockModel
//
// analyzeCalls 用 atomic 而非裸 int：本桩会被 benchParallelAnalyze 的并发 worker
// 同时调用（bench_concurrent.go 的并行基准路径），裸 `analyzeCalls++` 是真实
// data race——`go test -race` 下会让 7 个 bench 测试集体失败（race detected）。
// 这是**测试替身**的同步责任：生产侧并发是正确的，桩必须跟上同样的并发契约。
type benchFakeApp struct {
	AppService
	analyzeCalls atomic.Int64
}

func (f *benchFakeApp) AnalyzeBedrockModel(modelPath string) types.BedrockModel {
	f.analyzeCalls.Add(1)
	return types.BedrockModel{BoneCount: 1}
}

func TestDetectModelFormat(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"a.ysm": "YSM", "b.pmx": "PMX", "c.PMD": "PMD", "d.vrm": "VRM",
		"e.gltf": "GLTF", "f.glb": "GLTF", "g.litematic": "Litematic",
		"h.json": "JSON", "i.zip": "Pack", "j.txt": "Unknown",
	}
	for path, want := range cases {
		if got := detectModelFormat(path); got != want {
			t.Errorf("detectModelFormat(%q)=%q, want %q", path, got, want)
		}
	}
}

func TestStagesToJSON_IdentifiesBottleneck(t *testing.T) {
	t.Parallel()
	d := func(ms int64) time.Duration { return time.Duration(ms) * time.Millisecond }
	avg := []singleBenchStage{
		{Name: "① 文件读取", Duration: d(5)},
		{Name: "② JSON 解析", Duration: d(120)},
		{Name: "③ 数据验证", Duration: d(3)},
	}
	stages, bottleneck := stagesToJSON(avg)
	if bottleneck != "② JSON 解析" {
		t.Errorf("最慢阶段应识别为瓶颈, got %q", bottleneck)
	}
	if len(stages) != 3 {
		t.Fatalf("应输出 3 条, got %d", len(stages))
	}
	if !stages[1].Bottleneck {
		t.Errorf("120ms 应标记 bottleneck: %+v", stages[1])
	}
	if stages[0].Bottleneck || stages[2].Bottleneck {
		t.Errorf("非最慢阶段不应标记 bottleneck: %+v", stages)
	}
	if stages[1].Status != "bottleneck" {
		t.Errorf("状态口径应为 bottleneck: %+v", stages[1])
	}
}

func TestGenerateHints(t *testing.T) {
	t.Parallel()
	fast := generateHints([]singleBenchStage{{Name: "① 文件读取", Duration: time.Millisecond}})
	if len(fast) != 1 || !strings.Contains(fast[0], "性能良好") {
		t.Errorf("全部 <10ms 应输出健康提示: %+v", fast)
	}
	slow := generateHints([]singleBenchStage{
		{Name: "① 文件读取", Duration: 200 * time.Millisecond},
		{Name: "⑤ 纹理数据准备", Duration: 50 * time.Millisecond},
	})
	if len(slow) != 2 {
		t.Fatalf("慢阶段应各产出一条建议, got %d", len(slow))
	}
	if !strings.Contains(slow[0], "磁盘") || !strings.Contains(slow[1], "KTX2") {
		t.Errorf("建议内容不符: %+v", slow)
	}
}

func TestMsOf(t *testing.T) {
	t.Parallel()
	if got := msOf(singleBenchStage{Duration: 1500 * time.Microsecond}); got != 1.5 {
		t.Errorf("1500us 应为 1.5ms, got %f", got)
	}
}

func TestRunConcurrentBench_ParamValidation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"--workers", "0"}, "workers 必须 >= 1"},
		{[]string{"--workers", "257"}, "workers 必须 <= 256"},
		{[]string{"--workers", "4", "--max-models", "0"}, "max-models 必须 >= 1"},
	}
	for _, c := range cases {
		err := runConcurrentBench(&CmdContext{App: &benchFakeApp{}, Args: c.args})
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("args %v 应报 %q, got %v", c.args, c.want, err)
		}
	}
}

func TestBenchSerialAndParallelAnalyze(t *testing.T) {
	t.Parallel()
	app := &benchFakeApp{}
	models := []string{"a.ysm", "b.ysm", "c.ysm"}
	serial := benchSerialAnalyze(app, models)
	if got := app.analyzeCalls.Load(); got != 3 {
		t.Errorf("串行应调 AnalyzeBedrockModel 3 次, got %d", got)
	}
	if serial.WorkerCount != 0 {
		t.Errorf("串行结果字段不符: %+v", serial)
	}
	app.analyzeCalls.Store(0)
	par := benchParallelAnalyze(app, models, 2)
	if got := app.analyzeCalls.Load(); got != 3 {
		t.Errorf("并行应恰好分析 3 个模型, got %d", got)
	}
	if par.WorkerCount != 2 {
		t.Errorf("并行结果字段不符: %+v", par)
	}
}

func TestValidateModelData(t *testing.T) {
	t.Parallel()
	// 一致模型 → 0 issue
	okModel := types.BedrockModel{BoneCount: 1, CubeCount: 1, Bones: []types.Bone2D{{Name: "root", Cubes: []types.Cube2D{{}}}}}
	if issues, msg := validateModelData(okModel); issues != 0 || !strings.Contains(msg, "通过") {
		t.Errorf("一致模型应零 issue: %d %q", issues, msg)
	}
	// 声明与实际不符 + 无根骨骼 → ≥2 issue
	bad := types.BedrockModel{BoneCount: 3, CubeCount: 9, Bones: []types.Bone2D{{Name: "b", Parent: "ghost"}}}
	if issues, msg := validateModelData(bad); issues < 2 || !strings.Contains(msg, "骨骼数不一致") {
		t.Errorf("不一致模型应报 issue: %d %q", issues, msg)
	}
}

func TestPrepareGeometryAndTextureData(t *testing.T) {
	t.Parallel()
	model := types.BedrockModel{
		Bones:      []types.Bone2D{{Name: "root", Cubes: []types.Cube2D{{}, {}}}},
		Animations: []string{"12345"}, // 5 字节
		Texture:    "abcd",            // base64 4 字符 → 解码后 3 字节
	}
	if got := prepareGeometryData(model); got != 1*96+2*96+5 {
		t.Errorf("几何估算 = 1 骨骼 + 2 立方块 + 5 字节动画, got %d", got)
	}
	if got := prepareTextureData(model); got != 3 {
		t.Errorf("纹理估算 = 4 字符 base64 → 3 字节, got %d", got)
	}
	if got := prepareGeometryData(types.BedrockModel{}); got != 0 {
		t.Errorf("空模型应为 0, got %d", got)
	}
}

func TestRunSingleModelBench_StagesAndFailureBranch(t *testing.T) {
	t.Parallel()
	// 文件不存在 → 只返回 1 个失败阶段
	missing := runSingleModelBench(&benchFakeApp{}, filepath.Join(t.TempDir(), "none.ysm"), "")
	if len(missing) != 1 || !strings.Contains(missing[0].Notes, "失败") {
		t.Fatalf("读取失败应只产出 1 个失败阶段: %+v", missing)
	}

	// 真实文件 + fake 分析 → 全 7 阶段
	root := t.TempDir()
	modelPath := filepath.Join(root, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-model-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	stages := runSingleModelBench(&benchFakeApp{}, modelPath, root)
	if len(stages) != 7 {
		t.Fatalf("应产出 7 个基准阶段, got %d: %+v", len(stages), stages)
	}
	wantNames := []string{"① 文件读取", "② JSON 解析", "③ 数据验证", "④ 几何数据准备", "⑤ 纹理数据准备", "⑥ 序列化模拟", "⑦ 缓存检查"}
	for i, want := range wantNames {
		if stages[i].Name != want {
			t.Errorf("阶段[%d] = %q, want %q", i, stages[i].Name, want)
		}
	}
	if stages[0].Bytes != int64(len("fake-model-bytes")) {
		t.Errorf("① 阶段应记录文件字节数: %+v", stages[0])
	}
}

func TestRunPerfSnapshot_EndToEnd(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	modelPath := filepath.Join(root, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-model-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := runPerfSnapshot(&CmdContext{App: &benchFakeApp{}, FilesRoot: root, Args: []string{"--iterations", "1"}})
	if err != nil {
		t.Fatalf("perf-snapshot 端到端应成功: %v", err)
	}
	// --model 显式路径也走通
	if err := runPerfSnapshot(&CmdContext{App: &benchFakeApp{}, FilesRoot: root, Args: []string{"--model", modelPath}}); err != nil {
		t.Fatalf("显式 --model 应成功: %v", err)
	}
	// 空 root 无模型 → 报错
	if err := runPerfSnapshot(&CmdContext{App: &benchFakeApp{}, FilesRoot: t.TempDir()}); err == nil {
		t.Error("无模型时应报错")
	}
}

// benchScanFakeApp 在计数桩基础上返回固定扫描条目（end-to-end 用）
type benchScanFakeApp struct {
	benchFakeApp
	paths []string
}

func (f *benchScanFakeApp) ScanModelEntries(dir string) []types.ModelEntry {
	out := make([]types.ModelEntry, 0, len(f.paths))
	for _, p := range f.paths {
		out = append(out, types.ModelEntry{Path: p, Name: filepath.Base(p), Ext: filepath.Ext(p)})
	}
	return out
}

func TestRunConcurrentBench_EndToEnd(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	var paths []string
	for _, name := range []string{"a.ysm", "b.ysm", "c.ysm", "readme.txt"} {
		p := filepath.Join(root, name)
		if err := os.WriteFile(p, []byte("bench-bytes-"+name), 0o644); err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(name, ".ysm") {
			paths = append(paths, p)
		}
	}
	err := runConcurrentBench(&CmdContext{
		App:       &benchScanFakeApp{paths: paths},
		FilesRoot: root,
		Args:      []string{"--workers", "2", "--max-models", "5"},
	})
	if err != nil {
		t.Fatalf("并发基准端到端应成功: %v", err)
	}
	// 无模型仓库 → 报错
	if err := runConcurrentBench(&CmdContext{App: &benchScanFakeApp{}, FilesRoot: t.TempDir()}); err == nil {
		t.Error("空仓库应报「未找到任何模型」")
	}
}

func TestRunSingleBenchJSON_SaveAndCompareRoundTrip(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	modelPath := filepath.Join(root, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-model-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	basePath := filepath.Join(root, "baseline.json")

	// 保存基准
	if err := runSingleBenchJSON(&CmdContext{App: &benchFakeApp{}, FilesRoot: root}, modelPath, 1, "", basePath, 50); err != nil {
		t.Fatalf("保存基准应成功: %v", err)
	}
	raw, err := os.ReadFile(basePath)
	if err != nil || !json.Valid(raw) {
		t.Fatalf("基准文件应为合法 JSON: err=%v raw=%s", err, raw)
	}

	// 用刚保存的基准对比自身 → 各阶段不可能退化超 50%
	if err := runSingleBenchJSON(&CmdContext{App: &benchFakeApp{}, FilesRoot: root}, modelPath, 1, basePath, "", 50); err != nil {
		t.Fatalf("自对比不应触发退化门禁: %v", err)
	}

	// 极短历史基准（各阶段 0.001ms）+ 确定性明显更慢的 now → 必然触发退化门禁。
	// 不依赖 runSingleBenchJSON 的真实计时：近零耗时下相对百分比抖动会让该断言 flaky
	// （见 compareSingleBenchBaseline 引入绝对噪声下限的注释）；直接用确定 stages 复现「真实退化」。
	stageNames := []string{"① 文件读取", "② JSON 解析", "③ 数据验证", "④ 几何数据准备", "⑤ 纹理数据准备", "⑥ 序列化模拟", "⑦ 缓存检查"}
	decline := make([]benchStageMs, len(stageNames))
	declineStages := make([]singleBenchStage, len(stageNames))
	for i, name := range stageNames {
		decline[i] = benchStageMs{Name: name, Ms: 0.001}
		declineStages[i] = singleBenchStage{Name: name, Duration: 50 * time.Millisecond}
	}
	declineJSON, _ := json.Marshal(decline)
	declinePath := filepath.Join(root, "decline.json")
	if err := os.WriteFile(declinePath, declineJSON, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := compareSingleBenchBaseline(declinePath, declineStages, 1); err == nil {
		t.Error("对照 0.001ms 历史基准必须触发退化门禁")
	}
}
