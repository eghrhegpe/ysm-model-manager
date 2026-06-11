package ysm

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// TexInfo 轻量级纹理尺寸（不解析完整模型）
type TexInfo struct {
	Path      string `json:"path"`
	TexWidth  int    `json:"texWidth"`
	TexHeight int    `json:"texHeight"`
}

// ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM
// 仅支持 zip/7z 格式（未加密模型），加密 .ysm 返回 0,0
func ScanModelTexSizes(entries []ModelEntry) []TexInfo {
	var results []TexInfo
	for _, e := range entries {
		path := e.Path
		tw, th := readTexSizeFromFile(path)
		results = append(results, TexInfo{
			Path:      path,
			TexWidth:  tw,
			TexHeight: th,
		})
	}
	return results
}

// ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径）
type ModelEntry struct {
	Path string
	Name string
}

// readTexSizeFromFile 从文件读取纹理尺寸，不解析模型骨骼
func readTexSizeFromFile(path string) (int, int) {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".zip":
		return readTexFromZip(path)
	case ".7z":
		return readTexFrom7z(path)
	default:
		// .ysm 加密模型无法在不解码的情况下读取纹理尺寸
		return 0, 0
	}
}

// readTexFromZip 从 zip 中提取 geometry JSON 读取纹理尺寸
func readTexFromZip(path string) (int, int) {
	r, err := zip.OpenReader(path)
	if err != nil {
		return 0, 0
	}
	defer r.Close()

	for _, f := range r.File {
		name := strings.ToLower(f.Name)
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		// 查找 geometry JSON（含 minecraft:geometry 字段）
		rc, err := f.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		if w, h := extractTexSizeFromGeometryBytes(data); w > 0 && h > 0 {
			return w, h
		}
	}
	// 尝试从任何 JSON 中查找（非标准命名也行）
	for _, f := range r.File {
		name := strings.ToLower(f.Name)
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		if w, h := extractTexSizeFromGeometryBytes(data); w > 0 && h > 0 {
			return w, h
		}
	}
	return 0, 0
}

// readTexFrom7z 尝试从 7z 读取纹理尺寸（简化为仅扫描第一层）
func readTexFrom7z(path string) (int, int) {
	// 7z 解析较复杂，暂不实现详细解析
	// 直接读取文件前几 KB 看是否有 JSON 片段
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, 0
	}
	// 只看前 64KB
	limit := len(data)
	if limit > 65536 {
		limit = 65536
	}
	// 查找 texture_width/texture_height 文本
	s := string(data[:limit])
	if strings.Contains(s, "texture_width") && strings.Contains(s, "texture_height") {
		// 尝试解析 JSON 片段
		if w, h := extractTexSizeFromGeometryBytes(data); w > 0 && h > 0 {
			return w, h
		}
	}
	return 0, 0
}

// extractTexSizeFromGeometryBytes 从 geometry JSON 字节提取纹理尺寸
func extractTexSizeFromGeometryBytes(data []byte) (w, h int) {
	var raw struct {
		Geometry []struct {
			Description struct {
				TextureWidth  float64 `json:"texture_width"`
				TextureHeight float64 `json:"texture_height"`
			} `json:"description"`
		} `json:"minecraft:geometry"`
	}
	if err := json.Unmarshal(data, &raw); err != nil || len(raw.Geometry) == 0 {
		return 0, 0
	}
	return int(raw.Geometry[0].Description.TextureWidth), int(raw.Geometry[0].Description.TextureHeight)
}

// ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用）
func ScanFiles(repoRoot string) []ModelEntry {
	var entries []ModelEntry
	filepath.Walk(repoRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".ysm" || ext == ".zip" || ext == ".7z" {
			entries = append(entries, ModelEntry{
				Path: path,
				Name: info.Name(),
			})
		}
		return nil
	})
	return entries
}
