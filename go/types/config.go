package types

import "encoding/json"

// AppConfig 应用持久化配置
// 独立路径下沉为 CustomRoots map（ADR-095）：以资源类型 id 为 key（如 "ysm"→"D:/.../ysm"），
// 取代过去 YsmRoot/ResourcepackRoot/... 7 个独立字段，避免资源类型膨胀时结构体硬编码。
// configField 语义：存储的是资源类型 id（非结构体字段名），具体路由逻辑在 internal/app/resource_bindings.go
// 统一查 CustomRoots map，检索 "customRoots" 即可抓到全貌。
type AppConfig struct {
	FilesRoot   string            `json:"filesRoot"`   // 统一文件存储根目录，各类型默认存 {filesRoot}/{subDir}/
	CustomRoots map[string]string `json:"customRoots"` // 资源类型 id → 自定义根路径（留空则回退 FilesRoot）

	// Deprecated: 以下字段为历史兼容保留，新代码请使用 FilesRoot/CustomRoots
	YsmRoot          string `json:"ysmRoot,omitempty"`
	ResourcepackRoot string `json:"resourcepackRoot,omitempty"`
	ShaderpackRoot   string `json:"shaderpackRoot,omitempty"`
	SchematicRoot    string `json:"schematicRoot,omitempty"`
	LitematicRoot    string `json:"litematicRoot,omitempty"`
	MmdRoot          string `json:"mmdRoot,omitempty"`
	VrcRoot          string `json:"vrcRoot,omitempty"`
	// 结束废弃字段

	McRoot         string `json:"mcRoot"`
	LinkMode       string `json:"linkMode"`
	Theme          string `json:"theme"`
	Mirror         string `json:"mirror"`
	VoxelMaxBlocks int    `json:"voxelMaxBlocks"` // 3D 体素渲染上限，0=使用默认 200000
	// 运行阈值（ADR-062 可配置化下沉：0=使用各包默认常量，行为零漂移）
	ScanCacheTTLMs          int `json:"scanCacheTtlMs"`          // 扫描缓存 TTL 毫秒，0=默认 30s（scanner.scanCacheTTL）
	DownloadTimeoutSec      int `json:"downloadTimeoutSec"`      // 下载超时秒，0=默认 300s（download.defaultTimeout）
	LogMaxEntries           int `json:"logMaxEntries"`           // 日志条数上限，0=默认 500（logs.maxLogEntries）
	LogMaxFieldLen          int `json:"logMaxFieldLen"`          // 日志单字段长度上限，0=默认 1024（logs.maxFieldLen）
	LogCorruptRetentionDays int `json:"logCorruptRetentionDays"` // .corrupt 备份保留天数，0=默认 7（logs.corruptRetentionDays）
	PreviewReadLimitMB      int `json:"previewReadLimitMb"`      // 预览/元数据整读上限 MB，0=默认 50（fileops.maxPreviewRead）
	UpdateCheckIntervalMs   int `json:"updateCheckIntervalMs"`   // 版本检查间隔毫秒，0=默认 6h（前端 version-updater CHECK_INTERVAL）
	UpdateCheckTimeoutMs    int `json:"updateCheckTimeoutMs"`    // 版本检查超时毫秒，0=默认 30s（前端 version-updater CHECK_TIMEOUT）
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
	Role string `json:"role,omitempty"`
}

// DedupConfig 去重功能配置
type DedupConfig struct {
	// Strategy 去重策略: "hash" (深度哈希，精确但慢), "name_size" (文件名+大小，快速但不精确)
	Strategy string `json:"strategy"`
	// KeepPolicy 保留策略: "oldest" (最早修改), "newest" (最新修改), "path" (指定路径优先)
	KeepPolicy string `json:"keepPolicy"`
	// PriorityPath 当 KeepPolicy 为 "path" 时，优先保留的路径前缀
	PriorityPath string `json:"priorityPath"`
}

// SyncConfig 同步功能配置
type SyncConfig struct {
	// AutoSync 是否在启动时自动同步
	AutoSync bool `json:"autoSync"`
	// ConflictPolicy 冲突解决策略: "force_remote" (强制远端), "force_local" (强制本地), "prompt" (提示用户)
	ConflictPolicy string `json:"conflictPolicy"`
}

// SyncResolveResult ResolveConflicts 的返回结果
type SyncResolveResult struct {
	// Resolved 成功解决数
	Resolved int `json:"resolved"`
	// Failed 解决失败数
	Failed int `json:"failed"`
	// Manual 需人工介入数
	Manual int `json:"manual"`
}

// ParseDedupConfig 解析去重配置 JSON 字符串（绑定层 configStr 的统一入口）。
// raw 为空串 → 返回 nil,nil（未配置，消费端走默认行为）；非法 JSON → 返回错误。
// 提取为公共函数，避免 FindDuplicateFiles / CountDuplicates 等入口各自内联 json.Unmarshal
// 造成解析语义漂移。
func ParseDedupConfig(raw string) (*DedupConfig, error) {
	if raw == "" {
		return nil, nil
	}
	var cfg DedupConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
