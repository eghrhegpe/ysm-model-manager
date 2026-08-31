package app

import (
	"fmt"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	plazaTitle = "YSM 模型广场"
)

func (a *App) prewarmPlazaWindow() {
	a.plazaWinMu.Lock()
	defer a.plazaWinMu.Unlock()
	if a.plazaWin != nil {
		return
	}
	w := a.app.Window.NewWithOptions(
		application.WebviewWindowOptions{
			Title:  plazaTitle,
			Width:  1280,
			Height: 800,
			URL:    "about:blank",
			Hidden: true,
		},
	)
	a.plazaWin = w

	// 窗口预热复用：点 X 只隐藏、不销毁（Cancel），因此收尾必须显式走 ClosePlazaWindow。
	// 否则 currentPlazaTarget 不清、反向代理不停——同一站点重开时 startProxy 的
	// oldTarget != url 判据失效，会累积泄漏 HTTP server 与端口，直到应用退出才释放。
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		_ = a.ClosePlazaWindow()
		e.Cancel()
	})

	log.Printf("[plaza] prewarmed window created")
}

func (a *App) NavigatePlazaWindow(url string, direct bool) error {
	a.plazaWinMu.Lock()
	win := a.plazaWin
	a.plazaWinMu.Unlock()

	if win == nil {
		return fmt.Errorf("plaza window not initialized")
	}

	var navigateURL string
	if direct {
		navigateURL = url
	} else {
		a.plazaWinMu.Lock()
		oldTarget := a.currentPlazaTarget
		a.plazaWinMu.Unlock()
		if oldTarget != "" && oldTarget != url {
			a.stopProxy(oldTarget)
		}
		proxyURL, err := a.startProxy(url)
		if err != nil {
			return fmt.Errorf("failed to start proxy: %w", err)
		}
		navigateURL = proxyURL
		a.plazaWinMu.Lock()
		a.currentPlazaTarget = url
		a.plazaWinMu.Unlock()
	}

	win.SetTitle(plazaTitle + " - " + url)
	win.SetURL(navigateURL)
	win.Show()
	win.Focus()
	log.Printf("[plaza] navigate to %s (direct=%v)", url, direct)
	return nil
}

func (a *App) ClosePlazaWindow() error {
	a.plazaWinMu.Lock()
	win := a.plazaWin
	a.plazaWinMu.Unlock()

	if win == nil {
		return nil
	}
	win.Hide()

	a.plazaWinMu.Lock()
	plazaTarget := a.currentPlazaTarget
	a.currentPlazaTarget = ""
	a.plazaWinMu.Unlock()
	if plazaTarget != "" {
		a.stopProxy(plazaTarget)
	}
	log.Printf("[plaza] window hidden")
	return nil
}

func (a *App) PlazaGoBack() error {
	return a.plazaExecJS("history.back()")
}

func (a *App) PlazaGoForward() error {
	return a.plazaExecJS("history.forward()")
}

func (a *App) PlazaReload() error {
	a.plazaWinMu.Lock()
	win := a.plazaWin
	a.plazaWinMu.Unlock()
	if win == nil {
		return nil
	}
	win.Reload()
	return nil
}

func (a *App) PlazaZoomIn() error {
	a.plazaWinMu.Lock()
	win := a.plazaWin
	a.plazaWinMu.Unlock()
	if win == nil {
		return nil
	}
	win.ZoomIn()
	return nil
}

func (a *App) PlazaZoomOut() error {
	a.plazaWinMu.Lock()
	win := a.plazaWin
	a.plazaWinMu.Unlock()
	if win == nil {
		return nil
	}
	win.ZoomOut()
	return nil
}

func (a *App) PlazaZoomReset() error {
	a.plazaWinMu.Lock()
	win := a.plazaWin
	a.plazaWinMu.Unlock()
	if win == nil {
		return nil
	}
	win.ZoomReset()
	return nil
}

func (a *App) plazaExecJS(js string) error {
	a.plazaWinMu.Lock()
	win := a.plazaWin
	a.plazaWinMu.Unlock()
	if win == nil {
		return nil
	}
	win.ExecJS(js)
	return nil
}

// plazaWindowExists 供前端查询窗口是否已预热
func (a *App) plazaWindowExists() bool {
	a.plazaWinMu.Lock()
	defer a.plazaWinMu.Unlock()
	return a.plazaWin != nil
}

var _ plazaWindowInterface = (*App)(nil)

type plazaWindowInterface interface {
	NavigatePlazaWindow(url string, direct bool) error
	ClosePlazaWindow() error
	PlazaGoBack() error
	PlazaGoForward() error
	PlazaReload() error
	PlazaZoomIn() error
	PlazaZoomOut() error
	PlazaZoomReset() error
	plazaWindowExists() bool
}
