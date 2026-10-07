// bench_single.go：单模型基准测试 harness（原 bench_concurrent.go 拆分，2026-10 文件行数治理）。
// 单模型加载基准（--target model）与结构化载荷（singleBenchJSON/benchStageJSON）。
// 2026-10 二次拆分：目标集矩阵载荷移入 bench_matrix.go；阶段名/hints 移入 bench_single_hint.go。
// 与 bench_concurrent.go 同包共用一个 perfSpecs/perfTargetParamSpecs（登记处拼接，避免逐行重复）。
// 契约锚点：singleBenchJSON/benchStageJSON/identityOnlyPayload/默认值由 tests/test_cli_gui_flow_contract.ts 钉住本文件。
package cli

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

func init() {
	RegisterCommandC("single-bench", CatPerf, "单模型加载基准测试（优化基础，单模型快=所有场景快）", runSingleBench,
		// 与 flag 定义序一致：iterations → registerPerfTargetFlags 的 target/order/rtype/model/max-models
		// → 基准三参 → format。
		// ⚠️ --target 是**目标集 selector**（model/rtype/all/repo），--model 是该 selector 下的**路径载荷**，
		// 二者不是同一个参数（旧面的 --rtype/--all-types/--top-largest 已全部并入 --target）。
		perfSpecs(
			[]ParamSpec{{Key: "iterations", Type: ParamNumber}},
			ParamSpec{Key: "baseline", Type: ParamString},
			ParamSpec{Key: "save-baseline", Type: ParamString},
			ParamSpec{Key: "threshold", Type: ParamNumber},
			ParamSpec{Key: "format", Type: ParamString},
		)...,
	)
}

type singleBenchStage struct {
	Name     string
	Duration time.Duration
	Bytes    int64
	Notes    string
	// Runtime 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）：没有归属字段，
	// 「Go / Rust / WASM / Three 的耗时构成」就是黑箱，Rust 扫描器与 WASM 解析器的收益无从度量。
	Runtime string
	// Failed 阶段失败标记（如 ① 读盘失败）：耗时分级（stageStatus）只看 ms，失败必须独立成字段，
	// 否则失败阶段会因 0ms 被判为 ok —— 全链路失败的 bench 在载荷里看起来全绿（2026-09-17 实测）。
	Failed bool
}

// runSingleBench 单模型加载基准测试 / 目标集基准测试（ADR-262 D3 修订：三旋钮正交面）。
//
// 三条出口的差异只在**目标集**：--target model → 单模型（文本/json 均可、基准可用）；
// --target rtype|all → 类型矩阵（按类型分组，每类型各取上限）；--target repo → 全库扁平排名。
// 后两者只出结构化载荷：text 模式没有「多个模型同屏比较」的呈现口径，也拒基准参数
// （基准是单模型概念——静默吞参就是让用户以为在跟基准比，其实没有）。
func runSingleBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("single-bench")
	iterations := fs.Int("iterations", 3, "重复测试次数")
	// 默认 target=model：不传 --target 时就是旧的单模型用法（须配 --model）。
	target, order, rtype, modelPath, maxModels := registerPerfTargetFlags(fs, perfTargetModel, 5,
		"目标集上限（单位 = --target 的展开单位）：rtype=该类型取几条 / all=每类型各取几条 / repo=全库扁平取几条")
	baseline := fs.String("baseline", "", "对比基准：显式 JSON 文件路径（[{name,ms}]），或哨兵 default = 标准基准槽 <用户配置根>/YSM-Model-Manager/perf-baseline.json；任一阶段退化超 --threshold 时返回失败")
	saveBaseline := fs.String("save-baseline", "", "记录基准：显式 JSON 文件路径，或哨兵 default = 标准基准槽（供后续 --baseline 对比）；与 --baseline 同用时先比后存")
	thresholdPct := fs.Float64("threshold", 50, "退化阈值百分比（默认 50），配合 --baseline 使用")
	format := fs.String("format", "text", "输出格式: text（人类可读）/ json（AI 友好）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	// 目标集互斥矩阵已收敛到 parsePerfTargetSpec（旧面 8 条守卫 → 一处）：selector/order 取值、
	// 「各 selector 只收自己那个载荷参数」、target=model 拒显式 --max-models，都在那里一次判完。
	spec, err := parsePerfTargetSpec(fs, *target, *order, *rtype, *modelPath, *maxModels, *iterations)
	if err != nil {
		return err
	}
	if *iterations <= 0 {
		return newParamErrf("--iterations 必须大于 0")
	}
	if *format != "text" && *format != "json" {
		return newParamErrf("--format 必须是 text 或 json")
	}
	if spec.Target != perfTargetModel {
		if *format != "json" {
			return newParamErrf("目标集模式（--target rtype/all/repo）仅支持 --format json（text 模式无目标集呈现口径）")
		}
		// 基准参数只在单模型路径上有意义（目标集载荷是 models[]，基准是单模型概念）。
		// 原先这三个参数在目标集模式下被**静默吞掉**——用户以为在跟基准比，其实没有：
		// 参数被吞 = 不诚实，宁可报错。（fs.Visit 精确区分「显式传入」与「默认值」。）
		if explicitMatrixBaselineFlags(fs) {
			return newParamErrf("目标集模式（--target rtype/all/repo）不支持基准参数（--baseline / --save-baseline / --threshold）：基准是单模型概念，请用 --target model 跑单模型基准")
		}
		switch spec.Target {
		case perfTargetRepo:
			// 全库扁平：不按类型分组（排序即排名，按类型归并会把这个信息弄丢）
			return runSingleBenchRepoJSON(ctx, spec)
		default:
			// 矩阵口径：按类型分组，每类型各取 spec.MaxModels 条
			return runSingleBenchMatrixJSON(ctx, spec)
		}
	}

	// --target model：目标解析（复用 perf-snapshot 的同一出口）：目录式模型折叠为 <dir>/ysm.json，
	// 下游零目录分支。传目录路径曾直接 ① 读盘失败（os.ReadFile 对目录报错），且失败被平均环节吞掉 → 载荷全绿。
	modelTarget, terr := resolveTargetModel(ctx.App, spec.ModelPath, ctx.FilesRoot)
	if terr != nil {
		return terr
	}

	// JSON 模式：静默运行，最后输出 JSON
	if *format == "json" {
		return runSingleBenchJSON(ctx, modelTarget, *iterations, *baseline, *saveBaseline, *thresholdPct)
	}

	fmt.Println("🎯 单模型加载基准测试")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   模型:     %s\n", modelTarget)
	fmt.Printf("   迭代次数: %d\n", *iterations)
	fmt.Println()
	fmt.Println("   💡 核心理念: 单模型快 = 所有场景快")
	fmt.Println("      多角色是单角色的叠加，优化单角色是基础")
	fmt.Println(strings.Repeat("=", 70))

	var allStages [][]singleBenchStage
	totalDuration := time.Duration(0)

	allStages, totalDuration = runSingleBenchSamples(ctx.App, modelTarget, ctx.FilesRoot, *iterations, func(iter int, stages []singleBenchStage) {
		if *iterations > 1 {
			fmt.Printf("\n📝 迭代 %d/%d\n", iter+1, *iterations)
		}
		printSingleModelStages(stages)
	})

	fmt.Println()
	fmt.Println(strings.Repeat("=", 70))
	fmt.Println("📊 汇总分析")
	fmt.Println(strings.Repeat("=", 70))

	avg := avgBenchStages(allStages)
	if len(allStages) == 0 {
		fmt.Println("⚠️  无基准数据（allStages 为空）")
		return nil
	}
	if *iterations > 1 {
		printAverageStages(allStages)
	} else {
		printSingleModelStages(allStages[0])
	}

	fmt.Println()
	fmt.Printf("⏱️  总耗时（%d 次迭代）: %.2fms\n", *iterations, durationMs(totalDuration))

	if len(allStages) > 0 {
		printOptimizationHints(allStages[0])
	}

	// C-1：基准对比 / 保存（供 CI 判定性能退化，复用 file-bench --baseline 语义）
	return applyBenchBaseline(*baseline, *saveBaseline, *thresholdPct, avg)
}

// singleBenchJSON 单模型基准测试 JSON 输出结构（AI 友好）
type singleBenchJSON struct {
	Model      string `json:"model"`
	Iterations int    `json:"iterations"`
	// TotalMs = N 次迭代的累计墙钟；「一次加载多久」看 PerIterationMs。
	// 旧实现只给 TotalMs，前端直接当成单次总耗时展示——迭代 N 次时虚高 N 倍。
	TotalMs        float64          `json:"total_ms"`
	PerIterationMs float64          `json:"per_iteration_ms"`
	Stages         []benchStageJSON `json:"stages"`
	Bottleneck     string           `json:"bottleneck"`
	Hints          []string         `json:"hints"`
	// UnsupportedReason 未采集阶段耗时时的**结构化**原因 token（omitempty：能采集时缺席）。
	//
	// 与 Hints 的关系：Hints 是给 CLI/AI 读的中文散文（未 i18n，**前端不渲染**）；本字段是
	// 给界面渲染的枚举——前端按 token 查三语文案，故一条记录一种语言。当前只有一个取值
	// （unsupportedReasonNoCLIParser），但**用 token 而非布尔**：将来出现第二种未采集原因
	// （如格式损坏、体积超限）时前端不改结构，只加一条 i18n 映射。
	UnsupportedReason string `json:"unsupported_reason,omitempty"`
	Format            string `json:"format"`
	SizeBytes         int64  `json:"size_bytes"`
	// FootprintBytes 参与 --order size 排名的**模型占用**（仅 size 序填；path 序 omitempty 缺席）。
	// 为什么不能拿 SizeBytes 顶替：目录式模型的 SizeBytes 是 0（identity 口径），排名依据看不见
	// 就等于不可复核——回显体量才能让读者自己验「它凭什么排第一」。
	FootprintBytes int64 `json:"footprint_bytes,omitempty"`
	// Identity 身份块（ADR-262 D2）：registry 类型 id + 相对路径限定。
	// format/size_bytes 保留在原处不动（既有消费者），rtype 才是判定口径。
	Identity perfIdentity `json:"identity"`
	// Baseline 基准对比/保存结果（ADR-262 D8）：nil = 本次未用基准参数（缺席就是缺席）。
	// 判决进载荷后，GUI 才能说出「哪个阶段退化了、退了多少」，而不是只转述一句门槛错误。
	Baseline *benchBaselineJSON `json:"baseline,omitempty"`
	// ADR-200 D5 sidecar：迁移期保留人类可读文本与 filesRoot，供前端「复制原文」与
	// respHasOutput 守卫。仅由桥接层注入（AttachSidecar），stdout 载荷不含。
	Output    string `json:"output,omitempty"`
	FilesRoot string `json:"filesRoot,omitempty"`
}

// AttachSidecar 实现 SidecarOutput（ADR-200 D5）：桥接层注入人类可读文本与 filesRoot。
// 必须指针接收者——buildJsonData 对 SetResult 传入的指针做接口断言。
func (s *singleBenchJSON) AttachSidecar(output, filesRoot string) {
	s.Output = output
	s.FilesRoot = filesRoot
}

// benchStageJSON 单个阶段 JSON 结构
type benchStageJSON struct {
	Name       string  `json:"name"`
	Ms         float64 `json:"ms"`
	Bytes      int64   `json:"bytes,omitempty"`
	Status     string  `json:"status"`
	Bottleneck bool    `json:"bottleneck"`
	Note       string  `json:"note,omitempty"`
	// Runtime 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）
	Runtime string `json:"runtime"`
	// Stats 样本统计（ADR-262 D2）：n / median_ms / p95_ms。
	// 仅实测阶段有；无样本（纯汇总路径）时为 nil —— 不伪造 n=0 的统计。
	Stats *benchStageStats `json:"stats,omitempty"`
}

// benchStageStats 阶段在多轮迭代中的样本分布（ADR-262 D2）。
//
// 此前 `stages` 只有 N 轮均值：数据其实已在手里（runSingleBenchSamples 保留全部样本），
// 却由 avgBenchStages 当场平均掉 —— 「无样本统计、无方差可言」（ADR-262 §背景 #6）。
// n 是**该阶段实际出现的次数**（阶段可因失败提前返回而缺席某轮），非迭代轮数。
type benchStageStats struct {
	N      int     `json:"n"`
	Median float64 `json:"median_ms"`
	P95    float64 `json:"p95_ms"`
}

// stagesToJSON 将平均阶段列表转换为 JSON 结构，同时识别瓶颈，并从原始样本附上分布统计。
// 两趟：先定唯一最大阶段，再单点打标——旧实现「每超过当前最大值即置 true」，
// 会把先出现的次大阶段也标成 bottleneck（可产出多个 bottleneck=true）。
// allStages 为 nil（纯汇总调用方无原始样本）时不附 stats。
func stagesToJSON(avg []singleBenchStage, allStages [][]singleBenchStage) ([]benchStageJSON, string) {
	var maxMs float64
	var bottleneckName string
	for _, s := range avg {
		if ms := msOf(s); ms > maxMs {
			maxMs = ms
			bottleneckName = s.Name
		}
	}

	stats := collectStageStats(allStages)
	stageJSON := make([]benchStageJSON, 0, len(avg))
	for _, s := range avg {
		ms := msOf(s)
		// 失败优先于耗时分级：失败阶段常是 0ms（如目录不能 ReadFile），若只按 ms 分级会被判 ok
		status := stageStatus(ms)
		if s.Failed {
			status = "failed"
		}
		var st *benchStageStats
		if got, ok := stats[s.Name]; ok {
			// 取地址前必须先拷一份：st 是 *benchStageStats，直接 &got 会指向 map 迭代变量
			snapshot := got
			st = &snapshot
		}
		stageJSON = append(stageJSON, benchStageJSON{
			Name:   s.Name,
			Ms:     ms,
			Bytes:  s.Bytes,
			Status: status,
			// 唯一瓶颈且超过「偏慢」阈值（10ms）；并列时首者胜，保证确定性
			Bottleneck: s.Name == bottleneckName && ms > 10,
			Note:       s.Notes,
			Runtime:    s.Runtime,
			Stats:      st,
		})
	}
	return stageJSON, bottleneckName
}

// collectStageStats 汇总各阶段在 N 轮迭代中的样本分布（ADR-262 D2）。
// 与 avgBenchStages 同源（同一份 allStages），不额外采集。
func collectStageStats(allStages [][]singleBenchStage) map[string]benchStageStats {
	samples := map[string][]float64{}
	for _, stages := range allStages {
		for _, s := range stages {
			samples[s.Name] = append(samples[s.Name], msOf(s))
		}
	}
	out := make(map[string]benchStageStats, len(samples))
	for name, xs := range samples {
		out[name] = benchStageStats{
			N:      len(xs),
			Median: percentileNearestRank(xs, 0.5),
			P95:    percentileNearestRank(xs, 0.95),
		}
	}
	return out
}

// percentileNearestRank 最近秩法取分位数：升序后取 ceil(p*n)-1 号样本。
//
// 选最近秩而非线性插值：默认只跑 3 轮，插值会产出「不存在的样本」（如 n=3 的 p95 内插出
// 从未实测到的值），与「数字必须来自实测」的口径冲突；最近秩保证结果必是某次真实样本。
// 副作用是它对 p 单调（两分位下标不递降）→ 结构不变量 p95 >= median 对任意 n 恒成立
// （ADR-262 D6：断言只锁结构不变量）。
func percentileNearestRank(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	cp := append([]float64(nil), xs...)
	sort.Float64s(cp)
	idx := int(math.Ceil(p*float64(len(cp)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(cp) {
		idx = len(cp) - 1
	}
	return cp[idx]
}

// benchOneModel 跑一个模型的 N 次迭代并组装单模型载荷（单模型命令与类型矩阵共用，不打印）。
// 第二返回值 = 平均阶段列表，供 --baseline 退化对比复用（避免重复采集）。
func benchOneModel(a AppService, modelPath, filesRoot string, iterations int) (singleBenchJSON, []singleBenchStage) {
	allStages, totalDuration := runSingleBenchSamples(a, modelPath, filesRoot, iterations, nil)
	avg := avgBenchStages(allStages)
	stageJSON, bottleneckName := stagesToJSON(avg, allStages)

	totalMs := durationMs(totalDuration)
	// 单次平均：AI/前端问「这个模型加载一次多久」时要的是它，而非 N 次累计
	perIterationMs := totalMs
	if iterations > 0 {
		perIterationMs = totalMs / float64(iterations)
	}
	return singleBenchJSON{
		Model:          modelPath,
		Iterations:     iterations,
		TotalMs:        totalMs,
		PerIterationMs: perIterationMs,
		Stages:         stageJSON,
		Bottleneck:     bottleneckName,
		Hints:          generateHints(avg),
		Format:         detectModelFormat(modelPath),
		// 目录式模型（ysm.json 入口）size 记 0——见 perfIdentitySize
		SizeBytes: perfIdentitySize(modelPath),
		// 身份块（ADR-262 D2）：registry 类型 id + 相对路径限定，供测试/AI 分辨真实场景类别
		Identity: buildPerfIdentity(modelPath, filesRoot, nil),
	}, avg
}

// unsupportedReasonNoCLIParser 「CLI 无该类型解析器」的 token（前端据它查三语文案）。
// 解析器只在前端 3D adapter 的类型（PMX/PMD/VRM/FBX/GLTF）走这条——不是失败，是**不在能力范围**。
const unsupportedReasonNoCLIParser = "no_cli_parser"

// identityOnlyPayload CLI 无该类型解析器时的诚实载荷：只给身份与格式，**不采集阶段耗时**
// （空模型的阶段数据不是实测，采集出来就是「数字不可信」的又一个来源）。
//
// `UnsupportedReason` 是与 `Hints` 并行的**结构化**出口（2026-09-21）：Hints 是给 CLI/AI 读的
// 中文散文，**前端不渲染**（未 i18n，英/日界面会冒中文）；但明细区需要显示「这一条为什么没有
// 阶段耗时」，此前只能靠 `len(stages)==0` 反推一句通用文案。故把原因显式成 token，
// 前端按 token 查三语文案——与 §3.7 的 `size_source` 完全同构（枚举值不随语言变）。
func identityOnlyPayload(modelPath, filesRoot, rtype string) singleBenchJSON {
	return singleBenchJSON{
		Model:             modelPath,
		Stages:            []benchStageJSON{},
		Format:            detectModelFormat(modelPath),
		Identity:          buildPerfIdentity(modelPath, filesRoot, nil),
		UnsupportedReason: unsupportedReasonNoCLIParser,
		Hints: []string{
			"⛔ CLI 无 " + rtype + " 解析器：未采集阶段耗时（解析器在前端 3D adapter，见 gui-flow 对 PMX 跳过 ④⑤⑥ 的同源口径）",
		},
	}
}

// runSingleBenchJSON 单模型基准测试 JSON 模式：静默运行，输出结构化数据
// （stdout 必须可被 json.Unmarshal 直接吃掉——人类可读文案一律不进 stdout，见 bench_baseline.go）。
