package types

import (
	"encoding/json"
	"fmt"
)

// ResourceTypeRegistry 资源类型注册表
type ResourceTypeRegistry struct {
	ResourceTypes []ResourceType `json:"resourceTypes"`
}

// ResourceType 一种受支持的资源类型定义
type ResourceType struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	Icon          string   `json:"icon"`
	Extensions    []string `json:"extensions"`
	InstallDir    string   `json:"installDir"`
	InstanceLevel bool     `json:"instanceLevel"`
	Preview       string   `json:"preview"`    // "3d" / "thumbnail" / "none"
	Detector      string   `json:"detector"`   // "ysm" / "mcmeta" / ""
}

// FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]）
type FormatRange struct {
	Min int
	Max int
}

// UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式
func (fr *FormatRange) UnmarshalJSON(b []byte) error {
	// 尝试单 int
	var single int
	if json.Unmarshal(b, &single) == nil {
		fr.Min = single
		fr.Max = single
		return nil
	}
	// 尝试 int 数组（长度 1 或 2）: [min, max] 或 [min]
	var arr []int
	if err := json.Unmarshal(b, &arr); err == nil {
		if len(arr) == 1 {
			fr.Min = arr[0]
			fr.Max = arr[0]
		} else if len(arr) >= 2 {
			fr.Min = arr[0]
			fr.Max = arr[1]
		} else {
			return fmt.Errorf("FormatRange: 数组长度不足")
		}
		return nil
	}
	// 尝试对象格式: {"min_inclusive": N, "max_inclusive": M}
	var obj struct {
		MinInclusive int `json:"min_inclusive"`
		MaxInclusive int `json:"max_inclusive"`
	}
	if err := json.Unmarshal(b, &obj); err != nil {
		return fmt.Errorf("FormatRange: 期望 int / 数组 / 对象: %w", err)
	}
	fr.Min = obj.MinInclusive
	fr.Max = obj.MaxInclusive
	return nil
}

// descString 从 json.RawMessage 提取可读的描述文本
func descString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	// 字符串：直接返回去掉引号
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
		return ""
	}
	// JSON text component 对象 → 取 text 字段
	if raw[0] == '{' {
		var obj struct{ Text string `json:"text"` }
		if json.Unmarshal(raw, &obj) == nil && obj.Text != "" {
			return obj.Text
		}
		return ""
	}
	// JSON text component 数组 → 拼接所有 text 字段
	if raw[0] == '[' {
		var arr []struct {
			Text  string `json:"text"`
			Extra []struct {
				Text string `json:"text"`
			} `json:"extra"`
		}
		if json.Unmarshal(raw, &arr) == nil {
			var out string
			for _, c := range arr {
				if c.Text != "" {
					out += c.Text
				}
				for _, e := range c.Extra {
					if e.Text != "" {
						out += e.Text
					}
				}
			}
			return out
		}
	}
	return ""
}

// PackMeta 资源包信息（来自 pack.mcmeta）
type PackMeta struct {
	Pack struct {
		PackFormat       int            `json:"pack_format"`
		Description      json.RawMessage `json:"description"`
		SupportedFormats *FormatRange   `json:"supported_formats,omitempty"`
		MinFormat        *FormatRange   `json:"min_format,omitempty"`
		MaxFormat        *FormatRange   `json:"max_format,omitempty"`
	} `json:"pack"`
}

// Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组）
func (pm *PackMeta) Desc() string {
	return descString(pm.Pack.Description)
}
