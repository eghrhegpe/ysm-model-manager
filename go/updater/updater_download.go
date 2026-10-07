// updater_download.go：更新包下载与 SHA256 校验（原 updater.go 拆分，2026-10 文件行数治理）。
// Download / DownloadWithProgress / downloadOnce / writeBodyToTemp / verifyDownloadedTemp——
// 多源回退下载 + 强制 SHA256 校验（防代理替换 exe）。
package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"os"
	"strings"
)

// 多源回退的攻击面（代理被入侵替换 exe）已被 SHA256 强制校验覆盖；
// SSRF 到内网的风险已被 CheckRedirect 守卫覆盖。无需额外域名白名单。
func DownloadWithProgress(assetURL string, expectedHash string, onProgress func(done, total int64)) (string, error) {
	updateLock.Lock()
	defer updateLock.Unlock()

	sources := []string{assetURL}
	for _, prefix := range ghProxyPrefixes {
		sources = append(sources, prefix+assetURL)
	}
	// 用 errors.Join 聚合各源错误而非 strings.Join + %s——
	// %s 会丢失 %w 包装的错误链，调用方 errors.Is/As 无法穿透聚合层做分类
	// （陷阱 #11 文本匹配错误分类：错误链截断迫使调用方退回字符串匹配）
	var errs []error
	for _, src := range sources {
		path, err := downloadOnce(src, expectedHash, onProgress)
		if err == nil {
			return path, nil
		}
		// 确定性失败换源结果相同（哈希缺失/校验失败/大小超限/不完整），直接返回
		// 不重试 ghProxy——重试只服务网络类失败（2026-08-31 R30 收尾修复）
		if errors.Is(err, ErrHashMismatch) || errors.Is(err, ErrDownloadTooBig) || errors.Is(err, ErrDownloadIncomplete) {
			return "", err
		}
		errs = append(errs, fmt.Errorf("%s: %w", src, err))
	}
	return "", fmt.Errorf("更新包下载失败（%d 个源均失败）：\n%w", len(sources), errors.Join(errs...))
}

// newDownloadClient 构建下载用 HTTP 客户端（每源独立 90s 超时：直连慢/卡时快速切镜像）。
// ⚠️ 包级变量便于测试注入自定义 RoundTripper（仅测试注入，禁止生产调用），覆盖完整性校验等不可由真实网络触达的分支。
// 注入 CheckRedirect 守卫，与 go/download 包的 restrictedHTTPClient 同口径：
// 拒绝非 http/https scheme（防 file:///etc/passwd 等本地文件读取）+ 跳数上限 10（防重定向死循环）。
var newDownloadClient = func() *http.Client {
	c := &http.Client{Timeout: downloadTimeout}
	c.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" && req.URL.Scheme != "http" {
			return fmt.Errorf("updater: 拒绝非 http/https 重定向: %s", req.URL)
		}
		if len(via) >= 10 {
			return fmt.Errorf("updater: 重定向链过长 (≥10)")
		}
		return nil
	}
	return c
}

// downloadOnce 单源下载尝试：HTTP GET + 大小截断防护 + SHA256 校验。
// 按职责拆分：建请求 → 空 hash 前置拒绝 → 响应校验 → 落盘（writeBodyToTemp）
// → 完整性校验（verifyDownloadedTemp）；各失败路径的清理由调用方统一收口，重试语义不变。
func downloadOnce(assetURL string, expectedHash string, onProgress func(done, total int64)) (string, error) {
	req, err := newUpdateRequest(assetURL)
	if err != nil {
		return "", err
	}

	// 哈希不可得时**下载前**即拒绝——
	// 空 hash 时换任何源结果相同，重试 ghProxy 纯属浪费；也不为已知
	// 不可校验的包消耗下载流量（原实现下载完才拒绝）。
	if expectedHash == "" {
		return "", fmt.Errorf("%w：SHA256 哈希不可得，拒绝无完整性校验的更新包", ErrHashMismatch)
	}

	client := newDownloadClient()
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()

	if err := validateUpdateResponse(resp, assetURL); err != nil {
		return "", err
	}

	// 固定可预测临时名（filepath.Base(assetURL)）有 TOCTOU/
	// 多实例同名冲突/非法文件名风险——改 os.CreateTemp 唯一名
	f, tmp, err := createUpdateTempFile()
	if err != nil {
		return "", err
	}

	// 限制下载大小（最大 500MB），同时计算 SHA256
	// 预检：Content-Length 超限直接拒绝（省流量，防磁盘写满）
	if resp.ContentLength > maxDownloadSize {
		// 超限早退前先 Close 再 Remove——原 os.Remove(tmp)
		// 时 f 未关闭，Windows 删除打开中的文件必然失败（错误被忽略 → 文件残留）
		// 且 f 句柄泄漏（该路径无任何 Close）
		removeTempFile(f, tmp)
		return "", fmt.Errorf("更新包过大（%d 字节），超过 %d 字节上限: %w", resp.ContentLength, maxDownloadSize, ErrDownloadTooBig)
	}

	hasher := sha256.New()
	n, prog, err := writeBodyToTemp(f, resp, hasher, onProgress)
	if err != nil {
		_ = os.Remove(tmp) // 最佳努力清理，失败不影响报错返回（写侧错误路径已在 helper 内 Close）
		return "", err
	}

	// 未知长度（chunked）下载的尾块补发——progressWriter 按
	// 512KB 节流，最后不足 512KB 的尾块与 <512KB 的短包全程零回调，前端进度条
	// 停在陈旧字节数；补发最终 (n, 0) 保证进度弹窗显示真实最终字节数。
	// 已知长度分支在 Copy 内已由 written>=total 触发 100% 回调，无需补发。
	// （prog.total <= 0 与下面的长度一致性校验 total > 0 互斥，顺序无可观测差异）
	if onProgress != nil && prog.total <= 0 && n > prog.lastBytes {
		onProgress(n, 0)
	}

	// 校验完整性：长度一致 + SHA256 匹配（空 hash 已由本函数开头前置拒绝，此处恒非空）
	if err := verifyDownloadedTemp(tmp, n, prog.total, expectedHash, hex.EncodeToString(hasher.Sum(nil))); err != nil {
		return "", err
	}

	return tmp, nil
}

// newUpdateRequest 构造下载请求（带 UA；URL 非法时在发起网络请求前返回错误）。
func newUpdateRequest(assetURL string) (*http.Request, error) {
	req, err := http.NewRequest("GET", assetURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "YSM-Model-Manager/")
	return req, nil
}

// validateUpdateResponse 响应头校验，三道与 go/download 对齐的防御口径：
//   - 非 200 直接拒绝——原实现不检查状态码，asset URL 返回 404 时
//     在 expectedHash=="" 场景下错误页 HTML 会被当更新包写入 tmp 并返回成功
//     （随后 InstallUpdate 才报 exe 打开失败，用户被误导为已下载成功）；
//   - BUG(INFO-CT) 修复：Content-Type 为 HTML/XML 时拒绝——
//     攻击者返回 text/html 错误页（含恶意内容），downloadOnce 无 Content-Type 校验会将其当作更新包写入。
//     与 go/download HTTP-5 同源问题，对齐防御口径（仅拒绝 HTML/XML，保留 text/plain 等）；
//   - BUG(INFO-RANGE) 修复：Content-Range 部分响应拒绝——
//     攻击者返回 200+Content-Range 截断更新包，导致安装后版本不完整。
//     与 go/download HTTP-2 同源问题，对齐防御口径。
func validateUpdateResponse(resp *http.Response, assetURL string) error {
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("更新包下载失败: HTTP %d（%s）", resp.StatusCode, assetURL)
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		low := strings.ToLower(ct)
		isTextHTML := strings.Contains(low, "text/html") || strings.Contains(low, "application/xhtml+xml")
		isXML := strings.Contains(low, "application/xml") || strings.Contains(low, "text/xml")
		if isTextHTML || isXML {
			return fmt.Errorf("更新包 Content-Type 非二进制: %s", ct)
		}
	}

	if cr := resp.Header.Get("Content-Range"); cr != "" {
		return fmt.Errorf("更新包部分响应（Content-Range）: %s", cr)
	}
	return nil
}

// createUpdateTempFile 建唯一名临时文件并做 symlink 劫持防护，返回句柄与路径。
//
// os.CreateTemp 在系统临时目录创建文件，若 TMPDIR 被设为攻击者可写路径，
// 或临时目录存在符号链接劫持，下载的 exe 可被替换。
// 创建后用 os.Lstat 校验：若发现是符号链接则拒绝（fail-closed）。
func createUpdateTempFile() (*os.File, string, error) {
	f, err := os.CreateTemp("", "ysm-update-*.tmp")
	if err != nil {
		return nil, "", err
	}
	tmp := f.Name()
	if fi, lerr := os.Lstat(tmp); lerr == nil && fi.Mode()&os.ModeSymlink != 0 {
		removeTempFile(f, tmp)
		return nil, "", fmt.Errorf("临时文件 %s 是符号链接，拒绝写入（防 symlink 劫持）", tmp)
	}
	return f, tmp, nil
}

// removeTempFile 关闭并删除下载临时文件（最佳努力：两个错误都忽略，不影响拒绝/报错返回）。
// 先 Close 再 Remove 是 Windows 硬要求——删除打开中的文件必然失败，错误被忽略后
// 文件残留且句柄泄漏（原「超限早退」路径的历史 bug）。
func removeTempFile(f *os.File, path string) {
	_ = f.Close()
	_ = os.Remove(path)
}

// writeBodyToTemp 把响应体写入 f（上限 maxDownloadSize 截断）并同步喂给 hasher，
// 末尾关闭 f；返回实收字节数与进度计数器（prog.total 为归一化期望长度，0=分块未知）。
//
// 语义与拆分前逐字一致：限流拷贝 → 读到上限后再读 1 字节做截断探测 → Close；
// copy 错误优先于 close 错误上报（清理统一由调用方按错误返回收口）。
//
// 截断检测：读到上限后再读 1 字节，若仍有数据说明更新包超限被截断
// （无 Content-Length 的分块传输场景兜底，防止截断包被装盘）。
// 探测读错误不再忽略——chunked 服务器发满后卡死时
// Read 阻塞到超时返回 (0, timeout err)，原 `extra, _ :=` 把 extra==0 当"未截断"
// 接受截断文件（陷阱 #33 残余命中）；只放行正常 EOF，其余一律拒绝。
func writeBodyToTemp(f *os.File, resp *http.Response, hasher hash.Hash, onProgress func(done, total int64)) (int64, *progressWriter, error) {
	total := resp.ContentLength
	if total < 0 {
		total = 0 // 分块传输：大小未知，进度按字节节流回调
	}
	prog := &progressWriter{total: total, onProgress: onProgress}
	n, err := io.Copy(
		io.MultiWriter(f, prog),
		io.TeeReader(io.LimitReader(resp.Body, maxDownloadSize), hasher),
	)
	if n >= maxDownloadSize {
		one := make([]byte, 1)
		extra, probeErr := resp.Body.Read(one)
		if extra > 0 || (probeErr != nil && probeErr != io.EOF) {
			_ = f.Close()
			return n, prog, fmt.Errorf("更新包超过 %d 字节上限（截断探测失败: %v）: %w", maxDownloadSize, probeErr, ErrDownloadTooBig)
		}
	}
	closeErr := f.Close()
	if err != nil {
		return n, prog, err
	}
	return n, prog, closeErr
}

// verifyDownloadedTemp 完整性收口：Content-Length 已知时实收字节必须一致，且 SHA256 必须匹配；
// 任一失败即清理临时文件并报错（空 hash 已由 downloadOnce 开头前置拒绝，此处恒非空）。
//
// BUG(INFO-CL) 修复：完整性校验防限流器/代理在「干净 EOF」下静默截断（陷阱 #11 限流器截断静默）。
// 标准 http client 对提前关闭的 CL 响应返回 unexpected EOF（由 writeBodyToTemp 的 copy 错误分支
// 拒绝），此检查为纵深防御，兜底自定义传输层返回「n<total 且 err==nil」的异常场景。
func verifyDownloadedTemp(tmp string, n, total int64, expectedHash, actual string) error {
	if total > 0 && n != total {
		_ = os.Remove(tmp) // 最佳努力清理，失败不影响报错返回
		return fmt.Errorf("%w：期望 %d 字节，实际收到 %d 字节", ErrDownloadIncomplete, total, n)
	}
	if !strings.EqualFold(actual, expectedHash) {
		_ = os.Remove(tmp) // 最佳努力清理，失败不影响报错返回
		return fmt.Errorf("%w：\n期望 %s\n实际 %s\n文件可能被篡改或下载不完整", ErrHashMismatch, expectedHash, actual)
	}
	return nil
}

// CleanupOldVersion 启动时清理上一次更新留下的 .old 文件
