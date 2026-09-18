package cli

// perf_cli_analyzable_test.go — 「CLI 可分析的模型」判定收编为单点（ADR-262 D3 收口）。
//
// 立因（2026-09-18）：ADR-262 D3 记「三张硬编码类型表」，实际不止——审计发现 `go/cli` 里
// 同一个问题「这个文件 CLI 能不能真分析」散在四处，各写各的扩展名白名单：
//  1. `bench_concurrent.go:85`  并发基准：`ext == ".ysm"`，且无命中时**退化为取任意条目**；
//  2. `perf.go:579`            `scanFirstModel|allowedExts`（ADR 漏记的**第 4 张表**）；
//  3. `flow.go:266`            gui-flow 首模型：`ext == ".ysm"`；
//  4. `detectModelFormat`      扩展名 → 展示标签（另案，属 `format` 展示口径而非归属）。
//
// 而「可分析性」的单一事实源**早已存在**：`perfTypeManifest` / `cliAnalyzable`（perf_targets.go），
// 归属判定也早已单点：`classifyForScan`（flow.go，三段口径）。本次只把二者组合成一个谓词，
// 让四条线都走它——不新建表，只删表。
//
// ⚠️ 这不只是 DRY：`scanFirstModel` 原表把 `.vrm/.gltf/.litematic` 也算「模型」，
// 而 manifest 明说这些类型的解析器只在前端 3D adapter（CLI 拿到是空模型）。
// 它的两个消费方 `perf.go|resolveTargetModel` 与 `health.go` 都**直接把返回值喂进
// `runSingleModelBench`** → 产出「空模型数据当实测」，违反 D3 与 D8 的诚实红线。
// 故本文件的断言里，「不可分析类型不得被选中」是**行为修复**，不是等价重构。

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

// ysmLocationPath 造一个命中 registry 目录归属（location 路由）的 ysm 路径：
// ysm 的 instanceDir = config/yes_steve_model/custom，TypeByLocation 按祖先目录后缀匹配。
func ysmLocationPath(t *testing.T, name string) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "config", "yes_steve_model", "custom", name)
}

func TestCliAnalyzablePath_RegistryDriven(t *testing.T) {
	t.Parallel()
	reg := registry.LoadRegistry()
	cases := []struct {
		name string
		path string
		want bool
	}{
		// 扩展名归属：只有 .ysm 在 CLI 分析链路上（WASM 解码）
		{"ysm 扩展名", filepath.Join(t.TempDir(), "a.ysm"), true},
		// 以下类型的解析器只在前端 3D adapter —— CLI 拿到是空模型，不得当可分析
		{"vrm 不可分析", filepath.Join(t.TempDir(), "a.vrm"), false},
		{"gltf 不可分析", filepath.Join(t.TempDir(), "a.gltf"), false},
		{"litematic 不可分析", filepath.Join(t.TempDir(), "a.litematic"), false},
		{"txt 非模型", filepath.Join(t.TempDir(), "a.txt"), false},
		// location 归属优先：容器 .zip 在 ysm 目录下归 ysm，且在 CLI 分析链路上（geometry 容器解析）
		{"ysm 目录下的 zip", ysmLocationPath(t, "m.zip"), true},
		// location 归属为 CLI 不可分析类型：扩展名/容器都救不回来
		{"mmd/PMX 目录下的 pmx", filepath.Join(t.TempDir(), "mmd", "PMX", "角色.pmx"), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ext := strings.ToLower(filepath.Ext(tc.path))
			if got := cliAnalyzablePath(tc.path, ext, reg); got != tc.want {
				t.Errorf("cliAnalyzablePath(%q) = %v, 期望 %v（归属 %q）",
					tc.path, got, tc.want, classifyForScan(tc.path, ext, reg))
			}
		})
	}
}

func TestPickCliAnalyzable_FiltersEntries(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	entries := []types.ModelEntry{
		{Path: filepath.Join(dir, "a.vrm"), Name: "a.vrm", Ext: ".vrm"},
		{Path: filepath.Join(dir, "b.ysm"), Name: "b.ysm", Ext: ".ysm"},
		{Path: filepath.Join(dir, "c.gltf"), Name: "c.gltf", Ext: ".gltf"},
		{Path: filepath.Join(dir, "d.ysm"), Name: "d.ysm", Ext: ".ysm"},
	}
	got := pickCliAnalyzable(entries)
	want := []string{entries[1].Path, entries[3].Path}
	if len(got) != len(want) {
		t.Fatalf("应只留 CLI 可分析条目 %v, got %v", want, got)
	}
	// 保持扫描序（调用方决定排序/截断，本函数不做隐式重排）
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("第 %d 项应为 %q, got %q（应保持扫描序）", i, want[i], got[i])
		}
	}
}

// TestScanFirstModel_RejectsCliUnanalyzable 与「空入参/空目录」契约的断言已并入
// `perf_test.go|TestScanFirstModel`（该用例原锁住缺陷，本次就地改写为正确口径），此处不再重复。

// TestScanFirstModel_LexicographicDeterministic 目标集排序由 scanBenchTargets 单点给出
// （路径字典序）：Walk 顺序依文件系统而变，测试/AI 断言需要可复现。
func TestScanFirstModel_LexicographicDeterministic(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	// 逆序创建：若实现沿用 Walk 首命中，则会返回 z.ysm
	for _, name := range []string{"z.ysm", "a.ysm"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got, want := scanFirstModel(root), filepath.Join(root, "a.ysm"); got != want {
		t.Errorf("应为路径字典序首个, got %q want %q", got, want)
	}
}

// TestRunConcurrentBench_RejectsUnanalyzableOnly 并发基准调 AnalyzeBedrockModel，
// 仓库里只有不可分析类型时必须**如实报错**，而不是退回「取任意条目」把空模型跑成实测。
func TestRunConcurrentBench_RejectsUnanalyzableOnly(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	vrm := filepath.Join(root, "a.vrm")
	if err := os.WriteFile(vrm, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	var err error
	_ = captureOutput(t, func() {
		err = runConcurrentBench(&CmdContext{
			App:       &benchScanFakeApp{paths: []string{vrm}},
			FilesRoot: root,
			Args:      []string{"--workers", "2"},
		})
	})
	if err == nil {
		t.Fatal("只有 CLI 不可分析类型时应报错，不得静默跑空模型")
	}
	if !strings.Contains(err.Error(), "CLI 可分析") {
		t.Errorf("错误信息应说明「无可分析模型」, got %q", err.Error())
	}
}

// TestScanSummaryByType_FirstModelCliAnalyzable gui-flow 首模型同源：随清单与归属自动扩展，
// 不再自持 `ext == ".ysm"` 白名单。
func TestScanSummaryByType_FirstModelCliAnalyzable(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()

	// 只按可用性排序：不可分析类型不入首模型，可分析类型入
	_, first := scanSummaryByType([]types.ModelEntry{
		{Path: filepath.Join(dir, "a.vrm"), Name: "a.vrm", Ext: ".vrm"},
		{Path: filepath.Join(dir, "b.ysm"), Name: "b.ysm", Ext: ".ysm"},
	})
	if want := filepath.Join(dir, "b.ysm"); first != want {
		t.Errorf("首模型应为 CLI 可分析的 %q, got %q", want, first)
	}

	// 只有不可分析类型 → 无首模型（保持「未找到可分析的模型」语义）
	if _, first := scanSummaryByType([]types.ModelEntry{
		{Path: filepath.Join(dir, "a.vrm"), Name: "a.vrm", Ext: ".vrm"},
	}); first != "" {
		t.Errorf("无 CLI 可分析模型时首模型应为空, got %q", first)
	}

	// 泛化：ysm 目录下的容器 .zip 也在 CLI 分析链路上（原白名单漏掉它）
	zip := ysmLocationPath(t, "pack.zip")
	_, first = scanSummaryByType([]types.ModelEntry{{Path: zip, Name: "pack.zip", Ext: ".zip"}})
	if first != zip {
		t.Errorf("ysm 目录下的 zip 应可作首模型（容器形态在分析链路上）, got %q want %q", first, zip)
	}
}
