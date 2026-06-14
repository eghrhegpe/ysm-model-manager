package main

import (
	"context"
	"encoding/json"
	"os"

	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/updater"
	"ysm-model-manager/go/watcher"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	RepoRoot string
	LinkMode string
	logger   *logs.Logger
	watcher  *watcher.Watcher
	queue    *DownloadQueue
}

func NewApp() *App {
	a := &App{
		logger: logs.NewLogger(),
	}
	a.queue = NewDownloadQueue(a)
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// 清理上一次更新留下的 .old 备份
	updater.CleanupOldVersion()

	// 启动时自动加载配置
	a.loadAppConfig()

	// 恢复窗口位置
	pos := a.GetWindowPosition()
	if pos.Width > 0 && pos.Height > 0 {
		// 双屏切换后坐标可能落到屏幕外：X/Y 过大或过负时居中
		if pos.X < -200 || pos.X > 4000 || pos.Y < -200 || pos.Y > 4000 {
			runtime.WindowSetSize(ctx, pos.Width, pos.Height)
			runtime.WindowCenter(ctx)
		} else {
			runtime.WindowSetSize(ctx, pos.Width, pos.Height)
			runtime.WindowSetPosition(ctx, pos.X, pos.Y)
		}
	}

	// 确保配置文件存在（如果被删除则重建）
	cfg := a.LoadAppConfig()
	needsWrite := false
	if _, err := os.Stat(configPath()); os.IsNotExist(err) {
		// 配置文件不存在 → 创建默认文件
		needsWrite = true
	}
	if cfg.McRoot == "" {
		paths := scanMinecraftDirs()
		if len(paths) > 0 {
			cfg.McRoot = paths[0]
			needsWrite = true
		}
	}
	if cfg.RepoRoot == "" && a.RepoRoot != "" {
		cfg.RepoRoot = a.RepoRoot
		needsWrite = true
	}
	if needsWrite {
		if data, err := json.MarshalIndent(cfg, "", "  "); err == nil {
			os.WriteFile(configPath(), data, 0644)
			if cfg.McRoot != "" {
				println("[startup] 配置文件已创建/更新, mcRoot:", cfg.McRoot)
			}
		}
	}

	runtime.EventsEmit(ctx, "config-loaded", cfg.RepoRoot, cfg.McRoot, cfg.LinkMode)

	// 启动文件监听器（自动同步启用/禁用状态到整合包）
	if cfg.RepoRoot != "" && cfg.McRoot != "" {
		a.watcher = watcher.New(cfg.RepoRoot, cfg.McRoot, a.ScanModelEntries)
		if err := a.watcher.Start(); err != nil {
			println("[startup] 文件监听器启动失败:", err.Error())
		}
	}
}

func (a *App) shutdown(ctx context.Context) {
	defer func() { recover() }() // 关闭时可能取不到窗口尺寸
	if a.watcher != nil {
		a.watcher.Stop()
	}
	x, y := runtime.WindowGetPosition(ctx)
	w, h := runtime.WindowGetSize(ctx)
	a.SaveWindowPosition(x, y, w, h)
}

// OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌）
func (a *App) OpenInBrowser(url string) error {
	return runtime.BrowserOpenURL(a.ctx, url)
}

