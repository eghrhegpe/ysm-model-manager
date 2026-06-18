package litematic

import (
	"fmt"
	"strings"
)

//go:generate go run ./gen

// ResolveBlockName 把旧版数字 ID（schematic v1）解析为注册名。
// 未找到时返回空字符串。
func ResolveBlockName(id int, data byte) string {
	key := fmt.Sprintf("%d:%d", id, data)
	if v, ok := blockVariantNames[key]; ok {
		return v
	}
	key0 := fmt.Sprintf("%d:0", id)
	if v, ok := blockVariantNames[key0]; ok {
		return v
	}
	return ""
}

// ResolveBlockZH 把注册名映射为中文名（自动去除 minecraft: 前缀）。
// 未找到时返回原始注册名。
func ResolveBlockZH(name string) string {
	name = strings.TrimPrefix(name, "minecraft:")
	if zh, ok := blockNameToZH[name]; ok {
		return zh
	}
	return name
}
