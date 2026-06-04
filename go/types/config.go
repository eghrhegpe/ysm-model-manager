package types

// AppConfig 应用持久化配置
type AppConfig struct {
	RepoRoot string `json:"repoRoot"`
	McRoot   string `json:"mcRoot"`
	LinkMode string `json:"linkMode"`
	Theme    string `json:"theme"`
}
