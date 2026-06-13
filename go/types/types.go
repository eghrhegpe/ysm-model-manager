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
	Name  string `json:"Name"`
	Count int    `json:"Count"`
}

// ModelEntry 模型文件条目
type ModelEntry struct {
	Name    string `json:"Name"`
	Size    int64  `json:"Size"`
	Path    string `json:"Path"`
	Ext     string `json:"Ext"`
	Hash    string `json:"Hash"`    // SHA256
	ModTime int64  `json:"ModTime"` // Unix 时间戳（毫秒）
}

// VersionInstance 整合包信息
type VersionInstance struct {
	Name       string `json:"Name"`
	VersionDir string `json:"VersionDir"`
	CustomDir  string `json:"CustomDir"`
	Exists     bool   `json:"Exists"`
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
}

// ImportLog 导入日志
type ImportLog struct {
	ModelName  string `json:"ModelName"`
	SourcePath string `json:"SourcePath"`
	TargetDir  string `json:"TargetDir"`
	FileSize   int64  `json:"FileSize"`
	Status     string `json:"Status"`
	ErrorMsg   string `json:"ErrorMsg,omitempty"`
	Timestamp  int64  `json:"Timestamp"`
}

// LinkType 链接类型
type LinkType string

const (
	LinkCopy    LinkType = "copy"
	LinkHard    LinkType = "hardlink"
	LinkSym     LinkType = "symlink"
	LinkUnknown LinkType = "unknown"
)

// CustomFileInfo custom 目录下的文件信息
type CustomFileInfo struct {
	Name     string   `json:"Name"`
	LinkType LinkType `json:"LinkType"`
}

// InstanceStatus 整合包状态
type InstanceStatus struct {
	Name      string           `json:"Name"`
	CustomDir string           `json:"CustomDir"`
	Status    string           `json:"Status"`    // "complete" | "missing" | "extra"
	Synced    int              `json:"Synced"`    // 已同步文件数（Files 长度，前端排序用）
	Missing   []string         `json:"Missing"`   // 完整路径
	Extra     []string         `json:"Extra"`     // 文件名（供展示）
	Disabled  []string         `json:"Disabled"`
	HasYSM    bool             `json:"HasYSM"`
	HasMod    bool             `json:"HasMod"`    // 当前资源类型对应的 mod 是否存在
	Files     []CustomFileInfo `json:"Files"`     // custom 目录下每个文件的链接类型
}

type AppError struct {
    Code       string `json:"Code"`
    Operation  string `json:"Operation"`
    SourcePath string `json:"SourcePath,omitempty"`
    TargetPath string `json:"TargetPath,omitempty"`
    Reason     string `json:"Reason"`
    Suggestion string `json:"Suggestion"`
}

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
}
