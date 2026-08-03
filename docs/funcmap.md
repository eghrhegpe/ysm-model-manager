# 函数映射表

> AI 找代码用。改功能前先 grep 此表定位文件:行。
> **自动生成**（2026-08-03）— 由 `scripts/funcmap.mjs` 生成（提取 Go/JS/TS 导出符号，参考 MikuMikuAR docs/function-map.md 风格）。

## 总览

| 模块 | 文件数 | 导出符号数 |
|------|--------|-----------|
| Go·头像 | 1 | 9 |
| Go·去重 | 1 | 5 |
| Go·下载 | 1 | 7 |
| Go·错误 | 1 | 1 |
| Go·文件系统 | 1 | 4 |
| Go·几何 | 2 | 5 |
| Go·导入 | 1 | 11 |
| Go·安装 | 1 | 6 |
| Go·Litematic | 5 | 11 |
| Go·日志 | 1 | 6 |
| Go·包管理 | 1 | 3 |
| Go·路径 | 1 | 4 |
| Go·回收站 | 1 | 16 |
| Go·同步 | 1 | 14 |
| Go·标签 | 1 | 8 |
| Go·Three.js | 1 | 6 |
| Go·类型 | 5 | 45 |
| Go·更新器 | 1 | 7 |
| Go·监听 | 1 | 6 |
| Go·YSM 核心 | 7 | 33 |
| Go(internal)·应用入口 | 15 | 173 |
| 前端·根 (app-modules/bus) | 1 | 10 |
| 前端·组件 | 45 | 126 |
| 前端·核心 | 7 | 10 |
| 前端·对话框 | 5 | 16 |
| 前端·特性 | 10 | 36 |
| 前端·服务 | 1 | 6 |
| 前端·工具 | 24 | 108 |
| 前端·Wails 桥接 | 1 | 2 |
| 前端·WASM | 3 | 6 |
| **合计** | **147** | **700** |

## Go·头像

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SafeName()` | `go/avatar/avatar:32` | SafeName 将非法文件名字符替换为下划线。 |
| `ReadCachedAvatar()` | `go/avatar/avatar:41` | ReadCachedAvatar 读取缓存中的头像，返回 data URI。 |
| `SaveAvatarData()` | `go/avatar/avatar:52` | SaveAvatarData 将头像数据写入缓存。 |
| `DecodeOneAvatar()` | `go/avatar/avatar:60` | DecodeOneAvatar 从模型文件中提取指定所有者的头像。 |
| `CacheAvatarsFromJSON()` | `go/avatar/avatar:197` | CacheAvatarsFromJSON 从解压目录的 ysm.json 缓存所有作者头像。 |
| `ReadFileFromZip()` | `go/avatar/avatar:240` | ReadFileFromZip 从 ZIP 读取指定路径的文件。 |
| `SetNodeJS()` | `go/avatar/avatar:268` | SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数。 |
| `DecodeYSMFiles()` | `go/avatar/avatar:275` | DecodeYSMFiles 底层解码，返回完整文件列表。 |
| `authorEntry()` | `go/avatar/avatar:25` | — |

## Go·去重

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `FindDuplicateFiles()` | `go/dedup/dedup:32` | FindDuplicateFiles 扫描目录，按 SHA256 哈希分组，返回包含重复的分组 skipRecycle 为 true 时跳过 .recycle 子目录 |
| `CountDuplicates()` | `go/dedup/dedup:124` | CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数） |
| `CleanEmptyDirs()` | `go/dedup/dedup:178` | CleanEmptyDirs 递归删除指定目录下的所有空子目录。 |
| `FileEntry()` | `go/dedup/dedup:16` | FileEntry 文件条目 |
| `Group()` | `go/dedup/dedup:24` | Group 重复文件分组 |

## Go·下载

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `New()` | `go/download/downloader:24` | New 创建 Downloader，默认 5 分钟超时。 |
| `NewWithClient()` | `go/download/downloader:29` | NewWithClient 使用指定 HTTP client。 |
| `Downloader.File()` | `go/download/downloader:41` | File 从 URL 下载文件到 savePath，支持进度回调。 |
| `Downloader.FromGitHubAPI()` | `go/download/downloader:97` | FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。 |
| `ResolveSavePath()` | `go/download/downloader:159` | ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。 |
| `ProgressFn()` | `go/download/downloader:15` | ProgressFn 下载进度回调。downloaded / total 为字节数。 |
| `Downloader()` | `go/download/downloader:18` | Downloader 文件下载器。 |

## Go·错误

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Friendly()` | `go/errors/errors:11` | Friendly 将错误转换为用户能看懂的中文提示。 |

## Go·文件系统

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `WalkAllFiles()` | `go/fsutil/walk:12` | WalkAllFiles 递归遍历目录返回所有文件的完整路径（不限制扩展名） skipRecycle 为 true 时跳过 .recycle 子目录 |
| `WalkAllDirs()` | `go/fsutil/walk:36` | WalkAllDirs 递归遍历目录，返回所有子目录路径（广度优先，后序遍历用） 不包含根目录本身，按深度优先顺序（后序：子目录在前，父目录在后） |
| `CountFiles()` | `go/fsutil/walk:65` | CountFiles 统计目录中的文件数（不限制扩展名） |
| `CleanEmptyDirs()` | `go/fsutil/walk:70` | CleanEmptyDirs 递归删除空子目录，返回删除数 |

## Go·几何

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ExtractFirstPNGFromZip()` | `go/geometry/archive:23` | ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览） |
| `ExtractFirstPNGFrom7z()` | `go/geometry/archive:45` | ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览） |
| `ParseFromZip()` | `go/geometry/archive:67` | ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画 |
| `ParseFrom7z()` | `go/geometry/archive:321` | ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理 |
| `ParseBedrockGeometry()` | `go/geometry/parse:17` | ParseBedrockGeometry 解析标准 Bedrock geometry JSON（minecraft:geometry 格式） 注意：data 大小不应超过 maxP |

## Go·导入

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Register()` | `go/importer/importer:29` | Register 注册导入策略 |
| `Get()` | `go/importer/importer:34` | Get 获取指定类型的导入策略 |
| `NewSimpleCopy()` | `go/importer/importer:60` | NewSimpleCopy 创建简单文件复制导入器 |
| `SimpleCopyImporter.Type()` | `go/importer/importer:64` | — |
| `SimpleCopyImporter.Import()` | `go/importer/importer:66` | — |
| `NewDirectoryCopy()` | `go/importer/importer:190` | NewDirectoryCopy 创建文件夹复制导入器 |
| `DirectoryCopyImporter.Type()` | `go/importer/importer:64` | — |
| `DirectoryCopyImporter.Import()` | `go/importer/importer:66` | — |
| `Handler()` | `go/importer/importer:19` | Handler 资源导入策略接口 |
| `SimpleCopyImporter()` | `go/importer/importer:55` | — |
| `DirectoryCopyImporter()` | `go/importer/importer:185` | — |

## Go·安装

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Install()` | `go/installer/installer:30` | Install 安装模型到目标目录（支持链接模式） |
| `InstallDir()` | `go/installer/installer:98` | InstallDir 安装整个目录下的所有文件到目标目录（支持链接模式） 用于 MMD/VRC 模型，.pmx/.pmd 文件所在文件夹包含纹理等配套文件 rtype 用于过滤文件 |
| `InstallToGlobal()` | `go/installer/installer:197` | InstallToGlobal 安装到全局 custom 目录 |
| `InstallWithOverlay()` | `go/installer/installer:217` | InstallWithOverlay 带冲突检查的安装 |
| `CopyFile()` | `go/installer/installer:244` | CopyFile 复制文件到目标目录 |
| `IsValidRepoRoot()` | `go/installer/installer:345` | IsValidRepoRoot 禁止选择系统敏感目录作为仓库 跨平台实现：禁止根目录、系统关键目录 |

## Go·Litematic

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `MapColor()` | `go/litematic/block_colors:10` | MapColor 返回 minecraft 方块名对应的近似十六进制颜色。 |
| `ResolveBlockName()` | `go/litematic/block_ids:12` | ResolveBlockName 把旧版数字 ID（schematic v1）解析为注册名。 |
| `ResolveBlockZH()` | `go/litematic/block_ids:26` | ResolveBlockZH 把注册名映射为中文名（自动去除 minecraft: 前缀）。 |
| `prBlock()` | `go/litematic/gen/main:16` | — |
| `ParseMeta()` | `go/litematic/parser:16` | — |
| `ParseSchematic()` | `go/litematic/parser:172` | — |
| `ParseNbtStructure()` | `go/litematic/parser:278` | — |
| `BuildVoxelData()` | `go/litematic/voxel:21` | BuildVoxelData 构建体素渲染数据（按颜色分组） |
| `BuildNbtVoxelData()` | `go/litematic/voxel:191` | — |
| `BuildSchematicVoxelData()` | `go/litematic/voxel:278` | — |
| `regionInfo()` | `go/litematic/voxel:12` | regionInfo 标准化后的 region 遍历信息 |

## Go·日志

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewLogger()` | `go/logs/logs:22` | NewLogger 创建日志管理器 使用系统标准的应用配置目录（Windows: %APPDATA%, Linux: ~/.config, macOS: ~/Library/App |
| `Logger.Add()` | `go/logs/logs:78` | Add 添加一条导入日志（兼容旧调用） |
| `Logger.AddOp()` | `go/logs/logs:83` | AddOp 添加一条指定操作类型的日志 |
| `Logger.GetAll()` | `go/logs/logs:107` | GetAll 获取所有日志 |
| `Logger.Clear()` | `go/logs/logs:116` | Clear 清空日志 |
| `Logger()` | `go/logs/logs:14` | Logger 导入日志管理器 |

## Go·包管理

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ReadPackMeta()` | `go/packs/mcmeta:18` | ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图 |
| `DetectResourceType()` | `go/packs/mcmeta:93` | DetectResourceType 检测文件属于哪种资源类型 |
| `ReadShaderpackLang()` | `go/packs/mcmeta:201` | ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名 返回 {name, entries}，name 为空时前端用文件名兜 |

## Go·路径

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ErrPathEscalation.Error()` | `go/paths/safe:16` | — |
| `IsInside()` | `go/paths/safe:23` | IsInside 检查 path 是否在 baseDir 下，防止路径遍历。 |
| `ContainsMinecraftMarker()` | `go/paths/safe:51` | ContainsMinecraftMarker 检查路径中是否包含 .minecraft 或 minecraft 标记 PrismLauncher 实例目录下可能是 minecra |
| `ErrPathEscalation()` | `go/paths/safe:10` | ErrPathEscalation 路径越权错误 |

## Go·回收站

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `New()` | `go/recycle/recycle:30` | New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle |
| `TrashManager.RecycleDir()` | `go/recycle/recycle:35` | RecycleDir 返回回收站目录路径 |
| `TrashManager.Move()` | `go/recycle/recycle:40` | Move 移动文件到回收站 |
| `TrashManager.MoveEx()` | `go/recycle/recycle:46` | MoveEx 移动文件到回收站，返回操作详情 |
| `TrashManager.List()` | `go/recycle/recycle:147` | List 列出回收站中的文件 |
| `TrashManager.Restore()` | `go/recycle/recycle:178` | Restore 从回收站恢复到原目录 |
| `TrashManager.Delete()` | `go/recycle/recycle:213` | Delete 永久删除回收站中的文件 |
| `TrashManager.Empty()` | `go/recycle/recycle:222` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `Move()` | `go/recycle/recycle:40` | Move 移动文件到回收站 |
| `MoveEx()` | `go/recycle/recycle:46` | MoveEx 移动文件到回收站，返回操作详情 |
| `List()` | `go/recycle/recycle:147` | List 列出回收站中的文件 |
| `Restore()` | `go/recycle/recycle:178` | Restore 从回收站恢复到原目录 |
| `Delete()` | `go/recycle/recycle:213` | Delete 永久删除回收站中的文件 |
| `Empty()` | `go/recycle/recycle:222` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `MoveResult()` | `go/recycle/recycle:19` | MoveResult 回收操作结果 |
| `TrashManager()` | `go/recycle/recycle:25` | TrashManager 可配置的回收站管理器 |

## Go·同步

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `GetInstanceStatus()` | `go/sync/sync:23` | GetInstanceStatus 获取整合包状态（使用真实 ListVersions） |
| `GetInstanceStatusWith()` | `go/sync/sync:28` | GetInstanceStatusWith 可注入的整合包状态获取（测试用） |
| `SyncToggleStatus()` | `go/sync/sync:131` | SyncToggleStatus 同步启用/禁用状态 |
| `ListVersions()` | `go/sync/sync:231` | — |
| `HasDotMinecraftSubdirs()` | `go/sync/sync:246` | HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录） |
| `FindMinecraftDir()` | `go/sync/sync:263` | FindMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径 |
| `SyncResources()` | `go/sync/sync:377` | SyncResources 对比两个目录的资源文件差异，按文件名匹配 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步 只统计模型/资源相关扩展名的文件，忽略无关文件 |
| `SyncResourcesDirLevel()` | `go/sync/sync:486` | SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹） 以文件夹名为单位，一个文件夹 |
| `SortEntries()` | `go/sync/sync:552` | SortEntries 按名称排序模型条目 |
| `GetLinkType()` | `go/sync/sync:560` | getLinkType 判断文件的链接类型 GetLinkType 判断文件的链接类型 |
| `CompareGlobalInstanceHashes()` | `go/sync/sync:608` | CompareGlobalInstanceHashes 对比全局目录和整合包实例子目录的哈希， 返回每个实例的 Missing / Extra / Synced 状态。 |
| `ScanFunc()` | `go/sync/sync:17` | ScanFunc 扫描模型（函数类型，由 app.go 注入） |
| `ListVersionsFunc()` | `go/sync/sync:20` | ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock） |
| `HasModInDirFn()` | `go/sync/sync:603` | HasModInDirFn 判断 mods 目录是否含有指定类型 mod 的函数类型。 |

## Go·标签

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewStore()` | `go/tags/tags:24` | NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取） |
| `Store.GetTags()` | `go/tags/tags:68` | GetTags 返回指定路径的所有标签（已排序） |
| `Store.SetTags()` | `go/tags/tags:85` | SetTags 设置指定路径的标签列表（覆盖写入） |
| `Store.AddTag()` | `go/tags/tags:112` | AddTag 追加单个标签（不会重复） |
| `Store.RemoveTag()` | `go/tags/tags:130` | RemoveTag 移除单个标签 |
| `Store.ListByTag()` | `go/tags/tags:152` | ListByTag 返回所有打了指定标签的文件路径列表 |
| `Store.AllTags()` | `go/tags/tags:176` | AllTags 返回所有被使用的标签（按使用次数降序） |
| `Store()` | `go/tags/tags:17` | Store 是标签存储，线程安全 |

## Go·Three.js

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Build()` | `go/threejs/spec:56` | Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec |
| `Model3DSpec()` | `go/threejs/spec:16` | — |
| `ModelGroup()` | `go/threejs/spec:20` | — |
| `BoneData()` | `go/threejs/spec:31` | — |
| `MeshData()` | `go/threejs/spec:39` | — |
| `vec3()` | `go/threejs/spec:53` | — |

## Go·类型

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BedrockModel()` | `go/types/bedrock:4` | BedrockModel 基岩版模型几何体摘要（用于 2D 预览） |
| `Bone2D()` | `go/types/bedrock:17` | Bone2D 骨骼简化信息（只用于 2D 线条图） |
| `Cube2D()` | `go/types/bedrock:27` | Cube2D 立方体信息 |
| `AppConfig()` | `go/types/config:4` | AppConfig 应用持久化配置 |
| `PackInfo()` | `go/types/config:31` | PackInfo 模型整合包信息（ysm-pack.json） |
| `WorkshopPresetSearch()` | `go/types/config:38` | WorkshopPresetSearch 预设搜索词 |
| `WorkshopSite()` | `go/types/config:44` | WorkshopSite 创意工坊站点配置 |
| `WorkshopCreator()` | `go/types/config:57` | WorkshopCreator 创作者条目 Type 是平台标签，分号分隔，如 "bilibili;afdian" |
| `AllExts()` | `go/types/extensions:13` | AllExts 返回所有支持的扩展名（去重后） |
| `IsSupportedExt()` | `go/types/extensions:29` | IsSupportedExt 检查扩展名是否被任何资源类型支持 |
| `ExtBelongsTo()` | `go/types/extensions:43` | ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个） |
| `SupportedExtsForType()` | `go/types/extensions:58` | SupportedExtsForType 返回指定资源类型的所有扩展名 |
| `FindInstDir()` | `go/types/extensions:72` | FindInstDir 查找整合包中指定资源类型的子目录： 1. |
| `StorageSubDir()` | `go/types/extensions:115` | StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录 从 resource_types.json 注册表读取，无匹配时返回 rtype 自身 |
| `SubDirMap()` | `go/types/extensions:129` | SubDirMap 返回指定资源类型在整合包实例版本目录中的扫描子目录 |
| `SubDirAll()` | `go/types/extensions:141` | SubDirAll 返回所有资源类型在整合包实例中的版本扫描子目录映射 |
| `AllSubDirs()` | `go/types/extensions:153` | AllSubDirs 返回所有资源类型的版本子目录信息（遍历用） |
| `SubDirEntry()` | `go/types/extensions:123` | SubDirEntry 资源类型的版本子目录信息 |
| `SetRegistryPath()` | `go/types/resource:40` | SetRegistryPath 设置注册表文件路径（仅测试用） |
| `LoadRegistry()` | `go/types/resource:49` | LoadRegistry 加载资源类型注册表 优先读取外部 JSON 文件（可通过 SetRegistryPath 自定义路径）， 文件不存在或读取失败时回退到编译时嵌入的默认数据 |
| `RegistryType()` | `go/types/resource:89` | RegistryType 按 id 查找资源类型，不存在时返回 nil |
| `FormatRange.UnmarshalJSON()` | `go/types/resource:106` | UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式 |
| `PackMeta.Desc()` | `go/types/resource:200` | Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组） |
| `ResourceTypeRegistry()` | `go/types/resource:13` | ResourceTypeRegistry 资源类型注册表 |
| `ResourceType()` | `go/types/resource:18` | ResourceType 一种受支持的资源类型定义 |
| `FormatRange()` | `go/types/resource:100` | FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]） |
| `PackMeta()` | `go/types/resource:189` | PackMeta 资源包信息（来自 pack.mcmeta） |
| `LitematicMeta()` | `go/types/resource:207` | LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound） |
| `LitematicBlockStat()` | `go/types/resource:224` | LitematicBlockStat 方块类型统计 |
| `LitematicVoxelData()` | `go/types/resource:230` | LitematicVoxelData 体素渲染数据 |
| `VoxelGroup()` | `go/types/resource:238` | VoxelGroup 同一颜色的方块组 |
| `e.Error()` | `go/types/types:101` | — |
| `WindowState()` | `go/types/types:6` | WindowState 窗口位置 |
| `AuthorInfo()` | `go/types/types:14` | AuthorInfo 作者信息（含模型计数） |
| `ModelEntry()` | `go/types/types:21` | ModelEntry 模型文件条目 |
| `VersionInstance()` | `go/types/types:32` | VersionInstance 整合包信息 |
| `SearchResult()` | `go/types/types:40` | SearchResult 模型搜索结果 |
| `ImportLog()` | `go/types/types:51` | ImportLog 应用操作日志（导入、扫描、下载、同步等） |
| `LinkType()` | `go/types/types:63` | LinkType 链接类型 |
| `CustomFileInfo()` | `go/types/types:73` | CustomFileInfo custom 目录下的文件信息 |
| `InstanceStatus()` | `go/types/types:79` | InstanceStatus 整合包状态 |
| `AppError()` | `go/types/types:92` | — |
| `ResourceSyncResult()` | `go/types/types:114` | ResourceSyncResult 资源同步结果 |
| `SyncStatus()` | `go/types/types:121` | SyncStatus 资源文件同步状态 |
| `ResourceSyncItem()` | `go/types/types:132` | ResourceSyncItem 单个资源文件的同步状态 |

## Go·更新器

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Check()` | `go/updater/update:71` | Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志） |
| `Download()` | `go/updater/update:150` | Download 下载更新包到临时目录，返回 zip 路径。 |
| `CleanupOldVersion()` | `go/updater/update:199` | CleanupOldVersion 启动时清理上一次更新留下的 .old 文件 |
| `InstallUpdate()` | `go/updater/update:214` | InstallUpdate 解压更新包并通过 helper 进程替换当前 exe。 |
| `ReleaseAsset()` | `go/updater/update:35` | ReleaseAsset GitHub Release 中的文件 |
| `Release()` | `go/updater/update:41` | Release GitHub Release 信息 |
| `UpdateInfo()` | `go/updater/update:50` | UpdateInfo 更新信息（序列化给前端） |

## Go·监听

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `New()` | `go/watcher/watcher:35` | New 创建文件监听器 |
| `Watcher.Start()` | `go/watcher/watcher:50` | Start 开始监听 |
| `Watcher.Stop()` | `go/watcher/watcher:91` | Stop 停止监听 |
| `Watcher.IsRunning()` | `go/watcher/watcher:109` | IsRunning 返回是否正在运行 |
| `ScanFunc()` | `go/watcher/watcher:16` | ScanFunc matches mdsync.ScanFunc |
| `Watcher()` | `go/watcher/watcher:22` | Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包 |

## Go·YSM 核心

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `FindCLI()` | `go/ysm/cli:11` | FindCLI 查找 YSMParser.exe 可执行文件路径 |
| `FindGeometryInExtractedYSM()` | `go/ysm/extracted:21` | FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理 ysmJsonPath: ysm.json 的完整路径 返回: |
| `AnalyzeYSMHeader()` | `go/ysm/header:167` | AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据 |
| `AnalyzeYSMHeaderFromBytes()` | `go/ysm/header:320` | AnalyzeYSMHeaderFromBytes 从字节数据解析 YSM 头部（适用于 base64 导入场景） |
| `YSMHeader()` | `go/ysm/header:12` | YSMHeader 从 YSM 文件文本头部提取的元数据（适用于加密和非加密模型） |
| `AnalyzeYSMModel()` | `go/ysm/parse:43` | AnalyzeYSMModel 解析 .ysm 文件，提取模型元数据 |
| `YSMModelMeta()` | `go/ysm/parse:13` | YSMModelMeta 模型元数据（从 model.json 提取） |
| `ysmModelJSON()` | `go/ysm/parse:27` | 内部用——model.json 的完整结构（只关心需要的字段） |
| `ysmGeometry()` | `go/ysm/parse:37` | — |
| `ExtractYsmSummary()` | `go/ysm/summary:131` | ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要 |
| `Author()` | `go/ysm/summary:14` | — |
| `Link()` | `go/ysm/summary:20` | — |
| `AnimGroup()` | `go/ysm/summary:25` | — |
| `ConfigMenu()` | `go/ysm/summary:31` | — |
| `PreviewInfo()` | `go/ysm/summary:37` | — |
| `YsmSummary()` | `go/ysm/summary:45` | YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要 |
| `Stats()` | `go/ysm/summary:62` | — |
| `ysmRoot()` | `go/ysm/summary:72` | — |
| `ysmMetadata()` | `go/ysm/summary:79` | — |
| `ysmLicense()` | `go/ysm/summary:87` | — |
| `ysmAuthor()` | `go/ysm/summary:91` | — |
| `ysmContact()` | `go/ysm/summary:98` | — |
| `ysmLink()` | `go/ysm/summary:102` | — |
| `ysmProperties()` | `go/ysm/summary:107` | — |
| `ysmAnimClassify()` | `go/ysm/summary:116` | — |
| `ysmConfigButton()` | `go/ysm/summary:122` | — |
| `ScanModelTexSizes()` | `go/ysm/texsize:22` | ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM 仅支持 zip/7z 格式（未加密模型），加密 .ysm 返回 0,0 |
| `ScanFiles()` | `go/ysm/texsize:146` | ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用） |
| `TexInfo()` | `go/ysm/texsize:14` | TexInfo 轻量级纹理尺寸（不解析完整模型） |
| `ModelEntry()` | `go/ysm/texsize:37` | ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径） |
| `IsYSMJar()` | `go/ysm/ysm:12` | IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml） |
| `HasYSMMod()` | `go/ysm/ysm:71` | HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP） |
| `HasModInDir()` | `go/ysm/ysm:100` | HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar |

## Go(internal)·应用入口

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `App.CachedCreatorAvatar()` | `internal/app/app_avatar:16` | CachedCreatorAvatar 检查缓存中是否有作者头像，返回 data URI |
| `App.BatchExtractCreatorAvatars()` | `internal/app/app_avatar:21` | BatchExtractCreatorAvatars 批量提取所有有本地模型的创作者头像 |
| `App.DebugExtractCreatorAvatar()` | `internal/app/app_avatar:71` | DebugExtractCreatorAvatar 调试版：提取指定作者头像 |
| `App.CacheModelAvatars()` | `internal/app/app_avatar:124` | CacheModelAvatars 从解压目录 ysm.json 缓存头像 |
| `App.SaveAppConfig()` | `internal/app/app_config:102` | — |
| `App.SetDownloadMirror()` | `internal/app/app_config:134` | — |
| `App.LoadAppConfig()` | `internal/app/app_config:160` | — |
| `App.GetSubDirMap()` | `internal/app/app_config:181` | ========== 自动更新 ========== GetSubDirMap 返回资源类型→子目录映射表（前端右键菜单等场景使用） |
| `App.CurrentVersion()` | `internal/app/app_config:185` | — |
| `App.CheckUpdate()` | `internal/app/app_config:187` | — |
| `App.DownloadUpdate()` | `internal/app/app_config:191` | — |
| `App.ApplyUpdate()` | `internal/app/app_config:195` | — |
| `App.DoUpdate()` | `internal/app/app_config:199` | — |
| `App.RestartApplication()` | `internal/app/app_config:211` | — |
| `App.SaveWindowPosition()` | `internal/app/app_config:263` | — |
| `App.GetWindowPosition()` | `internal/app/app_config:277` | — |
| `App.SelectDirectory()` | `internal/app/app_config:306` | ========== 目录选择 ========== |
| `App.GetMinecraftPaths()` | `internal/app/app_config:428` | — |
| `App.ValidateMinecraftDir()` | `internal/app/app_config:430` | — |
| `NewDownloadQueue()` | `internal/app/app_download:45` | — |
| `App.EnqueueDownloads()` | `internal/app/app_download:50` | — |
| `App.CancelQueue()` | `internal/app/app_download:66` | — |
| `App.QueueStatus()` | `internal/app/app_download:80` | — |
| `App.DownloadFromGitHub()` | `internal/app/app_download:201` | — |
| `App.GetModelTexSizes()` | `internal/app/app_download:310` | GetModelTexSizes 扫描仓库文件提取纹理尺寸（轻量级，不解析完整模型） |
| `QueueStatusInfo()` | `internal/app/app_download:21` | QueueStatusInfo 队列状态（替代多返回值，Wails 自动映射为 JS object） |
| `DownloadTask()` | `internal/app/app_download:27` | DownloadTask 下载队列任务 |
| `DownloadQueue()` | `internal/app/app_download:35` | DownloadQueue 串行下载队列 |
| `App.CreateDir()` | `internal/app/app_files:22` | ========== 目录操作 ========== |
| `App.RenameDir()` | `internal/app/app_files:34` | — |
| `App.RemoveDir()` | `internal/app/app_files:45` | — |
| `App.RenameFile()` | `internal/app/app_files:49` | — |
| `App.FindPreviewImage()` | `internal/app/app_files:64` | ========== 预览提取 ========== |
| `App.ExtractPreviewTexture()` | `internal/app/app_files:89` | — |
| `App.GetPackInfo()` | `internal/app/app_files:192` | ========== 包信息 ========== |
| `App.MoveModelFile()` | `internal/app/app_files:246` | ========== 模型移动 ========== |
| `App.CopyModelFile()` | `internal/app/app_files:261` | ========== 模型复制 ========== CopyModelFile 将 src 复制到 dstDir 目录下（保留原文件名） dstDir 必须是 FilesRoot |
| `App.RevealInExplorer()` | `internal/app/app_files:303` | ========== 在资源管理器中显示 ========== |
| `App.ToggleModelEnable()` | `internal/app/app_files:314` | ========== 启用/禁用 ========== |
| `App.IsFileBanned()` | `internal/app/app_files:335` | — |
| `App.InstallModelFile()` | `internal/app/app_install:23` | ========== 安装 ========== |
| `App.InstallModelTo()` | `internal/app/app_install:27` | — |
| `App.InstallModelWithOverlay()` | `internal/app/app_install:37` | — |
| `App.SyncCustomToRepo()` | `internal/app/app_install:41` | — |
| `App.ImportModelFile()` | `internal/app/app_install:92` | — |
| `App.DetectZipType()` | `internal/app/app_install:97` | DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用） |
| `App.ImportModelFileSkipCheck()` | `internal/app/app_install:105` | — |
| `App.ImportModelFileOverwrite()` | `internal/app/app_install:113` | — |
| `App.ImportModelFileTo()` | `internal/app/app_install:214` | — |
| `App.ImportModelFileOverwriteTo()` | `internal/app/app_install:218` | — |
| `App.MoveToRecycle()` | `internal/app/app_install:255` | ========== 回收站 ========== |
| `App.MoveToRecycleEx()` | `internal/app/app_install:264` | — |
| `App.ClearCustomDir()` | `internal/app/app_install:296` | — |
| `App.CountInstanceResources()` | `internal/app/app_install:351` | CountInstanceResources 统计指定整合包中可清空的资源文件数 只统计仓库中已有的文件（同 clearInstanceDir 逻辑） rtype 为空时统计全部类 |
| `App.ClearInstanceResources()` | `internal/app/app_install:390` | ClearInstanceResources 清空指定整合包中已同步的文件（走回收站） insName: 整合包名, rtype: 资源类型（空=全部, 非空=只清此类型） 返回清 |
| `App.DeduplicateCustomDir()` | `internal/app/app_install:498` | — |
| `App.ListRecycleBin()` | `internal/app/app_install:536` | — |
| `App.RestoreFromRecycle()` | `internal/app/app_install:553` | — |
| `App.DeleteFromRecycle()` | `internal/app/app_install:567` | — |
| `App.EmptyRecycleBin()` | `internal/app/app_install:580` | — |
| `App.GetInstanceStatus()` | `internal/app/app_install:613` | ========== 状态同步 ========== |
| `App.GetResourceInstanceStatus()` | `internal/app/app_install:619` | GetResourceInstanceStatus 按资源类型获取整合包同步状态 repoDir 仅对 YSM 类型生效（其他类型从全局资源目录推导） |
| `App.SyncModelToggleStatus()` | `internal/app/app_install:653` | — |
| `App.RelinkCustomDir()` | `internal/app/app_install:658` | RelinkCustomDir 重新应用链接模式到指定目录（兼容旧版） |
| `App.RelinkAllInstanceResources()` | `internal/app/app_install:730` | RelinkAllInstanceResources 重新应用链接模式到整合包所有资源类型目录 |
| `App.SyncResources()` | `internal/app/app_install:765` | SyncResources 获取全局 ↔ 整合包的资源同步状态 |
| `App.PushResourceToInstance()` | `internal/app/app_install:798` | PushResourceToInstance 将全局中缺失的资源推送到整合包 |
| `App.PullResourceFromInstance()` | `internal/app/app_install:849` | PullResourceFromInstance 将整合包中多余的资源拉取到全局 |
| `App.PullSingleResourceFromInstance()` | `internal/app/app_install:925` | PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库 |
| `App.PushSingleResourceToInstance()` | `internal/app/app_install:976` | PushSingleResourceToInstance 推送单个文件/文件夹到整合包 |
| `App.GetInstanceSyncStatus()` | `internal/app/app_install:1011` | GetInstanceSyncStatus 获取整合包下所有资源类型的同步状态（扁平列表） |
| `App.HasYSMMod()` | `internal/app/app_install:1209` | ========== YSM 检测 ========== |
| `App.SetLinkMode()` | `internal/app/app_install:1227` | ========== 链接模式 ========== |
| `App.GetLinkMode()` | `internal/app/app_install:1236` | — |
| `App.AddImportLog()` | `internal/app/app_install:1241` | ========== 日志 ========== |
| `App.AddOpLog()` | `internal/app/app_install:1245` | — |
| `App.GetImportLogs()` | `internal/app/app_install:1249` | — |
| `App.ClearImportLogs()` | `internal/app/app_install:1253` | — |
| `importOptions()` | `internal/app/app_install:117` | — |
| `App.AnalyzeYSMModel()` | `internal/app/app_model:20` | — |
| `App.ExtractYsmSummary()` | `internal/app/app_model:24` | — |
| `App.ExtractYSMHeader()` | `internal/app/app_model:35` | — |
| `App.ExtractYSMHeaderFromBase64()` | `internal/app/app_model:39` | — |
| `App.SavePreviewTempFile()` | `internal/app/app_model:47` | — |
| `App.ReadFileBytes()` | `internal/app/app_model:66` | — |
| `App.AnalyzeBedrockModel()` | `internal/app/app_model:74` | — |
| `App.GetModel3DSpec()` | `internal/app/app_model:119` | — |
| `App.SaveScreenshotFile()` | `internal/app/app_model:129` | SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用） |
| `App.ExportBoneStructures()` | `internal/app/app_scan:25` | ========== 批量导出骨骼结构 ========== |
| `App.ExportModelStructureJSON()` | `internal/app/app_scan:81` | ExportModelStructureJSON 导出单模型骨骼结构 |
| `App.SearchModels()` | `internal/app/app_scan:118` | ========== 高级搜索 ========== |
| `App.SetRepoRoot()` | `internal/app/app_scan:163` | — |
| `App.GenerateRepoIndex()` | `internal/app/app_scan:171` | GenerateRepoIndex 扫描仓库目录，生成 index.json |
| `progressReader.Read()` | `internal/app/app_scan:285` | — |
| `App.ClearScanCache()` | `internal/app/app_scan:317` | ClearScanCache 清除扫描缓存（下载/导入后调用） |
| `App.ScanModelEntries()` | `internal/app/app_scan:325` | ========== 模型扫描 ========== |
| `InvalidateScanCache()` | `internal/app/app_scan:395` | InvalidateScanCache 清空扫描缓存（同步完成后调用，确保下次扫描取最新数据） |
| `App.ScanCustomModels()` | `internal/app/app_scan:414` | — |
| `App.ListModelAuthors()` | `internal/app/app_scan:418` | — |
| `App.ListVersionInstances()` | `internal/app/app_scan:453` | — |
| `App.GetGlobalCustomDir()` | `internal/app/app_scan:457` | — |
| `App.ListFileNames()` | `internal/app/app_scan:461` | — |
| `App.ListAllFilePaths()` | `internal/app/app_scan:471` | ListAllFilePaths 递归列出指定目录下的所有文件完整路径（不限制扩展名） |
| `App.CheckFileExists()` | `internal/app/app_scan:475` | — |
| `App.ScanLocalAuthors()` | `internal/app/app_scan:482` | ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者 返回统一格式的创作者列表（可直接合并到 creators.json） |
| `App.OpenFolder()` | `internal/app/app_scan:559` | — |
| `App.OpenInstanceFolder()` | `internal/app/app_scan:566` | OpenInstanceFolder 按资源类型打开整合包子目录；目录不存在时回退到实例根目录 |
| `progressReader()` | `internal/app/app_scan:277` | progressReader 包装 io.Reader，下载时通过回调推送进度 |
| `scanCacheEntry()` | `internal/app/app_scan:309` | — |
| `App.GetModelTags()` | `internal/app/app_tags:29` | GetModelTags 返回指定模型文件的所有标签 |
| `App.SetModelTags()` | `internal/app/app_tags:34` | SetModelTags 设置指定模型文件的标签列表（覆盖写入） |
| `App.ListByTag()` | `internal/app/app_tags:39` | ListByTag 返回所有打了指定标签的文件路径列表 |
| `App.AllTags()` | `internal/app/app_tags:44` | AllTags 返回所有被使用的标签（按使用次数降序） |
| `App.LoadWorkshopSites()` | `internal/app/app_workshop:56` | — |
| `App.SaveWorkshopSites()` | `internal/app/app_workshop:64` | — |
| `App.LoadWorkshopCreators()` | `internal/app/app_workshop:109` | — |
| `App.SaveWorkshopCreators()` | `internal/app/app_workshop:117` | — |
| `App.SaveWorkshopCreatorsBySite()` | `internal/app/app_workshop:126` | SaveWorkshopCreatorsBySite 只替换指定站点的创作者，其他站点不动 |
| `App.SaveWorkshopPresetsBySite()` | `internal/app/app_workshop:142` | SaveWorkshopPresetsBySite 只替换指定站点的搜索词，其他站点不动 |
| `App.LoadGitHubRepos()` | `internal/app/app_workshop:162` | — |
| `App.ResetWorkshopConfigs()` | `internal/app/app_workshop:170` | — |
| `App.ExportWorkshopSitesCSV()` | `internal/app/app_workshop:183` | ========== CSV 导出/导入 ========== |
| `App.ExportWorkshopSitesJSONFile()` | `internal/app/app_workshop:195` | — |
| `App.ImportWorkshopSitesJSONFile()` | `internal/app/app_workshop:208` | — |
| `App.ImportWorkshopSitesCSV()` | `internal/app/app_workshop:224` | — |
| `App.ExportWorkshopCreatorsJSONFile()` | `internal/app/app_workshop:250` | — |
| `App.BackupWorkshopCreators()` | `internal/app/app_workshop:257` | — |
| `App.MergeWorkshopCreatorsFromJSON()` | `internal/app/app_workshop:270` | — |
| `App.ReplaceWorkshopCreatorsFromJSON()` | `internal/app/app_workshop:308` | — |
| `NewApp()` | `internal/app/app:35` | — |
| `App.SetApp()` | `internal/app/app:44` | SetApp 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框/浏览器管理器 |
| `App.SetMainWindow()` | `internal/app/app:49` | SetMainWindow 注入主窗口实例，避免依赖 Window.Current()。 |
| `App.ServiceStartup()` | `internal/app/app:52` | ServiceStartup 对应 v2 的 startup，在 app.Run() 期间由框架调用 |
| `App.ServiceShutdown()` | `internal/app/app:114` | ServiceShutdown 对应 v2 的 shutdown，在应用退出前由框架调用 |
| `App.OpenInBrowser()` | `internal/app/app:128` | OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌） |
| `App.GetAppVersion()` | `internal/app/app:133` | GetAppVersion 返回当前版本号 |
| `App()` | `internal/app/app:19` | — |
| `SetEmbedded()` | `internal/app/assets:16` | SetEmbedded 由根包 main 的 init() 注入编译期嵌入的静态资产。 |
| `CLIMain()` | `internal/app/cli:18` | — |
| `exportBone()` | `internal/app/cli:104` | — |
| `exportCube()` | `internal/app/cli:111` | — |
| `exportModel()` | `internal/app/cli:120` | — |
| `Issue()` | `internal/app/cli:183` | — |
| `App.StartProxy()` | `internal/app/proxy:22` | StartProxy 启动本地反代服务器（127.0.0.1 仅本机可访问） |
| `App.StopProxy()` | `internal/app/proxy:44` | StopProxy 关闭反代服务器 |
| `App.IsProxyRunning()` | `internal/app/proxy:59` | IsProxyRunning 检查代理是否运行中 |
| `App.LoadResourceTypes()` | `internal/app/resource_bindings:21` | LoadResourceTypes 加载资源类型注册表 |
| `App.ReadPackMeta()` | `internal/app/resource_bindings:30` | ReadPackMeta 读取资源包信息（pack.mcmeta + pack.png） |
| `App.ReadShaderpackLang()` | `internal/app/resource_bindings:55` | ReadShaderpackLang 读取光影包 lang/en_US.lang 提取显示名 |
| `App.GetNbtVoxelData()` | `internal/app/resource_bindings:82` | GetNbtVoxelData 读取 .nbt 结构文件体素数据 |
| `App.GetSchematicVoxelData()` | `internal/app/resource_bindings:87` | GetSchematicVoxelData 读取 .schematic 文件体素数据 |
| `App.ReadSchematic()` | `internal/app/resource_bindings:92` | ReadSchematic 读取 .schematic 文件基本信息 |
| `App.ReadNbtStructure()` | `internal/app/resource_bindings:102` | ReadNbtStructure 读取 .nbt 结构文件基本信息 |
| `App.ReadLitematicMeta()` | `internal/app/resource_bindings:112` | ReadLitematicMeta 读取投影文件元数据（作者/时间/版本/方块统计/预览图） |
| `App.GetLitematicVoxelData()` | `internal/app/resource_bindings:123` | GetLitematicVoxelData 读取投影文件体素数据（按颜色分组的方块位置） |
| `App.SetVoxelMaxBlocks()` | `internal/app/resource_bindings:128` | SetVoxelMaxBlocks 设置 3D 体素渲染上限，0=恢复默认 200000 |
| `App.DetectResourceType()` | `internal/app/resource_bindings:135` | DetectResourceType 检测指定文件的资源类型 |
| `App.GetRepoRoot()` | `internal/app/resource_bindings:144` | GetRepoRoot 根据资源类型返回对应的仓库根目录 |
| `App.ToggleResourcePack()` | `internal/app/resource_bindings:183` | ToggleResourcePack 切换资源包的启用/禁用状态（.zip ↔ .zip.disabled） |
| `App.IsResourcePackEnabled()` | `internal/app/resource_bindings:200` | IsResourcePackEnabled 检查资源包是否启用 |
| `App.SelectImportZip()` | `internal/app/resource_bindings:205` | SelectImportZip 打开文件选择器选取 .zip 文件 |
| `App.SelectImportFile()` | `internal/app/resource_bindings:218` | SelectImportFile 打开文件选择器，按给定扩展名过滤 filter 格式: "显示名|*.ext1;*.ext2" |
| `App.SetResourceRoot()` | `internal/app/resource_bindings:238` | SetResourceRoot 设置指定资源类型的自定义根路径（空=恢复默认） |
| `App.ResetResourceRoot()` | `internal/app/resource_bindings:262` | ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值） |
| `App.ImportResourcePack()` | `internal/app/resource_bindings:288` | ImportResourcePack 使用策略模式导入资源包 |
| `App.ImportByType()` | `internal/app/resource_bindings:301` | ImportByType 统一导入入口——根据资源类型自动选择导入策略 |
| `App.DeleteResourcePack()` | `internal/app/resource_bindings:314` | DeleteResourcePack 删除资源包文件 |
| `App.DeleteModelDir()` | `internal/app/resource_bindings:319` | DeleteModelDir 删除文件夹型资源（MMD 模型等），删除文件所在父文件夹 |
| `App.FindDuplicateFiles()` | `internal/app/resource_bindings:324` | FindDuplicateFiles 扫描目录返回所有重复文件分组（JSON 字符串） |
| `App.CountDuplicateFiles()` | `internal/app/resource_bindings:334` | CountDuplicateFiles 快速统计重复文件数量 |
| `App.InvalidateScanCache()` | `internal/app/resource_bindings:344` | InvalidateScanCache 清空扫描缓存，下次扫描获取最新数据 |
| `App.InstallResourceToInstance()` | `internal/app/resource_bindings:350` | InstallResourceToInstance 将资源文件安装到指定整合包 rtype: 资源类型（resourcepack/shaderpack 等），srcPath: 源文 |
| `App.GetWasmBinary()` | `internal/app/wasm_embed:5` | GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用）。 |

## 前端·根 (app-modules/bus)

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `bus()` | `frontend/js/bus:157` | 默认实例（组件直接使用） |
| `ToastPayload()` | `frontend/js/bus:7` | — |
| `MenuItem()` | `frontend/js/bus:18` | — |
| `NavPagePayload()` | `frontend/js/bus:27` | — |
| `ModelSelectPayload()` | `frontend/js/bus:31` | — |
| `CtxShowPayload()` | `frontend/js/bus:36` | — |
| `BusEvents()` | `frontend/js/bus:53` | — |
| `BusEventName()` | `frontend/js/bus:109` | — |
| `Bus()` | `frontend/js/bus:111` | — |
| `setBus()` | `frontend/js/bus:160` | 替换 bus 实例（入口层 / 测试用） |

## 前端·组件

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `LocalCreator()` | `frontend/js/components/app-content/community/core:6` | 本地合并后的创作者（绑定 WorkshopCreator + 运行时附加字段） |
| `CommunityData()` | `frontend/js/components/app-content/community/core:22` | 站点 + 创作者 + 作者 数据包 |
| `loadCommunityData()` | `frontend/js/components/app-content/community/core:32` | 加载站点 + 创作者数据（纯数据，不碰 DOM） 自动合并本地仓库提取的作者 |
| `fillSearch()` | `frontend/js/components/app-content/community/core:103` | 替换 {{q}} 为查询词 |
| `fetchCommunityCreators()` | `frontend/js/components/app-content/community/core:110` | 从 GitHub 社区索引拉取 creators.json |
| `mergeCommunityCreators()` | `frontend/js/components/app-content/community/core:169` | 合并社区索引到本地 creators.json |
| `fetchCommunitySites()` | `frontend/js/components/app-content/community/core:206` | 从 GitHub 拉取 workshop_sites.json（三路回退） |
| `mergeCommunitySites()` | `frontend/js/components/app-content/community/core:259` | 合并社区站点到本地 workshop_sites.json |
| `DEFAULT_COMMUNITY_URL()` | `frontend/js/components/app-content/community/core:280` | 社区索引的默认 URL（可配置为社区维护的独立 creators JSON） 贡献通道：https://github.com/eghrhegpe/ysm-model-manager |
| `getRepoModelsData()` | `frontend/js/components/app-content/community/core:286` | 获取仓库模型列表 + 本地映射 |
| `initDiagnostics()` | `frontend/js/components/app-content/community/diagnostics:15` | 初始化诊断页所有功能 |
| `startDedup()` | `frontend/js/components/app-content/community/diagnostics:161` | — |
| `initSettings()` | `frontend/js/components/app-content/community/settings:11` | 初始化设置页所有事件绑定 |
| `RepoAuthorLike()` | `frontend/js/components/app-content/community/site-view:35` | 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） |
| `RenderSiteViewCtx()` | `frontend/js/components/app-content/community/site-view:38` | 站点视图渲染上下文（index.ts _initWorkshop 传入） |
| `LocalCreatorLike()` | `frontend/js/components/app-content/community/site-view:55` | 本地创作者（绑定 + 运行时附加字段） |
| `renderSiteView()` | `frontend/js/components/app-content/community/site-view:135` | — |
| `PLATFORM_NAMES()` | `frontend/js/components/app-content/community/workshop-data:8` | — |
| `CreatorIdentity()` | `frontend/js/components/app-content/community/workshop-data:20` | 创作者身份识别结果 |
| `CreatorIdentityInput()` | `frontend/js/components/app-content/community/workshop-data:27` | 创作者输入（role/tag 可空，_fromLocal 为运行时附加字段） |
| `getCreatorIdentity()` | `frontend/js/components/app-content/community/workshop-data:34` | — |
| `getTagFromRole()` | `frontend/js/components/app-content/community/workshop-data:56` | — |
| `parseDescTags()` | `frontend/js/components/app-content/community/workshop-data:61` | — |
| `loadFavs()` | `frontend/js/components/app-content/community/workshop-data:71` | — |
| `saveFavs()` | `frontend/js/components/app-content/community/workshop-data:79` | — |
| `isFaved()` | `frontend/js/components/app-content/community/workshop-data:83` | — |
| `toggleFav()` | `frontend/js/components/app-content/community/workshop-data:87` | — |
| `ICONS()` | `frontend/js/components/app-content/community/workshop-icons:3` | — |
| `getSiteIcon()` | `frontend/js/components/app-content/community/workshop-icons:46` | — |
| `getTagIconFromRole()` | `frontend/js/components/app-content/community/workshop-icons:50` | — |
| `contentCSS()` | `frontend/js/components/app-content/content-css:2` | — |
| `repositoryHTML()` | `frontend/js/components/app-content/tpl:4` | — |
| `instancesHTML()` | `frontend/js/components/app-content/tpl:44` | — |
| `resourceLibraryHTML()` | `frontend/js/components/app-content/tpl:65` | — |
| `settingsHTML()` | `frontend/js/components/app-content/tpl:83` | — |
| `placeholderHTML()` | `frontend/js/components/app-content/tpl:424` | — |
| `downloadsHTML()` | `frontend/js/components/app-content/tpl:428` | — |
| `diagnosticsHTML()` | `frontend/js/components/app-content/tpl:479` | — |
| `recycleHTML()` | `frontend/js/components/app-content/tpl:531` | — |
| `githubHTML()` | `frontend/js/components/app-content/tpl:544` | ===== GitHub 仓库页面 ===== |
| `workshopHTML()` | `frontend/js/components/app-content/tpl:575` | — |
| `previewCSS()` | `frontend/js/components/app-preview/preview-css:2` | — |
| `showModelDetail()` | `frontend/js/components/app-preview/preview-detail:12` | 显示模型详情（YSM 模型） |
| `showResourcePack()` | `frontend/js/components/app-preview/preview-detail:100` | 显示资源包信息（pack.mcmeta + pack.png） |
| `showShaderPack()` | `frontend/js/components/app-preview/preview-detail:138` | 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 |
| `createLitematic3D()` | `frontend/js/components/app-preview/preview-litematic-3d:19` | — |
| `showLitematic()` | `frontend/js/components/app-preview/preview-litematic-meta:89` | 显示投影文件详情面板（tab 布局） |
| `loadModelData()` | `frontend/js/components/app-preview/preview-loader:11` | 加载模型几何数据 + 纹理 + 作者信息 统一路径：缓存 → WASM 解码 → Go AnalyzeBedrockModel 兜底 |
| `loadModel2D()` | `frontend/js/components/app-preview/preview-skeleton:27` | 加载模型 2D 骨骼线条图 + 统计面板 ctx = 组件实例（提供 this._root, this._appendDebug 等） |
| `devLog()` | `frontend/js/components/app-preview/preview-utils:6` | DEV 模式下输出调试日志 |
| `DecodedYsm()` | `frontend/js/components/app-preview/preview-utils:11` | WASM 解码结果（decodeYsmViaWasm 返回） |
| `PreviewCtx()` | `frontend/js/components/app-preview/preview-utils:26` | 预览上下文（index.ts AppPreview 类实现的接口，子模块以最小面引用） |
| `getPrefer3D()` | `frontend/js/components/app-preview/preview-utils:36` | — |
| `setPrefer3D()` | `frontend/js/components/app-preview/preview-utils:39` | — |
| `buildStdYsgpFromTextVariant()` | `frontend/js/components/app-preview/preview-utils:48` | 将带 UTF-8 BOM + 文本头部的 YSGP 变体重建为标准 YSGP 二进制格式 V2: 加密数据前有 16B 独立 hash 区 V3: 纯加密数据，无独立 hash 区 |
| `stripYsgpTextHeader()` | `frontend/js/components/app-preview/preview-utils:106` | 剥离 YSGP 文本头部，返回标准二进制格式 |
| `decodeYsmViaWasm()` | `frontend/js/components/app-preview/preview-wasm:25` | 通过前端 WASM 解码 .ysm，返回 { texture, geometry, animations } 不依赖组件实例（无 this 引用），可独立调用 |
| `openFullPreview()` | `frontend/js/components/app-preview/preview-zoom:6` | 全窗放大预览（独立函数，不依赖组件实例） |
| `ModelDetailMeta()` | `frontend/js/components/app-preview/tpl:5` | 模型统计元数据（modelDetailHTML 入参） |
| `modelDetailHTML()` | `frontend/js/components/app-preview/tpl:19` | 模型详情面板（仓库页面） |
| `StatsCardModel()` | `frontend/js/components/app-preview/tpl:57` | 模型统计卡片（statsCardHTML 入参的几何视图） |
| `statsCardHTML()` | `frontend/js/components/app-preview/tpl:66` | 模型统计卡片 |
| `BedrockCube()` | `frontend/js/components/app-preview/utils:4` | Bedrock 方块 |
| `BedrockBone()` | `frontend/js/components/app-preview/utils:15` | Bedrock 骨骼 |
| `BedrockGeometry()` | `frontend/js/components/app-preview/utils:30` | 解析后的 Bedrock geometry |
| `parseBedrockGeometryFromJSON()` | `frontend/js/components/app-preview/utils:53` | 从 JSON 字符串解析 Bedrock geometry |
| `AppResourceManager()` | `frontend/js/components/app-resource-manager/index:66` | — |
| `PackMetaDetail()` | `frontend/js/components/app-resource-manager/tpl:6` | 详情面板元数据（ReadPackMeta / ReadShaderpackLang 返回 JSON 的兼容视图） |
| `sidebarHTML()` | `frontend/js/components/app-resource-manager/tpl:19` | 侧栏布局（路径 + 操作栏 + 列表） |
| `itemHTML()` | `frontend/js/components/app-resource-manager/tpl:65` | 列表项 HTML |
| `detailHTML()` | `frontend/js/components/app-resource-manager/tpl:108` | 详情面板 HTML |
| `placeholderHTML()` | `frontend/js/components/app-resource-manager/tpl:171` | 空状态占位 |
| `bindInstanceActions()` | `frontend/js/components/app-sidebar/actions:7` | 绑定整合包卡片中的操作按钮和缺失条目点击事件 |
| `SidebarInstance()` | `frontend/js/components/app-sidebar/data:5` | sidebar 整合包实例（loader 转换后的渲染格式） |
| `fallbackInstances()` | `frontend/js/components/app-sidebar/data:29` | Go 不可用时的后备模拟数据 |
| `bindCardEvents()` | `frontend/js/components/app-sidebar/events:14` | — |
| `bindFooter()` | `frontend/js/components/app-sidebar/events:135` | — |
| `MmdVariantGroups()` | `frontend/js/components/app-sidebar/loader:23` | MMD 变体聚合结果 |
| `loadInstances()` | `frontend/js/components/app-sidebar/loader:30` | 从 Go 加载整合包实例列表，转换为 render 需要的格式 |
| `renderVersionCards()` | `frontend/js/components/app-sidebar/render:6` | — |
| `sidebarCSS()` | `frontend/js/components/app-sidebar/sidebar-css:3` | — |
| `headerHTML()` | `frontend/js/components/app-sidebar/tpl:15` | — |
| `footerHTML()` | `frontend/js/components/app-sidebar/tpl:34` | — |
| `listContainerHTML()` | `frontend/js/components/app-sidebar/tpl:57` | — |
| `vcHeaderHTML()` | `frontend/js/components/app-sidebar/tpl:76` | 单个整合包卡片头部。 |
| `AppSyncManager()` | `frontend/js/components/app-sync-manager/index:38` | — |
| `SyncItem()` | `frontend/js/components/app-sync-manager/tpl:6` | 同步列表项（GetInstanceSyncStatus 返回 JSON 条目） |
| `containerHTML()` | `frontend/js/components/app-sync-manager/tpl:18` | 容器骨架 |
| `statusTabHTML()` | `frontend/js/components/app-sync-manager/tpl:57` | 状态筛选标签 HTML |
| `itemHTML()` | `frontend/js/components/app-sync-manager/tpl:86` | 列表项 HTML |
| `emptyHTML()` | `frontend/js/components/app-sync-manager/tpl:150` | 空状态 HTML |
| `loadingHTML()` | `frontend/js/components/app-sync-manager/tpl:164` | 加载中 |
| `treeCSS()` | `frontend/js/components/app-tree-styles:3` | — |
| `AuthorInfo()` | `frontend/js/components/app-tree/authors:4` | 作者统计（Go ListModelAuthors 返回） |
| `loadAuthors()` | `frontend/js/components/app-tree/authors:12` | 从 Go 端加载作者列表 |
| `bindBusEvents()` | `frontend/js/components/app-tree/bus-handlers:16` | — |
| `selectState()` | `frontend/js/components/app-tree/data:4` | 多选状态 |
| `toggleSelect()` | `frontend/js/components/app-tree/data:17` | 切换选中状态（支持 Ctrl/Shift） |
| `updateSelectCount()` | `frontend/js/components/app-tree/events:13` | — |
| `bindTreeEvents()` | `frontend/js/components/app-tree/events:87` | — |
| `setPendingTreeSearch()` | `frontend/js/components/app-tree/index:17` | — |
| `takePendingTreeSearch()` | `frontend/js/components/app-tree/index:20` | — |
| `AppTree()` | `frontend/js/components/app-tree/index:46` | — |
| `initInstanceActions()` | `frontend/js/components/app-tree/instance-actions:29` | — |
| `TreeEntry()` | `frontend/js/components/app-tree/loader:10` | 树条目（loader 转换后的渲染格式） |
| `loadEntries()` | `frontend/js/components/app-tree/loader:23` | 从 Go 后端加载仓库文件列表，返回格式化的 entries |
| `TreeRow()` | `frontend/js/components/app-tree/render:21` | 扁平化行（虚拟滚动数据单元） |
| `RenderMode()` | `frontend/js/components/app-tree/render:37` | 渲染模式 |
| `getRenderMode()` | `frontend/js/components/app-tree/render:43` | Get render mode from localStorage, default to 'grid' |
| `setRenderMode()` | `frontend/js/components/app-tree/render:53` | Set render mode to localStorage |
| `renderTree()` | `frontend/js/components/app-tree/render:289` | — |
| `updateStat()` | `frontend/js/components/app-tree/render:353` | — |
| `listFileRowHTML()` | `frontend/js/components/app-tree/row-tpl-list:7` | 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） |
| `listFolderRowHTML()` | `frontend/js/components/app-tree/row-tpl-list:30` | 文件夹行 HTML（紧凑列表模式：arrow + folder icon + name） |
| `fileRowHTML()` | `frontend/js/components/app-tree/row-tpl:7` | 文件行 HTML（indent = padding-left，rowCls 用于选中高亮等行级类） |
| `folderRowHTML()` | `frontend/js/components/app-tree/row-tpl:36` | 文件夹行 HTML（indent = padding-left，扁平化无 .ch 容器） |
| `bindToolbarEvents()` | `frontend/js/components/app-tree/toolbar-events:208` | — |
| `headerHTML()` | `frontend/js/components/app-tree/tpl:3` | — |
| `footerHTML()` | `frontend/js/components/app-tree/tpl:27` | — |
| `emptyHTML()` | `frontend/js/components/app-tree/tpl:35` | — |
| `spinnerHTML()` | `frontend/js/components/app-tree/tpl:39` | — |
| `flashBtn()` | `frontend/js/components/app-tree/utils:4` | — |
| `ROW_H_GRID()` | `frontend/js/components/app-tree/virtual-scroll:3` | — |
| `ROW_H_LIST()` | `frontend/js/components/app-tree/virtual-scroll:4` | — |
| `calcVisibleRange()` | `frontend/js/components/app-tree/virtual-scroll:14` | 根据滚动位置计算可见行范围（支持动态行高） |
| `installScrollSync()` | `frontend/js/components/app-tree/virtual-scroll:31` | 在容器上安装滚动监听，当滚动到新范围时自动重新渲染可见行 |

## 前端·核心

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `registerContextMenus()` | `frontend/js/core/context-menus:400` | 注册右键菜单映射（ctx:show → menu:show） |
| `registerGlobalHandlers()` | `frontend/js/core/global-handlers:10` | 注册所有全局 handler，返回 unsub 函数数组 |
| `registerDnD()` | `frontend/js/core/handler-dnd:272` | 注册 DnD 全局事件，push 返回的取消订阅函数到 unsubs |
| `registerInstanceOps()` | `frontend/js/core/handler-other:8` | 注册整合包操作 handler，push 返回的取消订阅函数到 unsubs |
| `registerSync()` | `frontend/js/core/handler-sync:8` | 注册同步 handler，push 返回的取消订阅函数到 unsubs |
| `MenuDef()` | `frontend/js/core/menu-defs:18` | 单类菜单的完整声明 |
| `MENU_DEFS()` | `frontend/js/core/menu-defs:24` | 四类右键菜单的声明式规格（唯一事实来源） |
| `getMenuDef()` | `frontend/js/core/menu-defs:109` | 测试辅助：按 type 取声明（不存在返回 undefined） |
| `PageName()` | `frontend/js/core/page-store:8` | 页面名（宽松字符串，核心页见 AGENTS.md TERMINOLOGY） |
| `PageStore()` | `frontend/js/core/page-store:10` | — |

## 前端·对话框

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `AdvFilterValue()` | `frontend/js/dialogs/adv-filter:11` | 筛选条件 |
| `AdvFilterResult()` | `frontend/js/dialogs/adv-filter:22` | — |
| `modalAdvFilter()` | `frontend/js/dialogs/adv-filter:29` | 弹出高级筛选弹窗 |
| `BatchRenameChange()` | `frontend/js/dialogs/batch-rename:16` | 应用变更载荷 |
| `showBatchRenameDialog()` | `frontend/js/dialogs/batch-rename:45` | 弹出批量重命名对话框 重复打开时先结算上一个 Promise，调用方 await 不会永远悬挂 |
| `esc()` | `frontend/js/dialogs/modal:12` | — |
| `closeDlg()` | `frontend/js/dialogs/modal:27` | 带退场动画关闭对话框 |
| `registerDlg()` | `frontend/js/dialogs/modal:51` | 弹窗 append 到 body 后调用，登记为当前活动弹窗 |
| `ModalPromptOptions()` | `frontend/js/dialogs/modal:58` | modalPrompt 选项 |
| `modalPrompt()` | `frontend/js/dialogs/modal:71` | 弹出带输入框的模态框，类似 styled prompt() |
| `ModalSelectOptions()` | `frontend/js/dialogs/modal:135` | modalSelect 选项 |
| `modalSelect()` | `frontend/js/dialogs/modal:148` | 弹出下拉选择框 |
| `ModalConfirmOptions()` | `frontend/js/dialogs/modal:205` | modalConfirm 选项 |
| `modalConfirm()` | `frontend/js/dialogs/modal:219` | 弹出确认对话框 |
| `showRenameDialog()` | `frontend/js/dialogs/rename:13` | 弹出重命名对话框 |
| `modalTagEditor()` | `frontend/js/dialogs/tag-editor:13` | 弹出标签编辑弹窗 |

## 前端·特性

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `showProgress()` | `frontend/js/features/community/data:7` | 创建进度条 UI（插入到 searchResults 容器） |
| `FetchModelsResult()` | `frontend/js/features/community/data:31` | 抓取结果 |
| `tryFetchModels()` | `frontend/js/features/community/data:44` | 从 GitHub 获取 index.json（并发竞速：同时请求所有镜像源，取最快响应） |
| `DownloadTask()` | `frontend/js/features/community/download-queue:15` | 下载任务 |
| `QueueError()` | `frontend/js/features/community/download-queue:23` | 队列错误项 |
| `DownloadState()` | `frontend/js/features/community/download-queue:29` | 队列状态快照 |
| `subscribe()` | `frontend/js/features/community/download-queue:63` | 订阅 STATE 变更。返回取消订阅函数。 |
| `getState()` | `frontend/js/features/community/download-queue:75` | 当前状态的只读快照 |
| `resume()` | `frontend/js/features/community/download-queue:84` | 页面切回时调用，从 Go 端恢复当前队列状态。 |
| `enqueueDownloads()` | `frontend/js/features/community/download-queue:123` | 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。 |
| `cancelDownloads()` | `frontend/js/features/community/download-queue:149` | 模块级取消 — 纯粹的 Go 调用。 |
| `QueueControllerOptions()` | `frontend/js/features/community/download-queue:247` | createDownloadQueue 选项 |
| `QueueController()` | `frontend/js/features/community/download-queue:256` | 队列控制器 |
| `createDownloadQueue()` | `frontend/js/features/community/download-queue:269` | 创建一个下载队列 UI 控制器。 |
| `RepoEventsContext()` | `frontend/js/features/community/events:10` | bindRepoEvents 上下文 |
| `RepoEventsHandle()` | `frontend/js/features/community/events:22` | 绑定返回值 |
| `bindRepoEvents()` | `frontend/js/features/community/events:35` | 绑定仓库模型页面的所有事件。 |
| `WorkshopModel()` | `frontend/js/features/community/render:8` | 工坊模型条目（index.json 结构） |
| `WorkshopSite()` | `frontend/js/features/community/render:16` | 工坊站点 |
| `isModelMissing()` | `frontend/js/features/community/render:26` | 判断模型是否缺失（本地不存在） |
| `countMissing()` | `frontend/js/features/community/render:42` | 计算缺失数量 |
| `renderModelList()` | `frontend/js/features/community/render:87` | 渲染模型列表（DocumentFragment） |
| `GROUP_LABELS()` | `frontend/js/features/community/render:170` | 分组标签映射 |
| `renderCardsHTML()` | `frontend/js/features/community/render:181` | 生成左栏站点卡片 HTML |
| `renderRepoHeaderHTML()` | `frontend/js/features/community/render:235` | 生成仓库模型页面的头部 HTML（含返回按钮、计数、筛选按钮等） |
| `DnDLock()` | `frontend/js/features/dnd-state:7` | — |
| `PendingImport()` | `frontend/js/features/dnd-state:25` | — |
| `ImportQueueHost()` | `frontend/js/features/import-queue:18` | app-content 组件实例（initImportQueue 依赖的成员） |
| `initImportQueue()` | `frontend/js/features/import-queue:51` | 初始化导入队列，返回清理函数 |
| `loadOldestModel()` | `frontend/js/features/oldest-models:24` | 加载资历最深、仓库评分、热力图和每日推荐 |
| `RecycleHost()` | `frontend/js/features/recycle-bin:9` | app-content 组件实例（initRecycleBin 依赖的成员） |
| `initRecycleBin()` | `frontend/js/features/recycle-bin:16` | 初始化回收站管理，返回清理函数 |
| `initResourcePacks()` | `frontend/js/features/resource-packs:13` | 初始化资源包 tab |
| `UpdateInfo()` | `frontend/js/features/version-updater:7` | 更新信息（CheckUpdate 返回） |
| `checkUpdateSilent()` | `frontend/js/features/version-updater:131` | 启动时静默检查更新（受 6h 频次限制） 有新版本则在右下角显示可点击的 toast 通知 |
| `initVersionUpdater()` | `frontend/js/features/version-updater:155` | 手动检查更新（设置页按钮） |

## 前端·服务

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `RegistrySchema()` | `frontend/js/services/registry:10` | — |
| `register()` | `frontend/js/services/registry:21` | 注册一个服务（.ts 调用方：register("name", impl as X) 声明类型） |
| `get()` | `frontend/js/services/registry:26` | 获取一个服务（.ts 调用方：get&lt;X&gt;("name") 断言期望类型） |
| `has()` | `frontend/js/services/registry:33` | 检查服务是否已注册 |
| `unregister()` | `frontend/js/services/registry:38` | 注销（测试用） |
| `clear()` | `frontend/js/services/registry:43` | 清空所有（测试用） |

## 前端·工具

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `animateNumber()` | `frontend/js/utils/animate:11` | 里程表滚动进位动画 |
| `BoneNode()` | `frontend/js/utils/animation-player:6` | 骨骼层级节点（用于层级变换传播） |
| `AnimationPlayer()` | `frontend/js/utils/animation-player:11` | — |
| `Vec3()` | `frontend/js/utils/animation:9` | 三维向量 [x, y, z] |
| `Keyframe()` | `frontend/js/utils/animation:12` | 关键帧 |
| `BoneChannels()` | `frontend/js/utils/animation:20` | 单骨骼三通道 |
| `AnimationClip()` | `frontend/js/utils/animation:27` | 动画剪辑 |
| `BoneTransform()` | `frontend/js/utils/animation:36` | 骨骼变换（evaluateClip 结果值） |
| `BoneHierarchyNode()` | `frontend/js/utils/animation:43` | 骨骼层级节点 |
| `parseBedrockAnimationJSON()` | `frontend/js/utils/animation:193` | 解析完整的基岩版动画 JSON 字符串 |
| `evaluateKeyframes()` | `frontend/js/utils/animation:290` | 在指定时间 t 对一组关键帧求值 |
| `evaluateClip()` | `frontend/js/utils/animation:334` | 对整个动画 clip 在指定时间求值（支持骨骼层级） |
| `addExportButton()` | `frontend/js/utils/canvas-export:9` | 在 canvas 下方附加"导出 PNG"按钮 |
| `PREVIEW_CANVAS_SIZE()` | `frontend/js/utils/constants:4` | 骨骼预览 Canvas 尺寸 |
| `FULL_PREVIEW_CANVAS_SIZE()` | `frontend/js/utils/constants:5` | — |
| `DEFAULT_TEX_SIZE()` | `frontend/js/utils/constants:8` | 纹理尺寸默认值 |
| `LABEL_MAX_WIDTH()` | `frontend/js/utils/constants:11` | 骨骼名标注最大文本宽度阈值 |
| `ZOOM_MIN()` | `frontend/js/utils/constants:14` | 缩放范围 |
| `ZOOM_MAX()` | `frontend/js/utils/constants:15` | — |
| `ZOOM_STEP()` | `frontend/js/utils/constants:16` | — |
| `ZOOM_STEP_WHEEL()` | `frontend/js/utils/constants:17` | — |
| `ROTATION_PER_PX()` | `frontend/js/utils/constants:20` | 旋转增量（度/像素拖拽） |
| `MINI_MAP_SIZE()` | `frontend/js/utils/constants:23` | 预览缩略图尺寸 |
| `MAX_LOG_ITEMS()` | `frontend/js/utils/constants:26` | 日志最大显示条数 |
| `STUCK_GUARD_DELAY()` | `frontend/js/utils/constants:29` | 下载队列 |
| `COMPLETE_TIMEOUT()` | `frontend/js/utils/constants:30` | — |
| `ANIMATE_MAX_STEPS()` | `frontend/js/utils/constants:33` | 数字跳动动画 |
| `ANIMATE_INTERVAL_MS()` | `frontend/js/utils/constants:34` | — |
| `dbg()` | `frontend/js/utils/debug:31` | 输出调试日志（保留 tag 用于过滤） |
| `dbgWarn()` | `frontend/js/utils/debug:48` | 输出警告（即使关闭调试也保留） |
| `ParsedModelName()` | `frontend/js/utils/display:5` | 解析后的模型文件名字段 |
| `parseModelName()` | `frontend/js/utils/display:27` | 解析模型文件名 → 结构化字段 支持格式: [作者]【作品】角色变体2023-05.ysm 也兼容: [作者]《作品》角色变体2023-05.ysm |
| `renderDisplayName()` | `frontend/js/utils/display:87` | 渲染美化文件名 HTML（通用接口） 应用 CSS 变量: --meta-author, --meta-work, --meta-date |
| `renderModelName()` | `frontend/js/utils/display:165` | renderModelName = renderDisplayName 别名，options.showExt 支持 |
| `renderModelNameWithHighlight()` | `frontend/js/utils/display:174` | 搜索高亮版 |
| `esc()` | `frontend/js/utils/dom:4` | HTML 转义（治理红线：所有 innerHTML 拼接必须过 esc） |
| `hl()` | `frontend/js/utils/dom:16` | 关键词高亮：转义 + &lt;mark&gt; 包裹命中段 |
| `friendlyError()` | `frontend/js/utils/errors:9` | 将 Go 错误转换为中文友好提示 |
| `RESOURCE_EXTS()` | `frontend/js/utils/extensions:8` | 每种资源类型对应的扩展名 |
| `ALL_EXTS()` | `frontend/js/utils/extensions:19` | 所有支持的扩展名列表（去重，用于 UI 提示文案） |
| `getExts()` | `frontend/js/utils/extensions:34` | 获取某资源类型支持的扩展名 |
| `isSupportedExt()` | `frontend/js/utils/extensions:39` | 检查扩展名是否被某资源类型支持 |
| `extBelongsTo()` | `frontend/js/utils/extensions:44` | 返回扩展名所属的资源类型 ID |
| `fmt()` | `frontend/js/utils/fmt:4` | 字节数 → 可读大小（B/KB/MB），非法值返回空串 |
| `sizeColor()` | `frontend/js/utils/fmt:12` | 文件大小颜色 class：&lt;1MB 绿色，1-3MB 正常，&gt;3MB 红色 |
| `fmtDate()` | `frontend/js/utils/fmt:22` | 时间戳 → 友好日期：今天显时间，今年显 M月D日，往年显 YYYY/M/D |
| `fileIcon()` | `frontend/js/utils/icon:9` | 按扩展名返回图标 emoji |
| `isYsmName()` | `frontend/js/utils/icon:28` | 是否为 YSM 文件 |
| `renderFormattedText()` | `frontend/js/utils/mc-format:51` | 将含 Minecraft § 分节符的文本渲染为带颜色的 HTML。 |
| `BedrockCube()` | `frontend/js/utils/model2d:8` | Bedrock cube（AnalyzeBedrockModel 结构） |
| `BedrockBone()` | `frontend/js/utils/model2d:18` | Bedrock bone |
| `BedrockModel()` | `frontend/js/utils/model2d:24` | BedrockModel（AnalyzeBedrockModel 返回） |
| `Model2DOptions()` | `frontend/js/utils/model2d:29` | renderModel2D 选项 |
| `renderModel2D()` | `frontend/js/utils/model2d:59` | 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转） |
| `calcBoneHitZones()` | `frontend/js/utils/model2d:249` | 计算骨骼在屏幕上的命中热区（2D 正交投影，供鼠标拾取；导出供测试） |
| `ModelLike()` | `frontend/js/utils/model3d-loader:7` | 模型对象（轻量接口，覆盖 loadTextures/fetchSpec/preloadModel 用到的字段） |
| `ModelSpec()` | `frontend/js/utils/model3d-loader:15` | Go 返回的 3D spec（models 数组） |
| `loadTextures()` | `frontend/js/utils/model3d-loader:31` | 并行加载纹理 URL 列表，返回 THREE.Texture 数组 |
| `fetchSpec()` | `frontend/js/utils/model3d-loader:85` | 获取模型 spec（Go 绑定优先，JS 几何兜底） |
| `preloadModel()` | `frontend/js/utils/model3d-loader:107` | 预加载：纹理 + spec 并行获取 |
| `SpecCube()` | `frontend/js/utils/model3d-spec:10` | 立方体（骨骼上的 box 元素） |
| `SpecBone()` | `frontend/js/utils/model3d-spec:20` | 骨骼 |
| `SpecModelInput()` | `frontend/js/utils/model3d-spec:28` | 模型输入（buildSpecFromModel 参数） |
| `SpecBuildResult()` | `frontend/js/utils/model3d-spec:35` | 构建产物：mesh data + bones |
| `SpecMeshData()` | `frontend/js/utils/model3d-spec:43` | 单 mesh 数据（Go spec meshGroups 结构近似） |
| `buildSpecFromModel()` | `frontend/js/utils/model3d-spec:64` | 构建 Three.js 可消费的 spec 结构 { bones[], meshes[] } |
| `eulerToQuaternionJS()` | `frontend/js/utils/model3d-spec:335` | 欧拉角（度）→ 四元数（保留：历史工具函数，当前无引用） |
| `SpecBone3D()` | `frontend/js/utils/model3d:7` | — |
| `SpecMeshGroup3D()` | `frontend/js/utils/model3d:15` | — |
| `SpecModelGroup3D()` | `frontend/js/utils/model3d:27` | — |
| `Spec3D()` | `frontend/js/utils/model3d:32` | — |
| `BoneSelectInfo()` | `frontend/js/utils/model3d:37` | 骨骼选中信息（window._3dOnBoneSelect 回调参数） |
| `RenderModel3DHandle()` | `frontend/js/utils/model3d:51` | renderModel3D 返回的渲染句柄 |
| `buildSceneMesh()` | `frontend/js/utils/model3d:72` | 构建骨骼层级场景（bone group 树），返回组映射与根节点 |
| `renderModel3D()` | `frontend/js/utils/model3d:128` | 渲染 3D 模型到容器，返回控制句柄 |
| `screenshotPreview()` | `frontend/js/utils/model3d:735` | 截取当前 3D 预览画面（PNG base64，无 data: 前缀），无渲染器时返回 null |
| `PackMeta()` | `frontend/js/utils/pack-format:123` | ReadPackMeta 返回的 JSON 对象（仅覆盖用到的字段） |
| `formatVersion()` | `frontend/js/utils/pack-format:134` | 根据 pack_format 数值获取可读 Minecraft 版本描述 |
| `describeVersionRange()` | `frontend/js/utils/pack-format:142` | 根据 meta 对象生成格式号 + 版本号描述 |
| `CacheValue()` | `frontend/js/utils/preview-cache:10` | 缓存条目值 |
| `cacheSetEvictHandler()` | `frontend/js/utils/preview-cache:39` | 注册 evict 回调，淘汰条目时调用 |
| `cacheGet()` | `frontend/js/utils/preview-cache:43` | — |
| `cacheSet()` | `frontend/js/utils/preview-cache:47` | — |
| `cacheHas()` | `frontend/js/utils/preview-cache:66` | — |
| `cacheDelete()` | `frontend/js/utils/preview-cache:70` | — |
| `cacheClear()` | `frontend/js/utils/preview-cache:78` | — |
| `cacheKeys()` | `frontend/js/utils/preview-cache:89` | — |
| `cacheValues()` | `frontend/js/utils/preview-cache:93` | — |
| `cacheEntries()` | `frontend/js/utils/preview-cache:97` | — |
| `cacheSize()` | `frontend/js/utils/preview-cache:102` | 缓存大小 |
| `ResourceTypeEntry()` | `frontend/js/utils/resource-registry:6` | 资源类型注册表条目（对应 resource_types.json 结构） |
| `loadResourceRegistry()` | `frontend/js/utils/resource-registry:19` | 加载资源类型注册表 |
| `getResourceType()` | `frontend/js/utils/resource-registry:36` | 获取某资源类型的注册表条目 |
| `getStorageSubDir()` | `frontend/js/utils/resource-registry:41` | 获取存储子目录（对应 resource_types.json 的 storageSubDir 字段） |
| `RESOURCE_TYPES()` | `frontend/js/utils/resource-types:4` | 资源类型 ID（键为类型标签，值为内部 ID） |
| `RESOURCE_TYPE_LABELS()` | `frontend/js/utils/resource-types:15` | 资源类型显示标签（内部 ID → 中文名） |
| `ALL_RESOURCE_TYPES()` | `frontend/js/utils/resource-types:26` | 全部资源类型 ID 列表 |
| `AngleShot()` | `frontend/js/utils/screenshot-renderer:7` | — |
| `BatchResult()` | `frontend/js/utils/screenshot-renderer:12` | — |
| `renderMultiAngle()` | `frontend/js/utils/screenshot-renderer:19` | — |
| `batchRepoScreenshots()` | `frontend/js/utils/screenshot-renderer:138` | — |
| `stagger()` | `frontend/js/utils/stagger:11` | — |
| `SummaryAuthor()` | `frontend/js/utils/summarize:8` | — |
| `SummaryAnimGroup()` | `frontend/js/utils/summarize:14` | — |
| `SummaryConfigMenu()` | `frontend/js/utils/summarize:20` | — |
| `YsmSummary()` | `frontend/js/utils/summarize:25` | — |
| `YSMHeader()` | `frontend/js/utils/summarize:50` | — |
| `summaryCardHTML()` | `frontend/js/utils/summarize:151` | 从 YsmSummary + YSMHeader 渲染为精简摘要卡片 |

## 前端·Wails 桥接

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `getApp()` | `frontend/js/wails/app:10` | 获取 Go App 绑定的缓存引用，避免重复动态 import |
| `resetAppCache()` | `frontend/js/wails/app:17` | 重置缓存（测试用） |

## 前端·WASM

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `_getGlueCode()` | `frontend/js/wasm/ysm-glue-data:4` | — |
| `YsmDecodedFile()` | `frontend/js/wasm/ysm-parser:46` | 解码输出文件 |
| `initYSMParser()` | `frontend/js/wasm/ysm-parser:55` | — |
| `decodeYsmFileFromMemory()` | `frontend/js/wasm/ysm-parser:135` | 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组） 返回 [{path, data}]，失败返回 null |
| `decodeYsmFile()` | `frontend/js/wasm/ysm-parser:174` | 通过 callMain + MEMFS 解码 .ysm（回退路径） 保留以兼容旧的 WASM 编译 |
| `_getWasmBinary()` | `frontend/js/wasm/ysm-wasm-data:4` | — |

---

> 说明列由 funcmap 自动提取导出符号紧邻 JSDoc/注释的首句摘要（无注释则留 —）。
> Go 方法记为 `Type.Method`；符号列统一以 `()` 结尾（与 MikuMikuAR 约定一致）。