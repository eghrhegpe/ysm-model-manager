package updater

import (
	"archive/zip"
	"crypto/sha256"
	"embed"
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

//go:embed ysm-updater-helper.exe
var updaterHelper embed.FS

const (
	repoOwner = "eghrhegpe"
	repoName  = "ysm-model-manager"
)

// updateLock 防止并发更新（多次调用 InstallUpdate/Download）
var updateLock sync.Mutex

// maxDownloadSize 更新包下载大小上限（500MB）
const maxDownloadSize = 500 << 20

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
	if latestSHASumsURL != "" {
		expectedHash = fetchExpectedHash(latestSHASumsURL, assetPattern())
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

// Download 下载更新包到临时目录，返回 zip 路径。
// 若 expectedHash 非空，下载完成后校验 SHA256，不匹配则删除文件并报错。
func Download(assetURL string, expectedHash string) (string, error) {
	updateLock.Lock()
	defer updateLock.Unlock()

	req, err := http.NewRequest("GET", assetURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "YSM-Model-Manager/")
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

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
	hasher := sha256.New()
	n, err := io.Copy(f, io.TeeReader(io.LimitReader(resp.Body, maxDownloadSize), hasher))
	// 截断检测：读到上限后再读 1 字节，若仍有数据说明更新包超限被截断
	// （无 Content-Length 的分块传输场景兜底，防止截断包被装盘）
	if n >= maxDownloadSize {
		one := make([]byte, 1)
		if extra, _ := resp.Body.Read(one); extra > 0 {
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
			os.Remove(dest)
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

// extractEmbeddedHelper 将内嵌的 ysm-updater-helper.exe 释放到目标路径
func extractEmbeddedHelper(dest string) error {
	data, err := updaterHelper.ReadFile("ysm-updater-helper.exe")
	if err != nil {
		return fmt.Errorf("读取内嵌 helper: %w", err)
	}
	return os.WriteFile(dest, data, 0755)
}

// fetchExpectedHash 从 SHA256SUMS 文件中解析指定文件名的 hash
func fetchExpectedHash(sumsURL string, fileName string) string {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", sumsURL, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("User-Agent", "YSM-Model-Manager/")

	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10)) // 最多 64KB
	if err != nil {
		return ""
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
			return strings.ToLower(parts[0])
		}
	}
	return ""
}
