// bench_single_print.go：单模型基准 text 呈现（原 bench_single.go 拆分，2026-10 文件行数治理）。
// printSingleModelStages / printAverageStages / printOptimizationHints——纯 stdout 输出，
// 与数据采集（bench_single.go）解耦，便于单独测呈现格式。
package cli

import (
	"fmt"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
)

func printSingleModelStages(stages []singleBenchStage) {
	fmt.Println()
	fmt.Println("   📊 各阶段耗时:")
	fmt.Println("   " + strings.Repeat("-", 65))

	var totalMs float64
	for _, s := range stages {
		ms := msOf(s)
		totalMs += ms

		fmt.Printf("   %-20s %10.2fms %s\n", s.Name, ms, " "+stageMark(ms))
		if s.Notes != "" {
			fmt.Printf("   %-20s        %s\n", "", s.Notes)
		}
		if s.Bytes > 0 {
			fmt.Printf("   %-20s        %s\n", "", "数据量: "+fsutil.FormatSize(s.Bytes))
		}
	}

	fmt.Println("   " + strings.Repeat("-", 65))
	fmt.Printf("   %-20s %10.2fms\n", "总计", totalMs)
}

// printAverageStages 打印多次迭代的平均值（直接复用 avgBenchStages 的按名配对结果，
// 不再裸取 stages[i]——不等长迭代（读取失败提前 return）下索引取值会越界 panic）
func printAverageStages(allStages [][]singleBenchStage) {
	avg := avgBenchStages(allStages)

	fmt.Println("   📊 平均耗时（跨迭代）:")
	fmt.Println("   " + strings.Repeat("-", 55))

	var totalAvg float64
	for _, s := range avg {
		ms := msOf(s)
		totalAvg += ms
		fmt.Printf("   %-20s %10.2fms %s\n", s.Name, ms, stageMark(ms))
	}

	fmt.Println("   " + strings.Repeat("-", 55))
	fmt.Printf("   %-20s %10.2fms\n", "总计", totalAvg)
}

// printOptimizationHints 打印优化建议
func printOptimizationHints(stages []singleBenchStage) {
	var maxDuration time.Duration
	var bottleneckIdx int
	for i, s := range stages {
		if s.Duration > maxDuration {
			maxDuration = s.Duration
			bottleneckIdx = i
		}
	}

	fmt.Println()
	fmt.Println("💡 优化建议:")
	fmt.Println(strings.Repeat("-", 70))

	switch stages[bottleneckIdx].Name {
	case "① 文件读取":
		fmt.Println("   🔴 瓶颈: 文件读取")
		fmt.Println("   建议:")
		fmt.Println("   - 使用 SSD 替代 HDD")
		fmt.Println("   - 考虑文件缓存（内存映射）")
		fmt.Println("   - 检查杀毒软件是否在扫描")
	case "② JSON 解析", "② PMX 解析", "② 模型解析":
		fmt.Printf("   🔴 瓶颈: %s\n", stages[bottleneckIdx].Name)
		fmt.Println("   建议:")
		fmt.Println("   - 检查模型文件是否过大（>5MB 需优化）")
		fmt.Println("   - 解析耗时占比高时，评估更快的 JSON/PMX 解析实现（不指定具体第三方库，防带货文案过期）")
		fmt.Println("   - 模型数据是否可以精简")
	case "③ 数据验证":
		fmt.Println("   🟡 注意: 数据验证")
		fmt.Println("   建议:")
		fmt.Println("   - 检查验证逻辑是否过于复杂")
		fmt.Println("   - 部分验证可以延迟执行")
	case "④ 几何数据准备":
		fmt.Println("   🔴 瓶颈: 几何数据准备")
		fmt.Println("   建议:")
		fmt.Println("   - 减少骨骼数量（简化模型）")
		fmt.Println("   - 使用 LOD（Level of Detail）")
		fmt.Println("   - 预处理模型数据，运行时直接加载")
	case "⑤ 纹理数据准备":
		fmt.Println("   🔴 瓶颈: 纹理数据准备")
		fmt.Println("   建议:")
		fmt.Println("   - 使用 KTX2/DDS 压缩纹理（减少 60-70%）")
		fmt.Println("   - 减少大尺寸纹理（>2048x2048）")
		fmt.Println("   - 实现纹理缓存机制")
	case "⑥ 序列化模拟":
		fmt.Println("   🟡 注意: 序列化")
		fmt.Println("   建议:")
		fmt.Println("   - 减少数据传输量（精简模型）")
		fmt.Println("   - 使用更高效的序列化格式（如 msgpack）")
		fmt.Println("   - Wails binding 走 JSON 序列化，减少嵌套结构可提升吞吐")
	case "⑦ 缓存检查":
		fmt.Println("   🟡 注意: 缓存检查")
		fmt.Println("   建议:")
		fmt.Println("   - 缓存命中率低则说明编码失败")
		fmt.Println("   - 定期检查缓存目录状态")
	default:
		fmt.Println("   📊 整体性能可接受")
	}

	fmt.Println()
	fmt.Println("📚 性能优化原则:")
	fmt.Println("   1. 先优化单模型，再考虑多模型并发")
	fmt.Println("   2. 定位瓶颈阶段（耗时最长）")
	fmt.Println("   3. 针对性优化，避免盲目并发")
	fmt.Println("   4. 量化改进：每次优化后重跑 single-bench")
}
