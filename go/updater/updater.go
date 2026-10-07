// updater.go：版本检查与发布拉取（原 updater.go 拆分，2026-10 文件行数治理）。
// 2026-10 拆分：原 767 行按职责分为 updater.go（本文件：锁 + release 拉取 + asset 选择）/
// updater_download.go（下载 + SHA256 校验）/ updater_install.go（清理旧版本 + 安装新版本）/
// updater_semver.go（版本号比较）。
package updater

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"
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
	// ErrExitRequested 更新已就绪、主进程应退出以完成 exe 替换（helper 子进程在侧等待）。
	// 库函数不再直接 os.Exit（defer/锁需正常走完），改由调用方收口退出。
	ErrExitRequested = errors.New("更新安装完成，进程即将退出")
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

// CheckWithClient 可注入 client 与 API URL 的测试变体（Check 的内部实现）。
// 拆三段：拉取 release 数组 → 挑最新正式版与下载链接 → 解析期望哈希（fail-closed）。
func CheckWithClient(client *http.Client, apiURL, current string) (*UpdateInfo, error) {
	rels, err := fetchReleaseList(client, apiURL, current)
	if err != nil {
		return nil, err
	}

	latestTag, latestAssetURL, latestSHASumsURL, notes := pickLatestRelease(rels, normalize(current))
	if latestTag == "" {
		return &UpdateInfo{Current: current}, nil
	}

	// 从 SHA256SUMS 中解析对应 zip 的 hash
	// 哈希不可得时 Available=false，阻断无完整性校验的更新下载。
	// 旧实现「hash 缺失仍可下载」契约已废弃——攻击者只需阻断 SHA256SUMS 获取即可绕过完整性校验。
	expectedHash, ok := resolveExpectedHash(latestSHASumsURL)
	if !ok {
		return &UpdateInfo{Current: current, Latest: latestTag}, nil
	}

	// latestTag 已由 pickLatestRelease 早退保证非空，此处只需判 asset URL 空
	if latestAssetURL == "" {
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
		ReleaseNotes:  notes,
	}, nil
}

// fetchReleaseList 拉取并解析 release 数组（GitHub API 轻量请求）。
func fetchReleaseList(client *http.Client, apiURL, current string) ([]Release, error) {
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
	defer func() { _ = resp.Body.Close() }()

	// 显式检查状态码：403（rate limit）/ 404 等错误体不是 release 数组，
	// 直接 Decode 会返回误导性错误；解析 GitHub 错误 message 给出可读提示
	if resp.StatusCode != http.StatusOK {
		return nil, githubStatusError(resp)
	}

	var rels []Release
	// JSON 解码无大小上限——恶意/异常 GitHub API 响应可撑爆
	// 内存（对比错误体 4KB / SHA256SUMS 64KB 均有上限）；套 1MB 上限
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&rels); err != nil {
		return nil, err
	}
	return rels, nil
}

// githubStatusError 把非 200 响应体里的 GitHub message 拼成可读错误（错误体最多读 4KB，
// 非 JSON / 无 message 时退回仅状态码文案）。
func githubStatusError(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	var ghErr struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &ghErr) == nil && ghErr.Message != "" {
		return fmt.Errorf("检查更新失败：GitHub API 返回 %d（%s）", resp.StatusCode, ghErr.Message)
	}
	return fmt.Errorf("检查更新失败：GitHub API 返回 %d", resp.StatusCode)
}

// pickLatestRelease 挑出「非 draft / 非 prerelease 且新于 cur」的最新正式版，
// 返回其 tag、本平台 asset URL、SHA256SUMS URL，并聚合所有新版本的更新日志。
// 无新版本时返回空 tag（调用方据此返回不可更新）。
func pickLatestRelease(rels []Release, cur string) (latestTag, assetURL, sumsURL, notes string) {
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
			assetURL, sumsURL = pickReleaseAssets(rel.Assets)
		}
		// 聚合日志：标记版本号 + body
		if rel.Body != "" {
			fmt.Fprintf(&notesBuf, "【%s】\n%s\n\n", rel.TagName, rel.Body)
		}
	}
	return latestTag, assetURL, sumsURL, strings.TrimSpace(notesBuf.String())
}

// pickReleaseAssets 在 asset 列表里按当前平台命名模板挑安装包与 SHA256SUMS（大小写不敏感）；
// 同一 release 内后者覆盖前者，与拆分前逐字一致。
func pickReleaseAssets(assets []ReleaseAsset) (assetURL, sumsURL string) {
	pattern := assetPattern()
	for _, a := range assets {
		if strings.EqualFold(a.Name, pattern) {
			assetURL = a.BrowserDownloadURL
		}
		if strings.EqualFold(a.Name, "SHA256SUMS") {
			sumsURL = a.BrowserDownloadURL
		}
	}
	return assetURL, sumsURL
}

// resolveExpectedHash 取 SHA256SUMS 里本平台包的哈希；无 URL 或拉取失败时 ok=false，
// 调用方据此返回 Available=false 的 UpdateInfo（fail-closed，不给无校验更新开口子）。
func resolveExpectedHash(sumsURL string) (string, bool) {
	if sumsURL == "" {
		// 无 SHA256SUMS URL 的 release，哈希不可得
		log.Printf("[updater] release 无 SHA256SUMS，更新不可用")
		return "", false
	}
	hash, err := fetchExpectedHash(sumsURL, assetPattern())
	if err != nil {
		log.Printf("[updater] 获取期望哈希失败（更新不可用）: %v", err)
		return "", false
	}
	return hash, true
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
