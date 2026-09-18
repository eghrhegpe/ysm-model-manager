package cli

// perf_target_set.go — 目标集三旋钮（ADR-262 D3 修订）：selector × order × limit。
//
// 为什么把三个维度拆开，而不是继续加互斥 flag：
//
//	旧面 = `--model` / `--rtype` / `--all-types` / `--top-largest` 四选一 + `--max-models`。
//	其中 `--top-largest N` 把「体量降序」与「取 N 条」焊死，于是它与 `--max-models` 语义重叠、
//	只能靠互斥打补丁（旧守卫原话：「两者都表示取几条」）；而 `--all-types` 只是 selector 的
//	一个取值，却单独立了 flag。前端为这套面付出的代价是「一个数字控件承载两种含义」——
//	标签只能跟着模式改义（`syncPerfCountLabel` 即该缺陷的账单）。
//	新面 = `--target` × `--order` × `--max-models`：三者正交、跨命令同名同义，互斥矩阵消失。
//
// 唯一需要记住的规则：
//
//	**`--max-models` 的单位 = `--target` 的展开单位**：
//	  model → 单条（上限无意义，显式传入即报错，不静默吞参）
//	  rtype → 该类型 N 条；all → 每类型各 N 条；repo → 全库扁平 N 条。
//
// 于是 `--target repo --order size --max-models 2` 与旧 `--top-largest 2` 逐字等价，
// 而 `--target all --order size --max-models 2`（每类最重的 2 个）是旧面表达不出的新组合。
//
// 本文件同时是「候选池」的唯一枚举入口——旧面有三份并行实现（`scanBenchTargets` /
// `scanTargetsGrouped` / `scanTopLargestTargets`，各自 `ScanEntries` + `classifyForScan`），
// 三旋钮若各写一份就会变成第四、第五份。故：**一个枚举 + 一个排序 + 薄 selector**。

import (
	"flag"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/types/registry"
)

// 目标集 selector 取值（跨命令同名同义）。
const (
	// perfTargetModel 单模型（配 --model；上限无意义）
	perfTargetModel = "model"
	// perfTargetRtype 某类型的全部分模型（配 --rtype；上限 = 该类型取几条）
	perfTargetRtype = "rtype"
	// perfTargetAll 全部类型（矩阵口径：每类型各取 --max-models 条）
	perfTargetAll = "all"
	// perfTargetRepo 全库扁平（不按类型分组：全库取 --max-models 条）
	perfTargetRepo = "repo"
)

// 排序键取值。
const (
	// perfOrderPath 路径升序——Walk 顺序依文件系统而变，路径序才可复现
	perfOrderPath = "path"
	// perfOrderSize 体量降序（同体量路径升序）；口径 token 见 perfSizeSourceDirTotal
	perfOrderSize = "size"
)

// perfTargetSpec 解析后的目标集声明（parse 阶段校验完，命令只消费不再判）。
type perfTargetSpec struct {
	// Target selector 取值（model/rtype/all/repo）
	Target string
	// Order 排序键（path/size）
	Order string
	// Rtype target=rtype 时的类型 id
	Rtype string
	// ModelPath target=model 时的模型路径
	ModelPath string
	// MaxModels 上限（单位 = Target 的展开单位）；target=model 时**恒为 0**（归一化，无上限语义）
	MaxModels int
	// MaxModelsExplicit 调用方是否显式传了 --max-models（target=model 时据此拒绝吞参）
	MaxModelsExplicit bool
	// Iterations 各命令共用的重复次数（由调用方读取后填入，便于一并传递）
	Iterations int
}

// IsMatrix 是否为「矩阵式」目标集（按类型分组、只出结构化载荷）。
func (s perfTargetSpec) IsMatrix() bool {
	return s.Target == perfTargetRtype || s.Target == perfTargetAll
}

// SizeOrdered 是否按体量排序（决定 spec 是否回显 size_source 与逐条 footprint_bytes）。
func (s perfTargetSpec) SizeOrdered() bool {
	return s.Order == perfOrderSize
}

// perfTarget 一条候选目标。**不预先计算体量**：体量要走盘统计目录，只有 order=size 时才值得付。
type perfTarget struct {
	Path  string
	Rtype string
	// EntrySize 扫描器给的字节数（文件本身 / ysm.json 清单），体量统计失败时的回落值
	EntrySize int64
	// Footprint 体量（仅 order=size 的排序阶段固化；0 表示未计算）
	//
	// 为什么固化而不是回读：排序键必须与回显值**同源**——回读会二次统计（目录在两次之间
	// 变化即自相矛盾），而「排序依据不可见 = 不可复核」。
	Footprint int64
}

// footprint 单条体量：目录式模型（入口是 ysm.json 清单）→ 目录内容合计；其余 → 文件字节数。
// 口径与旧 --top-largest 完全一致（`targetFootprint` 的同一规则，此处按 perfTarget 承载）。
func (t perfTarget) computeFootprint() int64 {
	return targetFootprint(t.Path, t.EntrySize)
}

// collectPerfTargets 全库候选池 + 逐类型总数（**未截断**）。唯一枚举入口。
//
// 候选池是**全库**（含 CLI 不可分析类型）：ADR 问的是「最大的模型是谁」，PMX 恰好最大时把它
// 静默剔掉，用户看到的是一份空报告而没有任何解释——由命令按能力过滤/标注才是诚实的答法。
// 返回的第二个值服务既有语义：`types[].found` 要的是「一共有几条」而非「入选几条」。
func collectPerfTargets(filesRoot string) ([]perfTarget, map[string]int) {
	if filesRoot == "" {
		return nil, nil
	}
	reg := registry.LoadRegistry()
	found := make(map[string]int)
	var out []perfTarget
	for _, e := range scanner.ScanEntries(filesRoot) {
		rtype := classifyForScan(e.Path, strings.ToLower(filepath.Ext(e.Path)), reg)
		found[rtype]++
		out = append(out, perfTarget{Path: e.Path, Rtype: rtype, EntrySize: e.Size})
	}
	return out, found
}

// orderPerfTargets 排序（唯一排序入口）：path → 路径升序；size → 体量降序、同体量路径升序。
//
// 体量在排序过程中**固化进 Footprint**：排序键与回显值同源（见 perfTarget.Footprint 注释）。
// 返回新切片，不改动入参。
func orderPerfTargets(ts []perfTarget, order string) []perfTarget {
	out := append([]perfTarget(nil), ts...)
	if order == perfOrderSize {
		for i := range out {
			out[i].Footprint = out[i].computeFootprint()
		}
		sort.SliceStable(out, func(i, j int) bool {
			if out[i].Footprint != out[j].Footprint {
				return out[i].Footprint > out[j].Footprint
			}
			// tie-break：体量相同按路径升序——ADR 未定义次序，取确定性者为定
			return out[i].Path < out[j].Path
		})
		return out
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// filterAnalyzable 只保留 CLI 可分析的条目（命令能力过滤，非存在性过滤）。
//
// 用于「拿去做 CLI 分析的命令」（并发基准调 AnalyzeBedrockModel）：类型不在分析链路上时会
// 拿到空模型、各阶段耗时全是空数据——那是把空数据当实测，比少跑几个模型更糟。
func filterAnalyzable(ts []perfTarget) []perfTarget {
	out := make([]perfTarget, 0, len(ts))
	for _, t := range ts {
		if cliAnalyzable(t.Rtype) {
			out = append(out, t)
		}
	}
	return out
}

// filterRtype 只保留指定类型（target=rtype）。
func filterRtype(ts []perfTarget, rtype string) []perfTarget {
	out := make([]perfTarget, 0, len(ts))
	for _, t := range ts {
		if t.Rtype == rtype {
			out = append(out, t)
		}
	}
	return out
}

// capFlat 扁平截断（repo/model 口径：全库 N 条）。
func capFlat(ts []perfTarget, n int) []perfTarget {
	if n > 0 && len(ts) > n {
		return ts[:n]
	}
	return ts
}

// repoPerfTargets `--target repo` 的展开：全库扁平 → 排序 → 截断（单位 = 全库）。
//
// 单独成函数而不是让调用方拼三原语：这是**生产路径与测试共用的同一份组合**
// （旧面这里同时存在「测试打的 scanTopLargestTargets」与「生产直接拼三原语」两条写法，
// 于是测试并不能证明生产在跑什么）。`--target repo --order size --max-models N`
// 即旧 `--top-largest N`，逐字等价（ADR-262 D3 修订，已用换 flag 前的黄金输出核对）。
//
// 注意与并发基准的区别：本函数**不过滤**可分析性（single-bench 的 repo 池含不可分析类型，
// 只出身份并标 unsupported）；并发基准要 `filterAnalyzable` **且必须在截断之前**过滤——
// 否则「N 个可分析模型」会变成「前 N 个里恰好可分析的几个」。过滤权归命令，故不塞进本函数。
func repoPerfTargets(filesRoot, order string, maxModels int) ([]perfTarget, map[string]int) {
	if filesRoot == "" || maxModels < 1 {
		return nil, nil
	}
	ts, found := collectPerfTargets(filesRoot)
	return capFlat(orderPerfTargets(ts, order), maxModels), found
}

// perfTypeGroup 按类型归并后的目标集（矩阵口径：rtype / all）。
type perfTypeGroup struct {
	Rtype string
	// Found 仓库中该类型条目总数（未截断），供矩阵回显「跑了几个 / 一共有几个」
	Found int
	// Targets 实际取样（已排序、已按单位截断）
	Targets []string
	// Footprints 逐条体量（仅 order=size 时填充）：排序依据可见 = 可复核
	Footprints map[string]int64
}

// groupPerfTargets 按类型归并（类型字典序）+ 组内按上限截断（单位 = 类型）。
//
// 只收录**仓库里真实存在**的类型：空跑一堆 0 计数的类型对用户/AI 都是噪声。
// 需要 order=size 时应在分组**之前**排序，使组内天然按体量降序（保持「排序键唯一」）。
func groupPerfTargets(ts []perfTarget, maxPerType int) []perfTypeGroup {
	byType := map[string][]perfTarget{}
	for _, t := range ts {
		byType[t.Rtype] = append(byType[t.Rtype], t)
	}
	types := make([]string, 0, len(byType))
	for t := range byType {
		types = append(types, t)
	}
	sort.Strings(types)
	out := make([]perfTypeGroup, 0, len(types))
	for _, t := range types {
		paths := byType[t]
		targets := paths
		if maxPerType > 0 && len(targets) > maxPerType {
			targets = targets[:maxPerType]
		}
		g := perfTypeGroup{Rtype: t, Found: len(paths), Targets: pathsOf(targets)}
		for _, tg := range targets {
			if tg.Footprint > 0 {
				if g.Footprints == nil {
					g.Footprints = make(map[string]int64, len(targets))
				}
				g.Footprints[tg.Path] = tg.Footprint
			}
		}
		out = append(out, g)
	}
	return out
}

// pathsOf 抽出路径（供只关心「跑哪些」的消费方使用，保持既有 []string 契约）。
func pathsOf(ts []perfTarget) []string {
	out := make([]string, 0, len(ts))
	for _, t := range ts {
		out = append(out, t.Path)
	}
	return out
}

// registerPerfTargetFlags 注册三旋钮到命令的 FlagSet。
//
// 两命令共享同一套参数面（同名同义），差异只在**默认值**：single-bench 默认 model（须给 --model）、
// concurrent-bench 默认 repo（全库扁平——它就是「拿一批模型去并发跑」，没有单模型以外的分组语义）。
func registerPerfTargetFlags(fs *flag.FlagSet, defaultTarget string, defaultMaxModels int, maxModelsHelp string) (
	target, order, rtype, modelPath *string, maxModels *int,
) {
	target = fs.String("target", defaultTarget,
		"目标集: model（单模型，配 --model）/ rtype（某类型，配 --rtype）/ all（每类型各取 --max-models 条）/ repo（全库扁平取 --max-models 条）")
	order = fs.String("order", perfOrderPath, "目标集排序: path（路径升序，确定性）/ size（体量降序，目录式按目录内容合计）")
	rtype = fs.String("rtype", "", "目标集类型 id（registry 类型，如 ysm；配合 --target rtype）")
	modelPath = fs.String("model", "", "目标集单模型路径（配合 --target model；目录式模型可传解包目录或 <dir>/ysm.json）")
	maxModels = fs.Int("max-models", defaultMaxModels, maxModelsHelp)
	return target, order, rtype, modelPath, maxModels
}

// parsePerfTargetSpec 校验并归一化目标集声明。
//
// 互斥矩阵在这里收敛成「每条一句」：
//   - selector 取值合法 + order 取值合法；
//   - 各 selector 只接受自己那个 payload 参数（否则报错，不静默忽略）；
//   - target=model 时显式传 --max-models 一律报错——上限对单模型无意义，吞掉它就是不诚实。
//
// 返回的 spec 已可直接消费：命令侧不再判「哪个 flag 给了」。
//
// 不接 defaultTarget 形参：各命令的默认值由 `registerPerfTargetFlags` 在 flag 定义处给出
// （`--target` 缺省即 model / concurrent-bench 缺省即 repo），解析阶段再收一份默认值只会
// 变成第二个事实源——默认值写两处，漂移只是时间问题。
func parsePerfTargetSpec(fs *flag.FlagSet, target, order, rtype, modelPath string, maxModels int, iterations int) (perfTargetSpec, error) {
	spec := perfTargetSpec{
		Target: target, Order: order, Rtype: rtype, ModelPath: modelPath,
		MaxModels: maxModels, MaxModelsExplicit: explicitFlagSet(fs, "max-models"), Iterations: iterations,
	}
	switch target {
	case perfTargetModel, perfTargetRtype, perfTargetAll, perfTargetRepo:
	default:
		return spec, newParamErrf("--target 必须是 model / rtype / all / repo 之一，当前: %q", target)
	}
	switch order {
	case perfOrderPath, perfOrderSize:
	default:
		return spec, newParamErrf("--order 必须是 path 或 size，当前: %q", order)
	}
	if rtype != "" && target != perfTargetRtype {
		return spec, newParamErrf("--rtype 只在 --target rtype 下有意义（当前 --target %s）：目标集类型要写进 --target", target)
	}
	if modelPath != "" && target != perfTargetModel {
		return spec, newParamErrf("--model 只在 --target model 下有意义（当前 --target %s）：多模型目标集请用 --target rtype/all/repo", target)
	}
	if target == perfTargetRtype && rtype == "" {
		return spec, newParamErrf("--target rtype 需要 --rtype <类型 id> 指定类型")
	}
	if target == perfTargetModel {
		// 「显式传入的上限」先于「缺 --model」判：--max-models 在 target=model 下**恒**无意义，
		// 不因同时缺 --model 而被掩盖（否则用户补上 --model 才撞见第二条错，一次教训拆成两轮）。
		if spec.MaxModelsExplicit {
			return spec, newParamErrf("--target model 下 --max-models 无意义（单模型只有一条）：上限请用 --target rtype/all/repo")
		}
		// 归一化为 0：flag 默认值（single-bench 5 / concurrent-bench 20）留在 spec 里就是一颗哑弹——
		// 载荷照抄出去就成了「上限 20 的单模型目标集」，而 capFlat(ts, 20) 看起来又像真的在限。
		// 归一化后消费方无需再判 selector，`MaxModels == 0` 即「本目标集没有上限语义」。
		spec.MaxModels = 0
		if modelPath == "" {
			return spec, newParamErrf("--target model 需要 --model <路径> 指定目标模型")
		}
	} else if maxModels < 1 {
		return spec, newParamErrf("--max-models 必须大于 0（单位 = --target 的展开单位），当前: %d", maxModels)
	}
	return spec, nil
}
