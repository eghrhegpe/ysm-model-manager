package types

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

// PackMeta 材质包信息（来自 pack.mcmeta）
type PackMeta struct {
	Pack struct {
		PackFormat  int    `json:"pack_format"`
		Description string `json:"description"`
	} `json:"pack"`
}
