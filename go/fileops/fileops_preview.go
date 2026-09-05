// ===== 预览/元数据提取（ADR-040 拆分自 fileops.go）=====
// 从 internal/app/app_files.go 下沉：预览图/纹理提取、包信息。
// 纯 Go 逻辑，无 Wails runtime 依赖；root 参数由薄壳注入（原 a.ysmRoot()）。
// 与原文件同包：readLimitedFile/maxPreviewRead/opMu 定义在 fileops.go，此处直接引用。
package fileops

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/types/registry"
	"ysm-model-manager/go/ysm"
)

// ========== 预览提取 ==========

// FindPreviewImage 查找模型同目录的预览图并转 data URI
func FindPreviewImage(modelPath string) string {
	dir := filepath.Dir(modelPath)
	base := strings.TrimSuffix(filepath.Base(modelPath), filepath.Ext(modelPath))
	candidates := []string{
		filepath.Join(dir, base+".png"),
		filepath.Join(dir, base+".jpg"),
		filepath.Join(dir, "preview.png"),
		filepath.Join(dir, "cover.png"),
		filepath.Join(dir, "thumbnail.png"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			data := readLimitedFile(c)
			if len(data) > 0 {
				mime := "image/png"
				if strings.HasSuffix(strings.ToLower(c), ".jpg") {
					mime = "image/jpeg"
				}
				return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			}
		}
	}
	return ""
}

// ExtractPreviewTexture 从模型文件中提取预览纹理（zip/7z/ysm/json）
func ExtractPreviewTexture(modelPath string) string {
	// 剥禁用后缀（.disabled/.ban），与 scanner 口径一致——禁用条目也应能预览。
	// 剥离仅用于扩展名判定：磁盘上文件名仍带禁用后缀，读取必须用原始路径，
	// 否则 readLimitedFile(剥离后路径) 命中不存在文件（陷阱：先改路径后读原文件）。
	readPath := modelPath
	extPath := modelPath
	if registry.IsDisableSuffix(extPath) {
		extPath = registry.StripDisableSuffix(extPath)
	}
	ext := strings.ToLower(filepath.Ext(extPath))
	var png []byte

	if ext == ".zip" {
		data := readLimitedFile(readPath)
		if data == nil {
			return ""
		}
		png = extractFirstPNGFromZip(data, int64(len(data)))
	} else if ext == ".7z" {
		data := readLimitedFile(readPath)
		if data == nil {
			return ""
		}
		png = extractFirstPNGFrom7z(data, int64(len(data)))
	} else if ext == ".ysm" {
		if r, err := extractTextureViaYSM(readPath); err == nil {
			png = r
		}
	} else if ext == ".json" {
		// 解压后的 YSM 模型：查找 textures/ 子目录中的 PNG（目录取实际文件所在目录）
		dir := filepath.Dir(readPath)
		texDir := filepath.Join(dir, "textures")
		if d, err := os.Stat(texDir); err == nil && d.IsDir() {
			entries, _ := os.ReadDir(texDir)
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				if strings.HasSuffix(strings.ToLower(e.Name()), ".png") {
					texPath := filepath.Join(texDir, e.Name())
					png = readLimitedFile(texPath)
					if len(png) > 0 {
						break
					}
				}
			}
		}
		// 也搜同目录 PNG
		if len(png) == 0 {
			entries, _ := os.ReadDir(dir)
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				if strings.HasSuffix(strings.ToLower(e.Name()), ".png") {
					texPath := filepath.Join(dir, e.Name())
					png = readLimitedFile(texPath)
					if len(png) > 0 {
						break
					}
				}
			}
		}
	}

	if len(png) == 0 {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}

// extractTextureViaYSM 从 .ysm 提取预览纹理。
// 走注入的 YSM 解码器（internal/app 以 Node+WASM 实现注入，取代已停发的 YSMParser.exe
// sidecar——2026-08-08 架构决策）；解码器未注入/解码失败按不可用静默降级。
func extractTextureViaYSM(modelPath string) ([]byte, error) {
	data := readLimitedFile(modelPath)
	if data == nil {
		return nil, fmt.Errorf("读取模型失败")
	}
	files := ysm.DecodeYSM(data)
	if files == nil {
		return nil, fmt.Errorf("YSM 解码器未注入或解码失败")
	}
	// 解码产物中找纹理（.png/.jpg，遍历顺序即输出目录序）
	for _, f := range files {
		low := strings.ToLower(f.Path)
		if strings.HasSuffix(low, ".png") || strings.HasSuffix(low, ".jpg") {
			return f.Data, nil
		}
	}
	return nil, fmt.Errorf("模型内未找到纹理")
}

func extractFirstPNGFromZip(data []byte, size int64) []byte {
	return geometry.ExtractFirstPNGFromZip(data, size)
}

func extractFirstPNGFrom7z(data []byte, size int64) []byte {
	return geometry.ExtractFirstPNGFrom7z(data, size)
}

// ========== 包信息 ==========

// GetPackInfo 读取 ysm-pack.json（root 为空时按绝对路径处理）
func GetPackInfo(root, dirPath string) types.PackInfo {
	dirPath = strings.TrimSpace(dirPath)
	if !filepath.IsAbs(dirPath) && root != "" {
		dirPath = filepath.Join(root, dirPath)
	}
	absPath, err := filepath.Abs(filepath.FromSlash(dirPath))
	if err != nil {
		return types.PackInfo{}
	}
	jsonPath := filepath.Join(absPath, "ysm-pack.json")
	data := readLimitedFile(jsonPath)
	if data == nil {
		return types.PackInfo{}
	}
	data = fsutil.StripBOM(data)
	var raw struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Lang        map[string]struct {
			Name        string `json:"name"`
			Description string `json:"description"`
		} `json:"lang"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return types.PackInfo{}
	}
	info := types.PackInfo{Name: raw.Name, Description: raw.Description}
	if raw.Lang != nil {
		for _, l := range raw.Lang {
			if l.Name != "" {
				info.Name = l.Name
			}
			if l.Description != "" {
				info.Description = l.Description
			}
		}
	}
	imgPath := filepath.Join(absPath, "ysm-pack.png")
	if imgData := readLimitedFile(imgPath); imgData != nil {
		info.ImageBase64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(imgData)
	}
	return info
}
