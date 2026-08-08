package packs

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ysm-model-manager/go/types"
)

// ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图
func ReadPackMeta(path string) (*types.PackMeta, string, error) {
	var data []byte
	var packPng []byte

	info, err := os.Stat(path)
	if err != nil {
		return nil, "", err
	}

	if info.IsDir() {
		// 目录格式资源包
		metaPath := filepath.Join(path, "pack.mcmeta")
		if meta, err := os.Open(metaPath); err == nil {
			// 限制 pack.mcmeta 大小（1MB，合法文件通常 < 1KB），防畸形大文件读入内存
			var readErr error
			data, readErr = io.ReadAll(io.LimitReader(meta, 1<<20))
			meta.Close()
			if readErr != nil {
				return nil, "", fmt.Errorf("读取 pack.mcmeta 失败: %w", readErr)
			}
		}
		pngPath := filepath.Join(path, "pack.png")
		// P2 修复：目录形态 pack.png 与 ZIP 分支对齐 10MB 上限（stat 预检防超大图整读内存）
		if st, err := os.Stat(pngPath); err == nil && st.Size() <= (10<<20) {
			if png, err := os.ReadFile(pngPath); err == nil {
				packPng = png
			}
		}
	} else if strings.HasSuffix(strings.ToLower(path), ".zip") {
		// ZIP 格式资源包
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
				// 限制 pack.mcmeta 大小（1MB），与 pack.png 的 LimitReader 保护对齐
				readData, readErr := io.ReadAll(io.LimitReader(rc, 1<<20))
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
				// P2 修复：limit+1 探测截断（ADR-033 陷阱）——超 10MB 的 pack.png 被截断后
				// readErr==nil，损坏 PNG 会被 base64 包装展示。超限时置空跳过
				const maxPackPng = 10 << 20
				readData, readErr := io.ReadAll(io.LimitReader(rc, maxPackPng+1))
				rc.Close()
				if readErr == nil && len(readData) <= maxPackPng {
					packPng = readData
				}
			}
		}
	}

	if len(data) == 0 {
		return nil, "", fmt.Errorf("未找到 pack.mcmeta")
	}

	var meta types.PackMeta
	// 去除 UTF-8 BOM（PowerShell 写入的 JSON 可能带 EF BB BF 前缀）
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
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

// hasMcmeta 检查 zip 内是否有 pack.mcmeta（区分 ZIP 资源包/模型）
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
		const maxLangSize = 1 << 20 // 1MB（合法 lang 通常 < 10KB）
		if fi, err := os.Stat(langPath); err == nil && fi.Size() <= maxLangSize {
			if data, err := os.ReadFile(langPath); err == nil {
				langData = data
			}
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
				// P3 修复：lang 文件设大小上限（limit+1 截断探测，对齐 ADR-033）——
				// 原 io.ReadAll 全量读入，畸形/超大 lang 可拖垮内存，与包内其余 LimitReader 防护不统一
				const maxLangSize = 1 << 20 // 1MB（合法 lang 通常 < 10KB）
				langData, _ = io.ReadAll(io.LimitReader(rc, maxLangSize+1))
				if len(langData) > maxLangSize {
					langData = nil // 超限视为无效，返回空 name（前端用文件名兜底）
				}
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
