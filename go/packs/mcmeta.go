package packs

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types"
)

// ReadPackMeta 从材质包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图
func ReadPackMeta(path string) (*types.PackMeta, string, error) {
	var data []byte
	var packPng []byte

	info, err := os.Stat(path)
	if err != nil {
		return nil, "", err
	}

	if info.IsDir() {
		// 目录格式材质包
		metaPath := filepath.Join(path, "pack.mcmeta")
		if meta, err := os.ReadFile(metaPath); err == nil {
			data = meta
		}
		pngPath := filepath.Join(path, "pack.png")
		if png, err := os.ReadFile(pngPath); err == nil {
			packPng = png
		}
	} else if strings.HasSuffix(strings.ToLower(path), ".zip") {
		// ZIP 格式材质包
		r, err := zip.OpenReader(path)
		if err != nil {
			return nil, "", err
		}
		defer r.Close()
		for _, f := range r.File {
			low := strings.ToLower(f.Name)
			if low == "pack.mcmeta" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				data, _ = io.ReadAll(rc)
				rc.Close()
			}
			if low == "pack.png" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				packPng, _ = io.ReadAll(rc)
				rc.Close()
			}
		}
	}

	if len(data) == 0 {
		return nil, "", fmt.Errorf("未找到 pack.mcmeta")
	}

	var meta types.PackMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, "", fmt.Errorf("pack.mcmeta 解析失败: %w", err)
	}

	// base64 缩略图
	var thumb string
	if len(packPng) > 0 {
		thumb = "data:image/png;base64," + base64Encode(packPng)
	}

	return &meta, thumb, nil
}

// DetectResourceType 检测文件属于哪种资源类型
func DetectResourceType(path string, registry *types.ResourceTypeRegistry) string {
	ext := strings.ToLower(filepath.Ext(path))

	for _, rt := range registry.ResourceTypes {
		if !hasExt(ext, rt.Extensions) {
			continue
		}
		switch rt.Detector {
		case "ysm":
			if isYsmFile(path) {
				return rt.ID
			}
		case "mcmeta":
			if hasMcmeta(path) {
				return rt.ID
			}
		case "shader":
			if hasShaders(path) {
				return rt.ID
			}
		default:
			return rt.ID
		}
	}
	return ""
}

func hasExt(ext string, exts []string) bool {
	for _, e := range exts {
		if ext == e {
			return true
		}
	}
	return false
}

// isYsmFile 检查 zip/7z 内是否有 ysm.json 或 models/ 目录
func isYsmFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".ysm" {
		return true
	}
	if ext != ".zip" && ext != ".7z" {
		return false
	}
	r, err := zip.OpenReader(path)
	if err != nil {
		return false
	}
	defer r.Close()
	for _, f := range r.File {
		low := strings.ToLower(f.Name)
		if strings.HasSuffix(low, "ysm.json") || strings.HasPrefix(low, "models/") {
			return true
		}
	}
	return false
}

// hasMcmeta 检查 zip 内是否有 pack.mcmeta（区分 ZIP 材质包/模型）
func hasMcmeta(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".zip" {
		return false
	}
	r, err := zip.OpenReader(path)
	if err != nil {
		return false
	}
	defer r.Close()
	for _, f := range r.File {
		if strings.ToLower(f.Name) == "pack.mcmeta" {
			return true
		}
	}
	return false
}

// hasShaders 检查 zip 内是否有 shaders/ 目录（光影包特征）
func hasShaders(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".zip" {
		return false
	}
	r, err := zip.OpenReader(path)
	if err != nil {
		return false
	}
	defer r.Close()
	for _, f := range r.File {
		low := strings.ToLower(f.Name)
		if strings.HasPrefix(low, "shaders/") || low == "shaders" {
			return true
		}
	}
	return false
}

func base64Encode(data []byte) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	var result []byte
	for i := 0; i < len(data); i += 3 {
		var b [3]byte
		var n int
		for j := 0; j < 3; j++ {
			if i+j < len(data) {
				b[j] = data[i+j]
				n++
			}
		}
		val := int(b[0])<<16 | int(b[1])<<8 | int(b[2])
		result = append(result, chars[(val>>18)&0x3F])
		result = append(result, chars[(val>>12)&0x3F])
		if n > 1 {
			result = append(result, chars[(val>>6)&0x3F])
		} else {
			result = append(result, '=')
		}
		if n > 2 {
			result = append(result, chars[val&0x3F])
		} else {
			result = append(result, '=')
		}
	}
	return string(result)
}
