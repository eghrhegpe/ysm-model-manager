// flow_report.go：gui-flow 数据准备 + 渲染估算 + 报告打印（原 flow.go 拆分，2026-10 文件行数治理）。
// runPhaseDataPrep / runPhaseRenderEstimate / printFlowReport / estimateGeometrySize——
// 数据准备/渲染预估两阶段 + 结构化报告输出。
package cli

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
)

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
			fsutil.FormatSize(payloadBytes), durationMs(elapsed), ipcAssumedBytesPerSec/1024/1024,
		),
		Description: fmt.Sprintf(
			"📦 数据就绪\n   载荷(实测 JSON): %s\n   序列化(实测): %.2fms\n   预计传输: %.0fms (假设 %dMB/s，估算)",
			fsutil.FormatSize(payloadBytes),
			durationMs(elapsed),
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
			durationMs(r.Duration))

		// 打印描述（缩进）
		for _, line := range strings.Split(r.Description, "\n") {
			fmt.Printf("   %s\n", line)
		}
	}

	fmt.Println()
	fmt.Println(strings.Repeat("-", 70))
	fmt.Printf("⏱️  总耗时: %.2fms（实测）\n", durationMs(totalDuration))
	if estimatedTotal > 0 {
		// ADR-262 D2：估算单独呈现，不进总耗时
		fmt.Printf("📐 其中估算: %.2fms（不计入总耗时）\n", durationMs(estimatedTotal))
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
