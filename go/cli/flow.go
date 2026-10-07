// flow.go：gui-flow 命令主流程与结构化载荷类型（原 flow.go 拆分，2026-10 文件行数治理）。
// 2026-10 拆分：原 781 行按职责分为 flow.go（本文件：类型 + runGUIFlow 主流程）/
// flow_phases.go（各 runPhase* 实现）/ flow_report.go（数据准备 + 渲染估算 + 报告）。
// 契约锚点：guiFlowStageItem / guiFlowStructured 的 json tag 由 tests/test_cli_gui_flow_contract.ts 钉住本文件。
package cli

import (
	"fmt"
	"strings"
	"time"

	"ysm-model-manager/go/scanner"
)

func init() {
	RegisterCommandC("gui-flow", CatPerf, "模拟 GUI 完整加载流程（配置→扫描→加载→渲染预估）", runGUIFlow,
		ParamSpec{Key: "model", Type: ParamString},
		ParamSpec{Key: "verbose", Type: ParamBool},
	)
}

// guiFlowResult GUI 流程各阶段结果
type guiFlowResult struct {
	Stage       string
	Duration    time.Duration
	Success     bool
	Description string
	// FirstModel 机器可读的首个可分析模型路径——曾塞进 Description 由下游反解析
	// 「首个模型:」文案 token（改个 emoji 就断），结构化直传
	FirstModel string
	// AnalyzableCandidates ② 产出的有序 CLI 可分析候选路径（与 FirstModel 同源，不再另立挑选器）；
	// ③ 在首个候选解析不出几何时按此顺延（见 perf_targets.go|firstWithGeometry）。
	AnalyzableCandidates []string
	// ModelCount ② 模型扫描到的条目总数（0 = 仓库里真的没有模型）。与 ByType 同源结构化留档：
	// ③ 的「有模型但都不在分析链路上」分支据此如实转述，**不从 Description 反解析**
	// （「人类可读输出不是内部 API」——本文件既有教训）。
	ModelCount int
	// ByType ② 的类型分布（注册表类型 id → 数量，如 {"blueprint": 3}）
	ByType map[string]int
	// Kind 阶段性质：measured（实测，默认）| estimated（估算，如 ⑥ 渲染预估）。
	// ADR-262 D2：估算与实测必须显式区分，不能靠描述文字里的一句「估算」来暗示。
	Kind string
	// Estimated 该阶段内含的**估算**耗时（⑤ 的 IPC 传输、⑥ 的首帧），不计入 total_ms。
	Estimated time.Duration
	// Note 估算依赖的假设/公式（D2 要求估算显式标注来源），实测阶段留空
	Note string
	// Runtime 阶段运行归属（go|wasm|js|three，ADR-262 D2）。由装配点打上（withRuntime），
	// 不逐个 return 字面量重复书写。② 模型扫描填**实际扫描后端**（scanner.ScanBackend，恒 "go"），
	// ⑥ 渲染预估归 three（它是 Three.js 首帧的估算，估算性质由 Kind 承载）。
	Runtime string
}

// guiFlowStageItem 单阶段结构化结果（ADR-200 D2：gui-flow 为首批结构化命令）。
// 前端消费已随 gui-flow 面板下线退役（a1e26419d，ADR-278：UI 层拆除、Go 命令保留）；
// 本载荷现供 CLI 人类终端（printFlowReport）与 gui-flow-gate 无头验证替身消费。
type guiFlowStageItem struct {
	Status string   `json:"status"` // "✅" / "❌"
	Name   string   `json:"name"`
	Ms     float64  `json:"ms"`
	Kind   string   `json:"kind"` // measured | estimated
	Desc   []string `json:"desc"`
	// EstimatedMs 估算成分（不计入 total_ms）
	EstimatedMs float64 `json:"estimated_ms,omitempty"`
	// Note 估算假设/公式
	Note string `json:"note,omitempty"`
	// Runtime 阶段运行归属（go|wasm|js|three，ADR-262 D2）
	Runtime string `json:"runtime"`
}

// guiFlowStructured gui-flow --json 结构化载荷（ADR-200 D1/D5）：
// Data 优先承载本对象；output/filesRoot 迁移期保留（Sidecar 注入，标 deprecated），
// 兼容前端 respHasOutput 守卫与复制原文功能。
type guiFlowStructured struct {
	Stages  []guiFlowStageItem `json:"stages"`
	TotalMs float64            `json:"total_ms"`
	// EstimatedMs 各阶段估算成分合计（ADR-262 D2）：**不计入 total_ms**，展示时分开呈现
	EstimatedMs float64 `json:"estimated_ms,omitempty"`
	Failed      bool    `json:"failed"`
	Output      string  `json:"output,omitempty"`
	FilesRoot   string  `json:"filesRoot,omitempty"`
}

// AttachSidecar 实现 SidecarOutput（ADR-200 D5）：由 buildJsonData 在 --json 响应时注入。
func (g *guiFlowStructured) AttachSidecar(output, filesRoot string) {
	g.Output = output
	g.FilesRoot = filesRoot
}

// buildGuiFlowStructured 由阶段结果构造结构化载荷。
// 在 printFlowReport 之前调用：即使汇总报错（有阶段失败），结构化明细也已就位，
// --json 错误分支同样带回（规律六）。
func buildGuiFlowStructured(results []guiFlowResult, totalDuration time.Duration) *guiFlowStructured {
	items := make([]guiFlowStageItem, 0, len(results))
	failed := false
	var estimatedTotal time.Duration
	for _, r := range results {
		if !r.Success {
			failed = true
		}
		// 空 Kind = 实测：绝大多数阶段不改动即正确，只有估算阶段需要显式声明
		kind := r.Kind
		if kind == "" {
			kind = "measured"
		}
		estimatedTotal += r.Estimated
		items = append(items, guiFlowStageItem{
			Status:      map[bool]string{true: "✅", false: "❌"}[r.Success],
			Name:        r.Stage,
			Ms:          durationMs(r.Duration),
			Kind:        kind,
			Desc:        splitDescLines(r.Description),
			EstimatedMs: float64(r.Estimated.Nanoseconds()) / 1e6,
			Note:        r.Note,
			Runtime:     r.Runtime,
		})
	}
	return &guiFlowStructured{
		Stages:      items,
		TotalMs:     durationMs(totalDuration),
		EstimatedMs: durationMs(estimatedTotal),
		Failed:      failed,
	}
}

// splitDescLines 将阶段描述按行拆分（去空行、去行首缩进），供前端逐行渲染。
func splitDescLines(desc string) []string {
	var lines []string
	for _, line := range strings.Split(desc, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	return lines
}

// 阶段运行归属常量（ADR-262 D2）。
//
// gui-flow 的每个阶段归属由**装配点**按“它调了哪个阶段函数”确定，而不是让各阶段函数
// 在自己每个 return 字面量里重复书写（漏一个就是一个无归属阶段——归属缺失比归属错更难发现）。
const (
	// guiFlowRuntimeGo Go 侧阶段：配置加载 / 模型分析 / 纹理缓存 / 数据准备
	guiFlowRuntimeGo = "go"
	// guiFlowRuntimeThree ⑥ 渲染预估：它估的是 Three.js 首帧（无渲染管线，估的性质由 Kind 承载）
	guiFlowRuntimeThree = "three"
)

// withRuntime 给阶段结果打上运行归属（ADR-262 D2）。
func withRuntime(r guiFlowResult, runtime string) guiFlowResult {
	r.Runtime = runtime
	return r
}

// runGUIFlow 模拟 GUI 完整加载流程
func runGUIFlow(ctx *CmdContext) error {
	fs := newCmdFlagSet("gui-flow")
	modelPath := fs.String("model", "", "指定模型路径（可选，不填则用第一个）")
	verbose := fs.Bool("verbose", false, "详细输出每个阶段的细节")
	filesRoot := ctx.FilesRoot
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	fmt.Println("🎮 GUI 流程模拟器")
	fmt.Println(strings.Repeat("=", 70))
	fmt.Printf("   根目录: %s\n", filesRoot)
	fmt.Printf("   模型:   %s\n", map[bool]string{true: *modelPath, false: "(自动选择)"}[*modelPath != ""])
	fmt.Println(strings.Repeat("=", 70))

	var results []guiFlowResult
	totalStart := time.Now()

	// ============ Phase 1: 配置加载 ============
	results = append(results, withRuntime(runPhaseConfigLoad(ctx.App), guiFlowRuntimeGo))

	// ============ Phase 2: 模型扫描 ============
	// 扫描归属取 scanner 的构建期事实（rust_backend 构建下是 Rust），不硬编码 go——
	// 这正是「Rust 扫描器收益可被度量」的落点（ADR-262 D2）。
	results = append(results, withRuntime(runPhaseModelScan(ctx.App, filesRoot), scanner.ScanBackend))

	// 如果指定了模型，使用它；否则用扫描阶段的结构化 FirstModel
	// （不再从 Description 文案反解析「首个模型:」token——人类可读
	// 输出不是内部 API）。
	//
	// --model 显式指定时**不做顺延**（用户点名要那个模型，换成别的就是答非所问）；
	// 自动挑选时按 ② 的有序候选顺延——类型只保证「CLI 有该类型的解析链路」，
	// 不保证该条目含几何（音效包/纯资源包按目录归属与真模型同类）。
	explicitModel := *modelPath != ""
	targetModel := *modelPath
	var scan guiFlowResult
	if !explicitModel && len(results) > 0 {
		scan = results[len(results)-1]
		if scan.Success {
			targetModel = scan.FirstModel
		}
	}

	// ============ Phase 3: 模型分析（Go 侧）============
	// 模型只分析一次，③⑤⑥ 共用（原实现 ⑤⑥ 各自再调 AnalyzeBedrockModel，
	// 同一份分析被计 3 次耗时——⑤⑥ 的阶段耗时因此不是自己的工作量的度量）
	if targetModel != "" {
		analyzeResult, model, analyzedPath := runPhaseModelAnalyzeTarget(ctx.App, scan, targetModel, explicitModel)
		// 顺延命中后把 targetModel 换到**真正被分析**的那个：④ 的纹理哈希按它取
		// （`runPhaseTextureCache(targetModel)`），不回写就会「模型换了、④ 还在算旧文件」。
		targetModel = analyzedPath
		results = append(results, withRuntime(analyzeResult, guiFlowRuntimeGo))

		// ④⑤⑥（纹理缓存/数据准备/渲染预估）全部从**分析出来的模型**派生，
		// 故门控依据是「③ 有没有真产出模型」，而不是扩展名。
		// 原实现按 `ext != ".pmx" && ext != ".pmd"` 门控，使 VRM/FBX/GLTF/litematic
		// 与损坏的 `.ysm` 在一份空 `types.BedrockModel{}` 上跑出三个阶段——
		// 那是**空模型数据当实测**（ADR-262 D3/D8）。③ 已如实告知限制或失败，
		// 此处不再产出派生阶段（按类型门控挡不住「损坏的 ysm」那一类）。
		// 顺延后 targetModel 已是**真正分析成功**的那个（与 model 同一次分析），④⑤⑥ 一律跑在它上面。
		if hasGeometry(model) {
			// ============ Phase 4: 纹理缓存检查 ============
			results = append(results, withRuntime(runPhaseTextureCache(targetModel), guiFlowRuntimeGo))

			// ============ Phase 5: 数据准备（IPC 传输估算）============
			results = append(results, withRuntime(runPhaseDataPrep(model, targetModel), guiFlowRuntimeGo))

			// ============ Phase 6: 渲染预估（无渲染管线，纯估算）============
			if *verbose {
				results = append(results, withRuntime(runPhaseRenderEstimate(model, targetModel), guiFlowRuntimeThree))
			}
		}
	} else {
		// 两种「没有可分析模型」必须分开说（2026-09 文案校准）：① 仓库里真没有模型；② 有模型，
		// 但没有一个在 CLI 的分析链路上（蓝图/MMD/VRM… 的解析器只在前端 3D adapter）。
		// 原实现两种都只报「未找到可分析的模型」+ ❌：对 ② 字面不算错，但它把**能力边界**标成了
		// **失败**，还丢掉了 ② 已算好的类型分布——用户既看不出原因，也看不出下一步该去哪。
		// 与「--model 指定了不可分析类型」的分支同口径：边界 ≠ 失败 → ℹ️ + Success=true。
		// ② 就在 results 末尾（本分支在 ③ 入列之前——与上方取 FirstModel 同一写法）。
		scan := results[len(results)-1]
		success, desc := false, "未找到可分析的模型"
		if scan.ModelCount > 0 {
			success = true
			desc = fmt.Sprintf(
				"ℹ️ 扫描到 %d 个模型，但没有一个在 CLI 的分析链路上（解析器只在前端 3D adapter）\n"+
					"   类型分布: %s\n"+
					"   想看这条链路请到 GUI 3D 预览实测；或 --model 指定一个可分析模型",
				scan.ModelCount, formatTypeDist(scan.ByType),
			)
		}
		results = append(results, withRuntime(guiFlowResult{
			Stage:       "③ 模型分析",
			Success:     success,
			Description: desc,
		}, guiFlowRuntimeGo))
	}

	// ============ 汇总报告 ============
	totalDuration := time.Since(totalStart)
	// 结构化结果先于人类文本报告就位（ADR-200 D1）：printFlowReport 有阶段失败会返回
	// error，但 --json 错误分支仍需带回阶段明细（规律六），SetResult 必须前置。
	ctx.SetResult(buildGuiFlowStructured(results, totalDuration))
	if err := printFlowReport(results, totalDuration, *verbose); err != nil {
		return err
	}

	return nil
}

// runPhaseConfigLoad 模拟配置加载（只读）
// 此前调用 a.SaveAppConfig 会写穿真实用户配置（APPDATA/ysm_config.json）并可能重启 watcher，
// 属 CLI 测试副作用污染源。现 CLI 全路径均不落盘（审核 #4）：DispatchCommand 对
// --files-root 仅做内存会话覆写（app.SetSessionFilesRoot），此处仅需 LoadAppConfig 读取。
// 见 cli_test.go「TestDispatchCommand_SessionRootNoWriteThrough」机检约束。
