package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/app"
)

func init() {
	RegisterCommandC("concurrent-bench", CatPerf, "并发能力基准测试（串行 vs 并行对比，建议先优化单模型）", runConcurrentBench)
	RegisterCommandC("single-bench", CatPerf, "单模型加载基准测试（优化基础，单模型快=所有场景快）", runSingleBench)
}

// concurrentBenchResult 并发测试结果
type concurrentBenchResult struct {
	Name        string
	Duration    time.Duration
	WorkerCount int
	Speedup     float64
}

// runConcurrentBench 运行并发基准测试
func runConcurrentBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("concurrent-bench")
	workers := fs.Int("workers", 4, "并发 worker 数量")
	maxModels := fs.Int("max-models", 20, "最多测试的模型数量")
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

	fmt.Println("⚡ 并发能力基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   Worker 数量: %d\n", *workers)
	fmt.Printf("   最大模型数:   %d\n", *maxModels)
	fmt.Println(strings.Repeat("=", 70))

	// 1. 扫描模型
	fmt.Println("\n📊 Phase 0: 准备测试数据...")
	entries := ctx.App.ScanModelEntries(ctx.FilesRoot)
	if len(entries) == 0 {
		return newRuntimeErrf("未找到任何模型")
	}

	// 过滤 YSM 模型
	var ysmModels []string
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Path))
		if ext == ".ysm" {
			ysmModels = append(ysmModels, e.Path)
		}
	}

	if len(ysmModels) == 0 {
		for _, e := range entries {
			ysmModels = append(ysmModels, e.Path)
			if len(ysmModels) >= *maxModels {
				break
			}
		}
	} else if len(ysmModels) > *maxModels {
		ysmModels = ysmModels[:*maxModels]
	}

	fmt.Printf("   测试模型数: %d\n", len(ysmModels))
	fmt.Println()

	// 2. 串行测试
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 1: 串行模型分析")
	fmt.Println(strings.Repeat("-", 70))

	serialResult := benchSerialAnalyze(ctx.App, ysmModels)
	fmt.Printf("   串行耗时: %.2fms\n", float64(serialResult.Duration.Microseconds())/1000)
	fmt.Printf("   平均/模型: %.2fms\n", float64(serialResult.Duration.Microseconds())/1000/float64(len(ysmModels)))

	// 3. 并行测试
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 2: 并行模型分析")
	fmt.Println(strings.Repeat("-", 70))

	var parallelResults []concurrentBenchResult
	workerCounts := []int{2, 4, *workers}
	if *workers < 4 {
		workerCounts = []int{2, *workers}
	}

	for _, wc := range workerCounts {
		result := benchParallelAnalyze(ctx.App, ysmModels, wc)
		if result.Duration > 0 {
			result.Speedup = float64(serialResult.Duration) / float64(result.Duration)
		}
		parallelResults = append(parallelResults, result)

		speedupStr := fmt.Sprintf("%.1fx", result.Speedup)
		speedupStr = speedEmoji(result.Speedup) + " " + speedupStr

		fmt.Printf("   Workers=%d: %.2fms (加速比: %s)\n",
			result.WorkerCount,
			float64(result.Duration.Microseconds())/1000,
			speedupStr)
	}

	// 4. 文件读取并发测试
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 Phase 3: 并发文件读取")
	fmt.Println(strings.Repeat("-", 70))

	collectFiles := collectTestFiles(ctx.FilesRoot, 50)
	if len(collectFiles) > 0 {
		fileResult := benchParallelRead(collectFiles, *workers)
		serialFileResult := benchSerialRead(collectFiles)

		fmt.Printf("   文件数: %d\n", len(collectFiles))
		fmt.Printf("   串行: %.2fms\n", float64(serialFileResult.Microseconds())/1000)
		fmt.Printf("   并行(%d workers): %.2fms\n", *workers, float64(fileResult.Microseconds())/1000)
		fmt.Printf("   加速比: %.1fx\n", float64(serialFileResult)/float64(fileResult))
	}

	// 5. 汇总报告
	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Println("📊 汇总报告")
	fmt.Println(strings.Repeat("-", 70))

	printConcurrentReport(serialResult, parallelResults)

	return nil
}

// benchSerialAnalyze 串行分析模型
func benchSerialAnalyze(a *app.App, models []string) concurrentBenchResult {
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
func benchParallelAnalyze(a *app.App, models []string, workers int) concurrentBenchResult {
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
		_, _ = os.ReadFile(f)
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
				_, _ = os.ReadFile(f)
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

// printConcurrentReport 打印并发测试报告
func printConcurrentReport(serial concurrentBenchResult, parallel []concurrentBenchResult) {
	fmt.Println()
	fmt.Println("📈 性能对比表:")
	fmt.Printf("   %-20s %-15s %-12s %s\n", "方案", "耗时", "加速比", "状态")
	fmt.Println("   " + strings.Repeat("-", 60))
	fmt.Printf("   %-20s %-15s %-12s %s\n",
		"串行",
		fmt.Sprintf("%.2fms", float64(serial.Duration.Microseconds())/1000),
		"1.00x",
		"🟢 基准")

	for _, p := range parallel {
		var label string
		switch {
		case p.Speedup >= 2.0:
			label = "优秀"
		case p.Speedup >= 1.5:
			label = "良好"
		case p.Speedup >= 1.2:
			label = "一般"
		default:
			label = "无提升"
		}
		status := speedEmoji(p.Speedup) + " " + label

		fmt.Printf("   %-20s %-15s %-12s %s\n",
			fmt.Sprintf("并行(%d workers)", p.WorkerCount),
			fmt.Sprintf("%.2fms", float64(p.Duration.Microseconds())/1000),
			fmt.Sprintf("%.2fx", p.Speedup),
			status)
	}

	fmt.Println()
	fmt.Println("💡 并发建议:")
	if len(parallel) == 0 {
		fmt.Println("   ⚠️ 无并行测试结果，无法给出建议")
		return
	}
	best := parallel[0]
	for _, p := range parallel {
		if p.Speedup > best.Speedup {
			best = p
		}
	}

	if best.Speedup >= 1.5 {
		fmt.Printf("   ✅ 推荐使用 %d workers，可获得 %.1fx 加速\n", best.WorkerCount, best.Speedup)
		fmt.Println("   💡 适合场景: 批量模型分析、并行文件处理")
	} else if best.Speedup >= 1.2 {
		fmt.Printf("   ⚠️  并发提升有限（%.1fx），当前 I/O 可能是瓶颈\n", best.Speedup)
		fmt.Println("   💡 建议: 检查磁盘 I/O，可能需要 SSD")
	} else {
		fmt.Println("   🔴 并发无明显提升")
		fmt.Println("   💡 原因: 单线程已能跑满，或 I/O 成为瓶颈")
	}
}

// singleBenchStage 单模型测试阶段
type singleBenchStage struct {
	Name     string
	Duration time.Duration
	Bytes    int64
	Notes    string
}

// runSingleBench 单模型加载基准测试
func runSingleBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("single-bench")
	modelPath := fs.String("model", "", "指定模型路径（必填）")
	iterations := fs.Int("iterations", 3, "重复测试次数")
	baseline := fs.String("baseline", "", "对比基准 JSON 文件（[{name,ms}]），任一阶段退化超 --threshold 时返回失败")
	saveBaseline := fs.String("save-baseline", "", "把本次各阶段平均耗时写入该 JSON 文件（供后续 --baseline 对比）")
	thresholdPct := fs.Float64("threshold", 50, "退化阈值百分比（默认 50），配合 --baseline 使用")
	format := fs.String("format", "text", "输出格式: text（人类可读）/ json（AI 友好）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *modelPath == "" {
		return newParamErrf("必须指定 --model 参数")
	}
	if *iterations <= 0 {
		return newParamErrf("--iterations 必须大于 0")
	}
	if *format != "text" && *format != "json" {
		return newParamErrf("--format 必须是 text 或 json")
	}

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
	Model      string           `json:"model"`
	Iterations int              `json:"iterations"`
	TotalMs    float64          `json:"total_ms"`
	Stages     []benchStageJSON `json:"stages"`
	Bottleneck string           `json:"bottleneck"`
	Hints      []string         `json:"hints"`
	Format     string           `json:"format"`
	SizeBytes  int64            `json:"size_bytes"`
}

// benchStageJSON 单个阶段 JSON 结构
type benchStageJSON struct {
	Name       string  `json:"name"`
	Ms         float64 `json:"ms"`
	Bytes      int64   `json:"bytes,omitempty"`
	Status     string  `json:"status"`
	Bottleneck bool    `json:"bottleneck"`
	Note       string  `json:"note,omitempty"`
}

// stagesToJSON 将平均阶段列表转换为 JSON 结构，同时识别瓶颈
func stagesToJSON(avg []singleBenchStage) ([]benchStageJSON, string) {
	var stageJSON []benchStageJSON
	var bottleneckName string
	var maxMs float64
	for _, s := range avg {
		ms := msOf(s)
		status := stageStatus(ms)
		isBottleneck := ms > maxMs
		if isBottleneck {
			maxMs = ms
			bottleneckName = s.Name
		}
		stageJSON = append(stageJSON, benchStageJSON{
			Name:       s.Name,
			Ms:         ms,
			Bytes:      s.Bytes,
			Status:     status,
			Bottleneck: isBottleneck && ms > 10,
			Note:       s.Notes,
		})
	}
	return stageJSON, bottleneckName
}

// runSingleBenchJSON 单模型基准测试 JSON 模式：静默运行，输出结构化数据
func runSingleBenchJSON(ctx *CmdContext, modelPath string, iterations int, baseline, saveBaseline string, thresholdPct float64) error {
	var modelSize int64
	if info, err := os.Stat(modelPath); err == nil {
		modelSize = info.Size()
	}

	allStages, totalDuration := runSingleBenchSamples(ctx.App, modelPath, ctx.FilesRoot, iterations, nil)
	avg := avgBenchStages(allStages)

	// 检测模型格式
	modelFormat := detectModelFormat(modelPath)

	stageJSON, bottleneckName := stagesToJSON(avg)

	hints := generateHints(avg)

	output := singleBenchJSON{
		Model:      modelPath,
		Iterations: iterations,
		TotalMs:    float64(totalDuration.Microseconds()) / 1000,
		Stages:     stageJSON,
		Bottleneck: bottleneckName,
		Hints:      hints,
		Format:     modelFormat,
		SizeBytes:  modelSize,
	}

	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	fmt.Println(string(data))

	// 基准对比 / 保存
	return applyBenchBaseline(baseline, saveBaseline, thresholdPct, avg)
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
	for _, stages := range allStages {
		for _, s := range stages {
			if counts[s.Name] == 0 {
				order = append(order, s.Name)
			}
			totals[s.Name] += s.Duration
			counts[s.Name]++
		}
	}
	out := make([]singleBenchStage, 0, len(order))
	for _, name := range order {
		out = append(out, singleBenchStage{
			Name:     name,
			Duration: totals[name] / time.Duration(counts[name]),
		})
	}
	return out
}

// msOf 阶段耗时转毫秒
func msOf(s singleBenchStage) float64 {
	return float64(s.Duration.Microseconds()) / 1000
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

// compareSingleBenchBaseline 与基准 JSON 对比：任一阶段退化超 thresholdPct % 返回错误（供 CI 判定）
func compareSingleBenchBaseline(baselinePath string, stages []singleBenchStage, thresholdPct float64) error {
	data, err := os.ReadFile(baselinePath)
	if err != nil {
		return newRuntimeErrf("无法读取基准文件 %s: %v", baselinePath, err)
	}
	var base []benchStageMs
	if err := json.Unmarshal(data, &base); err != nil {
		fmt.Printf("❌ 基准文件格式错误: %s\n%s\n", baselinePath, err)
		return newRuntimeErrf("基准文件格式错误: %v", err)
	}
	baseMap := map[string]float64{}
	for _, b := range base {
		baseMap[b.Name] = b.Ms
	}

	fmt.Println("\n📉 与基准对比（threshold " + fmt.Sprintf("%.0f%%", thresholdPct) + "）:")
	fmt.Println("   " + strings.Repeat("-", 62))

	var degraded int
	for _, s := range stages {
		now := msOf(s)
		baseMs, ok := baseMap[s.Name]
		if !ok {
			fmt.Printf("   🆕 %-16s %8.2fms（无基准，跳过）\n", s.Name, now)
			continue
		}
		ratio := 0.0
		if baseMs > 0 {
			ratio = (now - baseMs) / baseMs * 100
		}
		mark := "✅"
		switch {
		case ratio > thresholdPct:
			mark = "🔴 退化"
			degraded++
		case ratio > 0:
			mark = "🟡"
		case ratio < 0:
			mark = "🟢 更快"
		}
		fmt.Printf("   %s %-16s %8.2f → %8.2fms (%+6.1f%%)\n", mark, s.Name, baseMs, now, ratio)
	}

	if degraded > 0 {
		return newRuntimeErrf("%d 个阶段相对基准退化超过 %.0f%%", degraded, thresholdPct)
	}
	fmt.Println("   ✅ 无阶段退化超过阈值")
	return nil
}

// saveBenchBaseline 把本次平均耗时保存为基准 JSON（[-name,ms]）
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
	fmt.Printf("\n💾 基准已保存到: %s\n", path)
	return nil
}

// runSingleBenchSamples text/json 双模式的唯一采集路径：N 次迭代运行并计时，
// perIter 钩子供 text 模式逐迭代打印（json 静默传 nil），杜绝迭代循环双维护。
func runSingleBenchSamples(a *app.App, modelPath, filesRoot string, iterations int, perIter func(iter int, stages []singleBenchStage)) ([][]singleBenchStage, time.Duration) {
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

// applyBenchBaseline 基准对比/保存后处理（CI 性能退化门禁语义，text/json 共享）。
func applyBenchBaseline(baseline, saveBaseline string, thresholdPct float64, avg []singleBenchStage) error {
	if baseline != "" {
		if err := compareSingleBenchBaseline(baseline, avg, thresholdPct); err != nil {
			return err
		}
	}
	if saveBaseline != "" {
		if err := saveBenchBaseline(saveBaseline, avg); err != nil {
			return err
		}
	}
	return nil
}

// runSingleModelBench 执行单次单模型测试
func runSingleModelBench(a *app.App, modelPath, filesRoot string) []singleBenchStage {
	var stages []singleBenchStage

	start := time.Now()
	data, err := os.ReadFile(modelPath)
	readDuration := time.Since(start)

	if err != nil {
		return append(stages, singleBenchStage{
			Name:     "① 文件读取",
			Duration: readDuration,
			Notes:    fmt.Sprintf("❌ 失败: %v", err),
		})
	}

	stages = append(stages, singleBenchStage{
		Name:     "① 文件读取",
		Duration: readDuration,
		Bytes:    int64(len(data)),
		Notes:    fmt.Sprintf("✅ %s, %.0f MB/s", formatSize(int64(len(data))), float64(len(data))/readDuration.Seconds()/1024/1024),
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
		Notes:    fmt.Sprintf("✅ %s", formatSize(geoSize)),
	})

	texStart := time.Now()
	texSize := prepareTextureData(model)
	texDuration := time.Since(texStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑤ 纹理数据准备",
		Duration: texDuration,
		Bytes:    texSize,
		Notes:    fmt.Sprintf("✅ %s", formatSize(texSize)),
	})

	ipcStart := time.Now()
	ipcSize := (geoSize + texSize) * 4 / 3
	_, _ = json.Marshal(model) // 模拟序列化开销
	ipcDuration := time.Since(ipcStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑥ 序列化模拟",
		Duration: ipcDuration,
		Bytes:    ipcSize,
		Notes:    fmt.Sprintf("📦 估算 %s（Wails binding 走 JSON 序列化；Base64 4/3 膨胀为历史假设，仅量级参考）", formatSize(ipcSize)),
	})

	cacheStart := time.Now()
	cacheNotes := "🔍 缓存目录不可用"
	if hash, err := texture_cache.TextureHash(modelPath); err == nil {
		if cached, ok, _ := texture_cache.ReadCached(hash); ok && cached != nil {
			cacheNotes = fmt.Sprintf("✅ 缓存命中 (%s, %s)", formatSize(int64(len(cached))), hash[:12]+"...")
		} else {
			cacheStats := texture_cache.GetCacheStats()
			cacheNotes = fmt.Sprintf("⚠️ 缓存未命中（总缓存: %d 个文件, %s）",
				cacheStats.FileCount, formatSize(cacheStats.TotalSize))
		}
	} else {
		cacheStats := texture_cache.GetCacheStats()
		cacheNotes = fmt.Sprintf("⚠️ 哈希计算失败（总缓存: %d 个文件, %s）",
			cacheStats.FileCount, formatSize(cacheStats.TotalSize))
	}
	cacheDuration := time.Since(cacheStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑦ 缓存检查",
		Duration: cacheDuration,
		Notes:    cacheNotes,
	})

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
			fmt.Printf("   %-20s        %s\n", "", "数据量: "+formatSize(s.Bytes))
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
		fmt.Println("   - 考虑使用更快的解析器（YSM/JSON 用 sonic；PMX 考虑预解析缓存）")
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
