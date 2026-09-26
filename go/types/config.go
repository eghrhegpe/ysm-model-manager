package types

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
	ThemeAuto      string `json:"themeAuto"` // 主题自动模式（off/system/time），空=未设置；P4 修复 theme-auto 落盘（localStorage 清理后可回退）
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

// DedupConfig 去重功能配置。
// 2026-09 对接锐评①收敛：Go 侧仅消费哈希策略（dedup.NewHashAlgorithm，值域契约锁
// go/dedup/strategy_test.go TestNewHashAlgorithm_FrontendTokens）。保留策略/优先路径
// 是前端 dedup-policy 的 UI 决策，原 KeepPolicy/PriorityPath 搭车字段已删——
// 结构体只描述 Go 真正消费的输入，杜绝「字段在 Go 零读者」的假共享。
type DedupConfig struct {
	// Strategy 去重策略: "deep_hash" (SHA256，精确但慢), "quick_hash" (MD5，较快),
	// "name_size" (文件名+大小，最快但不精确)；空串/历史 token "hash" 回退 deep_hash
	Strategy string `json:"strategy"`
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

// PackMetaView ReadPackMeta 的返回视图（pack.mcmeta 摘要，ADR-143 P1 struct 化）
type PackMetaView struct {
	PackFormat       int    `json:"pack_format"`
	Description      string `json:"description"`
	Thumbnail        string `json:"thumbnail"`
	SupportedFormats []int  `json:"supported_formats,omitempty"`
	MinFormat        []int  `json:"min_format,omitempty"`
	MaxFormat        []int  `json:"max_format,omitempty"`
}

// ShaderpackLang ReadShaderpackLang 的返回（光影包 lang/en_US.lang 摘要）
type ShaderpackLang struct {
	Name    string            `json:"name"`
	Entries map[string]string `json:"entries"`
}

// SyncScanDirs GetSyncScanDirs 的返回（同步页展示实际扫描目录对）
type SyncScanDirs struct {
	Global        string            `json:"global"`
	Instance      string            `json:"instance"`
	WarningCode   string            `json:"warningCode"`
	WarningParams map[string]string `json:"warningParams"`
}

// PackModelDetail ListPackModelsDetail 单条模型（路径 + 立方体数）
type PackModelDetail struct {
	Path  string `json:"path"`
	Cubes int    `json:"cubes"`
}

// PackModelDetailList ListPackModelsDetail 的返回（封顶 + total 全量）
type PackModelDetailList struct {
	Models []PackModelDetail `json:"models"`
	Total  int               `json:"total"`
}
