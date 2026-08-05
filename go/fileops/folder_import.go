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

// WriteModelFolder 写入文件夹型模型（YSM 解压目录）整组到仓库。
// folderName 为仓库中的文件夹名（= 模型名）；files 为相对路径 → base64 内容，保留子目录层级。
// 校验：必须含 ysm.json 清单（防乱导入）；防覆盖；路径安全（拒绝 .. / 绝对路径 / 逃逸）。
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
	// 必须含 ysm.json 清单（YSM 解压目录的唯一入口，ADR-038 D1）
	hasYsmJSON := false
	for _, f := range files {
		clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(f.RelPath)))
		if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("文件路径非法: %s", f.RelPath)
		}
		if strings.EqualFold(clean, "ysm.json") {
			hasYsmJSON = true
		}
	}
	if !hasYsmJSON {
		return fmt.Errorf("文件夹缺少 ysm.json 清单，非 YSM 模型目录")
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
