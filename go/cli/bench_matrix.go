// bench_matrix.go：单模型基准的目标集/矩阵 JSON 输出（原 bench_single.go 二次拆分，2026-10 文件行数治理）。
// singleBenchMatrixJSON / perfMatrixSpec / perfTypeSummary / buildMatrixPayload / buildRepoPayload——
// 目标集（--target rtype|all|repo）批量基准与结构化载荷。
package cli

import (
	"encoding/json"
	"fmt"
	"sort"
)

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
