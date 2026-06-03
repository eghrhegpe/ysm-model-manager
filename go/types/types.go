package types

import "fmt"

// WindowState 窗口位置
type WindowState struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
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
	Missing   []string         `json:"Missing"`
	Extra     []string         `json:"Extra"`
	Disabled  []string         `json:"Disabled"`
	HasYSM    bool             `json:"HasYSM"`
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
    return fmt.Sprintf("问题描述：%s 操作：%s 解决建议：%s", e.Reason, e.Operation, e.Suggestion)
}
