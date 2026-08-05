// ========== 下载队列 ==========
// 从 app.go 拆分：串行下载队列、文件下载、镜像回退
package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"sync"

	"ysm-model-manager/go/download"
	"ysm-model-manager/go/ysm"
)

// QueueStatusInfo 队列状态（替代多返回值，Wails 自动映射为 JS object）
type QueueStatusInfo struct {
	Remaining int  `json:"remaining"`
	Running   bool `json:"running"`
}

// DownloadTask 下载队列任务
type DownloadTask struct {
	URL     string `json:"url"`
	SaveDir string `json:"saveDir"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
}

// DownloadQueue 串行下载队列
// 回调注入替代 *App 反向引用（ADR-002 P1：打破 DownloadQueue ↔ App 循环，解锁独立测试）
type DownloadQueue struct {
	tasks     []DownloadTask
	mu        sync.Mutex
	running   bool
	cancelled bool
	ctx       context.Context
	cancelFn  context.CancelFunc

	downloadFn func(ctx context.Context, url, saveDir string) (string, error)
	emitFn     func(name string, args ...interface{})
	logFn      func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)
}

// NewDownloadQueue 创建串行下载队列（回调由 App 初始化时注入）
func NewDownloadQueue(downloadFn func(ctx context.Context, url, saveDir string) (string, error), emitFn func(name string, args ...interface{}), logFn func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)) *DownloadQueue {
	ctx, cancel := context.WithCancel(context.Background())
	return &DownloadQueue{downloadFn: downloadFn, emitFn: emitFn, logFn: logFn, ctx: ctx, cancelFn: cancel}
}

func (a *App) EnqueueDownloads(tasks []DownloadTask) error {
	if len(tasks) == 0 {
		return nil
	}
	// URL 校验：仅允许 https scheme，拒绝 file:// / ftp:// 等（防 SSRF / 本地文件读取）
	for _, t := range tasks {
		if !strings.HasPrefix(t.URL, "https://") {
			return fmt.Errorf("不支持的 URL scheme: %s（仅支持 https）", t.URL)
		}
	}
	a.queue.mu.Lock()
	// 新一批任务视为重新开始：复位取消标志，否则上次取消后 process 永不发 done（前端会永久卡 downloading）
	a.queue.cancelled = false
	a.queue.tasks = append(a.queue.tasks, tasks...)
	total := len(a.queue.tasks)
	// running 判断必须在锁内，避免并发入队启动多个 process goroutine
	start := !a.queue.running
	if start {
		a.queue.running = true
	}
	a.queue.mu.Unlock()
	if start {
		go a.queue.process()
	}
	log.Printf("[queue] emit queue:status enqueued total=%d", total)
	a.app.Event.Emit("queue:status", "enqueued", total, "")
	return nil
}

func (a *App) CancelQueue() {
	a.queue.mu.Lock()
	defer a.queue.mu.Unlock()
	a.queue.cancelled = true
	if a.queue.running {
		a.queue.cancelFn()
		a.queue.ctx, a.queue.cancelFn = context.WithCancel(context.Background())
	}
	a.queue.tasks = nil
	a.queue.running = false
	log.Printf("[queue] emit queue:status cancelled")
	a.app.Event.Emit("queue:status", "cancelled", 0, "")
}

func (a *App) QueueStatus() QueueStatusInfo {
	a.queue.mu.Lock()
	defer a.queue.mu.Unlock()
	return QueueStatusInfo{Remaining: len(a.queue.tasks), Running: a.queue.running}
}

func (q *DownloadQueue) process() {
	q.mu.Lock()
	q.running = true
	q.mu.Unlock()

	defer func() {
		q.mu.Lock()
		q.running = false
		cancelled := q.cancelled
		q.mu.Unlock()
		if !cancelled {
			log.Printf("[queue] emit queue:status done")
			q.emitFn("queue:status", "done", 0, "")
		}
	}()

	for {
		q.mu.Lock()
		if len(q.tasks) == 0 {
			q.mu.Unlock()
			return
		}
		task := q.tasks[0]
		q.tasks = q.tasks[1:]
		remaining := len(q.tasks)
		// 锁内快照 ctx：CancelQueue 会替换 q.ctx，必须用本任务发起时的 ctx 做请求取消
		ctx := q.ctx
		q.mu.Unlock()

		log.Printf("[queue] emit queue:file-start name=%s pos=%d left=%d", task.Name, remaining+1, remaining)
		q.emitFn("queue:file-start", task.Name, remaining+1, remaining)

		savePath, err := q.downloadFn(ctx, task.URL, task.SaveDir)
		if err != nil {
			log.Printf("[queue] emit queue:file-done name=%s status=fail err=%v", task.Name, err)
			q.emitFn("queue:file-done", task.Name, "fail", err.Error())
			q.logFn("download", task.Name, task.URL, task.SaveDir, 0, "failed", err.Error())
		} else {
			log.Printf("[queue] emit queue:file-done name=%s status=ok", task.Name)
			q.emitFn("queue:file-done", task.Name, "ok", "")
			// 写入导入日志
			var fileSize int64
			if fi, st := os.Stat(savePath); st == nil {
				fileSize = fi.Size()
			}
			q.logFn("download", task.Name, task.URL, task.SaveDir, fileSize, "success", "")
		}

		select {
		case <-ctx.Done():
			return
		default:
		}
	}
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
	log.Printf("[queue] emit download:progress dl=%d total=%d", downloaded, total)
	a.app.Event.Emit("download:progress", downloaded, total)
}

func (a *App) DownloadFromGitHub(rawURL string, saveDir string) (string, error) {
	return a.downloadFileWithQueue(context.Background(), rawURL, saveDir)
}

// GetModelTexSizes 扫描仓库文件提取纹理尺寸（轻量级，不解析完整模型）
func (a *App) GetModelTexSizes(repoRoot string) []ysm.TexInfo {
	entries := a.ScanModelEntries(repoRoot)
	var simple []ysm.ModelEntry
	for _, e := range entries {
		simple = append(simple, ysm.ModelEntry{Path: e.Path, Name: e.Name})
	}
	return ysm.ScanModelTexSizes(simple)
}
