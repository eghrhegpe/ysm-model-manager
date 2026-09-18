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
		// 目录式模型的入口 ysm.json 归 YSM（否则与 identity.rtype=ysm 在同一报告里打架）；
		// 同名近似文件不得被误判（IsYsmEntryJSON 是精确匹配）
		"k/ysm.json": "YSM", "l/notysm.json": "JSON",
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
	stages, bottleneck := stagesToJSON(avg, nil)
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

// 回归（2026-09-17）：旧实现「每超过当前最大值即置 Bottleneck=true」会把先出现的
// 次大阶段一并打标——本夹具（120 早于 200）在旧实现下产出两个 bottleneck=true。
func TestStagesToJSON_OnlySlowestIsBottleneck(t *testing.T) {
	t.Parallel()
	d := func(ms int64) time.Duration { return time.Duration(ms) * time.Millisecond }
	avg := []singleBenchStage{
		{Name: "① 文件读取", Duration: d(120)},
		{Name: "② JSON 解析", Duration: d(5)},
		{Name: "③ 数据验证", Duration: d(200)},
	}
	stages, bottleneck := stagesToJSON(avg, nil)
	if bottleneck != "③ 数据验证" {
		t.Errorf("最慢阶段应为瓶颈, got %q", bottleneck)
	}
	marked := 0
	for _, s := range stages {
		if s.Bottleneck {
			marked++
		}
	}
	if marked != 1 {
		t.Errorf("bottleneck 只能标记一个, got %d: %+v", marked, stages)
	}
	if stages[0].Bottleneck {
		t.Errorf("次大阶段不应标记 bottleneck: %+v", stages[0])
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
		// 上限文案随三旋钮重写（“>= 1” → “大于 0”）：同一个数字在四种 selector 下含义不同，
		// 旧文案漏了它的单位。
		{[]string{"--workers", "4", "--max-models", "0"}, "--max-models 必须大于 0"},
		{[]string{"--order", "bogus"}, "--order 必须是"},
		{[]string{"--target", "bogus"}, "--target 必须是"},
		{[]string{"--target", "model"}, "需要 --model"},
		{[]string{"--target", "rtype"}, "需要 --rtype"},
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

// TestRunSingleModelBench_ZeroDurationNoFakeThroughput 诚实红线：
// 读几百字节时 `time.Since` 常返回 0（时钟粒度）→ `float64(bytes)/0s` 会把速率打成「+Inf MB/s」。
// 立因（2026-09-18，e2e 真实渲染抓出）：GUI 阶段条上真的出现了「✅ 115B, +Inf MB/s」——
// 测不出来的速率宁可不报，也不能报一个无限大。
// 判据由**纯函数** singleBenchReadNote 确定性锁定（真实计时不可控，不在集成层赌 0 时长）；
// 本用例只加一层粗保护：真实链路上任何阶段都不得出现 Inf/NaN。
func TestRunSingleModelBench_ZeroDurationNoFakeThroughput(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	modelPath := filepath.Join(root, "m.ysm")
	if err := os.WriteFile(modelPath, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	stages := runSingleModelBench(&benchFakeApp{}, modelPath, root)
	if len(stages) == 0 {
		t.Fatal("应产出阶段")
	}
	for _, s := range stages {
		for _, bad := range []string{"Inf", "NaN"} {
			if strings.Contains(s.Notes, bad) {
				t.Errorf("阶段 %q 文案不得出现 %q（时长 %v）: %q", s.Name, bad, s.Duration, s.Notes)
			}
		}
	}
}

// TestSingleBenchReadNote 纯函数判据：时长 > 0 才报速率；为 0 时只报体量（不编造、不 Inf）。
func TestSingleBenchReadNote(t *testing.T) {
	t.Parallel()
	t.Run("零时长只报体量", func(t *testing.T) {
		got := singleBenchReadNote(115, 0)
		if strings.Contains(got, "MB/s") || strings.Contains(got, "Inf") {
			t.Errorf("时长为 0 不得报速率: %q", got)
		}
		if !strings.Contains(got, "115") {
			t.Errorf("体量应保留: %q", got)
		}
	})
	t.Run("负时长按零处理", func(t *testing.T) {
		if got := singleBenchReadNote(115, -time.Millisecond); strings.Contains(got, "MB/s") {
			t.Errorf("负时长同样不得报速率: %q", got)
		}
	})
	t.Run("有时长报有限速率", func(t *testing.T) {
		got := singleBenchReadNote(2*1024*1024, time.Second)
		if !strings.Contains(got, "2 MB/s") {
			t.Errorf("2MB/1s 应为 2 MB/s, got %q", got)
		}
	})
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

	// 用刚保存的基准对比自身 → 这条通路不得报错（保存→读取→比对的接线）。
	//
	// 阈值刻意取到抖动不可能触发的量级，而不是 50%：本断言量的是**接线**，
	// 而两端的耗时都是真实墙钟——高负载下第二次比第一次慢 50% 以上完全合法
	// （噪声下限只吸收「双方都在下限内」与「绝对增量 ≤ 下限」，中量级阶段不设防）。
	// 2026-09-18 实证：与并发基准测试并跑时本行必炸（"1 个阶段相对基准退化超过 50%"），
	// 单跑恒绿——即断言对象错误，不是代码缺陷。
	// 门禁**效力**由下方两个确定性块锁定（0.001ms 基准必触发 / 亚毫秒 + 小幅增量不触发），
	// 它们直接注入 stages，不依赖计时。
	if err := runSingleBenchJSON(&CmdContext{App: &benchFakeApp{}, FilesRoot: root}, modelPath, 1, basePath, "", 100000); err != nil {
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

	// 亚毫秒基准 + 小幅绝对增量：相对百分比爆表（0.5 → 1.4ms = +180% > 50%），
	// 但绝对增量仅 0.9ms，落在噪声下限内 → 不应判退化。
	// 守住这一条，上面「自对比」断言才能在负载抖动下不再误报——2026-09-15 实证：
	// 此前只挡「base 与 now 双双在噪声区间」，base 亚毫秒作分母时，now 刚过 1ms 下限即被
	// (now-base)/base 放大成 +200% 假退化，pre-push 与 vitest 并跑时必炸（go/cli 整包 FAIL）。
	subBase := make([]benchStageMs, len(stageNames))
	subStages := make([]singleBenchStage, len(stageNames))
	for i, name := range stageNames {
		subBase[i] = benchStageMs{Name: name, Ms: 0.5}
		subStages[i] = singleBenchStage{Name: name, Duration: 1400 * time.Microsecond}
	}
	subJSON, _ := json.Marshal(subBase)
	subPath := filepath.Join(root, "subnoise.json")
	if err := os.WriteFile(subPath, subJSON, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := compareSingleBenchBaseline(subPath, subStages, 50); err != nil {
		t.Errorf("亚毫秒基准 + 小幅绝对增量不应触发退化门禁: %v", err)
	}
}
