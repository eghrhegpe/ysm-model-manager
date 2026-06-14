package updater

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
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
	defer f.Close()

	// 限制下载大小（最大 500MB）
	_, err = io.Copy(f, io.LimitReader(resp.Body, 500<<20))
	if err != nil {
		os.Remove(tmp)
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
		if err := os.Remove(oldPath); err != nil {
			log.Printf("[updater] 清理旧文件失败 %s: %v", oldPath, err)
		}
	}
}

// InstallUpdate 从 zip 中提取 exe 并替换当前程序（无 batch 脚本）
// 策略：exe → exe.old（备份）, exe.new（新文件）→ exe
// 同时提取 resource_types.json 等数据文件到 EXE 同目录
func InstallUpdate(zipPath string) error {
	updateLock.Lock()
	defer updateLock.Unlock()

	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("获取程序路径失败: %w", err)
	}
	exeDir := filepath.Dir(exe)

	// 1. 解压 zip 找 exe
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("打开 zip 失败: %w", err)
	}
	defer r.Close()

	var exeInZip *zip.File
	targetExe := "YSM-Model-Manager.exe"
	// resource_types.json 必须覆盖更新（注册表，无用户数据）
	// 其他数据文件仅当不存在时补发（保留用户自定义的工作室/创作者）
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
		// 路径遍历防护：确保解压路径仍在 exeDir 内
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

	// 2. 解压到 exe.new（限制解压大小 200MB）
	newPath := exe + ".new"
	if err := extractZipFile(exeInZip, newPath); err != nil {
		return fmt.Errorf("解压 exe 失败: %w", err)
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
		if rerr := os.Rename(oldPath, exe); rerr != nil {
			log.Printf("[updater] 致命: 回滚也失败 %v (旧文件: %s)", rerr, oldPath)
		}
		os.Remove(newPath)
		return fmt.Errorf("替换文件失败: %w", err)
	}

	// 清理临时下载文件
	if err := os.Remove(zipPath); err != nil {
		log.Printf("[updater] 清理临时文件失败: %v", err)
	}

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
