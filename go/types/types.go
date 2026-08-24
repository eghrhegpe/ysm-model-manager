package types

import "fmt"

// WindowState 窗口位置
type WindowState struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// AuthorInfo 作者信息（含模型计数）
type AuthorInfo struct {
	Name       string `json:"Name"`
	Count      int    `json:"Count"`
	SampleFile string `json:"SampleFile,omitempty"` // 该作者第一个模型文件路径（用于提取头像）
}

// ModelEntry 模型文件条目
type ModelEntry struct {
	Name    string `json:"Name"`
	Size    int64  `json:"Size"`
	Path    string `json:"Path"`
	Ext     string `json:"Ext"`
	Hash    string `json:"Hash"`    // SHA256
	ModTime int64  `json:"ModTime"` // Unix 时间戳（毫秒）
	HasTags bool   `json:"HasTags"` // 是否有标签
	// Type 资源类型 ID（如 "ysm"/"EntityPlayer"/"resourcepack"）。
	// ScanModelEntriesFiltered 按 rtype 过滤时自动填充；未指定 rtype 时为 ""。
	// 前端据此展示类型图标/标签，无需从 Path 反推类型。
	Type string `json:"type,omitempty"`
	// SubDir MMD 用途子目录分组（ADR-096）：文件位于 mmdSubdirNames 命中的
	// 用途子目录内时填子目录名（如 SceneModel/CustomAnim）；根下或其他类型恒为 ""。
	// 前端据此按子目录分组展示，无需从 Path 推导。
	SubDir string `json:"subdir,omitempty"`
}

// ImportFileItem 文件夹型模型整组导入的文件项（ADR-038 关联：解压目录整组导入）
type ImportFileItem struct {
	RelPath string `json:"RelPath"` // 相对文件夹根的路径（正斜杠，保留子目录层级）
	Base64  string `json:"Base64"`  // 文件内容
}

// VersionInstance 整合包信息
type VersionInstance struct {
	Name       string `json:"Name"`
	VersionDir string `json:"VersionDir"`
	CustomDir  string `json:"CustomDir"`
	Exists     bool   `json:"Exists"`
}

// LauncherInfo describes a detected HMCL/PCL (or generic Minecraft) layout.
// It is read-only discovery data; the manager never edits launcher metadata.
type LauncherInfo struct {
	Type      string             `json:"type"`
	Name      string             `json:"name"`
	RootDir   string             `json:"root_dir"`
	Instances []LauncherInstance `json:"instances"`
}

// LauncherInstance is a game/version directory and its YSM configuration path.
type LauncherInstance struct {
	Name                string   `json:"name"`
	Version             string   `json:"version"`
	Path                string   `json:"path"`
	YSMCustomDir        string   `json:"ysm_custom_dir"`
	YSMCustomExists     bool     `json:"ysm_custom_exists"`
	YSMConfigFiles      []string `json:"ysm_config_files"`
	LauncherConfigFiles []string `json:"launcher_config_files"`
}

// SearchResult 模型搜索结果
type SearchResult struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	BoneCount int    `json:"boneCount"`
	CubeCount int    `json:"cubeCount"`
	TexWidth  int    `json:"texWidth"`
	TexHeight int    `json:"texHeight"`
	HasError  bool   `json:"hasError"`
	Type      string `json:"type,omitempty"` // 资源类型 ID（跨类型搜索时携带）
}

// ImportLog 应用操作日志（导入、扫描、下载、同步等）
type ImportLog struct {
	ModelName  string   `json:"ModelName"`
	SourcePath string   `json:"SourcePath"`
	TargetDir  string   `json:"TargetDir"`
	FileSize   int64    `json:"FileSize"`
	Status     string   `json:"Status"`
	ErrorMsg   string   `json:"ErrorMsg,omitempty"`
	Timestamp  int64    `json:"Timestamp"`
	Operation  string   `json:"Operation,omitempty"` // import / scan / download / sync / rename / delete
	Level      LogLevel `json:"Level,omitempty"`     // debug/info/warn/error/fatal
}

// RuntimeLog 运行时日志（watcher/sync 等标准库 log 输出，诊断页可见）
type RuntimeLog struct {
	Message   string   `json:"Message"`
	Timestamp int64    `json:"Timestamp"`
	Level     LogLevel `json:"Level,omitempty"` // 默认 info（标准库 log 无级别）
}

// LinkType 链接类型
type LinkType string

const (
	LinkCopy    LinkType = "copy"
	LinkHard    LinkType = "hardlink"
	LinkSym     LinkType = "symlink"
	LinkUnknown LinkType = "unknown"
)

// ErrorCode 结构化错误码（ADR-051 落地：替代裸字符串拼接，消除前后端双份分类表漂移）。
// 所有错误构造点统一使用此处的常量，前端 friendlyError 消费 Code 字段做 i18n 映射。
type ErrorCode string

const (
	ErrFileExists      ErrorCode = "FILE_EXISTS"
	ErrAlreadyExists   ErrorCode = "ALREADY_EXISTS"
	ErrInvalidParam    ErrorCode = "INVALID_PARAM"
	ErrInvalidPath     ErrorCode = "INVALID_PATH"
	ErrFileNameInvalid ErrorCode = "FILENAME_INVALID"
	ErrUnsupportedType ErrorCode = "FILE_TYPE_UNSUPPORTED"
	ErrUnsupportedFmt  ErrorCode = "UNSUPPORTED_FORMAT"
	ErrDecodeFailed    ErrorCode = "DECODE_FAILED"
	ErrFileTooLarge    ErrorCode = "FILE_TOO_LARGE"
	ErrFileEmpty       ErrorCode = "FILE_EMPTY"
	ErrMkdirFailed     ErrorCode = "MKDIR_FAILED"
	ErrWriteFailed     ErrorCode = "WRITE_FAILED"
	ErrIO              ErrorCode = "IO_ERROR"
	ErrLinkFailed      ErrorCode = "LINK_FAILED"
	ErrUnknown         ErrorCode = "UNKNOWN"
)

// LogLevel 日志级别（诊断页按 Level 过滤；向后兼容——旧日志无此字段时前端按 Status 兜底）
type LogLevel string

const (
	LevelDebug LogLevel = "debug"
	LevelInfo  LogLevel = "info"
	LevelWarn  LogLevel = "warn"
	LevelError LogLevel = "error"
	LevelFatal LogLevel = "fatal"
)

// StatusToLevel 将 ImportLog 的 Status 字符串映射到日志级别。
// 调用方（go/logs 跨包）在 addOp 时传入，保证新旧日志字段一致。
func StatusToLevel(status string) LogLevel {
	switch status {
	case "success":
		return LevelInfo
	case "failed":
		return LevelError
	case "warn":
		return LevelWarn
	case "skipped":
		return LevelDebug
	default:
		return LevelInfo
	}
}

// CustomFileInfo custom 目录下的文件信息
type CustomFileInfo struct {
	Name     string   `json:"Name"`
	LinkType LinkType `json:"LinkType"`
}

// InstanceStatus 整合包状态
type InstanceStatus struct {
	Name      string           `json:"Name"`
	CustomDir string           `json:"CustomDir"`
	Status    string           `json:"Status"`  // "complete" | "missing" | "extra"
	Synced    int              `json:"Synced"`  // 已同步文件数（Files 长度，前端排序用）
	Missing   []string         `json:"Missing"` // 完整路径
	Extra     []string         `json:"Extra"`   // 文件名（供展示）
	Disabled  []string         `json:"Disabled"`
	HasYSM    bool             `json:"HasYSM"`
	HasMod    bool             `json:"HasMod"` // 当前资源类型对应的 mod 是否存在
	Files     []CustomFileInfo `json:"Files"`  // custom 目录下每个文件的链接类型
}

type AppError struct {
	Code       ErrorCode `json:"Code"`
	Operation  string    `json:"Operation"`
	SourcePath string    `json:"SourcePath,omitempty"`
	TargetPath string    `json:"TargetPath,omitempty"`
	Reason     string    `json:"Reason"`
	Suggestion string    `json:"Suggestion"`
	// cause 底层错误链（ADR-051：不序列化，仅供 errors.Is/As 穿透——
	// 原实现把底层 errno 压成字符串，errors.Is(err, fs.ErrPermission) 从此失效）
	cause error
}

// WithCause 附加底层错误，使 errors.Is/As 可以穿透 AppError 判定 errno/哨兵。
func (e AppError) WithCause(cause error) AppError {
	e.cause = cause
	return e
}

// Unwrap 暴露底层错误链（ADR-051：配合 WithCause 恢复结构化错误判定能力）
func (e AppError) Unwrap() error { return e.cause }

func (e AppError) Error() string {
	msg := fmt.Sprintf("问题描述：%s 操作：%s", e.Reason, e.Operation)
	if e.SourcePath != "" {
		msg += fmt.Sprintf(" 源路径：%s", e.SourcePath)
	}
	if e.TargetPath != "" {
		msg += fmt.Sprintf(" 目标路径：%s", e.TargetPath)
	}
	msg += fmt.Sprintf(" 解决建议：%s", e.Suggestion)
	return msg
}

// ResourceSyncResult 资源同步结果
type ResourceSyncResult struct {
	Synced  []string `json:"synced"`
	Missing []string `json:"missing"` // 全局有但整合包没有（可推送）
	Extra   []string `json:"extra"`   // 整合包有但全局没有（可拉取）
}

// SyncStatus 资源文件同步状态
type SyncStatus string

const (
	SyncStatusSynced   SyncStatus = "synced"
	SyncStatusMissing  SyncStatus = "missing"
	SyncStatusOptional SyncStatus = "optional"
	SyncStatusDisabled SyncStatus = "disabled"
	SyncStatusLegacy   SyncStatus = "legacy"
)

// ResourceSyncItem 单个资源文件的同步状态
type ResourceSyncItem struct {
	Path   string     `json:"path"`
	Name   string     `json:"name"`
	Status SyncStatus `json:"status"`
	Type   string     `json:"type"`
	Icon   string     `json:"icon"`
	Size   int64      `json:"size"`
	// SubDir MMD 子目录分组（ADR-096：dirLevel 同步单元若位于
	// mmdSubdirNames 命中的用途子目录内，填子目录名；根下为 ""=EntityPlayer）
	SubDir string `json:"subdir,omitempty"`
}
