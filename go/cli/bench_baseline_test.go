package cli

// bench_baseline_test.go — 基准对比的「判决」入载荷 + 基准槽 + stdout 纯度（ADR-262 D8/D1）。
//
// 立因（2026-09-18）：退化门禁（`--baseline` / `--threshold` / `--save-baseline`）早已实现、
// ParamSpec 也已登记，但**判决只活在 stdout 与 error 里**——载荷没有它。后果：
//   - GUI 即使传了参数也说不出「哪个阶段退化了、退了多少」，用户看到的只有一句
//     「1 个阶段相对基准退化超过 50%」→ 背景缺陷「永远没有好还是坏的判定」；
//   - 更要紧的是 **stdout 纯度被破坏**：`compareSingleBenchBaseline` 直接把人类文案
//     `fmt.Println` 到 stdout，于是 `--format json --baseline` 的输出是
//     「JSON + 中文散文」，AI 消费者 `json.Unmarshal` 直接失败——而
//     `runSingleBenchJSON` 的契约明写「静默运行，输出结构化数据」（ADR-262 D1）。
//
// 本文件锁三件事：
//  1. 判决进载荷（`baseline.diff`：判据回显 + 逐阶段 base/now/delta/verdict），**stdout 保持纯 JSON**；
//  2. 「基准放哪里」这条策略留在 Go：`--baseline default` / `--save-baseline default` 解析到
//     标准基准槽（与 avatar/texture_cache 同根，ADR-046 P2），前端只说「我要基准」不编路径；
//  3. 矩阵模式与基准参数**互斥**（原先静默忽略，属于「参数被吞」的不诚实）。

// ⚠️ 本轮新增用例里有四类**不并行**（有意）：凡是「抓 stdout」或「写 stdout」的用例都串行。
// 原因：captureOutput 接管的是**进程级** stdout，并行用例的打印会漏进另一用例的捕获，
// 造成「单跑必绿、并跑偶红」的假失败（2026-09-18 实测：整组并跑时 JSON 纯度断言被
// TestRunSingleBenchJSON_SaveAndCompareRoundTrip 的「💾 基准已保存到」污染）。
// Go 的顶层并行用例在串行用例全部结束后才启动，故串行 = stdout 独占。
//
// ⚠️ 覆盖包级函数变量（defaultBaselinePath）的用例同样不得并行。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// stubBaselineSlot 注入临时基准槽。⚠️ 覆盖包级函数变量 ⇒ 本组用例**不得** t.Parallel()。
func stubBaselineSlot(t *testing.T, path string) {
	t.Helper()
	prev := defaultBaselinePath
	defaultBaselinePath = func() string { return path }
	t.Cleanup(func() { defaultBaselinePath = prev })
}

func TestResolveBaselinePath(t *testing.T) {
	slot := filepath.Join(t.TempDir(), "slot.json")
	stubBaselineSlot(t, slot)

	t.Run("空值不解析", func(t *testing.T) {
		if got, err := resolveBaselinePath(""); got != "" || err != nil {
			t.Errorf("空值应返回空且无错, got %q err=%v", got, err)
		}
	})
	t.Run("哨兵走标准基准槽", func(t *testing.T) {
		got, err := resolveBaselinePath(baselineSlotSentinel)
		if err != nil || got != slot {
			t.Errorf("哨兵应解析到标准基准槽 %q, got %q err=%v", slot, got, err)
		}
	})
	t.Run("显式路径原样透传", func(t *testing.T) {
		explicit := filepath.Join(t.TempDir(), "ci-baseline.json")
		got, err := resolveBaselinePath(explicit)
		if err != nil || got != explicit {
			t.Errorf("显式路径应原样透传, got %q err=%v", got, err)
		}
	})
	t.Run("平台配置根不可用时报错而非静默", func(t *testing.T) {
		prev := defaultBaselinePath
		defaultBaselinePath = func() string { return "" }
		t.Cleanup(func() { defaultBaselinePath = prev })
		_, err := resolveBaselinePath(baselineSlotSentinel)
		if err == nil || !strings.Contains(err.Error(), "标准基准槽") {
			t.Errorf("无法定位基准槽时应明确报错, got %v", err)
		}
	})
}

// TestEvaluateBaseline_Verdicts 六类判决的判定口径必须与旧实现的打印分支逐字一致
// （本次只把判定从「边算边打印」拆成「先判定后渲染」，不得改变判据）。
func TestEvaluateBaseline_Verdicts(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	base := []benchStageMs{
		{Name: "退化的", Ms: 100},
		{Name: "略慢的", Ms: 100},
		{Name: "持平的", Ms: 100},
		{Name: "更快的", Ms: 100},
		{Name: "噪声的", Ms: 0.2},
	}
	raw, _ := json.Marshal(base)
	basePath := filepath.Join(root, "base.json")
	if err := os.WriteFile(basePath, raw, 0o644); err != nil {
		t.Fatal(err)
	}

	stages := []singleBenchStage{
		{Name: "退化的", Duration: 200 * time.Millisecond},
		{Name: "略慢的", Duration: 120 * time.Millisecond},
		{Name: "持平的", Duration: 100 * time.Millisecond},
		{Name: "更快的", Duration: 50 * time.Millisecond},
		{Name: "噪声的", Duration: 400 * time.Microsecond},
		{Name: "无基准的", Duration: 10 * time.Millisecond},
	}

	diff, err := evaluateBaseline(basePath, stages, 50)
	if err != nil {
		t.Fatalf("evaluateBaseline 出错: %v", err)
	}
	if diff.Verdict != baselineVerdictRegressed || diff.Degraded != 1 {
		t.Errorf("恰有一个阶段超阈值 → verdict=regressed/degraded=1, got %q/%d", diff.Verdict, diff.Degraded)
	}
	if diff.ThresholdPct != 50 || diff.NoiseFloorMs != benchNoiseFloorMs {
		t.Errorf("判据应回显, got threshold=%v noise=%v", diff.ThresholdPct, diff.NoiseFloorMs)
	}
	if diff.Path != basePath {
		t.Errorf("应回显基准文件路径, got %q", diff.Path)
	}

	got := map[string]perfBaselineStageDiff{}
	for _, s := range diff.Stages {
		got[s.Name] = s
	}
	if len(got) != len(stages) {
		t.Fatalf("逐阶段明细应覆盖全部阶段（含新增），got %d want %d", len(got), len(stages))
	}
	cases := []struct {
		name    string
		verdict string
		delta   float64
	}{
		{"退化的", stageVerdictRegressed, 100},
		{"略慢的", stageVerdictSlower, 20},
		{"持平的", stageVerdictOK, 0},
		{"更快的", stageVerdictFaster, -50},
		{"噪声的", stageVerdictNoise, 0},
		{"无基准的", stageVerdictNew, 0},
	}
	for _, c := range cases {
		s, ok := got[c.name]
		if !ok {
			t.Errorf("缺少阶段 %q 的对比明细", c.name)
			continue
		}
		if s.Verdict != c.verdict {
			t.Errorf("%s 判决应为 %q, got %q", c.name, c.verdict, s.Verdict)
		}
		if s.Verdict != stageVerdictNew && s.Verdict != stageVerdictNoise {
			if diff := s.DeltaPct - c.delta; diff > 0.01 || diff < -0.01 {
				t.Errorf("%s delta_pct 应约 %.1f, got %.2f", c.name, c.delta, s.DeltaPct)
			}
		}
		if s.NowMs <= 0 {
			t.Errorf("%s 应回显 now_ms, got %v", c.name, s.NowMs)
		}
	}
}

// TestEvaluateBaseline_DoesNotPrint 判定阶段必须无副作用输出——stdout 纯度靠它守。
// 抓 stdout ⇒ 不并行（见文件头 captureOutput 说明）。
func TestEvaluateBaseline_DoesNotPrint(t *testing.T) {
	root := t.TempDir()
	raw, _ := json.Marshal([]benchStageMs{{Name: "① 文件读取", Ms: 0.001}})
	basePath := filepath.Join(root, "base.json")
	if err := os.WriteFile(basePath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	out := captureOutput(t, func() {
		if _, err := evaluateBaseline(basePath, []singleBenchStage{{Name: "① 文件读取", Duration: time.Second}}, 1); err != nil {
			t.Errorf("evaluateBaseline 应只判定不报错: %v", err)
		}
	})
	if strings.TrimSpace(out) != "" {
		t.Errorf("evaluateBaseline 不得有任何 stdout 输出（JSON 模式纯度）, got %q", out)
	}
}

// TestEvaluateBaseline_MissingFileActionable 首次使用（还没记过基准）是最常见的路径，
// 错误信息必须直接告诉用户下一步动作。
func TestEvaluateBaseline_MissingFileActionable(t *testing.T) {
	t.Parallel()
	_, err := evaluateBaseline(filepath.Join(t.TempDir(), "nope.json"), nil, 50)
	if err == nil {
		t.Fatal("基准文件不存在应报错")
	}
	if !strings.Contains(err.Error(), "记录一次基准") {
		t.Errorf("缺基准文件时应引导「先记录基准」, got %q", err.Error())
	}
}

// TestBuildBaselineJSON_VerdictAndSavePath 判定数学用**合成 stages** 锁（确定性，不依赖真实计时）：
// 真实采集在 fake app 下各阶段只耗几十微秒，落在 1ms 噪声下限内会被正确判成 noise 而非退化——
// 那是判据在起作用，不是缺陷；故「退化」这一层不放到集成测试里断言。
func TestBuildBaselineJSON_VerdictAndSavePath(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	basePath := filepath.Join(root, "base.json")
	raw, _ := json.Marshal([]benchStageMs{{Name: "① 文件读取", Ms: 0.001}})
	if err := os.WriteFile(basePath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	stages := []singleBenchStage{{Name: "① 文件读取", Duration: 50 * time.Millisecond}}

	t.Run("退化返回错误且仍给载荷", func(t *testing.T) {
		block, err := buildBaselineJSON(basePath, "", 1, stages)
		if err == nil {
			t.Error("退化应返回错误（D8 失败优先：CI 靠退出码判定）")
		}
		if block == nil || block.Diff == nil {
			t.Fatalf("退化也必须有载荷（规律六：错误分支要带结构化数据）, got %+v", block)
		}
		if block.Diff.Verdict != baselineVerdictRegressed || block.Diff.Degraded != 1 {
			t.Errorf("应为 1 个阶段退化, got verdict=%q degraded=%d", block.Diff.Verdict, block.Diff.Degraded)
		}
	})

	t.Run("未用基准连键都不出现", func(t *testing.T) {
		block, err := buildBaselineJSON("", "", 50, stages)
		if block != nil || err != nil {
			t.Errorf("未用基准应返回 nil block/nil err, got %+v err=%v", block, err)
		}
	})

	t.Run("只保存时回显去向且无 diff", func(t *testing.T) {
		savePath := filepath.Join(root, "saved.json")
		block, err := buildBaselineJSON("", savePath, 50, stages)
		if err != nil {
			t.Fatalf("保存不应出错: %v", err)
		}
		if block == nil || block.SavedTo != savePath {
			t.Errorf("应回显保存去向 %q, got %+v", savePath, block)
		}
		if block.Diff != nil {
			t.Errorf("只保存未对比时不应有 diff: %+v", block.Diff)
		}
		if _, err := os.Stat(savePath); err != nil {
			t.Errorf("应真的写出基准文件: %v", err)
		}
	})
}

// TestRunSingleBenchJSON_BaselinePurityAndAttach 集成（真实跑一次 → 存基准 → 再对比）：
// 锁「stdout 纯 JSON」与「判决装配进载荷」两件事。判决取值本身由上面两个单测确定性覆盖。
// 抓 stdout ⇒ 不并行（见文件头 captureOutput 说明）。
func TestRunSingleBenchJSON_BaselinePurityAndAttach(t *testing.T) {
	root := t.TempDir()
	modelPath := filepath.Join(root, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-model-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	basePath := filepath.Join(root, "base.json")

	if err := runSingleBenchJSON(&CmdContext{App: &benchFakeApp{}, FilesRoot: root}, modelPath, 1, "", basePath, 50); err != nil {
		t.Fatalf("保存基准应成功: %v", err)
	}

	ctx := &CmdContext{App: &benchFakeApp{}, FilesRoot: root}
	var err error
	out := captureOutput(t, func() {
		err = runSingleBenchJSON(ctx, modelPath, 1, basePath, "", 50)
	})
	// 有意不把 err 当失败：自对比在整包并发负载下可能偶发判出「退化」——噪声下限只能压到
	// 一定程度（见 benchNoiseFloorMs 注释与 TestRunSingleBenchJSON_SaveAndCompareRoundTrip
	// 记录的实测 flake）。本用例锁的是**纯度**与**装配**，判决取值由上面两个确定性单测覆盖，
	// 故退化与否都不影响这里的两条断言。
	_ = err

	// ① stdout 纯度：JSON 模式不得混入任何人类文案（旧实现正是在这里漏了中文散文）
	if !json.Valid([]byte(strings.TrimSpace(out))) {
		t.Errorf("--format json 的 stdout 必须是纯 JSON（不得混入人类文案）:\n%s", out)
	}
	for _, human := range []string{"📉", "💾", "退化超过", "无阶段退化超过阈值"} {
		if strings.Contains(out, human) {
			t.Errorf("人类可读文案 %q 不得进 stdout:\n%s", human, out)
		}
	}

	// ② 判决装配进载荷
	payload, ok := ctx.result.(*singleBenchJSON)
	if !ok {
		t.Fatalf("SetResult 应为 *singleBenchJSON, got %T", ctx.result)
	}
	if payload.Baseline == nil || payload.Baseline.Diff == nil {
		t.Fatalf("载荷应带 baseline.diff（GUI 据此说「哪个阶段退化了」）, got %+v", payload.Baseline)
	}
	if payload.Baseline.Diff.Verdict == "" {
		t.Error("判决不得为空")
	}
	if len(payload.Baseline.Diff.Stages) == 0 {
		t.Error("逐阶段明细不应为空")
	}
	if payload.Baseline.Diff.ThresholdPct != 50 {
		t.Errorf("应回显阈值, got %v", payload.Baseline.Diff.ThresholdPct)
	}
	if _, err := json.Marshal(payload); err != nil {
		t.Errorf("载荷应可序列化（桥接层要交给前端）: %v", err)
	}
}

// TestRunSingleBenchJSON_BaselineBlockOnlyWhenUsed 未用基准参数时不得凭空出现 baseline 块
// （omitempty 的诚实性：缺席就是缺席，不是 `{"diff":null}`）。
// 抓 stdout ⇒ 不并行（见文件头 captureOutput 说明）。
func TestRunSingleBenchJSON_BaselineBlockOnlyWhenUsed(t *testing.T) {
	root := t.TempDir()
	modelPath := filepath.Join(root, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-model-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx := &CmdContext{App: &benchFakeApp{}, FilesRoot: root}
	out := captureOutput(t, func() {
		if err := runSingleBenchJSON(ctx, modelPath, 1, "", "", 50); err != nil {
			t.Fatalf("无基准参数应成功: %v", err)
		}
	})
	if strings.Contains(out, `"baseline"`) {
		t.Errorf("未用基准参数时载荷不应含 baseline 键: %s", out)
	}
	if payload := ctx.result.(*singleBenchJSON); payload.Baseline != nil {
		t.Errorf("未用基准参数时 baseline 应为 nil, got %+v", payload.Baseline)
	}
}

// TestRunSingleBenchJSON_SaveBaselineSlot 前端只说「记录基准」，路径由 Go 定（哨兵）。
func TestRunSingleBenchJSON_SaveBaselineSlot(t *testing.T) {
	root := t.TempDir()
	slot := filepath.Join(root, "perf-baseline.json")
	stubBaselineSlot(t, slot)

	modelPath := filepath.Join(root, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("fake-model-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	ctx := &CmdContext{App: &benchFakeApp{}, FilesRoot: root}
	_ = captureOutput(t, func() {
		if err := runSingleBenchJSON(ctx, modelPath, 1, "", baselineSlotSentinel, 50); err != nil {
			t.Fatalf("保存到标准基准槽应成功: %v", err)
		}
	})

	raw, err := os.ReadFile(slot)
	if err != nil {
		t.Fatalf("标准基准槽应被写入: %v", err)
	}
	if !json.Valid(raw) {
		t.Errorf("基准文件应为合法 JSON: %s", raw)
	}
	payload := ctx.result.(*singleBenchJSON)
	if payload.Baseline == nil || payload.Baseline.SavedTo != slot {
		t.Errorf("载荷应回显保存去向 %q, got %+v", slot, payload.Baseline)
	}
	if payload.Baseline.Diff != nil {
		t.Errorf("只保存未对比时不应有 diff: %+v", payload.Baseline.Diff)
	}
}

// TestSingleBench_BaselineRejectedInMatrixMode 矩阵模式的载荷是 models[]，
// 基准是**单模型**概念——原先静默吞掉参数，应改为明确拒绝（宁可报错不可吞）。
func TestSingleBench_BaselineRejectedInMatrixMode(t *testing.T) {
	t.Parallel()
	cases := [][]string{
		{"--all-types", "--format", "json", "--baseline", "x.json"},
		{"--all-types", "--format", "json", "--save-baseline", "x.json"},
		{"--rtype", "ysm", "--format", "json", "--baseline", "x.json"},
		{"--rtype", "ysm", "--format", "json", "--save-baseline", "x.json"},
	}
	for _, args := range cases {
		err := runSingleBench(&CmdContext{App: &benchFakeApp{}, FilesRoot: t.TempDir(), Args: args})
		if err == nil || !strings.Contains(err.Error(), "基准") {
			t.Errorf("矩阵模式 + 基准参数应明确拒绝, args=%v got %v", args, err)
		}
	}
	// 阈值单独出现时也应拒绝（它只对 --baseline 有意义）
	err := runSingleBench(&CmdContext{App: &benchFakeApp{}, FilesRoot: t.TempDir(),
		Args: []string{"--all-types", "--format", "json", "--threshold", "10"}})
	if err == nil || !strings.Contains(err.Error(), "基准") {
		t.Errorf("矩阵模式 + --threshold 应明确拒绝, got %v", err)
	}
}

// TestBuildBaselineJSON_SaveSurvivesCompareFailure 「记录 + 对比」是 GUI 最自然的首次用法
// （两个勾同时打上），而此刻基准文件**本来就不存在**。
// 原实现在对比出错时早退，于是 save 分支永不执行 → 用户点了「记录基准」，盘上什么都没有，
// 还被指引去「请先用 --save-baseline 记录一次基准」（他刚点过）——属「参数被吞」的内部违例：
// 参数没被拒，而是被静默丢弃。顺序仍是先比后存（先比旧基准再覆盖），只是失败不再中断记录。
func TestBuildBaselineJSON_SaveSurvivesCompareFailure(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	missing := filepath.Join(dir, "no-such-baseline.json")
	savePath := filepath.Join(dir, "recorded.json")
	stages := []singleBenchStage{{Name: "① 文件读取", Duration: 5 * time.Millisecond}}

	block, err := buildBaselineJSON(missing, savePath, 50, stages)
	if err == nil {
		t.Fatal("对比失败必须回传错误，否则 CI 会把「没比成」当成功")
	}
	if _, statErr := os.Stat(savePath); statErr != nil {
		t.Fatalf("对比失败不得吞掉记录动作，基准文件应已写出: %v", statErr)
	}
	if block == nil {
		t.Fatal("载荷仍应交出（规律六）：本次记录的去向就在里面")
	}
	if block.SavedTo != savePath {
		t.Errorf("载荷应回显本次记录的去向 %q, got %q", savePath, block.SavedTo)
	}
	if block.Diff != nil {
		t.Errorf("对比失败不得凭空给出判决: %+v", block.Diff)
	}
	if !strings.Contains(err.Error(), "已记录") {
		t.Errorf("错误应说明本次已记录新基准（否则指引用户去做刚做完的事）, got %v", err)
	}
}

// TestApplyBenchBaseline_SaveSurvivesCompareFailure text 路径同病同修。
// ⚠️ 本用例会写 stdout（💾 基准已保存到），故**不并行**（stdout 是进程级共享，见文件头）。
func TestApplyBenchBaseline_SaveSurvivesCompareFailure(t *testing.T) {
	dir := t.TempDir()
	missing := filepath.Join(dir, "no-such-baseline.json")
	savePath := filepath.Join(dir, "recorded.json")
	stages := []singleBenchStage{{Name: "① 文件读取", Duration: 5 * time.Millisecond}}

	err := applyBenchBaseline(missing, savePath, 50, stages)
	if err == nil {
		t.Fatal("对比失败必须回传错误")
	}
	if _, statErr := os.Stat(savePath); statErr != nil {
		t.Fatalf("text 路径同样不得吞掉记录动作: %v", statErr)
	}
	if !strings.Contains(err.Error(), "已记录") {
		t.Errorf("错误应说明本次已记录新基准, got %v", err)
	}
}

// ── D-7：基准不可用要给**结构化原因**，不能让 GUI 只能转述中文散文 ──────────
// 立因（2026-09-18）：JSON 模式下「基准不存在」只以中文散文出现在 load 的 error 串里
// （`未找到基准文件 C:\Users\...\perf-baseline.json：请先用 --save-baseline 记录一次基准`），
// GUI 原样上屏 → 英文/日文界面出现未翻译中文，且泄露本机绝对路径与 CLI 口令。
// 修法：载荷带 `baseline.error`（token）+ `baseline.detail`（人话，含路径，只进 title/CLI）。
func TestBuildBaselineJSON_UnavailableCarriesToken(t *testing.T) {
	// ⚠️ 不并行：slot_unavailable 子用例覆盖包级变量 defaultBaselinePath，
	// 与同样覆盖它的 TestRunSingleBenchJSON_SaveBaselineSlot 并发跑即 data race
	// （见 stubBaselineSlot 的文件头约定）。
	root := t.TempDir()
	stages := []singleBenchStage{{Name: "① 文件读取", Duration: 2 * time.Millisecond}}

	t.Run("文件不存在 → missing", func(t *testing.T) {
		missing := filepath.Join(root, "no-such.json")
		block, err := buildBaselineJSON(missing, "", 50, stages)
		if err == nil {
			t.Fatal("基准不可用必须回传错误（退出码是 CI 的判据）")
		}
		if block == nil {
			t.Fatal("不可用时也要交载荷（规律六），否则前端只能转述中文散文")
		}
		if block.Error != baselineErrMissing {
			t.Errorf("应给 token %q, got %q", baselineErrMissing, block.Error)
		}
		if block.Diff != nil {
			t.Errorf("没比成就不该有判决: %+v", block.Diff)
		}
		if !strings.Contains(block.Detail, missing) {
			t.Errorf("detail 应含路径（供 CLI/AI 追问）, got %q", block.Detail)
		}
	})

	t.Run("文件损坏 → invalid", func(t *testing.T) {
		broken := filepath.Join(root, "broken.json")
		if err := os.WriteFile(broken, []byte("{ not json"), 0o644); err != nil {
			t.Fatal(err)
		}
		block, err := buildBaselineJSON(broken, "", 50, stages)
		if err == nil || block == nil {
			t.Fatalf("损坏基准应回传错误且带载荷, got block=%+v err=%v", block, err)
		}
		if block.Error != baselineErrInvalid {
			t.Errorf("应给 token %q, got %q", baselineErrInvalid, block.Error)
		}
	})

	t.Run("路径是目录/读不了 → unreadable", func(t *testing.T) {
		// 目录不是合法基准文件，读它必然失败且**不是** IsNotExist
		block, err := buildBaselineJSON(root, "", 50, stages)
		if err == nil || block == nil {
			t.Fatalf("不可读应回传错误且带载荷, got block=%+v err=%v", block, err)
		}
		if block.Error != baselineErrUnreadable {
			t.Errorf("应给 token %q, got %q", baselineErrUnreadable, block.Error)
		}
	})

	t.Run("槽位不可用 → slot_unavailable", func(t *testing.T) {
		// ⚠️ 覆盖包级变量 → 本子用例不得并行（父用例已 t.Parallel 亦不可再并行子用例）
		prev := defaultBaselinePath
		defaultBaselinePath = func() string { return "" }
		t.Cleanup(func() { defaultBaselinePath = prev })

		block, err := buildBaselineJSON(baselineSlotSentinel, "", 50, stages)
		if err == nil || block == nil {
			t.Fatalf("槽位不可用应回传错误且带载荷, got block=%+v err=%v", block, err)
		}
		if block.Error != baselineErrSlotUnavailable {
			t.Errorf("应给 token %q, got %q", baselineErrSlotUnavailable, block.Error)
		}
	})
}

// TestReconcileBaselineErrors_NoDoublePrefix 包错误的二次包装陷阱回归：
// `ErrRuntime.Error()` 自带「运行时错误: 」前缀，说明「已记录」时必须取内层原因。
// 本用例在 D-7 引入 baselineUnavailable 包装层后尤其重要——多一层 Unwrap 就会复发。
func TestReconcileBaselineErrors_NoDoublePrefix(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	missing := filepath.Join(dir, "no-such.json")
	saved := filepath.Join(dir, "saved.json")

	_, compareErr := evaluateBaseline(missing, nil, 50)
	if compareErr == nil {
		t.Fatal("缺基准文件应报错")
	}
	got := reconcileBaselineErrors(compareErr, saved)
	if got == nil {
		t.Fatal("对比失败必须回传错误")
	}
	if strings.Count(got.Error(), "运行时错误") != 1 {
		t.Errorf("错误前缀只应出现一次（二次包装陷阱）, got %q", got.Error())
	}
	if !strings.Contains(got.Error(), "已记录") {
		t.Errorf("应说明本次已记录新基准, got %q", got.Error())
	}
	if !strings.Contains(got.Error(), "no-such.json") {
		t.Errorf("内层原因（含路径）不应被吞掉, got %q", got.Error())
	}
}

// TestEvaluateBaseline_TextProseUnchanged text 模式的人话**不变**（D-7 只加结构化出口，
// 不改 CLI 观感）：引导动作的句子与路径都要还在。
func TestEvaluateBaseline_TextProseUnchanged(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "nope.json")
	_, err := evaluateBaseline(path, nil, 50)
	if err == nil {
		t.Fatal("应报错")
	}
	for _, want := range []string{"运行时错误", "未找到基准文件", path, "--save-baseline"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("text 模式人话不应改变，缺 %q: %q", want, err.Error())
		}
	}
}
