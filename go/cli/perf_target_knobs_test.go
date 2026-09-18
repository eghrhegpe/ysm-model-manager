package cli

// perf_target_knobs_test.go — 目标集三旋钮原语的直接单测（ADR-262 D3 修订）。
//
// 为什么单独立一个文件：三个旧函数退化成适配器后仍有既有测试兜底，但**新出现的这一层**
// （selector 校验矩阵 / 排序 / 分组 / 截断）没有任何直接覆盖——它恰好是「互斥矩阵消失」
// 与「上限单位 = target 展开单位」两条主张的承重墙。
//
// 全部用合成数据（非 ysm.json 路径 → 体量直接取 EntrySize），不触碰磁盘：这一层是纯逻辑，
// 拿临时目录当夹具只会让测试变慢且掩盖断言焦点。

import (
	"flag"
	"strings"
	"testing"
)

// newKnobsFlagSet 造一套与命令侧同形的 flag（含显式性判定所需的真实 FlagSet）。
func newKnobsFlagSet(t *testing.T, args ...string) (*flag.FlagSet, perfTargetSpec, error) {
	t.Helper()
	fs := flag.NewFlagSet("knobs", flag.ContinueOnError)
	target, order, rtype, modelPath, maxModels := registerPerfTargetFlags(fs, perfTargetModel, 5, "上限")
	iterations := fs.Int("iterations", 3, "迭代次数")
	if err := fs.Parse(args); err != nil {
		t.Fatalf("flag 解析失败: %v", err)
	}
	spec, err := parsePerfTargetSpec(fs, *target, *order, *rtype, *modelPath, *maxModels, *iterations)
	return fs, spec, err
}

// TestKnobsSpec_ValidationMatrix 锁住「各 selector 只接受自己那个 payload 参数」的校验矩阵。
//
// 旧面用 8 条互斥守卫表达同一件事；新面靠「配对校验 + 上限单位规则」表达。表格即契约：
// 每一行都是「用户会真的这么传」的形态，而不是构造出来的边界。
func TestKnobsSpec_ValidationMatrix(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		wantErr string // 期望错误里必须出现的子串（空 = 期望通过）
		want    perfTargetSpec
	}{
		{
			name:    "model 缺 --model 报错",
			args:    []string{},
			wantErr: "--target model 需要 --model",
		},
		{
			name:    "model 显式传上限必须报错（不静默吞参）",
			args:    []string{"--model", "a.pmx", "--max-models", "3"},
			wantErr: "无意义",
		},
		{
			name: "model 正常（默认 target）",
			args: []string{"--model", "a.pmx"},
			want: perfTargetSpec{Target: perfTargetModel, Order: perfOrderPath, ModelPath: "a.pmx"},
		},
		{
			name: "rtype 正常",
			args: []string{"--target", "rtype", "--rtype", "ysm", "--max-models", "2"},
			want: perfTargetSpec{Target: perfTargetRtype, Order: perfOrderPath, Rtype: "ysm", MaxModels: 2},
		},
		{
			name:    "rtype 缺 --rtype 报错",
			args:    []string{"--target", "rtype"},
			wantErr: "--target rtype 需要 --rtype",
		},
		{
			name:    "repo 带上 --rtype 报错（参数只在对应 selector 下有义）",
			args:    []string{"--target", "repo", "--rtype", "ysm"},
			wantErr: "--rtype 只在 --target rtype 下有意义",
		},
		{
			name:    "all 带上 --model 报错",
			args:    []string{"--target", "all", "--model", "a.pmx"},
			wantErr: "--model 只在 --target model 下有意义",
		},
		{
			name: "repo + size 正常（= 旧 --top-largest）",
			args: []string{"--target", "repo", "--order", "size", "--max-models", "2"},
			want: perfTargetSpec{Target: perfTargetRepo, Order: perfOrderSize, MaxModels: 2},
		},
		{
			name:    "target 取值非法",
			args:    []string{"--target", "largest"},
			wantErr: "--target 必须是",
		},
		{
			name:    "order 取值非法",
			args:    []string{"--model", "a.pmx", "--order", "mtime"},
			wantErr: "--order 必须是",
		},
		{
			name:    "repo 上限必须为正",
			args:    []string{"--target", "repo", "--max-models", "0"},
			wantErr: "--max-models 必须大于 0",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, spec, err := newKnobsFlagSet(t, tc.args...)
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("期望报错含 %q，实际通过（spec=%+v）", tc.wantErr, spec)
				}
				if !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("期望报错含 %q，实际: %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("期望通过，实际报错: %v", err)
			}
			if spec.Target != tc.want.Target || spec.Order != tc.want.Order ||
				spec.Rtype != tc.want.Rtype || spec.ModelPath != tc.want.ModelPath ||
				spec.MaxModels != tc.want.MaxModels {
				t.Fatalf("spec 不符:\n 期望 %+v\n 实际 %+v", tc.want, spec)
			}
		})
	}
}

// TestKnobsSpec_ExplicitMaxModelsDetected 锁「显式性判定」本身：
// 默认值 5 与用户显式传 --max-models 5 必须被区分开——model 模式拒的是**显式传入**，
// 不是「值等于默认值」。这里错了就会变成「单模型基准莫名报错」。
func TestKnobsSpec_ExplicitMaxModelsDetected(t *testing.T) {
	if _, spec, err := newKnobsFlagSet(t, "--model", "a.pmx"); err != nil || spec.MaxModelsExplicit {
		t.Fatalf("未传 --max-models 时不该判为显式: err=%v explicit=%v", err, spec.MaxModelsExplicit)
	}
	_, spec, err := newKnobsFlagSet(t, "--target", "repo", "--max-models", "5")
	if err != nil {
		t.Fatalf("repo + 显式 5 应通过: %v", err)
	}
	if !spec.MaxModelsExplicit {
		t.Fatal("显式传 --max-models 5 未被判为显式")
	}
}

// TestKnobsOrder_PathDeterministic 路径序是确定性契约（Walk 顺序依文件系统而变，不可依赖）。
func TestKnobsOrder_PathDeterministic(t *testing.T) {
	in := []perfTarget{
		{Path: "b/ysm.json", Rtype: "ysm", EntrySize: 10},
		{Path: "a/pmx.pmx", Rtype: "pmx", EntrySize: 999},
		{Path: "c/c.pmx", Rtype: "pmx", EntrySize: 1},
	}
	got := pathsOf(orderPerfTargets(in, perfOrderPath))
	want := []string{"a/pmx.pmx", "b/ysm.json", "c/c.pmx"}
	if len(got) != len(want) {
		t.Fatalf("长度不符: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("路径序不符:\n 期望 %v\n 实际 %v", want, got)
		}
	}
}

// TestKnobsOrder_SizeDescTieBreakPathAndFootprintFrozen 体量降序 + 同体量路径升序，
// 且体量在排序时**固化进 Footprint**（排序键与回显值同源：回读会二次统计、目录一变即自相矛盾）。
func TestKnobsOrder_SizeDescTieBreakPathAndFootprintFrozen(t *testing.T) {
	in := []perfTarget{
		{Path: "b.pmx", Rtype: "pmx", EntrySize: 100},
		{Path: "a.pmx", Rtype: "pmx", EntrySize: 100},
		{Path: "big.pmx", Rtype: "pmx", EntrySize: 500},
	}
	got := orderPerfTargets(in, perfOrderSize)
	want := []string{"big.pmx", "a.pmx", "b.pmx"}
	for i := range want {
		if got[i].Path != want[i] {
			t.Fatalf("体量序/同体量路径序不符:\n 期望 %v\n 实际 %v", want, pathsOf(got))
		}
	}
	if got[0].Footprint != 500 || got[1].Footprint != 100 {
		t.Fatalf("体量未固化进 Footprint: %+v", got)
	}
	if in[0].Footprint != 0 {
		t.Fatal("排序不应改动入参（否则调用方持有的切片被就地污染）")
	}
}

// TestKnobsGroup_PerTypeCapAndUntruncatedFound 矩阵口径：单位 = 类型。
// `Found` 必须是**未截断**总数——否则「跑了 2 个 / 一共 30 个」这种信息会消失。
func TestKnobsGroup_PerTypeCapAndUntruncatedFound(t *testing.T) {
	ts := orderPerfTargets([]perfTarget{
		{Path: "ysm/a.json", Rtype: "ysm", EntrySize: 3},
		{Path: "ysm/b.json", Rtype: "ysm", EntrySize: 2},
		{Path: "ysm/c.json", Rtype: "ysm", EntrySize: 1},
		{Path: "pmx/x.pmx", Rtype: "pmx", EntrySize: 9},
	}, perfOrderSize)
	groups := groupPerfTargets(ts, 2)
	if len(groups) != 2 {
		t.Fatalf("应有两组（仅收录真实存在的类型），实际 %d", len(groups))
	}
	if groups[0].Rtype != "pmx" || groups[1].Rtype != "ysm" {
		t.Fatalf("类型应按字典序: %s, %s", groups[0].Rtype, groups[1].Rtype)
	}
	if groups[1].Found != 3 {
		t.Fatalf("Found 应为未截断总数 3，实际 %d", groups[1].Found)
	}
	if got := groups[1].Targets; len(got) != 2 || got[0] != "ysm/a.json" {
		t.Fatalf("组内应按体量降序取前 2: %v", got)
	}
	// 组内体量随分组带出：排序依据可见 = 可复核
	if groups[1].Footprints["ysm/a.json"] != 3 {
		t.Fatalf("组内体量未带出: %+v", groups[1].Footprints)
	}
}

// TestKnobsCap_FlatUnit 扁平口径：单位 = 全库（repo）。
func TestKnobsCap_FlatUnit(t *testing.T) {
	ts := []perfTarget{{Path: "a"}, {Path: "b"}, {Path: "c"}}
	if got := capFlat(ts, 2); len(got) != 2 || got[1].Path != "b" {
		t.Fatalf("扁平截断不符: %v", pathsOf(got))
	}
	if got := capFlat(ts, 0); len(got) != 3 {
		t.Fatalf("上限 0 时不该截断（0 = 未设上限，不是取 0 条）: %v", pathsOf(got))
	}
}

// TestKnobsFilter_AnalyzableIsCommandCapability 过滤是**命令能力**而非存在性：
// 并发基准调 AnalyzeBedrockModel，喂不可分析类型 = 空模型 = 垃圾数据。
func TestKnobsFilter_AnalyzableIsCommandCapability(t *testing.T) {
	ts := []perfTarget{
		{Path: "a/ysm.json", Rtype: "ysm"},
		{Path: "b.pmx", Rtype: "pmx"},
	}
	if got := filterAnalyzable(ts); len(got) != 1 || got[0].Rtype != "ysm" {
		t.Fatalf("可分析过滤不符: %+v", got)
	}
	if got := filterRtype(ts, "pmx"); len(got) != 1 || got[0].Path != "b.pmx" {
		t.Fatalf("类型过滤不符: %+v", got)
	}
}
