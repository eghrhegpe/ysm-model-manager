package cli

// bench_baseline.go — 基准（baseline）对比的**判定**与**呈现**（ADR-262 D8 失败优先 / D1 结构化唯一事实源）。
//
// 立因（2026-09-18）：退化门禁（--baseline / --threshold / --save-baseline）早已能跑，
// 但「判定」与「输出」长在一起——边遍历阶段边 fmt.Println，退化时返回 error。两个消费者因此拿不到东西：
//
//   - **GUI/AI 拿不到判决**：判决只活在 stdout 散文与 error 字符串里，载荷（SetResult）没有它
//     → 界面只能说「退化超过 50%」，说不出哪个阶段、退了多少（背景缺陷「永远没有好还是坏的判定」）；
//   - **stdout 纯度被破坏**：JSON 模式下人类文案直接混进 stdout，AI 消费者 json.Unmarshal 必失败
//     —— 而 runSingleBenchJSON 的契约明写「静默运行，输出结构化数据」。
//
// 故把「判定」与「呈现」拆开：evaluateBaseline **只算不说**（零副作用），两条消费线各自取用——
// text 模式由 compareSingleBenchBaseline 渲染人话，JSON 模式把 perfBaselineDiff 塞进载荷。
// 判据（阈值 / 两层噪声下限 / 六类判决）逐字沿用旧实现，本次是纯搬运，不改判定口径。

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// baselineSlotSentinel 基准槽哨兵值：前端只说「要基准」，**路径策略留在 Go**
// （前端不该知道用户配置根的布局）。与 avatar / texture_cache 同根（ADR-046 P2），
// 避免同一台机器上多套基准目录分叉。
const baselineSlotSentinel = "default"

// 整体判决
const (
	baselineVerdictOK        = "ok"
	baselineVerdictRegressed = "regressed"
)

// 单阶段判决
const (
	// stageVerdictNew 基准里没有该阶段（阶段链变动后新增）——不判退化，如实标注
	stageVerdictNew = "new"
	// stageVerdictNoise 落在噪声下限内（双近零 / 增量在绝对噪声区间）——计时抖动，不判退化
	stageVerdictNoise = "noise"
	// stageVerdictFaster 比基准快
	stageVerdictFaster = "faster"
	// stageVerdictOK 与基准持平
	stageVerdictOK = "ok"
	// stageVerdictSlower 变慢但未超阈值
	stageVerdictSlower = "slower"
	// stageVerdictRegressed 变慢且超阈值（D8：判为失败）
	stageVerdictRegressed = "regressed"
)

// benchBaselineJSON 载荷里的基准块：保存去向与对比判决各自独立，可只出现其一。
type benchBaselineJSON struct {
	// SavedTo 本次写入的基准文件（--save-baseline）；空 = 未保存
	SavedTo string `json:"saved_to,omitempty"`
	// Diff 本次对比判决（--baseline）；nil = 未对比
	Diff *perfBaselineDiff `json:"diff,omitempty"`
}

// perfBaselineDiff 一次基准对比的判决：回显判据 + 逐阶段明细（供 GUI 展示与 AI 复盘）。
type perfBaselineDiff struct {
	Path         string  `json:"path"`
	ThresholdPct float64 `json:"threshold_pct"`
	NoiseFloorMs float64 `json:"noise_floor_ms"`
	// Verdict: ok | regressed
	Verdict string `json:"verdict"`
	// Degraded 退化超阈值的阶段数（Verdict=regressed 的唯一判据）
	Degraded int `json:"degraded"`
	// Stages 逐阶段明细，覆盖本次全部阶段（含基准里没有的新增阶段）
	Stages []perfBaselineStageDiff `json:"stages"`
}

// perfBaselineStageDiff 单阶段对比明细。base_ms 与 now_ms 同时给出，便于前端不重算百分比也能自查。
type perfBaselineStageDiff struct {
	Name     string  `json:"name"`
	BaseMs   float64 `json:"base_ms"`
	NowMs    float64 `json:"now_ms"`
	DeltaPct float64 `json:"delta_pct"`
	// Verdict: new | noise | faster | ok | slower | regressed
	Verdict string `json:"verdict"`
	// noiseDouble 仅供渲染层区分两种噪声来源（未导出 ⇒ 不进载荷，不构成契约）：
	// 「base 与 now 双近零」vs「绝对增量落在噪声区间」。载荷里统一是 noise——
	// 对消费者而言都是「判不退化」，细分只对人类读日志有意义。
	noiseDouble bool
}

// defaultBaselinePath 标准基准槽路径（平台配置根不可用时返回空串）。
// 可变函数变量：测试注入临时目录，避免写进真实用户配置根（与 texture_cache.CacheDir 同范式）。
var defaultBaselinePath = func() string {
	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		return ""
	}
	return filepath.Join(base, "YSM-Model-Manager", "perf-baseline.json")
}

// resolveBaselinePath 把「空 / 哨兵 / 显式路径」归一为实际文件路径。
func resolveBaselinePath(v string) (string, error) {
	switch v {
	case "":
		return "", nil
	case baselineSlotSentinel:
		p := defaultBaselinePath()
		if p == "" {
			return "", newRuntimeErrf("平台配置根不可用，无法定位标准基准槽；请显式传 --baseline <文件路径>")
		}
		return p, nil
	default:
		return v, nil
	}
}

// evaluateBaseline 读基准文件并判定——**只算不说**（零 stdout 副作用），JSON 模式的纯度靠它守。
func evaluateBaseline(baselinePath string, stages []singleBenchStage, thresholdPct float64) (*perfBaselineDiff, error) {
	data, err := os.ReadFile(baselinePath)
	if err != nil {
		if os.IsNotExist(err) {
			// 首次使用（还没记过基准）是最常见的路径：直接给动作，别让用户猜「文件哪去了」
			return nil, newRuntimeErrf("未找到基准文件 %s：请先用 --save-baseline 记录一次基准", baselinePath)
		}
		return nil, newRuntimeErrf("无法读取基准文件 %s: %v", baselinePath, err)
	}
	var base []benchStageMs
	if err := json.Unmarshal(data, &base); err != nil {
		return nil, newRuntimeErrf("基准文件格式错误: %s: %v", baselinePath, err)
	}
	baseMap := map[string]float64{}
	for _, b := range base {
		baseMap[b.Name] = b.Ms
	}

	diff := &perfBaselineDiff{
		Path:         baselinePath,
		ThresholdPct: thresholdPct,
		NoiseFloorMs: benchNoiseFloorMs,
		Stages:       make([]perfBaselineStageDiff, 0, len(stages)),
	}
	for _, s := range stages {
		now := msOf(s)
		baseMs, ok := baseMap[s.Name]
		if !ok {
			diff.Stages = append(diff.Stages, perfBaselineStageDiff{
				Name: s.Name, NowMs: now, Verdict: stageVerdictNew,
			})
			continue
		}
		// 双向落入噪声区间（base 与 now 都近零）→ 计时抖动，判无退化不计入。
		if baseMs <= benchNoiseFloorMs && now <= benchNoiseFloorMs {
			diff.Stages = append(diff.Stages, perfBaselineStageDiff{
				Name: s.Name, BaseMs: baseMs, NowMs: now,
				Verdict: stageVerdictNoise, noiseDouble: true,
			})
			continue
		}
		// 绝对增量本身落在噪声区间 → 同样判无退化（第 2 层保护，见 benchNoiseFloorMs 注释）。
		// 只判退化为正的一侧：neg 为「更快」，交由下方 ratio 分支照常标注。
		if delta := now - baseMs; delta > 0 && delta <= benchNoiseFloorMs {
			diff.Stages = append(diff.Stages, perfBaselineStageDiff{
				Name: s.Name, BaseMs: baseMs, NowMs: now, Verdict: stageVerdictNoise,
			})
			continue
		}
		ratio := 0.0
		if baseMs > 0 {
			ratio = (now - baseMs) / baseMs * 100
		} else {
			// base 恰为 0 但 now 已超出噪声下限 → 视为全量退化（如 0 → 50ms）。
			ratio = 100
		}
		verdict := stageVerdictOK
		switch {
		case ratio > thresholdPct:
			verdict = stageVerdictRegressed
			diff.Degraded++
		case ratio > 0:
			verdict = stageVerdictSlower
		case ratio < 0:
			verdict = stageVerdictFaster
		}
		diff.Stages = append(diff.Stages, perfBaselineStageDiff{
			Name: s.Name, BaseMs: baseMs, NowMs: now, DeltaPct: ratio, Verdict: verdict,
		})
	}

	diff.Verdict = baselineVerdictOK
	if diff.Degraded > 0 {
		diff.Verdict = baselineVerdictRegressed
	}
	return diff, nil
}

// compareSingleBenchBaseline 渲染人类可读对比（text 模式专用），退化时返回错误供 CI 判退出码。
// ⚠️ JSON 模式**不得**调用它：它的 stdout 输出就是「JSON 后跟中文散文」这一纯度缺陷的来源。
func compareSingleBenchBaseline(baselinePath string, stages []singleBenchStage, thresholdPct float64) error {
	diff, err := evaluateBaseline(baselinePath, stages, thresholdPct)
	if err != nil {
		// text 模式下保留人类可读的错误行（JSON 模式走 buildBaselineJSON，不经此处）
		fmt.Printf("❌ 基准对比失败: %v\n", err)
		return err
	}
	fmt.Println("\n📉 与基准对比（threshold " + fmt.Sprintf("%.0f%%", diff.ThresholdPct) + "，噪声下限 " + fmt.Sprintf("%.1fms", diff.NoiseFloorMs) + "）:")
	fmt.Println("   " + strings.Repeat("-", 62))
	for _, s := range diff.Stages {
		switch s.Verdict {
		case stageVerdictNew:
			fmt.Printf("   🆕 %-16s %8.2fms（无基准，跳过）\n", s.Name, s.NowMs)
		case stageVerdictNoise:
			note := "噪声区间，跳过"
			if !s.noiseDouble {
				note = "增量在噪声区间，跳过"
			}
			fmt.Printf("   🟢 %-16s %8.2f → %8.2fms (%s)\n", s.Name, s.BaseMs, s.NowMs, note)
		default:
			mark := "✅"
			switch s.Verdict {
			case stageVerdictRegressed:
				mark = "🔴 退化"
			case stageVerdictSlower:
				mark = "🟡"
			case stageVerdictFaster:
				mark = "🟢 更快"
			}
			fmt.Printf("   %s %-16s %8.2f → %8.2fms (%+6.1f%%)\n", mark, s.Name, s.BaseMs, s.NowMs, s.DeltaPct)
		}
	}
	if diff.Verdict == baselineVerdictRegressed {
		return newRuntimeErrf("%d 个阶段相对基准退化超过 %.0f%%", diff.Degraded, diff.ThresholdPct)
	}
	fmt.Println("   ✅ 无阶段退化超过阈值")
	return nil
}

// saveBenchBaseline 把本次平均耗时保存为基准 JSON（[{name,ms}]）。
//
// **本函数不打印**：它被 text 与 JSON 两条路径共用，而 JSON 模式的契约是 stdout 只有载荷
// （2026-09-18 端到端实证：此前把「💾 基准已保存到」留在这里，`--format json --save-baseline`
// 的输出就是「JSON + 中文」，AI 消费者解析失败）。人话由 text 模式的 applyBenchBaseline 宣布。
func saveBenchBaseline(path string, stages []singleBenchStage) error {
	list := make([]benchStageMs, 0, len(stages))
	for _, s := range stages {
		list = append(list, benchStageMs{Name: s.Name, Ms: msOf(s)})
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return newRuntimeErrf("序列化基准失败: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return newRuntimeErrf("写入基准失败 %s: %v", path, err)
	}
	return nil
}

// applyBenchBaseline text 模式的基准后处理：解析路径 → 对比（人类可读输出）→ 保存。
// 顺序有意为「先对比后保存」：两者指向同一槽时（GUI「记录并对比」）应先比旧基准再覆盖它。
func applyBenchBaseline(baseline, saveBaseline string, thresholdPct float64, avg []singleBenchStage) error {
	basePath, err := resolveBaselinePath(baseline)
	if err != nil {
		return err
	}
	savePath, err := resolveBaselinePath(saveBaseline)
	if err != nil {
		return err
	}
	if basePath != "" {
		if err := compareSingleBenchBaseline(basePath, avg, thresholdPct); err != nil {
			return err
		}
	}
	if savePath != "" {
		if err := saveBenchBaseline(savePath, avg); err != nil {
			return err
		}
		// 人话由这里宣布（写入者静默，见 saveBenchBaseline 注释）：JSON 模式不走本函数。
		fmt.Printf("\n💾 基准已保存到: %s\n", savePath)
	}
	return nil
}

// buildBaselineJSON JSON 模式的基准后处理：把判决与保存去向装进载荷，stdout 保持纯 JSON。
//
// 返回 (nil, nil) 表示未使用基准——载荷里连 baseline 键都不出现（omitempty 的诚实性：
// 缺席就是缺席，不是 {"diff":null}）。返回非 nil error 且 block 为 nil 表示基准文件本身不可用。
func buildBaselineJSON(baseline, saveBaseline string, thresholdPct float64, avg []singleBenchStage) (*benchBaselineJSON, error) {
	basePath, err := resolveBaselinePath(baseline)
	if err != nil {
		return nil, err
	}
	savePath, err := resolveBaselinePath(saveBaseline)
	if err != nil {
		return nil, err
	}
	if basePath == "" && savePath == "" {
		return nil, nil
	}

	block := &benchBaselineJSON{}
	var degradeErr error
	if basePath != "" {
		diff, err := evaluateBaseline(basePath, avg, thresholdPct)
		if err != nil {
			return nil, err
		}
		block.Diff = diff
		if diff.Verdict == baselineVerdictRegressed {
			// D8 失败优先：退化即失败（CI 靠退出码判定）；载荷照样交出（规律六），
			// 由调用方在 SetResult 之后再返回本错误。
			degradeErr = newRuntimeErrf("%d 个阶段相对基准退化超过 %.0f%%", diff.Degraded, diff.ThresholdPct)
		}
	}
	if savePath != "" {
		if err := saveBenchBaseline(savePath, avg); err != nil {
			return nil, err
		}
		block.SavedTo = savePath
	}
	return block, degradeErr
}

// explicitMatrixBaselineFlags 判断本次调用是否**显式**传入了基准类参数。
// fs.Visit 只遍历被显式设置的 flag，故不会把 --threshold 的默认值 50 误判成「用户用过」——
// 这比比对默认值精确（默认值可能被用户手工写成同一个数）。
func explicitMatrixBaselineFlags(fs *flag.FlagSet) bool {
	found := false
	fs.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "baseline", "save-baseline", "threshold":
			found = true
		}
	})
	return found
}
