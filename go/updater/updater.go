package updater

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/semver"
)

// repoOwner/repoName GitHub 仓库定位（测试可覆盖为本地镜像/自定义仓库，
// 对齐 debounceDelay / maxDownloadSize 的包级 var 模式，索引 6.9a）
var repoOwner = "eghrhegpe"
var repoName = "ysm-model-manager"

// asset 命名模板（v1.13.0 起纯 exe 发布；非 Windows 分支 .tar.gz 为占位，
// 自动更新仅支持 Windows——InstallUpdate 平台守卫，此分支供未来扩展或手动下载参考）
const (
	assetWindowsFormat = "YSM-Model-Manager_windows_%s.exe"
	assetUnixFormat    = "YSM-Model-Manager_%s_%s.tar.gz"
)

const (
	// apiTimeout GitHub API 轻量请求超时（Check / fetchExpectedHash 共用）
	apiTimeout = 10 * time.Second
	// downloadTimeout 更新包下载超时（每源独立 90s：直连慢/卡时快速切镜像）
	downloadTimeout = 90 * time.Second
)

// updateLock 防止并发更新（多次调用 InstallUpdate/Download）
var updateLock sync.Mutex

// 错误哨兵：供调用方用 errors.Is / errors.As 做错误分类，
// 替代按错误文本 strings.Contains 匹配（陷阱 #11 文本匹配错误分类）。
var (
	// ErrNotWindows 非 Windows 平台触发（InstallUpdate 平台守卫）
	ErrNotWindows = errors.New("自动更新仅支持 Windows 平台")
	// ErrInvalidPackage 更新包不是有效 Windows PE 程序（MZ 魔数校验失败）
	ErrInvalidPackage = errors.New("更新包不是有效 Windows 程序")
	// ErrDownloadTooBig 更新包超过大小上限
	ErrDownloadTooBig = errors.New("更新包超过大小上限")
	// ErrDownloadIncomplete 更新包下载不完整（Content-Length 与实收字节不符）
	ErrDownloadIncomplete = errors.New("更新包下载不完整")
	// ErrHashMismatch 更新包 SHA256 校验失败
	ErrHashMismatch = errors.New("SHA256 校验失败")
)

// maxDownloadSize 更新包下载大小上限（500MB）
// 测试可覆盖为更小值以加速
var maxDownloadSize int64 = 500 << 20

// ghProxyPrefixes GitHub Release 下载加速代理前缀（第三方公开服务，域名可能变动）。
// 更新包多源回退：直连 asset URL 失败/超时后按序拼接重试；测试可整体替换为本地 server。
var ghProxyPrefixes = []string{
	"https://ghfast.top/",
	"https://gh-proxy.com/",
}

// progressWriter 下载进度计数器：按 1% 步进（大小已知）或每 512KB（分块传输）节流回调，
// 避免高频事件冲刷前端；写满时强制补一次 100% 回调（done==total）
type progressWriter struct {
	total      int64
	written    int64
	lastPct    int64
	lastBytes  int64
	onProgress func(done, total int64)
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n := len(p)
	w.written += int64(n)
	if w.onProgress != nil {
		if w.total > 0 {
			pct := w.written * 100 / w.total
			if pct > w.lastPct || w.written >= w.total {
				w.lastPct = pct
				w.onProgress(w.written, w.total)
			}
		} else if w.written-w.lastBytes >= 512<<10 {
			// Content-Length 未知（分块传输）：按 512KB 节流，前端显示已下载字节
			w.lastBytes = w.written
			w.onProgress(w.written, 0)
		}
	}
	return n, nil
}

// ReleaseAsset GitHub Release 中的文件
type ReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// Release GitHub Release 信息
type Release struct {
	TagName    string         `json:"tag_name"`
	Body       string         `json:"body"`
	Assets     []ReleaseAsset `json:"assets"`
	Draft      bool           `json:"draft"`
	Prerelease bool           `json:"prerelease"`
}

// UpdateInfo 更新信息（序列化给前端）
type UpdateInfo struct {
	Available     bool   `json:"available"`
	Latest        string `json:"latest"`
	Current       string `json:"current"`
	URL           string `json:"url"`
	SHA256SUMSURL string `json:"sha256sumsUrl,omitempty"`
	ExpectedHash  string `json:"expectedHash,omitempty"`
	ReleaseNotes  string `json:"releaseNotes,omitempty"`
}

// assetPattern 返回当前系统匹配的 asset 名（模板收敛于 assetWindowsFormat/assetUnixFormat，
// 索引 6.9a）
func assetPattern() string {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	if goos == "windows" {
		return fmt.Sprintf(assetWindowsFormat, goarch)
	}
	return fmt.Sprintf(assetUnixFormat, goos, goarch)
}

// Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志）
func Check(current string) (*UpdateInfo, error) {
	api := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases?per_page=10", repoOwner, repoName)
	return CheckWithClient(&http.Client{Timeout: apiTimeout}, api, current)
}

// CheckWithClient 可注入 client 与 API URL 的测试变体（Check 的内部实现）
func CheckWithClient(client *http.Client, apiURL, current string) (*UpdateInfo, error) {
	cur := normalize(current)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "YSM-Model-Manager/"+normalize(current))

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// 显式检查状态码：403（rate limit）/ 404 等错误体不是 release 数组，
	// 直接 Decode 会返回误导性错误；解析 GitHub 错误 message 给出可读提示
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		var ghErr struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(body, &ghErr) == nil && ghErr.Message != "" {
			return nil, fmt.Errorf("检查更新失败：GitHub API 返回 %d（%s）", resp.StatusCode, ghErr.Message)
		}
		return nil, fmt.Errorf("检查更新失败：GitHub API 返回 %d", resp.StatusCode)
	}

	var rels []Release
	// JSON 解码无大小上限——恶意/异常 GitHub API 响应可撑爆
	// 内存（对比错误体 4KB / SHA256SUMS 64KB 均有上限）；套 1MB 上限
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rels); err != nil {
		return nil, err
	}

	var latestTag string
	var latestAssetURL string
	var latestSHASumsURL string
	var expectedHash string
	var notesBuf strings.Builder

	for _, rel := range rels {
		if rel.Draft || rel.Prerelease {
			continue
		}
		tag := normalize(rel.TagName)
		if !isNewer(tag, cur) {
			continue
		}
		// 记录最新的 tag 和下载链接
		if latestTag == "" || isNewer(tag, normalize(latestTag)) {
			latestTag = rel.TagName
			pattern := assetPattern()
			for _, a := range rel.Assets {
				if strings.EqualFold(a.Name, pattern) {
					latestAssetURL = a.BrowserDownloadURL
				}
				if strings.EqualFold(a.Name, "SHA256SUMS") {
					latestSHASumsURL = a.BrowserDownloadURL
				}
			}
		}
		// 聚合日志：标记版本号 + body
		if rel.Body != "" {
			notesBuf.WriteString(fmt.Sprintf("【%s】\n%s\n\n", rel.TagName, rel.Body))
		}
	}

	if latestTag == "" {
		return &UpdateInfo{Current: current}, nil
	}

	// 从 SHA256SUMS 中解析对应 zip 的 hash
	// fetchExpectedHash 现返回 (string, error)——原 "" 同时表达三种失败态，
	// 404/403 时哈希校验静默跳过；现失败记录告警但保留 old 行为（hash 缺失仍可下载，
	// 由 Download 侧状态码检查兜底，不让「hash 不可得」阻塞整个更新流程）
	if latestSHASumsURL != "" {
		hash, err := fetchExpectedHash(latestSHASumsURL, assetPattern())
		if err != nil {
			log.Printf("[updater] 获取期望哈希失败（更新将继续但无哈希校验）: %v", err)
		}
		expectedHash = hash
	}

	if latestTag != "" && latestAssetURL == "" {
		// 有新版本但无本平台安装包（如仅发布其他平台）→ 视为不可更新
		return &UpdateInfo{Current: current, Latest: latestTag}, nil
	}

	return &UpdateInfo{
		Available:     true,
		Latest:        latestTag,
		Current:       current,
		URL:           latestAssetURL,
		SHA256SUMSURL: latestSHASumsURL,
		ExpectedHash:  expectedHash,
		ReleaseNotes:  strings.TrimSpace(notesBuf.String()),
	}, nil
}

// Download 下载更新包（裸 exe）到临时目录，返回更新包路径（无进度回调，兼容旧调用方）。
// 若 expectedHash 非空，下载完成后校验 SHA256，不匹配则删除文件并报错。
func Download(assetURL string, expectedHash string) (string, error) {
	return DownloadWithProgress(assetURL, expectedHash, nil)
}

// DownloadWithProgress 下载更新包；onProgress 在下载过程中节流回调 (done, total) 字节数
// （total<=0 表示 Content-Length 未知，分块传输场景）。
// 多源回退（用户反馈：直连 GitHub Release 20MB 包 7 分钟仅 17%）：
// 直连 asset URL 失败/超时后，按 ghProxyPrefixes 依次拼代理前缀重试，任一成功即返回；
// 全部失败时聚合各源错误返回（含源标识，便于用户判断是直连还是镜像问题）。
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
		errs = append(errs, fmt.Errorf("%s: %w", src, err))
	}
	return "", fmt.Errorf("更新包下载失败（%d 个源均失败）：\n%w", len(sources), errors.Join(errs...))
}

// newDownloadClient 构建下载用 HTTP 客户端（每源独立 90s 超时：直连慢/卡时快速切镜像）。
// ⚠️ 包级变量便于测试注入自定义 RoundTripper（仅测试注入，禁止生产调用），覆盖完整性校验等不可由真实网络触达的分支。
var newDownloadClient = func() *http.Client {
	return &http.Client{Timeout: downloadTimeout}
}

// downloadOnce 单源下载尝试：HTTP GET + 大小截断防护 + SHA256 校验
func downloadOnce(assetURL string, expectedHash string, onProgress func(done, total int64)) (string, error) {
	req, err := http.NewRequest("GET", assetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "YSM-Model-Manager/")
	client := newDownloadClient()
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// 非 200 直接拒绝——原实现不检查状态码，asset URL 返回 404 时
	// 在 expectedHash=="" 场景下错误页 HTML 会被当更新包写入 tmp 并返回成功
	// （随后 InstallUpdate 才报 exe 打开失败，用户被误导为已下载成功）
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("更新包下载失败: HTTP %d（%s）", resp.StatusCode, assetURL)
	}

	// BUG(INFO-CT) 修复：Content-Type 为 HTML/XML 时拒绝——
	// 攻击者返回 text/html 错误页（含恶意内容），downloadOnce 无 Content-Type 校验会将其当作更新包写入。
	// 与 go/download HTTP-5 同源问题，对齐防御口径（仅拒绝 HTML/XML，保留 text/plain 等）。
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		low := strings.ToLower(ct)
		isTextHTML := strings.Contains(low, "text/html") || strings.Contains(low, "application/xhtml+xml")
		isXML := strings.Contains(low, "application/xml") || strings.Contains(low, "text/xml")
		if isTextHTML || isXML {
			return "", fmt.Errorf("更新包 Content-Type 非二进制: %s", ct)
		}
	}

	// BUG(INFO-RANGE) 修复：Content-Range 部分响应拒绝——
	// 攻击者返回 200+Content-Range 截断更新包，导致安装后版本不完整。
	// 与 go/download HTTP-2 同源问题，对齐防御口径。
	if resp.Header.Get("Content-Range") != "" {
		return "", fmt.Errorf("更新包部分响应（Content-Range）: %s", resp.Header.Get("Content-Range"))
	}

	// 固定可预测临时名（filepath.Base(assetURL)）有 TOCTOU/
	// 多实例同名冲突/非法文件名风险——改 os.CreateTemp 唯一名
	f, err := os.CreateTemp("", "ysm-update-*.tmp")
	if err != nil {
		return "", err
	}
	tmp := f.Name()

	// 限制下载大小（最大 500MB），同时计算 SHA256
	// 预检：Content-Length 超限直接拒绝（省流量，防磁盘写满）
	if resp.ContentLength > maxDownloadSize {
		// 超限早退前先 Close 再 Remove——原 os.Remove(tmp)
		// 时 f 未关闭，Windows 删除打开中的文件必然失败（错误被忽略 → 文件残留）
		// 且 f 句柄泄漏（该路径无任何 Close）
		f.Close()
		os.Remove(tmp)
		return "", fmt.Errorf("更新包过大（%d 字节），超过 %d 字节上限: %w", resp.ContentLength, maxDownloadSize, ErrDownloadTooBig)
	}
	total := resp.ContentLength
	if total < 0 {
		total = 0 // 分块传输：大小未知，进度按字节节流回调
	}
	hasher := sha256.New()
	prog := &progressWriter{total: total, onProgress: onProgress}
	n, err := io.Copy(
		io.MultiWriter(f, prog),
		io.TeeReader(io.LimitReader(resp.Body, maxDownloadSize), hasher),
	)
	// 截断检测：读到上限后再读 1 字节，若仍有数据说明更新包超限被截断
	// （无 Content-Length 的分块传输场景兜底，防止截断包被装盘）
	// 探测读错误不再忽略——chunked 服务器发满后卡死时
	// Read 阻塞到超时返回 (0, timeout err)，原 `extra, _ :=` 把 extra==0 当"未截断"
	// 接受截断文件（陷阱 #33 残余命中）；只放行正常 EOF，其余一律拒绝
	if n >= maxDownloadSize {
		one := make([]byte, 1)
		extra, probeErr := resp.Body.Read(one)
		if extra > 0 || (probeErr != nil && probeErr != io.EOF) {
			f.Close()
			os.Remove(tmp)
			return "", fmt.Errorf("更新包超过 %d 字节上限（截断探测失败: %v）: %w", maxDownloadSize, probeErr, ErrDownloadTooBig)
		}
	}
	closeErr := f.Close()
	if err != nil {
		os.Remove(tmp)
		return "", err
	}
	if closeErr != nil {
		os.Remove(tmp)
		return "", closeErr
	}

	// BUG(INFO-CL) 修复：完整性校验——Content-Length 已知时实收字节必须一致，
	// 防限流器/代理在「干净 EOF」下静默截断（陷阱 #11 限流器截断静默）。
	// 标准 http client 对提前关闭的 CL 响应返回 unexpected EOF（由上面 err 分支拒绝），
	// 此检查为纵深防御，兜底自定义传输层返回「n<total 且 err==nil」的异常场景。
	if total > 0 && n != total {
		os.Remove(tmp)
		return "", fmt.Errorf("%w：期望 %d 字节，实际收到 %d 字节", ErrDownloadIncomplete, total, n)
	}

	// 未知长度（chunked）下载的尾块补发——progressWriter 按
	// 512KB 节流，最后不足 512KB 的尾块与 <512KB 的短包全程零回调，前端进度条
	// 停在陈旧字节数；补发最终 (n, 0) 保证进度弹窗显示真实最终字节数。
	// 已知长度分支在 Copy 内已由 written>=total 触发 100% 回调，无需补发
	if onProgress != nil && total <= 0 && n > prog.lastBytes {
		onProgress(n, 0)
	}

	// 校验 SHA256
	if expectedHash != "" {
		actual := hex.EncodeToString(hasher.Sum(nil))
		if !strings.EqualFold(actual, expectedHash) {
			os.Remove(tmp)
			return "", fmt.Errorf("%w：\n期望 %s\n实际 %s\n文件可能被篡改或下载不完整", ErrHashMismatch, expectedHash, actual)
		}
	}

	return tmp, nil
}

// CleanupOldVersion 启动时清理上一次更新留下的 .old 文件
func CleanupOldVersion() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	oldPath := exe + ".old"
	// 自愈：目标 exe 缺失但 .old 存在（上一次替换中途崩溃）→ 恢复
	if _, err := os.Stat(exe); os.IsNotExist(err) {
		if _, e2 := os.Stat(oldPath); e2 == nil {
			if err := os.Rename(oldPath, exe); err != nil {
				log.Printf("[updater] 恢复 exe 失败 %s: %v", exe, err)
			}
		}
	}
	if _, err := os.Stat(oldPath); err == nil {
		if err := os.Remove(oldPath); err != nil {
			log.Printf("[updater] 清理旧文件失败 %s: %v", oldPath, err)
		}
	}
}

// InstallUpdate 校验下载的更新 exe 并通过 helper 进程替换当前 exe。
// 流程：校验新 exe（PE 魔数）→ 复制到临时目录 → 释放 helper → 启动 helper → 主进程退出
// （v1.13.0 起纯 exe 发布：Windows Release 资产为裸 exe，不再有 zip 解压环节）
func InstallUpdate(exePath string) error {
	updateLock.Lock()
	defer updateLock.Unlock()

	// 平台守卫：非 Windows asset 为 .tar.gz，自动更新仅支持 Windows——
	// 明确拒绝而非静默下载后在装包时给误导性错误
	if runtime.GOOS != "windows" {
		return fmt.Errorf("%w，请手动下载更新", ErrNotWindows)
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取程序路径失败: %w", err)
	}

	// 装盘前预检：无哈希降级场景下至少校验 PE 魔数，防损坏/篡改包替换运行中 exe
	f, err := os.Open(exePath)
	if err != nil {
		return fmt.Errorf("打开更新包失败: %w", err)
	}
	var magic [2]byte
	_, err = io.ReadFull(f, magic[:])
	f.Close()
	if err != nil || string(magic[:]) != "MZ" {
		return ErrInvalidPackage
	}

	// 准备临时目录：复制新 exe + 释放 helper
	tmpDir, err := os.MkdirTemp("", "ysm-update")
	if err != nil {
		return fmt.Errorf("创建临时目录失败: %w", err)
	}
	newPath := filepath.Join(tmpDir, "YSM-Model-Manager.exe")
	if err := copyFile(exePath, newPath); err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("准备新 exe 失败: %w", err)
	}
	helperPath := filepath.Join(tmpDir, "ysm-updater-helper.exe")
	if err := extractEmbeddedHelper(helperPath); err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("释放更新助手失败: %w", err)
	}

	// 启动 helper（传入 新exe路径 目标exe路径 主进程PID）
	pid := strconv.Itoa(os.Getpid())
	cmd := exec.Command(helperPath, newPath, exe, pid)
	cmd.Dir = tmpDir
	if err := cmd.Start(); err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("启动更新助手失败: %w", err)
	}

	// 清理临时下载文件
	if err := os.Remove(exePath); err != nil {
		log.Printf("[updater] 清理临时文件失败: %v", err)
	}

	// 主进程退出（Wails 前端应在此之前显示提示）
	os.Exit(0)
	return nil
}

// copyFile 复制文件（更新 exe 直装场景：下载临时文件 → 临时目录新路径）
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

// ===== semver 比较 =====

func normalize(tag string) string {
	return strings.TrimPrefix(strings.TrimSpace(tag), "v")
}

// preReleaseSemantics 预发布语义开关（ADR-063 门控）：默认关闭=剥离 -+ 后缀比较，
// 维持现状判定（v1.0.0 与 v1.0.0-beta 视为相等）；未来发布 rc/beta 预发布 tag 时
// 开启，走标准 semver 预发布排序（正式版新于预发布版）。
var preReleaseSemantics = false

// isNewer 版本比较：合法 SemVer 走 x/mod/semver 标准比较；脏 tag/多段/dev 等
// 非标准版本回退手写 splitVer（防御语义，测试钉住：异常版本恒旧，绝不误触发更新）。
func isNewer(a, b string) bool {
	ca, cb := a, b
	if !preReleaseSemantics {
		ca = stripMeta(ca)
		cb = stripMeta(cb)
	}
	va, vb := "v"+ca, "v"+cb
	if semver.IsValid(va) && semver.IsValid(vb) {
		return semver.Compare(va, vb) > 0
	}
	pa := splitVer(a)
	pb := splitVer(b)
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return len(pa) > len(pb)
}

// stripMeta 剥离预发布/构建元数据后缀（-beta / +build），与 splitVer 内联剥离口径一致
func stripMeta(s string) string {
	if idx := strings.IndexAny(s, "-+"); idx >= 0 {
		return s[:idx]
	}
	return s
}

func splitVer(s string) []int {
	// 去掉预发布后缀（如 v1.2.3-beta → v1.2.3）
	if idx := strings.IndexAny(s, "-+"); idx >= 0 {
		s = s[:idx]
	}
	// 全段解析：不用 SplitN 截断，避免 4 段以上版本被截为 [.., "4.5"] 导致 Atoi 归零
	parts := strings.Split(s, ".")
	out := make([]int, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err == nil {
			out[i] = n
		}
		// Atoi 失败（脏 tag 如 vv1.1.0 normalize 后首段 "v1"）→ 保持 0，
		// 使该版本恒小于正常版本，绝不误触发更新（防御行为，update_test.go 锁定）
	}
	return out
}

// fetchExpectedHash 从 SHA256SUMS 文件中解析指定文件名的 hash
// 返回 (string, error)——原实现空字符串同时表达「未找到/网络错误/HTTP 错误」，
// 404/403 错误体按行解析不到返回 ""，Download 侧 `expectedHash==""` 门控使哈希校验整体
// 静默跳过（更新包无校验装盘）。现非 200 返回显式错误，调用方 CheckWithClient 记录告警。
func fetchExpectedHash(sumsURL string, fileName string) (string, error) {
	client := &http.Client{Timeout: apiTimeout}
	req, err := http.NewRequest("GET", sumsURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "YSM-Model-Manager/")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("SHA256SUMS 获取失败: HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10)) // 最多 64KB
	if err != nil {
		return "", err
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 格式: <hash>  <filename>  或  <hash> *<filename>
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimPrefix(parts[1], "*")
		if strings.EqualFold(name, fileName) {
			return strings.ToLower(parts[0]), nil
		}
	}
	return "", fmt.Errorf("SHA256SUMS 中未找到 %s 的 hash", fileName)
}
