package cli

// scan_bench.go — 扫描引擎基准：Go / Rust 对照（ADR-262 D3 最后一项遗留）。
//
// 为什么需要独立命令而不是给现有基准加个字段：
//   - `single-bench` 量的是「解析一个模型」，`scan-bench` 量的是「扫一遍仓库」——两者
//     的输入、阶段、可比对象都不同，混进同一份报告只会让读者算错账；
//   - Rust（`scan_fast`）是 win-amd64 / macOS / Linux **生产构建的主扫描路径**，Go 是其
//     **兜底**（build/*/Taskfile.yml 带 `-tags rust_backend`）。「Rust 到底快多少」只能
//     在同一台机器、同一 fixture、同一条生产管线上量——这正是本命令做的事。
//
// 诚实红线（本命令存在的理由）：
//  1. **区分「本构建有没有 Rust」与「Rust 这次真的跑了吗」**：`-tags rust_backend` 下 Rust
//     仍可能运行期不可用（DLL 缺失/版本不符），生产路径此时静默回退 Go——若不作区分，
//     报告就会把 Go 的耗时记在 Rust 头上。本命令用 `scanner.ScanEngineStats()` 的前后差
//     **实测归属**，不猜；
//  2. **拿不到就说不采集**：Rust 未参与时 `used=false` + 原因 token，绝不填 0.00ms
//     （0ms 会被读成「快到测不出」，正好相反）；
//  3. **缓存命中不算测量**：命中 30s 扫描缓存的那一次根本没走引擎，若计进样本就是把
//     「省下的时间」当成引擎速度。逐次前先 `scanner.InvalidateCache()`，并如实回报命中数。

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types"
)

// scanBenchReason* 引擎未参与的原因 token（前端/人类都按 token 判定，不做字符串猜测）。
const (
	// scanBenchReasonUnavailable 本构建没有 Rust 后端（`!rust_backend` 构建走 stub）
	scanBenchReasonUnavailable = "unavailable"
	// scanBenchReasonFellBack Rust 后端在场但本次未处理（运行期不可用 → 生产静默回退 Go）
	scanBenchReasonFellBack = "fell_back"
	// scanBenchReasonCacheHit 该次未走任何引擎（扫描缓存命中），故不计入样本
	scanBenchReasonCacheHit = "cache_hit"
	// scanBenchReasonInterfered 该次归属无法判定（并发扫描交叉，计数差不为 1）
	scanBenchReasonInterfered = "interfered"
)

// scanBenchSpecJSON 本次对照的规格回显（AI 复盘「量的是什么、量了几次、什么构建」）。
type scanBenchSpecJSON struct {
	FilesRoot  string `json:"files_root"`
	Iterations int    `json:"iterations"`
	// BuildBackend 构建期事实（`-tags rust_backend` → "rust"），与运行期归属是两件事
	BuildBackend string `json:"build_backend"`
}

// scanBenchEngineJSON 单个引擎的实测结果。
type scanBenchEngineJSON struct {
	// Engine go | rust
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
	// Entries 该引擎扫出的条目数（两侧应一致，不一致即引擎分叉——由 parity 给出明细）
	Entries int `json:"entries"`
	// Skipped 因缓存命中 / 归属不可判定而未计入样本的次数（如实回报，不静默丢弃）
	Skipped int `json:"skipped"`
}

// scanBenchParityJSON 跨引擎一致性（两种引擎对同一 fixture 必须给出同一批条目）。
type scanBenchParityJSON struct {
	// Comparable 两侧都真的跑了才有可比性
	Comparable bool `json:"comparable"`
	Match      bool `json:"match"`
	// OnlyGo / OnlyRust 各自扫到而对方没扫到的路径（截断到前若干条，避免报告爆掉）
	OnlyGo   []string `json:"only_go,omitempty"`
	OnlyRust []string `json:"only_rust,omitempty"`
	// FieldDiff 同路径但字段（Size/Hash/Ext/Name）不一致的路径
	FieldDiff []string `json:"field_diff,omitempty"`
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
	RegisterCommandC("scan-bench", CatPerf, "扫描引擎基准（Go / Rust 对照，ADR-262 D3）", runScanBench,
		ParamSpec{Key: "iterations", Type: ParamNumber},
		ParamSpec{Key: "format", Type: ParamString},
	)
}

// scanEngineDelta 由两次引擎归属计数的差值判定「这一次扫描是谁处理的」。
//
// 返回 ok=false 时给出原因 token——两种情形都必须 false：
//   - 两个计数都没动 = 缓存命中（没走引擎，不是「0ms 的测量」）；
//   - 两个计数都动了 = 期间有并发扫描交叉，无法把这一次归给谁（宁可弃样本，不猜）。
func scanEngineDelta(before, after scanner.ScanEngineStat) (engine, reason string, ok bool) {
	dRust := after.Rust - before.Rust
	dGo := after.GoWalk - before.GoWalk
	switch {
	case dRust == 1 && dGo == 0:
		return "rust", "", true
	case dGo == 1 && dRust == 0:
		return "go", "", true
	case dRust == 0 && dGo == 0:
		return "", scanBenchReasonCacheHit, false
	default:
		return "", scanBenchReasonInterfered, false
	}
}

// measureScanEngine 逐次量一个引擎：每轮先失效扫描缓存（否则第二轮量的是缓存），
// 再用强制开关把这一次钉在目标引擎上，最后用计数差**实测**归属。
func measureScanEngine(root, engine string, iterations int) (scanBenchEngineJSON, []types.ModelEntry) {
	out := scanBenchEngineJSON{Engine: engine}
	defer scanner.SetForceGoEngine(false)
	var entries []types.ModelEntry
	for i := 0; i < iterations; i++ {
		scanner.InvalidateCache()
		scanner.SetForceGoEngine(engine == "go")
		before := scanner.ScanEngineStats()
		start := time.Now()
		got := scanner.ScanEntries(root)
		elapsed := time.Since(start)
		after := scanner.ScanEngineStats()
		scanner.SetForceGoEngine(false)

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
		if handled != engine {
			// 请求 Rust 却由 Go 处理 = 生产路径的静默回退：如实记为「未参与」，不计样本
			// 同上不覆写已成功的 Used 态（后续回退不得抹掉前序迭代的 Used=true）
			if !out.Used {
				out.Reason = scanBenchReasonFellBack
			}
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

// scanEntryIndex 一致性比对的键：路径（两引擎必须对同一批文件给出条目）。
func scanEntryIndex(entries []types.ModelEntry) map[string]types.ModelEntry {
	idx := make(map[string]types.ModelEntry, len(entries))
	for _, e := range entries {
		idx[e.Path] = e
	}
	return idx
}

// compareScanEngines 逐路径比对两侧条目集合与关键字段（Size/Hash/Ext/Name）。
// 明细截断到前 10 条——报告是给人看的，全量差异留给逐条调试。
func compareScanEngines(goEntries, rustEntries []types.ModelEntry) scanBenchParityJSON {
	const limit = 10
	if goEntries == nil || rustEntries == nil {
		return scanBenchParityJSON{}
	}
	out := scanBenchParityJSON{Comparable: true, Match: true}
	goIdx := scanEntryIndex(goEntries)
	rustIdx := scanEntryIndex(rustEntries)
	for path, g := range goIdx {
		r, ok := rustIdx[path]
		if !ok {
			out.Match = false
			if len(out.OnlyGo) < limit {
				out.OnlyGo = append(out.OnlyGo, path)
			}
			continue
		}
		if g.Size != r.Size || g.Hash != r.Hash || g.Ext != r.Ext || g.Name != r.Name {
			out.Match = false
			if len(out.FieldDiff) < limit {
				out.FieldDiff = append(out.FieldDiff, path)
			}
		}
	}
	for path := range rustIdx {
		if _, ok := goIdx[path]; !ok {
			out.Match = false
			if len(out.OnlyRust) < limit {
				out.OnlyRust = append(out.OnlyRust, path)
			}
		}
	}
	sort.Strings(out.OnlyGo)
	sort.Strings(out.OnlyRust)
	sort.Strings(out.FieldDiff)
	return out
}

// buildScanBenchPayload 组装载荷：先量 Go（生产兜底路径，恒可用），再量 Rust（可能不可用）。
//
// 顺序固定 Go → Rust：Rust 是否参与要靠计数差判定，而 Go 侧用的是强制开关（确定可控），
// 先量可测的那一端，报告在任一构建下都至少有 Go 的实测数据。
func buildScanBenchPayload(filesRoot string, iterations int) scanBenchJSON {
	goEngine, goEntries := measureScanEngine(filesRoot, "go", iterations)
	rustEngine, rustEntries := measureScanEngine(filesRoot, "rust", iterations)
	if !rustEngine.Used {
		// 「本构建就没有 Rust」与「有但运行期回退」是两件事：前者是构建期事实（stub 构建），
		// 后者是运行期事实（DLL 缺失/版本不符）。混成一句会让「为什么没测到 Rust」无从下手。
		if scanner.ScanBackend == "go" {
			rustEngine.Reason = scanBenchReasonUnavailable
		} else if rustEngine.Reason != scanBenchReasonCacheHit {
			rustEngine.Reason = scanBenchReasonFellBack
		}
	}
	out := scanBenchJSON{
		Spec: scanBenchSpecJSON{
			FilesRoot:    filesRoot,
			Iterations:   iterations,
			BuildBackend: scanner.ScanBackend,
		},
		Engines: []scanBenchEngineJSON{goEngine, rustEngine},
	}
	// 只有两侧都真的采集到才有可比性——单侧数据做「一致性比对」比的是空气
	// （compareScanEngines 对 nil 入参返回 Comparable=false，此处显式表达该条件）。
	if goEngine.Used && rustEngine.Used {
		out.Parity = compareScanEngines(goEntries, rustEntries)
	}
	return out
}

// printScanBenchText 人类可读报告：未采集的引擎写「未采集 + 原因」而不是 0.00ms。
func printScanBenchText(sb *scanBenchJSON) {
	fmt.Println("🔍 扫描引擎基准（Go / Rust 对照）")
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
		fmt.Printf("   ✅ %-5s 中位 %.2fms  p95 %.2fms  条目 %d  （样本 %d 次: %s）\n",
			e.Engine, e.MedianMs, e.P95Ms, e.Entries, len(e.RunsMs), formatMsList(e.RunsMs))
		if e.Skipped > 0 {
			fmt.Printf("        （另有 %d 次未计入样本：缓存命中/归属不可判定）\n", e.Skipped)
		}
	}
	fmt.Println()
	if !sb.Parity.Comparable {
		fmt.Println("   ⚠️  跨引擎一致性：无法比对（两侧未同时采集）")
		return
	}
	if sb.Parity.Match {
		fmt.Println("   ✅ 跨引擎一致性：条目集合与关键字段逐条一致")
		return
	}
	fmt.Println("   ❌ 跨引擎一致性：存在分叉")
	if len(sb.Parity.OnlyGo) > 0 {
		fmt.Printf("      仅 Go 扫到: %s\n", strings.Join(sb.Parity.OnlyGo, ", "))
	}
	if len(sb.Parity.OnlyRust) > 0 {
		fmt.Printf("      仅 Rust 扫到: %s\n", strings.Join(sb.Parity.OnlyRust, ", "))
	}
	if len(sb.Parity.FieldDiff) > 0 {
		fmt.Printf("      字段不一致: %s\n", strings.Join(sb.Parity.FieldDiff, ", "))
	}
}

func scanBenchReasonText(token string) string {
	switch token {
	case scanBenchReasonUnavailable:
		return "本构建未启用 rust_backend"
	case scanBenchReasonFellBack:
		return "Rust 后端本次未处理（运行期不可用，已回退 Go）"
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
		parts = append(parts, fmt.Sprintf("%.2f", x))
	}
	return strings.Join(parts, ", ")
}

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
	iterations := fs.Int("iterations", 3, "每个引擎重复扫描次数（取中位/p95）")
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
