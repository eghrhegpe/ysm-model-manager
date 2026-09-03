package cli

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	iofs "io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
)

func init() {
	RegisterCommandC("file-bench", CatPerf, "测试大文件读取性能（模拟 MMD/PMX/VRM 加载）", runFileBench)
	RegisterCommandC("scan-dir", CatResource, "扫描 MMD 目录结构并统计资产", runScanDir)
	RegisterCommandC("analyze-mmd", CatResource, "分析 MMD 模型资产（贴图、PMX、VMD 等）", runAnalyzeMMD)
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

	var files []string
	var walkErrCount int

	if *filePath != "" {
		files = append(files, *filePath)
	} else if *testDir != "" {
		filepath.WalkDir(*testDir, func(path string, d iofs.DirEntry, err error) error {
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
				if info.Size() > 1*1024*1024 {
					files = append(files, path)
				}
			}
			return nil
		})
		if walkErrCount > 0 {
			fmt.Printf("⚠️  扫描跳过 %d 个异常路径\n", walkErrCount)
		}
	} else {
		return newParamErrf("请指定 --dir 或 --file 参数")
	}

	if len(files) == 0 {
		fmt.Printf("📭 没有找到大于 %s 的文件\n", formatSize(cliLargeFileThreshold))
		return nil
	}

	fmt.Printf("⚡ 文件读取性能测试\n")
	fmt.Printf("   文件数: %d\n", len(files))
	fmt.Printf("   迭代次数: %d\n\n", *iterations)

	type fileInfo struct {
		path string
		size int64
	}
	var fileInfos []fileInfo
	for _, f := range files {
		info, err := os.Stat(f)
		if err != nil {
			continue
		}
		fileInfos = append(fileInfos, fileInfo{path: f, size: info.Size()})
	}

	fmt.Println("📁 待测试文件:")
	totalSize := int64(0)
	for i, fi := range fileInfos {
		name := filepath.Base(fi.path)
		if len(name) > 50 {
			name = name[:47] + "..."
		}
		fmt.Printf("   [%d] %-50s %s\n", i+1, name, formatSize(fi.size))
		totalSize += fi.size
	}
	fmt.Printf("\n   总大小: %s\n\n", formatSize(totalSize))

	fmt.Println("📊 单文件读取测试:")
	// 收集每文件平均耗时/吞吐，供 SingleRead 汇总归档（评审 #8：测量曾做但不写 JSON）
	fileAvgMs := make([]float64, 0, len(fileInfos))
	fileThrpt := make([]float64, 0, len(fileInfos))
	for _, fi := range fileInfos {
		name := filepath.Base(fi.path)
		readTimes := make([]time.Duration, *iterations)

		for i := 0; i < *iterations; i++ {
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
		fileAvgMs = append(fileAvgMs, float64(avgTime)/float64(time.Millisecond))
		fileThrpt = append(fileThrpt, throughput)

		fmt.Printf("   %s (%s):\n", name, formatSize(fi.size))
		fmt.Printf("     平均耗时: %v | 吞吐: %.1f MB/s\n", avgTime, throughput)
	}

	// 批量读取汇总（文件数 >1 时才测量，零值表示未测）
	var avgBatch time.Duration
	var minBatch, maxBatch time.Duration
	var batchThroughput float64
	if len(fileInfos) > 1 {
		fmt.Println("\n📊 批量读取测试 (模拟 ReadFileBytesBatch):")
		paths := make([]string, len(fileInfos))
		for i, fi := range fileInfos {
			paths[i] = fi.path
		}

		batchTimes := make([]time.Duration, *iterations)
		for i := 0; i < *iterations; i++ {
			start := time.Now()
			results := ctx.App.ReadFileBytesBatch(paths)
			batchTimes[i] = time.Since(start)
			_ = results
		}

		avgBatch = avgDuration(batchTimes)
		minBatch, maxBatch = durationMinMax(batchTimes)
		if avgBatch > 0 {
			batchThroughput = float64(totalSize) / avgBatch.Seconds() / (1024 * 1024)
		}
		fmt.Printf("   %d 个文件, 总大小 %s:\n", len(fileInfos), formatSize(totalSize))
		fmt.Printf("     平均耗时: %v | 吞吐: %.1f MB/s\n", avgBatch, batchThroughput)
	}

	benchItems := make([]fileBenchItem, len(fileInfos))
	for i, f := range fileInfos {
		benchItems[i] = fileBenchItem{Path: f.path, Size: f.size, AvgMs: fileAvgMs[i]}
	}

	fmt.Println("\n📊 IPC 传输开销测量:")
	overheadEstimate := calculateIPCOverhead(ctx.App, benchItems, *iterations)
	fmt.Printf("   原始大小:     %s\n", formatSize(totalSize))
	fmt.Printf("   Base64 膨胀:  %s (+%.0f%%)\n", formatSize(overheadEstimate.Base64Size), overheadEstimate.InflationRatio*100)
	fmt.Printf("   序列化开销:   ~%s\n", durationFormat(overheadEstimate.SerDescOverheadMs))

	// 基准结果无条件组装：--output 落盘与 --compare 真对比共用（评审 #8 补全归档）
	result := fileBenchResult{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Files:       make([]fileBenchFile, len(benchItems)),
		SingleRead:  summarizeBench(fileAvgMs, fileThrpt),
		IPCOverhead: overheadEstimate,
	}
	if len(fileInfos) > 1 {
		result.BatchRead = benchSummary{
			AvgMs:      float64(avgBatch) / float64(time.Millisecond),
			MinMs:      float64(minBatch) / float64(time.Millisecond),
			MaxMs:      float64(maxBatch) / float64(time.Millisecond),
			Throughput: batchThroughput,
		}
	}
	for i, f := range benchItems {
		result.Files[i] = fileBenchFile{Path: f.Path, Size: f.Size, AvgMs: f.AvgMs, ThroughputMBps: fileThrpt[i]}
	}

	if *output != "" {
		// 序列化失败显式上报（原实现静默吞——吞吐 Inf/异常值会使 JSON 静默不落盘）
		jsonBytes, merr := json.MarshalIndent(result, "", "  ")
		if merr != nil {
			return newRuntimeErrf("序列化基准 JSON 失败: %v", merr)
		}
		if err := os.WriteFile(*output, jsonBytes, fsutil.FilePerms); err != nil {
			return newRuntimeErrf("保存基准 JSON 失败: %v", err)
		}
		fmt.Printf("\n💾 基准已保存到: %s\n", *output)
	}

	if *compare != "" {
		fmt.Println("\n📈 基准对比:")
		compareResult := loadAndCompareBenchmark(*compare, result)
		fmt.Println(compareResult)
	}

	return nil
}

// calculateIPCOverhead 实际测量 IPC 开销（评审 #8：原实现忽略 files 只测 files[0]、
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
	for i := 0; i < iterations; i++ {
		start := time.Now()
		payload, _ = json.Marshal(map[string]string{"data": base64.StdEncoding.EncodeToString(original)})
		serdeTotal += time.Since(start)
	}
	serdeTimeMs := float64(serdeTotal) / float64(time.Millisecond) / float64(iterations)
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
// （评审 #8：原实现只回显时间戳与文件数，无真对比）
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
type scanDirResult struct {
	Timestamp   string        `json:"timestamp"`
	Directory   string        `json:"directory"`
	TotalFiles  int           `json:"total_files"`
	TotalDirs   int           `json:"total_dirs"`
	TotalSize   int64         `json:"total_size"`
	ByExtension []extStatItem `json:"by_extension"`
	Largest     []largeFile   `json:"largest_files"`
}

type extStatItem struct {
	Ext   string `json:"ext"`
	Count int    `json:"count"`
	Size  int64  `json:"size"`
}

type largeFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// runScanDir 扫描目录结构（支持 JSON 输出）
func runScanDir(ctx *CmdContext) error {
	fs := newCmdFlagSet("scan-dir")
	dirPath := fs.String("dir", "", "目录路径")
	detail := fs.Bool("detail", false, "显示详细文件列表")
	output := fs.String("output", "", "输出文件路径（JSON 格式）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *dirPath == "" {
		return newParamErrf("--dir 参数不能为空")
	}

	fmt.Printf("📁 扫描目录: %s\n\n", *dirPath)

	var (
		totalFiles   int
		totalDirs    int
		totalSize    int64
		extCount     = make(map[string]int)
		extSize      = make(map[string]int64)
		largestFiles []struct {
			path string
			size int64
		}
	)

	threshold := cliScanLargeFileThreshold

	var walkErrors []string

	err = filepath.Walk(*dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			walkErrors = append(walkErrors, fmt.Sprintf("%s: %v", path, err))
			return nil
		}

		if info.IsDir() {
			totalDirs++
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()
		totalFiles++
		totalSize += size

		extCount[ext]++
		extSize[ext] += size

		if size > threshold {
			largestFiles = append(largestFiles, struct {
				path string
				size int64
			}{path: path, size: size})
		}

		return nil
	})

	if err != nil {
		return newRuntimeErrf("扫描目录失败: %v", err)
	}

	if len(walkErrors) > 0 {
		fmt.Printf("⚠️  扫描跳过 %d 个异常路径:\n", len(walkErrors))
		for _, w := range walkErrors {
			fmt.Printf("   - %s\n", w)
		}
		fmt.Println()
	}

	result := scanDirResult{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Directory:   *dirPath,
		TotalFiles:  totalFiles,
		TotalDirs:   totalDirs,
		TotalSize:   totalSize,
		ByExtension: make([]extStatItem, 0, len(extCount)),
		Largest:     make([]largeFile, 0, len(largestFiles)),
	}
	for ext, count := range extCount {
		result.ByExtension = append(result.ByExtension, extStatItem{
			Ext:   ext,
			Count: count,
			Size:  extSize[ext],
		})
	}
	for _, f := range largestFiles {
		result.Largest = append(result.Largest, largeFile{Path: f.path, Size: f.size})
	}

	if *output != "" {
		if jsonBytes, err := json.MarshalIndent(result, "", "  "); err == nil {
			if err := os.WriteFile(*output, jsonBytes, fsutil.FilePerms); err != nil {
				return newRuntimeErrf("保存 JSON 文件失败: %v", err)
			}
			fmt.Printf("💾 JSON 已保存到: %s\n\n", *output)
			return nil
		} else {
			return newRuntimeErrf("JSON 序列化失败: %v", err)
		}
	}

	fmt.Printf("📊 目录统计:\n")
	fmt.Printf("   目录数:   %d\n", totalDirs)
	fmt.Printf("   文件数:   %d\n", totalFiles)
	fmt.Printf("   总大小:   %s\n\n", formatSize(totalSize))

	fmt.Println("📋 按扩展名分组:")
	type extStat struct {
		ext   string
		count int
		size  int64
	}
	var stats []extStat
	for ext, count := range extCount {
		stats = append(stats, extStat{ext, count, extSize[ext]})
	}
	// 按大小降序（sort.Slice 替代手写选择排序，评审 #7）
	sort.Slice(stats, func(i, j int) bool { return stats[i].size > stats[j].size })

	fmt.Printf("   %-10s %-8s %s\n", "扩展名", "数量", "总大小")
	fmt.Println("   " + strings.Repeat("-", 50))
	for _, s := range stats {
		fmt.Printf("   %-10s %-8d %s\n", s.ext, s.count, formatSize(s.size))
	}

	if len(largestFiles) > 0 {
		fmt.Printf("\n⚠️  大文件列表 (>10MB, 共 %d 个):\n", len(largestFiles))
		for i, lf := range largestFiles {
			if i >= 10 {
				fmt.Printf("   ... 还有 %d 个\n", len(largestFiles)-10)
				break
			}
			relPath := strings.TrimPrefix(lf.path, *dirPath)
			fmt.Printf("   [%d] %s (%s)\n", i+1, relPath, formatSize(lf.size))
		}
	}

	if *detail && totalFiles > 0 {
		fmt.Printf("\n📝 文件详情 (前 20 个):\n")
		count := 0
		filepath.WalkDir(*dirPath, func(path string, d iofs.DirEntry, err error) error {
			if err != nil || d.IsDir() || count >= 20 {
				return nil
			}
			relPath := strings.TrimPrefix(path, *dirPath)
			info, ierr := d.Info()
			if ierr != nil {
				return nil
			}
			fmt.Printf("   %s (%s)\n", relPath, formatSize(info.Size()))
			count++
			return nil
		})
		if totalFiles > 20 {
			fmt.Printf("   ... 还有 %d 个文件\n", totalFiles-20)
		}
	}

	return nil
}

// runAnalyzeMMD 分析 MMD 模型资产
// mmdAssetScan 保存 analyze-mmd 目录扫描的聚合结果。
type mmdAssetScan struct {
	ModelFiles    []string
	VrmFiles      []string
	VmdFiles      []string
	VpdFiles      []string
	TextureFiles  []string
	TextureSize   int64
	ModelSize     int64
	WalkErrCount  int
	WalkTotalDirs int
}

// textureExts analyze-mmd 扫描的贴图扩展名集合。
var textureExts = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".tga":  true,
	".bmp":  true,
	".dds":  true,
	".ktx2": true,
}

// scanMMDAssets 遍历目录并按扩展名分类聚合资产。
func scanMMDAssets(modelDir string) (*mmdAssetScan, error) {
	s := &mmdAssetScan{}
	err := filepath.Walk(modelDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			s.WalkErrCount++
			return nil
		}
		if info.IsDir() {
			s.WalkTotalDirs++
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()

		switch ext {
		case ".pmx", ".pmd":
			s.ModelFiles = append(s.ModelFiles, path)
			s.ModelSize += size
		case ".vrm":
			s.VrmFiles = append(s.VrmFiles, path)
			s.ModelSize += size
		case ".vmd":
			s.VmdFiles = append(s.VmdFiles, path)
		case ".vpd":
			s.VpdFiles = append(s.VpdFiles, path)
		default:
			if textureExts[ext] {
				s.TextureFiles = append(s.TextureFiles, path)
				s.TextureSize += size
			}
		}

		return nil
	})
	return s, err
}

// texInfo 贴图信息（路径、大小、扩展名）。
type texInfo struct {
	path string
	size int64
	ext  string
}

// collectTexInfos 对贴图列表 stat 取大小，按大小降序排序后返回。
func collectTexInfos(textureFiles []string) []texInfo {
	var texInfos []texInfo
	for _, tf := range textureFiles {
		info, err := os.Stat(tf)
		if err != nil {
			continue // 文件在扫描后被移除，跳过
		}
		ext := strings.ToLower(filepath.Ext(tf))
		texInfos = append(texInfos, texInfo{path: tf, size: info.Size(), ext: ext})
	}

	// 按大小降序（sort.Slice 替代手写 O(n²) 选择排序——千张贴图即百万次比较，评审 #7）
	sort.Slice(texInfos, func(i, j int) bool { return texInfos[i].size > texInfos[j].size })

	return texInfos
}

// printTextureDetails 打印贴图详情：按格式聚合、Top 10、性能预警。
func printTextureDetails(textureFiles []string, modelDir string) {
	fmt.Printf("\n🖼️  贴图详情:\n")

	texInfos := collectTexInfos(textureFiles)

	extSizeMap := make(map[string]int64)
	for _, ti := range texInfos {
		extSizeMap[ti.ext] += ti.size
	}

	fmt.Printf("   按格式:\n")
	for ext, size := range extSizeMap {
		fmt.Printf("     %s: %s\n", ext, formatSize(size))
	}

	fmt.Printf("\n   最大贴图 Top 10:\n")
	for i := 0; i < min(10, len(texInfos)); i++ {
		relPath := strings.TrimPrefix(texInfos[i].path, modelDir)
		fmt.Printf("     [%d] %s (%s) %s\n", i+1, relPath, texInfos[i].ext, formatSize(texInfos[i].size))
	}

	fmt.Printf("\n⚠️  性能预警:\n")
	largeTextures := 0
	for _, ti := range texInfos {
		if ti.size > cliTextureLargeWarning {
			largeTextures++
		}
	}
	if largeTextures > 0 {
		fmt.Printf("   🔴 有 %d 个贴图大于 %s，建议压缩或转换为 KTX2\n", largeTextures, formatSize(cliTextureLargeWarning))
	} else {
		fmt.Printf("   ✅ 无超大贴图\n")
	}

	tgaSize := extSizeMap[".tga"] + extSizeMap[".dds"]
	if tgaSize > 0 {
		fmt.Printf("   🟡 TGA/DDS 贴图占 %s，建议转换为 PNG 或 KTX2\n", formatSize(tgaSize))
	}
}

// printOverallAssessment 打印总体评估：总大小 + 性能分级。
func printOverallAssessment(modelSize, textureSize int64) {
	fmt.Printf("\n📈 总体评估:\n")
	totalAssetsSize := modelSize + textureSize
	fmt.Printf("   模型+贴图总大小: %s\n", formatSize(totalAssetsSize))

	if totalAssetsSize > cliPerformanceWarning {
		fmt.Printf("   🔴 大于 %s，首次加载预计 > 10s\n", formatSize(cliPerformanceWarning))
		fmt.Printf("   💡 建议: 使用 KTX2 压缩贴图，可减少 60-70%% 体积\n")
	} else if totalAssetsSize > cliPerformanceCaution {
		fmt.Printf("   🟡 %s-%s，首次加载可能 5-10s\n", formatSize(cliPerformanceCaution), formatSize(cliPerformanceWarning))
	} else {
		fmt.Printf("   🟢 小于 %s，加载性能应该可以接受\n", formatSize(cliPerformanceCaution))
	}
}

func runAnalyzeMMD(ctx *CmdContext) error {
	fs := newCmdFlagSet("analyze-mmd")
	modelDir := fs.String("dir", "", "MMD 模型目录路径")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *modelDir == "" {
		return newParamErrf("--dir 参数不能为空")
	}

	fmt.Printf("🎭 MMD 模型资产分析: %s\n\n", *modelDir)

	scan, err := scanMMDAssets(*modelDir)
	if err != nil {
		return newRuntimeErrf("分析目录失败: %v", err)
	}

	// 错误率过高时提前返回（>50% 路径无法访问说明系统性问题）
	// 分母 = 错误数 + 成功目录数（总尝试路径），与分子同口径：
	// 文件级瞬时错误（如扫描中被删）不虚高分子，避免误中止整个分析
	if scan.WalkTotalDirs+scan.WalkErrCount > 0 {
		errRate := float64(scan.WalkErrCount) / float64(scan.WalkTotalDirs+scan.WalkErrCount)
		if errRate > 0.5 {
			return newRuntimeErrf("扫描错误率过高: %d/%d 路径无法访问 (%.0f%%)", scan.WalkErrCount, scan.WalkTotalDirs+scan.WalkErrCount, errRate*100)
		}
	}

	if scan.WalkErrCount > 0 {
		fmt.Printf("⚠️  扫描跳过 %d 个异常路径\n", scan.WalkErrCount)
	}

	fmt.Printf("📊 资产统计:\n")
	fmt.Printf("   PMX/PMD 模型:  %d 个 (%s)\n", len(scan.ModelFiles), formatSize(scan.ModelSize))
	fmt.Printf("   VRM 模型:      %d 个\n", len(scan.VrmFiles))
	fmt.Printf("   VMD 动画:      %d 个\n", len(scan.VmdFiles))
	fmt.Printf("   VPD 物理:      %d 个\n", len(scan.VpdFiles))
	fmt.Printf("   贴图文件:      %d 个 (%s)\n", len(scan.TextureFiles), formatSize(scan.TextureSize))

	if len(scan.TextureFiles) > 0 {
		printTextureDetails(scan.TextureFiles, *modelDir)
	}

	if len(scan.ModelFiles) > 0 {
		fmt.Printf("\n📦 模型文件:\n")
		for i, pf := range scan.ModelFiles {
			info, err := os.Stat(pf)
			if err != nil {
				continue // 文件在扫描后被移除，跳过
			}
			relPath := strings.TrimPrefix(pf, *modelDir)
			fmt.Printf("   [%d] %s (%s)\n", i+1, relPath, formatSize(info.Size()))
		}
	}

	printOverallAssessment(scan.ModelSize, scan.TextureSize)

	return nil
}
