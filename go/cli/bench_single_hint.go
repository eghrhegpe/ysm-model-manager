// bench_single_hint.go：单模型基准的阶段名解析与优化提示（原 bench_single.go 二次拆分，2026-10 文件行数治理）。
// detectModelFormat / parseStageName / generateHints——阶段名归一 + 瓶颈中文提示。
package cli

import (
	"fmt"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types/registry"
)

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
