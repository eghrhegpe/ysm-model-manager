package types

// SchemaVersion 是当前磁盘配置文件的迁移版本。
//
// 版本门控的由来：本仓配置迁移历史上反复踩"启发式判据失灵"——2936d7da6（白名单漏字段、
// 新增字段被零值覆盖）、8c858c54a（启动路径漏跑字段迁移）、3b87efdca（theme 缺省口径）
// 都是靠"字段是否为空/是否被拷贝"猜要不要迁移。版本号把「迁移是否要跑」从字段状态
// 换成显式数字，使每次结构性迁移一次到位、且未来版本可精确追溯（何时加的字段、
// 哪些文件需要它）。
const SchemaVersion = 1

// AppConfig 应用持久化配置
// 独立路径下沉为 CustomRoots map（ADR-095）：以资源类型 id 为 key（如 "ysm"→"D:/.../ysm"），
// 取代过去 YsmRoot/ResourcepackRoot/... 7 个独立字段，避免资源类型膨胀时结构体硬编码。
// configField 语义：存储的是资源类型 id（非结构体字段名），具体路由逻辑在 internal/app/resource_bindings.go
// 统一查 CustomRoots map，检索 "customRoots" 即可抓到全貌。
type AppConfig struct {
	// SchemaVersion 磁盘配置文件的迁移版本（缺失/0 = 无版本的遗留文件）。
	// 结构性迁移（migrateLegacyConfigFields）按本字段门控：文件版本 < SchemaVersion
	// 才跑迁移并盖当前版本章；≥ 当前版本不再重跑启发式——历史多次配置迁移 bug
	// 同根于「无版本 + 字段空不空」的启发式判据（见 internal/app 的 applyConfigMigrations）。
	// 字段放首位：版本是描述"这份文件怎么解释"的元数据，与业务字段分开读。
	SchemaVersion int `json:"schemaVersion,omitempty"`

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
	ScanCacheTTLMs          int  `json:"scanCacheTtlMs"`          // 扫描缓存 TTL 毫秒，0=默认 30s（scanner.scanCacheTTL）
	DownloadTimeoutSec      int  `json:"downloadTimeoutSec"`      // 下载超时秒，0=默认 300s（download.defaultTimeout）
	LogMaxEntries           int  `json:"logMaxEntries"`           // 日志条数上限，0=默认 500（logs.maxLogEntries）
	LogMaxFieldLen          int  `json:"logMaxFieldLen"`          // 日志单字段长度上限，0=默认 1024（logs.maxFieldLen）
	LogCorruptRetentionDays int  `json:"logCorruptRetentionDays"` // .corrupt 备份保留天数，0=默认 7（logs.corruptRetentionDays）
	PreviewReadLimitMB      int  `json:"previewReadLimitMb"`      // 预览/元数据整读上限 MB，0=默认 50（fileops.maxPreviewRead）
	UpdateCheckIntervalMs   int  `json:"updateCheckIntervalMs"`   // 版本检查间隔毫秒，0=默认 6h（前端 version-updater CHECK_INTERVAL）
	UpdateCheckTimeoutMs    int  `json:"updateCheckTimeoutMs"`    // 版本检查超时毫秒，0=默认 30s（前端 version-updater CHECK_TIMEOUT）
	HashIndexDisabled       bool `json:"hashIndexDisabled"`       // B1（ADR-348）：禁用持久哈希索引（scanner.HashIndexFor 快路径），true=全真算 SHA256 旧行为
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

// SettingsExport 设置导出文件（ADR-344-d1）。
//
// 把双轨设置（Go 磁盘 AppConfig + 前端 localStorage 偏好）收拢成单个 JSON，
// 供换机迁移。字段带版本与标识以便导入时校验——历史教训是把 JSON 当配置解析
// 前不做格式校验，用户选错文件即静默产生一份"看起来正常的"空配置。
type SettingsExport struct {
	Format        string            `json:"format"`        // 恒为 "ysm-settings-export"（导入门控）
	ExportVersion int               `json:"exportVersion"` // 导出格式版本（导入时拒绝更高版本）
	ExportedAt    string            `json:"exportedAt"`    // 导出时间 RFC3339（展示用）
	AppVersion    string            `json:"appVersion"`    // 导出时的程序版本（诊断用）
	AppConfig     AppConfig         `json:"appConfig"`     // Go 磁盘轨完整配置
	LocalStorage  map[string]string `json:"localStorage"`  // 浏览器本地存储偏好类键值（非缓存/会话/调试）
}

// ImportSettingsResult 设置导入结果（前端据此提示后续动作）。
type ImportSettingsResult struct {
	BackupPath string `json:"backupPath"` // 导入前对当前 ysm_config.json 的备份路径（空=无需备份）
	// 导出文件里 localStorage 的**原始条数**（未过滤）。浏览器偏好的实际写入由前端按
	// 台账白名单（tier=local-storage && authority=browser-authority）过滤后完成，
	// 前端提示「已应用 N 项」必须用过滤后的计数，不能用本字段——否则含未知键时虚高。
	LocalStorageKeyCount int `json:"localStorageKeyCount"`
}

// AppConfigPatch 应用配置的**部分更新**载荷（锐评 2026-10-15 P1 ③）。
//
// 为什么需要它：前端 `views/config-write.ts|writeAppConfig` 的 patch 语义原由两次
// IPC 拼成——先 `LoadAppConfig()` 取快照，再在 JS 侧拼出完整六元组交给
// `SaveAppConfig(...)`。两个 await 之间让出事件循环，期间另一写入口
// （SaveThresholds / SetDownloadMirror / 另一处 writeAppConfig）改的字段不在本次
// 快照里，会被整份回写静默冲掉（前端 read-then-write 的 TOCTOU）。本类型让整段
// 读-改-写发生在 Go 侧一次调用内，由 configWriteMu 串行化、锁内重读。
//
// 字段为何是 `*string` 而非 `string`：本仓既有 patch 入口（SaveAppConfig 的
// orDefault / SanitizeLinkMode）用「空串 = 未传」编码未设置，但这与「用户把某个
// 字段显式置空」不可区分——配置全是 string，无 bool 三态陷阱之外的先例可循，
// 指针是 Go 表达「未设置 vs 空值」的无歧义手段（见下方 nil 契约）。
//
// nil 契约（绑定层零值 = 零成本「什么都不改」）：
//   - nil  → 该字段取锁内重读的磁盘现值（未传）
//   - 非 nil → 写入该值；空串对 FilesRoot/Theme/ThemeAuto 等即「清空为默认值」，
//     对 McRoot 仍走 ValidateMinecraftDir、对 LinkMode 仍走 SanitizeLinkMode
//     （校验失败返回错误，不落盘）
//
// ⚠️ 键集刻意不含 rpRoot：它是 SaveAppConfig 的废弃入参（CustomRoots 已承载，
// 该参数在 Go 侧从不被读取）。新绑定不复制这个历史包袱。
type AppConfigPatch struct {
	FilesRoot *string `json:"filesRoot,omitempty"`
	McRoot    *string `json:"mcRoot,omitempty"`
	LinkMode  *string `json:"linkMode,omitempty"`
	Theme     *string `json:"theme,omitempty"`
	ThemeAuto *string `json:"themeAuto,omitempty"`
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

// LocalAuthor 本地扫描到的作者（从文件名的 [作者] 前缀提取）。
//
// 刻意与 WorkshopCreator 分开：后者的 Type 是**站点/平台 id**（分号分隔，如 "bilibili;afdian"），
// 而 RTypes 是**资源类型**（ysm/litematic/…）——两套词汇表零交集。历史上复用 WorkshopCreator
// 导致 rtype 被前端并入创作者的站点段（幻影平台徽章 + 本地独有作者隐形），见 ADR-337。
type LocalAuthor struct {
	Name   string   `json:"name"`
	Desc   string   `json:"desc"`
	RTypes []string `json:"rTypes,omitempty"`
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
