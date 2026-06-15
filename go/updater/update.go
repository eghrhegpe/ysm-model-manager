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
	cur := normalize(current)

	// 取最近 10 个 release，聚合比当前新的所有版本日志
	api := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases?per_page=10", repoOwner, repoName)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", api, nil)
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
	hasher := sha256.New()
	limitR := io.LimitReader(resp.Body, 500<<20)
	_, err = io.Copy(f, io.TeeReader(limitR, hasher))
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
	}
	createIfMissing := map[string]bool{
		"workshop_sites.json": true,
		"workshop_gitHub.json": true,
		"creators.json":       true,
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

// extractZipFile 解压 zip 中的单个文件到目标路径（限制解压大小 200MB）
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
	defer out.Close()

	_, err = io.Copy(out, io.LimitReader(rc, 200<<20))
	return err
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
	parts := strings.SplitN(s, ".", 4)
	out := make([]int, len(parts))
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err == nil {
			out[i] = n
		}
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
