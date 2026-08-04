// ========== 下载队列 ==========
// 从 app.go 拆分：串行下载队列、文件下载、镜像回退
package app

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

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
type DownloadQueue struct {
	app       *App
	tasks     []DownloadTask
	mu        sync.Mutex
	running   bool
	cancelled bool
	ctx       context.Context
	cancelFn  context.CancelFunc
}

func NewDownloadQueue(a *App) *DownloadQueue {
	ctx, cancel := context.WithCancel(context.Background())
	return &DownloadQueue{app: a, ctx: ctx, cancelFn: cancel}
}

func (a *App) EnqueueDownloads(tasks []DownloadTask) error {
	if len(tasks) == 0 {
		return nil
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
			q.app.app.Event.Emit("queue:status", "done", 0, "")
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
		q.mu.Unlock()

		log.Printf("[queue] emit queue:file-start name=%s pos=%d left=%d", task.Name, remaining+1, remaining)
		q.app.app.Event.Emit("queue:file-start", task.Name, remaining+1, remaining)

		savePath, err := q.app.downloadFileWithQueue(task.URL, task.SaveDir)
		if err != nil {
			log.Printf("[queue] emit queue:file-done name=%s status=fail err=%v", task.Name, err)
			q.app.app.Event.Emit("queue:file-done", task.Name, "fail", err.Error())
			q.app.AddOpLog("download", task.Name, task.URL, task.SaveDir, 0, "failed", err.Error())
		} else {
			log.Printf("[queue] emit queue:file-done name=%s status=ok", task.Name)
			q.app.app.Event.Emit("queue:file-done", task.Name, "ok", "")
			// 写入导入日志
			var fileSize int64
			if fi, st := os.Stat(savePath); st == nil {
				fileSize = fi.Size()
			}
			q.app.AddOpLog("download", task.Name, task.URL, task.SaveDir, fileSize, "success", "")
		}

		select {
		case <-q.ctx.Done():
			return
		default:
		}
	}
}

func (a *App) downloadFileWithQueue(rawURL, saveDir string) (string, error) {
	if err := os.MkdirAll(saveDir, 0755); err != nil {
		return "", err
	}
	relPath := ""
	repoPath := ""
	if idx := strings.Index(rawURL, "/main/"); idx > 0 {
		relPath = rawURL[idx+6:]
		raw := rawURL
		if strings.HasPrefix(raw, "https://raw.githubusercontent.com/") {
			parts := strings.SplitN(raw[len("https://raw.githubusercontent.com/"):], "/", 3)
			if len(parts) >= 2 {
				repoPath = parts[0] + "/" + parts[1]
			}
		}
	}
	if relPath == "" {
		relPath = filepath.Base(rawURL)
	}
	relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
	// 过滤工坊仓库中可能被提交的 .recycle 目录
	relPath = strings.TrimPrefix(relPath, ".recycle"+string(filepath.Separator))
	savePath := filepath.Join(saveDir, relPath)
	if err := os.MkdirAll(filepath.Dir(savePath), 0755); err != nil {
		return "", err
	}

	mirror := a.LoadAppConfig().Mirror
	type src struct {
		url  string
		kind string
	}
	sources := []src{{rawURL, "raw"}}
	if repoPath != "" {
		jsdURL := "https://cdn.jsdelivr.net/gh/" + repoPath + "@main/" + strings.ReplaceAll(relPath, "\\", "/")
		sources = append(sources, src{jsdURL, "jsd"})
		apiURL := "https://api.github.com/repos/" + repoPath + "/contents/" + strings.ReplaceAll(relPath, "\\", "/")
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
			err = a.downloadFromAPI(s.url, savePath)
		} else {
			err = a.downloadFile(s.url, savePath)
		}
		if err == nil {
			return savePath, nil
		}
		lastErr = err
	}
	return "", fmt.Errorf("所有源均失败: %s", lastErr)
}

func (a *App) DownloadFromGitHub(rawURL string, saveDir string) (string, error) {
	return a.downloadFileWithQueue(rawURL, saveDir)
}

func (a *App) downloadFile(url, savePath string) error {
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(savePath)
	if err != nil {
		return err
	}
	defer out.Close()

	total := resp.ContentLength
	var downloaded int64
	buf := make([]byte, 256*1024)
	lastEmit := time.Now()
	for {
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := out.Write(buf[:n]); wErr != nil {
				return wErr
			}
			downloaded += int64(n)
			if time.Since(lastEmit) > 200*time.Millisecond {
				log.Printf("[queue] emit download:progress dl=%d total=%d", downloaded, total)
				a.app.Event.Emit("download:progress", downloaded, total)
				lastEmit = time.Now()
			}
		}
		if rErr == io.EOF {
			break
		}
		if rErr != nil {
			return rErr
		}
	}
	if total <= 0 {
		total = downloaded
	}
	log.Printf("[queue] emit download:progress dl=%d total=%d (final)", downloaded, total)
	a.app.Event.Emit("download:progress", downloaded, total)
	return nil
}

func (a *App) downloadFromAPI(apiURL, savePath string) error {
	client := &http.Client{Timeout: 300 * time.Second}
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github.v3.raw")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(savePath)
	if err != nil {
		return err
	}
	defer out.Close()

	total := resp.ContentLength
	var downloaded int64
	buf := make([]byte, 256*1024)
	lastEmit := time.Now()
	for {
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := out.Write(buf[:n]); wErr != nil {
				return wErr
			}
			downloaded += int64(n)
			if time.Since(lastEmit) > 200*time.Millisecond {
				log.Printf("[queue] emit download:progress dl=%d total=%d", downloaded, total)
				a.app.Event.Emit("download:progress", downloaded, total)
				lastEmit = time.Now()
			}
		}
		if rErr == io.EOF {
			break
		}
		if rErr != nil {
			return rErr
		}
	}
	if total <= 0 {
		total = downloaded
	}
	log.Printf("[queue] emit download:progress dl=%d total=%d (final)", downloaded, total)
	a.app.Event.Emit("download:progress", downloaded, total)
	return nil
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
