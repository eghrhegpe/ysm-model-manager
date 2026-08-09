//go:build !cli

package main

import (
	"embed"
	"log"
	"net/http"

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
			// Wails 在 desktop 模式对 /wails/custom.js 刻意返回 404（仅 server 模式 serve）。
			// 但 runtime 的 loadOptionalScript 无条件发 HEAD 请求 → DevTools 显示红色 404。
			// 此处用 Middleware 在框架内置中间件之前拦截，返回空 JS 消除噪音。
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path == "/wails/custom.js" {
						w.Header().Set("Content-Type", "application/javascript")
						w.WriteHeader(http.StatusOK)
						w.Write([]byte("// Wails custom.js — empty in desktop mode\n"))
						return
					}
					next.ServeHTTP(w, r)
				})
			},
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
