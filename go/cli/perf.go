// ========== CLI: perf-log 优化记录 ==========
// 输出优化历史日志，改从 docs/knowledge/optimization_log.md 单一事实来源读取（C-2）。
// 此前为 Go 结构体硬编码（每次优化改源码）；现 AI/人在 md 记一条，CLI 即自动同步，杜绝双副本漂移。
// 供 AI 代理和用户快速了解项目性能演进历史，无需翻阅 ADR 或知识卡。
// 2026-10 拆分：perf-snapshot 命令移入 perf_snapshot.go（一站式性能快照）。

package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
//
// 候选路径含 docs/knowledge/ 与 docs/archive/ 两处：7b6cec715 把该卡从 knowledge 迁到
// archive（知识库减负）时漏改本函数，只留单路径 → runPerfLog 全量报错、go test 长期红。
// 走「多候选逐个探测」而非硬改单路径：文档再被归档/迁回时只需加候选，不必记得回来改这里。
// 顺序即优先级（knowledge 在前：迁回后新位置自动胜出，无需删候选）。
func findOptimizationLog() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	candidates := []string{
		filepath.Join("docs", "knowledge", "optimization_log.md"),
		filepath.Join("docs", "archive", "optimization_log.md"),
	}
	for {
		for _, rel := range candidates {
			p := filepath.Join(dir, rel)
			if _, err := os.Stat(p); err == nil {
				return p, nil
			}
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
		return newRuntimeErrf("优化日志文档不可读 docs/knowledge|docs/archive/optimization_log.md: %v（优化记录已改为文档单一事实来源，需在仓库内运行）", err)
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
				inTable = false
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
