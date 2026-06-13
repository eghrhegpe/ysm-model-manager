package types

// AppConfig 应用持久化配置
type AppConfig struct {
	RepoRoot         string `json:"repoRoot"`
	ResourcepackRoot string `json:"resourcepackRoot"`
	ShaderpackRoot   string `json:"shaderpackRoot"`
	SchematicRoot    string `json:"schematicRoot"`
	MmdRoot          string `json:"mmdRoot"`
	VrcRoot          string `json:"vrcRoot"`
	McRoot           string `json:"mcRoot"`
	LinkMode         string `json:"linkMode"`
	Theme            string `json:"theme"`
	Mirror           string `json:"mirror"`
	// 窗口状态（合并到主配置，避免 window_state.json 散落）
	WinX    int `json:"winX"`
	WinY    int `json:"winY"`
	WinW    int `json:"winW"`
	WinH    int `json:"winH"`
	WinRelX int `json:"winRelX"`
	WinRelY int `json:"winRelY"`
	WinScrW int `json:"winScrW"`
	WinScrH int `json:"winScrH"`
}

// PackInfo 模型整合包信息（ysm-pack.json）
type PackInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ImageBase64 string `json:"imageBase64,omitempty"` // ysm-pack.png 的 base64 data URI
}

// WorkshopPresetSearch 预设搜索词
type WorkshopPresetSearch struct {
	Label string `json:"label"`
	Q     string `json:"q"`
}

// WorkshopSite 创意工坊站点配置
type WorkshopSite struct {
	ID             string                 `json:"id"`
	Icon           string                 `json:"icon"`
	Label          string                 `json:"label"`
	URL            string                 `json:"url"`
	Desc           string                 `json:"desc"`
	Group          string                 `json:"group"`
	SearchURL      string                 `json:"searchUrl,omitempty"`
	PresetSearches []WorkshopPresetSearch `json:"presetSearches,omitempty"`
}

// WorkshopCreator 创作者条目
// Type 是平台标签，分号分隔，如 "bilibili;afdian"
type WorkshopCreator struct {
	Name string `json:"name"`
	Desc string `json:"desc"`
	Type string `json:"type,omitempty"`
}
