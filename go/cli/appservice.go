// ===== AppService：CLI 消费方接口（ADR-145）=====
//
// 依赖倒置：go/cli 不再 import internal/app（Wails GUI 层），改为持有本接口。
// internal/app.App 凭 Go 结构化接口隐式满足本接口（无需显式声明，签名匹配即可）。
// 方法集 = CLI 实际调用的 46 个 App 方法（45 个经 CmdContext.App + DispatchCommand
// 的 SetSessionFilesRoot）；签名与 internal/app 逐字一致（DTO 已下沉 go/types）。
package cli

import (
	"ysm-model-manager/go/types"
	"ysm-model-manager/go/ysm"
)

// AppService CLI 命令可用的后端服务能力（消费方定义的最小接口）。
// 新增 CLI 命令需要新的后端方法时，先在 internal/app 实现，再在此接口补充签名。
type AppService interface {
	// ── 模型扫描 / 搜索 / 分析 ──
	ScanModelEntries(dir string) []types.ModelEntry
	SearchModels(filesRoot string, keyword string, minBones, maxBones, minCubes, maxCubes, minTex, maxTex int) []types.SearchResult
	ListModelAuthors() []types.AuthorInfo
	ScanLocalAuthors(rtype string) []types.WorkshopCreator
	AnalyzeYSMModel(path string) ysm.YSMModelMeta
	AnalyzeBedrockModel(modelPath string) types.BedrockModel
	ExportModelStructureJSON(modelPath string) string
	ReadFileBytes(path string) []byte
	ReadFileBytesBatch(paths []string) map[string][]byte

	// ── 配置 ──
	LoadAppConfig() types.AppConfig
	GetConfigPath() string
	GetMinecraftPaths() []string
	SetDownloadMirror(mirror string) error
	SetSessionFilesRoot(filesRoot string)

	// ── 文件操作 ──
	RenameDir(oldPath, newName string) error
	RenameFile(oldPath, newName string) error
	MoveModelFile(src, dstDir string) error
	CopyModelFile(src, dstDir string) error
	ToggleModelEnable(path string) (bool, error)

	// ── 安装 / 链接 ──
	InstallModelFile(src, mcRoot string) (string, error)
	InstallModelTo(src, customDir string) error
	SetLinkMode(mode string) error
	GetLinkMode() string

	// ── 整合包实例 ──
	ListVersionInstances(mcRoot string) []types.VersionInstance
	SyncResources(rtype, instanceName string) (types.ResourceSyncResult, error)
	PushResourceToInstance(rtype, instanceName string) (int, error)
	PullResourceFromInstance(rtype, instanceName string) (int, error)

	// ── 回收站 ──
	ListRecycleBin(recyclePath string) []types.ModelEntry
	RestoreFromRecycle(src, filesRoot string) error
	EmptyRecycleBin(src string) (int, error)

	// ── 下载队列 ──
	EnqueueDownloads(tasks []types.DownloadTask) error
	CancelQueue()
	QueueStatus() types.QueueStatusInfo
	DownloadFromGitHub(rawURL string, saveDir string) (string, error)

	// ── 标签 ──
	AllTags() ([]string, error)
	GetModelTags(modelPath string) ([]string, error)
	SetModelTags(modelPath string, tags []string) error
	ListByTag(tag string) ([]string, error)

	// ── 创作者 / 工坊 ──
	CachedCreatorAvatar(authorName string) (string, error)
	BatchExtractCreatorAvatars() (map[string]string, error)
	CacheModelAvatars(modelPath string)
	DefaultWorkshopSites() []types.WorkshopSite
	LoadWorkshopCreators() []types.WorkshopCreator
	ValidateWorkshopSites() (int, error)
	ExportWorkshopCreatorsJSONFile() (string, error)
	BackupWorkshopCreators() (string, error)
}
