package updater

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
)

const (
	repoOwner = "eghrhegpe"
	repoName  = "ysm-model-manager"
)

// updateLock 防止并发更新（多次调用 InstallUpdate/Download）
var updateLock sync.Mutex

// maxDownloadSize 更新包下载大小上限（500MB）
const maxDownloadSize = 500 << 20

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

// assetPattern 返回当前系统匹配的 asset 名
// 注意：非 Windows 分支返回 .tar.gz 为占位——自动更新仅支持 Windows
// （InstallUpdate 平台守卫），此分支供未来扩展或手动下载参考
func assetPattern() string {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	if goos == "windows" {
		return fmt.Sprintf("YSM-Model-Manager_windows_%s.zip", goarch)
	}
	return fmt.Sprintf("YSM-Model-Manager_%s_%s.tar.gz", goos, goarch)
}

// Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志）
func Check(current string) (*UpdateInfo, error) {
	api := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases?per_page=10", repoOwner, repoName)
	return CheckWithClient(&http.Client{Timeout: 10 * time.Second}, api, current)
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
	if err := json.NewDecoder(resp.Body).Decode(&rels); err != nil {
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
	// P2 修复：fetchExpectedHash 现返回 (string, error)——原 "" 同时表达三种失败态，
	// 404/403 时哈希校验静默跳过；现失败记录告警但保留 old 行为（hash 缺失仍可下载，
	// 由 Download 侧状态码检查兜底，不让「hash 不可得」阻塞整个更新流程）
	if latestSHASumsURL != "" {
		hash, err := fetchExpectedHash(latestSHASumsURL, assetPattern())
		if err != nil {
			log.Printf("[updater] 获取期望哈希失败（更新将继续但无哈希校验）: %v", err)
		}
		expectedHash = hash
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

// Download 下载更新包到临时目录，返回 zip 路径（无进度回调，兼容旧调用方）。
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
	var errs []string
	for _, src := range sources {
		path, err := downloadOnce(src, expectedHash, onProgress)
		if err == nil {
			return path, nil
		}
		errs = append(errs, fmt.Sprintf("%s: %v", src, err))
	}
	return "", fmt.Errorf("更新包下载失败（%d 个源均失败）：\n%s", len(sources), strings.Join(errs, "\n"))
}

// downloadOnce 单源下载尝试：HTTP GET + 大小截断防护 + SHA256 校验
func downloadOnce(assetURL string, expectedHash string, onProgress func(done, total int64)) (string, error) {
	req, err := http.NewRequest("GET", assetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "YSM-Model-Manager/")
	// 每源独立 90s 超时：直连慢/卡时快速切镜像，避免「硬卡 7 分钟」
	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// P2 修复：非 200 直接拒绝——原实现不检查状态码，asset URL 返回 404 时
	// 在 expectedHash=="" 场景下错误页 HTML 会被当更新包写入 tmp 并返回成功
	// （随后 InstallUpdate 才报 zip 打开失败，用户被误导为已下载成功）
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("更新包下载失败: HTTP %d（%s）", resp.StatusCode, assetURL)
	}

	tmp := filepath.Join(os.TempDir(), filepath.Base(assetURL))
	f, err := os.Create(tmp)
	if err != nil {
		return "", err
	}

	// 限制下载大小（最大 500MB），同时计算 SHA256
	// 预检：Content-Length 超限直接拒绝（省流量，防磁盘写满）
	if resp.ContentLength > maxDownloadSize {
		os.Remove(tmp)
		return "", fmt.Errorf("更新包过大（%d 字节），超过 %d 字节上限", resp.ContentLength, maxDownloadSize)
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
	if n >= maxDownloadSize {
		one := make([]byte, 1)
		if extra, _ := resp.Body.Read(one); extra > 0 {
			f.Close()
			os.Remove(tmp)
			return "", fmt.Errorf("更新包超过 %d 字节上限", maxDownloadSize)
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

	// P3 修复（code_review）：未知长度（chunked）下载的尾块补发——progressWriter 按
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
			return "", fmt.Errorf("SHA256 校验失败：\n期望 %s\n实际 %s\n文件可能被篡改或下载不完整", expectedHash, actual)
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
	if _, err := os.Stat(oldPath); err == nil {
		if err := os.Remove(oldPath); err != nil {
			log.Printf("[updater] 清理旧文件失败 %s: %v", oldPath, err)
		}
	}
}

// InstallUpdate 解压更新包并通过 helper 进程替换当前 exe。
// 流程：解压新 exe → 释放 helper 到临时目录 → 启动 helper → 主进程退出
func InstallUpdate(zipPath string) error {
	updateLock.Lock()
	defer updateLock.Unlock()

	// 平台守卫：非 Windows asset 为 .tar.gz，而 InstallUpdate 仅能解压 zip——
	// 明确拒绝而非静默下载后在装包时给误导性错误
	if runtime.GOOS != "windows" {
		return fmt.Errorf("自动更新当前仅支持 Windows 平台，请手动下载更新")
	}

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取程序路径失败: %w", err)
	}
	exeDir := filepath.Dir(exe)

	// 1. 解压 zip
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("打开 zip 失败: %w", err)
	}
	defer r.Close()

	var exeInZip *zip.File
	targetExe := "YSM-Model-Manager.exe"
	alwaysOverwrite := map[string]bool{
		"resource_types.json": true,
		"ysm-cli.exe":         true, // 发布 zip 内含 CLI 工具，随更新覆盖
	}
	createIfMissing := map[string]bool{
		"workshop_sites.json":  true,
		"workshop-github.json": true,
		"creators.json":        true,
	}

	for _, f := range r.File {
		name := filepath.Base(f.Name)
		if strings.EqualFold(name, targetExe) {
			exeInZip = f
			continue
		}
		dest := filepath.Join(exeDir, name)
		cleanDir := filepath.Clean(exeDir) + string(os.PathSeparator)
		if !strings.HasPrefix(dest, cleanDir) {
			log.Printf("[updater] 跳过异常路径 %s", f.Name)
			continue
		}
		if alwaysOverwrite[name] {
			if err := extractZipFile(f, dest); err != nil {
				log.Printf("[updater] 提取 %s 失败: %v", name, err)
			}
		} else if createIfMissing[name] {
			if _, err := os.Stat(dest); os.IsNotExist(err) {
				if err := extractZipFile(f, dest); err != nil {
					log.Printf("[updater] 提取 %s 失败: %v", name, err)
				}
			}
		}
	}
	if exeInZip == nil {
		return fmt.Errorf("zip 中未找到 %s", targetExe)
	}

	// 2. 解压新 exe 到临时目录
	tmpDir, err := os.MkdirTemp("", "ysm-update")
	if err != nil {
		return fmt.Errorf("创建临时目录失败: %w", err)
	}
	newPath := filepath.Join(tmpDir, targetExe)
	if err := extractZipFile(exeInZip, newPath); err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("解压 exe 失败: %w", err)
	}

	// 3. 释放 helper 到临时目录
	helperPath := filepath.Join(tmpDir, "ysm-updater-helper.exe")
	if err := extractEmbeddedHelper(helperPath); err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("释放更新助手失败: %w", err)
	}

	// 4. 启动 helper（传入 新exe路径 目标exe路径 主进程PID）
	pid := strconv.Itoa(os.Getpid())
	cmd := exec.Command(helperPath, newPath, exe, pid)
	cmd.Dir = tmpDir
	if err := cmd.Start(); err != nil {
		os.RemoveAll(tmpDir)
		return fmt.Errorf("启动更新助手失败: %w", err)
	}

	// 5. 清理临时下载文件
	if err := os.Remove(zipPath); err != nil {
		log.Printf("[updater] 清理临时文件失败: %v", err)
	}

	// 6. 主进程退出（Wails 前端应在此之前显示提示）
	os.Exit(0)
	return nil
}

// extractZipFile 解压 zip 中的单个文件到目标路径（限制解压大小 200MB，超限报错不静默截断）
func extractZipFile(f *zip.File, dest string) error {
	rc, err := f.Open()
	if err != nil {
		return err
	}
	defer rc.Close()

	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	ok := false
	defer func() {
		out.Close()
		if !ok {
			// 解压失败/超限时清理半成品（必须先 Close 再 Remove——Windows 上删除打开的文件会失败）
			// Remove 失败（文件锁 / Defender 实时扫描窗口）时短暂重试，避免半成品残留
			if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
				time.Sleep(200 * time.Millisecond)
				_ = os.Remove(dest)
			}
		}
	}()

	const maxExtract = 200 << 20
	n, err := io.Copy(out, io.LimitReader(rc, maxExtract))
	if err != nil {
		return err
	}
	// 截断检测：读到上限后再读 1 字节，仍有数据说明文件超限被截断——报错并清理目标，
	// 防止损坏的 exe/配置文件被静默装盘（与 Download 截断检测同款语义）
	if n >= maxExtract {
		one := make([]byte, 1)
		if extra, _ := rc.Read(one); extra > 0 {
			return fmt.Errorf("zip 内文件 %s 超过 %d 字节上限", f.Name, maxExtract)
		}
	}
	ok = true
	return nil
}

// ===== semver 比较 =====

func normalize(tag string) string {
	return strings.TrimPrefix(strings.TrimSpace(tag), "v")
}

func isNewer(a, b string) bool {
	pa := splitVer(a)
	pb := splitVer(b)
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] != pb[i] {
			return pa[i] > pb[i]
		}
	}
	return len(pa) > len(pb)
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
// P2 修复：返回 (string, error)——原实现空字符串同时表达「未找到/网络错误/HTTP 错误」，
// 404/403 错误体按行解析不到返回 ""，Download 侧 `expectedHash==""` 门控使哈希校验整体
// 静默跳过（更新包无校验装盘）。现非 200 返回显式错误，调用方 CheckWithClient 记录告警。
func fetchExpectedHash(sumsURL string, fileName string) (string, error) {
	client := &http.Client{Timeout: 10 * time.Second}
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
