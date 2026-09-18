package cli

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/scanner"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
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
	// Kind 阶段性质：measured（实测，默认）| estimated（估算，如 ⑥ 渲染预估）。
	// ADR-262 D2：估算与实测必须显式区分，不能靠描述文字里的一句「估算」来暗示。
	Kind string
	// Estimated 该阶段内含的**估算**耗时（⑤ 的 IPC 传输、⑥ 的首帧），不计入 total_ms。
	Estimated time.Duration
	// Note 估算依赖的假设/公式（D2 要求估算显式标注来源），实测阶段留空
	Note string
	// Runtime 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）。由装配点打上（withRuntime），
	// 不逐个 return 字面量重复书写。② 模型扫描填**实际扫描后端**（scanner.ScanBackend），
	// ⑥ 渲染预估归 three（它是 Three.js 首帧的估算，估算性质由 Kind 承载）。
	Runtime string
}

// guiFlowStageItem 单阶段结构化结果（ADR-200 D2：gui-flow 为首批结构化命令）。
// 字段与前端 GuiFlowStage（perf-gui-flow.ts）逐字对齐，前端据此直接渲染、
// 不再对人类文案做正则反解析。
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
	// Runtime 阶段运行归属（go|rust|wasm|js|three，ADR-262 D2）
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
			Ms:          float64(r.Duration.Microseconds()) / 1000,
			Kind:        kind,
			Desc:        splitDescLines(r.Description),
			EstimatedMs: float64(r.Estimated.Nanoseconds()) / 1e6,
			Note:        r.Note,
			Runtime:     r.Runtime,
		})
	}
	return &guiFlowStructured{
		Stages:      items,
		TotalMs:     float64(totalDuration.Microseconds()) / 1000,
		EstimatedMs: float64(estimatedTotal.Microseconds()) / 1000,
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
	// 输出不是内部 API）
	targetModel := *modelPath
	if targetModel == "" && len(results) > 0 {
		if lastResult := results[len(results)-1]; lastResult.Success {
			targetModel = lastResult.FirstModel
		}
	}

	// ============ Phase 3: 模型分析（Go 侧）============
	// 模型只分析一次，③⑤⑥ 共用（原实现 ⑤⑥ 各自再调 AnalyzeBedrockModel，
	// 同一份分析被计 3 次耗时——⑤⑥ 的阶段耗时因此不是自己的工作量的度量）
	if targetModel != "" {
		analyzeResult, model := runPhaseModelAnalyze(ctx.App, targetModel)
		results = append(results, withRuntime(analyzeResult, guiFlowRuntimeGo))

		// PMX/PMD 加载链路在 Three.js 前端（@moeru/three-mmd），CLI 无解析器，
		// ④⑤⑥ 阶段（纹理缓存/数据准备/渲染预估）依赖 AnalyzeBedrockModel（仅 Bedrock geometry），
		// 对 PMX 会产出假数据——跳过并在③阶段已明确告知限制。
		ext := strings.ToLower(filepath.Ext(targetModel))
		if ext != ".pmx" && ext != ".pmd" {
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
		results = append(results, withRuntime(guiFlowResult{
			Stage:       "模型分析",
			Success:     false,
			Description: "未找到可分析的模型",
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
func runPhaseConfigLoad(a AppService) guiFlowResult {
	start := time.Now()

	config := a.LoadAppConfig()
	modelRoot := config.FilesRoot
	if m := config.CustomRoots["ysm"]; m != "" {
		modelRoot = m
	}

	return guiFlowResult{
		Stage:    "① 配置加载",
		Duration: time.Since(start),
		Success:  true,
		Description: fmt.Sprintf("✅ 配置已加载\n   仓库根: %s\n   模型根: %s",
			config.FilesRoot, modelRoot),
	}
}

// scanSummaryByType 按注册表类型聚合扫描结果。
// 返回 {typeID: count} 与首个「分析阶段可处理」的模型路径（.ysm 优先）。
// 原实现硬编码 yml/ysm/other 三槽，MMD 的 PMX/PMD 等注册表类型全归 "other"，
// 导致纯 MMD 仓库统计失真（"其他: 333"）——现按注册表真实类型展示分布。
// firstModel 只选 **CLI 可分析**的类型（分析阶段 AnalyzeBedrockModel 仅支持 Bedrock geometry）：
// 判据 = `cliAnalyzable(id)`（perfTypeManifest 登记，perf_targets.go），不再自持 `ext == ".ysm"`
// 白名单（ADR-262 D3 收编，2026-09-18）——随清单自动扩展，且天然含 ysm 目录下的
// 容器 .zip / 解包目录 ysm.json 等「非 .ysm 扩展名但确实在分析链路上」的形态。
// 不可分析类型不提升，保持原「未找到可分析的模型」语义（用户可 --model 显式指定）。
func scanSummaryByType(entries []types.ModelEntry) (map[string]int, string) {
	byType := make(map[string]int)
	var firstModel string
	registry := registry.LoadRegistry()
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Path))
		id := classifyForScan(e.Path, ext, registry)
		byType[id]++
		if firstModel == "" && cliAnalyzable(id) {
			firstModel = e.Path
		}
	}
	return byType, firstModel
}

// classifyForScan 轻量类型判定（gui-flow 扫描统计专用，不打开容器内容指纹）：
//  1. 祖先目录归属优先（任意扩展名）：mmd/PMX/xxx.zip 或 xxx.vpd 都归 EntityPlayer——
//     目录归属（storageSubDir/instanceDir 命中）> 扩展名归属（location 路由语义，
//     模型包目录下的容器/表情/动作文件都是该类型的资源）；
//  2. 非容器 → packs.DetectResourceType（路径消歧 + 扩展名，零文件打开）；
//  3. 容器兜底（目录消歧未命中）→ 诚实标 "container"（不归任意类型——共享扩展名
//     .zip 被 14 类型声明，last-wins 归任意类型会误导分布）。
func classifyForScan(path, ext string, reg *registry.ResourceTypeRegistry) string {
	id, _ := classifyForScanWithSource(path, ext, reg)
	return id
}

// classifyForScanWithSource = classifyForScan + 命中来源（location | extension | container），
// 供身份块 rtype_source 使用——三段分支顺序**只存在这一份**，消费方不得自行复制分支。
func classifyForScanWithSource(path, ext string, reg *registry.ResourceTypeRegistry) (string, string) {
	if id := registry.TypeByLocation(path, reg); id != "" {
		return id, "location"
	}
	if !registry.IsContainerExt(ext) {
		if id := packs.DetectResourceType(path, reg); id != "" {
			return id, "extension"
		}
		return "other", "extension"
	}
	// 容器兜底诚实标 "container"——repoaudit.Classify(ext) 对共享
	// 扩展名 .zip（14 类型声明）last-wins 归任意类型（与内容无关——误导分布）；
	// Classify 也不返回 ""（miss 归 other）——死代码 `if id == ""` 一并删除
	return "container", "container"
}

// runPhaseModelScan 模拟模型扫描
func runPhaseModelScan(a AppService, filesRoot string) guiFlowResult {
	start := time.Now()

	entries := a.ScanModelEntries(filesRoot)
	elapsed := time.Since(start)

	if len(entries) == 0 {
		return guiFlowResult{
			Stage:       "② 模型扫描",
			Duration:    elapsed,
			Success:     false,
			Description: "❌ 未找到任何模型",
		}
	}

	byType, firstModel := scanSummaryByType(entries)
	// 类型分布可读化：注册表类型 id（EntityPlayer/ysm/...）→ count；未命中归 other
	parts := make([]string, 0, len(byType))
	for id, n := range byType {
		parts = append(parts, fmt.Sprintf("%s: %d", id, n))
	}
	// 稳定输出（map 遍历无序，测试/展示确定性）
	sort.Strings(parts)
	dist := strings.Join(parts, ", ")

	// 保留机器可读 token（YAML: n, YSM: n）——gui-flow-gate.mjs 的
	// hasModel 判定解析它（旧格式正则）；新"类型分布"格式（注册表 id 小写）不含
	// YAML:/YSM: 大写 token，gate 会静默降级（fail-open 跳过 ③④⑤ 强验证）
	ysmCount := byType["ysm"]
	yamlCount := byType["yml"] // 派生（注册表无 .yml 类型时为 0——不硬编码常量）
	return guiFlowResult{
		Stage:      "② 模型扫描",
		Duration:   elapsed,
		Success:    true,
		FirstModel: firstModel,
		Description: fmt.Sprintf(
			"✅ 发现 %d 个模型 (%.0f models/sec)\n   类型分布: %s [YAML: %d, YSM: %d]\n   首个模型: %s",
			len(entries),
			float64(len(entries))/elapsed.Seconds(),
			dist,
			yamlCount,
			ysmCount,
			firstModel,
		),
	}
}

// runPhaseModelAnalyze 模拟模型分析。
//
// 返回模型本体供 ⑤⑥ 复用：原实现让 ⑤⑥ 各自再调一次 AnalyzeBedrockModel，
// 同一份分析被计 3 次耗时（③⑤⑥ 的 ms 里都有它），⑤⑥ 的阶段耗时因此不是自己的工作量
// ——「同一分析重复计时」是数字不可信的一个具体来源（ADR-262 D2/D8）。
func runPhaseModelAnalyze(a AppService, modelPath string) (guiFlowResult, types.BedrockModel) {
	start := time.Now()
	ext := strings.ToLower(filepath.Ext(modelPath))

	// PMX/PMD 分派：Go 端无 PMX 骨骼/纹理解析器（MMD 加载链路在 Three.js 前端
	// @moeru/three-mmd），AnalyzeBedrockModel 对 PMX 必然失败/假数据——明确告知
	// 限制并引导 GUI 3D 预览实测，不再硬跑（此前对 PMX 输出「分析失败」误导用户）。
	if ext == ".pmx" || ext == ".pmd" {
		return guiFlowResult{
			Stage:    "③ 模型分析",
			Duration: time.Since(start),
			Success:  true,
			Description: fmt.Sprintf(
				"ℹ️ PMX/PMD 加载链路在 Three.js 前端（@moeru/three-mmd），CLI 不模拟\n   文件: %s\n   请在 GUI 3D 预览实测首帧耗时",
				filepath.Base(modelPath),
			),
		}, types.BedrockModel{}
	}

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

	if len(model.Bones) == 0 {
		return guiFlowResult{
			Stage:       "③ 模型分析",
			Duration:    elapsed,
			Success:     false,
			Description: fmt.Sprintf("❌ 分析失败: %s", modelPath),
		}, types.BedrockModel{}
	}

	boneCount := len(model.Bones)
	texCount := len(model.Textures)
	geoSize := estimateGeometrySize(model)

	return guiFlowResult{
		Stage:    "③ 模型分析",
		Duration: elapsed,
		Success:  true,
		Description: fmt.Sprintf(
			"✅ 分析完成\n   文件: %s\n   骨骼: %d\n   纹理: %d\n   预估几何: %s",
			filepath.Base(modelPath),
			boneCount, texCount,
			fsutil.FormatSize(geoSize),
		),
	}, model
}

// runPhaseTextureCache 检查纹理缓存状态
func runPhaseTextureCache(modelPath string) guiFlowResult {
	start := time.Now()

	hash, err := texture_cache.TextureHash(modelPath)
	if err != nil {
		return guiFlowResult{
			Stage:       "④ 纹理缓存",
			Duration:    time.Since(start),
			Success:     false,
			Description: fmt.Sprintf("❌ 哈希计算失败: %v", err),
		}
	}

	cached, ok, rerr := texture_cache.ReadCached(hash)
	elapsed := time.Since(start)
	if rerr != nil {
		// 读取故障 ≠ 未命中：降级为「未命中」会让磁盘/权限故障显示成
		// 「尚未编码」，用户据此判定缓存层不工作，结论不可信。
		return guiFlowResult{
			Stage:       "④ 纹理缓存",
			Duration:    elapsed,
			Success:     false,
			Description: fmt.Sprintf("❌ 缓存读取失败: %v", rerr),
		}
	}

	hashPrefix := hash
	if len(hashPrefix) > 16 {
		hashPrefix = hashPrefix[:16]
	}

	if ok && cached != nil {
		return guiFlowResult{
			Stage:    "④ 纹理缓存",
			Duration: elapsed,
			Success:  true,
			Description: fmt.Sprintf("✅ 缓存命中 (%.0f KB)\n   哈希: %s...",
				float64(len(cached))/1024, hashPrefix),
		}
	}

	return guiFlowResult{
		Stage:       "④ 纹理缓存",
		Duration:    elapsed,
		Success:     true,
		Description: fmt.Sprintf("⚠️  缓存未命中（首次加载会编码生成）\n   哈希: %s...", hashPrefix),
	}
}

// ipcAssumedBytesPerSec IPC 传输速率的**假设值**（50MB/s）。
//
// 传输通道（Wails binding → WebView2）在 CLI 侧不可观测：CLI 只产出载荷，不经过那条通道。
// 因此"载荷大小"与"序列化耗时"一律实测（能测的不要估，ADR-262 D2），只有传输时间按此假设外推，
// 并明确标为 estimated、不计入总耗时。
const ipcAssumedBytesPerSec = 50 * 1024 * 1024

// runPhaseDataPrep 数据准备与 IPC 载荷。
//
// model 由 ③ 传入（不再自行 AnalyzeBedrockModel：重复分析会让本阶段耗时变成"又一次解析"）。
// 阶段耗时 = **实测**的 JSON 序列化耗时（Wails binding 走 JSON，这就是真正过桥的工作量）；
// 载荷字节数同样是实测（`len(json.Marshal(model))`）——原实现按 (几何+纹理)*4/3 估算，
// 但 Base64 早已在 model.Textures 里，膨胀系数属多余假设。
// 唯一保留的估算是"传输时间"（通道不可观测），走 Estimated + Note，不计入 total_ms。
func runPhaseDataPrep(model types.BedrockModel, modelPath string) guiFlowResult {
	start := time.Now()
	data, marshalErr := json.Marshal(model)
	elapsed := time.Since(start)

	if marshalErr != nil {
		return guiFlowResult{
			Stage:       "⑤ 数据准备",
			Duration:    elapsed,
			Success:     false,
			Description: fmt.Sprintf("❌ 序列化失败: %v", marshalErr),
		}
	}

	payloadBytes := int64(len(data))
	transfer := time.Duration(float64(payloadBytes) / ipcAssumedBytesPerSec * float64(time.Second))
	transferMs := float64(payloadBytes) / ipcAssumedBytesPerSec * 1000

	return guiFlowResult{
		Stage:     "⑤ 数据准备",
		Duration:  elapsed,
		Success:   true,
		Kind:      "measured",
		Estimated: transfer,
		Note: fmt.Sprintf(
			"载荷与序列化耗时为实测（%s / %.2fms）；仅传输时间按 %dMB/s 假设外推（CLI 观测不到 Wails IPC 通道），估算不计入总耗时",
			fsutil.FormatSize(payloadBytes), float64(elapsed.Microseconds())/1000, ipcAssumedBytesPerSec/1024/1024,
		),
		Description: fmt.Sprintf(
			"📦 数据就绪\n   载荷(实测 JSON): %s\n   序列化(实测): %.2fms\n   预计传输: %.0fms (假设 %dMB/s，估算)",
			fsutil.FormatSize(payloadBytes),
			float64(elapsed.Microseconds())/1000,
			transferMs,
			ipcAssumedBytesPerSec/1024/1024,
		),
	}
}

// runPhaseRenderEstimate 渲染预估。
//
// 本阶段**完全没有渲染管线**：Go 侧只按骨骼/纹理数套公式，故 Kind = estimated、
// Duration = 0（没有实测工作量可报），估算值走 Estimated + Note（公式与区间），
// 不进 total_ms（ADR-262 D2）。model 由 ③ 传入，避免第二次重复分析。
func runPhaseRenderEstimate(model types.BedrockModel, modelPath string) guiFlowResult {
	boneCount := len(model.Bones)
	texCount := len(model.Textures)

	// Three.js 渲染预估
	var renderEstimate string
	switch {
	case boneCount > 5000 || texCount > 50:
		renderEstimate = "🔴 高负载 (5000+ 骨骼或 50+ 纹理) — 建议使用 LOD"
	case boneCount > 2000 || texCount > 20:
		renderEstimate = "🟡 中等负载 (2000+ 骨骼或 20+ 纹理)"
	default:
		renderEstimate = "🟢 轻量负载 — 可流畅渲染"
	}

	lo := float64(boneCount)*0.01 + 50
	hi := float64(boneCount)*0.02 + 100
	mid := time.Duration((lo + hi) / 2 * float64(time.Millisecond))

	return guiFlowResult{
		Stage:     "⑥ 渲染预估",
		Duration:  0,
		Success:   true,
		Kind:      "estimated",
		Estimated: mid,
		Note: fmt.Sprintf(
			"无渲染管线：首帧按 boneCount*0.01+50 ~ *0.02+100 粗估（区间 %.0f-%.0fms，此处取中值），真实首帧须在 GUI 验证",
			lo, hi,
		),
		Description: fmt.Sprintf(
			"%s\n   ⚠️ CLI 估算值（无渲染管线，仅按骨骼/纹理数粗估；真实首帧须在 GUI 验证）\n   骨骼: %d, 纹理: %d\n   预估首帧: %.0f-%.0fms（估算，不计入总耗时）",
			renderEstimate,
			boneCount, texCount,
			lo, hi,
		),
	}
}

// printFlowReport 打印流程报告
func printFlowReport(results []guiFlowResult, totalDuration time.Duration, verbose bool) error {
	fmt.Println()
	fmt.Println("📊 流程报告")
	fmt.Println(strings.Repeat("-", 70))

	var successCount int
	var failCount int
	var estimatedTotal time.Duration

	for i, r := range results {
		status := "✅"
		if !r.Success {
			status = "❌"
			failCount++
		} else {
			successCount++
		}
		estimatedTotal += r.Estimated

		// 估算阶段显式标注（ADR-262 D2）：人读文本同样要能区分实测与估算
		kindMark := ""
		if r.Kind == "estimated" {
			kindMark = " [估算]"
		}

		fmt.Printf("\n%s [%d] %s%s (%.2fms)\n",
			status, i+1, r.Stage, kindMark,
			float64(r.Duration.Microseconds())/1000)

		// 打印描述（缩进）
		for _, line := range strings.Split(r.Description, "\n") {
			fmt.Printf("   %s\n", line)
		}
	}

	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Printf("⏱️  总耗时: %.2fms（实测）\n", float64(totalDuration.Microseconds())/1000)
	if estimatedTotal > 0 {
		// ADR-262 D2：估算单独呈现，不进总耗时
		fmt.Printf("📐 其中估算: %.2fms（不计入总耗时）\n", float64(estimatedTotal.Microseconds())/1000)
	}
	fmt.Printf("📈 成功: %d, 失败: %d\n", successCount, failCount)

	if failCount > 0 {
		fmt.Println()
		fmt.Println("⚠️  有阶段失败，请检查上述输出")
		return newRuntimeErrf("有 %d 个阶段失败", failCount)
	} else {
		fmt.Println()
		fmt.Println("🎉 GUI 流程模拟完成！")
		fmt.Println()
		fmt.Println("💡 提示:")
		fmt.Println("   - CLI 仅模拟后端流程，前端 Three.js 渲染需在 GUI 中验证")
		fmt.Println("   - 缓存未命中属正常现象，首次加载后会自动编码生成")
		fmt.Println("   - 使用 'cache-status' 查看缓存状态")
	}

	return nil
}

// estimateGeometrySize 估算几何体大小
func estimateGeometrySize(model types.BedrockModel) int64 {
	var size int64

	// 顶点数据（假设每个顶点 36 字节: 位置 + 法线 + UV）
	if len(model.Bones) > 0 {
		size += int64(len(model.Bones)) * 36
	}

	// 动画数据
	for _, anim := range model.Animations {
		size += int64(len(anim))
	}

	// 立方块数据（假设每个 cube 约 80 字节）
	for _, bone := range model.Bones {
		size += int64(len(bone.Cubes)) * 80
	}

	return size
}

// 说明：原 estimateTextureSize（按 Base64 长度 *3/4 估算纹理字节数）已随 ⑤ 改为实测载荷而删除——
// 唯一的消费者是 ⑤，而它的估算口径已被 json.Marshal 的实测长度取代（ADR-262 D2「能测的不要估」）。
// estimateGeometrySize 仍被 ③ 的「预估几何」信息行使用，保留。
