// bench_single.go：单模型基准测试 harness（原 bench_concurrent.go 拆分，2026-10 文件行数治理）。
// 单模型加载基准 / 目标集基准（--target model|rtype|all|repo）与呈现（text/json/sidecar）。
// 与 bench_concurrent.go 同包共用一个 perfSpecs/perfTargetParamSpecs（登记处拼接，避免逐行重复）。
package cli

import (
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/types/registry"
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
func runSingleBenchJSON(ctx *CmdContext, modelPath string, iterations int, baseline, saveBaseline string, thresholdPct float64) error {
	// 归一化（经 runSingleBench 进入时已是 entry path，此处幂等）：保证直接调用（测试/内部）同样吃目录
	target, terr := resolveTargetModel(ctx.App, modelPath, ctx.FilesRoot)
	if terr != nil {
		return terr
	}
	modelPath = target

	output, avg := benchOneModel(ctx.App, modelPath, ctx.FilesRoot, iterations)

	// 基准对比 / 保存：判决进载荷，**stdout 保持纯 JSON**。
	// 旧实现在此处调 compareSingleBenchBaseline —— 它把中文散文 fmt.Println 到 stdout，
	// 于是 --format json --baseline 的输出是「JSON + 中文」，AI 消费者 json.Unmarshal 必失败
	// （而本函数的契约就是「静默运行，输出结构化数据」）。
	// 基准文件本身不可用时 block=nil 且 err≠nil：**仍然**输出并 SetResult 本次基准结果
	// （规律六：错误分支也要带结构化数据），错误信息说明缺什么。
	block, degradeErr := buildBaselineJSON(baseline, saveBaseline, thresholdPct, avg)
	if block != nil {
		output.Baseline = block
	}

	data, err := json.MarshalIndent(output, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	// 双出口（ADR-200 D1/D5）：stdout 供 CLI/AI 直接消费；SetResult 让 Wails 桥的 data
	// 承载结构化对象（而非 output 文本）——前端因此无需再正则解析中文人类文案。
	fmt.Println(string(data))
	ctx.SetResult(&output)

	// D8 失败优先：退化即失败（CI 靠退出码判定）；载荷已在上面交出
	return degradeErr
}

// singleBenchMatrixJSON 多模型矩阵载荷（ADR-262 D3）：目标集由 Go 侧按 registry 类型扫描产出，
// 前端/AI 只需读 models[]，不自行挑样本、不自行判类型。
type singleBenchMatrixJSON struct {
	Spec   perfMatrixSpec    `json:"spec"`
	Models []singleBenchJSON `json:"models"`
	// ADR-200 D5 sidecar（桥接层注入）
	Output    string `json:"output,omitempty"`
	FilesRoot string `json:"filesRoot,omitempty"`
}

// AttachSidecar 实现 SidecarOutput（ADR-200 D5）。
func (m *singleBenchMatrixJSON) AttachSidecar(output, filesRoot string) {
	m.Output = output
	m.FilesRoot = filesRoot
}

// perfMatrixSpec 目标集实验规格（回显解析结果，供 AI 复盘「跑的是谁、几个、按什么排」）。
//
// 三旋钮各自独立回显（ADR-262 D3 修订）：Target=选了谁、Order=按什么排、MaxModels=取到第几。
// 旧面把三者焊进互斥 flag（all_types / top_largest），载荷里也只能逐个模式字段表达，消费者得拼。
type perfMatrixSpec struct {
	// Target 目标集 selector（model / rtype / all / repo）——恒有值
	Target string `json:"target"`
	// Order 排序键（path / size）——恒有值；size 时另看 SizeSource
	Order string `json:"order"`
	// Rtype target=rtype 时回显目标类型；target=repo/all 时为空（逐类型信息看 types[]）
	Rtype string `json:"rtype,omitempty"`
	// MaxModels 上限，**单位 = Target 的展开单位**（rtype=该类型几条 / all=每类型各几条 / repo=全库几条）
	MaxModels int `json:"max_models"`
	// Iterations 每模型重复迭代次数
	Iterations int `json:"iterations"`
	// Analyzed 实际采集了阶段耗时的模型数
	Analyzed int `json:"analyzed"`
	// Unsupported 命中类型但 CLI 无解析器、只出身份的模型数（非静默跳过：见 identityOnlyPayload）
	Unsupported int `json:"unsupported"`
	// CliAnalyzable target=rtype 时该类型是否具备 CLI 分析链路（其余看 types[].cli_analyzable）
	CliAnalyzable bool `json:"cli_analyzable"`
	// SizeSource 体量口径 token（仅 Order=size 时回显）：
	// dir_total = 目录式模型按目录内容合计、其余按文件大小（见 perfSizeSourceDirTotal）。
	// 回显口径而不是让消费者猜「这个顺序是按什么排的」——排序不可见就等于不可复核
	SizeSource string `json:"size_source,omitempty"`
	// Types 逐类型汇总（rtype/all 每类型一项；repo 只含入选模型的类型）
	Types []perfTypeSummary `json:"types"`
}

// perfTypeSummary 单类型汇总：仓库里有多少、跑了几条、清单声明该几条阶段、实际是否吻合。
type perfTypeSummary struct {
	Rtype         string `json:"rtype"`
	RtypeLabel    string `json:"rtype_label,omitempty"`
	CliAnalyzable bool   `json:"cli_analyzable"`
	// Found 仓库中该类型条目总数（截断前）
	Found int `json:"found"`
	// Analyzed / Unsupported 实际采集 / 仅出身份的模型数
	Analyzed    int `json:"analyzed"`
	Unsupported int `json:"unsupported"`
	// ExpectedStages 样本清单声明的阶段链长度。**与 StagesDeclared 配对读**：
	// StagesDeclared=false 时本字段恒为 0，那是「未声明」的零值，**不是「声明为 0 段」**——
	// 前端不得凭 0 反推「该类型没有阶段链」，须看 StagesDeclared（否则「未采集」会被渲染成「0 段」）。
	ExpectedStages int `json:"expected_stages"`
	// StagesDeclared 该类型是否在样本清单（perfTypeManifest）里登记了阶段链。
	//
	// 立因（2026-09-21）：`ExpectedStages` 的 Go 零值 0 原本兼作「未登记」与「登记为 0 段」两种含义，
	// 前端 `typeRow` 只能打补丁 `cli_analyzable ? expected_stages : "—"`——用一个字段解释另一个
	// 字段的零值。本字段把「是否声明」显式入载荷，前端据实渲染而非反推（空数据不得当实测）。
	StagesDeclared bool `json:"stages_declared"`
	// StageMismatch 可分析类型但实际阶段数与清单声明不符 —— 阶段链断裂的显式信号
	// （样本清单因此不只是文档，而是矩阵运行时的自检依据）
	StageMismatch bool `json:"stage_mismatch,omitempty"`
}

// matrixGroups 矩阵目标分组（target=rtype|all）：按 spec 收窄候选池 → 排序 → 按类型归并。
//
// 顺序要害：**排序必须在分组之前**——groupPerfTargets 只做「按类型归并 + 组内截断」，
// 组内顺序完全继承排好序的输入，排序键因此只有一个入口（orderPerfTargets）。
// 只收录仓库里真实存在的类型（空跑一堆 0 计数的类型对用户/AI 都是噪声）。
func matrixGroups(filesRoot string, spec perfTargetSpec) []perfTypeGroup {
	if filesRoot == "" {
		return nil
	}
	ts, _ := collectPerfTargets(filesRoot)
	if spec.Target == perfTargetRtype {
		ts = filterRtype(ts, spec.Rtype)
	}
	return groupPerfTargets(orderPerfTargets(ts, spec.Order), spec.MaxModels)
}

// collectBenchTarget 采集单个目标：可分析 → 真跑分析并核阶段链；不可分析 → 只出身份（不伪造阶段耗时）。
//
// 矩阵（rtype/all）与全库（repo）两条目标集共用这一条采集路径——二者的差异只在
// **选谁、按什么顺序**，不在「怎么采」。返回值：载荷、是否 unsupported、阶段链是否与清单声明不符。
func collectBenchTarget(ctx *CmdContext, path, rtype string, iterations int, entry perfTypeManifestEntry) (singleBenchJSON, bool, bool) {
	if !cliAnalyzable(rtype) { // 可分析性归 resource_types.json 声明（cliAnalyzable 单点），不再读 entry
		return identityOnlyPayload(path, ctx.FilesRoot, rtype), true, false
	}
	payload, _ := benchOneModel(ctx.App, path, ctx.FilesRoot, iterations)
	mismatch := entry.ExpectedStages > 0 && len(payload.Stages) != entry.ExpectedStages
	return payload, false, mismatch
}

// newMatrixPayload 构造矩阵载荷骨架：spec 五字段回显 + size_source 判定 + models 预分配
// （modelsCap=0 即不预分配容量）。矩阵（rtype/all）与全库（repo）两条目标集共用同一形状，
// 差异只在下游填充——原为两处逐行重复（jscpd-go 门禁：文件内自重复对）。
func newMatrixPayload(spec perfTargetSpec, modelsCap int) singleBenchMatrixJSON {
	out := singleBenchMatrixJSON{
		Spec: perfMatrixSpec{
			Target:     spec.Target,
			Order:      spec.Order,
			MaxModels:  spec.MaxModels,
			Iterations: spec.Iterations,
			Types:      []perfTypeSummary{},
		},
		Models: make([]singleBenchJSON, 0, modelsCap),
	}
	if spec.SizeOrdered() {
		out.Spec.SizeSource = perfSizeSourceDirTotal
	}
	return out
}

// buildMatrixPayload 把类型分组采集为矩阵载荷（--target rtype 与 all 共用同一形状，差异全在 spec）。
func buildMatrixPayload(ctx *CmdContext, spec perfTargetSpec, groups []perfTypeGroup) singleBenchMatrixJSON {
	out := newMatrixPayload(spec, 0)
	for _, g := range groups {
		entry := perfTypeManifest[g.Rtype]
		sum := perfTypeSummary{
			Rtype:          g.Rtype,
			RtypeLabel:     rtypeDisplayName(g.Rtype),
			CliAnalyzable:  cliAnalyzable(g.Rtype),
			Found:          g.Found,
			StagesDeclared: stagesDeclared(g.Rtype),
			ExpectedStages: entry.ExpectedStages,
		}
		for _, t := range g.Targets {
			payload, unsupported, mismatch := collectBenchTarget(ctx, t, g.Rtype, spec.Iterations, entry)
			// 回填体量：排序依据可见 = 可复核。仅 order=size 时 g.Footprints 才有值
			// （path 序不统计目录体量，那笔开销不该为它付）——0 被 omitempty 吞掉，不凭空多一行。
			payload.FootprintBytes = g.Footprints[t]
			if mismatch {
				sum.StageMismatch = true
			}
			out.Models = append(out.Models, payload)
			if unsupported {
				sum.Unsupported++
			} else {
				sum.Analyzed++
			}
		}
		out.Spec.Analyzed += sum.Analyzed
		out.Spec.Unsupported += sum.Unsupported
		out.Spec.Types = append(out.Spec.Types, sum)
	}
	if spec.Target == perfTargetRtype && len(groups) == 1 {
		out.Spec.Rtype = groups[0].Rtype
		out.Spec.CliAnalyzable = cliAnalyzable(groups[0].Rtype)
	}
	return out
}

// buildRepoPayload 全库扁平目标集载荷（--target repo）：models[] 严格按 spec.Order 的顺序
// （repo 的意义就在「谁最X」，按类型归并会把这个信息弄丢），types[] 仍给逐类型汇总
// （含全库未截断的 found）。
func buildRepoPayload(ctx *CmdContext, spec perfTargetSpec, ranked []perfTarget, foundByType map[string]int) singleBenchMatrixJSON {
	out := newMatrixPayload(spec, len(ranked))
	sums := make(map[string]*perfTypeSummary)
	order := make([]string, 0, len(ranked))
	for _, t := range ranked {
		entry := perfTypeManifest[t.Rtype]
		sum, seen := sums[t.Rtype]
		if !seen {
			sum = &perfTypeSummary{
				Rtype:          t.Rtype,
				RtypeLabel:     rtypeDisplayName(t.Rtype),
				CliAnalyzable:  cliAnalyzable(t.Rtype),
				Found:          foundByType[t.Rtype],
				StagesDeclared: stagesDeclared(t.Rtype),
				ExpectedStages: entry.ExpectedStages,
			}
			sums[t.Rtype] = sum
			order = append(order, t.Rtype)
		}
		payload, unsupported, mismatch := collectBenchTarget(ctx, t.Path, t.Rtype, spec.Iterations, entry)
		// 回填体量：报告里看得见排名依据，读者才能自己验「它凭什么排第一」。
		// 仅 order=size 时有值（path 序不统计目录体量，那笔开销不该为它付）——0 被 omitempty 吞掉。
		payload.FootprintBytes = t.Footprint
		if mismatch {
			sum.StageMismatch = true
		}
		out.Models = append(out.Models, payload)
		if unsupported {
			sum.Unsupported++
		} else {
			sum.Analyzed++
		}
	}
	// types[] 按类型名升序（与矩阵同约定）：确定性不依赖入选顺序
	sort.Strings(order)
	for _, rt := range order {
		sum := sums[rt]
		out.Spec.Types = append(out.Spec.Types, *sum)
		out.Spec.Analyzed += sum.Analyzed
		out.Spec.Unsupported += sum.Unsupported
	}
	return out
}

// emitMatrix 打印矩阵载荷并走双出口（ADR-200 D1/D5）。
func emitMatrix(ctx *CmdContext, out singleBenchMatrixJSON) error {
	data, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	fmt.Println(string(data))
	ctx.SetResult(&out)
	return nil
}

// runSingleBenchMatrixJSON 矩阵目标集（--target rtype|all）：按类型分组（类型字典序、组内按 --order），
// 逐个采集（或仅出身份）。rtype/all 共用这一条路径，差异全在 spec 里。
func runSingleBenchMatrixJSON(ctx *CmdContext, spec perfTargetSpec) error {
	if ctx.FilesRoot == "" {
		return newParamErrf("--target %s 目标集需要 --files-root 指定仓库根", spec.Target)
	}
	groups := matrixGroups(ctx.FilesRoot, spec)
	if len(groups) == 0 {
		if spec.Target == perfTargetRtype {
			return newRuntimeErrf("仓库中未找到 rtype=%s 的模型（root=%s）", spec.Rtype, ctx.FilesRoot)
		}
		return newRuntimeErrf("仓库中未发现任何模型（root=%s）", ctx.FilesRoot)
	}
	return emitMatrix(ctx, buildMatrixPayload(ctx, spec, groups))
}

// runSingleBenchRepoJSON 全库扁平目标集（--target repo）：候选池是**全库**（含 CLI 不可分析类型，
// 由载荷标 unsupported，不静默剔掉），排序即排名 → 取上限 → 逐个采集。
func runSingleBenchRepoJSON(ctx *CmdContext, spec perfTargetSpec) error {
	if ctx.FilesRoot == "" {
		return newParamErrf("--target repo 需要 --files-root 指定仓库根")
	}
	ranked, foundByType := repoPerfTargets(ctx.FilesRoot, spec.Order, spec.MaxModels)
	if len(ranked) == 0 {
		return newRuntimeErrf("仓库中未发现任何模型（root=%s）", ctx.FilesRoot)
	}
	return emitMatrix(ctx, buildRepoPayload(ctx, spec, ranked, foundByType))
}

// detectModelFormat 根据文件扩展名检测模型格式
func detectModelFormat(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".ysm":
		return "YSM"
	case ".pmx":
		return "PMX"
	case ".pmd":
		return "PMD"
	case ".vrm":
		return "VRM"
	case ".gltf", ".glb":
		return "GLTF"
	case ".litematic":
		return "Litematic"
	case ".json":
		// 目录式模型的入口是 ysm.json：按扩展名报 "JSON" 会与 identity.rtype=ysm 在同一份
		// 报告里打架（用户/AI 看到「类型 YSM、格式 JSON」）。此处按唯一谓词 IsYsmEntryJSON 归位。
		if registry.IsYsmEntryJSON(filepath.Base(path)) {
			return "YSM"
		}
		return "JSON"
	case ".zip":
		return "Pack"
	default:
		return "Unknown"
	}
}

// parseStageName 阶段②「模型解析」的名称按格式切换——
// 历史硬编码「② JSON 解析」对 MMD(.pmx/.pmd 二进制解析)构成误导（用户以为 JSON 慢，实为 PMX 解析慢）。
func parseStageName(path string) string {
	switch detectModelFormat(path) {
	case "YSM", "JSON":
		return "② JSON 解析"
	case "PMX", "PMD":
		return "② PMX 解析"
	default:
		return "② 模型解析"
	}
}

// generateHints 根据各阶段耗时生成 AI 友好的优化建议
func generateHints(stages []singleBenchStage) []string {
	var hints []string
	for _, s := range stages {
		ms := durationMs(s.Duration)
		if ms <= 10 {
			continue
		}
		switch s.Name {
		case "① 文件读取":
			hints = append(hints, fmt.Sprintf("文件读取 %.1fms：检查磁盘速度，考虑缓存或 SSD", ms))
		case "② JSON 解析", "② PMX 解析", "② 模型解析":
			hints = append(hints, fmt.Sprintf("%s %.1fms：模型可能过大，考虑精简数据或使用更快的解析器", s.Name, ms))
		case "③ 数据验证":
			hints = append(hints, fmt.Sprintf("数据验证 %.1fms：考虑延迟非关键验证", ms))
		case "④ 几何数据准备":
			hints = append(hints, fmt.Sprintf("几何数据准备 %.1fms：考虑简化模型或 LOD", ms))
		case "⑤ 纹理数据准备":
			hints = append(hints, fmt.Sprintf("纹理数据准备 %.1fms：使用 KTX2/DDS 压缩可减少 60-70%%", ms))
		case "⑥ 序列化模拟":
			hints = append(hints, fmt.Sprintf("序列化 %.1fms：减少数据量或使用更高效的序列化（Wails binding 走 JSON）", ms))
		case "⑦ 缓存检查":
			hints = append(hints, fmt.Sprintf("缓存检查 %.1fms：确保纹理缓存正常命中", ms))
		}
	}
	if len(hints) == 0 {
		hints = append(hints, "所有阶段 <10ms，性能良好")
	}
	return hints
}

// benchStageMs single-bench 基准 JSON 条目（[{name,ms}]）
