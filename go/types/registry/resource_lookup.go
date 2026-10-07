// resource_lookup.go：registry 类型查找与元信息读取（原 resource.go 拆分，2026-10 文件行数治理）。
// loadRegistryBytes / RegistryType / FindByID / ModKeywordsFor / ModMetaFor / FormatRange / descString /
// PackMeta / Litematic*——按 id/rtype 查找 ResourceType 与派生元信息。
package registry

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

func loadRegistryBytes() []byte {
	if registryPath != "" && registryPath != "resource_types.json" {
		if b, err := os.ReadFile(registryPath); err == nil {
			return b
		}
	}
	return bundledRegistryJSON
}

// BundledRegistryJSON 返回编译期内嵌的资源类型注册表原始 JSON 字节（单一事实来源）。
// internal/app 复用同一 embed（LoadResourceTypes / DetectResourceType / 同步状态），
// 避免双嵌与副本漂移。
func BundledRegistryJSON() []byte {
	return bundledRegistryJSON
}

// RegistryType 按 id 查找资源类型，不存在时返回 nil
// 返回深拷贝：结构体按值拷贝仅能防标量字段篡改，Extensions 切片仍共享缓存
// 底层数组——调用方修改 rt.Extensions 会污染进程级注册表缓存，因此必须深拷贝切片。
func RegistryType(id string) *ResourceType {
	reg := LoadRegistry()
	return reg.FindByID(id)
}

// resolveRegistryType 是「id → 资源类型」的**唯一解析口**：先精确匹配，未命中再小写回退
// （向后兼容历史调用方传大小写变体）。不存在时返回 nil。
//
// 为什么必须有这一层（2026-10-06 修复）：此前小写回退散落在个别调用点
// （SupportedExtsForType / SubDirMap 各自写一份），而 FindInstDir 只做精确匹配——
// 同一份 rtype 在不同函数里「能否解析出类型」不一致。后果不是少个扩展名，而是
// FindInstDir 在 `!rt.ScanInstance` 处对 nil 解引用 panic：前端经绑定入参
// （app_install_instance.go 的 d.RType、resource_bindings.go 的 rtype）传个大小写变体
// 即可触发进程级崩溃。调用方若拿 rt 判分支，一律走本函数而非 RegistryType——
// 让「解析口径」只有一处可漂移。
func resolveRegistryType(id string) *ResourceType {
	if rt := RegistryType(id); rt != nil {
		return rt
	}
	return RegistryType(strings.ToLower(id))
}

// FindByID 按 id 查找资源类型，不存在时返回 nil（深拷贝）
func (reg *ResourceTypeRegistry) FindByID(id string) *ResourceType {
	for i := range reg.ResourceTypes {
		if reg.ResourceTypes[i].ID == id {
			rt := reg.ResourceTypes[i] // 拷贝，防外部篡改进程级缓存
			rt.Extensions = append([]string(nil), rt.Extensions...)
			rt.InstallExts = append([]string(nil), rt.InstallExts...)
			rt.ZipEntries = append([]ZipEntryMatch(nil), rt.ZipEntries...)
			return &rt
		}
	}
	return nil
}

// ModKeywordsFor 从注册表查询资源类型的 mod 文件名关键词（ADR-110）：
//   - 类型自身有 mod.jarKeywords → 返回
//   - 类型无声明但所属组有 → 返回组的关键词（组级回退）
//   - 都没有 → 返回 nil（无 mod 依赖或内容检测型）
//
// 取代 go/ysm/ysm.go 的 ModKeywords/ModGroupKeywords 硬编码。
func ModKeywordsFor(rtype string) []string {
	rt := RegistryType(rtype)
	if rt == nil {
		return nil
	}
	// 类型自身声明
	if rt.Mod != nil && len(rt.Mod.JarKeywords) > 0 {
		return rt.Mod.JarKeywords
	}
	// 组级回退：查同组首个有 mod 声明的类型
	if rt.Group != "" {
		reg := LoadRegistry()
		for i := range reg.ResourceTypes {
			other := &reg.ResourceTypes[i]
			if other.Group == rt.Group && other.ID != rt.ID && other.Mod != nil && len(other.Mod.JarKeywords) > 0 {
				return other.Mod.JarKeywords
			}
		}
	}
	return nil
}

// ModMetaFor 从注册表查询内容检测型资源类型的 mod 信息（ADR-110）：
//   - 类型有 mod.modId → 返回 (modId, displayName)
//   - 否则返回 ("", "")
//
// 取代 go/ysm/ysm.go 的 ModMeta 硬编码。
func ModMetaFor(rtype string) (modID, displayName string) {
	rt := RegistryType(rtype)
	if rt == nil || rt.Mod == nil {
		return "", ""
	}
	return rt.Mod.ModID, rt.Mod.DisplayName
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
		switch {
		case len(arr) == 1:
			fr.Min = arr[0]
			fr.Max = arr[0]
		case len(arr) >= 2:
			fr.Min = arr[0]
			fr.Max = arr[1]
		default:
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
		var obj struct {
			Text string `json:"text"`
		}
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
		PackFormat       int             `json:"pack_format"`
		Description      json.RawMessage `json:"description"`
		SupportedFormats *FormatRange    `json:"supported_formats,omitempty"`
		MinFormat        *FormatRange    `json:"min_format,omitempty"`
		MaxFormat        *FormatRange    `json:"max_format,omitempty"`
	} `json:"pack"`
}

// Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组）
func (pm *PackMeta) Desc() string {
	return descString(pm.Pack.Description)
}

// ===== Litematica 投影文件类型 =====

// LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound）
type LitematicMeta struct {
	Name                 string               `json:"name"`
	Author               string               `json:"author"`
	Description          string               `json:"description"`
	TimeCreated          int64                `json:"timeCreated"`          // unix 毫秒
	TimeModified         int64                `json:"timeModified"`         // unix 毫秒
	MinecraftDataVersion int                  `json:"minecraftDataVersion"` // MC 数据版本号
	Version              int                  `json:"version"`              // Litematica 格式版本
	TotalBlocks          int                  `json:"totalBlocks"`          // 非空气方块总数
	TotalVolume          int                  `json:"totalVolume"`          // 包围盒总体积（含空气）
	EnclosingSize        [3]int               `json:"enclosingSize"`        // [x, y, z]
	RegionCount          int                  `json:"regionCount"`
	BlockStats           []LitematicBlockStat `json:"blockStats"`   // 按数量降序排列
	PreviewImage         string               `json:"previewImage"` // "data:image/png;base64,..." 或 ""
}

// LitematicBlockStat 方块类型统计
type LitematicBlockStat struct {
	Name  string `json:"name"` // "minecraft:stone"
	Count int    `json:"count"`
}

// LitematicVoxelData 体素渲染数据
type LitematicVoxelData struct {
	Size      [3]int       `json:"size"`      // 包围盒尺寸 [x, y, z]
	Groups    []VoxelGroup `json:"groups"`    // 按颜色分组的方块
	Truncated bool         `json:"truncated"` // 超过上限被截断
	MaxBlocks int          `json:"maxBlocks"` // 生效的渲染上限
}

// VoxelGroup 同一颜色的方块组
type VoxelGroup struct {
	Color     string     `json:"color"`     // 十六进制颜色 "#7F7F7F"
	Positions [][3]int16 `json:"positions"` // [[x,y,z], ...]
}
