// Command ccheck 扫描 Go 源码的认知复杂度 + 嵌套深度（Go 端镜像 check-complexity.ts）。
//
// 用法：
//
//	go run ./cmd/ccheck [--dir ./go] [--threshold 15] [--top 20] [--json]
//
// 默认跳过 *_test.go 与生成文件；输出按认知复杂度降序。情报型，退出码 0。
//
// 可测性（2026-10-08）：逻辑收敛到 run(args, stdout, stderr) int——os.Exit 只发生在
// main() 里（run 返回退出码），cmd/ccheck/main_test.go 可直测不 spawn 子进程。
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	"ysm-model-manager/go/ccheck"
)

// exitFail / exitOK 常量：run 返回码与 main 的 os.Exit 语义一致，便于测试断言。
const (
	exitFail = 1
	exitOK   = 0
)

// run 解析 argv、执行扫描并输出结果。返回进程退出码（0 正常，1 参数/扫描失败）。
// stdout 用于结果输出，stderr 用于错误；测试可注入 bytes.Buffer。
func run(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("ccheck", flag.ContinueOnError)
	dir := fs.String("dir", ".", "扫描目录")
	threshold := fs.Int("threshold", 15, "🟨≥threshold（橙=2x 红=3x）")
	top := fs.Int("top", 20, "文本报告列出前 N 条")
	asJSON := fs.Bool("json", false, "JSON 输出（供 doctor/CI 消费）")
	includeTests := fs.Bool("tests", false, "是否包含 *_test.go")
	if err := fs.Parse(args); err != nil {
		// `--help`/`-h` 走 ErrHelp → 帮助已打印到 stdout/stderr，按惯例 exit 0
		if errors.Is(err, flag.ErrHelp) {
			return exitOK
		}
		return exitFail
	}

	absDir, err := filepath.Abs(*dir)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "[ccheck] 绝对路径解析失败: %v\n", err)
		return exitFail
	}
	// 目录前置校验：ScanDir 对不存在的根目录会静默返回空（WalkDir 顶层 err 被吞），
	// 显式 Stat 让「--dir 打错」立即失败而非输出一份空报告（假绿灯）。
	if info, serr := os.Stat(absDir); serr != nil || !info.IsDir() {
		_, _ = fmt.Fprintf(stderr, "[ccheck] 目录不存在或不是目录: %s\n", absDir)
		return exitFail
	}
	funcs, err := ccheck.ScanDir(absDir, *dir, !*includeTests)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "[ccheck] 扫描失败: %v\n", err)
		return exitFail
	}

	var active []ccheck.FuncResult
	for _, f := range funcs {
		if f.Cognitive >= *threshold {
			active = append(active, f)
		}
	}
	sort.SliceStable(active, func(i, j int) bool {
		if active[i].Cognitive != active[j].Cognitive {
			return active[i].Cognitive > active[j].Cognitive
		}
		return active[i].MaxNesting > active[j].MaxNesting
	})

	if *asJSON {
		out := struct {
			Dir       string              `json:"dir"`
			Threshold int                 `json:"threshold"`
			Funcs     int                 `json:"funcs"`
			Active    int                 `json:"active"`
			Top       []ccheck.FuncResult `json:"top"`
		}{Dir: *dir, Threshold: *threshold, Funcs: len(funcs), Active: len(active)}
		n := *top
		// 双侧夹取：负 --top 直接 panic slice bounds（JSON 消费路径 fail-open），夹到 [0, len]
		if n < 0 {
			n = 0
		}
		if len(active) < n {
			n = len(active)
		}
		out.Top = active[:n]
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(out)
		return exitOK
	}

	_, _ = fmt.Fprintf(stdout, "=== 认知复杂度扫描（%s，🟨≥%d，共 %d 个函数）===\n", *dir, *threshold, len(funcs))
	n := 0
	for _, f := range active {
		if n >= *top {
			break
		}
		mark := "🟨"
		if f.Cognitive >= *threshold*3 {
			mark = "🟥"
		} else if f.Cognitive >= *threshold*2 {
			mark = "🟧"
		}
		_, _ = fmt.Fprintf(stdout, "%s c%d/n%d  %s:%d  %s\n", mark, f.Cognitive, f.MaxNesting, f.File, f.Line, f.Name)
		n++
	}
	if len(active) == 0 {
		_, _ = fmt.Fprintln(stdout, "✅ 无函数达到阈值，Go 侧复杂度在上限侧是稳的。")
	} else {
		_, _ = fmt.Fprintf(stdout, "⚠️  %d 个函数落入 🟨+（maxNesting 前 N 对应高迷宫）\n", len(active))
	}
	return exitOK
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}
