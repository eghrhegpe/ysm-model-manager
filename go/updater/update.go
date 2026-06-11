package updater

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	repoOwner = "eghrhegpe"
	repoName  = "ysm-model-manager"
)

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
	Available    bool   `json:"available"`
	Latest       string `json:"latest"`
	Current      string `json:"current"`
	URL          string `json:"url"`
	ReleaseNotes string `json:"releaseNotes,omitempty"`
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
					break
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

	return &UpdateInfo{
		Available:    true,
		Latest:       latestTag,
		Current:      current,
		URL:          latestAssetURL,
		ReleaseNotes: strings.TrimSpace(notesBuf.String()),
	}, nil
}

// Download 下载更新包到临时目录，返回 zip 路径
func Download(assetURL string) (string, error) {
	resp, err := http.Get(assetURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	tmp := filepath.Join(os.TempDir(), filepath.Base(assetURL))
	f, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	if err != nil {
		return "", err
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
		os.Remove(oldPath)
	}
}

// InstallUpdate 从 zip 中提取 exe 并替换当前程序（无 batch 脚本）
// 策略：exe → exe.old（备份）, exe.new（新文件）→ exe
func InstallUpdate(zipPath string) error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取程序路径失败: %w", err)
	}

	// 1. 解压 zip 找 exe
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("打开 zip 失败: %w", err)
	}
	defer r.Close()

	var exeInZip *zip.File
	targetExe := "YSM-Model-Manager.exe"
	for _, f := range r.File {
		if strings.EqualFold(f.Name, targetExe) {
			exeInZip = f
			break
		}
	}
	if exeInZip == nil {
		return fmt.Errorf("zip 中未找到 %s", targetExe)
	}

	// 2. 解压到 exe.new
	newPath := exe + ".new"
	out, err := os.Create(newPath)
	if err != nil {
		return fmt.Errorf("创建临时文件失败: %w", err)
	}
	rc, err := exeInZip.Open()
	if err != nil {
		out.Close()
		return fmt.Errorf("读取 zip 中文件失败: %w", err)
	}
	_, err = io.Copy(out, rc)
	rc.Close()
	out.Close()
	if err != nil {
		return fmt.Errorf("解压失败: %w", err)
	}

	// 3. 替换逻辑
	oldPath := exe + ".old"
	os.Remove(oldPath) // 清理上一次残留

	// 备份当前 exe → exe.old
	if err := os.Rename(exe, oldPath); err != nil {
		os.Remove(newPath)
		return fmt.Errorf("备份旧文件失败: %w", err)
	}

	// 新文件 → exe
	if err := os.Rename(newPath, exe); err != nil {
		// 回滚
		os.Rename(oldPath, exe)
		os.Remove(newPath)
		return fmt.Errorf("替换文件失败: %w", err)
	}

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
	parts := strings.SplitN(s, ".", 4)
	out := make([]int, len(parts))
	for i, p := range parts {
		fmt.Sscanf(p, "%d", &out[i])
	}
	return out
}
