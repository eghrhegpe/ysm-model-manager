// ========== 创作者头像提取（薄壳） ==========
// 纯逻辑已下沉到 go/avatar/，此处仅做 Wails 绑定适配。
package app

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/avatar"
	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/types"
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
	if cacheDir != "" {
		// MkdirAll 错误不再忽略（R20 审核 P3-2）：缓存目录创建失败应留痕，
		// 后续 SaveAvatarData 内部也会尝试创建并 log，此处仅语义补记
		if err := os.MkdirAll(cacheDir, fsutil.DirPerms); err != nil {
			log.Printf("[avatar] 创建缓存目录失败 %s: %v", cacheDir, err)
		}
	}

	entries := a.ScanModelEntries(a.ysmRoot())
	seen := map[string]string{}
	seenMod := map[string]int64{}
	for _, e := range entries {
		name := e.Name
		if types.IsDisableSuffix(name) {
			name = types.StripDisableSuffix(name)
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := strings.TrimSpace(name[1:idx])
				if author == "" {
					continue
				}
				// ADR-064 锚定：扩展名判定走注册表（原硬编码 .ysm/.zip/.7z/.json，
				// 新增 YSM 承载格式或类型时头像提取失效）
				if types.IsTypeModelFile(e.Name, "ysm") {
					// 同作者多个模型取 ModTime 最新者（R20 审核 P3-3）：
					// 原「只看第一个」可能漏掉更新模型的头像；ModTime 相等时
					// 先扫描到的胜出（保持扫描顺序确定性）
					if cur, ok := seenMod[author]; !ok || e.ModTime > cur {
						seenMod[author] = e.ModTime
						seen[author] = e.Path
					}
				}
			}
		}
	}

	for author, modelPath := range seen {
		safe := avatar.SafeName(author)
		// 缓存命中走 ReadCachedAvatar（含 JPEG 文件头嗅探 avatar.go:154-161，
		// 与 CachedCreatorAvatar 口径一致）——原实现直接 os.ReadFile + 硬编码
		// image/png，JPEG 头像缓存命中时两条 binding 返回不同 MIME
		if dataURI, _ := avatar.ReadCachedAvatar(author); dataURI != "" {
			result[author] = dataURI
			continue
		}
		dataURI := avatar.ExtractAvatarURI(modelPath, safe)
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
		if types.IsDisableSuffix(name) {
			name = types.StripDisableSuffix(name)
		}
		if strings.HasPrefix(name, "[") {
			if idx := strings.Index(name, "]"); idx > 0 {
				author := strings.TrimSpace(name[1:idx])
				if author == authorName {
					// ADR-064 锚定：同上方头像提取，扩展名判定走注册表
					if types.IsTypeModelFile(e.Name, "ysm") {
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
	if cacheDir != "" {
		// MkdirAll 错误不再忽略（R20 审核 P3-2）：缓存目录创建失败应留痕，
		// 后续 SaveAvatarData 内部也会尝试创建并 log，此处仅语义补记
		if err := os.MkdirAll(cacheDir, fsutil.DirPerms); err != nil {
			log.Printf("[avatar] 创建缓存目录失败 %s: %v", cacheDir, err)
		}
	}
	safe := avatar.SafeName(authorName)
	info["step"] = "extracting"
	dataURI := avatar.ExtractAvatarURI(foundPath, safe)
	if dataURI == "" {
		info["status"] = "extract_failed"
		return info
	}
	info["cached_path"] = filepath.Join(cacheDir, safe+".png")
	info["data_uri_len"] = fmt.Sprintf("%d", len(dataURI))
	info["status"] = "ok"
	return info
}

// CacheModelAvatars 从模型文件缓存作者头像（覆盖 .ysm/.zip/.json 等所有格式）
func (a *App) CacheModelAvatars(modelPath string) {
	// 路径守卫：Wails binding 可被前端传入任意路径，须限制在合法仓库根内
	if !a.isPathInRootOrSelf(modelPath) {
		return
	}
	avatar.CacheAvatarsFromModel(modelPath)
}
