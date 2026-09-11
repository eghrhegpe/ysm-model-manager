// Command ccheck 扫描 Go 源码的认知复杂度 + 嵌套深度（Go 端镜像 check-complexity.ts）。
//
// 用法：
//
//	go run ./cmd/ccheck [--dir ./go] [--threshold 15] [--top 20] [--json]
//
// 默认跳过 *_test.go 与生成文件；输出按认知复杂度降序。情报型，退出码 0。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"ysm-model-manager/go/ccheck"
)

func main() {
	dir := flag.String("dir", ".", "扫描目录")
	threshold := flag.Int("threshold", 15, "🟨≥threshold（橙=2x 红=3x）")
	top := flag.Int("top", 20, "文本报告列出前 N 条")
	asJSON := flag.Bool("json", false, "JSON 输出（供 doctor/CI 消费）")
	includeTests := flag.Bool("tests", false, "是否包含 *_test.go")
	flag.Parse()

	absDir, err := filepath.Abs(*dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ccheck] 绝对路径解析失败: %v\n", err)
		os.Exit(1)
	}
	funcs, err := ccheck.ScanDir(absDir, *dir, !*includeTests)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[ccheck] 扫描失败: %v\n", err)
		os.Exit(1)
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
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(out)
		return
	}

	fmt.Printf("=== 认知复杂度扫描（%s，🟨≥%d，共 %d 个函数）===\n", *dir, *threshold, len(funcs))
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
		fmt.Printf("%s c%d/n%d  %s:%d  %s\n", mark, f.Cognitive, f.MaxNesting, f.File, f.Line, f.Name)
		n++
	}
	if len(active) == 0 {
		fmt.Println("✅ 无函数达到阈值，Go 侧复杂度在上限侧是稳的。")
	} else {
		fmt.Printf("⚠️  %d 个函数落入 🟨+（maxNesting 前 N 对应高迷宫）\n", len(active))
	}
}
