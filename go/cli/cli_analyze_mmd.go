// cli_analyze_mmd.go：analyze-mmd 命令（原 mmd.go 拆分，2026-10 文件行数治理）。
// 分析 MMD 模型资产（mmdAssetScan / texInfo / collectTexInfos / printOverallAssessment）。
package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/fsutil"
)

func init() {
	RegisterCommandC("analyze-mmd", CatResource, "分析 MMD 模型资产（贴图、PMX、VMD 等）", runAnalyzeMMD)
}

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
	// 根目录不存在/不可读时 filepath.Walk 仅回调一次错误即返回 nil：
	// WalkErrCount=1、WalkTotalDirs=0 → 错误率恒 100%，把「路径写错」
	// 误报成「系统性问题：错误率过高」。入口先判存在性，给出准确结论。
	if di, serr := os.Stat(modelDir); serr != nil {
		return nil, fmt.Errorf("目录不存在或无法访问: %w", serr)
	} else if !di.IsDir() {
		return nil, fmt.Errorf("路径不是目录: %s", modelDir)
	}

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

	// 按大小降序（sort.Slice 替代手写 O(n²) 选择排序——千张贴图即百万次比较，#7）
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
		fmt.Printf("     %s: %s\n", ext, fsutil.FormatSize(size))
	}

	fmt.Printf("\n   最大贴图 Top 10:\n")
	for i := 0; i < min(10, len(texInfos)); i++ {
		relPath := strings.TrimPrefix(texInfos[i].path, modelDir)
		fmt.Printf("     [%d] %s (%s) %s\n", i+1, relPath, texInfos[i].ext, fsutil.FormatSize(texInfos[i].size))
	}

	fmt.Printf("\n⚠️  性能预警:\n")
	largeTextures := 0
	for _, ti := range texInfos {
		if ti.size > cliTextureLargeWarning {
			largeTextures++
		}
	}
	if largeTextures > 0 {
		fmt.Printf("   🔴 有 %d 个贴图大于 %s，建议压缩或转换为 KTX2\n", largeTextures, fsutil.FormatSize(cliTextureLargeWarning))
	} else {
		fmt.Printf("   ✅ 无超大贴图\n")
	}

	tgaSize := extSizeMap[".tga"] + extSizeMap[".dds"]
	if tgaSize > 0 {
		fmt.Printf("   🟡 TGA/DDS 贴图占 %s，建议转换为 PNG 或 KTX2\n", fsutil.FormatSize(tgaSize))
	}
}

// printOverallAssessment 打印总体评估：总大小 + 性能分级。
func printOverallAssessment(modelSize, textureSize int64) {
	fmt.Printf("\n📈 总体评估:\n")
	totalAssetsSize := modelSize + textureSize
	fmt.Printf("   模型+贴图总大小: %s\n", fsutil.FormatSize(totalAssetsSize))

	switch {
	case totalAssetsSize > cliPerformanceWarning:
		fmt.Printf("   🔴 大于 %s，首次加载预计 > 10s\n", fsutil.FormatSize(cliPerformanceWarning))
		fmt.Printf("   💡 建议: 使用 KTX2 压缩贴图，可减少 60-70%% 体积\n")
	case totalAssetsSize > cliPerformanceCaution:
		fmt.Printf("   🟡 %s-%s，首次加载可能 5-10s\n", fsutil.FormatSize(cliPerformanceCaution), fsutil.FormatSize(cliPerformanceWarning))
	default:
		fmt.Printf("   🟢 小于 %s，加载性能应该可以接受\n", fsutil.FormatSize(cliPerformanceCaution))
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
	fmt.Printf("   PMX/PMD 模型:  %d 个 (%s)\n", len(scan.ModelFiles), fsutil.FormatSize(scan.ModelSize))
	fmt.Printf("   VRM 模型:      %d 个\n", len(scan.VrmFiles))
	fmt.Printf("   VMD 动画:      %d 个\n", len(scan.VmdFiles))
	fmt.Printf("   VPD 物理:      %d 个\n", len(scan.VpdFiles))
	fmt.Printf("   贴图文件:      %d 个 (%s)\n", len(scan.TextureFiles), fsutil.FormatSize(scan.TextureSize))

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
			fmt.Printf("   [%d] %s (%s)\n", i+1, relPath, fsutil.FormatSize(info.Size()))
		}
	}

	printOverallAssessment(scan.ModelSize, scan.TextureSize)

	return nil
}
