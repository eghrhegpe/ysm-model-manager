package ysm

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

// YSMModelMeta 模型元数据（从 model.json 提取）
type YSMModelMeta struct {
	Name       string `json:"name"`
	Author     string `json:"author"`
	Version    string `json:"version"`
	Bones      int    `json:"bones"`
	Textures   int    `json:"textures"`
	Animations int    `json:"animations"`
	Vertices   int    `json:"vertices"`
	Faces      int    `json:"faces"`
	HasError   bool   `json:"hasError"`
	ErrorMsg   string `json:"errorMsg,omitempty"`
}

// 内部用——model.json 的完整结构（只关心需要的字段）
type ysmModelJSON struct {
	Name       string          `json:"name"`
	Author     string          `json:"author"`
	Version    string          `json:"version"`
	Bones      json.RawMessage `json:"bones"`      // 数组，取长度
	Textures   json.RawMessage `json:"textures"`    // 数组或对象，取长度
	Animations json.RawMessage `json:"animations"`  // 数组，取长度
	Model      *ysmGeometry    `json:"model"`
}

type ysmGeometry struct {
	Vertices json.RawMessage `json:"vertices"` // 数组，取长度
	Faces    json.RawMessage `json:"faces"`    // 数组，取长度
}

// AnalyzeYSMModel 解析 .ysm 文件，提取模型元数据
func AnalyzeYSMModel(path string) YSMModelMeta {
	meta := YSMModelMeta{}

	// 只处理 .ysm 文件
	ext := strings.ToLower(filepath.Ext(path))
	// .ysm 也可能没有扩展名或 .zip 扩展
	if ext != ".ysm" && ext != ".zip" {
		// 去掉 .ban 再检查
		if strings.HasSuffix(strings.ToLower(path), ".ban") {
			base := path[:len(path)-4]
			ext2 := strings.ToLower(filepath.Ext(base))
			if ext2 != ".ysm" && ext2 != ".zip" {
				meta.HasError = true
				meta.ErrorMsg = "不支持的文件类型"
				return meta
			}
		} else {
			meta.HasError = true
			meta.ErrorMsg = "不支持的文件类型，仅支持 .ysm"
			return meta
		}
	}

	// 打开 ZIP
	r, err := zip.OpenReader(path)
	if err != nil {
		meta.HasError = true
		meta.ErrorMsg = fmt.Sprintf("无法打开文件: %v", err)
		return meta
	}
	defer r.Close()

	// 查找 model.json
	var modelFile *zip.File
	for _, f := range r.File {
		name := strings.ToLower(filepath.Base(f.Name))
		if name == "model.json" {
			modelFile = f
			break
		}
	}

	if modelFile == nil {
		meta.HasError = true
		meta.ErrorMsg = "未找到 model.json（不是有效的 YSM 模型）"
		return meta
	}

	// 读取 model.json
	rc, err := modelFile.Open()
	if err != nil {
		meta.HasError = true
		meta.ErrorMsg = fmt.Sprintf("读取 model.json 失败: %v", err)
		return meta
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		meta.HasError = true
		meta.ErrorMsg = fmt.Sprintf("读取 model.json 失败: %v", err)
		return meta
	}

	// 解析 JSON
	var m ysmModelJSON
	if err := json.Unmarshal(data, &m); err != nil {
		meta.HasError = true
		meta.ErrorMsg = fmt.Sprintf("解析 model.json 失败: %v", err)
		return meta
	}

	meta.Name = m.Name
	meta.Author = m.Author
	meta.Version = m.Version

	// 统计数组长度
	if len(m.Bones) > 0 {
		var arr []json.RawMessage
		if err := json.Unmarshal(m.Bones, &arr); err == nil {
			meta.Bones = len(arr)
		}
	}
	if len(m.Textures) > 0 {
		// textures 可能是数组或对象
		var arr []json.RawMessage
		if err := json.Unmarshal(m.Textures, &arr); err == nil {
			meta.Textures = len(arr)
		} else {
			var obj map[string]json.RawMessage
			if err := json.Unmarshal(m.Textures, &obj); err == nil {
				meta.Textures = len(obj)
			}
		}
	}
	if len(m.Animations) > 0 {
		var arr []json.RawMessage
		if err := json.Unmarshal(m.Animations, &arr); err == nil {
			meta.Animations = len(arr)
		}
	}
	if m.Model != nil {
		if len(m.Model.Vertices) > 0 {
			var arr []json.RawMessage
			if err := json.Unmarshal(m.Model.Vertices, &arr); err == nil {
				meta.Vertices = len(arr)
			}
		}
		if len(m.Model.Faces) > 0 {
			var arr []json.RawMessage
			if err := json.Unmarshal(m.Model.Faces, &arr); err == nil {
				meta.Faces = len(arr)
			}
		}
	}

	return meta
}
