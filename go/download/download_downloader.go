// download_downloader.go：Downloader 主体与下载流程（原 download.go 拆分，2026-10 文件行数治理）。
// New / NewWithClient / downloadTo / File / FileWithChecksum / FromGitHubAPI / FromGitHubAPIWithChecksum——
// Downloader 结构 + 原子写 + SHA256 校验 + 进度回调。
package download

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log"
	"net/http"
	neturl "net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"ysm-model-manager/go/fsutil"
)

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
	// 未缓存时即时构造并赋值到 d.client，后续调用复用同一实例：
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
	// 防止同一 savePath 因写法不同而拿到不同锁、互斥失效。
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
// （备用，非排期——本包队列路径无校验和，续传刻意不做，详见 downloadTo 头【续传决策 · ADR-273】。
// 若将来带 SHA 的调用方需 Resume 模式：OpenFile(O_APPEND) 替代 CreateTemp、
// 本地字节数读取→Range 头计算→commitAtomicWrite 验证链统一复用。）
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
// 原 downloadTo L278-296 CreateTemp+内联 defer 升格（拆分留档；本包续传刻意不做，见 ADR-273）。
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
		_ = tmp.Close()
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
		// 旧实现直接 return，Windows 上句柄未释放会导致后续 Remove 失败、.part 残留。
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
// 【续传决策 · ADR-273】本包续传**刻意不做**：唯一在产消费者是队列路径（app_download.go 的
//
//	 dl.File / FromGitHubAPI），它①无 expectedSHA256、②走 raw→jsdelivr→github-api 三源回退，
//	 跨会话/跨源续传字节流未必一致且无 SHA 兜底 → 拼坏风险；而模型文件仅几 MB、重下成本远低于该风险。
//	 ADR-273 落盘账本对队列只续排「未开始」任务、在途者重启重下，正是有意为之，非缺陷。
//	 续传唯一**安全**落点是 updater（updater.go，带强制 SHA256，见 app_config.go 的 DownloadWithProgress）。
//	 下面七段是 2026-08 第6刀拆分留下的复用插槽，仅作设计留档、非排期承诺；若将来确有带 SHA 的调用方接入，
//	 旁路配方如下：
//	1. prepareDownloadEnv 完全复用（互斥锁、scheme 校验、目录创建、重定向守卫）
//	2. doDownloadRequest → 注入 Range: bytes=N- 头（加 reqModifier 形参）
//	3. validateHTTPResponse → 替换为新建 validatePartialResponse（核对 206 + bytes N-total/total 且 N=本地已收字节，新建安全校验链，不破坏现有 BUG-HTTP-2 防线）
//	4. prepareAtomicWrite → 替换为 resumeAtomicWrite（O_APPEND 打开已有的 .part，读本地字节数填 downloaded）
//	5. copyResponseBodyWithProgress 完全复用（续传继续往文件尾部写）
//	6. verifyDownloadedFile 完全复用（整文件 SHA256 + 字节数一致）
//	7. commitAtomicWrite 完全复用
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
	defer func() { _ = resp.Body.Close() }()

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
