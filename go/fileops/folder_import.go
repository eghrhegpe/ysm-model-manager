// ===== 文件夹型模型整组导入（ADR-038 关联）=====
// 解压目录（ysm.json 清单 + geometry json + animations/ + textures/）作为整体导入仓库，
// 保留子目录层级。前端拖拽文件夹收集全部文件（relPath + base64）经此写入。
package fileops

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types"
)

// WriteModelFolder 写入文件夹整组到仓库（YSM 解压目录或普通模型文件夹）。
// folderName 为仓库中的文件夹名（= 模型名）；files 为相对路径 → base64 内容，保留子目录层级。
// 校验：至少含 1 个支持文件（.ysm/.zip/.7z/ysm.json 等，防杂物文件夹入仓）；防覆盖；路径安全（拒绝 .. / 绝对路径 / 逃逸）。
func WriteModelFolder(repoRoot, subpath, folderName string, files []types.ImportFileItem) error {
	repoRoot = strings.TrimSpace(repoRoot)
	folderName = strings.TrimSpace(folderName)
	if repoRoot == "" || folderName == "" {
		return fmt.Errorf("参数空")
	}
	if strings.ContainsAny(folderName, `\/:*?"<>|`) {
		return fmt.Errorf("文件夹名包含非法字符")
	}
	// 子路径防穿越
	subpath = strings.Trim(subpath, `\/`)
	if subpath != "" {
		clean := filepath.Clean(filepath.FromSlash(subpath))
		if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || filepath.IsAbs(clean) {
			return fmt.Errorf("子路径非法: %s", subpath)
		}
	}
	dstRoot := filepath.Join(repoRoot, subpath, folderName)
	// 防覆盖（与单文件导入 FILE_EXISTS 语义一致）
	if _, err := os.Stat(dstRoot); err == nil {
		return fmt.Errorf("目标已存在: %s", dstRoot)
	}
	if len(files) == 0 {
		return fmt.Errorf("文件列表为空")
	}
	// 至少含 1 个支持文件（防杂物文件夹入仓）。
	// 支持判定：扩展名在资源类型白名单，且 .json 仅放行 ysm.json（与 scanner 白名单对齐）。
	// 包内资源（main.json / *.animation.json / textures/*.png）不计数但照常写入。
	hasSupported := false
	for _, f := range files {
		clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("文件路径非法: %s", f.RelPath)
		}
		if isSupportedEntryFile(clean) {
			hasSupported = true
		}
	}
	if !hasSupported {
		return fmt.Errorf("文件夹内没有可识别的模型文件（需至少 1 个 .ysm/.zip/.7z/ysm.json 等支持文件）")
	}
	for _, f := range files {
		data, err := base64.StdEncoding.DecodeString(f.Base64)
		if err != nil {
			return fmt.Errorf("base64 解码失败: %s", f.RelPath)
		}
		rel := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		if rel == "." {
			continue
		}
		dst := filepath.Join(dstRoot, rel)
		// 防逃逸：目标必须落在 dstRoot 内
		relDst, err := filepath.Rel(dstRoot, dst)
		if err != nil || relDst == ".." || strings.HasPrefix(relDst, ".."+string(filepath.Separator)) {
			return fmt.Errorf("路径越权: %s", f.RelPath)
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, data, 0644); err != nil {
			return err
		}
	}
	return nil
}

// isSupportedEntryFile 判定文件是否可作为「支持文件」计数：
// 扩展名在资源类型白名单，且 .json 仅放行 ysm.json（与 scanner 白名单对齐）。
// 传入 rel 已 Clean。包内资源（main.json 等）返回 false——它们是跟随整组导入的附属，不单独计数。
func isSupportedEntryFile(rel string) bool {
	ext := strings.ToLower(filepath.Ext(rel))
	if ext == ".json" {
		return types.IsYsmEntryJSON(filepath.Base(rel))
	}
	return types.IsSupportedExt(ext)
}
