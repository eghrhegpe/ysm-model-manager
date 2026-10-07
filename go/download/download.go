// Package download 纯下载逻辑，不依赖 Wails runtime。
// 2026-10 拆分：原 712 行按职责分为 download.go（本文件：常量 + 锁 + 重试 + 错误类型）/
// download_downloader.go（Downloader 主体与下载流程）/ download_path.go（目标路径解析与安全校验）。
package download

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"ysm-model-manager/go/config"
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

// downloadTimeout 下载超时：AppConfig.DownloadTimeoutSec > 0 用之，否则默认 300s。
// 配置源收敛到 go/config 单持有点（ADR-091 D12），字段 0 = 回退包级默认。
func downloadTimeout() time.Duration {
	if sec := config.Get().DownloadTimeoutSec; sec > 0 {
		return time.Duration(sec) * time.Second
	}
	return defaultTimeout
}

// fileLocks 按目标路径互斥，防止并发（DownloadFromGitHub 与队列）下载同一 savePath
// 时交错截断；配合临时文件 + rename 保证最终文件来自单次完整下载。
// 锁条目常驻不删除：条目数 = 下载过的目标路径数（仓库内文件集合，有自然上限），
// 删除会引入 Unlock→Delete 竞态窗口——等待者持旧锁与新锁并发下载同一路径，互斥承诺失效。
var fileLocks sync.Map

// ============================================================================
// #11 错误分类——sentinel + 类型化错误，替代脆弱的英文子串 contains 匹配。
// 调用方应使用 errors.Is(err, ErrTruncated) / errors.As(err, &httpErr) 分类，
// 不要靠 strings.Contains(err.Error(), "truncated") 这种跨平台/跨版本失效的文本匹配。
// ============================================================================

// 下载错误类别——调用方用 errors.Is 判断，避免依赖错误消息文本（#11 文本匹配反模式）。
var (
	// ErrUnsupportedScheme URL scheme 非 http/https。
	ErrUnsupportedScheme = errors.New("不支持的 URL scheme")
	// ErrRedirectChainTooLong 重定向链超过 10 跳。
	ErrRedirectChainTooLong = errors.New("重定向次数过多")
	// ErrRedirectToUnsafeScheme 重定向到非 http(s) scheme（file/ftp 等，SSRF 风险）。
	ErrRedirectToUnsafeScheme = errors.New("禁止重定向到非 http(s)")
	// ErrPartialResponse 服务端返回 partial 响应（Content-Range 头存在），数据不完整。
	ErrPartialResponse = errors.New("拒绝 partial 响应")
	// ErrNonBinaryContentType 服务端返回 HTML/text 错误页（非二进制 Content-Type）。
	ErrNonBinaryContentType = errors.New("拒绝非二进制响应 Content-Type")
	// ErrTruncated 下载截断——服务端声明 Content-Length 但实际字节数不足（#11 截断静默反模式）。
	ErrTruncated = errors.New("下载截断")
	// ErrChecksumMismatch 下载内容 SHA256 与期望值不符（P2 预留：可选校验，
	// 调用方通过 FileWithChecksum / FromGitHubAPIWithChecksum 传入，不传即跳过，行为零漂移）。
	ErrChecksumMismatch = errors.New("校验和不匹配")
)

// HTTPStatusError 携带 HTTP 状态码与 URL 的类型化错误，调用方用 errors.As 提取码值，
// 替代 strings.Contains(err.Error(), "404") 等脆弱匹配。
// URL 字段：旧 Error() 只输出 `HTTP <code>`，调用方日志难以定位是哪个 URL 返回 4xx/5xx。
type HTTPStatusError struct {
	Code int
	URL  string
}

func (e *HTTPStatusError) Error() string {
	if e.URL != "" {
		return fmt.Sprintf("HTTP %d: %s", e.Code, e.URL)
	}
	return fmt.Sprintf("HTTP %d", e.Code)
}

// TruncationError 携带期望/实际字节数的截断错误，调用方用 errors.As 提取数值做诊断上报。
type TruncationError struct {
	Expected int64
	Actual   int64
}

func (e *TruncationError) Error() string {
	return fmt.Sprintf("%s: 期望 %d 字节, 实际 %d 字节", ErrTruncated, e.Expected, e.Actual)
}

// Unwrap 让 errors.Is(err, ErrTruncated) 成立——调用方既可判断类别（errors.Is），
// 又可提取数值（errors.As），无需文本匹配（#11 错误分类）。
func (e *TruncationError) Unwrap() error { return ErrTruncated }

// ProgressFn 下载进度回调。downloaded / total 为字节数。
type ProgressFn func(downloaded, total int64)

// Downloader 文件下载器。
type Downloader struct {
	client  *http.Client
	timeout time.Duration
	retry   *RetryPolicy // nil = 不重试（行为零漂移）；WithRetry 显式开启
}

// ===== 下载重试（显式开启，默认不重试）=====
// 只对同一 URL 的网络类失败 / 服务端 5xx 退避重试；ctx 取消、4xx、安全 sentinel
// （ErrPartialResponse 等）一律不重试。与三源回退正交：URL 内重试耗尽才轮到换源。
// 默认不重试（retry=nil）——downloadFileWithQueue 的三级回退不叠加重试，
// 避免获取 GitHub 仓库 index 时总时长爆炸；调用方按需 WithRetry 显式开启。

const (
	// defaultRetryMaxAttempts 显式开启重试且 MaxAttempts 为 0 时的总尝试次数（含首次）
	defaultRetryMaxAttempts = 3
	// defaultRetryBackoff 显式开启重试且 Backoff 为 0 时的退避基数（指数增长）
	defaultRetryBackoff = 500 * time.Millisecond
	// maxRetryBackoff 指数退避封顶：backoff<<(attempt-1) 在 attempt 较大时可能溢出（int64 左移超过 63 位）或退避过长（用户无感）。
	// 封顶为 30s：默认 backoff=500ms 时 attempt=7 达到 32s，封顶截断；调用方设 MaxAttempts=20 时 attempt=13 后恒等 30s，避免溢出。
	maxRetryBackoff = 30 * time.Second
)

// RetryPolicy 下载重试策略（字段 0 回退包级默认常量，见 WithRetry 注释）。
type RetryPolicy struct {
	MaxAttempts int           // 总尝试次数（含首次）；0 = 用 defaultRetryMaxAttempts
	Backoff     time.Duration // 退避基数（第 n 次重试等待 backoff<<(n-1)）；0 = 用 defaultRetryBackoff
}

// WithRetry 返回开启重试的下载器副本（不改原实例）。
// 仅对同一 URL 的网络类失败/5xx 退避重试；maxAttempts<=1 等价不重试。
func (d *Downloader) WithRetry(maxAttempts int, backoff time.Duration) *Downloader {
	cp := *d
	cp.retry = &RetryPolicy{MaxAttempts: maxAttempts, Backoff: backoff}
	return &cp
}

// isRetryableError 判断错误是否值得同一 URL 重试。
// 不重试：ctx 取消/超时、4xx、安全 sentinel（partial 伪装/非二进制/scheme/重定向/校验和不符）。
// 重试：服务端 5xx、底层网络错误（timeout/连接重置）、io 断流。
//
// 截断重试 vs 校验和不重试的语义不对称是有意设计：
//   - ErrTruncated（截断）属传输层问题——服务端声明 Content-Length 但实际字节数不足，
//     可能是网络中断导致，重试同一 URL 可能下次完整。
//   - ErrChecksumMismatch（校验和不符）属内容层问题——下载内容与期望 SHA256 不符，
//     重试同一 URL 可能反复不符（内容本身错），不重试避免浪费。
//   - 若截断源于 CDN 限流（反复截断），重试耗尽自然返回末次错误，调用方可换源。
func isRetryableError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	if errors.Is(err, ErrPartialResponse) || errors.Is(err, ErrNonBinaryContentType) ||
		errors.Is(err, ErrUnsupportedScheme) || errors.Is(err, ErrRedirectChainTooLong) ||
		errors.Is(err, ErrRedirectToUnsafeScheme) || errors.Is(err, ErrChecksumMismatch) {
		return false
	}
	var httpErr *HTTPStatusError
	if errors.As(err, &httpErr) {
		return httpErr.Code >= 500
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	return errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, ErrTruncated)
}

// retryDownload downloadTo 的退避重试外壳：默认（retry=nil）直接透传不重试；
// WithRetry 开启时同一 URL 网络类/5xx 失败按指数退避重试，重试耗尽返回末次错误（分类不变）。
func (d *Downloader) retryDownload(ctx context.Context, url, savePath, accept string, onProgress ProgressFn, expectedSHA256 []byte) error {
	if d.retry == nil {
		return d.downloadTo(ctx, url, savePath, accept, onProgress, expectedSHA256)
	}
	attempts := d.retry.MaxAttempts
	if attempts <= 0 {
		attempts = defaultRetryMaxAttempts
	}
	backoff := d.retry.Backoff
	if backoff <= 0 {
		backoff = defaultRetryBackoff
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		lastErr = d.downloadTo(ctx, url, savePath, accept, onProgress, expectedSHA256)
		if lastErr == nil {
			return nil
		}
		if !isRetryableError(lastErr) || attempt == attempts {
			return lastErr
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(min(backoff<<(attempt-1), maxRetryBackoff)):
		}
	}
	return lastErr
}

// New 创建 Downloader，默认 5 分钟超时（可被 AppConfig.DownloadTimeoutSec 覆盖，ADR-062）。
