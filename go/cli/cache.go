package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/texture_cache"
)

func init() {
	RegisterCommandC("cache-status", CatCache, "查看纹理缓存状态（路径、大小、文件数）", runCacheStatus)
	RegisterCommandC("cache-verify", CatCache, "检查模型贴图的缓存命中情况", runCacheVerify)
	RegisterCommandC("cache-clear", CatCache, "清空纹理缓存", runCacheClear)
	RegisterCommandC("cache-diag", CatCache, "诊断缓存流程（哈希计算、读写功能、目录权限）", runCacheDiag)
}

// runCacheStatus 查看纹理缓存状态
func runCacheStatus(ctx *CmdContext) error {

	stats := texture_cache.GetCacheStats()
	files, _ := texture_cache.ListCacheFiles()

	fmt.Printf("💾 纹理缓存状态\n")
	fmt.Printf("   缓存目录: %s\n", stats.Dir)

	if stats.Dir == "" {
		fmt.Printf("   ⚠️  缓存目录不可用（平台配置根路径为空）\n")
		return nil
	}

	fmt.Printf("   文件数量: %d\n", stats.FileCount)
	fmt.Printf("   总大小:   %s\n\n", formatSize(stats.TotalSize))

	if stats.FileCount == 0 {
		fmt.Println("📭 缓存为空")
		fmt.Println()
		fmt.Println("💡 提示: 首次加载模型时，系统会自动压缩贴图并写入缓存。")
		fmt.Println("   后续加载相同模型时会直接命中缓存，加载速度大幅提升。")
		return nil
	}

	fmt.Println("📋 最近缓存的 KTX2 文件 (前 20 个):")
	fmt.Printf("   %-64s %s\n", "哈希 (前 16 位)", "大小")
	fmt.Println("   " + strings.Repeat("-", 80))

	for i, f := range files {
		if i >= 20 {
			fmt.Printf("   ... 还有 %d 个文件\n", len(files)-20)
			break
		}
		hashShort := f.Hash
		if len(hashShort) > 16 {
			hashShort = hashShort[:16]
		}
		fmt.Printf("   %-64s %s\n", hashShort, formatSize(f.Size))
	}

	fmt.Println()
	fmt.Printf("📈 缓存效率估算:\n")
	if stats.FileCount > 0 {
		avgSize := stats.TotalSize / int64(stats.FileCount)
		fmt.Printf("   平均大小: %s/文件\n", formatSize(avgSize))
		fmt.Printf("   预计可加速: 命中缓存后跳过 GPU 解码阶段\n")
	}

	return nil
}

// runCacheVerify 检查模型贴图的缓存命中情况
// cacheVerifyTexInfo 缓存校验单个贴图的结果。
type cacheVerifyTexInfo struct {
	path      string
	size      int64
	hash      string
	cached    bool
	cacheSize int64
}

// cacheVerifyExts cache-verify 扫描的贴图扩展名集合。
var cacheVerifyExts = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".tga":  true,
	".bmp":  true,
	".dds":  true,
}

// scanCacheVerify 遍历目录，对每个贴图计算哈希并检查缓存命中。
func scanCacheVerify(modelDir string) (texInfos []cacheVerifyTexInfo, walkErrors []string, err error) {
	err = filepath.Walk(modelDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			walkErrors = append(walkErrors, fmt.Sprintf("%s: %v", path, err))
			return nil
		}
		if info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !cacheVerifyExts[ext] {
			return nil
		}

		size := info.Size()

		hash, err := texture_cache.TextureHash(path)
		if err != nil {
			texInfos = append(texInfos, cacheVerifyTexInfo{
				path:   path,
				size:   size,
				hash:   "ERROR",
				cached: false,
			})
			return nil
		}

		cached, _ := texture_cache.HasCached(hash)
		cacheSize := int64(0)
		if cached {
			cachePath := texture_cache.CachePath(hash)
			if cachePath != "" {
				if ci, err := os.Stat(cachePath); err == nil {
					cacheSize = ci.Size()
				}
			}
		}

		texInfos = append(texInfos, cacheVerifyTexInfo{
			path:      path,
			size:      size,
			hash:      hash,
			cached:    cached,
			cacheSize: cacheSize,
		})

		return nil
	})
	return
}

// printCacheMisses 打印未缓存的贴图列表。
func printCacheMisses(texInfos []cacheVerifyTexInfo, modelDir string) {
	missCount := 0
	for _, ti := range texInfos {
		if !ti.cached {
			missCount++
		}
	}
	if missCount == 0 {
		return
	}

	fmt.Printf("⚠️  未缓存的贴图:\n")
	for _, ti := range texInfos {
		if !ti.cached {
			relPath := strings.TrimPrefix(ti.path, modelDir)
			status := "❌"
			if ti.hash == "ERROR" {
				status = "⚠️ "
			}
			fmt.Printf("   %s %s (%s)\n", status, relPath, formatSize(ti.size))
		}
	}
	fmt.Println()
}

// printCacheHitDetails 打印缓存命中详情（verbose 模式）。
func printCacheHitDetails(texInfos []cacheVerifyTexInfo, modelDir string) {
	hitCount := 0
	for _, ti := range texInfos {
		if ti.cached {
			hitCount++
		}
	}
	if hitCount == 0 {
		return
	}

	fmt.Printf("📋 缓存命中详情:\n")
	for _, ti := range texInfos {
		if !ti.cached {
			continue
		}
		relPath := strings.TrimPrefix(ti.path, modelDir)
		compressionRatio := 0.0
		if ti.size > 0 {
			compressionRatio = float64(ti.cacheSize) / float64(ti.size) * 100
		}
		fmt.Printf("   ✅ %s\n", relPath)
		fmt.Printf("      原始: %s → 缓存(KTX2): %s (压缩率: %.0f%%)\n",
			formatSize(ti.size),
			formatSize(ti.cacheSize),
			compressionRatio)
	}
	fmt.Println()
}

// printCacheVerifySummary 打印缓存校验总结：命中率分级 + 节省估算。
func printCacheVerifySummary(hitCount, missCount int, hitSize int64, totalFiles int) {
	fmt.Printf("📈 总结:\n")
	hitRate := 0.0
	if totalFiles > 0 {
		hitRate = float64(hitCount) / float64(totalFiles) * 100
	}

	if hitCount == totalFiles {
		fmt.Printf("   🟢 所有贴图都已缓存，加载时将获得最佳性能\n")
	} else if hitCount > 0 {
		fmt.Printf("   🟡 部分贴图已缓存 (%.1f%%)，首次加载会有解码开销\n", hitRate)
		fmt.Printf("   💡 建议: 打开包含此模型的页面，系统会自动缓存剩余贴图\n")
	} else {
		fmt.Printf("   🔴 所有贴图均未缓存，首次加载会较慢\n")
		fmt.Printf("   💡 建议: 打开包含此模型的页面，系统会自动缓存贴图\n")
	}

	if hitSize > 0 {
		estimatedSavedMs := float64(hitSize) / (1024 * 1024) * 5
		fmt.Printf("   ⚡ 估计节省: ~%.0fms (%s 贴图的解码+传输开销)\n", estimatedSavedMs, formatSize(hitSize))
	}
}

func runCacheVerify(ctx *CmdContext) error {
	fs := newCmdFlagSet("cache-verify")
	modelDir := fs.String("dir", "", "MMD 模型目录路径")
	verbose := fs.Bool("verbose", false, "显示详细的缓存命中信息")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if *modelDir == "" {
		return newParamErrf("--dir 参数不能为空")
	}

	fmt.Printf("🔍 检查模型贴图缓存: %s\n\n", *modelDir)

	texInfos, walkErrors, err := scanCacheVerify(*modelDir)
	if err != nil {
		return newRuntimeErrf("扫描目录失败: %v", err)
	}

	if len(walkErrors) > 0 {
		fmt.Printf("⚠️  访问异常 %d 处:\n", len(walkErrors))
		for _, w := range walkErrors {
			fmt.Printf("   - %s\n", w)
		}
		fmt.Println()
	}

	// 聚合命中/未命中统计
	var (
		textureFiles int
		totalSize    int64
		hitCount     int
		hitSize      int64
		missCount    int
		missSize     int64
	)
	for _, ti := range texInfos {
		textureFiles++
		totalSize += ti.size
		if ti.cached {
			hitCount++
			hitSize += ti.size
		} else {
			missCount++
			missSize += ti.size
		}
	}

	fmt.Printf("📊 贴图统计:\n")
	fmt.Printf("   贴图总数: %d\n", textureFiles)
	fmt.Printf("   原始总大小: %s\n\n", formatSize(totalSize))

	if textureFiles == 0 {
		fmt.Println("📭 没有找到贴图文件")
		return nil
	}

	hitRate := 0.0
	if textureFiles > 0 {
		hitRate = float64(hitCount) / float64(textureFiles) * 100
	}

	fmt.Printf("🎯 缓存命中:\n")
	fmt.Printf("   ✅ 命中: %d 个 (%s)\n", hitCount, formatSize(hitSize))
	fmt.Printf("   ❌ 未命中: %d 个 (%s)\n", missCount, formatSize(missSize))
	fmt.Printf("   📈 命中率: %.1f%%\n\n", hitRate)

	printCacheMisses(texInfos, *modelDir)

	if *verbose {
		printCacheHitDetails(texInfos, *modelDir)
	}

	printCacheVerifySummary(hitCount, missCount, hitSize, textureFiles)

	return nil
}

// runCacheClear 清空纹理缓存
func runCacheClear(ctx *CmdContext) error {
	fs := newCmdFlagSet("cache-clear")
	yes := fs.Bool("yes", false, "跳过确认，直接清空")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	stats := texture_cache.GetCacheStats()

	fmt.Printf("🗑️  清空纹理缓存\n")
	fmt.Printf("   缓存目录: %s\n", stats.Dir)
	fmt.Printf("   文件数量: %d\n", stats.FileCount)
	fmt.Printf("   总大小:   %s\n\n", formatSize(stats.TotalSize))

	if stats.FileCount == 0 {
		fmt.Println("📭 缓存已经是空的")
		return nil
	}

	if !*yes {
		fmt.Print("⚠️  确定要清空所有缓存吗？(y/N): ")
		var confirm string
		fmt.Scanln(&confirm)
		if confirm != "y" && confirm != "Y" {
			fmt.Println("❌ 已取消")
			return nil
		}
	}

	err = texture_cache.ClearCache()
	if err != nil {
		return newRuntimeErrf("清空缓存失败: %v", err)
	}

	fmt.Printf("✅ 已清空 %d 个缓存文件\n", stats.FileCount)
	fmt.Println()
	fmt.Println("💡 提示: 清空后首次加载模型会较慢，系统会自动重新生成缓存。")

	return nil
}

// runCacheDiag 诊断缓存流程
func runCacheDiag(ctx *CmdContext) error {
	fmt.Printf("🔍 缓存流程诊断\n")
	fmt.Println(strings.Repeat("=", 60))

	fmt.Printf("\n📁 1. 缓存目录检查\n")
	dir := texture_cache.CacheDir()
	fmt.Printf("   路径: %s\n", dir)

	if dir == "" {
		fmt.Printf("   ❌ 缓存目录不可用\n")
		fmt.Printf("   💡 原因: os.UserConfigDir() 返回空（可能是权限问题或平台不支持）\n")
		return newRuntimeErrf("缓存目录不可用")
	}

	_, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Printf("   ⚠️  目录不存在（将在首次写入时自动创建）\n")
		} else {
			fmt.Printf("   ❌ 无法访问目录: %v\n", err)
		}
	} else {
		fmt.Printf("   ✅ 目录存在\n")
	}

	testDir := filepath.Join(dir, ".diag_test")
	err = os.MkdirAll(testDir, fsutil.DirPerms)
	if err != nil {
		fmt.Printf("   ❌ 无法创建子目录: %v\n", err)
		fmt.Printf("   💡 可能是权限不足，请检查目录的写入权限\n")
	} else {
		fmt.Printf("   ✅ 目录创建权限正常\n")
		os.Remove(testDir)
	}

	fmt.Printf("\n🔐 2. 哈希计算测试\n")
	testFile := filepath.Join(os.TempDir(), "ysm_cache_test.txt")
	testContent := []byte("YSM Cache Diagnostic Test Content")
	if err := os.WriteFile(testFile, testContent, fsutil.FilePerms); err != nil {
		fmt.Printf("   ❌ 无法创建测试文件: %v\n", err)
	} else {
		hash, err := texture_cache.TextureHash(testFile)
		if err != nil {
			fmt.Printf("   ❌ 哈希计算失败: %v\n", err)
		} else {
			fmt.Printf("   ✅ 哈希计算成功\n")
			fmt.Printf("      输入: %s\n", testFile)
			fmt.Printf("      哈希: %s\n", hash)

			hash2, _ := texture_cache.TextureHash(testFile)
			if hash == hash2 {
				fmt.Printf("      ✅ 哈希一致性验证通过\n")
			} else {
				fmt.Printf("      ❌ 哈希不一致！\n")
			}
		}
		os.Remove(testFile)
	}

	fmt.Printf("\n💾 3. 缓存读写测试\n")
	testHash := "diag_test_hash_12345"
	testData := []byte("YSM KTX2 Cache Test Data - " + time.Now().Format(time.RFC3339))

	err = texture_cache.WriteCached(testHash, testData)
	if err != nil {
		fmt.Printf("   ❌ 缓存写入失败: %v\n", err)
		fmt.Printf("   💡 可能是磁盘空间不足或权限问题\n")
	} else {
		fmt.Printf("   ✅ 缓存写入成功\n")
		fmt.Printf("      文件: %s\n", texture_cache.CachePath(testHash))

		data, ok, err := texture_cache.ReadCached(testHash)
		if err != nil {
			fmt.Printf("   ❌ 缓存读取失败: %v\n", err)
		} else if !ok {
			fmt.Printf("   ❌ 缓存未命中（刚写入的应该命中）\n")
		} else {
			fmt.Printf("   ✅ 缓存读取成功\n")
			if string(data) == string(testData) {
				fmt.Printf("   ✅ 数据完整性验证通过\n")
			} else {
				fmt.Printf("   ❌ 数据不完整！\n")
			}
		}

		texture_cache.ClearCache()
	}

	fmt.Printf("\n📊 4. 当前缓存状态\n")
	stats := texture_cache.GetCacheStats()
	fmt.Printf("   文件数量: %d\n", stats.FileCount)
	fmt.Printf("   总大小:   %s\n", formatSize(stats.TotalSize))

	fmt.Printf("\n🎯 5. 关键说明\n")
	fmt.Printf("   %s\n", strings.Repeat("-", 50))
	fmt.Printf("   💡 缓存编码流程:\n")
	fmt.Printf("      1. 前端加载 MMD 模型 → 调用 GetCachedTexture(hash)\n")
	fmt.Printf("      2. 后端计算文件哈希，检查缓存 → 未命中时返回原始 PNG\n")
	fmt.Printf("      3. 前端在后台用 WASM 编码为 KTX2 → 调用 SaveCachedTexture\n")
	fmt.Printf("      4. 后端写入缓存文件 → 下次加载直接命中\n\n")
	fmt.Printf("   ⚠️  CLI 模式说明:\n")
	fmt.Printf("      - CLI 不会触发 KTX2 编码（编码需要前端 WASM 环境）\n")
	fmt.Printf("      - CLI 只能检查缓存状态，不能生成缓存\n")
	fmt.Printf("      - 要生成缓存，请在 GUI 中加载一次模型\n\n")
	fmt.Printf("   🔍 排查步骤:\n")
	fmt.Printf("      1. 在 GUI 中加载 MMD 模型（等待加载完成）\n")
	fmt.Printf("      2. 查看环形日志面板，确认 'ktx2-encode' 日志\n")
	fmt.Printf("      3. 使用 'cache-status' 检查缓存是否已生成\n")
	fmt.Printf("      4. 使用 'cache-verify --dir <模型路径>' 检查具体模型\n\n")

	if stats.FileCount == 0 {
		fmt.Printf("   🔴 当前缓存为空！\n")
		fmt.Printf("      - 如果已在 GUI 中加载模型，说明编码可能失败了\n")
		fmt.Printf("      - 请检查 GUI 的环形日志面板（filter: ktx2-encode）\n")
		fmt.Printf("      - 常见失败原因: WASM 加载失败、纹理格式不支持\n")
	} else {
		fmt.Printf("   🟢 缓存正常，可放心使用\n")
	}

	fmt.Printf("\n%s\n", strings.Repeat("=", 60))
	return nil
}
