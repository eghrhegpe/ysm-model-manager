//go:build !cli

package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	appStruct := NewApp()
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

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "YSM 模型管理器",
		Width:  1280,
		Height: 800,
		URL:    "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
