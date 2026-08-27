// ========== CLI: perf-log 优化记录 ==========
// 输出优化历史日志，改从 docs/knowledge/optimization_log.md 单一事实来源读取（C-2）。
// 此前为 Go 结构体硬编码（每次优化改源码）；现 AI/人在 md 记一条，CLI 即自动同步，杜绝双副本漂移。
// 供 AI 代理和用户快速了解项目性能演进历史，无需翻阅 ADR 或知识卡。
//
// perf-snapshot：一站式性能快照（bench + cache + format-detect + 瓶颈建议）
// 前置探测工具，AI 可直接消费结构化 JSON，定位瓶颈无需手动录 trace。

package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/texture_cache"
)

func init() {
	RegisterCommandC("perf-log", CatPerf, "输出优化记录日志（按时间倒序，含问题/做法/效果/提交）", runPerfLog)
	RegisterCommandC("perf-snapshot", CatPerf, "一站式性能快照（AI 友好 JSON，前置探测瓶颈）", runPerfSnapshot)
}

// optEntry 一条优化记录（对齐 optimization_log.md 表格 6 列）
type optEntry struct {
	date    string
	area    string
	problem string
	action  string
	effect  string
	commit  string
}

// findOptimizationLog 从当前工作目录向上探测仓库根定位优化日志文档
// （CLI 运行时 cwd=仓库根，但 go test 的 cwd=包目录，需向上查找使路径对任意 cwd 健壮）
func findOptimizationLog() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		p := filepath.Join(dir, "docs", "knowledge", "optimization_log.md")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", os.ErrNotExist
		}
		dir = parent
	}
}

func runPerfLog(ctx *CmdContext) error {
	docPath, err := findOptimizationLog()
	if err != nil {
		return newRuntimeErrf("优化日志文档不可读 docs/knowledge/optimization_log.md: %v（优化记录已改为文档单一事实来源，需在仓库内运行）", err)
	}
	data, err := os.ReadFile(docPath)
	if err != nil {
		return newRuntimeErrf("优化日志文档不可读 %s: %v", docPath, err)
	}
	lines := strings.Split(string(data), "\n")

	entries := parseOptimizationEntries(lines)
	if len(entries) == 0 {
		return newRuntimeErrf("优化日志 %s 中未解析到记录（格式：| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |）", docPath)
	}

	printOptimizationBox(entries)

	if bottlenecks := extractBulletSection(lines, "当前瓶颈"); len(bottlenecks) > 0 {
		fmt.Println()
		fmt.Println("── 当前瓶颈 ──")
		for _, b := range bottlenecks {
			fmt.Printf("  · %s\n", b)
		}
	}
	if metrics := extractTableSection(lines, "关键指标"); len(metrics) > 0 {
		fmt.Println()
		fmt.Println("── 关键指标 ──")
		for _, m := range metrics {
			fmt.Printf("  %s\n", m)
		}
	}

	return nil
}

// parseOptimizationEntries 从 md 解析「优化日志」表格（表头 `| 日期 | 领域 | …` 为锚）。
func parseOptimizationEntries(lines []string) []optEntry {
	var entries []optEntry
	inTable := false
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "|") && strings.Contains(line, "日期") && strings.Contains(line, "提交") {
			inTable = true
			continue
		}
		if inTable {
			// 表内分隔行 `|---|---|`
			if !strings.HasPrefix(line, "|") {
				// 空行/新段落 → 离开表格
				if line == "" {
					inTable = false
				} else {
					inTable = false
				}
				continue
			}
			if strings.Contains(line, "---") {
				continue
			}
			cols := splitTableRow(line)
			if len(cols) >= 6 {
				entries = append(entries, optEntry{
					date:    cols[0],
					area:    cols[1],
					problem: cols[2],
					action:  cols[3],
					effect:  cols[4],
					// md 中 commit 常用反引号包裹（`` `fd068ac` ``），解析时清理，避免终端输出带反引号
					commit: strings.Trim(cols[5], "`"),
				})
			}
		}
	}
	return entries
}

// splitTableRow 拆分 md 表格行 `| a | b | c |`
func splitTableRow(line string) []string {
	s := strings.TrimSpace(line)
	s = strings.TrimPrefix(s, "|")
	s = strings.TrimSuffix(s, "|")
	parts := strings.Split(s, "|")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, strings.TrimSpace(p))
	}
	return out
}

// extractBulletSection 提取某段落（## 标题）下的 `- ` 列表项
func extractBulletSection(lines []string, header string) []string {
	var out []string
	on := false
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "## ") {
			if on {
				break
			}
			on = strings.TrimPrefix(line, "## ") == header
			if on {
				continue
			}
		}
		if on && strings.HasPrefix(line, "- ") {
			out = append(out, strings.TrimPrefix(line, "- "))
		}
	}
	return out
}

// extractTableSection 提取某段落（## 标题）下的表格数据行（跳过表头与分隔行）
func extractTableSection(lines []string, header string) []string {
	var out []string
	on := false
	first := true // 段落内首个表格行 = 表头，跳过
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "## ") {
			if on {
				break
			}
			on = strings.TrimPrefix(line, "## ") == header
			first = true
			continue
		}
		if on && strings.HasPrefix(line, "|") && !strings.Contains(line, "---") {
			if first {
				first = false
				continue
			}
			cols := splitTableRow(line)
			if len(cols) >= 4 {
				out = append(out, fmt.Sprintf("%s | %s | %s | %s", cols[0], cols[1], cols[2], cols[3]))
			}
		}
	}
	return out
}

// printOptimizationBox 按时间倒序输出优化记录
func printOptimizationBox(entries []optEntry) {
	fmt.Println("╔══════════════════════════════════════════════════════════════╗")
	fmt.Println("║             优化记录 perf-log（按时间倒序）                 ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════╝")
	fmt.Println()

	for i, e := range entries {
		fmt.Printf("─ %s ─ %s ─ %s\n", e.date, e.area, e.commit)

		fmt.Printf("  问题: %s\n", wrap(e.problem, 72, "        "))
		fmt.Printf("  做法: %s\n", wrap(e.action, 72, "        "))
		fmt.Printf("  效果: %s\n", wrap(e.effect, 72, "        "))

		if i < len(entries)-1 {
			fmt.Println()
		}
	}
}

// wrap 折行，每行不超过 maxLen，续行首行缩进保持对齐
func wrap(text string, maxLen int, indent string) string {
	if len(text) <= maxLen {
		return text
	}
	var b strings.Builder
	words := strings.Fields(text)
	lineLen := 0
	first := true
	for _, w := range words {
		if first {
			b.WriteString(w)
			lineLen = len(w)
			first = false
			continue
		}
		if lineLen+1+len(w) > maxLen {
			b.WriteString("\n")
			b.WriteString(indent)
			b.WriteString(w)
			lineLen = len(indent) + len(w)
		} else {
			b.WriteString(" ")
			b.WriteString(w)
			lineLen += 1 + len(w)
		}
	}
	return b.String()
}

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

	targetModel, err := resolveTargetModel(*modelPath, ctx.FilesRoot)
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

// resolveTargetModel 解析 --model 参数；为空时自动选第一个模型。
func resolveTargetModel(modelPath, filesRoot string) (string, error) {
	if modelPath != "" {
		return modelPath, nil
	}
	if m := scanFirstModel(filesRoot); m != "" {
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
		stages := runSingleModelBench(ctx.App, targetModel, ctx.FilesRoot)
		allStages = append(allStages, stages)
	}
	totalDuration := time.Since(totalStart)
	avg := avgBenchStages(allStages)
	stageJSON, bottleneckName := stagesToJSON(avg)
	return &singleBenchJSON{
		Model:      targetModel,
		Iterations: iterations,
		TotalMs:    float64(totalDuration.Microseconds()) / 1000,
		Stages:     stageJSON,
		Bottleneck: bottleneckName,
		Hints:      generateHints(avg),
		Format:     format,
		SizeBytes:  modelSize,
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
		parts = append(parts, fmt.Sprintf("缓存: %d 个文件 / %s", cache.FileCount, formatSize(cache.TotalSize)))
		if !cache.Healthy {
			parts = append(parts, "缓存为空（首次加载）")
		}
	}
	return strings.Join(parts, " | ")
}

// scanFirstModel 扫描文件根目录获取第一个模型路径
func scanFirstModel(filesRoot string) string {
	if filesRoot == "" {
		return ""
	}
	var firstModel string
	allowedExts := map[string]bool{
		".ysm": true, ".pmx": true, ".pmd": true, ".vrm": true,
		".gltf": true, ".glb": true, ".litematic": true,
	}
	_ = filepath.Walk(filesRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && allowedExts[strings.ToLower(filepath.Ext(path))] {
			firstModel = path
			return filepath.SkipAll
		}
		return nil
	})
	return firstModel
}
