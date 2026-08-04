package app

import (
	"context"
	"os"
	"path/filepath"
	"sync"

	"ysm-model-manager/go/logs"
	"ysm-model-manager/go/tags"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/updater"
	"ysm-model-manager/go/version"
	"ysm-model-manager/go/watcher"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type App struct {
	LinkMode     string
	logger       *logs.Logger
	watcher      *watcher.Watcher
	queue        *DownloadQueue
	tagsStore    *tags.Store
	configCache  types.AppConfig
	configLoaded bool
	configMu     sync.RWMutex
	app          *application.App
	mainWindow   *application.WebviewWindow
}

// repoRoot 动态返回 YSM 模型存储根目录（始终从配置推导，无需手动维护缓存）
func (a *App) ysmRoot() string { dir, _ := a.GetRepoRoot("ysm"); return dir }

func NewApp() *App {
	a := &App{
		logger: logs.NewLogger(),
	}
	// 回调注入：打破 DownloadQueue ↔ App 循环（ADR-002 P1）
	// emitFn 闭包延迟解析 a.app（SetApp 在应用启动时注入）
	a.queue = NewDownloadQueue(
		a.downloadFileWithQueue,
		func(name string, args ...interface{}) { a.app.Event.Emit(name, args...) },
		a.AddOpLog,
	)
	return a
}

// SetApp 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框/浏览器管理器
func (a *App) SetApp(app *application.App) { a.app = app }

// SetMainWindow 注入主窗口实例，避免依赖 Window.Current()。
// 注意：ServiceStartup 在 app.Run() 早期被调用，此时窗口尚未成为 Current，
// Window.Current() 会返回 nil 导致空指针；故改用直接持有的窗口引用。
func (a *App) SetMainWindow(w *application.WebviewWindow) { a.mainWindow = w }

// ServiceStartup 对应 v2 的 startup，在 app.Run() 期间由框架调用
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// 清理上一次更新留下的 .old 备份
	updater.CleanupOldVersion()

	// 启动时自动加载配置
	a.loadAppConfig()

	// 恢复窗口位置
	pos := a.GetWindowPosition()
	if a.mainWindow != nil && pos.Width > 0 && pos.Height > 0 {
		// 双屏切换后坐标可能落到屏幕外：X/Y 过大或过负时居中
		if pos.X < -200 || pos.X > 4000 || pos.Y < -200 || pos.Y > 4000 {
			a.mainWindow.SetSize(pos.Width, pos.Height)
			a.mainWindow.Center()
		} else {
			a.mainWindow.SetSize(pos.Width, pos.Height)
			a.mainWindow.SetPosition(pos.X, pos.Y)
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
	ysmRoot, _ := a.GetRepoRoot("ysm")
	if needsWrite {
		a.saveConfig(cfg)
		if cfg.McRoot != "" {
			println("[startup] 配置文件已创建/更新, mcRoot:", cfg.McRoot)
		}
	}

	// 创建所有存储子目录
	if cfg.FilesRoot != "" {
		for _, sub := range []string{"ysm", "resourcepacks", "shaderpacks", "schematics", "mmd", "vrchat"} {
			os.MkdirAll(filepath.Join(cfg.FilesRoot, sub), 0644)
		}
	}

	a.app.Event.Emit("config-loaded", ysmRoot, cfg.McRoot, cfg.LinkMode)

	// 启动文件监听器（自动同步启用/禁用状态到整合包）
	if ysmRoot != "" && cfg.McRoot != "" {
		a.watcher = watcher.New(ysmRoot, cfg.McRoot, a.ScanModelEntries, a.ClearScanCache)
		if err := a.watcher.Start(); err != nil {
			println("[startup] 文件监听器启动失败:", err.Error())
		}
	}
	return nil
}

// ServiceShutdown 对应 v2 的 shutdown，在应用退出前由框架调用
func (a *App) ServiceShutdown() error {
	defer func() { recover() }() // 关闭时可能取不到窗口尺寸
	if a.watcher != nil {
		a.watcher.Stop()
	}
	if a.mainWindow != nil {
		x, y := a.mainWindow.Position()
		w, h := a.mainWindow.Size()
		a.SaveWindowPosition(x, y, w, h)
	}
	return nil
}

// OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌）
func (a *App) OpenInBrowser(url string) {
	_ = a.app.Browser.OpenURL(url)
}

// GetAppVersion 返回当前版本号
func (a *App) GetAppVersion() string {
	return version.Version
}
