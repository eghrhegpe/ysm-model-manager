package cli

// bench_internal_test.go — single-bench 结构化载荷契约（ADR-200 D1/D5 + ADR-262）。
//
// 锁四件事：
//  1. JSON 字段名与前端 SingleBenchPayload（perf-single-bench.ts）逐字对齐——漂移会让面板静默空白；
//  2. total_ms（N 次迭代累计）与 per_iteration_ms（单次平均）双口径齐备——旧实现只有累计，
//     前端把它当「一次加载总耗时」展示（「6ms 谁信」的机制性来源之一）；
//  3. identity 身份块（ADR-262 D2）：registry 类型 id + relPath 路径限定——否则报告分不清
//     「真实场景里这是什么模型」（.zip 被 14 类型声明，扩展名推不出归属）；
//  4. AttachSidecar 注入 output/filesRoot：桥的 data 同时满足结构化消费与「复制原文」。
//
// 与 flow_internal_test.go 同范式（gui-flow 先例）。

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types/registry"
)

func TestSingleBenchJSON_JSONShape(t *testing.T) {
	s := &singleBenchJSON{
		Model:          "./ysm/player.ysm",
		Iterations:     3,
		TotalMs:        6554.7,
		PerIterationMs: 2184.9,
		Stages: []benchStageJSON{
			{Name: "② JSON 解析", Ms: 1993.66, Status: "bottleneck", Bottleneck: true,
				Runtime: "go", Stats: &benchStageStats{N: 3, Median: 1900, P95: 2200}},
		},
		Bottleneck: "② JSON 解析",
		Hints:      []string{"🔴 瓶颈: JSON 解析"},
		Format:     "YSM",
		SizeBytes:  123456,
		Identity: perfIdentity{
			Rtype:       "ysm",
			RtypeSource: "extension",
			RtypeLabel:  "YSM 模型",
			FilesRoot:   "/repo",
			RelPath:     "ysm/player.ysm",
			AbsPath:     "/repo/ysm/player.ysm",
		},
		// 基准块（ADR-262 D8）：判决入载荷后，GUI 才能说出「哪个阶段退化、退了多少」
		Baseline: &benchBaselineJSON{
			SavedTo: "/cfg/perf-baseline.json",
			Diff: &perfBaselineDiff{
				Path:         "/cfg/perf-baseline.json",
				ThresholdPct: 50,
				NoiseFloorMs: 1,
				Verdict:      baselineVerdictOK,
				Stages: []perfBaselineStageDiff{
					{Name: "② JSON 解析", BaseMs: 1900, NowMs: 1993.66, DeltaPct: 4.9, Verdict: stageVerdictSlower},
				},
			},
		},
	}

	b, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal 失败: %v", err)
	}
	raw := string(b)
	// stdout 载荷不含 sidecar：AttachSidecar 由桥接层在命令返回后注入（ADR-200 D5）
	if strings.Contains(raw, `"output"`) {
		t.Errorf("stdout 载荷不应含 output（sidecar 由桥注入）: %s", raw)
	}
	for _, want := range []string{
		`"model"`, `"iterations"`, `"total_ms"`, `"per_iteration_ms"`,
		`"stages"`, `"name"`, `"ms"`, `"status"`, `"bottleneck"`,
		`"hints"`, `"format"`, `"size_bytes"`,
		// 阶段归属与样本统计（ADR-262 D2）
		`"runtime"`, `"stats"`, `"n"`, `"median_ms"`, `"p95_ms"`,
		// 身份块（ADR-262 D2）
		`"identity"`, `"rtype"`, `"rtype_source"`, `"rtype_label"`, `"relPath"`, `"absPath"`,
		// 基准判决（ADR-262 D8）——degraded 带 omitempty，非退化时缺席（缺席即缺席）
		`"baseline"`, `"saved_to"`, `"diff"`, `"threshold_pct"`, `"noise_floor_ms"`,
		`"verdict"`, `"base_ms"`, `"now_ms"`, `"delta_pct"`,
	} {
		if !strings.Contains(raw, want) {
			t.Errorf("JSON 缺少字段 %s: %s", want, raw)
		}
	}

	// 桥接层路径：SetResult 后 buildJsonData 必须承载结构化对象本体（而非 output 文本）
	ctx := &CmdContext{}
	ctx.SetResult(s)
	data := buildJsonData(ctx, "raw-json-text", "/models")
	got, ok := data.(*singleBenchJSON)
	if !ok {
		t.Fatalf("data 应为 *singleBenchJSON, got %T", data)
	}
	if got.Output != "raw-json-text" || got.FilesRoot != "/models" {
		t.Errorf("sidecar 未注入: output=%q filesRoot=%q", got.Output, got.FilesRoot)
	}
	withSidecar, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal 失败: %v", err)
	}
	for _, want := range []string{`"output"`, `"filesRoot"`} {
		if !strings.Contains(string(withSidecar), want) {
			t.Errorf("桥载荷缺少 %s: %s", want, withSidecar)
		}
	}
}

// TestBuildPerfIdentity_Sources 身份块三段来源（ADR-262 D2）必须与 classifyForScan 同口径：
// 目录归属 > 扩展名 > 容器兜底。这正是不新增第四张类型表、且报告能分辨真实场景类别的依据。
func TestBuildPerfIdentity_Sources(t *testing.T) {
	t.Parallel()
	reg := registry.LoadRegistry()
	root := filepath.Join(string(filepath.Separator), "repo")

	cases := []struct {
		name       string
		path       string
		wantRtype  string
		wantSource string
		wantRel    string
		wantForm   string
	}{
		{
			// 目录归属优先：MMD 子类型共享 .vpd/.vmd/.zip，扩展名推不出归属
			name: "location/MMD 容器的目录归属", path: filepath.Join(root, "mmd", "PMX", "角色包.zip"),
			wantRtype: "EntityPlayer", wantSource: "location", wantRel: "mmd/PMX/角色包.zip", wantForm: "file",
		},
		{
			// 深目录优先（比 EntityPlayer 更深的自有 storageSubDir）
			name: "location/深目录优先", path: filepath.Join(root, "mmd", "PMX", "DefaultMorph", "内嵌.vpd"),
			wantRtype: "DefaultMorph", wantSource: "location", wantRel: "mmd/PMX/DefaultMorph/内嵌.vpd", wantForm: "file",
		},
		{
			// .ysm 无 location 命中（instanceDir 是 config/yes_steve_model/custom）→ 扩展名消歧
			name: "extension/.ysm 扩展名消歧", path: filepath.Join(root, "ysm", "模型A.ysm"),
			wantRtype: "ysm", wantSource: "extension", wantRel: "ysm/模型A.ysm", wantForm: "file",
		},
		{
			// 目录式模型的入口 ysm.json：形态 dir（打包形态不可能以 ysm.json 结尾）
			name: "dir/解包目录入口", path: filepath.Join(root, "ysm", "模型B", "ysm.json"),
			wantRtype: "ysm", wantSource: "extension", wantRel: "ysm/模型B/ysm.json", wantForm: "dir",
		},
		{
			// 容器兜底：.zip 被 14 类型声明，无 location 命中时诚实标 container（不猜）
			name: "container/共享扩展名兜底", path: filepath.Join(root, "whatever", "x.zip"),
			wantRtype: "container", wantSource: "container", wantRel: "whatever/x.zip", wantForm: "file",
		},
	}
	for _, tc := range cases {
		got := buildPerfIdentity(tc.path, root, reg)
		if got.Rtype != tc.wantRtype || got.RtypeSource != tc.wantSource {
			t.Errorf("%s: buildPerfIdentity = %s/%s, 期望 %s/%s",
				tc.name, got.Rtype, got.RtypeSource, tc.wantRtype, tc.wantSource)
		}
		if got.Form != tc.wantForm {
			t.Errorf("%s: form = %q, 期望 %q", tc.name, got.Form, tc.wantForm)
		}
		if got.RelPath != filepath.ToSlash(tc.wantRel) {
			t.Errorf("%s: relPath = %q, 期望 %q", tc.name, got.RelPath, filepath.ToSlash(tc.wantRel))
		}
		if !filepath.IsAbs(got.AbsPath) {
			t.Errorf("%s: absPath 不是绝对路径: %q", tc.name, got.AbsPath)
		}
		if got.FilesRoot != root {
			t.Errorf("%s: filesRoot 应原样透传, got %q", tc.name, got.FilesRoot)
		}
	}
}

// TestBuildPerfIdentity_RelPathOutsideRoot 仓库根之外的路径不能报错，回落原样路径。
func TestBuildPerfIdentity_RelPathOutsideRoot(t *testing.T) {
	t.Parallel()
	root := filepath.Join(string(filepath.Separator), "repo")
	outside := filepath.Join(string(filepath.Separator), "elsewhere", "model.ysm")
	got := buildPerfIdentity(outside, root, nil)
	if got.RelPath == "" {
		t.Error("relPath 不应为空（无法求相对时应回落原样路径）")
	}
	if !strings.Contains(got.RelPath, "elsewhere") {
		t.Errorf("仓库根外路径应回落原样路径, got %q", got.RelPath)
	}
}

// TestBuildPerfIdentity_LabelFromRegistry 显示名必须取自 registry（前端不得自建类型映射）。
func TestBuildPerfIdentity_LabelFromRegistry(t *testing.T) {
	t.Parallel()
	root := filepath.Join(string(filepath.Separator), "repo")
	got := buildPerfIdentity(filepath.Join(root, "ysm", "模型A.ysm"), root, nil)
	if got.Rtype != "ysm" || got.RtypeLabel != "YSM 模型" {
		t.Errorf("类型显示名应来自 registry: rtype=%q label=%q", got.Rtype, got.RtypeLabel)
	}
}
