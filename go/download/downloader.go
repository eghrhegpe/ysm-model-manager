// Package download 纯下载逻辑，不依赖 Wails runtime。
package download

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ProgressFn 下载进度回调。downloaded / total 为字节数。
type ProgressFn func(downloaded, total int64)

// Downloader 文件下载器。
type Downloader struct {
	client  *http.Client
	timeout time.Duration
}

// New 创建 Downloader，默认 5 分钟超时。
func New() *Downloader {
	return &Downloader{timeout: 300 * time.Second}
}

// NewWithClient 使用指定 HTTP client。
func NewWithClient(client *http.Client) *Downloader {
	return &Downloader{client: client}
}

func (d *Downloader) httpClient() *http.Client {
	if d.client != nil {
		return d.client
	}
	return &http.Client{Timeout: d.timeout}
}

// downloadTo 下载到 savePath，支持 Accept 头与进度回调；失败/中断时清理半截文件
func (d *Downloader) downloadTo(ctx context.Context, url, savePath, accept string, onProgress ProgressFn) error {
	if err := os.MkdirAll(filepath.Dir(savePath), 0755); err != nil {
		return err
	}

	client := d.httpClient()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := client.Do(req)
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
	ok := false
	defer func() {
		out.Close()
		if !ok {
			// 下载中断/失败时清理半截文件，避免残留损坏文件
			os.Remove(savePath)
		}
	}()

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
			if onProgress != nil && time.Since(lastEmit) > 200*time.Millisecond {
				onProgress(downloaded, total)
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
	ok = true
	if onProgress != nil {
		onProgress(downloaded, total)
	}
	return nil
}

// File 从 URL 下载文件到 savePath，支持进度回调。ctx 取消/超时即中断下载。
func (d *Downloader) File(ctx context.Context, url, savePath string, onProgress ProgressFn) error {
	return d.downloadTo(ctx, url, savePath, "", onProgress)
}

// FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。ctx 取消/超时即中断下载。
func (d *Downloader) FromGitHubAPI(ctx context.Context, apiURL, savePath string, onProgress ProgressFn) error {
	return d.downloadTo(ctx, apiURL, savePath, "application/vnd.github.v3.raw", onProgress)
}

// ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。
func ResolveSavePath(rawURL, saveDir string) (savePath string, jsdURL, apiURL string) {
	if err := os.MkdirAll(saveDir, 0755); err != nil {
		return "", "", ""
	}
	relPath := ""
	repoPath := ""
	branch := ""
	// 支持 main 与 master 默认分支（默认分支非 main 的仓库不再解析失败）
	for _, b := range []string{"/main/", "/master/"} {
		if idx := strings.Index(rawURL, b); idx > 0 {
			relPath = rawURL[idx+len(b):]
			branch = b[1 : len(b)-1]
			break
		}
	}
	if relPath != "" && strings.HasPrefix(rawURL, "https://raw.githubusercontent.com/") {
		parts := strings.SplitN(rawURL[len("https://raw.githubusercontent.com/"):], "/", 3)
		if len(parts) >= 2 {
			repoPath = parts[0] + "/" + parts[1]
		}
	}
	if relPath == "" {
		relPath = filepath.Base(rawURL)
	}
	relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
	relPath = strings.TrimPrefix(relPath, ".recycle"+string(filepath.Separator))
	savePath = filepath.Join(saveDir, relPath)

	if repoPath != "" {
		normalized := strings.ReplaceAll(relPath, "\\", "/")
		if branch == "" {
			branch = "main"
		}
		jsdURL = "https://cdn.jsdelivr.net/gh/" + repoPath + "@" + branch + "/" + normalized
		apiURL = "https://api.github.com/repos/" + repoPath + "/contents/" + normalized
	}
	return
}
