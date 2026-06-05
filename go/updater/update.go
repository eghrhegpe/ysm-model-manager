package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
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
	Assets     []ReleaseAsset `json:"assets"`
	Draft      bool           `json:"draft"`
	Prerelease bool           `json:"prerelease"`
}

// UpdateInfo 更新信息（序列化给前端）
type UpdateInfo struct {
	Available bool   `json:"available"`
	Latest    string `json:"latest"`
	Current   string `json:"current"`
	URL       string `json:"url"`
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

// Check 检查 GitHub 是否有新版本
func Check(current string) (*UpdateInfo, error) {
	api := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", repoOwner, repoName)
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", api, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	// 可选：GitHub API 有频率限制，公开仓库不需要 token

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var rel Release
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, err
	}

	// 跳过草稿和预发布
	if rel.Draft || rel.Prerelease {
		return &UpdateInfo{Current: current}, nil
	}

	want := normalize(rel.TagName)
	cur := normalize(current)
	if !isNewer(want, cur) {
		return &UpdateInfo{Current: current}, nil
	}

	// 找匹配当前系统的 asset
	pattern := assetPattern()
	for _, a := range rel.Assets {
		if strings.EqualFold(a.Name, pattern) {
			return &UpdateInfo{
				Available: true,
				Latest:    rel.TagName,
				Current:   current,
				URL:       a.BrowserDownloadURL,
			}, nil
		}
	}

	return &UpdateInfo{Current: current}, nil
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

// ApplyUpdate 应用更新：解压 zip → 写 updater.bat → 启动 bat → 退出
func ApplyUpdate(zipPath string) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exeDir := filepath.Dir(exe)
	tmpDir := filepath.Join(os.TempDir(), "ysm-update")

	// 创建临时解压目录
	os.RemoveAll(tmpDir)
	os.MkdirAll(tmpDir, 0755)

	// 解压 zip（Windows 用 PowerShell）
	psCmd := fmt.Sprintf(`Expand-Archive -Path '%s' -DestinationPath '%s' -Force`, zipPath, tmpDir)
	if err := exec.Command("powershell", "-Command", psCmd).Run(); err != nil {
		return fmt.Errorf("解压失败: %w", err)
	}

	// 写 updater.bat
	batContent := fmt.Sprintf(`@echo off
timeout /t 2 /nobreak >nul
taskkill /F /IM "YSM-Model-Manager.exe" >nul 2>&1
xcopy /Y /E "%s\*" "%s" >nul 2>&1
start "" "%s\YSM-Model-Manager.exe"
del "%~f0"
`, tmpDir, exeDir, exeDir)

	batPath := filepath.Join(os.TempDir(), "ysm-updater.bat")
	os.WriteFile(batPath, []byte(batContent), 0644)

	// 启动 bat（独立进程）
	cmd := exec.Command("cmd.exe", "/C", batPath)
	cmd.Start()

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
