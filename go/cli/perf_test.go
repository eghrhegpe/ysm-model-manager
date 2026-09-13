package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ===== perf-log 解析层 =====

func TestParseOptimizationEntries_ParsesTableAndTrimsCommitBackticks(t *testing.T) {
	t.Parallel()
	lines := []string{
		"# 优化日志",
		"",
		"| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |",
		"|---|---|---|---|---|---|",
		"| 2026-09-01 | 扫描 | 首扫慢 | 增量缓存 | -40% | `abc1234` |",
		"| 2026-09-02 | 渲染 | 掉帧 | rAF 切片 | 流畅 | def5678 |",
		"",
		"## 其他段落",
		"| 日期 | 领域 | 问题 | 做了什么 | 效果 | 提交 |",
		"| x | x | x | x | x | `should_not_parse` |",
	}
	entries := parseOptimizationEntries(lines)
	// 空行终止当前表格；但后续再次出现表头行会重新开启解析（实现语义：表头为锚）
	if len(entries) != 3 {
		t.Fatalf("应解析 3 条记录（第二段表头重新开启）, got %d", len(entries))
	}
	if entries[0].commit != "abc1234" {
		t.Errorf("commit 反引号应被清理, got %q", entries[0].commit)
	}
	if entries[1].commit != "def5678" || entries[1].area != "渲染" {
		t.Errorf("第二条字段错位: %+v", entries[1])
	}
	if entries[2].commit != "should_not_parse" {
		t.Errorf("第二段表格应被解析: %+v", entries[2])
	}
}

func TestParseOptimizationEntries_NoTable(t *testing.T) {
	t.Parallel()
	if got := parseOptimizationEntries([]string{"", "正文没有表格"}); len(got) != 0 {
		t.Errorf("无表格应返回空, got %+v", got)
	}
}

func TestSplitTableRowFields(t *testing.T) {
	t.Parallel()
	cols := splitTableRow("| a | b b | c |")
	if len(cols) != 3 || cols[0] != "a" || cols[1] != "b b" || cols[2] != "c" {
		t.Errorf("拆分/去空格不符: %+v", cols)
	}
}

func TestExtractBulletSectionStopsAtNextHeader(t *testing.T) {
	t.Parallel()
	lines := []string{
		"## 当前瓶颈",
		"- 瓶颈一",
		"- 瓶颈二",
		"## 关键指标",
		"- 不应收集",
	}
	got := extractBulletSection(lines, "当前瓶颈")
	if len(got) != 2 || got[0] != "瓶颈一" || got[1] != "瓶颈二" {
		t.Errorf("应在下一个 ## 标题处停止: %+v", got)
	}
	if got := extractBulletSection(lines, "不存在的段落"); len(got) != 0 {
		t.Errorf("未知段落应返回空: %+v", got)
	}
}

func TestExtractTableSection_SkipsHeader(t *testing.T) {
	t.Parallel()
	lines := []string{
		"## 关键指标",
		"| 指标 | 值 | 单位 | 备注 |",
		"|---|---|---|---|",
		"| 首扫 | 100 | ms | 含哈希 |",
	}
	got := extractTableSection(lines, "关键指标")
	if len(got) != 1 || got[0] != "首扫 | 100 | ms | 含哈希" {
		t.Errorf("应跳过表头与分隔行只取数据行: %+v", got)
	}
}

func TestWrapLineLength(t *testing.T) {
	t.Parallel()
	if got := wrap("short", 72, "  "); got != "short" {
		t.Errorf("短文本原样返回, got %q", got)
	}
	long := strings.Repeat("word ", 30) // 150 字符，含尾空格
	got := wrap(long, 40, "\t")
	for _, line := range strings.Split(got, "\n") {
		if len(line) > 40 {
			t.Errorf("折行后每行不应超过 maxLen: %q (len=%d)", line, len(line))
		}
	}
	if !strings.HasPrefix(strings.SplitN(got, "\n", 2)[1], "\t") {
		t.Errorf("续行应带缩进: %q", got)
	}
}

// ===== perf-snapshot 组件层 =====

func TestResolveTargetModel_ExplicitWins(t *testing.T) {
	t.Parallel()
	got, err := resolveTargetModel("/explicit/model.ysm", "/root")
	if err != nil || got != "/explicit/model.ysm" {
		t.Errorf("显式 --model 应直返, got %q err %v", got, err)
	}
}

func TestResolveTargetModel_ScansFirst(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	want := filepath.Join(root, "a.ysm")
	if err := os.WriteFile(want, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "readme.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := resolveTargetModel("", root)
	if err != nil || got != want {
		t.Errorf("应自动选中第一个模型 %s, got %q err %v", want, got, err)
	}
}

func TestResolveTargetModel_EmptyRootErrors(t *testing.T) {
	t.Parallel()
	if _, err := resolveTargetModel("", ""); err == nil {
		t.Fatal("空 filesRoot 且无 --model 应报错")
	}
}

func TestGetModelSize(t *testing.T) {
	t.Parallel()
	p := filepath.Join(t.TempDir(), "m.ysm")
	if err := os.WriteFile(p, []byte("12345"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := getModelSize(p); got != 5 {
		t.Errorf("应返回文件大小 5, got %d", got)
	}
	if got := getModelSize(filepath.Join(t.TempDir(), "nope.ysm")); got != 0 {
		t.Errorf("不存在的文件应返回 0, got %d", got)
	}
}

func TestFormatLoadingHint(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"PMX":       "PMX 格式",
		"PMD":       "PMX 格式",
		"VRM":       "VRM/GLTF",
		"GLTF":      "VRM/GLTF",
		"YSM":       "Go WASM 预计算",
		"Litematic": "BoxGeometry",
		"UNKNOWN":   "",
	}
	for format, want := range cases {
		if got := formatLoadingHint(format); !strings.Contains(got, want) || (want == "" && got != "") {
			t.Errorf("formatLoadingHint(%q) = %q, 期望含 %q", format, got, want)
		}
	}
}

func TestBuildPerfDiagnostics(t *testing.T) {
	t.Parallel()
	unhealthy := &cacheStatsJSON{FileCount: 0, Healthy: false}
	stages := []benchStageJSON{
		{Name: "① 文件读取", Ms: 150},
		{Name: "② JSON 解析", Ms: 60},
	}
	diag := buildPerfDiagnostics("PMX", 200*1024*1024, unhealthy, stages)

	var hasBottleneck, hasCacheWarn, hasSizeWarn bool
	for _, d := range diag {
		switch {
		case d.Level == "bottleneck":
			hasBottleneck = true
		case d.Level == "warn" && d.Area == "cache":
			hasCacheWarn = true
		case d.Level == "warn" && d.Area == "size":
			hasSizeWarn = true
		}
	}
	if !hasBottleneck {
		t.Errorf(">100ms 阶段应产出 bottleneck 诊断: %+v", diag)
	}
	if !hasCacheWarn {
		t.Errorf("空缓存应产出 cache 警告: %+v", diag)
	}
	if !hasSizeWarn {
		t.Errorf("PMX >100MB 应产出 size 警告: %+v", diag)
	}
}

func TestBuildPerfRecommendations(t *testing.T) {
	t.Parallel()
	stages := []benchStageJSON{
		{Name: "① 文件读取", Ms: 200},
		{Name: "① 快得忽略", Ms: 5}, // <=10ms 应跳过
	}
	recs := buildPerfRecommendations("YSM", stages)
	if len(recs) == 0 {
		t.Fatal("文件读取 200ms 应产出建议")
	}
	if recs[0].Priority != "high" || recs[0].Area != "文件读取" {
		t.Errorf("首条应为文件读取 high 建议: %+v", recs[0])
	}
	hasYSM := false
	for _, r := range recs {
		if r.Area == "loading" && strings.Contains(r.Action, "YSM") {
			hasYSM = true
		}
	}
	if !hasYSM {
		t.Errorf("YSM 格式应附带 loading 建议: %+v", recs)
	}
}

func TestGenerateSnapshotSummary(t *testing.T) {
	t.Parallel()
	bench := &singleBenchJSON{TotalMs: 12.5, Bottleneck: "② JSON 解析"}
	cache := &cacheStatsJSON{FileCount: 3, TotalSize: 2048}
	sum := generateSnapshotSummary(bench, cache, "YSM")
	for _, want := range []string{"总耗时 12.50ms", "当前瓶颈: ② JSON 解析", "格式: YSM", "缓存: 3 个文件"} {
		if !strings.Contains(sum, want) {
			t.Errorf("摘要应含 %q: %q", want, sum)
		}
	}
}

func TestScanFirstModel(t *testing.T) {
	t.Parallel()
	if got := scanFirstModel(""); got != "" {
		t.Errorf("空 root 应返回空, got %q", got)
	}
	root := t.TempDir()
	if got := scanFirstModel(root); got != "" {
		t.Errorf("空目录应返回空, got %q", got)
	}
	want := filepath.Join(root, "b.vrm")
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(want, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := scanFirstModel(root); got != want {
		t.Errorf("应跳过 .txt 命中 .vrm: got %q", got)
	}
}
