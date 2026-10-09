// perf_snapshot.go：perf-snapshot 一站式性能快照（原 perf.go 拆分，2026-10 文件行数治理）。
// runPerfSnapshot / buildCacheStatsJSON / buildPerfDiagnostics / buildPerfRecommendations /
// generateSnapshotSummary——bench + cache + format-detect + 瓶颈建议一体输出。
package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/texture_cache"
)

// ===== perf-snapshot：一站式性能快照 =====

// perfSnapshot 性能快照 JSON 结构
type perfSnapshot struct {
	Timestamp       string               `json:"timestamp"`
	Model           string               `json:"model"`
	Format          string               `json:"format"`
	SizeBytes       int64                `json:"size_bytes"`
	BenchResult     *singleBenchJSON     `json:"bench"`
	CacheStats      *cacheStatsJSON      `json:"cache"`
	Diagnostics     []perfDiagnostic     `json:"diagnostics"`
	Recommendations []perfRecommendation `json:"recommendations"`
	Summary         string               `json:"summary"`
}

// cacheStatsJSON 缓存状态
type cacheStatsJSON struct {
	FileCount int    `json:"file_count"`
	TotalSize int64  `json:"total_size"`
	HitRate   string `json:"hit_rate"`
	Healthy   bool   `json:"healthy"`
}

// perfDiagnostic 诊断条目
type perfDiagnostic struct {
	Level   string `json:"level"`
	Area    string `json:"area"`
	Message string `json:"message"`
}

// perfRecommendation 建议条目
type perfRecommendation struct {
	Priority string `json:"priority"`
	Action   string `json:"action"`
	Impact   string `json:"impact"`
	Area     string `json:"area"`
}

// runPerfSnapshot 执行一站式性能快照
func runPerfSnapshot(ctx *CmdContext) error {
	fs := newCmdFlagSet("perf-snapshot")
	modelPath := fs.String("model", "", "指定模型路径（可选，不填则用第一个）")
	iterations := fs.Int("iterations", 2, "基准测试迭代次数")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	targetModel, err := resolveTargetModel(ctx.App, *modelPath, ctx.FilesRoot)
	if err != nil {
		return err
	}

	modelSize := getModelSize(targetModel)
	format := detectModelFormat(targetModel)
	benchResult := runBenchIterations(ctx, targetModel, *iterations, format, modelSize)
	cacheJSON := buildCacheStatsJSON()
	diagnostics := buildPerfDiagnostics(format, modelSize, cacheJSON, benchResult.Stages)
	recommendations := buildPerfRecommendations(format, benchResult.Stages)
	summary := generateSnapshotSummary(benchResult, cacheJSON, format)

	snapshot := perfSnapshot{
		Timestamp:       time.Now().Format(time.RFC3339),
		Model:           targetModel,
		Format:          format,
		SizeBytes:       modelSize,
		BenchResult:     benchResult,
		CacheStats:      cacheJSON,
		Diagnostics:     diagnostics,
		Recommendations: recommendations,
		Summary:         summary,
	}

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	fmt.Println(string(data))
	return nil
}

// resolveTargetModel 解析 --model 参数；为空时自动选「首个真能解析出几何」的模型。
//
// 需要 AppService 是因为自动挑选要走 firstWithGeometry（几何验证）——类型可分析不等于该条目含几何，
// 挑到音效包/纯资源包就是「空模型数据当实测」（见 scanFirstModel）。
func resolveTargetModel(a AppService, modelPath, filesRoot string) (string, error) {
	if modelPath != "" {
		// 目录式模型归一化（增强）：折叠为 <dir>/ysm.json —— 与 scanner 条目约定一致，
		// 见 resolveBenchModelTarget。
		entry, _, err := resolveBenchModelTarget(modelPath)
		switch err {
		case nil:
			return entry, nil
		default:
			// 归一化失败（不存在 / 形态不可用）→ 保持既有契约：显式 --model 直返
			// （TestResolveTargetModel_ExplicitWins），让 ① 阶段如实报读盘失败
			// （D8 保证失败在载荷里可见，不再静默假绿），不在命令层拦截。
			return modelPath, nil
		}
	}
	if m := scanFirstModel(a, filesRoot); m != "" {
		return m, nil
	}
	return "", newRuntimeErrf("未找到模型，请指定 --model 参数")
}

// getModelSize 返回模型文件大小（字节）；无法 stat 时返回 0。
func getModelSize(path string) int64 {
	if info, err := os.Stat(path); err == nil {
		return info.Size()
	}
	return 0
}

// runBenchIterations 跑 N 轮基准并返回汇总结果。
func runBenchIterations(ctx *CmdContext, targetModel string, iterations int, format string, modelSize int64) *singleBenchJSON {
	var allStages [][]singleBenchStage
	totalStart := time.Now()
	for iter := 0; iter < iterations; iter++ {
		// 每迭代清 geoCache 测冷解析：runSingleModelBench 的「② 解析」走 AnalyzeBedrockModel，
		// 其内部 geoCache 键 = 剥离后缀 path + modtime/size——模型文件不变则 N 轮全命中缓存，
		// 解析阶段 avg 严重低估（测的是缓存 lookup 而非 WASM 解码）。对齐 scan-bench
		// 「缓存命中不算测量」范式（锐评 2026-10-09）。代价=每轮真实解析，正是基准要测的。
		ctx.App.ClearScanCache()
		stages := runSingleModelBench(ctx.App, targetModel, ctx.FilesRoot)
		allStages = append(allStages, stages)
	}
	totalDuration := time.Since(totalStart)
	avg := avgBenchStages(allStages)
	stageJSON, bottleneckName := stagesToJSON(avg, allStages)
	// 与 runSingleBenchJSON 同口径：total_ms 是 N 次累计，单次看 per_iteration_ms
	// （a128f35bc 残口收口：benchOneModel 组装点已走 durationMs，此处曾漏——
	// 同一个 singleBenchJSON 两个组装点跨命令口径分叉，快迭代累计被截亚毫秒）
	totalMs := durationMs(totalDuration)
	perIterationMs := totalMs
	if iterations > 0 {
		perIterationMs = totalMs / float64(iterations)
	}
	return &singleBenchJSON{
		Model:          targetModel,
		Iterations:     iterations,
		TotalMs:        totalMs,
		PerIterationMs: perIterationMs,
		Stages:         stageJSON,
		Bottleneck:     bottleneckName,
		Hints:          generateHints(avg),
		Format:         format,
		SizeBytes:      modelSize,
		Identity:       buildPerfIdentity(targetModel, ctx.FilesRoot, nil),
	}
}

// buildCacheStatsJSON 从 texture_cache 拉取统计并装填 JSON 结构。
func buildCacheStatsJSON() *cacheStatsJSON {
	cacheStats := texture_cache.GetCacheStats()
	cacheJSON := &cacheStatsJSON{
		FileCount: cacheStats.FileCount,
		TotalSize: cacheStats.TotalSize,
		HitRate:   "N/A",
		Healthy:   true,
	}
	if cacheStats.FileCount == 0 {
		cacheJSON.Healthy = false
	}
	return cacheJSON
}

// formatLoadingHint 返回各格式对应的加载策略说明。
func formatLoadingHint(format string) string {
	switch format {
	case "PMX", "PMD":
		return "PMX 格式：已启用 Worker 解析 + 纹理解码 + rAF 切片（P0+P1+P2）"
	case "VRM", "GLTF":
		return "VRM/GLTF 格式：GLTFLoader 原生解析，通常无需 Worker 化"
	case "YSM":
		return "YSM 格式：Go WASM 预计算，前端直接消费"
	case "Litematic":
		return "Litematic 格式：JSON 体素数据，渲染走 BoxGeometry"
	}
	return ""
}

// buildPerfDiagnostics 生成格式级 + 缓存 + 瓶颈三类诊断。
func buildPerfDiagnostics(format string, modelSize int64, cacheJSON *cacheStatsJSON, stages []benchStageJSON) []perfDiagnostic {
	var diagnostics []perfDiagnostic
	diagnostics = append(diagnostics, perfDiagnostic{
		Level:   "info",
		Area:    "format",
		Message: fmt.Sprintf("检测到 %s 格式模型，%.1fMB", format, float64(modelSize)/1024/1024),
	})

	if hint := formatLoadingHint(format); hint != "" {
		diagnostics = append(diagnostics, perfDiagnostic{
			Level:   "info",
			Area:    "loading",
			Message: hint,
		})
	}

	if format == "PMX" || format == "PMD" {
		if modelSize > 100*1024*1024 {
			diagnostics = append(diagnostics, perfDiagnostic{
				Level:   "warn",
				Area:    "size",
				Message: "模型 >100MB，纹理解码可能仍需关注",
			})
		}
	}

	if !cacheJSON.Healthy {
		diagnostics = append(diagnostics, perfDiagnostic{
			Level:   "warn",
			Area:    "cache",
			Message: "缓存为空，首次加载需要实时解码纹理",
		})
	}

	for _, s := range stages {
		if s.Ms > 100 {
			diagnostics = append(diagnostics, perfDiagnostic{
				Level:   "bottleneck",
				Area:    strings.TrimPrefix(s.Name, "① "),
				Message: fmt.Sprintf("%s 耗时 %.1fms，超过 100ms 瓶颈线", s.Name, s.Ms),
			})
		} else if s.Ms > 50 {
			diagnostics = append(diagnostics, perfDiagnostic{
				Level:   "warn",
				Area:    strings.TrimPrefix(s.Name, "① "),
				Message: fmt.Sprintf("%s 耗时 %.1fms，接近瓶颈线", s.Name, s.Ms),
			})
		}
	}

	return diagnostics
}

// buildPerfRecommendations 生成阶段级 + 格式级建议。
func buildPerfRecommendations(format string, stages []benchStageJSON) []perfRecommendation {
	var recommendations []perfRecommendation
	for _, s := range stages {
		if s.Ms <= 10 {
			continue
		}
		area := strings.TrimPrefix(s.Name, "① ")
		switch s.Name {
		case "① 文件读取":
			recommendations = append(recommendations, perfRecommendation{
				Priority: "high",
				Action:   "检查磁盘速度，考虑文件缓存或 SSD",
				Impact:   fmt.Sprintf("预计减少 %.1fms", s.Ms*0.7),
				Area:     area,
			})
		case "② JSON 解析", "② PMX 解析", "② 模型解析":
			recommendations = append(recommendations, perfRecommendation{
				Priority: "high",
				Action:   fmt.Sprintf("%s 是当前瓶颈：考虑更快的解析路径（YSM 用 sonic；PMX 用预解析缓存）", strings.TrimPrefix(s.Name, "② ")),
				Impact:   fmt.Sprintf("预计减少 %.1fms", s.Ms*0.5),
				Area:     area,
			})
		case "④ 几何数据准备":
			recommendations = append(recommendations, perfRecommendation{
				Priority: "high",
				Action:   "考虑简化模型（减面/LOD）或预处理",
				Impact:   fmt.Sprintf("预计减少 %.1fms", s.Ms*0.4),
				Area:     area,
			})
		case "⑤ 纹理数据准备":
			recommendations = append(recommendations, perfRecommendation{
				Priority: "medium",
				Action:   "使用 KTX2 压缩纹理（减少 60-70%）",
				Impact:   fmt.Sprintf("预计减少 %.1fms", s.Ms*0.6),
				Area:     area,
			})
		case "⑥ 序列化模拟":
			recommendations = append(recommendations, perfRecommendation{
				Priority: "medium",
				Action:   "使用 msgpack 或精简嵌套结构（Wails binding 走 JSON 序列化）",
				Impact:   fmt.Sprintf("预计减少 %.1fms", s.Ms*0.3),
				Area:     area,
			})
		}
	}

	switch format {
	case "PMX", "PMD":
		recommendations = append(recommendations, perfRecommendation{
			Priority: "info",
			Action:   "确认纹理由 Worker 解码（P0），PMX 由 Worker 解析（P1）",
			Impact:   "主线程释放 3-5s",
			Area:     "worker",
		})
		recommendations = append(recommendations, perfRecommendation{
			Priority: "info",
			Action:   "确认 rAF 切片生效（P2），单帧 max < 1s",
			Impact:   "用户感知不卡",
			Area:     "slicing",
		})
	case "VRM", "GLTF":
		recommendations = append(recommendations, perfRecommendation{
			Priority: "info",
			Action:   "GLTFLoader 已原生高效，无需 Worker 化",
			Impact:   "已最优",
			Area:     "loading",
		})
	case "YSM":
		recommendations = append(recommendations, perfRecommendation{
			Priority: "info",
			Action:   "YSM 数据由 Go 预计算，前端零解析开销",
			Impact:   "已最优",
			Area:     "loading",
		})
	}

	return recommendations
}

// generateSnapshotSummary 生成快照摘要文本
func generateSnapshotSummary(bench *singleBenchJSON, cache *cacheStatsJSON, format string) string {
	var parts []string
	parts = append(parts, fmt.Sprintf("总耗时 %.2fms", bench.TotalMs))
	if bench.Bottleneck != "" {
		parts = append(parts, fmt.Sprintf("当前瓶颈: %s", bench.Bottleneck))
	}
	parts = append(parts, fmt.Sprintf("格式: %s", format))
	if cache != nil {
		parts = append(parts, fmt.Sprintf("缓存: %d 个文件 / %s", cache.FileCount, fsutil.FormatSize(cache.TotalSize)))
		if !cache.Healthy {
			parts = append(parts, "缓存为空（首次加载）")
		}
	}
	return strings.Join(parts, " | ")
}

// scanFirstModel 取文件根目录下「首个**真能解析出几何**的 CLI 可分析模型」；无则以空串如实告知。
//
// 实现 = `scanBenchTargets` 的空 rtype 形态（"所有 CLI 可分析类型"取前 `maxGeometryProbe` 个）→
// `firstWithGeometry` 验证真有几何：发现权归 `scanner.ScanEntries`、归属归 `classifyForScan`、
// 可分析性归 `perfTypeManifest`、几何验证归 `hasGeometry`（四个既有单点，无新表）。
//
// ⚠️ 随发现权一并继承 `scanner.ScanEntries` 的**目录缓存**（TTL 内同目录复用，文件变更由
// `InvalidatePath` 显式失效）：原实现的直读 Walk 无缓存，故这是本收编带来的语义变化。
// 命令级调用均只调一次、无实际影响；若某调用方需「刚落盘就必须可见」，应先失效缓存。
//
// 2026-09-18 收编（ADR-262 D3）：原实现自持 `allowedExts` 白名单——这是 ADR 漏记的**第 4 张类型表**
// （ADR 只记了并发基准 `.ysm` 过滤 / `detectModelFormat` / 前端 `LoadTrace.format` 三张）。
// 它不只是重复：白名单含 `.vrm/.gltf/.glb/.litematic`，而这些类型的解析器只在前端 3D adapter，
// CLI 拿到是空模型；本函数的消费方（`resolveTargetModel`、`health --bench`）**直接把它喂进
// `runSingleModelBench`** → 产出「空模型数据当实测」（D3/D8 诚实红线）。
// 顺带收益：结果改为路径字典序（原为 Walk 首命中，依文件系统而变），测试/AI 可复现；
// 目录式入口 `<dir>/ysm.json` 由 scanner 折叠工序覆盖，不再需要单独的 IsYsmEntryJSON 分支。
//
// 2026-09-19 追加**几何验证**——与上面同一条红线，只是换了个来源：类型可分析只保证「CLI 有该类型的
// 解析链路」，不保证该条目含几何。目录归属会把音效包/纯资源包与真模型归成同一类（用户仓库实测：
// `maid-model\` 下的 atri_sound_pack-1.0.0.zip → 0 bones，且按路径序排在女仆包里最前），
// 只按类型取首个就是又一次「空模型数据当实测」。故取前 `maxGeometryProbe` 个候选逐个验证，
// 命中第一个真有几何的；一个都没有时如实返回空串（由调用方报「未找到模型」）。
func scanFirstModel(a AppService, filesRoot string) string {
	hit, _, _, ok := firstWithGeometry(a, scanBenchTargets(filesRoot, "", maxGeometryProbe), maxGeometryProbe)
	if !ok {
		return ""
	}
	return hit
}
