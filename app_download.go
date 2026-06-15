// ========== 下载队列 ==========
// 从 app.go 拆分：串行下载队列、文件下载、镜像回退
package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/ysm"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

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
	cancel    chan struct{}
}

func NewDownloadQueue(a *App) *DownloadQueue {
	return &DownloadQueue{app: a, cancel: make(chan struct{})}
}

func (a *App) EnqueueDownloads(tasks []DownloadTask) error {
	if len(tasks) == 0 {
		return nil
	}
	a.queue.mu.Lock()
	a.queue.tasks = append(a.queue.tasks, tasks...)
	total := len(a.queue.tasks)
	a.queue.mu.Unlock()
	runtime.EventsEmit(a.ctx, "queue:status", "enqueued", total, "")
	if !a.queue.running {
		go a.queue.process()
	}
	return nil
}

func (a *App) CancelQueue() {
	a.queue.mu.Lock()
	defer a.queue.mu.Unlock()
	a.queue.cancelled = true
	if a.queue.running {
		close(a.queue.cancel)
		a.queue.cancel = make(chan struct{})
	}
	a.queue.tasks = nil
	a.queue.running = false
	runtime.EventsEmit(a.ctx, "queue:status", "cancelled", 0, "")
}

func (a *App) QueueStatus() (int, bool) {
	a.queue.mu.Lock()
	defer a.queue.mu.Unlock()
	return len(a.queue.tasks), a.queue.running
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
			runtime.EventsEmit(q.app.ctx, "queue:status", "done", 0, "")
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

		runtime.EventsEmit(q.app.ctx, "queue:file-start", task.Name, remaining+1, remaining)

		savePath, err := q.app.downloadFileWithQueue(task.URL, task.SaveDir)
		if err != nil {
			runtime.EventsEmit(q.app.ctx, "queue:file-done", task.Name, "fail", err.Error())
		} else {
			runtime.EventsEmit(q.app.ctx, "queue:file-done", task.Name, "ok", "")
			// 写入导入日志
			var fileSize int64
			if fi, st := os.Stat(savePath); st == nil {
				fileSize = fi.Size()
			}
			q.app.AddImportLog(task.Name, task.URL, task.SaveDir, fileSize, "success", "")
		}

		select {
		case <-q.cancel:
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
			if total > 0 && time.Since(lastEmit) > 200*time.Millisecond {
				runtime.EventsEmit(a.ctx, "download:progress", total, downloaded)
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
	runtime.EventsEmit(a.ctx, "download:progress", total, downloaded)
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
			if total > 0 && time.Since(lastEmit) > 200*time.Millisecond {
				runtime.EventsEmit(a.ctx, "download:progress", total, downloaded)
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
	runtime.EventsEmit(a.ctx, "download:progress", total, downloaded)
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
