package types

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// ResourceTypeRegistry 资源类型注册表
type ResourceTypeRegistry struct {
	ResourceTypes []ResourceType `json:"resourceTypes"`
}

// ResourceType 一种受支持的资源类型定义
type ResourceType struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Icon           string   `json:"icon"`
	Extensions     []string `json:"extensions"`
	StorageSubDir  string   `json:"storageSubDir"`
	InstallDir     string   `json:"installDir"`
	ScanDir        string   `json:"scanDir"`
	InstanceLevel  bool     `json:"instanceLevel"`
	Preview        string   `json:"preview"`        // "3d" / "thumbnail" / "none"
	Detector       string   `json:"detector"`       // "ysm" / "mcmeta" / ""
	ConfigField    string   `json:"configField"`    // AppConfig 字段名（如 YsmRoot）
	ConfigFallback string   `json:"configFallback"` // AppConfig 回退字段名（如 VrcRoot→MmdRoot）
}

var (
	registryMu   sync.Mutex
	registry     *ResourceTypeRegistry
	registryPath = "resource_types.json" // 可被 tests 替换
)

// SetRegistryPath 设置注册表文件路径（仅测试用）
// 加锁保护：并发调用 LoadRegistry + SetRegistryPath 触发数据竞争（审计 P1 #2）。
func SetRegistryPath(path string) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registryPath = path
	registry = nil
}

// LoadRegistry 加载资源类型注册表
// 优先读取外部 JSON 文件（可通过 SetRegistryPath 自定义路径），
// 文件不存在或读取失败时回退到编译时嵌入的默认数据。
// 加锁替代 sync.Once：避免 SetRegistryPath 重置 once 与 Do 之间的竞争。
func LoadRegistry() *ResourceTypeRegistry {
	registryMu.Lock()
	defer registryMu.Unlock()
	if registry != nil {
		return registry
	}
	data := loadRegistryBytes()
	var reg ResourceTypeRegistry
	if err := json.Unmarshal(data, &reg); err != nil {
		// P2 修复：解析失败回退嵌入基线而不是缓存空注册表——
		// 原实现 `registry = &ResourceTypeRegistry{}` 会让空注册表
		// 在进程生命周期内永久缓存（无重试、不回退），所有扩展名查询静默失效
		log.Printf("[types] 解析注册表失败，回退嵌入基线: %v", err)
		if err := json.Unmarshal(embeddedRegistryJSON, &reg); err != nil {
			// 嵌入基线本身损坏（生成文件被破坏）时仍不 panic，但标记空表避免二次解析
			log.Printf("[types] 嵌入基线解析也失败: %v", err)
			registry = &ResourceTypeRegistry{}
			return registry
		}
	}
	registry = &reg
	return registry
}

// loadRegistryBytes 按优先级解析注册表字节：
//  1. 显式路径（SetRegistryPath 设置的测试/自定义绝对路径）；
//  2. exe 同级 / 上级目录（部署 / updater 热更位），彻底摆脱对 cwd 的依赖；
//  3. 编译期嵌入的基线 embeddedRegistryJSON。
//
// 默认 registryPath 为相对名 "resource_types.json" 时视为未显式设置，跳过 cwd 裸读。
func loadRegistryBytes() []byte {
	if registryPath != "" && registryPath != "resource_types.json" {
		if b, err := os.ReadFile(registryPath); err == nil {
			return b
		}
	}
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		for _, cand := range []string{
			filepath.Join(exeDir, "resource_types.json"),
			filepath.Join(exeDir, "..", "resource_types.json"),
		} {
			if b, err := os.ReadFile(cand); err == nil {
				return b
			}
		}
	}
	return embeddedRegistryJSON
}

// RegistryType 按 id 查找资源类型，不存在时返回 nil
func RegistryType(id string) *ResourceType {
	reg := LoadRegistry()
	for i := range reg.ResourceTypes {
		if reg.ResourceTypes[i].ID == id {
			return &reg.ResourceTypes[i]
		}
	}
	return nil
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
