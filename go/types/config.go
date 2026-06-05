package types

// AppConfig 应用持久化配置
type AppConfig struct {
	RepoRoot string `json:"repoRoot"`
	McRoot   string `json:"mcRoot"`
	LinkMode string `json:"linkMode"`
	Theme    string `json:"theme"`
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
