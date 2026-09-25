package types

import (
	"errors"
	"fmt"
)

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
	// Banned 禁用态（文件级 .disabled/.ban 后缀或父目录级禁用，ADR-038 D3.7）。
	// ScanModelEntriesFiltered 填充；前端树加载据此标记，替代逐文件
	// IsFileBanned 桥调用（2000 模型 = 2000 次 IPC 的 N+1）。
	Banned bool `json:"banned,omitempty"`
}

// ImportFileItem 文件夹型模型整组导入的文件项（ADR-038 关联：解压目录整组导入）
type ImportFileItem struct {
	RelPath string `json:"RelPath"` // 相对文件夹根的路径（正斜杠，保留子目录层级）
	Base64  string `json:"Base64"`  // 文件内容
}

// QueueStatusInfo 下载队列状态（替代多返回值，Wails 自动映射为 JS object）。
// 归属（ADR-145）：跨包契约 DTO 下沉至 types——go/cli 定义 AppService 接口时
// 需引用本类型，若不随 DTO 下沉则 cli 得反向 import internal/app（死结）。
type QueueStatusInfo struct {
	Remaining int  `json:"remaining"`
	Running   bool `json:"running"`
}

// DownloadTask 下载队列任务。
// 归属（ADR-145）：同上，跨包契约 DTO 下沉至 types（JSON tag 原样保留 → bindings 零漂移）。
type DownloadTask struct {
	URL     string `json:"url"`
	SaveDir string `json:"saveDir"`
	Name    string `json:"name"`
	Size    int64  `json:"size"`
}

// VersionInstance 整合包信息
type VersionInstance struct {
	Name       string `json:"Name"`
	VersionDir string `json:"VersionDir"`
	CustomDir  string `json:"CustomDir"`
	Exists     bool   `json:"Exists"`
}

// LauncherInstance is a Minecraft instance discovered from a launcher directory.
// GameRoot is the shared .minecraft directory; GameDir is the actual run directory
// after applying the launcher's per-instance isolation setting.
type LauncherInstance struct {
	Launcher    string `json:"launcher"`
	Name        string `json:"name"`
	GameVersion string `json:"gameVersion"`
	GameRoot    string `json:"gameRoot"`
	GameDir     string `json:"gameDir"`
	CustomDir   string `json:"customDir"`
	Exists      bool   `json:"exists"`
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
//
// Tag / Level 由捕获层从 Message 推断（ADR-289）：标准库 log 无级别也无结构，
// 但调用点已自发携带 `[tag]` 前缀与「失败/警告」等词——捕获层读出来，前端便能
// 分级筛选与按 tag 检索，而无需改动 250+ 个调用点。
type RuntimeLog struct {
	Message   string   `json:"Message"`
	Timestamp int64    `json:"Timestamp"`
	Level     LogLevel `json:"Level,omitempty"` // 推断级别（标准库 log 无真实级别；无把握时为 info）
	Tag       string   `json:"Tag,omitempty"`   // `[tag]` 前缀提取（无前缀为空串，不丢弃消息）
}

// LinkType 链接类型
type LinkType string

const (
	LinkCopy    LinkType = "copy"
	LinkHard    LinkType = "hardlink"
	LinkSym     LinkType = "symlink"
	LinkUnknown LinkType = "unknown"
)

// ValidLinkMode 链接模式白名单（全仓唯一值域事实源，ADR-296 D6）：
// linkMode 配置值（AppConfig.LinkMode / SetLinkMode 参 / CLI --mode）与 LinkType
// 前三常量同串。install 域与 go/cli 双轨共用本谓词，消除两份内联值域表的漂移
// ——依赖方向合法：go/cli 禁止 import internal/app（ADR-145），但双轨都可 import types。
// LinkUnknown 是检测返回值、不是可配置模式，故 switch 恰取三值。
func ValidLinkMode(mode string) bool {
	switch LinkType(mode) {
	case LinkCopy, LinkHard, LinkSym:
		return true
	}
	return false
}

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

// ErrMcRootNotSet 哨兵错误：游戏根目录未配置（替代裸字符串 "请先设置游戏根目录"）。
// requireMcRoot 返回此哨兵，调用方用 errors.Is 判定，测试断言不再依赖字符串匹配。
var ErrMcRootNotSet = errors.New("请先设置游戏根目录")

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
//
// 计数口径（ADR-310，2026-09 收敛）：三处计数均为**面板链单元级**
// （go/instance.BuildInstanceStatusCounts 折面板 BuildSyncItems 产物）——
// dirLevel 类型 1 个模型夹 = 1 个单元，fileLevel 类型 1 个文件 = 1 个单元；
// diverged（内容分叉）按面板 store.tabStatus 折叠进 MissingCount（红=待推送）。
// 三份清单粒度**刻意不同**：Missing 是仓库侧**文件级绝对路径**
// （一键安装 features/sync/sync.ts runDownloadMissing 逐条 Install 的契约，
//
//	整夹缺失会展开成夹内文件；故长度 ≠ MissingCount，计数只认 MissingCount）；
//
// Extra/Disabled 是实例侧单元路径（前端仅取长度与展示）。
type InstanceStatus struct {
	Name         string           `json:"Name"`
	CustomDir    string           `json:"CustomDir"`
	Status       string           `json:"Status"`       // "complete" | "missing" | "extra"（红优先）
	Synced       int              `json:"Synced"`       // 已同步单元数（前端排序用）
	MissingCount int              `json:"MissingCount"` // 待推送单元数 = missing + diverged（源见上）
	Missing      []string         `json:"Missing"`      // 仓库侧文件级绝对路径（一键安装）
	Extra        []string         `json:"Extra"`        // 实例侧独有单元路径
	Disabled     []string         `json:"Disabled"`     // 实例侧禁用（.ban/.disabled）单元路径
	HasMod       bool             `json:"HasMod"`       // 当前资源类型对应的 mod 是否存在
	Files        []CustomFileInfo `json:"Files"`        // 已废弃：旧链填充的链接类型清单，前端零消费者（ADR-296 实证），不再填
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
	// SyncStatusDiverged 文件夹级聚合状态：两侧同名文件夹存在内容级差异
	// 子文件有 missing/optional/disabled 时，父文件夹标记为 diverged
	// 前端渲染：继承 missing 的可操作属性（⬇️图标 + 推送按钮）
	SyncStatusDiverged SyncStatus = "diverged"
)

// ResourceSyncItem 单个资源文件的同步状态
type ResourceSyncItem struct {
	Path   string     `json:"path"`
	Name   string     `json:"name"`
	Status SyncStatus `json:"status"`
	Type   string     `json:"type"`
	Icon   string     `json:"icon"`
	Size   int64      `json:"size"`
	// IsDir 标记该条目是文件夹（true）还是文件（false）
	// 前端据此分流渲染：文件夹 → sm-dir（可展开），文件 → sm-item（扁平）
	IsDir bool `json:"isDir"`
	// SubDir MMD 子目录分组（ADR-096：dirLevel 同步单元若位于
	// mmdSubdirNames 命中的用途子目录内，填子目录名；根下为 ""=EntityPlayer）
	SubDir string `json:"subdir,omitempty"`
	// Children 子条目列表（文件夹级同步单元的内部文件状态）
	// 当同步单元是文件夹且存在内容级差异时，填充此字段
	// 用于展示文件夹内部每个文件的真实同步状态
	Children []ResourceSyncItem `json:"children,omitempty"`
}
