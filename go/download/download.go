// Package download 纯下载逻辑，不依赖 Wails runtime。
package download

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/config"
	"ysm-model-manager/go/fsutil"
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
// URL 字段（R26 P4-1）：旧 Error() 只输出 `HTTP <code>`，调用方日志难以定位是哪个 URL 返回 4xx/5xx。
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
	// maxRetryBackoff 指数退避封顶（R26 P3-1）：backoff<<(attempt-1) 在 attempt
	// 较大时可能溢出（int64 左移超过 63 位）或退避过长（用户无感）。
	// 封顶为 30s：默认 backoff=500ms 时 attempt=7 达到 32s，封顶截断；
	// 调用方设 MaxAttempts=20 时 attempt=13 后恒等 30s，避免溢出。
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
// 截断重试 vs 校验和不重试的语义不对称是有意设计（R26 P4-2 澄清）：
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
func New() *Downloader {
	timeout := downloadTimeout()
	return &Downloader{
		timeout: timeout,
		client:  &http.Client{Timeout: timeout},
	}
}

// NewWithClient 使用指定 HTTP client。
func NewWithClient(client *http.Client) *Downloader {
	return &Downloader{client: client}
}

func (d *Downloader) httpClient() *http.Client {
	if d.client != nil {
		return d.client
	}
	// 未缓存时即时构造并赋值到 d.client，后续调用复用同一实例（R26 P3-3）：
	// 旧实现每次 new 一个 http.Client，无连接池/keepalive 复用，并发下载场景性能差。
	c := &http.Client{Timeout: d.timeout}
	d.client = c
	return c
}

// ===== downloadTo 子函数（2026-08-25 第6刀拆分；断点续传接入点落在
//       validateHTTPResponse 之后、prepareAtomicWrite 之前，新增 Range 请
//       求 + 206 安全校验链 + 复用 copyResponseBodyWithProgress 即可）=====

// restrictedHTTPClient 返回带 SSRF 重定向守卫的 HTTP client（浅拷贝原 client，不影响复用）：
//   - 仅允许 http/https 重定向（禁止到 file/ftp 等本地协议，SSRF 防护）
//   - 重定向链 ≥10 返回 ErrRedirectChainTooLong
//
// 是 ADR 续传设计中"安全 client 前置"的一部分：续传的 Range 请求也必须挂同一守卫。
func (d *Downloader) restrictedHTTPClient() *http.Client {
	base := d.httpClient()
	cp := *base
	cp.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" && req.URL.Scheme != "http" {
			return fmt.Errorf("%w: %s", ErrRedirectToUnsafeScheme, req.URL)
		}
		if len(via) >= 10 {
			return ErrRedirectChainTooLong
		}
		return nil
	}
	return &cp
}

// prepareDownloadEnv 预处理下载前置环境：URL scheme 校验（仅 http/https，防 file/ftp 本地源）
// + 同 savePath 互斥锁（防并发交错截断）+ 目标目录 MkdirAll + 返回受限重定向 client。
// 锁通过 defer Unlock 释放（调用方拿到后要自己挂 defer）——锁在子函数里创建、交给
// 调用方释放，是 sync.Map 条目"常驻不删"语义下的最小耦合模式。
// 原 downloadTo L214-243 内联 30 行升格；ADR 续传在前置阶段复用同一流程（互斥锁对
// 断点续传尤其关键——两段下载并发写同一路径时续传的 seek 会直接写坏数据）。
func (d *Downloader) prepareDownloadEnv(url, savePath string) (*http.Client, *sync.Mutex, error) {
	u, err := neturl.Parse(url)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, nil, fmt.Errorf("%w: %q（仅支持 http/https）", ErrUnsupportedScheme, url)
	}
	// 规范化锁键：filepath.Clean 消除尾分隔符/双斜杠/.. 等差异，
	// 防止同一 savePath 因写法不同而拿到不同锁、互斥失效（R26 P3-2）。
	lockKey := filepath.Clean(savePath)
	mu, _ := fileLocks.LoadOrStore(lockKey, &sync.Mutex{})
	m := mu.(*sync.Mutex)
	m.Lock() // 交给调用方 defer Unlock
	if err := os.MkdirAll(filepath.Dir(savePath), fsutil.DirPerms); err != nil {
		m.Unlock()
		return nil, nil, fmt.Errorf("创建目录失败 %s: %w", filepath.Dir(savePath), err)
	}
	return d.restrictedHTTPClient(), m, nil
}

// doDownloadRequest 发起 GET 请求 + 区分错误分类（ctx 取消 vs 网络失败），
// 成功时返回 resp 带 Body，调用方负责 Close。
// 原 downloadTo L244-259 内联 16 行升格；续传阶段把 Range 头组装也放在这里入口
// （第二个参数追加 reqModifier func(*http.Request) 即可，零侵入）。
func doDownloadRequest(ctx context.Context, client *http.Client, url, accept string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("构造请求失败 %s: %w", url, err)
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := client.Do(req)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, fmt.Errorf("下载被取消 %s: %w", url, ctxErr)
		}
		return nil, fmt.Errorf("请求失败 %s: %w", url, err)
	}
	return resp, nil
}

// validateHTTPResponse 三道 HTTP 安全守卫（逐字节复刻 BUG-HTTP-2 / BUG-HTTP-5 原规则）：
//  1. StatusCode == 200 → 非 200 一律抛 HTTPStatusError（供 errors.As 取码）
//  2. 禁止 Content-Range 响应头 → 200+Range 伪装完整响应也被拒（ErrPartialResponse）
//  3. Content-Type 必为二进制类 → HTML/XML 错误页被拒（ErrNonBinaryContentType）
//
// 【ADR 续传重要说明】断点续传必须**单独**新建安全 206 校验函数（核对 bytes N-total/total
// 且 N=本地已收字节），走 Range 分支不要复用本函数——本函数对 Content-Range 的拒绝是
// 完整响应路径的安全防线，动它即语义变更，不与功能顺手捆绑。
func validateHTTPResponse(resp *http.Response) error {
	if resp.StatusCode != http.StatusOK {
		url := ""
		if resp.Request != nil && resp.Request.URL != nil {
			url = resp.Request.URL.String()
		}
		return &HTTPStatusError{Code: resp.StatusCode, URL: url}
	}
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		return fmt.Errorf("%w: Content-Range: %q", ErrPartialResponse, cr)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" && !isBinaryContentType(ct) {
		return fmt.Errorf("%w: %q", ErrNonBinaryContentType, ct)
	}
	return nil
}

// atomicFile 原子写入会话：封装同目录临时文件的成功/失败路径管理。
// 续传 ADR 落地时会新增「Resume 模式」：OpenFile(O_APPEND) 替代 CreateTemp、
// 本地字节数读取→Range 头计算→commitAtomicWrite 验证链统一复用。
type atomicFile struct {
	tmp       *os.File
	tmpName   string
	savePath  string
	committed bool
}

// prepareAtomicWrite 创建同目录临时文件 + 返回 cleanup 闭包（随失败路径自动清理）。
// 闭包语义：commit() 之前任何错误返回都由 defer cleanup(false) 执行 Windows 安全顺序
// （先 Close 再 Remove——Windows 无法删打开句柄；Close 对已 Close 无害）；
// cleanup(true) 等价 commitAtomicWrite（预留简化接口）。
// 原 downloadTo L278-296 CreateTemp+内联 defer 升格，后续续传的 Resume 模式封装入口。
func prepareAtomicWrite(savePath string) (*atomicFile, func(), error) {
	tmp, err := os.CreateTemp(filepath.Dir(savePath), filepath.Base(savePath)+".part-*")
	if err != nil {
		return nil, nil, fmt.Errorf("创建临时文件失败: %w", err)
	}
	af := &atomicFile{tmp: tmp, tmpName: tmp.Name(), savePath: savePath}
	cleanup := func() {
		if af.committed {
			return
		}
		// Windows 顺序必须 Close→Remove：句柄未释放时 Remove 必然失败
		// Close 对已关闭文件返回 error 不影响清理结果（成功路径 committed=true 不进这里）
		tmp.Close()
		if err := os.Remove(af.tmpName); err != nil {
			log.Printf("[download] 清理半截临时文件失败 %s: %v", af.tmpName, err)
		}
	}
	return af, cleanup, nil
}

// copyResponseBodyWithProgress 从 resp.Body 流式复制到 af.tmp，带 ctx 轮询取消 +
// 200ms 进度节流 emit + 最后返回 (total, downloaded) 两值供后续校验复用。
// 服务端不声明 Content-Length 时 total=-1（contentLengthKnown=false，调用方跳过
// 截断校验）。读取/写入过程中 ctx 取消优先于 IO 错误返回（错误分类一致）。
// 原 downloadTo L298-333 Read→Write→Progress→EOF 内联 36 行升格；续传 ADR 可以把
// buf 与 downloaded 作为输入（续传从本地已收字节起算）直接复用同一循环。
func copyResponseBodyWithProgress(
	ctx context.Context,
	r io.Reader,
	w io.Writer,
	total int64,
	onProgress ProgressFn,
) (downloaded int64, err error) {
	buf := make([]byte, readBufferSize)
	lastEmit := time.Now()
	for {
		select {
		case <-ctx.Done():
			return downloaded, fmt.Errorf("下载被取消: %w", ctx.Err())
		default:
		}
		n, rErr := r.Read(buf)
		if n > 0 {
			if _, wErr := w.Write(buf[:n]); wErr != nil {
				return downloaded, fmt.Errorf("写入临时文件失败: %w", wErr)
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
			if ctxErr := ctx.Err(); ctxErr != nil {
				return downloaded, fmt.Errorf("下载被取消: %w", ctxErr)
			}
			return downloaded, fmt.Errorf("读取响应体失败: %w", rErr)
		}
	}
	return downloaded, nil
}

// verifyDownloadedFile 下载内容完整性校验：
//  1. Content-Length 截断校验（声明了就严格匹配，少=提前断流，多=服务端异常）
//     → TruncationError{Expected, Actual}（errors.Is 可匹配 ErrTruncated）
//  2. 可选 SHA256 校验（expectedSHA256 非空启用）→ ErrChecksumMismatch
//
// 校验全部通过后返回 (usedTotal)——当 total≤0（未声明 Content-Length）时用 downloaded
// 填 total，供最终进度回调展示。续传落地时第 2 步 SHA256 校验自然复用（整文件哈希不
// 变），第 1 步需要改成「已收 + 续传字节 = total」。
func verifyDownloadedFile(
	tmp *os.File,
	total, downloaded int64,
	contentLengthKnown bool,
	expectedSHA256 []byte,
) (usedTotal int64, err error) {
	if contentLengthKnown {
		if downloaded < total || downloaded > total {
			return 0, &TruncationError{Expected: total, Actual: downloaded}
		}
	}
	if len(expectedSHA256) > 0 {
		if _, err := tmp.Seek(0, io.SeekStart); err != nil {
			return 0, fmt.Errorf("定位临时文件失败: %w", err)
		}
		h := sha256.New()
		if _, err := io.Copy(h, tmp); err != nil {
			return 0, fmt.Errorf("计算 SHA256 失败: %w", err)
		}
		if actual := h.Sum(nil); !bytes.Equal(actual, expectedSHA256) {
			return 0, fmt.Errorf("%w: 期望 %x, 实际 %x", ErrChecksumMismatch, expectedSHA256, actual)
		}
	}
	if total <= 0 {
		return downloaded, nil
	}
	return total, nil
}

// commitAtomicWrite 原子装盘三部曲：Sync（落盘）→ Close（句柄释放前校验）→ Rename
// （同目录原子覆盖旧文件）。任何一步失败都不把 af.committed 置 true——外层 cleanup(false)
// 由 defer 兜底清理残留临时文件，最终 savePath 上的旧文件不受影响（P1 原子性承诺）。
// 成功后按 usedTotal / downloaded 发最终进度回调（当调用方 chunked 编码也需要最终
// 100% 进度事件给 UI 收尾）。
func commitAtomicWrite(af *atomicFile, downloaded, usedTotal int64, onProgress ProgressFn) error {
	if err := af.tmp.Sync(); err != nil {
		// Sync 失败时显式 Close 释放句柄，避免依赖外层 cleanup 的 Close 顺序
		// （R26 P2-2：旧实现直接 return，Windows 上句柄未释放会导致后续 Remove 失败、.part 残留）。
		// Close 的错误被丢弃——Sync 已失败，Close 失败不影响错误分类。
		_ = af.tmp.Close()
		return fmt.Errorf("同步下载文件失败 %s: %w", af.tmpName, err)
	}
	if err := af.tmp.Close(); err != nil {
		return fmt.Errorf("关闭下载文件失败 %s: %w", af.savePath, err)
	}
	if err := os.Rename(af.tmpName, af.savePath); err != nil {
		return fmt.Errorf("移动临时文件失败 %s -> %s: %w", af.tmpName, af.savePath, err)
	}
	af.committed = true
	if onProgress != nil {
		onProgress(downloaded, usedTotal)
	}
	return nil
}

// downloadTo 下载到 savePath，支持 Accept 头与进度回调；失败/中断时清理半截临时文件。
// expectedSHA256 非空时校验下载内容 SHA256 一致才装盘（P2 预留）；为空则跳过校验，
// 行为零漂移。
// 错误分类用 sentinel（ErrTruncated 等）+ 类型化（HTTPStatusError / TruncationError），
// 调用方用 errors.Is / errors.As 判断类别，不要靠英文子串 contains 匹配（#11 反模式）。
//
// 【ADR 断点续传接入点】：七段子函数是清晰的插槽。续传新增一条旁路：
//  1. prepareDownloadEnv 完全复用（互斥锁、scheme 校验、目录创建、重定向守卫）
//  2. doDownloadRequest → 注入 Range: bytes=N- 头（加 reqModifier 形参）
//  3. validateHTTPResponse → 替换为新建 validatePartialResponse（核对 206 + bytes N-total/total 且 N=本地已收字节，新建安全校验链，不破坏现有 BUG-HTTP-2 防线）
//  4. prepareAtomicWrite → 替换为 resumeAtomicWrite（O_APPEND 打开已有的 .part，读本地字节数填 downloaded）
//  5. copyResponseBodyWithProgress 完全复用（续传继续往文件尾部写）
//  6. verifyDownloadedFile 完全复用（整文件 SHA256 + 字节数一致）
//  7. commitAtomicWrite 完全复用
func (d *Downloader) downloadTo(ctx context.Context, url, savePath, accept string, onProgress ProgressFn, expectedSHA256 []byte) error {
	// 阶段 ①：环境准备（scheme 校验 + 互斥锁 + 目录 + 受限重定向 client）
	client, mu, err := d.prepareDownloadEnv(url, savePath)
	if err != nil {
		return err
	}
	defer mu.Unlock()

	// 阶段 ②：发起请求 + ctx/网络错误分类
	resp, err := doDownloadRequest(ctx, client, url, accept)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// 阶段 ③：HTTP 安全三道守卫（StatusCode/Content-Range/ContentType）
	// 【续传注意】此处完整响应路径的 Content-Range 防线不可绕过；续传 206 校验需另建函数。
	if err := validateHTTPResponse(resp); err != nil {
		return err
	}

	// 阶段 ④：原子写入会话（CreateTemp + 失败清理 defer）
	af, cleanup, err := prepareAtomicWrite(savePath)
	if err != nil {
		return err
	}
	defer cleanup()

	// 阶段 ⑤：流式复制 + 进度节流；contentLengthKnown=true 后续第⑥步启用截断校验
	total := resp.ContentLength
	contentLengthKnown := total >= 0
	downloaded, err := copyResponseBodyWithProgress(ctx, resp.Body, af.tmp, total, onProgress)
	if err != nil {
		return err
	}

	// 阶段 ⑥：完整性校验（Content-Length 截断 + 可选 SHA256）；
	// 通过时返回用于最终进度的 usedTotal（chunked 编码时回退 downloaded）
	usedTotal, err := verifyDownloadedFile(af.tmp, total, downloaded, contentLengthKnown, expectedSHA256)
	if err != nil {
		return err
	}

	// 阶段 ⑦：Sync→Close→Rename 原子装盘 + 最终 100% 进度回调
	return commitAtomicWrite(af, downloaded, usedTotal, onProgress)
}

// File 从 URL 下载文件到 savePath，支持进度回调。ctx 取消/超时即中断下载。
func (d *Downloader) File(ctx context.Context, url, savePath string, onProgress ProgressFn) error {
	return d.retryDownload(ctx, url, savePath, "", onProgress, nil)
}

// FileWithChecksum 与 File 相同，额外校验下载内容 SHA256 与期望值一致。
// expectedSHA256 为空（nil/零长）时跳过校验，行为与 File 完全一致（P2 预留）。
func (d *Downloader) FileWithChecksum(ctx context.Context, url, savePath string, onProgress ProgressFn, expectedSHA256 []byte) error {
	return d.retryDownload(ctx, url, savePath, "", onProgress, expectedSHA256)
}

// FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。ctx 取消/超时即中断下载。
func (d *Downloader) FromGitHubAPI(ctx context.Context, apiURL, savePath string, onProgress ProgressFn) error {
	return d.retryDownload(ctx, apiURL, savePath, "application/vnd.github.v3.raw", onProgress, nil)
}

// FromGitHubAPIWithChecksum 与 FromGitHubAPI 相同，额外校验 SHA256（P2 预留，语义同 FileWithChecksum）。
func (d *Downloader) FromGitHubAPIWithChecksum(ctx context.Context, apiURL, savePath string, onProgress ProgressFn, expectedSHA256 []byte) error {
	return d.retryDownload(ctx, apiURL, savePath, "application/vnd.github.v3.raw", onProgress, expectedSHA256)
}

// isBinaryContentType 判断 Content-Type 是否非"错误页"。
// 真实风险：服务端 502/503/404 返回 HTML/XML 错误页被当文件装盘。
// 策略：拒绝 HTML + XML 类型（反向代理常见 XML 错误页），其余全部放行——
// 避免误伤文本文件（.json / .ysm 配置等）与未知类型。空 Content-Type（HTTP/1.0 常见）放行。
func isBinaryContentType(ct string) bool {
	if ct == "" {
		return true
	}
	ct = strings.ToLower(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]))
	// 仅拒绝 HTML/XHTML 错误页——这是唯一会伪装成"完整响应"的危险文本类型
	nonFileTypes := map[string]bool{
		"text/html":             true,
		"application/xhtml+xml": true,
		"application/xml":       true, // 纯 XML 错误页常见于反向代理
		"text/xml":              true,
	}
	return !nonFileTypes[ct]
}

// ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。
func ResolveSavePath(rawURL, saveDir string) (savePath string, jsdURL, apiURL string) {
	if err := os.MkdirAll(saveDir, fsutil.DirPerms); err != nil {
		log.Printf("[download] 创建保存目录失败 %s: %v", saveDir, err)
		return "", "", ""
	}
	// BUG-B-1/2/13 修复：用 neturl.Parse 分离 path/query/fragment，
	// 分支标记（/main/ /master/）只在 URL path 段查找，避免 query 中的 "/main/" 误识别为分支；
	// 提取的 relPath 不携带 query/fragment，避免 savePath/jsdURL/apiURL 污染。
	u, err := neturl.Parse(rawURL)
	if err != nil {
		log.Printf("[download] URL 解析失败 %s: %v", rawURL, err)
		return "", "", ""
	}
	urlPath := u.Path
	if urlPath == "" {
		urlPath = rawURL // 降级：无法解析时使用原始 URL
	}

	relPath := ""
	repoPath := ""
	branch := ""
	// raw.githubusercontent.com 结构化定位：/{owner}/{repo}/{branch}/{path...} 固定四段式，
	// 分支名任意（dev/develop/release/1.0 等）都能拿到完整 relPath 与带正确分支的
	// jsd/api 回退源，不再依赖 /main/ /master/ 枚举（枚举只对默认分支恰好是二者的仓库有效）。
	// host 大小写不敏感（RFC 3986），且 u 已在上方 Parse——不用字符串前缀判定
	if strings.EqualFold(u.Host, "raw.githubusercontent.com") {
		if parts := strings.SplitN(strings.TrimPrefix(urlPath, "/"), "/", 4); len(parts) == 4 &&
			parts[0] != "" && parts[1] != "" && parts[2] != "" && parts[3] != "" {
			repoPath = parts[0] + "/" + parts[1]
			branch = parts[2]
			relPath = parts[3]
		}
	}
	if relPath == "" {
		// 支持 main 与 master 默认分支（默认分支非 main 的仓库不再解析失败）；
		// 非 raw 前缀来源（jsdelivr 直链等）走此回退。
		for _, b := range []string{"/main/", "/master/"} {
			if idx := strings.Index(urlPath, b); idx > 0 {
				relPath = urlPath[idx+len(b):]
				branch = b[1 : len(b)-1]
				break
			}
		}
	}
	if relPath == "" {
		relPath = filepath.Base(u.Path)
		if relPath == "" {
			relPath = filepath.Base(rawURL)
		}
	}
	relPath = strings.ReplaceAll(relPath, "/", string(filepath.Separator))
	// BUG-B-8 修复：剔除 .git/ 前缀，防止下载 .git/config 泄露仓库 token/远端配置。
	relPath = strings.TrimPrefix(relPath, ".git"+string(filepath.Separator))
	// #8 回收站目录隔离：剔除 relPath 中所有名为 .recycle 的目录段（大小写不敏感，
	// 对齐 fsutil.IsRecycleDir 的 EqualFold 口径——dedup/scanner/sync 把任意层级的 .recycle
	// 视为回收站）。若下载落到 saveDir 下任意 .recycle 子树：扫描器会跳过该文件（不可见）、
	// 回收站 Empty() 会 RemoveAll 整目录（下载文件被静默清除），Windows 大小写不敏感下
	// .Recycle/.RECYCLE 亦指向同一目录。逐段剔除保证下载不落入任何回收站目录。
	relPath = stripRecycleSegments(relPath)
	if relPath == "" {
		log.Printf("[download] 拒绝空路径（URL 路径仅含 .recycle/.git 段）: %s", rawURL)
		return "", "", ""
	}
	// NUL 字节跨平台差异修复——Windows filepath.Abs 遇到 NUL 直接报错（攻击失效），
	// Linux/macOS filepath.Abs 放行，但 os.Create("file.ysm\x00.exe") 实际创建的是 "file.ysm"
	// （C 字符串以 NUL 截断，后缀被剥离），攻击者可绕过前端扩展名校验。
	// 主动剔除，跨平台一致行为。
	if strings.Contains(relPath, "\x00") {
		log.Printf("[download] 拒绝含 NUL 字节的路径: %s", rawURL)
		return "", "", ""
	}
	savePath = filepath.Join(saveDir, relPath)

	// 路径遍历防护——确保 savePath 经 Clean 后仍在 saveDir 下
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
		normalized := filepath.ToSlash(relPath)
		if branch == "" {
			branch = "main"
		}
		jsdURL = "https://cdn.jsdelivr.net/gh/" + repoPath + "@" + branch + "/" + normalized
		apiURL = "https://api.github.com/repos/" + repoPath + "/contents/" + normalized
	}
	return
}

// stripRecycleSegments 移除 relPath 中所有名为 .recycle 的目录段（大小写不敏感，
// 与 fsutil.IsRecycleDir 的 EqualFold 语义一致）。返回空串时由调用方拒绝该 URL
// （见 ResolveSavePath 的 relPath=="" 守卫），不会落盘到回收站目录。
func stripRecycleSegments(relPath string) string {
	sep := string(filepath.Separator)
	segs := strings.Split(relPath, sep)
	out := make([]string, 0, len(segs))
	for _, seg := range segs {
		if strings.EqualFold(seg, ".recycle") {
			continue
		}
		out = append(out, seg)
	}
	return strings.Join(out, sep)
}
