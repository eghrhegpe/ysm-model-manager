// ========== 下载（install 域，App 侧） ==========
// 下载队列逻辑已垂直切分至 internal/app/install（ADR-179 P1）。
// 本文件保留需 App 生命周期/事件支持的方法：下载实现、进度回调、直下入口。
// EnqueueDownloads / CancelQueue / QueueStatus 为 Wails 绑定委托，转发至
// install.Manager.Queue（方法签名不变，前端 window.go 消费面零改动）。
package app

import (
	"context"
	"fmt"
	"log"
	"strings"

	"ysm-model-manager/go/download"
	"ysm-model-manager/go/types"
)

// EnqueueDownloads 入队一批下载任务（委托至 install.Manager.Queue）。
func (a *App) EnqueueDownloads(tasks []types.DownloadTask) error {
	return a.install.Queue.Enqueue(tasks)
}

// CancelQueue 取消在途下载队列（委托至 install.Manager.Queue）。
func (a *App) CancelQueue() {
	a.install.Queue.Cancel()
}

// QueueStatus 返回下载队列状态（委托至 install.Manager.Queue）。
func (a *App) QueueStatus() types.QueueStatusInfo {
	return a.install.Queue.Status()
}

func (a *App) downloadFileWithQueue(ctx context.Context, rawURL, saveDir string) (string, error) {
	savePath, jsdURL, apiURL := download.ResolveSavePath(rawURL, saveDir)
	if savePath == "" {
		return "", fmt.Errorf("解析保存路径失败: %s", rawURL)
	}

	dl := download.New()
	mirror := a.LoadAppConfig().Mirror
	type src struct {
		url  string
		kind string
	}
	sources := []src{{rawURL, "raw"}}
	if jsdURL != "" {
		sources = append(sources, src{jsdURL, "jsd"})
	}
	if apiURL != "" {
		sources = append(sources, src{apiURL, "api"})
	}
	if mirror == "jsdelivr" && len(sources) >= 3 {
		sources[0], sources[1] = sources[1], sources[0]
	} else if mirror == "githubapi" && len(sources) >= 3 {
		sources[0], sources[2] = sources[2], sources[0]
		sources[1], sources[2] = sources[2], sources[1]
	}

	var lastErr error
	for _, s := range sources {
		var err error
		if s.kind == "api" {
			err = dl.FromGitHubAPI(ctx, s.url, savePath, a.emitDownloadProgress)
		} else {
			err = dl.File(ctx, s.url, savePath, a.emitDownloadProgress)
		}
		if err == nil {
			return savePath, nil
		}
		lastErr = err
	}
	return "", fmt.Errorf("所有源均失败: %s", lastErr)
}

// emitDownloadProgress 下载进度回调 → Wails 事件（go/download 包内已做 200ms 节流与 final 兜底）
func (a *App) emitDownloadProgress(downloaded, total int64) {
	// 进度事件高频（200ms/文件），只对 final（下载完成）打日志，避免长队列刷屏日志
	if total > 0 && downloaded >= total {
		log.Printf("[queue] emit download:progress final dl=%d total=%d", downloaded, total)
	}
	a.app.Event.Emit("download:progress", downloaded, total)
}

func (a *App) DownloadFromGitHub(rawURL string, saveDir string) (string, error) {
	// 复用 EnqueueDownloads 的 scheme 校验——原实现无校验直通
	// downloadFileWithQueue，http/ftp/任意主机可拉取（与入队路径的安全口径不一致，
	// 前端未使用但已暴露为 Binding API）
	if !strings.HasPrefix(rawURL, "https://") {
		return "", fmt.Errorf("不支持的 URL scheme: %s（仅支持 https）", rawURL)
	}
	// 用应用级 ctx（原 context.Background() 不可取消）：ServiceShutdown 时 appCancel 触发，
	// 在途 HTTP 请求随之中断（download.File 走 http.NewRequestWithContext + ctx.Done 检查）
	// nil 兜底（code review P2 修复）：测试/工具代码常用 &App{} 零值构造（不经 NewApp），
	// appCtx 为 nil 时 http.NewRequestWithContext 会 panic("nil Context")——与
	// ServiceShutdown 的 appCancel nil 检查对称
	ctx := a.appCtx
	if ctx == nil {
		ctx = context.Background()
	}
	return a.downloadFileWithQueue(ctx, rawURL, saveDir)
}
