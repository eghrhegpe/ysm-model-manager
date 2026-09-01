package cli

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/packs"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types"
)

func init() {
	RegisterCommandC("gui-flow", CatPerf, "模拟 GUI 完整加载流程（配置→扫描→加载→渲染预估）", runGUIFlow)
}

// guiFlowResult GUI 流程各阶段结果
type guiFlowResult struct {
	Stage       string
	Duration    time.Duration
	Success     bool
	Description string
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
	results = append(results, runPhaseConfigLoad(ctx.App))

	// ============ Phase 2: 模型扫描 ============
	results = append(results, runPhaseModelScan(ctx.App, filesRoot))

	// 如果指定了模型，使用它；否则用扫描到的第一个
	targetModel := *modelPath
	if targetModel == "" && len(results) > 0 {
		if lastResult := results[len(results)-1]; lastResult.Success {
			// 从描述中提取第一个模型
			if idx := strings.Index(lastResult.Description, "首个模型:"); idx != -1 {
				targetModel = strings.TrimSpace(lastResult.Description[idx+len("首个模型:"):])
				// 取到换行前
				if nlIdx := strings.Index(targetModel, "\n"); nlIdx != -1 {
					targetModel = targetModel[:nlIdx]
				}
			}
		}
	}

	// ============ Phase 3: 模型分析（Go 侧）============
	if targetModel != "" {
		results = append(results, runPhaseModelAnalyze(ctx.App, targetModel))

		// PMX/PMD 加载链路在 Three.js 前端（@moeru/three-mmd），CLI 无解析器，
		// ④⑤⑥ 阶段（纹理缓存/数据准备/渲染预估）依赖 AnalyzeBedrockModel（仅 Bedrock geometry），
		// 对 PMX 会产出假数据——跳过并在③阶段已明确告知限制。
		ext := strings.ToLower(filepath.Ext(targetModel))
		if ext != ".pmx" && ext != ".pmd" {
			// ============ Phase 4: 纹理缓存检查 ============
			results = append(results, runPhaseTextureCache(targetModel))

			// ============ Phase 5: 数据准备（IPC 传输模拟）============
			results = append(results, runPhaseDataPrep(ctx.App, targetModel))

			// ============ Phase 6: 渲染预估 ============
			if *verbose {
				results = append(results, runPhaseRenderEstimate(ctx.App, targetModel, *verbose))
			}
		}
	} else {
		results = append(results, guiFlowResult{
			Stage:       "模型分析",
			Success:     false,
			Description: "未找到可分析的模型",
		})
	}

	// ============ 汇总报告 ============
	totalDuration := time.Since(totalStart)
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
// firstModel 只选 .ysm（分析阶段 AnalyzeBedrockModel 仅支持 Bedrock geometry），
// PMX 等类型不提升，保持原「未找到可分析的模型」语义（用户可 --model 显式指定）。
func scanSummaryByType(entries []types.ModelEntry) (map[string]int, string) {
	byType := make(map[string]int)
	var firstModel string
	registry := types.LoadRegistry()
	for _, e := range entries {
		ext := strings.ToLower(filepath.Ext(e.Path))
		id := classifyForScan(e.Path, ext, registry)
		byType[id]++
		if firstModel == "" && ext == ".ysm" {
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
func classifyForScan(path, ext string, registry *types.ResourceTypeRegistry) string {
	if id := types.TypeByLocation(path, registry); id != "" {
		return id
	}
	if !types.IsContainerExt(ext) {
		if id := packs.DetectResourceType(path, registry); id != "" {
			return id
		}
		return "other"
	}
	// code review P3：容器兜底诚实标 "container"——repoaudit.Classify(ext) 对共享
	// 扩展名 .zip（14 类型声明）last-wins 归任意类型（与内容无关——误导分布）；
	// Classify 也不返回 ""（miss 归 other）——死代码 `if id == ""` 一并删除
	return "container"
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

	// code review P1：保留机器可读 token（YAML: n, YSM: n）——gui-flow-gate.mjs 的
	// hasModel 判定解析它（旧格式正则）；新"类型分布"格式（注册表 id 小写）不含
	// YAML:/YSM: 大写 token，gate 会静默降级（fail-open 跳过 ③④⑤ 强验证）
	ysmCount := byType["ysm"]
	yamlCount := byType["yml"] // 派生（注册表无 .yml 类型时为 0——不硬编码常量）
	return guiFlowResult{
		Stage:    "② 模型扫描",
		Duration: elapsed,
		Success:  true,
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

// runPhaseModelAnalyze 模拟模型分析
func runPhaseModelAnalyze(a AppService, modelPath string) guiFlowResult {
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
		}
	}

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

	if len(model.Bones) == 0 {
		return guiFlowResult{
			Stage:       "③ 模型分析",
			Duration:    elapsed,
			Success:     false,
			Description: fmt.Sprintf("❌ 分析失败: %s", modelPath),
		}
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
			formatSize(geoSize),
		),
	}
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

	cached, ok, _ := texture_cache.ReadCached(hash)
	elapsed := time.Since(start)

	if ok && cached != nil {
		return guiFlowResult{
			Stage:    "④ 纹理缓存",
			Duration: elapsed,
			Success:  true,
			Description: fmt.Sprintf("✅ 缓存命中 (%.0f KB)\n   哈希: %s",
				float64(len(cached))/1024, hash[:16]+"..."),
		}
	}

	return guiFlowResult{
		Stage:       "④ 纹理缓存",
		Duration:    elapsed,
		Success:     true,
		Description: fmt.Sprintf("⚠️  缓存未命中（首次加载会编码生成）\n   哈希: %s", hash[:16]+"..."),
	}
}

// runPhaseDataPrep 模拟数据准备与 IPC 传输
func runPhaseDataPrep(a AppService, modelPath string) guiFlowResult {
	start := time.Now()

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

	// 估算 IPC 传输大小
	geoSize := estimateGeometrySize(model)
	texSize := estimateTextureSize(model)
	totalSize := geoSize + texSize

	// Base64 编码后会膨胀约 33%
	ipcSize := totalSize * 4 / 3

	return guiFlowResult{
		Stage:    "⑤ 数据准备",
		Duration: elapsed,
		Success:  true,
		Description: fmt.Sprintf(
			"📦 数据就绪\n   几何数据: %s\n   纹理数据: %s\n   IPC 估算: %s (Base64 后)\n   预计传输: %.0fms (假设 50MB/s)",
			formatSize(geoSize),
			formatSize(texSize),
			formatSize(ipcSize),
			float64(ipcSize)/(50*1024*1024)*1000,
		),
	}
}

// runPhaseRenderEstimate 模拟渲染预估
func runPhaseRenderEstimate(a AppService, modelPath string, verbose bool) guiFlowResult {
	start := time.Now()

	model := a.AnalyzeBedrockModel(modelPath)
	elapsed := time.Since(start)

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

	return guiFlowResult{
		Stage:    "⑥ 渲染预估",
		Duration: elapsed,
		Success:  true,
		Description: fmt.Sprintf(
			"%s\n   ⚠️ CLI 估算值（无渲染管线，仅按骨骼/纹理数粗估；真实首帧须在 GUI 验证）\n   骨骼: %d, 纹理: %d\n   预估首帧: %.0f-%.0fms",
			renderEstimate,
			boneCount, texCount,
			float64(boneCount)*0.01+50, // 粗略估计
			float64(boneCount)*0.02+100,
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

	for i, r := range results {
		status := "✅"
		if !r.Success {
			status = "❌"
			failCount++
		} else {
			successCount++
		}

		fmt.Printf("\n%s [%d] %s (%.2fms)\n",
			status, i+1, r.Stage,
			float64(r.Duration.Microseconds())/1000)

		// 打印描述（缩进）
		for _, line := range strings.Split(r.Description, "\n") {
			fmt.Printf("   %s\n", line)
		}
	}

	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Printf("⏱️  总耗时: %.2fms\n", float64(totalDuration.Microseconds())/1000)
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

// estimateTextureSize 估算纹理数据大小
func estimateTextureSize(model types.BedrockModel) int64 {
	var size int64

	// 主纹理
	if model.Texture != "" {
		size += int64(len(model.Texture)) * 3 / 4 // Base64 解码后大小
	}

	// 多纹理
	for _, tex := range model.Textures {
		if tex != "" {
			size += int64(len(tex)) * 3 / 4
		}
	}

	return size
}
