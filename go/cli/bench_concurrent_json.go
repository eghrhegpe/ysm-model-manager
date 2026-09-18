package cli

// bench_concurrent_json.go — concurrent-bench 的结构化出口（ADR-262 D1 / D5）。
//
// 立因（2026-09-18）：concurrent-bench 此前**只有文本**——没有 `--format`、没有 ParamSpec 登记
// （Wails 桥因此走 legacy 告警路径）、GUI 里也没有它的位置。而「串行 vs 并行的加速比」正是
// ADR-262 D5（主动压测）的第一手数据，且**只有 Go 量得到**：
//   - 加速比是两次实测的比值，前端自算 = 阈值双份维护（职责红线：聚合归 Go）；
//   - 加速比判决（excellent / good / fair / none）必须单点，否则文案与配色会在两处漂移。
//
// 与 text 路径的关系：**共用同一批底层函数**（benchSerialAnalyze / benchParallelAnalyze /
// benchSerialRead / benchParallelRead / collectTestFiles / concurrentWorkerCounts /
// concurrentSpeedVerdict / concurrentHints），此外**不共享打印**——text 保持流式
// （每阶段跑完即出结果，长跑时用户看得见进度），故这里只做「静默采集 + 装配载荷」，
// 不去重排既有打印顺序。

import (
	"encoding/json"
	"fmt"
)

// concurrentSpeedSample 加速比判决与建议所需的最小信息（判据只看这两项）。
// 单独成型是为了让 text（打印表格）与 JSON（装配载荷）两条线共用**同一份**判决与建议，
// 而不是各自 switch 一遍阈值。
type concurrentSpeedSample struct {
	Workers int
	Speedup float64
}

// concurrentPhaseJSON 串行段的耗时（命名与 single-bench 的 total_ms 同口径）
type concurrentPhaseJSON struct {
	TotalMs float64 `json:"total_ms"`
	// PerModelMs 平均每模型耗时（text 的「平均/模型」）。
	// 只在串行段给出：模型体量差异会让平均值失真，并行段改由 speedup 表达。
	// ⚠️ 无 omitempty：这是**测量字段**，0 表示「测到 0」而非「没测」——
	// omitempty 会把二者合并（ADR-262 D2 的 estimated_ms 被 omitempty 整个吞掉就是这坑）。
	PerModelMs float64 `json:"per_model_ms"`
}

// concurrentWorkerJSON 单个并行档位的结果。
// 注意 speedup < 1（并行更慢）是**有效结论**，照样进载荷——不隐藏、不美化。
type concurrentWorkerJSON struct {
	Workers int     `json:"workers"`
	TotalMs float64 `json:"total_ms"`
	// Speedup 串行耗时 / 本档位耗时
	Speedup float64 `json:"speedup"`
	// Verdict 加速比判决 token（excellent|good|fair|none）：判据单点在 concurrentSpeedVerdict，
	// 前端只映射 emoji/配色，不得自算阈值（同 stageStatus 口径）。
	Verdict string `json:"verdict"`
}

// concurrentFileReadJSON 并发文件读取（Phase 3）。
// 仓库中没有合格候选文件时整块**缺席**（omitempty 的诚实性：没测就是没测，不填 0 假装测过）。
type concurrentFileReadJSON struct {
	FileCount  int     `json:"file_count"`
	SerialMs   float64 `json:"serial_ms"`
	ParallelMs float64 `json:"parallel_ms"`
	Speedup    float64 `json:"speedup"`
}

// concurrentBenchJSON concurrent-bench 结构化载荷（附 AttachSidecar 注入的 output/filesRoot）。
type concurrentBenchJSON struct {
	Workers   int `json:"workers"`
	MaxModels int `json:"max_models"`
	// ModelCount 参与测试的模型数（聚合口径归 Go，前端不数数组长度）
	ModelCount int `json:"model_count"`
	// Models 参与测试的模型身份块（relPath 跨机器可比；rtype 由 registry 单点判定）
	Models   []perfIdentity          `json:"models"`
	Serial   concurrentPhaseJSON     `json:"serial"`
	Parallel []concurrentWorkerJSON  `json:"parallel"`
	FileRead *concurrentFileReadJSON `json:"file_read,omitempty"`
	// Hints 并发建议（中文散文）。与 single-bench 同口径：未 i18n 前**不上 UI**，
	// 结构化保留供 CLI/AI 消费（前端不解析散文）。
	Hints []string `json:"hints,omitempty"`
	// ADR-200 D5 sidecar（桥接层注入）
	Output    string `json:"output,omitempty"`
	FilesRoot string `json:"filesRoot,omitempty"`
}

// AttachSidecar 实现 SidecarOutput（ADR-200 D5）：指针接收者，否则注入落到副本上。
func (c *concurrentBenchJSON) AttachSidecar(output, filesRoot string) {
	c.Output = output
	c.FilesRoot = filesRoot
}

// concurrentWorkerCounts 并行度档位：2 / 4 / 目标值，三者取并集。
// text 与 JSON 两条线共用——档位选择变了必须一起变，否则「看到的报告」与「载荷」不是同一件事。
//
// 2026-09-18 修两处档位缺陷（原实现直接返回 `{2,4,*workers}` / `{2,*workers}`）：
//   - **重复档位**：目标值本身是 2 或 4 时同一档位被测两遍，报告出现两行同名「并行(4 workers)」，
//     载荷里也会出现两条 `workers: 4`（新加的结构化出口不能天生带重复项）；
//   - **越界档位**：`--workers 1` 时原实现仍跑 2 个 worker——测了用户没要求、甚至无法并行的并发度。
func concurrentWorkerCounts(workers int) []int {
	counts := make([]int, 0, 3)
	seen := make(map[int]bool, 3)
	for _, w := range []int{2, 4, workers} {
		if w < 1 || w > workers || seen[w] {
			continue
		}
		seen[w] = true
		counts = append(counts, w)
	}
	return counts
}

// concurrentSpeedVerdict 加速比判决（Go 单点）。阈值只在**这里**出现一次。
func concurrentSpeedVerdict(speedup float64) string {
	switch {
	case speedup >= 2.0:
		return "excellent"
	case speedup >= 1.5:
		return "good"
	case speedup >= 1.2:
		return "fair"
	default:
		return "none"
	}
}

// concurrentVerdictLabel 判决 token → 中文标签（text 模式用；JSON 只出 token，文案归前端 i18n）。
func concurrentVerdictLabel(verdict string) string {
	switch verdict {
	case "excellent":
		return "优秀"
	case "good":
		return "良好"
	case "fair":
		return "一般"
	default:
		return "无提升"
	}
}

// concurrentHints 并发建议（逐行，不含缩进——缩进属渲染层）。
// text 逐行打印；JSON 结构化保留。**文案与判据都在这一个函数里**，两条线不会漂移。
func concurrentHints(samples []concurrentSpeedSample) []string {
	if len(samples) == 0 {
		return []string{"⚠️ 无并行测试结果，无法给出建议"}
	}
	best := samples[0]
	for _, s := range samples {
		if s.Speedup > best.Speedup {
			best = s
		}
	}
	switch concurrentSpeedVerdict(best.Speedup) {
	case "excellent", "good":
		return []string{
			fmt.Sprintf("✅ 推荐使用 %d workers，可获得 %.1fx 加速", best.Workers, best.Speedup),
			"💡 适合场景: 批量模型分析、并行文件处理",
		}
	case "fair":
		return []string{
			fmt.Sprintf("⚠️  并发提升有限（%.1fx），当前 I/O 可能是瓶颈", best.Speedup),
			"💡 建议: 检查磁盘 I/O，可能需要 SSD",
		}
	default:
		return []string{
			"🔴 并发无明显提升",
			"💡 原因: 单线程已能跑满，或 I/O 成为瓶颈",
		}
	}
}

// 毫秒换算统一走 bench_concurrent.go 的 durationMs（纳秒精度）——本文件不另立换算函数，
// 否则「载荷里的 ms」与「报告里的 ms」会各用一套精度。

// collectConcurrentBenchJSON 静默采集（**零 stdout 副作用**）：与 text 路径共用同一批底层函数。
func collectConcurrentBenchJSON(app AppService, models []string, workers, maxModels int, filesRoot string) *concurrentBenchJSON {
	out := &concurrentBenchJSON{
		Workers:    workers,
		MaxModels:  maxModels,
		ModelCount: len(models),
		Models:     make([]perfIdentity, 0, len(models)),
	}
	// 身份块：relPath 跨机器可比 + rtype 由 registry 单点判定（不在这里另立类型表）
	for _, p := range models {
		out.Models = append(out.Models, buildPerfIdentity(p, filesRoot, nil))
	}

	serial := benchSerialAnalyze(app, models)
	out.Serial = concurrentPhaseJSON{TotalMs: durationMs(serial.Duration)}
	if len(models) > 0 {
		out.Serial.PerModelMs = durationMs(serial.Duration) / float64(len(models))
	}

	out.Parallel = make([]concurrentWorkerJSON, 0, 3)
	samples := make([]concurrentSpeedSample, 0, 3)
	for _, wc := range concurrentWorkerCounts(workers) {
		r := benchParallelAnalyze(app, models, wc)
		item := concurrentWorkerJSON{Workers: wc, TotalMs: durationMs(r.Duration)}
		if r.Duration > 0 {
			item.Speedup = float64(serial.Duration) / float64(r.Duration)
		}
		item.Verdict = concurrentSpeedVerdict(item.Speedup)
		out.Parallel = append(out.Parallel, item)
		samples = append(samples, concurrentSpeedSample{Workers: wc, Speedup: item.Speedup})
	}
	out.Hints = concurrentHints(samples)

	// Phase 3 文件读取：候选集尽力而为，空集则整块缺席（不填 0 假装测过）
	if files := collectTestFiles(filesRoot, benchFileMaxSizeMB); len(files) > 0 {
		serialRead := benchSerialRead(files)
		parallelRead := benchParallelRead(files, workers)
		fr := &concurrentFileReadJSON{
			FileCount:  len(files),
			SerialMs:   durationMs(serialRead),
			ParallelMs: durationMs(parallelRead),
		}
		if parallelRead > 0 {
			fr.Speedup = float64(serialRead) / float64(parallelRead)
		}
		out.FileRead = fr
	}

	return out
}

// runConcurrentBenchJSON concurrent-bench 的 JSON 模式：静默运行，输出结构化数据。
// stdout 必须能被 json.Unmarshal 直接吃掉——人类文案一律不进 stdout（同 single-bench 契约）。
func runConcurrentBenchJSON(ctx *CmdContext, models []string, workers, maxModels int) error {
	out := collectConcurrentBenchJSON(ctx.App, models, workers, maxModels, ctx.FilesRoot)
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	// 双出口（ADR-200 D1/D5）：stdout 供 CLI/AI 直接消费；SetResult 让桥的 data 承载对象本体，
	// 前端因此无需解析任何中文散文。
	fmt.Println(string(data))
	ctx.SetResult(out)
	return nil
}
