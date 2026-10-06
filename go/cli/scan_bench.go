package cli

// scan_bench.go — 扫描基准：Go walk 单引擎耗时测量。
//
// 历史：本命令原为 Go / Rust 扫描引擎对照（ADR-262 D3）。Rust 扫描后端已于 2026-10-06 删除
// （Go 并行遍历 walk_parallel.go 实测 1.97~3x 于 Rust jwalk，jwalk 上游已弃用），
// 故保留命令本体作为 Go 扫描性能基准，`scan-bench` 继续可查「扫一遍仓库要多久」。
//
// 诚实红线（本命令存在的理由）：
//  1. **区分「扫过」与「没扫」**：Go walk 是唯一后端，但每次扫描仍可能被 30s 扫描缓存命中
//     ——缓存命中的那一次根本没走引擎，若计进样本就是把「省下的时间」当成扫描速度。
//     本命令用 `scanner.ScanEngineStats()` 的前后差**实测归属**，不猜；
//  2. **拿不到就说不采集**：未参与时 `used=false` + 原因 token，绝不填 0.00ms
//     （0ms 会被读成「快到测不出」，正好相反）；采集到但低于时钟分辨率的样本渲染成
//     `<0.01ms`（formatMs/formatMsList），同样不与 0.00 混淆。
//  3. **缓存命中不算测量**：逐次前 `scanner.InvalidateCache()`，并如实回报命中数。

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// scanBenchReason* 引擎未参与的原因 token（前端/人类都按 token 判定，不做字符串猜测）。
const (
	// scanBenchReasonCacheHit 该次未走引擎（扫描缓存命中），故不计入样本
	scanBenchReasonCacheHit = "cache_hit"
	// scanBenchReasonInterfered 该次归属无法判定（并发扫描交叉，计数差不为 1）
	scanBenchReasonInterfered = "interfered"
)

// scanBenchSpecJSON 本次基准的规格回显（AI 复盘「量的是什么、量了几次、什么构建」）。
type scanBenchSpecJSON struct {
	FilesRoot  string `json:"files_root"`
	Iterations int    `json:"iterations"`
	// BuildBackend 构建期事实（恒 "go"）
	BuildBackend string `json:"build_backend"`
}

// scanBenchEngineJSON 单个引擎的实测结果。
type scanBenchEngineJSON struct {
	// Engine go（唯一后端）
	Engine string `json:"engine"`
	// Used 该引擎是否**真的**处理过至少一次扫描（false = 未采集，看 Reason，别把 0 读成快）
	Used bool `json:"used"`
	// Reason 未参与的原因 token（used=true 时缺席）
	Reason string `json:"reason,omitempty"`
	// RunsMs 逐次墙钟原始样本（保留抖动，不预先平均——读者有权看到全部样本）
	RunsMs []float64 `json:"runs_ms,omitempty"`
	// MedianMs / P95Ms 最近秩分位数（与 single-bench 的样本统计同口径）
	MedianMs float64 `json:"median_ms,omitempty"`
	P95Ms    float64 `json:"p95_ms,omitempty"`
	// Entries 该引擎扫出的条目数
	Entries int `json:"entries"`
	// Skipped 因缓存命中 / 归属不可判定而未计入样本的次数（如实回报，不静默丢弃）
	Skipped int `json:"skipped"`
}

// scanBenchParityJSON 保留字段以兼容既有前端载荷契约；单引擎下恒 Comparable=false。
type scanBenchParityJSON struct {
	Comparable bool     `json:"comparable"`
	Match      bool     `json:"match"`
	OnlyGo     []string `json:"only_go,omitempty"`
	OnlyRust   []string `json:"only_rust,omitempty"`
	FieldDiff  []string `json:"field_diff,omitempty"`
}

// scanBenchJSON 命令载荷（ADR-200 D1 结构化出口）。
type scanBenchJSON struct {
	Spec    scanBenchSpecJSON     `json:"spec"`
	Engines []scanBenchEngineJSON `json:"engines"`
	Parity  scanBenchParityJSON   `json:"parity"`
	// ADR-200 D5 sidecar（桥接层注入）
	Output    string `json:"output,omitempty"`
	FilesRoot string `json:"filesRoot,omitempty"`
}

// AttachSidecar 实现 SidecarOutput（ADR-200 D5）。
func (s *scanBenchJSON) AttachSidecar(output, filesRoot string) {
	s.Output = output
	s.FilesRoot = filesRoot
}

func init() {
	RegisterCommandC("scan-bench", CatPerf, "扫描基准（Go walk 单引擎耗时测量）", runScanBench,
		ParamSpec{Key: "iterations", Type: ParamNumber},
		ParamSpec{Key: "format", Type: ParamString},
	)
}

// scanEngineDelta 由引擎归属计数的差值判定「这一次扫描是否真的走了引擎」。
//
// 返回 ok=false 时给出原因 token：
//   - 计数没动 = 缓存命中（没走引擎，不是「0ms 的测量」）；
//   - 计数差不为 1 = 期间有并发扫描交叉，无法把这一次归给谁（宁可弃样本，不猜）。
func scanEngineDelta(before, after scanner.ScanEngineStat) (engine, reason string, ok bool) {
	dGo := after.GoWalk - before.GoWalk
	switch dGo {
	case 1:
		return "go", "", true
	case 0:
		return "", scanBenchReasonCacheHit, false
	default:
		return "", scanBenchReasonInterfered, false
	}
}

// measureScanEngine 逐次量引擎：每轮先失效扫描缓存（否则第二轮量的是缓存），
// 最后用计数差**实测**归属。
func measureScanEngine(root string, iterations int) (scanBenchEngineJSON, []types.ModelEntry) {
	out := scanBenchEngineJSON{Engine: "go"}
	var entries []types.ModelEntry
	for i := 0; i < iterations; i++ {
		scanner.InvalidateCache()
		before := scanner.ScanEngineStats()
		start := time.Now()
		got := scanner.ScanEntries(root)
		elapsed := time.Since(start)
		after := scanner.ScanEngineStats()

		handled, reason, ok := scanEngineDelta(before, after)
		if !ok {
			// 已定 Used=true（前序迭代成功）时不再覆写 Reason——「used=true 时 reason 缺席」是
			// 载荷契约（前端据此判「未采集说原因」），后续失败迭代不得把成功态的 Reason 写回
			if !out.Used {
				out.Reason = reason
			}
			out.Skipped++
			continue
		}
		if handled != "go" {
			// 理论不可达（Go 是唯一后端），防御性保留
			out.Skipped++
			continue
		}
		out.Used = true
		out.Reason = ""
		out.RunsMs = append(out.RunsMs, durationMs(elapsed))
		out.Entries = len(got)
		entries = got
	}
	if !out.Used && out.Reason == "" {
		out.Reason = scanBenchReasonCacheHit
	}
	out.MedianMs = percentileNearestRank(out.RunsMs, 0.5)
	out.P95Ms = percentileNearestRank(out.RunsMs, 0.95)
	if !out.Used {
		return out, nil
	}
	return out, entries
}

// buildScanBenchPayload 组装载荷。
func buildScanBenchPayload(filesRoot string, iterations int) scanBenchJSON {
	goEngine, _ := measureScanEngine(filesRoot, iterations)
	out := scanBenchJSON{
		Spec: scanBenchSpecJSON{
			FilesRoot:    filesRoot,
			Iterations:   iterations,
			BuildBackend: scanner.ScanBackend,
		},
		Engines: []scanBenchEngineJSON{goEngine},
		Parity:  scanBenchParityJSON{},
	}
	return out
}

// printScanBenchText 人类可读报告：未采集的引擎写「未采集 + 原因」而不是 0.00ms。
func printScanBenchText(sb *scanBenchJSON) {
	fmt.Println("🔍 扫描基准（Go walk 单引擎）")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   仓库根:   %s\n", sb.Spec.FilesRoot)
	fmt.Printf("   迭代次数: %d\n", sb.Spec.Iterations)
	fmt.Printf("   构建后端: %s（构建期事实）\n", sb.Spec.BuildBackend)
	fmt.Println()
	for _, e := range sb.Engines {
		if !e.Used {
			fmt.Printf("   ⏭️  %-5s 未采集（%s）\n", e.Engine, scanBenchReasonText(e.Reason))
			continue
		}
		fmt.Printf("   ✅ %-5s 中位 %s  p95 %s  条目 %d  （样本 %d 次: %s）\n",
			e.Engine, formatMs(e.MedianMs), formatMs(e.P95Ms), e.Entries, len(e.RunsMs), formatMsList(e.RunsMs))
		if e.Skipped > 0 {
			fmt.Printf("        （另有 %d 次未计入样本：缓存命中/归属不可判定）\n", e.Skipped)
		}
	}
}

func scanBenchReasonText(token string) string {
	switch token {
	case scanBenchReasonCacheHit:
		return "扫描缓存命中，未走引擎"
	case scanBenchReasonInterfered:
		return "并发扫描交叉，归属不可判定"
	default:
		return token
	}
}

func formatMsList(xs []float64) string {
	parts := make([]string, 0, len(xs))
	for _, x := range xs {
		parts = append(parts, formatMsValue(x))
	}
	return strings.Join(parts, ", ")
}

// formatMsValue 渲染毫秒数值（不含单位）。亚分辨率——即会 `%.2f` 舍成 0.00 的那一段
// （< 0.005）——写成 `<0.01`。
//
// 为什么必须这样（本文件诚实红线 #2）：`0.00` 与「未采集」在字面上不可区分，且会被读反成
// 「快到测不出」。粗时钟粒度下（Windows 单调时钟，2MB 热缓存读实测 `time.Since` 可为 0s）
// **合法测量值本就可能是 0**，所以「测得 0」只能靠这个标记与「没测」分开，不能靠一个同样
// 写 0.00 的裸值。回归守卫：`scan_bench_format_test.go`。
func formatMsValue(ms float64) string {
	if ms < 0.005 {
		return "<0.01"
	}
	return fmt.Sprintf("%.2f", ms)
}

// formatMs 带单位的人类报告字段版（中位 / p95）。
func formatMs(ms float64) string { return formatMsValue(ms) + "ms" }

// emitScanBench 双出口（ADR-200 D1/D5）：文本走人类报告，json 走结构化载荷。
func emitScanBench(ctx *CmdContext, sb scanBenchJSON, format string) error {
	if format == "json" {
		data, err := json.MarshalIndent(sb, "", "  ")
		if err != nil {
			return newRuntimeErrf("JSON 序列化失败: %v", err)
		}
		fmt.Println(string(data))
	} else {
		printScanBenchText(&sb)
	}
	ctx.SetResult(&sb)
	return nil
}

func runScanBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("scan-bench")
	iterations := fs.Int("iterations", 3, "每次扫描重复次数（取中位/p95）")
	format := fs.String("format", "text", "输出格式: text（人类可读）/ json（AI 友好）")
	if _, err := parseFlags(fs, ctx.Args); err != nil {
		return err
	}
	if ctx.FilesRoot == "" {
		return newParamErrf("scan-bench 需要 --files-root 指定仓库根")
	}
	if *iterations <= 0 {
		return newParamErrf("--iterations 必须大于 0")
	}
	if *format != "text" && *format != "json" {
		return newParamErrf("--format 必须是 text 或 json")
	}
	return emitScanBench(ctx, buildScanBenchPayload(ctx.FilesRoot, *iterations), *format)
}
