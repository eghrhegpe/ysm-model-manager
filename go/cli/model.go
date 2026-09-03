package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

func init() {
	RegisterCommandC("search", CatModel, "搜索模型（支持关键词过滤）", runSearch,
		ParamSpec{Key: "keyword", Type: ParamString},
		ParamSpec{Key: "min-bones", Type: ParamNumber},
		ParamSpec{Key: "max-bones", Type: ParamNumber},
		ParamSpec{Key: "min-cubes", Type: ParamNumber},
		ParamSpec{Key: "max-cubes", Type: ParamNumber},
		ParamSpec{Key: "min-tex", Type: ParamNumber},
		ParamSpec{Key: "max-tex", Type: ParamNumber},
		ParamSpec{Key: "format", Type: ParamString},
	)
	RegisterCommandC("analyze", CatModel, "分析单个模型的详细信息", runAnalyze,
		ParamSpec{Key: "model", Type: ParamString},
	)
	RegisterCommandC("list", CatModel, "列出所有模型的摘要信息", runList,
		ParamSpec{Key: "limit", Type: ParamNumber},
		ParamSpec{Key: "format", Type: ParamString},
	)
	RegisterCommandC("verify", CatModel, "验证模型文件完整性", runVerify)
	RegisterCommandC("benchmark", CatModel, "性能基准测试", runBenchmark)
	RegisterCommandC("export", CatModel, "导出模型结构信息", runExport)
}

// runSearch 执行搜索命令
func runSearch(ctx *CmdContext) error {
	fs := newCmdFlagSet("search")
	keyword := fs.String("keyword", "", "搜索关键词")
	minBones := fs.Int("min-bones", 0, "最小骨骼数")
	maxBones := fs.Int("max-bones", 0, "最大骨骼数")
	minCubes := fs.Int("min-cubes", 0, "最小立方块数")
	maxCubes := fs.Int("max-cubes", 0, "最大立方块数")
	minTex := fs.Int("min-tex", 0, "最小贴图尺寸")
	maxTex := fs.Int("max-tex", 0, "最大贴图尺寸")
	outputFormat := fs.String("format", "json", "输出格式: json 或 table")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	results := ctx.App.SearchModels(ctx.FilesRoot, *keyword, *minBones, *maxBones, *minCubes, *maxCubes, *minTex, *maxTex)

	if len(results) == 0 {
		fmt.Println("📭 未找到匹配的模型")
		return nil
	}

	if *outputFormat == "table" {
		printSearchTable(results)
	} else {
		data, err := json.MarshalIndent(results, "", "  ")
		if err != nil {
			return newRuntimeErrf("JSON 序列化失败: %v", err)
		}
		fmt.Printf("✅ 找到 %d 个模型:\n", len(results))
		fmt.Println(string(data))
	}

	return nil
}

// printSearchTable 以表格格式输出搜索结果
func printSearchTable(results []types.SearchResult) {
	fmt.Printf("✅ 找到 %d 个模型:\n\n", len(results))
	fmt.Printf("%-40s %-10s %-10s %-10s\n", "名称", "骨骼", "立方块", "贴图")
	fmt.Println(strings.Repeat("-", 72))
	for _, r := range results {
		name := r.Name
		if len(name) > 38 {
			name = name[:35] + "..."
		}
		fmt.Printf("%-40s %-10d %-10d %dx%d\n", name, r.BoneCount, r.CubeCount, r.TexWidth, r.TexHeight)
	}
}

// runAnalyze 执行分析命令
func runAnalyze(ctx *CmdContext) error {
	fs := newCmdFlagSet("analyze")
	modelPath := fs.String("model", "", "模型文件或目录路径")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *modelPath == "" {
		return newParamErrf("--model 参数不能为空")
	}

	model := ctx.App.AnalyzeBedrockModel(*modelPath)
	if model.BoneCount == 0 {
		meta := ctx.App.AnalyzeYSMModel(*modelPath)
		printYSMAnalysis(meta)
	} else {
		printBedrockAnalysis(model)
	}

	structure := ctx.App.ExportModelStructureJSON(*modelPath)
	if structure != "" {
		fmt.Println("\n📊 模型结构预览:")
		previewLen := min(500, len(structure))
		fmt.Println(structure[:previewLen])
		if len(structure) > previewLen {
			fmt.Printf("... (省略 %d 字节)\n", len(structure)-previewLen)
		}
	}

	return nil
}

// printBedrockAnalysis 打印 Bedrock 模型分析结果
func printBedrockAnalysis(model types.BedrockModel) {
	fmt.Println("📋 模型分析结果:")
	fmt.Println(strings.Repeat("-", 50))
	fmt.Printf("  骨骼数量:    %d\n", model.BoneCount)
	fmt.Printf("  立方块数量:  %d\n", model.CubeCount)
	fmt.Printf("  贴图尺寸:    %d x %d\n", model.TexWidth, model.TexHeight)
	fmt.Printf("  格式版本:    %s\n", model.Format)

	if len(model.Bones) > 0 {
		fmt.Println("\n🦴 骨骼列表:")
		for i, bone := range model.Bones {
			if i >= 10 {
				fmt.Printf("  ... 还有 %d 个骨骼\n", len(model.Bones)-10)
				break
			}
			fmt.Printf("    [%d] %s (父: %s, 立方块: %d)\n",
				i, bone.Name, bone.Parent, len(bone.Cubes))
		}
	}
}

// printYSMAnalysis 打印 YSM 模型分析结果
func printYSMAnalysis(meta interface{}) {
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		fmt.Printf("❌ YSM 模型分析结果序列化失败: %v\n", err)
		return
	}
	fmt.Println("📋 YSM 模型分析结果:")
	fmt.Println(strings.Repeat("-", 50))
	fmt.Println(string(data))
}

// runList 执行列表命令
func runList(ctx *CmdContext) error {
	fs := newCmdFlagSet("list")
	limit := fs.Int("limit", 0, "显示条目数上限 (0=全部)")
	outputFormat := fs.String("format", "table", "输出格式: json 或 table")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	entries := ctx.App.ScanModelEntries(ctx.FilesRoot)

	if len(entries) == 0 {
		fmt.Println("📭 仓库为空")
		return nil
	}

	if *outputFormat == "json" {
		data, err := json.MarshalIndent(entries, "", "  ")
		if err != nil {
			return newRuntimeErrf("JSON 序列化失败: %v", err)
		}
		fmt.Println(string(data))
		return nil
	}

	count := len(entries)
	if *limit > 0 && *limit < count {
		count = *limit
	}

	fmt.Printf("📚 共发现 %d 个模型:\n\n", len(entries))
	fmt.Printf("%-5s %-40s %-12s %-10s %s\n", "#", "名称", "扩展名", "大小", "修改时间")
	fmt.Println(strings.Repeat("-", 90))

	for i := 0; i < count; i++ {
		e := entries[i]
		name := e.Name
		if len(name) > 38 {
			name = name[:35] + "..."
		}
		size := formatSize(e.Size)
		modTime := time.UnixMilli(e.ModTime).Format("2006-01-02 15:04")
		fmt.Printf("%-5d %-40s %-12s %-10s %s\n", i+1, name, e.Ext, size, modTime)
	}

	if *limit > 0 && *limit < len(entries) {
		fmt.Printf("\n... 还有 %d 个模型未显示\n", len(entries)-*limit)
	}

	fmt.Printf("\n📊 统计:\n")
	fmt.Printf("   模型总数: %d\n", len(entries))
	if len(entries) > 0 {
		totalSize := int64(0)
		for _, e := range entries {
			totalSize += e.Size
		}
		fmt.Printf("   总大小:   %s\n", formatSize(totalSize))
	}

	return nil
}

// runVerify 执行验证命令
func runVerify(ctx *CmdContext) error {
	fs := newCmdFlagSet("verify")
	repair := fs.Bool("repair", false, "尝试自动修复问题")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	entries := ctx.App.ScanModelEntries(ctx.FilesRoot)

	fmt.Println("🔍 开始验证模型完整性...")
	fmt.Println()

	var (
		validCount   int
		errorCount   int
		warningCount int
		errors       []string
		warnings     []string
	)

	for _, entry := range entries {
		model := ctx.App.AnalyzeBedrockModel(entry.Path)
		hasError := false
		hasWarning := false

		if model.BoneCount == 0 {
			errors = append(errors, fmt.Sprintf("❌ %s: 骨骼数为 0 (可能不是有效的几何模型)", entry.Name))
			hasError = true
		}

		if model.CubeCount == 0 && model.BoneCount > 0 {
			warnings = append(warnings, fmt.Sprintf("⚠️ %s: 有 %d 个骨骼但没有立方块", entry.Name, model.BoneCount))
			hasWarning = true
		}

		if model.TexWidth == 0 || model.TexHeight == 0 {
			warnings = append(warnings, fmt.Sprintf("⚠️ %s: 贴图尺寸为 0", entry.Name))
			hasWarning = true
		}

		if model.TexWidth > 0 && model.TexHeight > 0 {
			if !isPowerOf2(model.TexWidth) || !isPowerOf2(model.TexHeight) {
				warnings = append(warnings, fmt.Sprintf("⚠️ %s: 贴图尺寸 %dx%d 不是 2 的幂", entry.Name, model.TexWidth, model.TexHeight))
				hasWarning = true
			}
		}

		if hasError {
			errorCount++
		} else if hasWarning {
			warningCount++
		} else {
			validCount++
		}
	}

	fmt.Printf("📊 验证结果:\n")
	fmt.Printf("   ✅ 有效:    %d\n", validCount)
	fmt.Printf("   ⚠️ 警告:    %d\n", warningCount)
	fmt.Printf("   ❌ 错误:    %d\n", errorCount)

	if len(warnings) > 0 {
		fmt.Printf("\n⚠️ 警告详情:\n")
		for _, w := range warnings {
			fmt.Printf("   %s\n", w)
		}
	}

	if len(errors) > 0 {
		fmt.Printf("\n❌ 错误详情:\n")
		for _, e := range errors {
			fmt.Printf("   %s\n", e)
		}

		if *repair {
			fmt.Println("\n🔧 修复模式暂未实现，请手动处理上述错误")
		}
	}

	return nil
}

// runBenchmark 执行性能基准测试
func runBenchmark(ctx *CmdContext) error {
	fs := newCmdFlagSet("benchmark")
	iterations := fs.Int("iterations", 3, "迭代次数")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *iterations <= 0 {
		return newParamErrf("--iterations 必须大于 0")
	}

	fmt.Printf("⚡ 性能基准测试\n")
	fmt.Printf("   迭代次数: %d\n\n", *iterations)

	fmt.Println("📊 Benchmark 1: 模型扫描")
	scanTimes := make([]time.Duration, *iterations)
	for i := 0; i < *iterations; i++ {
		start := time.Now()
		entries := ctx.App.ScanModelEntries(ctx.FilesRoot)
		scanTimes[i] = time.Since(start)
		fmt.Printf("   迭代 %d: %v (发现 %d 个模型)\n", i+1, scanTimes[i], len(entries))
	}
	printBenchmarkResults("扫描", scanTimes)

	fmt.Println("\n📊 Benchmark 2: 模型搜索 (全量)")
	searchTimes := make([]time.Duration, *iterations)
	for i := 0; i < *iterations; i++ {
		start := time.Now()
		results := ctx.App.SearchModels(ctx.FilesRoot, "", 0, 0, 0, 0, 0, 0)
		searchTimes[i] = time.Since(start)
		fmt.Printf("   迭代 %d: %v (找到 %d 个结果)\n", i+1, searchTimes[i], len(results))
	}
	printBenchmarkResults("搜索", searchTimes)

	fmt.Println("\n📊 Benchmark 3: 关键词搜索")
	keywordTimes := make([]time.Duration, *iterations)
	for i := 0; i < *iterations; i++ {
		start := time.Now()
		results := ctx.App.SearchModels(ctx.FilesRoot, "model", 0, 0, 0, 0, 0, 0)
		keywordTimes[i] = time.Since(start)
		fmt.Printf("   迭代 %d: %v (找到 %d 个结果)\n", i+1, keywordTimes[i], len(results))
	}
	printBenchmarkResults("关键词搜索", keywordTimes)

	entries := ctx.App.ScanModelEntries(ctx.FilesRoot)
	if len(entries) > 0 {
		fmt.Println("\n📊 Benchmark 4: 单模型分析")
		analyzeTimes := make([]time.Duration, min(*iterations, len(entries)))
		for i := 0; i < len(analyzeTimes); i++ {
			start := time.Now()
			_ = ctx.App.AnalyzeBedrockModel(entries[i].Path)
			analyzeTimes[i] = time.Since(start)
			fmt.Printf("   迭代 %d: %v\n", i+1, analyzeTimes[i])
		}
		printBenchmarkResults("模型分析", analyzeTimes)
	}

	return nil
}

// printBenchmarkResults 打印基准测试结果
func printBenchmarkResults(name string, times []time.Duration) {
	if len(times) == 0 {
		return
	}

	var total time.Duration
	minTime := times[0]
	maxTime := times[0]

	for _, t := range times {
		total += t
		if t < minTime {
			minTime = t
		}
		if t > maxTime {
			maxTime = t
		}
	}

	avgTime := total / time.Duration(len(times))
	fmt.Printf("   📈 %s: 平均=%v, 最小=%v, 最大=%v\n", name, avgTime, minTime, maxTime)
}

// runExport 执行导出命令
func runExport(ctx *CmdContext) error {
	fs := newCmdFlagSet("export")
	modelPath := fs.String("model", "", "模型文件路径")
	outputPath := fs.String("output", "", "输出文件路径")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *modelPath == "" {
		return newParamErrf("--model 参数不能为空")
	}

	content := ctx.App.ExportModelStructureJSON(*modelPath)

	if content == "" {
		return newRuntimeErrf("导出内容为空")
	}

	if *outputPath != "" {
		if err := os.WriteFile(*outputPath, []byte(content), fsutil.FilePerms); err != nil {
			return newRuntimeErrf("写入文件失败: %v", err)
		}
		fmt.Printf("✅ 已导出到: %s\n", *outputPath)
	} else {
		fmt.Println(content)
	}

	return nil
}
