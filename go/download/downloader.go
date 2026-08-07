// Package download 纯下载逻辑，不依赖 Wails runtime。
package download

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 下载参数常量
const (
	// readBufferSize 读取缓冲区大小（256KB）
	readBufferSize = 256 << 10
	// progressEmitInterval 进度上报节流间隔（200ms）
	progressEmitInterval = 200 * time.Millisecond
	// defaultTimeout 默认下载超时（5分钟）
	defaultTimeout = 300 * time.Second
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
	return &Downloader{timeout: defaultTimeout}
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
			// 下载中断/失败时清理半截文件，避免残留损坏文件被扫描/预览
			if err := os.Remove(savePath); err != nil {
				// P3 修复：删除失败（权限/占用）时记录日志，避免半截文件残留无痕迹
				log.Printf("[download] 清理半截文件失败 %s: %v", savePath, err)
			}
		}
	}()

	total := resp.ContentLength
	var downloaded int64
	buf := make([]byte, readBufferSize)
	lastEmit := time.Now()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if _, wErr := out.Write(buf[:n]); wErr != nil {
				return wErr
			}
			downloaded += int64(n)
			if onProgress != nil && time.Since(lastEmit) > progressEmitInterval {
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
		log.Printf("[download] 创建保存目录失败 %s: %v", saveDir, err)
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

	// P1 修复：路径遍历防护——确保 savePath 经 Clean 后仍在 saveDir 下
	savePath = filepath.Clean(savePath)
	absSaveDir, err := filepath.Abs(saveDir)
	if err != nil {
		log.Printf("[download] saveDir 路径异常 %s: %v", saveDir, err)
		return "", "", ""
	}
	absSavePath, err := filepath.Abs(savePath)
	if err != nil {
		log.Printf("[download] savePath 路径异常 %s: %v", savePath, err)
		return "", "", ""
	}
	if !strings.HasPrefix(absSavePath, absSaveDir+string(filepath.Separator)) && absSavePath != absSaveDir {
		log.Printf("[download] 拒绝路径越界: %s (期望在 %s 内)", absSavePath, absSaveDir)
		return "", "", ""
	}

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
