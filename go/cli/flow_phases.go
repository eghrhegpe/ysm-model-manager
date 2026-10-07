// flow_phases.go：gui-flow 各阶段实现（原 flow.go 拆分，2026-10 文件行数治理）。
// runPhaseConfigLoad / runPhaseModelScan / runPhaseModelAnalyze / runPhaseModelAnalyzeTarget /
// runPhaseTextureCache——配置/扫描/分析/缓存四阶段。
package cli

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
)

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
// 返回 {typeID: count}、首个「分析阶段可处理」的模型路径、以及**有序候选列表**（只含 CLI 可分析类型）。
// 原实现硬编码 yml/ysm/other 三槽，MMD 的 PMX/PMD 等注册表类型全归 "other"，
// 导致纯 MMD 仓库统计失真（"其他: 333"）——现按注册表真实类型展示分布。
// firstModel 只选 **CLI 可分析**的类型（分析阶段 AnalyzeBedrockModel 仅支持 Bedrock geometry）：
// 判据 = `cliAnalyzable(id)`（resource_types.json 的 cliAnalyzable 声明，perf_targets.go 单点读取），不再自持 `ext == ".ysm"`
// 白名单（ADR-262 D3 收编，2026-09-18）——随清单自动扩展，且天然含 ysm 目录下的
// 容器 .zip / 解包目录 ysm.json 等「非 .ysm 扩展名但确实在分析链路上」的形态。
// 不可分析类型**不提升为首模型**（用户可 --model 显式指定）——这只关「③ 拿谁去跑」；
// ③ 在「有模型但都不可分析」时会如实转述类型分布并标 ℹ️，不再只报「未找到可分析的模型」。
//
// 候选按**路径字典序**（Walk 顺序依文件系统而变，测试/AI 断言要可复现），firstModel 恒 = candidates[0]：
// 两者同源，不另立挑选器（「条目形状的挑选器」只许有一份，见 perf_targets.go 的告诫）。
// 候选顺序还是 ③ 顺延的依据——类型可分析 ≠ 该条目含几何（音效包/纯资源包按目录归属同类）。
func scanSummaryByType(entries []types.ModelEntry) (map[string]int, string, []string) {
	byType := make(map[string]int)
	var candidates []string
	registry := registry.LoadRegistry()
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Path))
		id := classifyForScan(e.Path, ext, registry)
		byType[id]++
		if cliAnalyzable(id) {
			candidates = append(candidates, e.Path)
		}
	}
	sort.Strings(candidates)
	firstModel := ""
	if len(candidates) > 0 {
		firstModel = candidates[0]
	}
	return byType, firstModel, candidates
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

// scanRateSuffix 扫描速率后缀：计时走字才报速率。
// ⚠️ 诚实红线：小仓库扫描常在时钟粒度内完成（`time.Since` = 0），`n/0s` 会打出
// 「+Inf models/sec」——测不出来的速率宁可不报（2026-09-18 由 e2e 真实渲染抓出）。
func scanRateSuffix(count int, d time.Duration) string {
	if d <= 0 {
		return ""
	}
	return fmt.Sprintf(" (%.0f models/sec)", float64(count)/d.Seconds())
}

// formatTypeDist 类型分布可读化：注册表类型 id → count，排序后拼接（map 遍历无序，展示与
// 测试都需要确定性）。② 的阶段描述与 ③ 的「都不在分析链路上」分支共用这一处格式。
func formatTypeDist(byType map[string]int) string {
	parts := make([]string, 0, len(byType))
	for id, n := range byType {
		parts = append(parts, fmt.Sprintf("%s: %d", id, n))
	}
	sort.Strings(parts)
	return strings.Join(parts, ", ")
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

	byType, firstModel, candidates := scanSummaryByType(entries)
	// 类型分布可读化（注册表类型 id → count；未命中归 other）——与 ③ 的「有模型但都不可分析」
	// 分支共用同一格式化，避免两处各排一遍序（map 遍历无序，展示/测试需确定性）
	dist := formatTypeDist(byType)

	// 保留机器可读 token（YAML: n, YSM: n）——gui-flow-gate.mjs 的
	// hasModel 判定解析它（旧格式正则）；新"类型分布"格式（注册表 id 小写）不含
	// YAML:/YSM: 大写 token，gate 会静默降级（fail-open 跳过 ③④⑤ 强验证）
	ysmCount := byType["ysm"]
	yamlCount := byType["yml"] // 派生（注册表无 .yml 类型时为 0——不硬编码常量）
	return guiFlowResult{
		Stage:                "② 模型扫描",
		Duration:             elapsed,
		Success:              true,
		FirstModel:           firstModel,
		AnalyzableCandidates: candidates,
		ModelCount:           len(entries),
		ByType:               byType,
		// ⚠️ 诚实红线（与 singleBenchReadNote 同族，2026-09-18 由 e2e 真实渲染抓出）：
		// 扫描几个小模型时 `time.Since` 常为 0 → 除以 0 秒把速率打成「+Inf models/sec」。
		// 测不出的速率宁可不报：计时没走字就只说数量。
		Description: fmt.Sprintf(
			"✅ 发现 %d 个模型%s\n   类型分布: %s [YAML: %d, YSM: %d]\n   首个模型: %s",
			len(entries),
			scanRateSuffix(len(entries), elapsed),
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

	// ③ 的分派依据 = 「CLI 有没有该类型的解析链路」（cliAnalyzable，perf_targets.go），
	// 而不再是扩展名白名单（2026-09-18 收编，ADR-262 D3）：MMD 链路在 Three.js 前端
	// （@moeru/three-mmd），VRM/FBX/GLTF/litematic 的解析器同样只在前端 3D adapter——
	// CLI 拿到都是空模型。明确告知限制并引导 GUI 3D 预览实测，不再硬跑
	// （此前对 PMX 输出「分析失败」误导用户，对 VRM 等则连提示都没有）。
	if !cliAnalyzablePath(modelPath, ext, registry.LoadRegistry()) {
		// PMX/PMD 的链路有专属名字，人话更准；其余类型用注册表显示名兜底
		reason := "该类型不在 CLI 的分析链路上（解析器只在前端 3D adapter），CLI 不模拟"
		if ext == ".pmx" || ext == ".pmd" {
			reason = "PMX/PMD 加载链路在 Three.js 前端（@moeru/three-mmd），CLI 不模拟"
		}
		return guiFlowResult{
			Stage:    "③ 模型分析",
			Duration: time.Since(start),
			Success:  true,
			Description: fmt.Sprintf(
				"ℹ️ %s\n   文件: %s\n   请在 GUI 3D 预览实测首帧耗时",
				reason,
				filepath.Base(modelPath),
			),
		}, types.BedrockModel{}
	}

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

	if !hasGeometry(model) {
		return modelAnalyzeNoGeometry(nil, modelPath, 0, elapsed), types.BedrockModel{}
	}
	return describeModelAnalysis(modelPath, model, elapsed, nil), model
}

// describeModelAnalysis 由**已分析好的**模型构造 ③ 的成功结果。
//
// 分析口径（骨骼/纹理/预估几何）只留这一份：单候选直测与顺延命中共用同一段文案，
// 避免两处各写一遍而漂移。skipped 非空时如实说明「跳过了哪几个候选」——顺延不许静默换模型。
func describeModelAnalysis(modelPath string, model types.BedrockModel, elapsed time.Duration, skipped []string) guiFlowResult {
	desc := fmt.Sprintf(
		"✅ 分析完成\n   文件: %s\n   骨骼: %d\n   纹理: %d\n   预估几何: %s",
		filepath.Base(modelPath),
		len(model.Bones), len(model.Textures),
		fsutil.FormatSize(estimateGeometrySize(model)),
	)
	if len(skipped) > 0 {
		desc += fmt.Sprintf(
			"\n   ⚠️ 首个候选无几何（解析不出骨骼，可能是音效包/纯资源包），已改测第 %d 个候选\n   已跳过: %s",
			len(skipped)+1, strings.Join(baseNames(skipped), ", "),
		)
	}
	return guiFlowResult{Stage: "③ 模型分析", Duration: elapsed, Success: true, Description: desc}
}

// modelAnalyzeNoGeometry ③ 的失败态：候选都在 CLI 分析链路上，却没有一个解析出几何。
//
// 单候选时保留原文案 `❌ 分析失败: <path>`（与修复前逐字一致，不因本次改动改口径）；
// 多候选时给出更准确的一句话，并**明确是数据问题而非能力边界**——「所有候选都没几何」
// 不等于「CLI 没有该类型的解析链路」（后者是 ℹ️ + Success=true，见 runPhaseModelAnalyze）。
// tried 为实际探测过的候选；total 是候选总数（用于说明还有几个没探测，不把截断藏起来）。
func modelAnalyzeNoGeometry(tried []string, fallbackPath string, total int, elapsed time.Duration) guiFlowResult {
	if len(tried) <= 1 {
		path := fallbackPath
		if len(tried) == 1 {
			path = tried[0]
		}
		return guiFlowResult{
			Stage:       "③ 模型分析",
			Duration:    elapsed,
			Success:     false,
			Description: fmt.Sprintf("❌ 分析失败: %s", path),
		}
	}
	desc := fmt.Sprintf(
		"❌ %d 个候选均未解析出几何，可能是音效包/纯资源包（CLI 有该类型的解析链路，只是这些条目里没有几何）\n   已试: %s",
		len(tried), strings.Join(baseNames(tried), ", "),
	)
	if total > len(tried) {
		desc += fmt.Sprintf("\n   另有 %d 个候选未探测（单次顺延上限 %d）", total-len(tried), maxGeometryProbe)
	}
	return guiFlowResult{Stage: "③ 模型分析", Duration: elapsed, Success: false, Description: desc}
}

// runPhaseModelAnalyzeTarget ③ 的目标选择与顺延。
//
// 显式 `--model`：直测它，**不换模型**（用户点名要那个；它无几何时由 ③ 如实报失败）。
// 自动挑选：按 ② 的有序候选（scan.AnalyzableCandidates，与 FirstModel 同源）顺延到第一个
// 真解析出几何的条目——类型可分析 ≠ 该条目含几何，只按类型提升会挑到音效包/纯资源包。
// 计时口径：顺延的多次分析**全部计入 ③ 的耗时**（开销不藏）。
//
// 第三个返回值是**实际被分析**的路径：④ 的纹理哈希直接读它（`runPhaseTextureCache(targetModel)`），
// 调用方必须把它回写到 targetModel，否则顺延后 ④ 会拿着首个候选去算哈希——换模型换了一半，
// 比不换更难发现。
func runPhaseModelAnalyzeTarget(a AppService, scan guiFlowResult, explicitTarget string, explicit bool) (guiFlowResult, types.BedrockModel, string) {
	if explicit {
		r, m := runPhaseModelAnalyze(a, explicitTarget)
		return r, m, explicitTarget
	}
	start := time.Now()
	hit, model, tried, ok := firstWithGeometry(a, scan.AnalyzableCandidates, maxGeometryProbe)
	elapsed := time.Since(start)
	if !ok {
		// 未命中：③ 是失败态，④⑤⑥ 不会跑，路径保持首个候选（与单候选时的原文案一致）
		return modelAnalyzeNoGeometry(tried, explicitTarget, len(scan.AnalyzableCandidates), elapsed), types.BedrockModel{}, explicitTarget
	}
	// tried 的末项就是命中的那个：它之前的才是「被跳过」的候选
	return describeModelAnalysis(hit, model, elapsed, tried[:len(tried)-1]), model, hit
}

// baseNames 把路径列表摘要成基名（人类文案用；完整路径已在各处载荷字段里）。
func baseNames(paths []string) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		out = append(out, filepath.Base(p))
	}
	return out
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
