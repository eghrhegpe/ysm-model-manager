// bench_concurrent.go：并发/单模型基准测试 harness（原 concurrent.go，2026-09-06 锐评正名）。
// 文件内容全部是 benchmark 工具命令（concurrent-bench / single-bench），非生产并发代码；
// 生产并发收敛在 go/conc（ADR-197）。与生产 AppService（appservice.go）同包仅因共用
// CLI 基建（RegisterCommandC / newCmdFlagSet / newParamErrf 等），依赖纠缠暂不拆包。
package cli

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

func init() {
	RegisterCommandC("concurrent-bench", CatPerf, "并发能力基准测试（串行 vs 并行对比，建议先优化单模型）", runConcurrentBench,
		// ADR-173：登记后桥才走 ParamSpec 通道；此前无 spec → 走 legacy 告警路径。
		// 与 flag 定义序一致（workers / max-models / format）。
		ParamSpec{Key: "workers", Type: ParamNumber},
		ParamSpec{Key: "max-models", Type: ParamNumber},
		ParamSpec{Key: "format", Type: ParamString},
	)
	RegisterCommandC("single-bench", CatPerf, "单模型加载基准测试（优化基础，单模型快=所有场景快）", runSingleBench,
		ParamSpec{Key: "model", Type: ParamString},
		ParamSpec{Key: "iterations", Type: ParamNumber},
		// ADR-262 D3 矩阵：rtype / all-types / max-models 与 flag 定义序一致
		ParamSpec{Key: "rtype", Type: ParamString},
		ParamSpec{Key: "all-types", Type: ParamBool},
		ParamSpec{Key: "max-models", Type: ParamNumber},
		// ADR-262 D3 第三种目标集：全库前 N 大（按模型占用排名，与按类型取样互斥）
		ParamSpec{Key: "top-largest", Type: ParamNumber},
		ParamSpec{Key: "baseline", Type: ParamString},
		ParamSpec{Key: "save-baseline", Type: ParamString},
		ParamSpec{Key: "threshold", Type: ParamNumber},
		ParamSpec{Key: "format", Type: ParamString},
	)
}

// concurrentBenchResult 并发测试结果
type concurrentBenchResult struct {
	Name        string
	Duration    time.Duration
	WorkerCount int
	Speedup     float64
}

// runConcurrentBench 运行并发基准测试：text 流式打印 / json 静默出结构化载荷（ADR-262 D1）。
// 两条线共用同一批底层采集函数与同一份判据（bench_concurrent_json.go），只有呈现方式不同。
func runConcurrentBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("concurrent-bench")
	workers := fs.Int("workers", 4, "并发 worker 数量")
	maxModels := fs.Int("max-models", 20, "最多测试的模型数量")
	format := fs.String("format", "text", "输出格式: text（人类可读，流式打印）/ json（AI 友好，结构化载荷）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *workers < 1 {
		return newParamErrf("workers 必须 >= 1，当前: %d", *workers)
	}
	if *workers > 256 {
		return newParamErrf("workers 必须 <= 256，当前: %d（过高会导致调度开销超过收益）", *workers)
	}
	if *maxModels < 1 {
		return newParamErrf("max-models 必须 >= 1，当前: %d", *maxModels)
	}
	if *format != "text" && *format != "json" {
		return newParamErrf("--format 必须是 text 或 json")
	}

	// 目标集（含空集报错）在两条线之前算好：JSON 模式不打印任何进度，故不能把选样本埋进打印流程
	benchModels, err := pickConcurrentBenchModels(ctx, *maxModels)
	if err != nil {
		return err
	}
	if *format == "json" {
		return runConcurrentBenchJSON(ctx, benchModels, *workers, *maxModels)
	}

	fmt.Println("⚡ 并发能力基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   Worker 数量: %d\n", *workers)
	fmt.Printf("   最大模型数:   %d\n", *maxModels)
	fmt.Println(strings.Repeat("=", 70))

	// Phase 0 的“准备”在两条线之前已完成（JSON 模式不打印进度，故样本集先算好）；
	// 这里按旧版顺序补回标题行，保证 text 输出逐字一致。
	fmt.Println("\n📊 Phase 0: 准备测试数据...")
	fmt.Printf("   测试模型数: %d\n", len(benchModels))
	fmt.Println()

	// 2. 串行测试
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 1: 串行模型分析")
	fmt.Println(strings.Repeat("-", 70))

	serialResult := benchSerialAnalyze(ctx.App, benchModels)
	// 耗时一律走 durationMs（纳秒精度）：`Microseconds()/1000` 会把亚毫秒截断成 0.00ms，
	// 进而把「并行快得多」显示成 `加速比: 0.0x 🔴 无提升`——截断制造的假结论（ADR-262 D2 同款教训）。
	fmt.Printf("   串行耗时: %.2fms\n", durationMs(serialResult.Duration))
	fmt.Printf("   平均/模型: %.2fms\n", durationMs(serialResult.Duration)/float64(len(benchModels)))

	// 3. 并行测试
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 2: 并行模型分析")
	fmt.Println(strings.Repeat("-", 70))

	var parallelResults []concurrentBenchResult
	// 档位选择与 JSON 线共用（concurrentWorkerCounts）：报告与载荷必须是同一件事
	workerCounts := concurrentWorkerCounts(*workers)

	for _, wc := range workerCounts {
		result := benchParallelAnalyze(ctx.App, benchModels, wc)
		if result.Duration > 0 {
			result.Speedup = float64(serialResult.Duration) / float64(result.Duration)
		}
		parallelResults = append(parallelResults, result)

		speedupStr := fmt.Sprintf("%.1fx", result.Speedup)
		speedupStr = speedEmoji(result.Speedup) + " " + speedupStr

		fmt.Printf("   Workers=%d: %.2fms (加速比: %s)\n",
			result.WorkerCount,
			durationMs(result.Duration),
			speedupStr)
	}

	// 4. 文件读取并发测试
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 3: 并发文件读取")
	fmt.Println(strings.Repeat("-", 70))

	collectFiles := collectTestFiles(ctx.FilesRoot, benchFileMaxSizeMB)
	if len(collectFiles) > 0 {
		fileResult := benchParallelRead(collectFiles, *workers)
		serialFileResult := benchSerialRead(collectFiles)

		fmt.Printf("   文件数: %d\n", len(collectFiles))
		fmt.Printf("   串行: %.2fms\n", durationMs(serialFileResult))
		fmt.Printf("   并行(%d workers): %.2fms\n", *workers, durationMs(fileResult))
		// 除零守卫：并行读取耗时理论上可为 0（空文件集/极快），直接相除会打出 `+Infx`（旧实现实测踩到）
		fileSpeedup := 0.0
		if fileResult > 0 {
			fileSpeedup = float64(serialFileResult) / float64(fileResult)
		}
		fmt.Printf("   加速比: %.1fx\n", fileSpeedup)
	}

	// 5. 汇总报告
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 汇总报告")
	fmt.Println(strings.Repeat("-", 70))

	printConcurrentReport(serialResult, parallelResults)

	return nil
}

// pickConcurrentBenchModels 选出参与并发基准的模型（text / json 两条线共用）。
//
// 只取 CLI 可分析的模型（归属归 classifyForScan、可分析性归 perfTypeManifest，单点在 perf_targets.go）：
// 本命令调 AnalyzeBedrockModel，类型不在分析链路上时拿到空模型、各阶段耗时全是空数据。
//
// 2026-09-18 收编（ADR-262 D3）：原实现取 `ext == ".ysm"`（ADR 漏记的又一张表），
// 且无 .ysm 命中时**退化为取任意条目**——把 PMX/VRM 喂进分析链路。
// 现在无可用模型时如实报错，不用空数据凑出一份看起来成功的报告。
func pickConcurrentBenchModels(ctx *CmdContext, maxModels int) ([]string, error) {
	entries := ctx.App.ScanModelEntries(ctx.FilesRoot)
	if len(entries) == 0 {
		return nil, newRuntimeErrf("未找到任何模型")
	}
	models := pickCliAnalyzable(entries)
	if len(models) == 0 {
		return nil, newRuntimeErrf("未找到 CLI 可分析的模型（仅 .ysm 及其容器/解包目录形态在 CLI 分析链路上）")
	}
	if len(models) > maxModels {
		models = models[:maxModels]
	}
	return models, nil
}

// benchSerialAnalyze 串行分析模型
func benchSerialAnalyze(a AppService, models []string) concurrentBenchResult {
	start := time.Now()

	for _, path := range models {
		_ = a.AnalyzeBedrockModel(path)
	}

	return concurrentBenchResult{
		Name:     "serial",
		Duration: time.Since(start),
	}
}

// benchParallelAnalyze 并行分析模型
func benchParallelAnalyze(a AppService, models []string, workers int) concurrentBenchResult {
	start := time.Now()

	modelCh := make(chan string, len(models))
	resultCh := make(chan time.Duration, len(models))

	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range modelCh {
				// recover 防单个畸形模型 panic 导致 resultCh 永不关闭、主循环永久阻塞
				func() {
					defer func() {
						if r := recover(); r != nil {
							// 保留诊断（哪个模型 + 异常值）；该模型不计入并行耗时
							fmt.Fprintf(os.Stderr, "⚠️ 模型分析 panic 已跳过（%s）: %v\n", path, r)
						}
					}()
					s := time.Now()
					_ = a.AnalyzeBedrockModel(path)
					resultCh <- time.Since(s)
				}()
			}
		}()
	}

	for _, path := range models {
		modelCh <- path
	}
	close(modelCh)

	go func() {
		wg.Wait()
		close(resultCh)
	}()

	for range resultCh {
	}

	elapsed := time.Since(start)

	return concurrentBenchResult{
		Name:        fmt.Sprintf("parallel-%d", workers),
		Duration:    elapsed,
		WorkerCount: workers,
	}
}

// benchFileMaxSizeMB 参与并发读基准的单文件上限（MB）：超大文件会把「读吞吐」测成「单文件等待」。
// text 与 JSON 两条线共用，避免一处改了另一处还用旧值。
const benchFileMaxSizeMB = 50

// benchFileLimit 文件读取基准的候选数上限——准备阶段是诊断前置步骤，不应被海量目录拖垮。
const benchFileLimit = 30

// collectTestFiles 收集测试文件：maxSizeMB 过滤超大文件，条目数达 benchFileLimit 即止。
func collectTestFiles(root string, maxSizeMB int64) []string {
	var files []string

	filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // 测试数据收集尽力而为，坏路径跳过
		}
		if d.IsDir() {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil || info.Size() == 0 || info.Size() >= maxSizeMB*1024*1024 {
			return nil
		}
		switch strings.ToLower(filepath.Ext(path)) {
		case ".ysm", ".json", ".zip", ".7z":
			files = append(files, path)
			if len(files) >= benchFileLimit {
				return filepath.SkipAll
			}
		}
		return nil
	})

	return files
}

// benchSerialRead 串行读取文件
func benchSerialRead(files []string) time.Duration {
	start := time.Now()

	for _, f := range files {
		_, _ = os.ReadFile(f) // 基准隔离（ADR-176 2.4 例）：只测读吞吐，故意吞内容/错误非生产丢失
	}

	return time.Since(start)
}

// benchParallelRead 并行读取文件
func benchParallelRead(files []string, workers int) time.Duration {
	start := time.Now()

	fileCh := make(chan string, len(files))
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for f := range fileCh {
				_, _ = os.ReadFile(f) // 基准隔离（ADR-176 2.4 例）：只测读吞吐，故意吞内容/错误非生产丢失
			}
		}()
	}

	for _, f := range files {
		fileCh <- f
	}
	close(fileCh)

	wg.Wait()
	return time.Since(start)
}

// printConcurrentReport 打印并发测试报告。
// 判决（concurrentSpeedVerdict）与建议（concurrentHints）都取自 JSON 侧的单点，
// 阈值/文案只写一份——text 与载荷不可能给出互相矛盾的结论。
func printConcurrentReport(serial concurrentBenchResult, parallel []concurrentBenchResult) {
	fmt.Println()
	fmt.Println("📈 性能对比表:")
	fmt.Printf("   %-20s %-15s %-12s %s\n", "方案", "耗时", "加速比", "状态")
	fmt.Println("   " + strings.Repeat("-", 60))
	fmt.Printf("   %-20s %-15s %-12s %s\n",
		"串行",
		fmt.Sprintf("%.2fms", durationMs(serial.Duration)),
		"1.00x",
		"🟢 基准")

	samples := make([]concurrentSpeedSample, 0, len(parallel))
	for _, p := range parallel {
		verdict := concurrentSpeedVerdict(p.Speedup)
		samples = append(samples, concurrentSpeedSample{Workers: p.WorkerCount, Speedup: p.Speedup})
		status := speedEmoji(p.Speedup) + " " + concurrentVerdictLabel(verdict)

		fmt.Printf("   %-20s %-15s %-12s %s\n",
			fmt.Sprintf("并行(%d workers)", p.WorkerCount),
			fmt.Sprintf("%.2fms", durationMs(p.Duration)),
			fmt.Sprintf("%.2fx", p.Speedup),
			status)
	}

	fmt.Println()
	fmt.Println("💡 并发建议:")
	for _, hint := range concurrentHints(samples) {
		fmt.Println("   " + hint)
	}
}

// singleBenchStage 单模型测试阶段
type singleBenchStage struct {
	Name     string
	Duration time.Duration
	Bytes    int64
	Notes    string
	// Runtime 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）：没有归属字段，
	// 「Go / Rust / WASM / Three 的耗时构成」就是黑箱，Rust 扫描器与 WASM 解析器的收益无从度量。
	Runtime string
	// Failed 阶段失败标记（如 ① 读盘失败）：耗时分级（stageStatus）只看 ms，失败必须独立成字段，
	// 否则失败阶段会因 0ms 被判为 ok —— 全链路失败的 bench 在载荷里看起来全绿（2026-09-17 实测）。
	Failed bool
}

// runSingleBench 单模型加载基准测试
func runSingleBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("single-bench")
	modelPath := fs.String("model", "", "指定模型路径（与 --rtype 二选一；目录式模型可传解包目录或 <dir>/ysm.json）")
	iterations := fs.Int("iterations", 3, "重复测试次数")
	rtype := fs.String("rtype", "", "按资源类型跑矩阵（registry 类型 id，如 ysm；仅 --format json）")
	allTypes := fs.Bool("all-types", false, "跑仓库中全部资源类型的矩阵（每类型各取 --max-models 条；仅 --format json）")
	maxModels := fs.Int("max-models", 5, "矩阵模式每类型最多测试的模型数（按路径字典序确定性取样）")
	topLargest := fs.Int("top-largest", 0, "全库前 N 大目标集（N>0 启用；按模型占用排名，目录式模型按目录内容合计；仅 --format json）")
	baseline := fs.String("baseline", "", "对比基准：显式 JSON 文件路径（[{name,ms}]），或哨兵 default = 标准基准槽 <用户配置根>/YSM-Model-Manager/perf-baseline.json；任一阶段退化超 --threshold 时返回失败")
	saveBaseline := fs.String("save-baseline", "", "记录基准：显式 JSON 文件路径，或哨兵 default = 标准基准槽（供后续 --baseline 对比）；与 --baseline 同用时先比后存")
	thresholdPct := fs.Float64("threshold", 50, "退化阈值百分比（默认 50），配合 --baseline 使用")
	format := fs.String("format", "text", "输出格式: text（人类可读）/ json（AI 友好）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	topRequested := *topLargest > 0
	if *modelPath == "" && *rtype == "" && !*allTypes && !topRequested {
		return newParamErrf("必须指定 --model 参数，或用 --rtype <类型> / --all-types / --top-largest <N> 跑目标集")
	}
	if *modelPath != "" && (*rtype != "" || *allTypes || topRequested) {
		return newParamErrf("--model 与 --rtype/--all-types/--top-largest 互斥：单模型基准传 --model，目标集传后者")
	}
	if *topLargest < 0 {
		return newParamErrf("--top-largest 不能为负（0 表示不启用）")
	}
	if topRequested && (*rtype != "" || *allTypes) {
		return newParamErrf("--top-largest 与 --rtype/--all-types 互斥：前者是全库统一排名，后者按类型取样")
	}
	if topRequested && explicitFlagSet(fs, "max-models") {
		return newParamErrf("--max-models 与 --top-largest 互斥：两者都表示取几条（前 N 大用 --top-largest 的 N）")
	}
	if *rtype != "" && *allTypes {
		return newParamErrf("--rtype 与 --all-types 互斥：指定类型用 --rtype，全类型用 --all-types")
	}
	if *iterations <= 0 {
		return newParamErrf("--iterations 必须大于 0")
	}
	if *format != "text" && *format != "json" {
		return newParamErrf("--format 必须是 text 或 json")
	}
	if *maxModels <= 0 {
		return newParamErrf("--max-models 必须大于 0")
	}
	// 全库前 N 大（ADR-262 D3 第三种目标集）：与矩阵同族——只出结构化载荷，且同样拒基准参数
	// （基准是单模型概念，matrix 的静默吞参教训在此复用同一道门）。
	if topRequested {
		if *format != "json" {
			return newParamErrf("--top-largest 仅支持 --format json（text 模式无目标集呈现口径）")
		}
		if explicitMatrixBaselineFlags(fs) {
			return newParamErrf("--top-largest 模式不支持基准参数（--baseline / --save-baseline / --threshold）：基准是单模型概念，请用 --model 跑单模型基准")
		}
		return runSingleBenchTopLargestJSON(ctx, *topLargest, *iterations)
	}

	// 类型矩阵（ADR-262 D3）：目标集由 Go 侧按 registry 类型扫描，仅结构化输出（text 模式无矩阵呈现口径）
	if *rtype != "" || *allTypes {
		if *format != "json" {
			return newParamErrf("矩阵模式（--rtype / --all-types）仅支持 --format json（text 模式无矩阵呈现口径）")
		}
		// 基准参数只在单模型路径上有意义（矩阵载荷是 models[]，基准是单模型概念）。
		// 原先这三个参数在矩阵模式下被**静默吞掉**——用户以为在跟基准比，其实没有：
		// 参数被吞 = 不诚实，宁可报错。（用 fs.Visit 精确区分「显式传入」与「默认值」。）
		if explicitMatrixBaselineFlags(fs) {
			return newParamErrf("类型矩阵模式不支持基准参数（--baseline / --save-baseline / --threshold）：基准是单模型概念，请用 --model 跑单模型基准")
		}
		if *allTypes {
			return runSingleBenchAllTypesJSON(ctx, *maxModels, *iterations)
		}
		return runSingleBenchMatrixJSON(ctx, *rtype, *maxModels, *iterations)
	}

	// 目标解析（复用 perf-snapshot 的同一出口）：目录式模型折叠为 <dir>/ysm.json，下游零目录分支。
	// 传目录路径曾直接 ① 读盘失败（os.ReadFile 对目录报错），且失败被平均环节吞掉 → 载荷全绿。
	target, terr := resolveTargetModel(*modelPath, ctx.FilesRoot)
	if terr != nil {
		return terr
	}
	*modelPath = target

	// JSON 模式：静默运行，最后输出 JSON
	if *format == "json" {
		return runSingleBenchJSON(ctx, *modelPath, *iterations, *baseline, *saveBaseline, *thresholdPct)
	}

	fmt.Println("🎯 单模型加载基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   模型:     %s\n", *modelPath)
	fmt.Printf("   迭代次数: %d\n", *iterations)
	fmt.Println()
	fmt.Println("   💡 核心理念: 单模型快 = 所有场景快")
	fmt.Println("      多角色是单角色的叠加，优化单角色是基础")
	fmt.Println(strings.Repeat("=", 70))

	var allStages [][]singleBenchStage
	totalDuration := time.Duration(0)

	allStages, totalDuration = runSingleBenchSamples(ctx.App, *modelPath, ctx.FilesRoot, *iterations, func(iter int, stages []singleBenchStage) {
		if *iterations > 1 {
			fmt.Printf("\n📝 迭代 %d/%d\n", iter+1, *iterations)
		}
		printSingleModelStages(stages)
	})

	fmt.Println()
	fmt.Println(strings.Repeat("=", 70))
	fmt.Println("📊 汇总分析")
	fmt.Println(strings.Repeat("=", 70))

	avg := avgBenchStages(allStages)
	if len(allStages) == 0 {
		fmt.Println("⚠️  无基准数据（allStages 为空）")
		return nil
	}
	if *iterations > 1 {
		printAverageStages(allStages)
	} else {
		printSingleModelStages(allStages[0])
	}

	fmt.Println()
	fmt.Printf("⏱️  总耗时（%d 次迭代）: %.2fms\n", *iterations, float64(totalDuration.Microseconds())/1000)

	if len(allStages) > 0 {
		printOptimizationHints(allStages[0])
	}

	// C-1：基准对比 / 保存（供 CI 判定性能退化，复用 file-bench --baseline 语义）
	return applyBenchBaseline(*baseline, *saveBaseline, *thresholdPct, avg)
}

// singleBenchJSON 单模型基准测试 JSON 输出结构（AI 友好）
type singleBenchJSON struct {
	Model      string `json:"model"`
	Iterations int    `json:"iterations"`
	// TotalMs = N 次迭代的累计墙钟；「一次加载多久」看 PerIterationMs。
	// 旧实现只给 TotalMs，前端直接当成单次总耗时展示——迭代 N 次时虚高 N 倍。
	TotalMs        float64          `json:"total_ms"`
	PerIterationMs float64          `json:"per_iteration_ms"`
	Stages         []benchStageJSON `json:"stages"`
	Bottleneck     string           `json:"bottleneck"`
	Hints          []string         `json:"hints"`
	Format         string           `json:"format"`
	SizeBytes      int64            `json:"size_bytes"`
	// FootprintBytes 参与「全库前 N 大」排名的**模型占用**（仅该模式填；其余模式 omitempty 缺席）。
	// 为什么不能拿 SizeBytes 顶替：目录式模型的 SizeBytes 是 0（identity 口径），排名依据看不见
	// 就等于不可复核——回显体量才能让读者自己验「它凭什么排第一」。
	FootprintBytes int64 `json:"footprint_bytes,omitempty"`
	// Identity 身份块（ADR-262 D2）：registry 类型 id + 相对路径限定。
	// format/size_bytes 保留在原处不动（既有消费者），rtype 才是判定口径。
	Identity perfIdentity `json:"identity"`
	// Baseline 基准对比/保存结果（ADR-262 D8）：nil = 本次未用基准参数（缺席就是缺席）。
	// 判决进载荷后，GUI 才能说出「哪个阶段退化了、退了多少」，而不是只转述一句门槛错误。
	Baseline *benchBaselineJSON `json:"baseline,omitempty"`
	// ADR-200 D5 sidecar：迁移期保留人类可读文本与 filesRoot，供前端「复制原文」与
	// respHasOutput 守卫。仅由桥接层注入（AttachSidecar），stdout 载荷不含。
	Output    string `json:"output,omitempty"`
	FilesRoot string `json:"filesRoot,omitempty"`
}

// AttachSidecar 实现 SidecarOutput（ADR-200 D5）：桥接层注入人类可读文本与 filesRoot。
// 必须指针接收者——buildJsonData 对 SetResult 传入的指针做接口断言。
func (s *singleBenchJSON) AttachSidecar(output, filesRoot string) {
	s.Output = output
	s.FilesRoot = filesRoot
}

// benchStageJSON 单个阶段 JSON 结构
type benchStageJSON struct {
	Name       string  `json:"name"`
	Ms         float64 `json:"ms"`
	Bytes      int64   `json:"bytes,omitempty"`
	Status     string  `json:"status"`
	Bottleneck bool    `json:"bottleneck"`
	Note       string  `json:"note,omitempty"`
	// Runtime 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）
	Runtime string `json:"runtime"`
	// Stats 样本统计（ADR-262 D2）：n / median_ms / p95_ms。
	// 仅实测阶段有；无样本（纯汇总路径）时为 nil —— 不伪造 n=0 的统计。
	Stats *benchStageStats `json:"stats,omitempty"`
}

// benchStageStats 阶段在多轮迭代中的样本分布（ADR-262 D2）。
//
// 此前 `stages` 只有 N 轮均值：数据其实已在手里（runSingleBenchSamples 保留全部样本），
// 却由 avgBenchStages 当场平均掉 —— 「无样本统计、无方差可言」（ADR-262 §背景 #6）。
// n 是**该阶段实际出现的次数**（阶段可因失败提前返回而缺席某轮），非迭代轮数。
type benchStageStats struct {
	N      int     `json:"n"`
	Median float64 `json:"median_ms"`
	P95    float64 `json:"p95_ms"`
}

// stagesToJSON 将平均阶段列表转换为 JSON 结构，同时识别瓶颈，并从原始样本附上分布统计。
// 两趟：先定唯一最大阶段，再单点打标——旧实现「每超过当前最大值即置 true」，
// 会把先出现的次大阶段也标成 bottleneck（可产出多个 bottleneck=true）。
// allStages 为 nil（纯汇总调用方无原始样本）时不附 stats。
func stagesToJSON(avg []singleBenchStage, allStages [][]singleBenchStage) ([]benchStageJSON, string) {
	var maxMs float64
	var bottleneckName string
	for _, s := range avg {
		if ms := msOf(s); ms > maxMs {
			maxMs = ms
			bottleneckName = s.Name
		}
	}

	stats := collectStageStats(allStages)
	stageJSON := make([]benchStageJSON, 0, len(avg))
	for _, s := range avg {
		ms := msOf(s)
		// 失败优先于耗时分级：失败阶段常是 0ms（如目录不能 ReadFile），若只按 ms 分级会被判 ok
		status := stageStatus(ms)
		if s.Failed {
			status = "failed"
		}
		var st *benchStageStats
		if got, ok := stats[s.Name]; ok {
			// 取地址前必须先拷一份：st 是 *benchStageStats，直接 &got 会指向 map 迭代变量
			snapshot := got
			st = &snapshot
		}
		stageJSON = append(stageJSON, benchStageJSON{
			Name:   s.Name,
			Ms:     ms,
			Bytes:  s.Bytes,
			Status: status,
			// 唯一瓶颈且超过「偏慢」阈值（10ms）；并列时首者胜，保证确定性
			Bottleneck: s.Name == bottleneckName && ms > 10,
			Note:       s.Notes,
			Runtime:    s.Runtime,
			Stats:      st,
		})
	}
	return stageJSON, bottleneckName
}

// collectStageStats 汇总各阶段在 N 轮迭代中的样本分布（ADR-262 D2）。
// 与 avgBenchStages 同源（同一份 allStages），不额外采集。
func collectStageStats(allStages [][]singleBenchStage) map[string]benchStageStats {
	samples := map[string][]float64{}
	for _, stages := range allStages {
		for _, s := range stages {
			samples[s.Name] = append(samples[s.Name], msOf(s))
		}
	}
	out := make(map[string]benchStageStats, len(samples))
	for name, xs := range samples {
		out[name] = benchStageStats{
			N:      len(xs),
			Median: percentileNearestRank(xs, 0.5),
			P95:    percentileNearestRank(xs, 0.95),
		}
	}
	return out
}

// percentileNearestRank 最近秩法取分位数：升序后取 ceil(p*n)-1 号样本。
//
// 选最近秩而非线性插值：默认只跑 3 轮，插值会产出「不存在的样本」（如 n=3 的 p95 内插出
// 从未实测到的值），与「数字必须来自实测」的口径冲突；最近秩保证结果必是某次真实样本。
// 副作用是它对 p 单调（两分位下标不递降）→ 结构不变量 p95 >= median 对任意 n 恒成立
// （ADR-262 D6：断言只锁结构不变量）。
func percentileNearestRank(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	cp := append([]float64(nil), xs...)
	sort.Float64s(cp)
	idx := int(math.Ceil(p*float64(len(cp)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(cp) {
		idx = len(cp) - 1
	}
	return cp[idx]
}

// benchOneModel 跑一个模型的 N 次迭代并组装单模型载荷（单模型命令与类型矩阵共用，不打印）。
// 第二返回值 = 平均阶段列表，供 --baseline 退化对比复用（避免重复采集）。
func benchOneModel(a AppService, modelPath, filesRoot string, iterations int) (singleBenchJSON, []singleBenchStage) {
	allStages, totalDuration := runSingleBenchSamples(a, modelPath, filesRoot, iterations, nil)
	avg := avgBenchStages(allStages)
	stageJSON, bottleneckName := stagesToJSON(avg, allStages)

	totalMs := float64(totalDuration.Microseconds()) / 1000
	// 单次平均：AI/前端问「这个模型加载一次多久」时要的是它，而非 N 次累计
	perIterationMs := totalMs
	if iterations > 0 {
		perIterationMs = totalMs / float64(iterations)
	}
	return singleBenchJSON{
		Model:          modelPath,
		Iterations:     iterations,
		TotalMs:        totalMs,
		PerIterationMs: perIterationMs,
		Stages:         stageJSON,
		Bottleneck:     bottleneckName,
		Hints:          generateHints(avg),
		Format:         detectModelFormat(modelPath),
		// 目录式模型（ysm.json 入口）size 记 0——见 perfIdentitySize
		SizeBytes: perfIdentitySize(modelPath),
		// 身份块（ADR-262 D2）：registry 类型 id + 相对路径限定，供测试/AI 分辨真实场景类别
		Identity: buildPerfIdentity(modelPath, filesRoot, nil),
	}, avg
}

// identityOnlyPayload CLI 无该类型解析器时的诚实载荷：只给身份与格式，**不采集阶段耗时**
// （空模型的阶段数据不是实测，采集出来就是「数字不可信」的又一个来源）。
func identityOnlyPayload(modelPath, filesRoot, rtype string) singleBenchJSON {
	return singleBenchJSON{
		Model:    modelPath,
		Stages:   []benchStageJSON{},
		Format:   detectModelFormat(modelPath),
		Identity: buildPerfIdentity(modelPath, filesRoot, nil),
		Hints: []string{
			"⛔ CLI 无 " + rtype + " 解析器：未采集阶段耗时（解析器在前端 3D adapter，见 gui-flow 对 PMX 跳过 ④⑤⑥ 的同源口径）",
		},
	}
}

// runSingleBenchJSON 单模型基准测试 JSON 模式：静默运行，输出结构化数据
// （stdout 必须可被 json.Unmarshal 直接吃掉——人类可读文案一律不进 stdout，见 bench_baseline.go）。
func runSingleBenchJSON(ctx *CmdContext, modelPath string, iterations int, baseline, saveBaseline string, thresholdPct float64) error {
	// 归一化（经 runSingleBench 进入时已是 entry path，此处幂等）：保证直接调用（测试/内部）同样吃目录
	target, terr := resolveTargetModel(modelPath, ctx.FilesRoot)
	if terr != nil {
		return terr
	}
	modelPath = target

	output, avg := benchOneModel(ctx.App, modelPath, ctx.FilesRoot, iterations)

	// 基准对比 / 保存：判决进载荷，**stdout 保持纯 JSON**。
	// 旧实现在此处调 compareSingleBenchBaseline —— 它把中文散文 fmt.Println 到 stdout，
	// 于是 --format json --baseline 的输出是「JSON + 中文」，AI 消费者 json.Unmarshal 必失败
	// （而本函数的契约就是「静默运行，输出结构化数据」）。
	// 基准文件本身不可用时 block=nil 且 err≠nil：**仍然**输出并 SetResult 本次基准结果
	// （规律六：错误分支也要带结构化数据），错误信息说明缺什么。
	block, degradeErr := buildBaselineJSON(baseline, saveBaseline, thresholdPct, avg)
	if block != nil {
		output.Baseline = block
	}

	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	// 双出口（ADR-200 D1/D5）：stdout 供 CLI/AI 直接消费；SetResult 让 Wails 桥的 data
	// 承载结构化对象（而非 output 文本）——前端因此无需再正则解析中文人类文案。
	fmt.Println(string(data))
	ctx.SetResult(&output)

	// D8 失败优先：退化即失败（CI 靠退出码判定）；载荷已在上面交出
	return degradeErr
}

// singleBenchMatrixJSON 多模型矩阵载荷（ADR-262 D3）：目标集由 Go 侧按 registry 类型扫描产出，
// 前端/AI 只需读 models[]，不自行挑样本、不自行判类型。
type singleBenchMatrixJSON struct {
	Spec   perfMatrixSpec    `json:"spec"`
	Models []singleBenchJSON `json:"models"`
	// ADR-200 D5 sidecar（桥接层注入）
	Output    string `json:"output,omitempty"`
	FilesRoot string `json:"filesRoot,omitempty"`
}

// AttachSidecar 实现 SidecarOutput（ADR-200 D5）。
func (m *singleBenchMatrixJSON) AttachSidecar(output, filesRoot string) {
	m.Output = output
	m.FilesRoot = filesRoot
}

// perfMatrixSpec 矩阵实验规格（回显解析结果，供 AI 复盘「跑的是谁、几个、为什么跳」）。
type perfMatrixSpec struct {
	// Rtype 单类型矩阵时回显目标类型；--all-types 时为空（逐类型信息看 types[]）
	Rtype     string `json:"rtype,omitempty"`
	AllTypes  bool   `json:"all_types"`
	MaxModels int    `json:"max_models"`
	// MaxModels 是**每类型**上限（--all-types 下各类型独立取样）
	Iterations int `json:"iterations"`
	// Analyzed 实际采集了阶段耗时的模型数
	Analyzed int `json:"analyzed"`
	// Unsupported 命中类型但 CLI 无解析器、只出身份的模型数（非静默跳过：见 identityOnlyPayload）
	Unsupported int `json:"unsupported"`
	// CliAnalyzable 单类型矩阵下该类型是否具备 CLI 分析链路（--all-types 看 types[].cli_analyzable）
	CliAnalyzable bool `json:"cli_analyzable"`
	// TopLargest 全库前 N 大模式的 N（0 = 未启用）。三种目标集互斥，故与 Rtype/AllTypes 互不同现
	TopLargest int `json:"top_largest,omitempty"`
	// SizeSource 目标集体量口径 token（仅前 N 大模式回显）：
	// dir_total = 目录式模型按目录内容合计、其余按文件大小（见 perfSizeSourceDirTotal）。
	// 回显口径而不是让消费者猜「这个 N 大是按什么排的」——排序不可见就等于不可复核
	SizeSource string `json:"size_source,omitempty"`
	// Types 逐类型汇总（单类型矩阵也有一项，形状统一）
	Types []perfTypeSummary `json:"types"`
}

// perfTypeSummary 单类型汇总：仓库里有多少、跑了几条、清单声明该几条阶段、实际是否吻合。
type perfTypeSummary struct {
	Rtype         string `json:"rtype"`
	RtypeLabel    string `json:"rtype_label,omitempty"`
	CliAnalyzable bool   `json:"cli_analyzable"`
	// Found 仓库中该类型条目总数（截断前）
	Found int `json:"found"`
	// Analyzed / Unsupported 实际采集 / 仅出身份的模型数
	Analyzed    int `json:"analyzed"`
	Unsupported int `json:"unsupported"`
	// ExpectedStages 样本清单声明的阶段链长度（0 = CLI 不采集阶段）
	ExpectedStages int `json:"expected_stages"`
	// StageMismatch 可分析类型但实际阶段数与清单声明不符 —— 阶段链断裂的显式信号
	// （样本清单因此不只是文档，而是矩阵运行时的自检依据）
	StageMismatch bool `json:"stage_mismatch,omitempty"`
}

// matrixGroups 矩阵目标分组：rtype 为空取仓库全部类型；否则只取该类型（未命中返回 nil）。
func matrixGroups(filesRoot, rtype string, maxModels int) []perfTypeGroup {
	all := scanTargetsGrouped(filesRoot, maxModels)
	if rtype == "" {
		return all
	}
	for _, g := range all {
		if g.Rtype == rtype {
			return []perfTypeGroup{g}
		}
	}
	return nil
}

// collectBenchTarget 采集单个目标：可分析 → 真跑分析并核阶段链；不可分析 → 只出身份（不伪造阶段耗时）。
//
// 单类型矩阵 / --all-types / --top-largest 三种目标集共用这一条采集路径——三者的差异只在
// **选谁、按什么顺序**，不在「怎么采」。返回值：载荷、是否 unsupported、阶段链是否与清单声明不符。
func collectBenchTarget(ctx *CmdContext, path, rtype string, iterations int, entry perfTypeManifestEntry) (singleBenchJSON, bool, bool) {
	if !entry.CliAnalyzable {
		return identityOnlyPayload(path, ctx.FilesRoot, rtype), true, false
	}
	payload, _ := benchOneModel(ctx.App, path, ctx.FilesRoot, iterations)
	mismatch := entry.ExpectedStages > 0 && len(payload.Stages) != entry.ExpectedStages
	return payload, false, mismatch
}

// buildMatrixPayload 把类型分组采集为矩阵载荷（单类型与 --all-types 共用同一形状）。
func buildMatrixPayload(ctx *CmdContext, groups []perfTypeGroup, iterations int, allTypes bool, maxModels int) singleBenchMatrixJSON {
	out := singleBenchMatrixJSON{
		Spec:   perfMatrixSpec{AllTypes: allTypes, MaxModels: maxModels, Iterations: iterations, Types: []perfTypeSummary{}},
		Models: make([]singleBenchJSON, 0),
	}
	for _, g := range groups {
		entry := perfTypeManifest[g.Rtype]
		sum := perfTypeSummary{
			Rtype:          g.Rtype,
			RtypeLabel:     rtypeDisplayName(g.Rtype),
			CliAnalyzable:  entry.CliAnalyzable,
			Found:          g.Found,
			ExpectedStages: entry.ExpectedStages,
		}
		for _, t := range g.Targets {
			payload, unsupported, mismatch := collectBenchTarget(ctx, t, g.Rtype, iterations, entry)
			if mismatch {
				sum.StageMismatch = true
			}
			out.Models = append(out.Models, payload)
			if unsupported {
				sum.Unsupported++
			} else {
				sum.Analyzed++
			}
		}
		out.Spec.Analyzed += sum.Analyzed
		out.Spec.Unsupported += sum.Unsupported
		out.Spec.Types = append(out.Spec.Types, sum)
	}
	if !allTypes && len(groups) == 1 {
		out.Spec.Rtype = groups[0].Rtype
		out.Spec.CliAnalyzable = cliAnalyzable(groups[0].Rtype)
	}
	return out
}

// buildTopLargestPayload 前 N 大目标集载荷：models[] 严格按**排名顺序**（前 N 大的意义就在「谁最大」，
// 按类型归并会把这个信息弄丢），types[] 仍给逐类型汇总（含全库未截断的 found）。
func buildTopLargestPayload(ctx *CmdContext, ranked []perfTopTarget, foundByType map[string]int, iterations, n int) singleBenchMatrixJSON {
	out := singleBenchMatrixJSON{
		Spec: perfMatrixSpec{
			TopLargest: n,
			SizeSource: perfSizeSourceDirTotal,
			Iterations: iterations,
			Types:      []perfTypeSummary{},
		},
		Models: make([]singleBenchJSON, 0, len(ranked)),
	}
	sums := make(map[string]*perfTypeSummary)
	order := make([]string, 0, len(ranked))
	for _, t := range ranked {
		entry := perfTypeManifest[t.Rtype]
		sum, seen := sums[t.Rtype]
		if !seen {
			sum = &perfTypeSummary{
				Rtype:          t.Rtype,
				RtypeLabel:     rtypeDisplayName(t.Rtype),
				CliAnalyzable:  entry.CliAnalyzable,
				Found:          foundByType[t.Rtype],
				ExpectedStages: entry.ExpectedStages,
			}
			sums[t.Rtype] = sum
			order = append(order, t.Rtype)
		}
		payload, unsupported, mismatch := collectBenchTarget(ctx, t.Path, t.Rtype, iterations, entry)
		// 回填体量：报告里看得见排名依据，读者才能自己验「它凭什么排第一」
		payload.FootprintBytes = t.Footprint
		if mismatch {
			sum.StageMismatch = true
		}
		out.Models = append(out.Models, payload)
		if unsupported {
			sum.Unsupported++
		} else {
			sum.Analyzed++
		}
	}
	// types[] 按类型名升序（与矩阵同约定）：确定性不依赖入选顺序
	sort.Strings(order)
	for _, rt := range order {
		sum := sums[rt]
		out.Spec.Types = append(out.Spec.Types, *sum)
		out.Spec.Analyzed += sum.Analyzed
		out.Spec.Unsupported += sum.Unsupported
	}
	return out
}

// runSingleBenchTopLargestJSON 全库前 N 大：扫全库算占用 → 排名 → 取前 N → 逐个采集。
func runSingleBenchTopLargestJSON(ctx *CmdContext, n, iterations int) error {
	if ctx.FilesRoot == "" {
		return newParamErrf("--top-largest 需要 --files-root 指定仓库根")
	}
	ranked, foundByType := scanTopLargestTargets(ctx.FilesRoot, n)
	if len(ranked) == 0 {
		return newRuntimeErrf("仓库中未发现任何模型（root=%s）", ctx.FilesRoot)
	}
	return emitMatrix(ctx, buildTopLargestPayload(ctx, ranked, foundByType, iterations, n))
}

// emitMatrix 打印矩阵载荷并走双出口（ADR-200 D1/D5）。
func emitMatrix(ctx *CmdContext, out singleBenchMatrixJSON) error {
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	fmt.Println(string(data))
	ctx.SetResult(&out)
	return nil
}

// runSingleBenchMatrixJSON 单类型矩阵：按 rtype 取目标集，逐个采集（或仅出身份）。
func runSingleBenchMatrixJSON(ctx *CmdContext, rtype string, maxModels, iterations int) error {
	if ctx.FilesRoot == "" {
		return newParamErrf("--rtype 矩阵模式需要 --files-root 指定仓库根")
	}
	groups := matrixGroups(ctx.FilesRoot, rtype, maxModels)
	if len(groups) == 0 {
		return newRuntimeErrf("仓库中未找到 rtype=%s 的模型（root=%s）", rtype, ctx.FilesRoot)
	}
	return emitMatrix(ctx, buildMatrixPayload(ctx, groups, iterations, false, maxModels))
}

// runSingleBenchAllTypesJSON 全类型矩阵：仓库里有什么类型就跑什么，每类型各取 maxModels 条。
func runSingleBenchAllTypesJSON(ctx *CmdContext, maxModels, iterations int) error {
	if ctx.FilesRoot == "" {
		return newParamErrf("--all-types 矩阵模式需要 --files-root 指定仓库根")
	}
	groups := matrixGroups(ctx.FilesRoot, "", maxModels)
	if len(groups) == 0 {
		return newRuntimeErrf("仓库中未发现任何模型（root=%s）", ctx.FilesRoot)
	}
	return emitMatrix(ctx, buildMatrixPayload(ctx, groups, iterations, true, maxModels))
}

// detectModelFormat 根据文件扩展名检测模型格式
func detectModelFormat(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".ysm":
		return "YSM"
	case ".pmx":
		return "PMX"
	case ".pmd":
		return "PMD"
	case ".vrm":
		return "VRM"
	case ".gltf", ".glb":
		return "GLTF"
	case ".litematic":
		return "Litematic"
	case ".json":
		// 目录式模型的入口是 ysm.json：按扩展名报 "JSON" 会与 identity.rtype=ysm 在同一份
		// 报告里打架（用户/AI 看到「类型 YSM、格式 JSON」）。此处按唯一谓词 IsYsmEntryJSON 归位。
		if registry.IsYsmEntryJSON(filepath.Base(path)) {
			return "YSM"
		}
		return "JSON"
	case ".zip":
		return "Pack"
	default:
		return "Unknown"
	}
}

// parseStageName 阶段②「模型解析」的名称按格式切换——
// 历史硬编码「② JSON 解析」对 MMD(.pmx/.pmd 二进制解析)构成误导（用户以为 JSON 慢，实为 PMX 解析慢）。
func parseStageName(path string) string {
	switch detectModelFormat(path) {
	case "YSM", "JSON":
		return "② JSON 解析"
	case "PMX", "PMD":
		return "② PMX 解析"
	default:
		return "② 模型解析"
	}
}

// generateHints 根据各阶段耗时生成 AI 友好的优化建议
func generateHints(stages []singleBenchStage) []string {
	var hints []string
	for _, s := range stages {
		ms := float64(s.Duration.Microseconds()) / 1000
		if ms <= 10 {
			continue
		}
		switch s.Name {
		case "① 文件读取":
			hints = append(hints, fmt.Sprintf("文件读取 %.1fms：检查磁盘速度，考虑缓存或 SSD", ms))
		case "② JSON 解析", "② PMX 解析", "② 模型解析":
			hints = append(hints, fmt.Sprintf("%s %.1fms：模型可能过大，考虑精简数据或使用更快的解析器", s.Name, ms))
		case "③ 数据验证":
			hints = append(hints, fmt.Sprintf("数据验证 %.1fms：考虑延迟非关键验证", ms))
		case "④ 几何数据准备":
			hints = append(hints, fmt.Sprintf("几何数据准备 %.1fms：考虑简化模型或 LOD", ms))
		case "⑤ 纹理数据准备":
			hints = append(hints, fmt.Sprintf("纹理数据准备 %.1fms：使用 KTX2/DDS 压缩可减少 60-70%%", ms))
		case "⑥ 序列化模拟":
			hints = append(hints, fmt.Sprintf("序列化 %.1fms：减少数据量或使用更高效的序列化（Wails binding 走 JSON）", ms))
		case "⑦ 缓存检查":
			hints = append(hints, fmt.Sprintf("缓存检查 %.1fms：确保纹理缓存正常命中", ms))
		}
	}
	if len(hints) == 0 {
		hints = append(hints, "所有阶段 <10ms，性能良好")
	}
	return hints
}

// benchStageMs single-bench 基准 JSON 条目（[{name,ms}]）
type benchStageMs struct {
	Name string  `json:"name"`
	Ms   float64 `json:"ms"`
}

// avgBenchStages 计算多次迭代的各阶段平均耗时。
// 按「阶段名」配对而非索引：某次迭代读取失败只返回 1 阶段（runSingleModelBench
// 提前 return）时，索引配对会把后续阶段错位进缺失阶段的均值；名字配对下
// 各迭代同名归组、缺失阶段不计入该阶段均值，长度不齐也不会越界。
// 输出保持阶段首次出现的顺序。
func avgBenchStages(allStages [][]singleBenchStage) []singleBenchStage {
	if len(allStages) == 0 {
		return nil
	}
	var order []string
	totals := map[string]time.Duration{}
	counts := map[string]int{}
	bytes := map[string]int64{}
	notes := map[string]string{}
	runtimes := map[string]string{}
	failed := map[string]bool{}
	for _, stages := range allStages {
		for _, s := range stages {
			if counts[s.Name] == 0 {
				order = append(order, s.Name)
			}
			totals[s.Name] += s.Duration
			counts[s.Name]++
			bytes[s.Name] += s.Bytes
			// 首个非空 Notes 优先："失败: 目录不能 ReadFile" 这类诊断信息不能被平均环节吞掉
			// （原实现只取 Duration，Notes/Bytes/Failed 全丢 → 失败在载荷里表现为 ok）
			if notes[s.Name] == "" && s.Notes != "" {
				notes[s.Name] = s.Notes
			}
			// runtime 同 Notes：归属是阶段事实，平均环节不得丢（首轮非空优先）
			if runtimes[s.Name] == "" && s.Runtime != "" {
				runtimes[s.Name] = s.Runtime
			}
			if s.Failed {
				failed[s.Name] = true
			}
		}
	}
	out := make([]singleBenchStage, 0, len(order))
	for _, name := range order {
		out = append(out, singleBenchStage{
			Name:     name,
			Duration: totals[name] / time.Duration(counts[name]),
			Bytes:    bytes[name] / int64(counts[name]),
			Notes:    notes[name],
			Runtime:  runtimes[name],
			Failed:   failed[name],
		})
	}
	return out
}

// msOf 阶段耗时转毫秒
func msOf(s singleBenchStage) float64 {
	return float64(s.Duration.Microseconds()) / 1000
}

// durationMs 裸 duration → 毫秒（纳秒精度）。
// ⚠️ 与 msOf(singleBenchStage) 的区别不只是入参：那个走 Microseconds() 会**截断亚毫秒**，
// 并发基准的串行/并行耗时经常在 1ms 以下（空仓库 + 假 app 时是几十微秒），
// 用截断值会让 speedup = 0/0 或 0/x 退化成 0。ADR-262 D2 同款教训（估算被截断成 0 后遭 omitempty 吞掉）。
func durationMs(d time.Duration) float64 {
	return float64(d.Nanoseconds()) / 1e6
}

// stageMark 阶段耗时的 emoji 分级单一实现：>100ms 瓶颈 / >50 注意 / >10 偏慢 / 其余健康。
func stageMark(ms float64) string {
	switch {
	case ms > 100:
		return "🔴 瓶颈"
	case ms > 50:
		return "🟡 注意"
	case ms > 10:
		return "🟢"
	default:
		return "✅"
	}
}

// stageStatus JSON 口径的阶段状态分级（与 stageMark 同阈值，供 AI 消费）。
func stageStatus(ms float64) string {
	switch {
	case ms > 100:
		return "bottleneck"
	case ms > 50:
		return "warn"
	case ms > 10:
		return "slow"
	default:
		return "ok"
	}
}

// speedEmoji 并发加速比信号灯色点：≥1.5 绿 / ≥1.2 黄 / 否则红（行内与表格两处共享，防阈值漂移）。
func speedEmoji(speedup float64) string {
	switch {
	case speedup >= 1.5:
		return "🟢"
	case speedup >= 1.2:
		return "🟡"
	default:
		return "🔴"
	}
}

// benchNoiseFloorMs 退化判定的绝对噪声下限。
// 当基准耗时近零（如内存操作的 fake 模型、子毫秒阶段）时，纯相对百分比
// (now-base)/base 会因计时抖动而 >阈值% 误报退化（或 now 偶尔比假基准更小而漏报）。
// 两层保护（2026-09-15 补齐第二层）：
//  1. base 与 now **双双**落在噪声区间 → 一律判「无退化」；
//  2. **绝对增量**（now-base）落在噪声区间 → 同样判「无退化」。只挡第 1 层是不够的：
//     base 亚毫秒时 now 只要刚过下限（如 0.5 → 1.4ms），相对百分比即被放大成 +180%
//     的假退化，pre-push 与 vitest 并跑时 go/cli 整包必炸（实测）。
//
// 真实退化不受影响：0.001 → 50ms 增量达 49.999ms，远超下限，仍被拦下。
// 下限取 1ms——低于此值的人眼不可察抖动不计入性能回归。
const benchNoiseFloorMs = 1.0

// runSingleBenchSamples text/json 双模式的唯一采集路径：N 次迭代运行并计时，
// perIter 钩子供 text 模式逐迭代打印（json 静默传 nil），杜绝迭代循环双维护。
func runSingleBenchSamples(a AppService, modelPath, filesRoot string, iterations int, perIter func(iter int, stages []singleBenchStage)) ([][]singleBenchStage, time.Duration) {
	var allStages [][]singleBenchStage
	totalStart := time.Now()
	for iter := 0; iter < iterations; iter++ {
		stages := runSingleModelBench(a, modelPath, filesRoot)
		allStages = append(allStages, stages)
		if perIter != nil {
			perIter(iter, stages)
		}
	}
	return allStages, time.Since(totalStart)
}

// singleBenchRuntime 单模型基准的运行归属恒为 Go：全链路调用的都是 Go 实现
// （os.ReadFile / AnalyzeBedrockModel / 校验 / 几何准备 / 纹理准备 / json.Marshal / 缓存查询），
// 没有任何 WASM / Rust / Three 环节——归属如实报 go，不为好看编造分层（ADR-262 D2）。
const singleBenchRuntime = "go"

// singleBenchReadNote ① 阶段的文案：体量 + 实测读取速率。
// ⚠️ 诚实红线：读几百字节时 `time.Since` 常返回 0（时钟粒度），`float64(bytes)/0s` 会打出
// 「+Inf MB/s」——测不出来的速率宁可不报（2026-09-18 由 e2e 真实渲染抓出）。
func singleBenchReadNote(bytes int64, d time.Duration) string {
	size := fsutil.FormatSize(bytes)
	if d <= 0 {
		return fmt.Sprintf("✅ %s", size)
	}
	return fmt.Sprintf("✅ %s, %.0f MB/s", size, float64(bytes)/d.Seconds()/1024/1024)
}

// runSingleModelBench 执行单次单模型测试
func runSingleModelBench(a AppService, modelPath, filesRoot string) []singleBenchStage {
	var stages []singleBenchStage

	// 目录式模型的入参是 <dir>/ysm.json 清单（见 resolveBenchModelTarget）：读的是清单而非模型体量，
	// 阶段名如实标注，避免用户把「读 115 字节」当成「加载整个模型」。
	readStageName := "① 文件读取"
	if registry.IsYsmEntryJSON(filepath.Base(modelPath)) {
		readStageName = "① 清单读取"
	}

	start := time.Now()
	data, err := os.ReadFile(modelPath)
	readDuration := time.Since(start)

	if err != nil {
		return append(stages, singleBenchStage{
			Name:     readStageName,
			Duration: readDuration,
			Notes:    fmt.Sprintf("❌ 失败: %v", err),
			Runtime:  singleBenchRuntime,
			Failed:   true,
		})
	}

	stages = append(stages, singleBenchStage{
		Name:     readStageName,
		Duration: readDuration,
		Bytes:    int64(len(data)),
		Notes:    singleBenchReadNote(int64(len(data)), readDuration),
	})

	start = time.Now()
	model := a.AnalyzeBedrockModel(modelPath)
	analyzeDuration := time.Since(start)

	stages = append(stages, singleBenchStage{
		Name:     parseStageName(modelPath),
		Duration: analyzeDuration,
		Notes:    fmt.Sprintf("✅ %d bones, %d textures (%s)", len(model.Bones), len(model.Textures), detectModelFormat(modelPath)),
	})

	validateStart := time.Now()
	issues, validateMsg := validateModelData(model)
	validateDuration := time.Since(validateStart)

	validateIcon := "✅"
	if issues > 0 {
		validateIcon = "⚠️"
	}
	stages = append(stages, singleBenchStage{
		Name:     "③ 数据验证",
		Duration: validateDuration,
		Notes:    fmt.Sprintf("%s %s", validateIcon, validateMsg),
	})

	geoStart := time.Now()
	geoSize := prepareGeometryData(model)
	geoDuration := time.Since(geoStart)

	stages = append(stages, singleBenchStage{
		Name:     "④ 几何数据准备",
		Duration: geoDuration,
		Bytes:    geoSize,
		Notes:    fmt.Sprintf("✅ %s", fsutil.FormatSize(geoSize)),
	})

	texStart := time.Now()
	texSize := prepareTextureData(model)
	texDuration := time.Since(texStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑤ 纹理数据准备",
		Duration: texDuration,
		Bytes:    texSize,
		Notes:    fmt.Sprintf("✅ %s", fsutil.FormatSize(texSize)),
	})

	ipcStart := time.Now()
	// 实测序列化载荷（原实现按 (几何+纹理)*4/3 估算字节数，并注释"Base64 4/3 膨胀为历史假设"——
	// 但 Base64 早已在 model.Textures 里，膨胀系数是多余假设。能测的不要估：ADR-262 D2）
	ipcData, ipcErr := json.Marshal(model)
	ipcDuration := time.Since(ipcStart)
	ipcSize := int64(len(ipcData))
	ipcNote := fmt.Sprintf("✅ 实测载荷 %s（Wails binding 走 JSON 序列化）", fsutil.FormatSize(ipcSize))
	if ipcErr != nil {
		ipcNote = fmt.Sprintf("❌ 序列化失败: %v", ipcErr)
	}

	stages = append(stages, singleBenchStage{
		Name:     "⑥ 序列化模拟",
		Duration: ipcDuration,
		Bytes:    ipcSize,
		Notes:    ipcNote,
		Failed:   ipcErr != nil,
	})

	cacheStart := time.Now()
	cacheNotes := "🔍 缓存目录不可用"
	if hash, err := texture_cache.TextureHash(modelPath); err == nil {
		if cached, ok, _ := texture_cache.ReadCached(hash); ok && cached != nil {
			cacheNotes = fmt.Sprintf("✅ 缓存命中 (%s, %s)", fsutil.FormatSize(int64(len(cached))), hash[:12]+"...")
		} else {
			cacheStats := texture_cache.GetCacheStats()
			cacheNotes = fmt.Sprintf("⚠️ 缓存未命中（总缓存: %d 个文件, %s）",
				cacheStats.FileCount, fsutil.FormatSize(cacheStats.TotalSize))
		}
	} else {
		cacheStats := texture_cache.GetCacheStats()
		cacheNotes = fmt.Sprintf("⚠️ 哈希计算失败（总缓存: %d 个文件, %s）",
			cacheStats.FileCount, fsutil.FormatSize(cacheStats.TotalSize))
	}
	cacheDuration := time.Since(cacheStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑦ 缓存检查",
		Duration: cacheDuration,
		Notes:    cacheNotes,
	})

	// 归属单一事实：本条链路全部阶段同属 singleBenchRuntime，在出口统一打上，
	// 避免每个阶段字面量各写一次（漏一个就是一个无归属阶段）。
	for i := range stages {
		stages[i].Runtime = singleBenchRuntime
	}
	return stages
}

// printSingleModelStages 打印单模型各阶段耗时
func printSingleModelStages(stages []singleBenchStage) {
	fmt.Println()
	fmt.Println("   📊 各阶段耗时:")
	fmt.Println("   " + strings.Repeat("-", 65))

	var totalMs float64
	for _, s := range stages {
		ms := msOf(s)
		totalMs += ms

		fmt.Printf("   %-20s %10.2fms %s\n", s.Name, ms, " "+stageMark(ms))
		if s.Notes != "" {
			fmt.Printf("   %-20s        %s\n", "", s.Notes)
		}
		if s.Bytes > 0 {
			fmt.Printf("   %-20s        %s\n", "", "数据量: "+fsutil.FormatSize(s.Bytes))
		}
	}

	fmt.Println("   " + strings.Repeat("-", 65))
	fmt.Printf("   %-20s %10.2fms\n", "总计", totalMs)
}

// printAverageStages 打印多次迭代的平均值（直接复用 avgBenchStages 的按名配对结果，
// 不再裸取 stages[i]——不等长迭代（读取失败提前 return）下索引取值会越界 panic）
func printAverageStages(allStages [][]singleBenchStage) {
	avg := avgBenchStages(allStages)

	fmt.Println("   📊 平均耗时（跨迭代）:")
	fmt.Println("   " + strings.Repeat("-", 55))

	var totalAvg float64
	for _, s := range avg {
		ms := msOf(s)
		totalAvg += ms
		fmt.Printf("   %-20s %10.2fms %s\n", s.Name, ms, stageMark(ms))
	}

	fmt.Println("   " + strings.Repeat("-", 55))
	fmt.Printf("   %-20s %10.2fms\n", "总计", totalAvg)
}

// printOptimizationHints 打印优化建议
func printOptimizationHints(stages []singleBenchStage) {
	var maxDuration time.Duration
	var bottleneckIdx int
	for i, s := range stages {
		if s.Duration > maxDuration {
			maxDuration = s.Duration
			bottleneckIdx = i
		}
	}

	fmt.Println()
	fmt.Println("💡 优化建议:")
	fmt.Println(strings.Repeat("-", 70))

	switch stages[bottleneckIdx].Name {
	case "① 文件读取":
		fmt.Println("   🔴 瓶颈: 文件读取")
		fmt.Println("   建议:")
		fmt.Println("   - 使用 SSD 替代 HDD")
		fmt.Println("   - 考虑文件缓存（内存映射）")
		fmt.Println("   - 检查杀毒软件是否在扫描")
	case "② JSON 解析", "② PMX 解析", "② 模型解析":
		fmt.Printf("   🔴 瓶颈: %s\n", stages[bottleneckIdx].Name)
		fmt.Println("   建议:")
		fmt.Println("   - 检查模型文件是否过大（>5MB 需优化）")
		fmt.Println("   - 解析耗时占比高时，评估更快的 JSON/PMX 解析实现（不指定具体第三方库，防带货文案过期）")
		fmt.Println("   - 模型数据是否可以精简")
	case "③ 数据验证":
		fmt.Println("   🟡 注意: 数据验证")
		fmt.Println("   建议:")
		fmt.Println("   - 检查验证逻辑是否过于复杂")
		fmt.Println("   - 部分验证可以延迟执行")
	case "④ 几何数据准备":
		fmt.Println("   🔴 瓶颈: 几何数据准备")
		fmt.Println("   建议:")
		fmt.Println("   - 减少骨骼数量（简化模型）")
		fmt.Println("   - 使用 LOD（Level of Detail）")
		fmt.Println("   - 预处理模型数据，运行时直接加载")
	case "⑤ 纹理数据准备":
		fmt.Println("   🔴 瓶颈: 纹理数据准备")
		fmt.Println("   建议:")
		fmt.Println("   - 使用 KTX2/DDS 压缩纹理（减少 60-70%）")
		fmt.Println("   - 减少大尺寸纹理（>2048x2048）")
		fmt.Println("   - 实现纹理缓存机制")
	case "⑥ 序列化模拟":
		fmt.Println("   🟡 注意: 序列化")
		fmt.Println("   建议:")
		fmt.Println("   - 减少数据传输量（精简模型）")
		fmt.Println("   - 使用更高效的序列化格式（如 msgpack）")
		fmt.Println("   - Wails binding 走 JSON 序列化，减少嵌套结构可提升吞吐")
	case "⑦ 缓存检查":
		fmt.Println("   🟡 注意: 缓存检查")
		fmt.Println("   建议:")
		fmt.Println("   - 缓存命中率低则说明编码失败")
		fmt.Println("   - 定期检查缓存目录状态")
	default:
		fmt.Println("   📊 整体性能可接受")
	}

	fmt.Println()
	fmt.Println("📚 性能优化原则:")
	fmt.Println("   1. 先优化单模型，再考虑多模型并发")
	fmt.Println("   2. 定位瓶颈阶段（耗时最长）")
	fmt.Println("   3. 针对性优化，避免盲目并发")
	fmt.Println("   4. 量化改进：每次优化后重跑 single-bench")
}

// validateModelData 验证模型结构一致性，返回问题数和诊断信息
func validateModelData(model types.BedrockModel) (int, string) {
	var issues int
	var msgs []string

	// 1. 骨骼数与 BoneCount 字段一致性
	if model.BoneCount > 0 && model.BoneCount != len(model.Bones) {
		issues++
		msgs = append(msgs, fmt.Sprintf("骨骼数不一致: 声明 %d vs 实际 %d", model.BoneCount, len(model.Bones)))
	}

	// 2. 立方块数一致性
	var totalCubes int
	for _, b := range model.Bones {
		totalCubes += len(b.Cubes)
	}
	if model.CubeCount > 0 && model.CubeCount != totalCubes {
		issues++
		msgs = append(msgs, fmt.Sprintf("立方块数不一致: 声明 %d vs 实际 %d", model.CubeCount, totalCubes))
	}

	// 3. 纹理数组与名称数组长度一致性
	if len(model.Textures) > 0 && len(model.TextureNames) > 0 && len(model.Textures) != len(model.TextureNames) {
		issues++
		msgs = append(msgs, fmt.Sprintf("纹理名称数(%d) 与纹理数据数(%d) 不匹配", len(model.TextureNames), len(model.Textures)))
	}

	// 4. 孤立纹理（有数据但无名称）
	for i, tex := range model.Textures {
		if tex != "" && i < len(model.TextureNames) && model.TextureNames[i] == "" {
			issues++
			msgs = append(msgs, fmt.Sprintf("纹理[%d] 有数据但无名称", i))
		}
	}

	// 5. 骨骼父子关系检查（根骨骼数量）
	var rootCount int
	for _, b := range model.Bones {
		if b.Parent == "" {
			rootCount++
		}
	}
	if len(model.Bones) > 0 && rootCount == 0 {
		issues++
		msgs = append(msgs, "无根骨骼（所有骨骼都有 parent）")
	}

	if issues == 0 {
		return 0, fmt.Sprintf("✅ 结构校验通过: %d 骨骼, %d 立方块, %d 纹理",
			len(model.Bones), totalCubes, len(model.Textures))
	}
	return issues, "⚠️ 校验发现问题: " + strings.Join(msgs, "; ")
}

// prepareGeometryData 计算几何数据实际估算大小
func prepareGeometryData(model types.BedrockModel) int64 {
	var size int64

	// 骨骼元数据: name + parent + pivot[3] + rotation[3] ≈ 96 字节/骨骼
	size += int64(len(model.Bones)) * 96

	// 立方块数据: origin[3] + size[3] + pivot[3] + uv[2] + rotation[3] + inflate + mirror + texSlot ≈ 96 字节/块
	var totalCubes int
	for _, b := range model.Bones {
		totalCubes += len(b.Cubes)
	}
	size += int64(totalCubes) * 96

	// 动画数据: JSON 字符串原始长度
	for _, anim := range model.Animations {
		size += int64(len(anim))
	}

	return size
}

// prepareTextureData 估算纹理数据大小（base64 解码后）
func prepareTextureData(model types.BedrockModel) int64 {
	var size int64

	if model.Texture != "" {
		size += int64(len(model.Texture)) * 3 / 4
	}
	for _, tex := range model.Textures {
		if tex != "" {
			size += int64(len(tex)) * 3 / 4
		}
	}

	return size
}
