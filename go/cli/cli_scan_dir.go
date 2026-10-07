// cli_scan_dir.go：scan-dir 命令（原 mmd.go 拆分，2026-10 文件行数治理）。
// 扫描 MMD 目录结构并统计资产（scanDirResult / walkDirStats / printScanDirReport）。
package cli

import (
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
	RegisterCommandC("scan-dir", CatResource, "扫描 MMD 目录结构并统计资产", runScanDir)
}

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

// dirWalkStats scan-dir 的遍历累加器：总数 / 按扩展名分组 / 大文件清单 / 异常路径。
type dirWalkStats struct {
	totalFiles int
	totalDirs  int
	totalSize  int64
	extCount   map[string]int
	extSize    map[string]int64
	largest    []largeFile
	walkErrors []string
}

// walkDirStats 遍历目录累计统计；单个路径不可访问只记入 walkErrors 并继续，
// 不中断整轮扫描（根目录本身不存在时 Walk 仅回调一次错误即返回 nil，见调用方口径）。
func walkDirStats(dirPath string) (*dirWalkStats, error) {
	st := &dirWalkStats{
		extCount: make(map[string]int),
		extSize:  make(map[string]int64),
	}
	threshold := cliScanLargeFileThreshold

	err := filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			st.walkErrors = append(st.walkErrors, fmt.Sprintf("%s: %v", path, err))
			return nil
		}

		if info.IsDir() {
			st.totalDirs++
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		size := info.Size()
		st.totalFiles++
		st.totalSize += size

		st.extCount[ext]++
		st.extSize[ext] += size

		if size > threshold {
			st.largest = append(st.largest, largeFile{Path: path, Size: size})
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return st, nil
}

// printWalkErrors 逐条打印遍历异常路径（扫到但读不到的路径如实回报，不静默丢弃）。
func printWalkErrors(walkErrors []string) {
	if len(walkErrors) == 0 {
		return
	}
	fmt.Printf("⚠️  扫描跳过 %d 个异常路径:\n", len(walkErrors))
	for _, w := range walkErrors {
		fmt.Printf("   - %s\n", w)
	}
	fmt.Println()
}

// buildScanDirResult 把遍历累加器转成 JSON 载荷（按扩展名分组 + 大文件清单）。
func buildScanDirResult(dirPath string, st *dirWalkStats) scanDirResult {
	result := scanDirResult{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		Directory:   dirPath,
		TotalFiles:  st.totalFiles,
		TotalDirs:   st.totalDirs,
		TotalSize:   st.totalSize,
		ByExtension: make([]extStatItem, 0, len(st.extCount)),
		Largest:     make([]largeFile, 0, len(st.largest)),
	}
	for ext, count := range st.extCount {
		result.ByExtension = append(result.ByExtension, extStatItem{
			Ext:   ext,
			Count: count,
			Size:  st.extSize[ext],
		})
	}
	result.Largest = append(result.Largest, st.largest...)
	return result
}

// saveScanDirJSON 落盘扫描结果（--output）：写成功后打印路径并收口，不再打印文本报告。
func saveScanDirJSON(output string, result scanDirResult) error {
	jsonBytes, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return newRuntimeErrf("JSON 序列化失败: %v", err)
	}
	if err := os.WriteFile(output, jsonBytes, fsutil.FilePerms); err != nil {
		return newRuntimeErrf("保存 JSON 文件失败: %v", err)
	}
	fmt.Printf("💾 JSON 已保存到: %s\n\n", output)
	return nil
}

// printScanDirReport 打印文本报告：目录统计 + 按扩展名分组（按大小降序）+ 大文件清单（前 10）。
func printScanDirReport(st *dirWalkStats, dirPath string) {
	fmt.Printf("📊 目录统计:\n")
	fmt.Printf("   目录数:   %d\n", st.totalDirs)
	fmt.Printf("   文件数:   %d\n", st.totalFiles)
	fmt.Printf("   总大小:   %s\n\n", fsutil.FormatSize(st.totalSize))

	fmt.Println("📋 按扩展名分组:")
	type extStat struct {
		ext   string
		count int
		size  int64
	}
	var stats []extStat
	for ext, count := range st.extCount {
		stats = append(stats, extStat{ext, count, st.extSize[ext]})
	}
	// 按大小降序（sort.Slice 替代手写选择排序，#7）
	sort.Slice(stats, func(i, j int) bool { return stats[i].size > stats[j].size })

	fmt.Printf("   %-10s %-8s %s\n", "扩展名", "数量", "总大小")
	fmt.Println("   " + strings.Repeat("-", 50))
	for _, s := range stats {
		fmt.Printf("   %-10s %-8d %s\n", s.ext, s.count, fsutil.FormatSize(s.size))
	}

	if len(st.largest) == 0 {
		return
	}
	fmt.Printf("\n⚠️  大文件列表 (>10MB, 共 %d 个):\n", len(st.largest))
	for i, lf := range st.largest {
		if i >= 10 {
			fmt.Printf("   ... 还有 %d 个\n", len(st.largest)-10)
			break
		}
		relPath := strings.TrimPrefix(lf.Path, dirPath)
		fmt.Printf("   [%d] %s (%s)\n", i+1, relPath, fsutil.FormatSize(lf.Size))
	}
}

// printScanDirDetail --detail：列前 20 个文件。count 到 20 后仍走完遍历
// （保持原「只截断输出、不提前终止遍历」语义），末尾补剩余计数。
func printScanDirDetail(dirPath string, totalFiles int) {
	fmt.Printf("\n📝 文件详情 (前 20 个):\n")
	count := 0
	_ = filepath.WalkDir(dirPath, func(path string, d iofs.DirEntry, err error) error {
		if err != nil || d.IsDir() || count >= 20 {
			return nil
		}
		relPath := strings.TrimPrefix(path, dirPath)
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		fmt.Printf("   %s (%s)\n", relPath, fsutil.FormatSize(info.Size()))
		count++
		return nil
	})
	if totalFiles > 20 {
		fmt.Printf("   ... 还有 %d 个文件\n", totalFiles-20)
	}
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

	st, err := walkDirStats(*dirPath)
	if err != nil {
		return newRuntimeErrf("扫描目录失败: %v", err)
	}

	printWalkErrors(st.walkErrors)

	if *output != "" {
		return saveScanDirJSON(*output, buildScanDirResult(*dirPath, st))
	}

	printScanDirReport(st, *dirPath)

	if *detail && st.totalFiles > 0 {
		printScanDirDetail(*dirPath, st.totalFiles)
	}

	return nil
}

// runAnalyzeMMD 分析 MMD 模型资产
// mmdAssetScan 保存 analyze-mmd 目录扫描的聚合结果。
