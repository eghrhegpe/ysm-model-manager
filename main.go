package main

import (
	"embed"
	"log"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"ysm-model-manager/go/cli"
	"ysm-model-manager/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// ---- CLI Mode: 独立运行，脱离 Wails GUI，用于测试或自动化 ----
	if len(os.Args) > 1 && os.Args[1] == "--cli" {
		// ADR-145：AppService 在入口构造并注入——go/cli 不再反向 import internal/app
		if err := cli.RunCLI(app.NewApp(), os.Args[2:]); err != nil {
			cli.PrintError(err)
			os.Exit(cli.ExitCodeOf(err))
		}
		os.Exit(cli.ExitSuccess)
		return
	}
	// ---- End CLI Mode ----

	appStruct := app.NewApp()
	// ADR-145 编译期断言：*app.App 必须满足 cli.AppService（消费方接口契约）。
	// 任一方法签名漂移此处立即编译失败，杜绝「接口与实现脱钩」静默演进。
	var _ cli.AppService = appStruct
	// CLI 桥接：从 cli 注册表注入可用命令列表（单一事实来源，新增命令自动可见）
	appStruct.SetAllowedCommands(cli.GetAllowedCommands())
	wailsApp := application.New(application.Options{
		Name: "YSM 模型管理器",
		Services: []application.Service{
			application.NewService(appStruct),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			Middleware: func(next http.Handler) http.Handler {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/wails/custom.js" {
						w.Header().Set("Content-Type", "application/javascript")
						w.WriteHeader(http.StatusOK)
						w.Write([]byte("// Wails custom.js — empty in desktop mode\n"))
						return
					}
					next.ServeHTTP(w, r)
				})
				return app.CoopCoepMiddleware(inner)
			},
		},
	})
	appStruct.SetApp(wailsApp)

	// 创建主窗口（Wails v3 API：WebviewWindowOptions + Window.NewWithOptions）
	wnd := wailsApp.Window.NewWithOptions(mainWindowOptions())
	appStruct.SetMainWindow(wnd)

	if err := wailsApp.Run(); err != nil {
		log.Fatal(err)
	}
}

func mainWindowOptions() application.WebviewWindowOptions {
	return application.WebviewWindowOptions{
		Title:            "YSM 模型管理器",
		Width:            1280,
		Height:           800,
		URL:              "/",
		Hidden:           true,
		BackgroundColour: application.NewRGB(17, 17, 27),
	}
}
