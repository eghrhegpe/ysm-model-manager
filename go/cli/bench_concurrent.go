// bench_concurrent.go：并发/单模型基准测试 harness（原 concurrent.go，2026-09-06 锐评正名）。
// 文件内容全部是 benchmark 工具命令（concurrent-bench / single-bench），非生产并发代码；
// 生产并发收敛在 go/conc（ADR-197）。与生产 AppService（appservice.go）同包仅因共用
// CLI 基建（RegisterCommandC / newCmdFlagSet / newParamErrf 等），依赖纠缠暂不拆包。
package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// perfTargetParamSpecs 是 registerPerfTargetFlags 所对应五参的 ParamSpec 声明
// （target / order / rtype / model / max-models，与 flag 定义序一致）。
// concurrent-bench 与 single-bench 在同一位置共用这一段——登记处经 perfSpecs()
// 拼接，避免两处逐行重复（jscpd-go 门禁：原为文件内自重复对）。
var perfTargetParamSpecs = []ParamSpec{
	{Key: "target", Type: ParamString},
	{Key: "order", Type: ParamString},
	{Key: "rtype", Type: ParamString},
	{Key: "model", Type: ParamString},
	{Key: "max-models", Type: ParamNumber},
}

// perfSpecs 拼接登记参数序列：prefix + 共享 perfTargetParamSpecs + suffix。
// 各命令只在 prefix/suffix 表达自己独有的参数，共享段单一事实源。
func perfSpecs(prefix []ParamSpec, suffix ...ParamSpec) []ParamSpec {
	out := make([]ParamSpec, 0, len(prefix)+len(perfTargetParamSpecs)+len(suffix))
	out = append(out, prefix...)
	out = append(out, perfTargetParamSpecs...)
	out = append(out, suffix...)
	return out
}

func init() {
	RegisterCommandC("concurrent-bench", CatPerf, "并发能力基准测试（串行 vs 并行对比，建议先优化单模型）", runConcurrentBench,
		// ADR-173：登记后桥才走 ParamSpec 通道；此前无 spec → 走 legacy 告警路径。
		// 与 flag 定义序一致（workers → registerPerfTargetFlags 的五参 → format）。
		perfSpecs(
			[]ParamSpec{{Key: "workers", Type: ParamNumber}},
			ParamSpec{Key: "format", Type: ParamString},
		)...,
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
	// 默认 target=repo、上限 20：本命令的既有行为是「全库扁平取前 20 个 CLI 可分析模型」，
	// 三旋钮只是把它显式化（同名同义），默认目标集逐字不变。
	target, order, rtype, modelPath, maxModels := registerPerfTargetFlags(fs, perfTargetRepo, 20,
		"目标集上限（单位 = --target 的展开单位）：rtype=该类型取几条 / all=每类型各取几条 / repo=全库扁平取几条")
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
	// 目标集三旋钮一次解析：旧面的 `max-models 必须 >= 1` 裸守卫并到这里，文案按
	// 「单位 = --target 的展开单位」重写——同一个数字在四种 selector 下是四种含义。
	spec, err := parsePerfTargetSpec(fs, *target, *order, *rtype, *modelPath, *maxModels, 0)
	if err != nil {
		return err
	}
	if *format != "text" && *format != "json" {
		return newParamErrf("--format 必须是 text 或 json")
	}

	// 目标集（含空集报错）在两条线之前算好：JSON 模式不打印任何进度，故不能把选样本埋进打印流程
	benchModels, err := pickConcurrentBenchModels(ctx, spec)
	if err != nil {
		return err
	}
	if *format == "json" {
		return runConcurrentBenchJSON(ctx, benchModels, *workers, spec)
	}

	fmt.Println("⚡ 并发能力基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   Worker 数量: %d\n", *workers)
	// 「最大模型数」= 本次目标集的上限。target=model 的上限已在 parse 阶段归一化为 0，
	// 此处回显 1（该目标集的真实规模）——回显 0 会被读成「取 0 条」。
	capShown := spec.MaxModels
	if capShown == 0 {
		capShown = 1
	}
	fmt.Printf("   最大模型数:   %d\n", capShown)
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
//
// ADR-262 D3 修订：目标集改为三旋钮声明的 `spec`，候选池收敛到 `collectPerfTargets`
// （唯一枚举入口，与 single-bench 同一份）。`--max-models` 的单位随 `--target` 变：
// repo=全库扁平 N 条、rtype=该类型 N 条、all=**每类型各** N 条、model=单条
// （单条的上限由 parsePerfTargetSpec 拒绝显式传入，不在选样本处静默吞掉）。
func pickConcurrentBenchModels(ctx *CmdContext, spec perfTargetSpec) ([]string, error) {
	ts, _ := collectPerfTargets(ctx.FilesRoot)
	if len(ts) == 0 {
		return nil, newRuntimeErrf("未找到任何模型")
	}
	// 能力过滤留在收窄**之前**：它回答「仓库里有没有可跑的样本」，与「这次挑哪几条」是两件事。
	ts = filterAnalyzable(ts)
	if len(ts) == 0 {
		return nil, newRuntimeErrf("未找到 CLI 可分析的模型（仅 .ysm 及其容器/解包目录形态在 CLI 分析链路上）")
	}

	switch spec.Target {
	case perfTargetModel:
		// 目录式模型折叠为 <dir>/ysm.json（与 single-bench 同一出口）：下游零目录分支
		target, err := resolveTargetModel(ctx.App, spec.ModelPath, ctx.FilesRoot)
		if err != nil {
			return nil, err
		}
		one := make([]perfTarget, 0, 1)
		for _, t := range ts {
			if t.Path == target {
				one = append(one, t)
				break
			}
		}
		if len(one) == 0 {
			return nil, newRuntimeErrf("--target model 指定的模型不在仓库扫描结果内或不属于 CLI 可分析类型：%s", target)
		}
		ts = one
	case perfTargetRtype:
		ts = filterRtype(ts, spec.Rtype)
		if len(ts) == 0 {
			return nil, newRuntimeErrf("仓库中未找到 rtype=%s 的 CLI 可分析模型", spec.Rtype)
		}
	}

	if spec.Target == perfTargetAll {
		// all = **每类型各** N 条：排序必须在分组**之前**（组内才有顺序），截断在分组内完成——
		// 展平后不得再 capFlat，否则「每类型各 N 条」会退化成「全库 N 条」（两种语义不能共用一次截断）。
		return pathsOf(flattenPerfGroups(groupPerfTargets(orderPerfTargets(ts, spec.Order), spec.MaxModels))), nil
	}
	return pathsOf(capFlat(orderPerfTargets(ts, spec.Order), spec.MaxModels)), nil
}

// flattenPerfGroups 把按类型归并的取样展平为「类型字典序、组内已排序」的清单（target=all 用）。
// 组内顺序由调用方在分组前排好；此处只搬运（连体量一起搬，供需要回显排名依据的消费方）。
func flattenPerfGroups(groups []perfTypeGroup) []perfTarget {
	out := make([]perfTarget, 0)
	for _, g := range groups {
		for _, p := range g.Targets {
			out = append(out, perfTarget{Path: p, Rtype: g.Rtype, Footprint: g.Footprints[p]})
		}
	}
	return out
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

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
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
