//go:build !cli

package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"ysm-model-manager/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	appStruct := app.NewApp()
	app := application.New(application.Options{
		Name: "YSM 模型管理器",
		Services: []application.Service{
			application.NewService(appStruct),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
	})
	// 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框管理器
	appStruct.SetApp(app)

	wnd := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "YSM 模型管理器",
		Width:  1280,
		Height: 800,
		URL:    "/",
	})
	// 注入主窗口引用，供 ServiceStartup/ServiceShutdown 直接操作（避免 Window.Current() 在启动期返回 nil）
	appStruct.SetMainWindow(wnd)

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
