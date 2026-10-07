// mmd.go：file-bench 命令 + CLI 阈值常量（原 mmd.go 拆分，2026-10 文件行数治理）。
// 2026-10 拆分：原 907 行按命令分为 mmd.go（本文件：file-bench）/
// cli_scan_dir.go（scan-dir）/ cli_analyze_mmd.go（analyze-mmd）。
package cli

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	iofs "io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
)

func init() {
	RegisterCommandC("file-bench", CatPerf, "测试大文件读取性能（原始读取吞吐；不解析/不解码，任意类型大文件都可测）", runFileBench)
}

// CLI 阈值常量
const (
	cliLargeFileThreshold     = int64(1 * 1024 * 1024)
	cliScanLargeFileThreshold = int64(10 * 1024 * 1024)
	cliTextureLargeWarning    = int64(32 * 1024 * 1024)
	cliPerformanceWarning     = int64(100 * 1024 * 1024)
	cliPerformanceCaution     = int64(50 * 1024 * 1024)
)

// fileBenchResult 文件基准测试结果
type fileBenchResult struct {
	Timestamp   string          `json:"timestamp"`
	Files       []fileBenchFile `json:"files"`
	SingleRead  benchSummary    `json:"single_read"`
	BatchRead   benchSummary    `json:"batch_read"`
	IPCOverhead ipcEstimate     `json:"ipc_overhead"`
}

type fileBenchFile struct {
	Path           string  `json:"path"`
	Size           int64   `json:"size"`
	AvgMs          float64 `json:"avg_ms"`
	ThroughputMBps float64 `json:"throughput_mbps"`
}

type benchSummary struct {
	AvgMs      float64 `json:"avg_ms"`
	MinMs      float64 `json:"min_ms"`
	MaxMs      float64 `json:"max_ms"`
	Throughput float64 `json:"throughput_mbps"`
}

type ipcEstimate struct {
	OriginalSize      int64   `json:"original_size"`
	Base64Size        int64   `json:"base64_size"`
	InflationRatio    float64 `json:"inflation_ratio"`
	SerDescOverheadMs float64 `json:"serde_overhead_ms"`
}

// fileBenchItem 文件基准测试项
type fileBenchItem struct {
	Path  string  `json:"path"`
	Size  int64   `json:"size"`
	AvgMs float64 `json:"avg_ms"`
}

// durationFormat 格式化时长为易读字符串
func durationFormat(ms float64) string {
	if ms < 10 {
		return fmt.Sprintf("%.2fms", ms)
	}
	if ms < 1000 {
		return fmt.Sprintf("%.0fms", ms)
	}
	return fmt.Sprintf("%.2fs", ms/1000)
}

// avgDuration 计算平均时长
func avgDuration(durations []time.Duration) time.Duration {
	if len(durations) == 0 {
		return 0
	}
	var total time.Duration
	for _, d := range durations {
		total += d
	}
	return total / time.Duration(len(durations))
}

// durationMinMax 返回时长集合的最小与最大（空集合返回 0,0）
func durationMinMax(durations []time.Duration) (min, max time.Duration) {
	if len(durations) == 0 {
		return 0, 0
	}
	min, max = durations[0], durations[0]
	for _, d := range durations[1:] {
		if d < min {
			min = d
		}
		if d > max {
			max = d
		}
	}
	return min, max
}

// summarizeBench 从文件级平均耗时/吞吐聚合 SingleRead 汇总
// AvgMs/Throughput 取各文件均值，MinMs/MaxMs 取文件级最值（诊断基准口径）
func summarizeBench(avgMs, thrpt []float64) benchSummary {
	if len(avgMs) == 0 {
		return benchSummary{}
	}
	var sumMs, sumThrpt float64
	minMs, maxMs := avgMs[0], avgMs[0]
	for i, ms := range avgMs {
		sumMs += ms
		if ms < minMs {
			minMs = ms
		}
		if ms > maxMs {
			maxMs = ms
		}
		if i < len(thrpt) {
			sumThrpt += thrpt[i]
		}
	}
	n := float64(len(avgMs))
	return benchSummary{
		AvgMs:      sumMs / n,
		MinMs:      minMs,
		MaxMs:      maxMs,
		Throughput: sumThrpt / n,
	}
}

// benchFileInfo 待测文件（路径 + 大小）——runFileBench 内部聚合用。
type benchFileInfo struct {
	path string
	size int64
}

// collectBenchFiles 解析 --file / --dir 得到待测文件清单：
// --file 直接采信（stat 失败由 statBenchFiles 剔除）；--dir 走 WalkDir 收集大于
// cliLargeFileThreshold 的文件，异常路径只计数跳过、不中断整轮扫描。
func collectBenchFiles(testDir, filePath string) ([]string, error) {
	var files []string
	var walkErrCount int

	switch {
	case filePath != "":
		files = append(files, filePath)
	case testDir != "":
		_ = filepath.WalkDir(testDir, func(path string, d iofs.DirEntry, err error) error {
			if err != nil {
				walkErrCount++
				return nil
			}
			if !d.IsDir() {
				info, ierr := d.Info()
				if ierr != nil {
					walkErrCount++
					return nil
				}
				if info.Size() > cliLargeFileThreshold {
					files = append(files, path)
				}
			}
			return nil
		})
		if walkErrCount > 0 {
			fmt.Printf("⚠️  扫描跳过 %d 个异常路径\n", walkErrCount)
		}
	default:
		return nil, newParamErrf("请指定 --dir 或 --file 参数")
	}

	return files, nil
}

// statBenchFiles 对清单逐个 stat，剔除扫描后被删的路径（失败跳过，不中断）。
func statBenchFiles(files []string) []benchFileInfo {
	var out []benchFileInfo
	for _, f := range files {
		info, err := os.Stat(f)
		if err != nil {
			continue
		}
		out = append(out, benchFileInfo{path: f, size: info.Size()})
	}
	return out
}

// printBenchFileList 打印待测文件清单（超长名截断到 47+...），返回总大小
// （批量吞吐与 IPC 度量共用同一口径）。
func printBenchFileList(fileInfos []benchFileInfo) int64 {
	fmt.Println("📁 待测试文件:")
	totalSize := int64(0)
	for i, fi := range fileInfos {
		name := filepath.Base(fi.path)
		if len(name) > 50 {
			name = name[:47] + "..."
		}
		fmt.Printf("   [%d] %-50s %s\n", i+1, name, fsutil.FormatSize(fi.size))
		totalSize += fi.size
	}
	fmt.Printf("\n   总大小: %s\n\n", fsutil.FormatSize(totalSize))
	return totalSize
}

// measureSingleRead 逐文件重复读取 iterations 次，打印每文件平均耗时/吞吐，
// 返回文件级平均毫秒与吞吐（供 SingleRead 汇总归档，#8：测量曾做但不写 JSON）。
func measureSingleRead(ctx *CmdContext, fileInfos []benchFileInfo, iterations int) (avgMs, thrpt []float64) {
	avgMs = make([]float64, 0, len(fileInfos))
	thrpt = make([]float64, 0, len(fileInfos))
	for _, fi := range fileInfos {
		name := filepath.Base(fi.path)
		readTimes := make([]time.Duration, iterations)

		for i := 0; i < iterations; i++ {
			start := time.Now()
			data := ctx.App.ReadFileBytes(fi.path)
			readTimes[i] = time.Since(start)
			_ = data
		}

		avgTime := avgDuration(readTimes)
		throughput := 0.0
		if avgTime > 0 {
			throughput = float64(fi.size) / avgTime.Seconds() / (1024 * 1024)
		}
		avgMs = append(avgMs, float64(avgTime)/float64(time.Millisecond))
		thrpt = append(thrpt, throughput)

		fmt.Printf("   %s (%s):\n", name, fsutil.FormatSize(fi.size))
		fmt.Printf("     平均耗时: %v | 吞吐: %.1f MB/s\n", avgTime, throughput)
	}
	return avgMs, thrpt
}

// measureBatchRead 批量读取测量并打印报告段；文件数 ≤1 时不测量，返回零值汇总
// （零值即「未测」标记，JSON 载荷与拆分前逐字段一致）。
func measureBatchRead(ctx *CmdContext, fileInfos []benchFileInfo, totalSize int64, iterations int) benchSummary {
	if len(fileInfos) <= 1 {
		return benchSummary{}
	}
	fmt.Println("\n📊 批量读取测试 (模拟 ReadFileBytesBatch):")
	paths := make([]string, len(fileInfos))
	for i, fi := range fileInfos {
		paths[i] = fi.path
	}

	batchTimes := make([]time.Duration, iterations)
	for i := 0; i < iterations; i++ {
		start := time.Now()
		results := ctx.App.ReadFileBytesBatch(paths)
		batchTimes[i] = time.Since(start)
		_ = results
	}

	avgBatch := avgDuration(batchTimes)
	minBatch, maxBatch := durationMinMax(batchTimes)
	batchThroughput := 0.0
	if avgBatch > 0 {
		batchThroughput = float64(totalSize) / avgBatch.Seconds() / (1024 * 1024)
	}
	fmt.Printf("   %d 个文件, 总大小 %s:\n", len(fileInfos), fsutil.FormatSize(totalSize))
	fmt.Printf("     平均耗时: %v | 吞吐: %.1f MB/s\n", avgBatch, batchThroughput)

	return benchSummary{
		AvgMs:      float64(avgBatch) / float64(time.Millisecond),
		MinMs:      float64(minBatch) / float64(time.Millisecond),
		MaxMs:      float64(maxBatch) / float64(time.Millisecond),
		Throughput: batchThroughput,
	}
}

// buildBenchResult 组装基准 JSON 载荷（--output 落盘与 --compare 真对比共用，#8 补全归档）。
func buildBenchResult(benchItems []fileBenchItem, fileThrpt []float64, single, batch benchSummary, ipc ipcEstimate) fileBenchResult {
	result := fileBenchResult{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Files:       make([]fileBenchFile, len(benchItems)),
		SingleRead:  single,
		BatchRead:   batch,
		IPCOverhead: ipc,
	}
	for i, f := range benchItems {
		result.Files[i] = fileBenchFile{Path: f.Path, Size: f.Size, AvgMs: f.AvgMs, ThroughputMBps: fileThrpt[i]}
	}
	return result
}

// saveBenchResult 把基准 JSON 落盘（--output）。
// 序列化失败显式上报（原实现静默吞——吞吐 Inf/异常值会使 JSON 静默不落盘）。
func saveBenchResult(output string, result fileBenchResult) error {
	jsonBytes, merr := json.MarshalIndent(result, "", "  ")
	if merr != nil {
		return newRuntimeErrf("序列化基准 JSON 失败: %v", merr)
	}
	if err := os.WriteFile(output, jsonBytes, fsutil.FilePerms); err != nil {
		return newRuntimeErrf("保存基准 JSON 失败: %v", err)
	}
	fmt.Printf("\n💾 基准已保存到: %s\n", output)
	return nil
}

// runFileBench 测试大文件读取性能（支持 JSON 输出和基准对比）
func runFileBench(ctx *CmdContext) error {
	fs := newCmdFlagSet("file-bench")
	testDir := fs.String("dir", "", "测试目录路径（扫描此目录下的大文件）")
	filePath := fs.String("file", "", "单个测试文件路径")
	iterations := fs.Int("iterations", 3, "迭代次数")
	output := fs.String("output", "", "输出文件路径（JSON 格式，用于基准对比）")
	compare := fs.String("compare", "", "对比基准文件路径")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *iterations <= 0 {
		return newParamErrf("--iterations 必须大于 0")
	}

	files, err := collectBenchFiles(*testDir, *filePath)
	if err != nil {
		return err
	}

	if len(files) == 0 {
		fmt.Printf("📭 没有找到大于 %s 的文件\n", fsutil.FormatSize(cliLargeFileThreshold))
		return nil
	}

	fmt.Printf("⚡ 文件读取性能测试\n")
	fmt.Printf("   文件数: %d\n", len(files))
	fmt.Printf("   迭代次数: %d\n\n", *iterations)

	fileInfos := statBenchFiles(files)
	totalSize := printBenchFileList(fileInfos)

	fmt.Println("📊 单文件读取测试:")
	// 收集每文件平均耗时/吞吐，供 SingleRead 汇总归档（#8：测量曾做但不写 JSON）
	fileAvgMs, fileThrpt := measureSingleRead(ctx, fileInfos, *iterations)

	// 批量读取汇总（文件数 >1 时才测量，零值表示未测）
	batchStats := measureBatchRead(ctx, fileInfos, totalSize, *iterations)

	benchItems := make([]fileBenchItem, len(fileInfos))
	for i, f := range fileInfos {
		benchItems[i] = fileBenchItem{Path: f.path, Size: f.size, AvgMs: fileAvgMs[i]}
	}

	fmt.Println("\n📊 IPC 传输开销测量:")
	overheadEstimate := calculateIPCOverhead(ctx.App, benchItems, *iterations)
	fmt.Printf("   原始大小:     %s\n", fsutil.FormatSize(totalSize))
	fmt.Printf("   Base64 膨胀:  %s (+%.0f%%)\n", fsutil.FormatSize(overheadEstimate.Base64Size), overheadEstimate.InflationRatio*100)
	fmt.Printf("   序列化开销:   ~%s\n", durationFormat(overheadEstimate.SerDescOverheadMs))

	// 基准结果无条件组装：--output 落盘与 --compare 真对比共用（#8 补全归档）
	result := buildBenchResult(benchItems, fileThrpt, summarizeBench(fileAvgMs, fileThrpt), batchStats, overheadEstimate)

	if *output != "" {
		if err := saveBenchResult(*output, result); err != nil {
			return err
		}
	}

	if *compare != "" {
		fmt.Println("\n📈 基准对比:")
		compareResult := loadAndCompareBenchmark(*compare, result)
		fmt.Println(compareResult)
	}

	return nil
}

// calculateIPCOverhead 实际测量 IPC 开销（#8：原实现忽略 files 只测 files[0]、
// serdeSpeedMBps=100 拍脑袋常量、测得的总时长还丢弃——现实测 Base64+JSON 序列化）
func calculateIPCOverhead(a AppService, files []fileBenchItem, iterations int) ipcEstimate {
	if len(files) == 0 {
		return ipcEstimate{}
	}

	original := a.ReadFileBytes(files[0].Path)
	originalSize := int64(len(original))
	if originalSize == 0 {
		return ipcEstimate{}
	}

	// 实测序列化：base64 编码 + JSON 包装（走 Wails 桥的真实载荷形态）
	var serdeTotal time.Duration
	var payload []byte
	completed := 0
	for i := 0; i < iterations; i++ {
		start := time.Now()
		// 基准实测序列化载荷：map+base64 结构固定无法失败，但错误不吞——留痕后跳出，
		// 避免 payload=nil 污染下方字节膨胀度量（ADR-176 2.4 非清理路径不含静默吞错）
		serdeErr := error(nil)
		payload, serdeErr = json.Marshal(map[string]string{"data": base64.StdEncoding.EncodeToString(original)})
		if serdeErr != nil {
			// 排障性失败原因走统一日志设施（stdlib log → stderr + 环形日志面板）
			log.Printf("⚠️  基准序列化失败: %v", serdeErr)
			break
		}
		serdeTotal += time.Since(start)
		completed++
	}
	if completed == 0 {
		return ipcEstimate{}
	}
	serdeTimeMs := float64(serdeTotal) / float64(time.Millisecond) / float64(completed)
	base64Size := int64(len(payload))
	inflation := 0.0
	if originalSize > 0 {
		inflation = float64(base64Size)/float64(originalSize) - 1
	}

	return ipcEstimate{
		OriginalSize:      originalSize,
		Base64Size:        base64Size,
		InflationRatio:    inflation,
		SerDescOverheadMs: serdeTimeMs,
	}
}

// loadAndCompareBenchmark 加载基准并对比 SingleRead/BatchRead/IPC 数值
// （#8：原实现只回显时间戳与文件数，无真对比）
func loadAndCompareBenchmark(baselinePath string, current fileBenchResult) string {
	data, err := os.ReadFile(baselinePath)
	if err != nil {
		return fmt.Sprintf("❌ 无法读取基准文件: %v", err)
	}

	var baseline fileBenchResult
	if err := json.Unmarshal(data, &baseline); err != nil {
		return fmt.Sprintf("❌ 基准文件格式错误: %v", err)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "📊 对比基准 (%s)\n   文件数: 基准 %d | 本次 %d\n", baseline.Timestamp, len(baseline.Files), len(current.Files))

	// 基准文件由旧版本生成（SingleRead 恒零）时给出提示而非误导性对比
	if baseline.SingleRead.AvgMs == 0 && baseline.BatchRead.AvgMs == 0 {
		fmt.Fprintf(&b, "   ⚠️  基准文件不含测量数据（旧版空壳 JSON），请重新 --output 生成后再对比\n")
		return b.String()
	}

	compareLine := func(label string, base, cur benchSummary) {
		if base.AvgMs == 0 && cur.AvgMs == 0 {
			return // 双方均未测量（如单文件无 BatchRead），跳过
		}
		if base.AvgMs == 0 || cur.AvgMs == 0 {
			fmt.Fprintf(&b, "   %s: 基准 avg=%.2fms 吞吐=%.1fMB/s | 本次 avg=%.2fms 吞吐=%.1fMB/s (一侧未测，跳过变化率)\n",
				label, base.AvgMs, base.Throughput, cur.AvgMs, cur.Throughput)
			return
		}
		delta := (cur.AvgMs - base.AvgMs) / base.AvgMs * 100
		fmt.Fprintf(&b, "   %s: avg %.2f → %.2f ms (%+.1f%%) | 吞吐 %.1f → %.1f MB/s\n",
			label, base.AvgMs, cur.AvgMs, delta, base.Throughput, cur.Throughput)
	}
	compareLine("单读", baseline.SingleRead, current.SingleRead)
	compareLine("批读", baseline.BatchRead, current.BatchRead)

	if baseline.IPCOverhead.OriginalSize > 0 {
		fmt.Fprintf(&b, "   IPC: 基准 Base64 膨胀 %.0f%% | 本次 %.0f%%\n",
			baseline.IPCOverhead.InflationRatio*100, current.IPCOverhead.InflationRatio*100)
	}
	return b.String()
}

// scanDirResult 目录扫描结果
