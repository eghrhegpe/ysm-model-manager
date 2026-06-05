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
type WorkshopCreator struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Desc      string `json:"desc"`
	SearchURL string `json:"searchUrl,omitempty"`
}

// PlatformCreators 某个平台下的创作者列表
type PlatformCreators struct {
	Platform string            `json:"platform"`
	Creators []WorkshopCreator `json:"creators"`
}
