package cli

import (
	"fmt"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/texture_cache"
)

func init() {
	RegisterCommandC("config-show", CatConfig, "查看当前配置", runConfigShow)
}

// runConfigShow 查看当前配置
func runConfigShow(ctx *CmdContext) error {
	filesRoot := ctx.FilesRoot
	if filesRoot == "" {
		filesRoot = "."
	}

	cfg := ctx.App.LoadAppConfig()

	fmt.Printf("⚙️  当前配置\n\n")
	fmt.Printf("📁 根目录: %s\n\n", filesRoot)

	if cfg.FilesRoot != "" || cfg.LinkMode != "" {
		fmt.Printf("📊 存储根目录:\n")
		fmt.Printf("   FilesRoot: %s\n", cfg.FilesRoot)

		if len(cfg.CustomRoots) > 0 {
			fmt.Printf("\n📂 自定义资源根路径:\n")
			for k, v := range cfg.CustomRoots {
				if v != "" {
					fmt.Printf("   %-20s: %s\n", k, v)
				}
			}
		}

		fmt.Printf("\n🔧 运行参数:\n")
		fmt.Printf("   链接模式: %s\n", cfg.LinkMode)
		fmt.Printf("   主题: %s\n", cfg.Theme)
		fmt.Printf("   镜像: %s\n", cfg.Mirror)

		if cfg.VoxelMaxBlocks > 0 {
			fmt.Printf("   体素上限: %d\n", cfg.VoxelMaxBlocks)
		}

		fmt.Printf("\n⏱️  阈值配置:\n")
		if cfg.ScanCacheTTLMs > 0 {
			fmt.Printf("   扫描缓存 TTL: %dms\n", cfg.ScanCacheTTLMs)
		}
		if cfg.DownloadTimeoutSec > 0 {
			fmt.Printf("   下载超时: %ds\n", cfg.DownloadTimeoutSec)
		}
		if cfg.PreviewReadLimitMB > 0 {
			fmt.Printf("   预览读取上限: %dMB\n", cfg.PreviewReadLimitMB)
		}
		if cfg.LogMaxEntries > 0 {
			fmt.Printf("   日志条数上限: %d\n", cfg.LogMaxEntries)
		}

		if cfg.WinW > 0 && cfg.WinH > 0 {
			fmt.Printf("\n🪟  窗口状态: %dx%d @ (%d,%d)\n", cfg.WinW, cfg.WinH, cfg.WinX, cfg.WinY)
		}
	} else {
		fmt.Println("📭 配置为空（使用默认值）")
	}

	stats := texture_cache.GetCacheStats()
	fmt.Printf("\n💾 纹理缓存:\n")
	fmt.Printf("   目录: %s\n", stats.Dir)
	fmt.Printf("   文件: %d 个, 总大小: %s\n", stats.FileCount, fsutil.FormatSize(stats.TotalSize))

	fmt.Printf("\n💡 提示:\n")
	fmt.Printf("   使用 'cache-status' 查看缓存详情\n")
	fmt.Printf("   使用 'cache-verify --dir <模型目录>' 检查特定模型的缓存命中\n")
	fmt.Printf("   使用 'cache-clear' 清空缓存\n")

	return nil
}
