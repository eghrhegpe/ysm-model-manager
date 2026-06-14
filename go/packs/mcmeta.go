package packs

import (
	"archive/zip"
	"encoding/base64"
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
				readData, readErr := io.ReadAll(rc)
				rc.Close()
				if readErr == nil {
					data = readData
				}
			}
			if low == "pack.png" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				// 限制 pack.png 大小（最大 10MB）
				readData, readErr := io.ReadAll(io.LimitReader(rc, 10<<20))
				rc.Close()
				if readErr == nil {
					packPng = readData
				}
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
		thumb = "data:image/png;base64," + base64.StdEncoding.EncodeToString(packPng)
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

// isYsmFile 检查文件是否为 YSM 模型
// .ysm → 直接返回 true；.zip → 检查内部是否有 ysm.json 或 models/
// .7z → zip.OpenReader 会失败，跳过内容检测直接返回 true（靠扩展名兜底）
func isYsmFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".ysm" {
		return true
	}
	if ext != ".zip" && ext != ".7z" {
		return false
	}
	// .7z 不是 ZIP 格式，无法用 zip.OpenReader 打开，但注册表已声明为 YSM 扩展名，直接放行
	if ext == ".7z" {
		return true
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



// ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名
// 返回 {name, entries}，name 为空时前端用文件名兜底
func ReadShaderpackLang(path string) string {
	result := map[string]interface{}{
		"name":    "",
		"entries": map[string]string{},
	}

	info, err := os.Stat(path)
	if err != nil {
		data, _ := json.Marshal(result)
		return string(data)
	}

	var langData []byte
	if info.IsDir() {
		// 已解压的目录格式
		langPath := filepath.Join(path, "lang", "en_US.lang")
		if data, err := os.ReadFile(langPath); err == nil {
			langData = data
		}
	} else if strings.HasSuffix(strings.ToLower(path), ".zip") {
		r, err := zip.OpenReader(path)
		if err != nil {
			data, _ := json.Marshal(result)
			return string(data)
		}
		defer r.Close()
		for _, f := range r.File {
			low := strings.ToLower(f.Name)
			if low == "lang/en_us.lang" || low == "lang/en_US.lang" {
				rc, err := f.Open()
				if err != nil {
					continue
				}
				langData, _ = io.ReadAll(rc)
				rc.Close()
				break
			}
		}
	}

	if len(langData) == 0 {
		data, _ := json.Marshal(result)
		return string(data)
	}

	// 解析 .lang 文件（key=value 格式）
	entries := make(map[string]string)
	var name string
	for _, line := range strings.Split(string(langData), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eqIdx := strings.Index(line, "=")
		if eqIdx < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eqIdx])
		val := strings.TrimSpace(line[eqIdx+1:])
		if key == "" || val == "" {
			continue
		}
		entries[key] = val
		// 常见的显示名 key
		lowKey := strings.ToLower(key)
		if strings.Contains(lowKey, "title") || strings.Contains(lowKey, "pack.name") || strings.Contains(lowKey, "shaderpack.name") {
			if name == "" {
				name = val
			}
		}
	}

	result["name"] = name
	result["entries"] = entries
	data, _ := json.Marshal(result)
	return string(data)
}
