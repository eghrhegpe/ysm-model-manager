---
kind: wails-bindings
name: Wails Binding API 总览 internal/app
tier: architecture
category: go
source_files:
  - internal/app/app.go
  - internal/app/app_avatar.go
  - internal/app/app_config.go
  - internal/app/app_download.go
  - internal/app/app_files.go
  - internal/app/app_install.go
  - internal/app/app_model.go
  - internal/app/app_scan.go
  - internal/app/app_tags.go
  - internal/app/app_workshop.go
  - internal/app/resource_bindings.go
  - internal/app/wasm_embed.go
auto_fields:
  symbols_with_lines:
    - App
    - App.AllTags
    - App.AnalyzeBedrockModel
    - App.AnalyzeBedrockModelEntry
    - App.AnalyzeYSMModel
    - App.BackupWorkshopCreators
    - App.BatchExtractCreatorAvatars
    - App.Build3DSpecFromGeometryJSON
    - App.CachedCreatorAvatar
    - App.CacheModelAvatars
    - App.CancelQueue
    - App.CheckFileExists
    - App.CheckUpdate
    - App.ClearScanCache
    - App.CopyModelFile
    - App.CreateDir
    - App.CurrentVersion
    - App.DebugExtractCreatorAvatar
    - App.DefaultWorkshopSites
    - App.DeleteResourcePack
    - App.DetectResourceType
    - App.DoUpdate
    - App.DownloadFromGitHub
    - App.EnqueueDownloads
    - App.EnsureStorageDirs
    - App.ExportModelStructureJSON
    - App.ExportWorkshopCreatorsJSONFile
    - App.ExportWorkshopSitesCSV
    - App.ExportWorkshopSitesJSONFile
    - App.ExtractPreviewTexture
    - App.ExtractYSMHeader
    - App.ExtractYSMHeaderFromBase64
    - App.ExtractYsmSummary
    - App.FindDuplicateFiles
    - App.FindPreviewImage
    - App.GenerateRepoIndex
    - App.GetAllRepoRoots
    - App.GetAppVersion
    - App.GetConfigPath
    - App.GetDefaultRepoRoot
    - App.GetGlobalCustomDir
    - App.GetLitematicVoxelData
    - App.GetMinecraftPaths
    - App.GetModel3DSpec
    - App.GetModelTags
    - App.GetModelTexSizes
    - App.GetNbtVoxelData
    - App.GetPackInfo
    - App.GetRepoRoot
    - App.GetSchematicVoxelData
    - App.GetSubDirMap
    - App.GetWasmBinary
    - App.GetWindowPosition
    - App.GetYSMRepoRoot
    - App.ImportByType
    - App.ImportModelFolder
    - App.ImportModelFolderTo
    - App.ImportWorkshopSitesCSV
    - App.InstallResourceToInstance
    - App.InvalidateScanCache
    - App.IsFileBanned
    - App.IsResourcePackEnabled
    - App.ListAllFilePaths
    - App.ListByTag
    - App.ListFileNames
    - App.ListModelAuthors
    - App.ListVersionInstances
    - App.LoadAppConfig
    - App.LoadGitHubRepos
    - App.LoadResourceTypes
    - App.LoadWorkshopCreators
    - App.MergeWorkshopCreatorsFromJSON
    - App.MoveModelFile
    - App.OpenFolder
    - App.OpenInBrowser
    - App.OpenInstanceFolder
    - App.QueueStatus
    - App.ReadFileBytes
    - App.ReadFileBytesBatch
    - App.ReadFileBytesBatchWithMeta
    - App.ReadLitematicMeta
    - App.ReadNbtStructure
    - App.ReadPackMeta
    - App.ReadSchematic
    - App.ReadShaderpackLang
    - App.RemoveDir
    - App.RenameDir
    - App.RenameFile
    - App.ReplaceWorkshopCreatorsFromJSON
    - App.RepoHealthAudit
    - App.RepoHealthAuditAll
    - App.ResetResourceRoot
    - App.ResetWorkshopConfigs
    - App.RestartApplication
    - App.RevealInExplorer
    - App.SaveAppConfig
    - App.SavePreviewTempFile
    - App.SaveScreenshotFile
    - App.SaveThresholds
    - App.SaveWindowPosition
    - App.SaveWorkshopCreators
    - App.SaveWorkshopCreatorsBySite
    - App.SaveWorkshopPresetsBySite
    - App.SaveWorkshopSites
    - App.ScanLocalAuthors
    - App.ScanModelEntries
    - App.ScanModelEntriesFiltered
    - App.ScanModelEntriesWithLabel
    - App.SearchAllModels
    - App.SearchModels
    - App.SelectDirectory
    - App.SelectImportFile
    - App.SelectImportZip
    - App.ServiceShutdown
    - App.ServiceStartup
    - App.SetApp
    - App.SetDownloadMirror
    - App.SetMainWindow
    - App.SetModelTags
    - App.SetResourceRoot
    - App.SetSessionFilesRoot
    - App.SetVoxelMaxBlocks
    - App.ToggleEnable
    - App.ToggleModelEnable
    - App.ToggleResourcePack
    - App.ValidateMinecraftDir
    - App.ValidateWorkshopSites
    - DownloadQueue
    - NewApp
    - NewDownloadQueue
    - ReadFileMeta
  quick_groups:
    - 后端桥接与数据存储
  quick_intents:
    - API 总览、Binding 有哪些方法、App 方法签名
    - GetAppVersion / ScanModelEntries / SearchModels
    - 调后端、app.ts 绑定、getApp
  quick_risk_lines:
    - 前端访问 Wails 后端必须经 getApp()，禁止直接调 window.go
  pitfalls:
    - 直调 window.go 方法 → Wails 启动时序不确定、方法未就绪时调用失败；必须经 getApp() 代理
    - 在 web 模式直调 wails binding → window.go 不存在；必须走 backend-web 的 browser-adapter
  use_when:
    - API
    - Binding
    - 调用后端
    - getApp
    - 方法签名
    - app.ts 绑定
  invariant_anchors:
    - internal/app/app.go|func (a *App) GetAppVersion
    - internal/app/app_scan.go|func (a *App) ScanModelEntries
    - internal/app/app_scan.go|func (a *App) SearchModels
    - internal/app/app_install_import.go|InstallModelTo
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - API 总览、Binding 有哪些方法、App 方法签名
  - GetAppVersion / ScanModelEntries / SearchModels
  - 调后端、app.ts 绑定、getApp
quick_risk_lines:
  - 前端访问 Wails 后端必须经 getApp()，禁止直接调 window.go
pitfalls:
  - 直调 window.go 方法 → Wails 启动时序不确定、方法未就绪时调用失败；必须经 getApp() 代理
  - 在 web 模式直调 wails binding → window.go 不存在；必须走 backend-web 的 browser-adapter

use_when:
  - API
  - Binding
  - 调用后端
  - getApp
  - 方法签名
  - app.ts 绑定
invariant_anchors:
  - internal/app/app.go|func (a *App) GetAppVersion
  - internal/app/app_scan.go|func (a *App) ScanModelEntries
  - internal/app/app_scan.go|func (a *App) SearchModels
  - internal/app/app_install_import.go|InstallModelTo
status: active
---

# Wails Binding API 总览 internal/app

## 概览

`internal/app/` 是 Go 端唯一的 Wails Binding 入口层：所有导出给前端的方法都定义在 `*App` 上，业务逻辑下沉到 `go/*` 包，本层只做参数转发与窗口/事件/对话框编排。前端统一经 `getApp()`（见 [wails_bridge](./wails-bridge.md) 卡）调用这些方法，禁止 `window.go.main.App` 直连。

本卡是全部可调用方法的索引（API 字典），与 Wails v3 自动生成的 TS 绑定 `frontend/bindings/ysm-model-manager/internal/app/app.ts` 逐一对应；类型定义见同目录 `models.ts` 及 `frontend/bindings/ysm-model-manager/go/types/models.ts`。`bindings/` 目录为生成物，禁止手改。**方法总数为动态值，以生成 `app.ts`（当前 156 个 bound 方法）为权威清单**——`SetApp`/`SetMainWindow` 现已进入生成 app.ts（前端业务仍不得调用）；`ServiceStartup`/`ServiceShutdown` 为服务生命周期钩子、不进入生成绑定。

## 核心职责

按文件分组（每个文件即一个领域分片）：

| 文件 | 职责 |
|------|------|
| `app.go` | App 结构与服务生命周期（ServiceStartup/Shutdown）、应用实例与主窗口注入、打开外部链接、版本号 |
| `app_config.go` | 配置读写、下载镜像、自动更新、窗口位置持久化、目录选择对话框、MC 目录探测（跨平台分支见 `app_config_other.go` / `app_config_windows.go`） |
| `app_scan.go` | 模型扫描与列表、高级搜索、骨骼结构导出、仓库索引生成、打开文件夹 |
| `app_files.go` | 文件/目录增删改移、预览图提取、启用/禁用切换、封禁名单 |
| `app_install.go` | 模型安装与导入、回收站、整合包同步（推/拉/重链/清空）、链接模式、导入日志 |
| `app_download.go` | 下载队列（入队/取消/状态）、GitHub 直连下载、纹理尺寸扫描 |
| `app_model.go` | YSM/基岩版模型解析、3D 规格生成、截图与临时文件保存 |
| `app_tags.go` | 模型标签的读写与反查 |
| `app_avatar.go` | 创作者头像缓存与批量提取 |
| `app_workshop.go` | 创作者工坊：站点/创作者/搜索预设的读写与 JSON/CSV 导入导出 |
| `plaza_window.go` | 广场窗口（ADR-050）：Go 反向代理 + 预热 WebView2 窗口的导航/缩放/前后进控制 |
| `resource_bindings.go` | 资源类型注册表读取、资源包/光影/蓝图（nbt/schematic/litematic）解析、查重、资源根目录设置 |
| `wasm_embed.go` | 向内嵌 WebView2 提供 YSMParser.wasm 字节 |

支撑文件（不定义 Binding）：`assets.go`（持有 main 注入的 embed 资产）、`bundled_data.go`（按 exe 同级→上级→嵌入基线读取随附数据）、`wasm_decoder.go`（WASM 解码胶水）、`cli.go`（`cli` 构建标签下的命令行子命令）。

## 对外 API（全量，按领域分组）

### 窗口与系统（app.go / app_config.go / app_scan.go / wasm_embed.go）

- `SetApp(app) → void` — 注入 Wails 应用实例（启动框架接线，前端业务勿调）
- `SetMainWindow(w) → void` — 注入主窗口实例，避免依赖 Window.Current()（启动框架接线，前端业务勿调）
- `GetAppVersion() → string` — 返回当前版本号
- `CurrentVersion() → string` — 返回当前版本号（与 GetAppVersion 并存）
- `RestartApplication() → void` — 重启应用（更新完成后调用）
- `OpenInBrowser(url) → void` — 系统默认浏览器打开链接（而非 WebView2 内嵌）
- `OpenFolder(dir) → void` — 在文件管理器中打开文件夹
- `OpenInstanceFolder(instDir, rtype, subdir) → void` — 按资源类型打开整合包子目录（路径由 `resolveInstDirTarget(instDir, rtype)` 用 `rtype.instanceDir` 推导）；`subdir` 参数保留为 Wails 绑定兼容、已不参与路由；目录不存在**不回退**（用户手动放错位置由他负责，见 app_scan.go OpenInstanceFolder 注释）
- `RevealInExplorer(path) → void` — 在资源管理器中定位并显示文件
- `SelectDirectory() → string` — 弹出目录选择对话框，返回所选路径
- `SaveWindowPosition(x, y, width, height) → void` — 持久化窗口位置与尺寸
- `GetWindowPosition() → types.WindowState` — 读取已持久化的窗口位置与尺寸
- `GetWasmBinary() → string` — 返回内嵌 YSMParser.wasm 字节（供前端 WebView2 使用）

### 配置与环境（app_config.go）

- `LoadAppConfig() → types.AppConfig` — 加载应用配置（FilesRoot/RpRoot/McRoot/链接模式/主题）
- `SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme) → void` — 保存应用配置
- `SetDownloadMirror(mirror) → void` — 设置下载镜像源
- `GetSubDirMap() → Record<string,string>` — 资源类型→子目录映射表（前端右键菜单等场景使用）
- `GetMinecraftPaths() → string[]` — 返回探测到的候选 Minecraft 目录
- `ValidateMinecraftDir(dir) → [string, string]` — 校验目录是否为合法 MC 目录
- `GetConfigPath() → string` — 返回 AppConfig 持久化文件路径
- `GetRuntimeLogs() → string` — 读取运行时日志（调试用）
- `ClearRuntimeLogs() → void` — 清空运行时日志

### 自动更新（app_config.go）

- `CheckUpdate() → updater.UpdateInfo` — 检查新版本，返回更新信息
- `DownloadUpdate(url, expectedHash) → string` — 下载更新包并校验哈希
- `ApplyUpdate(zipPath) → void` — 应用已下载的更新包
- `DoUpdate(url, expectedHash) → string` — 一键更新（下载 + 应用）

### 扫描与搜索（app_scan.go）

- `ScanModelEntries(dir) → types.ModelEntry[]` — 扫描目录生成模型条目列表（主列表数据源）
- `ScanModelEntriesWithLabel(dir, label) → types.ModelEntry[]` — 按标签过滤扫描模型条目
- `ListFileNames(dir) → string[]` — 列出目录内文件名
- `ListAllFilePaths(dir) → string[]` — 递归列出目录下所有文件完整路径（不限扩展名）
- `CheckFileExists(path) → boolean` — 检查文件是否存在
- `ListModelAuthors() → types.AuthorInfo[]` — 汇总模型作者信息
- `ScanLocalAuthors() → types.WorkshopCreator[]` — 扫描全部本地资源目录、从文件名提取作者（可直接合并进 creators.json）
- `ListVersionInstances(mcRoot) → types.VersionInstance[]` — 列出 MC 目录下的版本实例
- `GetGlobalCustomDir(mcRoot) → string` — 返回 MC 根目录下的全局自定义模型目录
- `SearchModels(repoRoot, keyword, minBones, maxBones, minCubes, maxCubes, minTex, maxTex) → types.SearchResult[]` — 高级搜索（关键词 + 骨骼数/立方体数/纹理尺寸区间）
- `ExportBoneStructures(repoRoot) → string` — 批量导出仓库骨骼结构
- `ExportModelStructureJSON(modelPath) → string` — 导出单模型骨骼结构 JSON
- `GenerateRepoIndex(repoPath) → string` — 扫描仓库目录生成 index.json
- `SetRepoRoot(dir) → void` — 设置仓库根目录
- `ClearScanCache() → void` — 清除扫描缓存（下载/导入后调用）

### 文件与目录操作（app_files.go）

- `CreateDir(dir) → void` — 创建目录
- `RenameDir(oldPath, newName) → void` — 重命名目录
- `RemoveDir(dir) → void` — 删除目录
- `RenameFile(oldPath, newName) → void` — 重命名文件
- `MoveModelFile(src, dstDir) → void` — 移动模型文件到目标目录
- `CopyModelFile(src, dstDir) → void` — 复制模型文件到目标目录（dstDir 必须是 FilesRoot 子目录，防路径遍历）
- `FindPreviewImage(modelPath) → string` — 查找模型的预览图
- `ExtractPreviewTexture(modelPath) → string` — 提取模型预览纹理
- `GetPackInfo(dirPath) → types.PackInfo` — 获取整合包信息
- `ToggleModelEnable(path) → boolean` — 切换模型启用/禁用状态
- `IsFileBanned(path) → boolean` — 检查文件是否在封禁名单

### 安装与导入（模型，app_install.go）

- `InstallModelFile(src, mcRoot) → string` — 安装模型文件到 MC 目录
- `InstallModelTo(src, customDir) → void` — 安装模型到指定自定义目录
- `InstallModelWithOverlay(src, customDir) → string` — 安装模型（带 overlay 覆盖处理）
- `ImportModelFile(fileName, base64Data) → void` — 导入 base64 模型文件（查重）
- `ImportModelFileSkipCheck(fileName, base64Data) → void` — 导入且跳过查重
- `ImportModelFileOverwrite(fileName, base64Data) → void` — 导入且重名覆盖
- `ImportModelFileTo(fileName, subpath, base64Data) → void` — 导入到指定子目录
- `ImportModelFileOverwriteTo(fileName, subpath, base64Data) → void` — 导入到子目录且重名覆盖
- `ImportModelFolder(folderName, base64Data) → void` — 导入整个文件夹型模型（批量文件）
- `DetectZipType(base64Data) → string` — 通过 ZIP 内容检测资源类型（供前端导入路由）
- `SyncCustomToRepo(customDir, repoDir) → number` — 自定义目录同步进仓库，返回同步数量
- `ClearCustomDir(customDir) → number` — 清空自定义目录中已安装文件，返回数量
- `DeduplicateCustomDir(customDir) → [number, number]` — 自定义目录去重

### 回收站（app_install.go）

- `MoveToRecycle(src) → void` — 移动文件进回收站
- `MoveToRecycleEx(src) → [string, string]` — 移动进回收站并返回移动后的路径信息
- `ListRecycleBin(保留参数) → types.ModelEntry[]` — 列出回收站条目（Go 端忽略该参数）
- `RestoreFromRecycle(src, repoRoot) → void` — 从回收站恢复文件
- `DeleteFromRecycle(src) → void` — 从回收站彻底删除
- `EmptyRecycleBin(保留参数) → number` — 清空回收站，返回删除数量（Go 端忽略该参数）

### 整合包同步与链接模式（app_install.go / resource_bindings.go）

- `GetInstanceStatus(mcRoot, repoDir) → types.InstanceStatus[]` — 获取整合包同步状态
- `GetResourceInstanceStatus(rtype, mcRoot, repoDir) → types.InstanceStatus[]` — 按资源类型获取同步状态（repoDir 仅 YSM 类型生效）
- `GetInstanceSyncStatus(instanceName) → string` — 获取整合包下所有资源类型的同步状态（扁平列表 JSON）
- `SyncResources(rtype, instanceName) → string` — 获取全局 ↔ 整合包的资源同步状态
- `SyncModelToggleStatus(instanceCustomDir, repoRoot) → [number, number]` — 同步模型启用/禁用状态
- `PushResourceToInstance(rtype, instanceName) → number` — 将全局缺失的资源推送到整合包，返回数量
- `PushSingleResourceToInstance(rtype, instanceName, filePath) → void` — 推送单个文件/文件夹到整合包
- `PullResourceFromInstance(rtype, instanceName) → number` — 将整合包多余资源拉取到全局，返回数量
- `PullSingleResourceFromInstance(rtype, srcPath, instanceName) → void` — 拉取单个 extra 文件/文件夹到全局仓库
- `CountInstanceResources(insName, rtype) → number` — 统计整合包中可清空的资源文件数（rtype 空=全部类型）
- `ClearInstanceResources(insName, rtype) → number` — 清空整合包中已同步文件（走回收站），返回数量
- `RelinkCustomDir(customDir, repoRoot) → number` — 重新应用链接模式到指定目录（兼容旧版）
- `RelinkAllInstanceResources(instanceName) → number` — 重新应用链接模式到整合包所有资源类型目录
- `InstallResourceToInstance(rtype, srcPath, instanceName) → void` — 将资源文件安装到指定整合包（rtype 如 resourcepack/shaderpack）
- `HasYSMMod(modsDir) → boolean` — 检测 mods 目录是否存在 YSM 模组
- `SetLinkMode(mode) → void` — 设置链接模式（符号链接/硬链接/复制）
- `GetLinkMode() → string` — 获取当前链接模式

### 导入日志（app_install.go）

- `AddImportLog(modelName, sourcePath, targetDir, fileSize, status, errMsg) → void` — 记录一条导入日志
- `GetImportLogs() → types.ImportLog[]` — 获取全部导入日志
- `ClearImportLogs() → void` — 清空导入日志

### 下载队列（app_download.go）

- `EnqueueDownloads(tasks) → void` — 下载任务入队（单击/多选/全选统一入口，参数为 DownloadTask 数组）
- `CancelQueue() → void` — 取消当前下载队列
- `QueueStatus() → QueueStatusInfo` — 查询队列状态（进度/当前任务）
- `DownloadFromGitHub(rawURL, saveDir) → string` — 从 GitHub raw 地址直连下载

### 模型解析与预览（app_model.go / app_download.go）

- `AnalyzeYSMModel(path) → ysm.YSMModelMeta` — 解析 YSM 模型元信息
- `ExtractYsmSummary(path) → ysm.YsmSummary` — 提取 YSM 摘要
- `ExtractYSMHeader(path) → ysm.YSMHeader` — 提取 YSM 文件头
- `ExtractYSMHeaderFromBase64(base64Data) → ysm.YSMHeader` — 从 base64 数据提取 YSM 文件头
- `AnalyzeBedrockModel(modelPath) → types.BedrockModel` — 解析基岩版模型
- `GetModel3DSpec(modelPath) → string` — 生成模型 3D 渲染规格 JSON（前端 Three.js 消费）
- `GetModelTexSizes(repoRoot) → ysm.TexInfo[]` — 轻量扫描仓库纹理尺寸（不解析完整模型）
- `ReadFileBytes(path) → string` — 读取文件字节（base64 返回）
- `SavePreviewTempFile(base64Data) → string` — 保存预览 base64 为临时文件，返回路径
- `SaveScreenshotFile(filename, base64Data) → void` — 保存 base64 PNG 到磁盘（供 JS 批量截图）

### 标签（app_tags.go）

- `GetModelTags(modelPath) → string[]` — 获取指定模型文件的所有标签
- `SetModelTags(modelPath, tags) → void` — 设置标签列表（覆盖写入）
- `ListByTag(tag) → string[]` — 列出打了指定标签的所有文件路径
- `AllTags() → string[]` — 返回所有被使用的标签（按使用次数降序）

### 头像（app_avatar.go）

- `CachedCreatorAvatar(authorName) → string` — 查缓存中是否有作者头像，返回 data URI
- `BatchExtractCreatorAvatars() → Record<string,string>` — 批量提取所有有本地模型的创作者头像
- `DebugExtractCreatorAvatar(authorName) → Record<string,string>` — 调试版：提取指定作者头像
- `CacheModelAvatars(modelPath) → void` — 从解压目录 ysm.json 缓存模型头像

### 创作者工坊（app_workshop.go）

- `LoadWorkshopSites() → types.WorkshopSite[]` — 加载工坊站点配置
- `SaveWorkshopSites(sites) → void` — 保存工坊站点配置
- `ResetWorkshopConfigs() → types.WorkshopSite[]` — 重置工坊配置为默认
- `LoadWorkshopCreators() → types.WorkshopCreator[]` — 加载创作者列表（creators.json）
- `SaveWorkshopCreators(list) → void` — 保存创作者列表（全量）
- `SaveWorkshopCreatorsBySite(siteID, siteCreators) → void` — 只替换指定站点的创作者，其他站点不动
- `SaveWorkshopPresetsBySite(siteID, presets) → void` — 只替换指定站点的搜索词预设
- `LoadGitHubRepos() → types.WorkshopCreator[]` — 加载 GitHub 仓库创作者列表
- `ExportWorkshopSitesCSV() → string` — 导出站点为 CSV
- `ExportWorkshopSitesJSONFile() → string` — 导出站点为 JSON 文件
- `ImportWorkshopSitesJSONFile() → number` — 从 JSON 文件导入站点，返回导入数量
- `ImportWorkshopSitesCSV(csvContent) → void` — 从 CSV 内容导入站点
- `ExportWorkshopCreatorsJSONFile() → string` — 导出创作者为 JSON 文件
- `BackupWorkshopCreators() → string` — 备份创作者列表
- `MergeWorkshopCreatorsFromJSON(jsonContent) → [number, number]` — 从 JSON 增量合并创作者
- `ReplaceWorkshopCreatorsFromJSON(jsonContent) → number` — 从 JSON 全量替换创作者

### 广场窗口（plaza_window.go，ADR-050）

- `NavigatePlazaWindow(url, direct) → void` — 广场窗口导航到指定 URL；`direct=true` 走直连、`false` 走 Go 反向代理（CORS 修复：window 模式应直连导航而非走代理，2026-08-12 修复）
- `ClosePlazaWindow() → void` — 关闭广场窗口
- `PlazaGoBack() → void` / `PlazaGoForward() → void` — 窗口内前后进
- `PlazaReload() → void` — 窗口内刷新
- `PlazaZoomIn() → void` / `PlazaZoomOut() → void` / `PlazaZoomReset() → void` — 窗口内缩放
- 配套内部机制：`prewarmPlazaWindow()` 启动预热窗口；`plazaExecJS` 执行注入脚本
- 前端场景：创意工坊浏览器栏三模式切换（external / embed / window，ADR-050）——window 模式复用本窗口

### 资源类型、资源包与蓝图（resource_bindings.go）

- `LoadResourceTypes() → string` — 加载 resource_types.json 资源类型注册表（单一事实来源）
- `GetRepoRoot(rtype) → (string, error)` — 按资源类型 key 返回对应仓库根目录
- `SetResourceRoot(rtype, path) → void` — 设置指定资源类型的自定义根路径（空=恢复默认）
- `ResetResourceRoot(rtype) → void` — 恢复指定资源类型路径为默认
- `DetectResourceType(path) → string` — 检测指定文件的资源类型
- `ImportByType(rtype, srcPath) → string` — 统一导入入口，按资源类型自动选择导入策略
- `ImportResourcePack(srcPath, rtype) → string` — 使用策略模式导入资源包
- `DeleteResourcePack(path) → void` — 删除资源包文件
- `DeleteModelDir(path) → void` — 删除文件夹型资源（MMD 模型等，删除文件所在父文件夹）
- `ToggleResourcePack(path) → boolean` — 切换资源包启用/禁用（.zip ↔ .zip.disabled）
- `IsResourcePackEnabled(path) → boolean` — 检查资源包是否启用
- `ReadPackMeta(path) → string` — 读取资源包信息（pack.mcmeta + pack.png）
- `ReadShaderpackLang(path) → string` — 读取光影包 lang/en_US.lang 提取显示名
- `SelectImportZip() → string` — 文件选择对话框选取 .zip
- `SelectImportFile(filter, title) → string` — 文件选择对话框按扩展名过滤（filter 格式 "显示名|*.ext1;*.ext2"）
- `GetNbtVoxelData(path) → string` — 读取 .nbt 结构文件体素数据
- `ReadNbtStructure(path) → string` — 读取 .nbt 结构文件基本信息
- `GetSchematicVoxelData(path) → string` — 读取 .schematic 文件体素数据
- `ReadSchematic(path) → string` — 读取 .schematic 文件基本信息
- `ReadLitematicMeta(path) → string` — 读取投影文件元数据（作者/时间/版本/方块统计/预览图）
- `GetLitematicVoxelData(path) → string` — 读取投影文件体素数据（按颜色分组的方块位置）
- `SetVoxelMaxBlocks(limit) → void` — 设置 3D 体素渲染上限，0=恢复默认 200000
- `FindDuplicateFiles(dir, configStr) → string` — 扫描目录返回所有重复文件分组（JSON 字符串）
  - 可选入参 `configStr`：去重配置 JSON（`{"strategy","keepPolicy","priorityPath"}`），经 `go/types.ParseDedupConfig` 解析（空串→未配置）
  - **返回契约**：成功 → `DedupGroup[]`（数组）；失败 → `{"error": string}`（对象，非数组）
  - 失败场景：路径守卫拒绝（`isPathInRootOrSelf` 返回 false）、底层 dedup 扫描异常（根符号链接/权限错误）
  - 前端解析：`JSON.parse` 后 `Array.isArray` 区分成功/失败，失败时走 `t("diagnostics.scanFailed", ...)` 兜底展示
- `CountDuplicateFiles(dir) → string` — 快速统计重复文件数量
  - **返回契约**：成功 → `{"groups": number, "extra": number}`；失败 → `{"error": string}`
  - 失败场景同上；前端解析方式同上
- `InvalidateScanCache() → void` — 清空扫描缓存，下次扫描获取最新数据

## 与其他子系统关系

- **前端桥接**：所有调用经 `frontend/src/backend/app.ts` 的 `getApp()` 动态 import 生成绑定（见 [wails_bridge](./wails-bridge.md)），返回 Promise，异常走 rejection（须有 toast 反馈）。
- **业务下沉**：本层是薄壳，真实逻辑在 `go/installer`（安装）、`go/sync`（整合包同步）、`go/recycle`（回收站）、`go/tags`（标签）、`go/updater`（更新）、`go/ysm`（解析）等包，细节见对应 `go_*` 知识卡。
- **资源类型参数**：各方法中的 `rtype` 参数取值来自 `resource_types.json` 注册表（见 [resource_registry](./resource-registry.md)），禁止手写新类型。
- **事件通道**：下载进度等异步状态不经 Binding 返回值，而走 Wails 事件由前端 bus 订阅（见 [event_bus](./event-bus.md)）；三入口统一走 `EnqueueDownloads` 只注册一组 EventsOn（致命陷阱 #7）。
- **生成绑定**：`frontend/bindings/` 由 Wails v3 构建时自动生成（含 `app.ts` 与各级 `models.ts`），是前端可见的方法与类型清单。

## 不变量

- **Binding 函数名写错返回 undefined**（致命陷阱 #5）：调用前必须先 grep `internal/app/` 确认函数名存在，不得凭记忆拼写。
- **改 Go 后必须重新构建才生效**（致命陷阱 #1）：修改 Binding 后需 `wails3 build` 或 `go build` 并重启，前端调用无反应先查是否重建。
- **禁止 `window.go.main.App` 直连**（治理红线 §3.2）：一律走 `getApp()`；零 `window.__*` 全局变量。
- `frontend/bindings/` 是生成物，禁止手改；Go 方法增删改后重新生成才进入前端清单。
- `SetApp` / `SetMainWindow` 是启动期框架接线，前端业务代码不得调用。
- Go 端的 `ServiceStartup` / `ServiceShutdown`（服务生命周期钩子）不在生成绑定中，前端不可调用；`SetApp`/`SetMainWindow` 现已进入生成 app.ts（前端业务仍不得调用）。**方法总数以生成 `app.ts`（当前 156 个 bound 方法）为权威**，`internal/app/` 源码导出 `*App` 方法更多（含上述生命周期/注入方法），但前端仅可见 app.ts 清单——任何 Binding 调用名须以 `app.ts` 为准核对（致命陷阱 #5）
- `ScanCustomModels` / `SetRepoRoot` 为幽灵方法（代码与前端均不存在，前端若调用将得 undefined）；`GetConfigPath`/`GetRuntimeLogs`/`ClearRuntimeLogs`/`ImportModelFolder`/`ScanModelEntriesWithLabel` 已补入上方对应领域段（配置/扫描/安装）
- 所有异常路径必须有 toast 反馈；异步按钮操作在 `finally` 中恢复状态（致命陷阱 #3）。
- **路径守卫模式**（审计发现）：所有 Wails Binding 暴露的文件操作方法（`ReadFileBytes`、`DeleteModelDir`、`ListFileNames`、`ListAllFilePaths`、`CheckFileExists`、`RenameDir`、`RemoveDir`、`MoveModelFile`、**`RenameFile`、`ClearCustomDir`、`ToggleResourcePack`**）在操作前统一加 `paths.IsInside(a.ysmRoot(), path)` 守卫（壳层经 `isPathInRoot`），限制操作范围在 `FilesRoot` 内。`CreateDir`（app_files.go CreateDir）经 `fileops` 内部收口、`SaveScreenshotFile`（app_model.go SaveScreenshotFile）经文件名白名单 + `os.TempDir` 收口，二者各有独立防护面、不在此清单内。原因：Wails Binding 是前端可直接调用的 API，无路径校验会导致任意文件读写（P1 安全漏洞）。`ToggleResourcePack` 为 P2 修复补加（原 `os.Rename` 对任意路径可重命名）；**`DeleteModelDir` 额外拒绝 `rel == "."`**（P1 修复：原仅查 `".."` 前缀，传入仓库根路径时 `os.RemoveAll` 可整删整个 ysm 仓库）。**2026-08-09 P1 复核修复：`isPathInRoot` 本体也拒绝 `rel == "."` 与 `rel == ".."`，并改用精确段比较（`".."+sep` 前缀）替代裸 `HasPrefix(rel,"..")`**——否则 `RemoveDir(ysmRoot)`/`RenameDir(ysmRoot)` 仍可整删/整改名仓库，且 `..foo` 合法目录被误拒。新增文件操作 Binding 时必须遵循此模式。**2026-08-26 BUG-1 修复：`ToggleResourcePack`（resource_bindings.go）与文件切换根守卫 `toggleRootFor`（app_files.go）已从 `paths.IsInside` 升级为 `paths.IsInsideResolved`**——解析两侧 symlink 后二次判定，拦截 baseDir 内指向外部的符号链接段逃逸；其余守卫仍走 `IsInside`（纯词法不解析 symlink），后续按需收敛。
- **读取类 Binding 豁免决策**（2026-08-09 威胁模型评估，技术债 #5）：解析类方法（`ReadPackMeta`/`ExtractYsmSummary`/`ExtractYSMHeader`/`AnalyzeYSMModel`/`AnalyzeBedrockModel`/`GetModel3DSpec`/`ExportModelStructureJSON`/`FindPreviewImage`/`ExtractPreviewTexture`/`GetPackInfo`/`ReadSchematic`/`ReadNbtStructure`/`ReadLitematicMeta`/`GetNbtVoxelData`/`GetSchematicVoxelData`/`GetLitematicVoxelData`）**豁免完整 `IsInside` 守卫**——预览链路临时文件（`SavePreviewTempFile` → os.TempDir）在仓库外，加守卫会破坏预览（与 go-ysm-parser 卡既有结论一致）；风险面为信息泄露非数据破坏，且各解析器对文件格式有解析校验。**`ReadFileBytes`（裸读原始字节，最危险入口）不豁免**——已改用 `isPathInRoot` 统一口径（2026-08-09 技术债 #5：原内联 Rel 裸 `HasPrefix(rel,"..")` 对 `rel=="."` 放行）
- **URL 校验模式**（审计发现）：`EnqueueDownloads` 入队前校验 URL scheme，**仅放行 `https://`**（知识卡旧文「http:// 与 https://」为漂移，实测代码仅 https——更严但 http 镜像源会被拒）；`DownloadFromGitHub` 无 scheme 校验直通（P3 观察，前端未使用）

## 相关

- [wails_bridge](./wails-bridge.md) — 前端 getApp() 调用入口
- [resource_registry](./resource-registry.md) — rtype 资源类型注册表
- [event_bus](./event-bus.md) — 前端事件总线（进度/完成事件订阅）
- 致命陷阱 §二 #1（改 Go 未重建）、#5（Binding 函数名写错）、#7（三入口重复注册）
- 治理红线 §三.2（Wails 调用统一走 getApp()）
