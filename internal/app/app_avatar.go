// ========== 创作者头像提取（薄壳） ==========
// 纯逻辑已下沉到 go/avatar/，此处仅做 Wails 绑定适配。
package app

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/avatar"
)

// CachedCreatorAvatar 检查缓存中是否有作者头像，返回 data URI
func (a *App) CachedCreatorAvatar(authorName string) (string, error) {
	return avatar.ReadCachedAvatar(authorName)
}

// BatchExtractCreatorAvatars 批量提取所有有本地模型的创作者头像
func (a *App) BatchExtractCreatorAvatars() (map[string]string, error) {
	result := map[string]string{}
	if a.ysmRoot() == "" {
		return result, nil
	}
	cacheDir := avatar.CacheDir()
	os.MkdirAll(cacheDir, 0755)

	entries := a.ScanModelEntries(a.ysmRoot())
	seen := map[string]string{}
	for _, e := range entries {
		name := e.Name
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := strings.TrimSpace(name[1:idx])
				if author == "" {
					continue
				}
				if _, ok := seen[author]; !ok {
					ext := strings.ToLower(filepath.Ext(e.Path))
					if ext == ".ysm" || ext == ".zip" || ext == ".7z" || ext == ".json" {
						seen[author] = e.Path
					}
				}
			}
		}
	}

	for author, modelPath := range seen {
		safe := avatar.SafeName(author)
		cachedPath := filepath.Join(cacheDir, safe+".png")
		if _, err := os.Stat(cachedPath); err == nil {
			data, _ := os.ReadFile(cachedPath)
			if data != nil {
				result[author] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
			}
			continue
		}
		dataURI := avatar.DecodeOneAvatar(modelPath, cacheDir, safe)
		if dataURI != "" {
			result[author] = dataURI
		}
	}
	return result, nil
}

// DebugExtractCreatorAvatar 调试版：提取指定作者头像
func (a *App) DebugExtractCreatorAvatar(authorName string) map[string]string {
	info := map[string]string{
		"author":   authorName,
		"repoRoot": a.ysmRoot(),
		"step":     "init",
		"status":   "pending",
	}
	if a.ysmRoot() == "" {
		info["status"] = "no_repo_root"
		return info
	}
	entries := a.ScanModelEntries(a.ysmRoot())
	var foundPath string
	for _, e := range entries {
		name := e.Name
		if strings.HasSuffix(strings.ToLower(name), ".ban") {
			name = name[:len(name)-4]
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := strings.TrimSpace(name[1:idx])
				if author == authorName {
					ext := strings.ToLower(filepath.Ext(e.Path))
					if ext == ".ysm" || ext == ".zip" || ext == ".7z" || ext == ".json" {
						foundPath = e.Path
						info["found_path"] = foundPath
						break
					}
				}
			}
		}
	}
	if foundPath == "" {
		info["status"] = "no_model_file_found"
		return info
	}
	info["step"] = "found_model"
	cacheDir := avatar.CacheDir()
	os.MkdirAll(cacheDir, 0755)
	safe := avatar.SafeName(authorName)
	info["step"] = "extracting"
	dataURI := avatar.DecodeOneAvatar(foundPath, cacheDir, safe)
	if dataURI == "" {
		info["status"] = "extract_failed"
		return info
	}
	info["cached_path"] = filepath.Join(cacheDir, safe+".png")
	info["data_uri_len"] = fmt.Sprintf("%d", len(dataURI))
	info["status"] = "ok"
	return info
}

// CacheModelAvatars 从解压目录 ysm.json 缓存头像
func (a *App) CacheModelAvatars(modelPath string) {
	avatar.CacheAvatarsFromJSON(modelPath)
}
