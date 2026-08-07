# 函数映射表

> AI 找代码用。改功能前先 grep 此表定位文件:行。
> **自动生成** — 由 `scripts/funcmap.mjs` 生成（提取 Go/JS/TS 导出符号，参考 MikuMikuAR docs/function-map.md 风格）。

## 总览

| 模块 | 文件数 | 导出符号数 |
|------|--------|-----------|
| Go·头像 | 1 | 8 |
| Go·去重 | 1 | 5 |
| Go·下载 | 1 | 7 |
| Go·错误 | 1 | 1 |
| go/fileops | 2 | 13 |
| Go·文件系统 | 1 | 4 |
| Go·几何 | 2 | 5 |
| Go·导入 | 2 | 15 |
| Go·安装 | 1 | 6 |
| go/instance | 1 | 2 |
| Go·Litematic | 4 | 9 |
| Go·日志 | 2 | 11 |
| Go·包管理 | 1 | 3 |
| Go·路径 | 1 | 4 |
| Go·回收站 | 2 | 19 |
| go/scanner | 1 | 8 |
| Go·同步 | 3 | 21 |
| Go·标签 | 1 | 8 |
| Go·Three.js | 1 | 5 |
| Go·类型 | 5 | 49 |
| Go·更新器 | 1 | 8 |
| Go·监听 | 1 | 6 |
| Go·YSM 核心 | 7 | 22 |
| Go(internal)·应用入口 | 15 | 170 |
| 前端·根 (app-modules/bus) | 1 | 10 |
| 前端·核心 | 8 | 13 |
| 前端·特性 | 12 | 49 |
| 前端·服务 | 1 | 6 |
| frontend/test-utils | 4 | 32 |
| 前端·工具 | 25 | 91 |
| frontend/views | 52 | 143 |
| 前端·Wails 桥接 | 1 | 1 |
| 前端·WASM | 3 | 6 |
| **合计** | **165** | **760** |

## Go·头像

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SafeName()` | `go/avatar/avatar:35` | SafeName 将非法文件名字符替换为下划线。 |
| `ReadCachedAvatar()` | `go/avatar/avatar:86` | ReadCachedAvatar 读取缓存中的头像，返回 data URI。 |
| `SaveAvatarData()` | `go/avatar/avatar:100` | SaveAvatarData 将头像数据写入缓存。 |
| `DecodeOneAvatar()` | `go/avatar/avatar:112` | DecodeOneAvatar 从模型文件中提取指定所有者的头像。 |
| `CacheAvatarsFromJSON()` | `go/avatar/avatar:254` | CacheAvatarsFromJSON 从解压目录的 ysm.json 缓存所有作者头像。 |
| `ReadFileFromZip()` | `go/avatar/avatar:304` | ReadFileFromZip 从 ZIP 读取指定路径的文件。 |
| `SetNodeJS()` | `go/avatar/avatar:332` | SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数。 |
| `DecodeYSMFiles()` | `go/avatar/avatar:339` | DecodeYSMFiles 底层解码，返回完整文件列表。 |

## Go·去重

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `FindDuplicateFiles()` | `go/dedup/dedup:32` | FindDuplicateFiles 扫描目录，按 SHA256 哈希分组，返回包含重复的分组 skipRecycle 为 true 时跳过 .recycle 子目录 |
| `CountDuplicates()` | `go/dedup/dedup:124` | CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数） |
| `CleanEmptyDirs()` | `go/dedup/dedup:182` | CleanEmptyDirs 递归删除指定目录下的所有空子目录（不含 dir 自身）。 |
| `FileEntry()` | `go/dedup/dedup:16` | FileEntry 文件条目 |
| `Group()` | `go/dedup/dedup:24` | Group 重复文件分组 |

## Go·下载

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `New()` | `go/download/downloader:36` | New 创建 Downloader，默认 5 分钟超时。 |
| `NewWithClient()` | `go/download/downloader:41` | NewWithClient 使用指定 HTTP client。 |
| `Downloader.File()` | `go/download/downloader:132` | File 从 URL 下载文件到 savePath，支持进度回调。ctx 取消/超时即中断下载。 |
| `Downloader.FromGitHubAPI()` | `go/download/downloader:137` | FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。ctx 取消/超时即中断下载。 |
| `ResolveSavePath()` | `go/download/downloader:142` | ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。 |
| `ProgressFn()` | `go/download/downloader:27` | ProgressFn 下载进度回调。downloaded / total 为字节数。 |
| `Downloader()` | `go/download/downloader:30` | Downloader 文件下载器。 |

## Go·错误

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Friendly()` | `go/errors/errors:11` | Friendly 将错误转换为用户能看懂的中文提示。 |

## go/fileops

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `CreateDir()` | `go/fileops/fileops:28` | CreateDir 在 root 下创建子目录（校验非法字符，与 RenameDir 对齐） |
| `RenameDir()` | `go/fileops/fileops:44` | RenameDir 重命名目录（仅改末段，保持父目录） |
| `RemoveDir()` | `go/fileops/fileops:64` | RemoveDir 递归删除目录 |
| `RenameFile()` | `go/fileops/fileops:69` | RenameFile 重命名文件（校验非法字符；ysm.json 为模型目录清单，禁止改名） |
| `FindPreviewImage()` | `go/fileops/fileops:90` | FindPreviewImage 查找模型同目录的预览图并转 data URI |
| `ExtractPreviewTexture()` | `go/fileops/fileops:116` | ExtractPreviewTexture 从模型文件中提取预览纹理（zip/7z/ysm/json） |
| `GetPackInfo()` | `go/fileops/fileops:239` | GetPackInfo 读取 ysm-pack.json（root 为空时按绝对路径处理） |
| `MoveModelFile()` | `go/fileops/fileops:287` | MoveModelFile 移动 src 到 dstDir（保留原名） ADR-038 D3：src 为 ysm.json 时提升为移动整个模型目录（整组语义）；目录直接整组移动 |
| `CopyModelFile()` | `go/fileops/fileops:311` | CopyModelFile 复制 src 到 dstDir（root 用于路径安全校验，空则跳过校验） ADR-038 D3：支持目录递归复制（含 .ban 状态文件）；src 为 |
| `DeleteModelFile()` | `go/fileops/fileops:416` | DeleteModelFile 删除模型（目录感知，ADR-038 D3.6）： src 为 ysm.json 时删除整个模型目录（整组语义——包内 geometry/animat |
| `ToggleModelEnable()` | `go/fileops/fileops:453` | ToggleModelEnable 切换 .ban 状态文件（返回是否处于启用态；缓存失效由薄壳处理） ADR-038 D3.7：src 为 ysm.json 时提升为父目录级 . |
| `IsFileBanned()` | `go/fileops/fileops:522` | IsFileBanned 判断路径是否被 .ban 标记（文件级或目录级，ADR-038 D3.7） |
| `WriteModelFolder()` | `go/fileops/folder_import:19` | WriteModelFolder 写入文件夹整组到仓库（YSM 解压目录或普通模型文件夹）。 |

## Go·文件系统

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `WalkAllFiles()` | `go/fsutil/walk:13` | WalkAllFiles 递归遍历目录返回所有文件的完整路径（不限制扩展名） skipRecycle 为 true 时跳过 .recycle 子目录 |
| `WalkAllDirs()` | `go/fsutil/walk:38` | WalkAllDirs 递归遍历目录，返回所有子目录路径（广度优先，后序遍历用） 不包含根目录本身，按深度优先顺序（后序：子目录在前，父目录在后） |
| `CountFiles()` | `go/fsutil/walk:67` | CountFiles 统计目录中的文件数（不限制扩展名） |
| `CleanEmptyDirs()` | `go/fsutil/walk:72` | CleanEmptyDirs 递归删除空子目录，返回删除数 |

## Go·几何

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ExtractFirstPNGFromZip()` | `go/geometry/archive:36` | ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览） |
| `ExtractFirstPNGFrom7z()` | `go/geometry/archive:57` | ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览） |
| `ParseFromZip()` | `go/geometry/archive:78` | ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画 |
| `ParseFrom7z()` | `go/geometry/archive:364` | ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理 |
| `ParseBedrockGeometry()` | `go/geometry/parse:17` | ParseBedrockGeometry 解析标准 Bedrock geometry JSON（minecraft:geometry 格式） 注意：data 大小不应超过 maxP |

## Go·导入

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ImportFromBase64()` | `go/importer/importer_file:28` | ImportFromBase64 从 base64 导入模型文件（校验 + 类型检测 + 写文件） rootFn 按资源类型返回仓库根目录（薄壳注入 a.GetRepoRoot） |
| `DetectZipType()` | `go/importer/importer_file:101` | DetectZipType 扫描 ZIP local file header 中的文件名识别资源类型 |
| `ImportOptions()` | `go/importer/importer_file:18` | ImportOptions 导入选项 |
| `ImportLogger()` | `go/importer/importer_file:24` | ImportLogger 导入日志回调（薄壳注入 App.logger.Add） |
| `Register()` | `go/importer/importer:31` | Register 注册导入策略 |
| `Get()` | `go/importer/importer:36` | Get 获取指定类型的导入策略 |
| `NewSimpleCopy()` | `go/importer/importer:62` | NewSimpleCopy 创建简单文件复制导入器 |
| `SimpleCopyImporter.Type()` | `go/importer/importer:66` | — |
| `SimpleCopyImporter.Import()` | `go/importer/importer:68` | — |
| `NewDirectoryCopy()` | `go/importer/importer:214` | NewDirectoryCopy 创建文件夹复制导入器 |
| `DirectoryCopyImporter.Type()` | `go/importer/importer:218` | — |
| `DirectoryCopyImporter.Import()` | `go/importer/importer:223` | Import 复制源文件夹到目标目录 srcPath 可以是文件夹内任意文件路径，也可以是文件夹本身 若 srcPath 是文件则取父目录，若是目录则直接使用 |
| `Handler()` | `go/importer/importer:21` | Handler 资源导入策略接口 |
| `SimpleCopyImporter()` | `go/importer/importer:57` | — |
| `DirectoryCopyImporter()` | `go/importer/importer:209` | — |

## Go·安装

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Install()` | `go/installer/installer:41` | Install 安装模型到目标目录（支持链接模式） |
| `InstallDir()` | `go/installer/installer:105` | InstallDir 安装整个目录下的所有文件到目标目录（支持链接模式） 用于 MMD/VRC 模型，.pmx/.pmd 文件所在文件夹包含纹理等配套文件 rtype 用于过滤文件 |
| `InstallToGlobal()` | `go/installer/installer:204` | InstallToGlobal 安装到全局 custom 目录 |
| `InstallWithOverlay()` | `go/installer/installer:229` | InstallWithOverlay 带冲突检查的安装 |
| `CopyFile()` | `go/installer/installer:306` | CopyFile 复制文件到目标目录（带互斥锁） |
| `IsValidRepoRoot()` | `go/installer/installer:439` | IsValidRepoRoot 禁止选择系统敏感目录作为仓库 跨平台实现：禁止根目录、系统关键目录 |

## go/instance

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BuildSyncItems()` | `go/instance/instance:23` | BuildSyncItems 组装整合包内各资源类型的同步状态项（纯逻辑，root 由调用方注入） |
| `ResourceTypeInfo()` | `go/instance/instance:16` | ResourceTypeInfo 资源类型注册表条目（BuildSyncItems 需要的字段） |

## Go·Litematic

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `MapColor()` | `go/litematic/block_colors:10` | MapColor 返回 minecraft 方块名对应的近似十六进制颜色。 |
| `ResolveBlockName()` | `go/litematic/block_ids:12` | ResolveBlockName 把旧版数字 ID（schematic v1）解析为注册名。 |
| `ResolveBlockZH()` | `go/litematic/block_ids:26` | ResolveBlockZH 把注册名映射为中文名（自动去除 minecraft: 前缀）。 |
| `ParseMeta()` | `go/litematic/parser:14` | — |
| `ParseSchematic()` | `go/litematic/parser:173` | — |
| `ParseNbtStructure()` | `go/litematic/parser:267` | — |
| `BuildVoxelData()` | `go/litematic/voxel:91` | BuildVoxelData 构建体素渲染数据（按颜色分组） |
| `BuildNbtVoxelData()` | `go/litematic/voxel:230` | — |
| `BuildSchematicVoxelData()` | `go/litematic/voxel:320` | — |

## Go·日志

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewLogger()` | `go/logs/logs:22` | NewLogger 创建日志管理器 使用系统标准的应用配置目录（Windows: %APPDATA%, Linux: ~/.config, macOS: ~/Library/App |
| `Logger.Add()` | `go/logs/logs:78` | Add 添加一条导入日志（兼容旧调用） |
| `Logger.AddOp()` | `go/logs/logs:83` | AddOp 添加一条指定操作类型的日志 |
| `Logger.GetAll()` | `go/logs/logs:107` | GetAll 获取所有日志 |
| `Logger.Clear()` | `go/logs/logs:116` | Clear 清空日志 |
| `Logger()` | `go/logs/logs:14` | Logger 导入日志管理器 |
| `NewRuntimeBuffer()` | `go/logs/runtime:19` | NewRuntimeBuffer 创建环形缓冲 |
| `RuntimeBuffer.Write()` | `go/logs/runtime:27` | Write 实现 io.Writer：每次调用记录一条运行时日志（标准库 log 一行即一次 Write） |
| `RuntimeBuffer.GetAll()` | `go/logs/runtime:41` | GetAll 返回全部日志的副本 |
| `RuntimeBuffer.Clear()` | `go/logs/runtime:50` | Clear 清空缓冲 |
| `RuntimeBuffer()` | `go/logs/runtime:12` | RuntimeBuffer 运行时日志环形缓冲：捕获标准库 log 输出（watcher/sync 等），供诊断页展示。 |

## Go·包管理

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ReadPackMeta()` | `go/packs/mcmeta:18` | ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图 |
| `DetectResourceType()` | `go/packs/mcmeta:105` | DetectResourceType 检测文件属于哪种资源类型 |
| `ReadShaderpackLang()` | `go/packs/mcmeta:211` | ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名 返回 {name, entries}，name 为空时前端用文件名兜 |

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
| `CleanInstanceDir()` | `go/recycle/recycle_clean:21` | CleanInstanceDir 清理整合包子目录中仓库已有的文件： 在 recycleRoot 内的移入回收站（可恢复），否则直接删除（仓库侧无损可重推） |
| `DeduplicateEntries()` | `go/recycle/recycle_clean:58` | DeduplicateEntries 按 SHA256 哈希分组去重：保留每组第一个，其余移入回收站 |
| `CleanLogger()` | `go/recycle/recycle_clean:17` | CleanLogger 清理操作日志回调（薄壳注入 App.logger.Add） |
| `New()` | `go/recycle/recycle:32` | New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle |
| `TrashManager.RecycleDir()` | `go/recycle/recycle:41` | RecycleDir 返回回收站目录路径 |
| `TrashManager.Move()` | `go/recycle/recycle:46` | Move 移动文件到回收站 |
| `TrashManager.MoveEx()` | `go/recycle/recycle:52` | MoveEx 移动文件到回收站，返回操作详情 |
| `TrashManager.List()` | `go/recycle/recycle:158` | List 列出回收站中的文件。 |
| `TrashManager.Restore()` | `go/recycle/recycle:218` | Restore 从回收站恢复到原目录 |
| `TrashManager.Delete()` | `go/recycle/recycle:300` | Delete 永久删除回收站中的文件 ADR-038 D3.4：整组合并条目 Path 指向目录，os.Remove 无法删非空目录 → 目录用 RemoveAll |
| `TrashManager.Empty()` | `go/recycle/recycle:316` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `Move()` | `go/recycle/recycle:46` | Move 移动文件到回收站 |
| `MoveEx()` | `go/recycle/recycle:52` | MoveEx 移动文件到回收站，返回操作详情 |
| `List()` | `go/recycle/recycle:158` | List 列出回收站中的文件。 |
| `Restore()` | `go/recycle/recycle:218` | Restore 从回收站恢复到原目录 |
| `Delete()` | `go/recycle/recycle:300` | Delete 永久删除回收站中的文件 ADR-038 D3.4：整组合并条目 Path 指向目录，os.Remove 无法删非空目录 → 目录用 RemoveAll |
| `Empty()` | `go/recycle/recycle:316` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `MoveResult()` | `go/recycle/recycle:17` | MoveResult 回收操作结果 |
| `TrashManager()` | `go/recycle/recycle:23` | TrashManager 可配置的回收站管理器 |

## go/scanner

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `InvalidateCache()` | `go/scanner/scanner:52` | InvalidateCache 清空全部扫描缓存（下载/导入/同步后调用） |
| `InvalidatePath()` | `go/scanner/scanner:61` | InvalidatePath 删除指定目录的扫描缓存（启用/禁用 .ban 后调用） |
| `ScanEntries()` | `go/scanner/scanner:69` | ScanEntries 扫描目录下的模型文件（含 .recycle 排除、扩展名过滤、SHA256 哈希、30s TTL 缓存） |
| `ScanEntriesWithHit()` | `go/scanner/scanner:76` | ScanEntriesWithHit 同 ScanEntries，但额外返回是否命中 30s 缓存。 |
| `ComputeFileHash()` | `go/scanner/scanner:154` | ComputeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配） |
| `ListModelAuthors()` | `go/scanner/scanner:172` | ListModelAuthors 从扫描条目提取 [作者] 前缀统计（按出现次数降序） |
| `ScanLocalAuthors()` | `go/scanner/scanner:204` | ScanLocalAuthors 扫描各资源类型根目录，从文件名提取 [作者]（roots: rtype→root） |
| `GenerateRepoIndex()` | `go/scanner/scanner:263` | GenerateRepoIndex 扫描仓库目录，生成 index.json（供 GitHub Actions/Linux 消费，正斜杠路径） |

## Go·同步

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `PushResources()` | `go/sync/sync_push:22` | PushResources 推送缺失资源到整合包（folder 级类型用 SyncResourcesDirLevel） |
| `PullResources()` | `go/sync/sync_push:61` | PullResources 拉取整合包多余资源回仓库 |
| `PullSingleResource()` | `go/sync/sync_push:127` | PullSingleResource 拉取单个资源（文件夹/文件）回仓库 |
| `PushSingleResource()` | `go/sync/sync_push:157` | PushSingleResource 推送单个资源到整合包： 文件夹 / .json/.pmx/.pmd（文件夹级类型）走 InstallDir，其余 Install |
| `SyncCustomToRepo()` | `go/sync/sync_push:170` | SyncCustomToRepo 同步整合包自定义目录的模型到仓库（哈希/名称去重） |
| `Logger()` | `go/sync/sync_push:19` | Logger 导入日志回调（薄壳注入 App.logger.Add） |
| `RelinkDir()` | `go/sync/sync_relink:18` | RelinkDir 按哈希比对重链接实例目录与仓库（原子替换，失败回滚） |
| `GetInstanceStatus()` | `go/sync/sync:29` | GetInstanceStatus 获取整合包状态（使用真实 ListVersions） |
| `GetInstanceStatusWith()` | `go/sync/sync:34` | GetInstanceStatusWith 可注入的整合包状态获取（测试用） |
| `SyncToggleStatus()` | `go/sync/sync:137` | SyncToggleStatus 同步启用/禁用状态 |
| `ListVersions()` | `go/sync/sync:250` | — |
| `HasDotMinecraftSubdirs()` | `go/sync/sync:265` | HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录） |
| `FindMinecraftDir()` | `go/sync/sync:282` | FindMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径 |
| `SyncResources()` | `go/sync/sync:396` | SyncResources 对比两个目录的资源文件差异，按文件名匹配 用于资源库（资源包/光影包等）的全局 ↔ 整合包同步 只统计模型/资源相关扩展名的文件，忽略无关文件 |
| `SyncResourcesDirLevel()` | `go/sync/sync:524` | SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹） 以文件夹名为单位，一个文件夹 |
| `SortEntries()` | `go/sync/sync:594` | SortEntries 按名称排序模型条目 |
| `GetLinkType()` | `go/sync/sync:602` | getLinkType 判断文件的链接类型 GetLinkType 判断文件的链接类型 |
| `CompareGlobalInstanceHashes()` | `go/sync/sync:656` | CompareGlobalInstanceHashes 对比全局目录和整合包实例子目录的哈希， 返回每个实例的 Missing / Extra / Synced 状态。 |
| `ScanFunc()` | `go/sync/sync:23` | ScanFunc 扫描模型（函数类型，由 app.go 注入） |
| `ListVersionsFunc()` | `go/sync/sync:26` | ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock） |
| `HasModInDirFn()` | `go/sync/sync:651` | HasModInDirFn 判断 mods 目录是否含有指定类型 mod 的函数类型。 |

## Go·标签

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewStore()` | `go/tags/tags:24` | NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取） |
| `Store.GetTags()` | `go/tags/tags:88` | GetTags 返回指定路径的所有标签（已排序） |
| `Store.SetTags()` | `go/tags/tags:105` | SetTags 设置指定路径的标签列表（覆盖写入） |
| `Store.AddTag()` | `go/tags/tags:137` | AddTag 追加单个标签（不会重复） |
| `Store.RemoveTag()` | `go/tags/tags:160` | RemoveTag 移除单个标签 |
| `Store.ListByTag()` | `go/tags/tags:189` | ListByTag 返回所有打了指定标签的文件路径列表 |
| `Store.AllTags()` | `go/tags/tags:213` | AllTags 返回所有被使用的标签（按使用次数降序） |
| `Store()` | `go/tags/tags:17` | Store 是标签存储，线程安全 |

## Go·Three.js

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Build()` | `go/threejs/spec:56` | Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec |
| `Model3DSpec()` | `go/threejs/spec:16` | — |
| `ModelGroup()` | `go/threejs/spec:20` | — |
| `BoneData()` | `go/threejs/spec:31` | — |
| `MeshData()` | `go/threejs/spec:39` | — |

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
| `AllExts()` | `go/types/extensions:17` | AllExts 返回所有支持的扩展名（去重后） |
| `IsSupportedExt()` | `go/types/extensions:33` | IsSupportedExt 检查扩展名是否被任何资源类型支持 |
| `IsYsmEntryJSON()` | `go/types/extensions:49` | IsYsmEntryJSON 判断是否为 YSM 解压目录的唯一清单入口 ysm.json（大小写不敏感） ADR-038 D2：.json 仅放行 ysm.json；包内 geo |
| `ShouldHashExt()` | `go/types/extensions:56` | ShouldHashExt 判断扩展名是否需要计算 SHA256 哈希（用于同步系统文件匹配） 跳过非 YSM 类型的大文件（MMD/VRC 文件可达数十 MB，哈希全量太慢） 蓝 |
| `ExtBelongsTo()` | `go/types/extensions:65` | ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个） |
| `SupportedExtsForType()` | `go/types/extensions:80` | SupportedExtsForType 返回指定资源类型的所有扩展名 |
| `FindInstDir()` | `go/types/extensions:94` | FindInstDir 查找整合包中指定资源类型的子目录： 1. |
| `StorageSubDir()` | `go/types/extensions:137` | StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录 从 resource_types.json 注册表读取，无匹配时返回 rtype 自身 |
| `SubDirMap()` | `go/types/extensions:151` | SubDirMap 返回指定资源类型在整合包实例版本目录中的扫描子目录 |
| `SubDirAll()` | `go/types/extensions:163` | SubDirAll 返回所有资源类型在整合包实例中的版本扫描子目录映射 |
| `AllSubDirs()` | `go/types/extensions:175` | AllSubDirs 返回所有资源类型的版本子目录信息（遍历用） |
| `SubDirEntry()` | `go/types/extensions:145` | SubDirEntry 资源类型的版本子目录信息 |
| `SetRegistryPath()` | `go/types/resource:41` | SetRegistryPath 设置注册表文件路径（仅测试用） 加锁保护：并发调用 LoadRegistry + SetRegistryPath 触发数据竞争（审计 P1 #2）。 |
| `LoadRegistry()` | `go/types/resource:52` | LoadRegistry 加载资源类型注册表 优先读取外部 JSON 文件（可通过 SetRegistryPath 自定义路径）， 文件不存在或读取失败时回退到编译时嵌入的默认数据 |
| `RegistryType()` | `go/types/resource:96` | RegistryType 按 id 查找资源类型，不存在时返回 nil |
| `FormatRange.UnmarshalJSON()` | `go/types/resource:113` | UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式 |
| `PackMeta.Desc()` | `go/types/resource:209` | Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组） |
| `ResourceTypeRegistry()` | `go/types/resource:13` | ResourceTypeRegistry 资源类型注册表 |
| `ResourceType()` | `go/types/resource:18` | ResourceType 一种受支持的资源类型定义 |
| `FormatRange()` | `go/types/resource:107` | FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]） |
| `PackMeta()` | `go/types/resource:198` | PackMeta 资源包信息（来自 pack.mcmeta） |
| `LitematicMeta()` | `go/types/resource:216` | LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound） |
| `LitematicBlockStat()` | `go/types/resource:233` | LitematicBlockStat 方块类型统计 |
| `LitematicVoxelData()` | `go/types/resource:239` | LitematicVoxelData 体素渲染数据 |
| `VoxelGroup()` | `go/types/resource:247` | VoxelGroup 同一颜色的方块组 |
| `AppError.Error()` | `go/types/types:113` | — |
| `WindowState()` | `go/types/types:6` | WindowState 窗口位置 |
| `AuthorInfo()` | `go/types/types:14` | AuthorInfo 作者信息（含模型计数） |
| `ModelEntry()` | `go/types/types:21` | ModelEntry 模型文件条目 |
| `ImportFileItem()` | `go/types/types:32` | ImportFileItem 文件夹型模型整组导入的文件项（ADR-038 关联：解压目录整组导入） |
| `VersionInstance()` | `go/types/types:38` | VersionInstance 整合包信息 |
| `SearchResult()` | `go/types/types:46` | SearchResult 模型搜索结果 |
| `ImportLog()` | `go/types/types:57` | ImportLog 应用操作日志（导入、扫描、下载、同步等） |
| `RuntimeLog()` | `go/types/types:69` | RuntimeLog 运行时日志（watcher/sync 等标准库 log 输出，诊断页可见） |
| `LinkType()` | `go/types/types:75` | LinkType 链接类型 |
| `CustomFileInfo()` | `go/types/types:85` | CustomFileInfo custom 目录下的文件信息 |
| `InstanceStatus()` | `go/types/types:91` | InstanceStatus 整合包状态 |
| `AppError()` | `go/types/types:104` | — |
| `ResourceSyncResult()` | `go/types/types:126` | ResourceSyncResult 资源同步结果 |
| `SyncStatus()` | `go/types/types:133` | SyncStatus 资源文件同步状态 |
| `ResourceSyncItem()` | `go/types/types:144` | ResourceSyncItem 单个资源文件的同步状态 |

## Go·更新器

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Check()` | `go/updater/update:72` | Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志） |
| `CheckWithClient()` | `go/updater/update:78` | CheckWithClient 可注入 client 与 API URL 的测试变体（Check 的内部实现） |
| `Download()` | `go/updater/update:167` | Download 下载更新包到临时目录，返回 zip 路径。 |
| `CleanupOldVersion()` | `go/updater/update:230` | CleanupOldVersion 启动时清理上一次更新留下的 .old 文件 |
| `InstallUpdate()` | `go/updater/update:245` | InstallUpdate 解压更新包并通过 helper 进程替换当前 exe。 |
| `ReleaseAsset()` | `go/updater/update:34` | ReleaseAsset GitHub Release 中的文件 |
| `Release()` | `go/updater/update:40` | Release GitHub Release 信息 |
| `UpdateInfo()` | `go/updater/update:49` | UpdateInfo 更新信息（序列化给前端） |

## Go·监听

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `New()` | `go/watcher/watcher:39` | New 创建文件监听器 |
| `Watcher.Start()` | `go/watcher/watcher:54` | Start 开始监听 |
| `Watcher.Stop()` | `go/watcher/watcher:99` | Stop 停止监听 |
| `Watcher.IsRunning()` | `go/watcher/watcher:120` | IsRunning 返回是否正在运行 |
| `ScanFunc()` | `go/watcher/watcher:17` | ScanFunc matches mdsync.ScanFunc |
| `Watcher()` | `go/watcher/watcher:23` | Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包 |

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
| `ExtractYsmSummary()` | `go/ysm/summary:131` | ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要 |
| `Author()` | `go/ysm/summary:14` | — |
| `Link()` | `go/ysm/summary:20` | — |
| `AnimGroup()` | `go/ysm/summary:25` | — |
| `ConfigMenu()` | `go/ysm/summary:31` | — |
| `PreviewInfo()` | `go/ysm/summary:37` | — |
| `YsmSummary()` | `go/ysm/summary:45` | YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要 |
| `Stats()` | `go/ysm/summary:62` | — |
| `ScanModelTexSizes()` | `go/ysm/texsize:22` | ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM 仅支持 zip/7z 格式（未加密模型），加密 .ysm 返回 0,0 |
| `ScanFiles()` | `go/ysm/texsize:146` | ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用） |
| `TexInfo()` | `go/ysm/texsize:14` | TexInfo 轻量级纹理尺寸（不解析完整模型） |
| `ModelEntry()` | `go/ysm/texsize:37` | ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径） |
| `IsYSMJar()` | `go/ysm/ysm:12` | IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml） |
| `HasYSMMod()` | `go/ysm/ysm:80` | HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP） |
| `HasModInDir()` | `go/ysm/ysm:109` | HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar |

## Go(internal)·应用入口

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `App.CachedCreatorAvatar()` | `internal/app/app_avatar:16` | CachedCreatorAvatar 检查缓存中是否有作者头像，返回 data URI |
| `App.BatchExtractCreatorAvatars()` | `internal/app/app_avatar:21` | BatchExtractCreatorAvatars 批量提取所有有本地模型的创作者头像 |
| `App.DebugExtractCreatorAvatar()` | `internal/app/app_avatar:71` | DebugExtractCreatorAvatar 调试版：提取指定作者头像 |
| `App.CacheModelAvatars()` | `internal/app/app_avatar:124` | CacheModelAvatars 从解压目录 ysm.json 缓存头像 |
| `App.GetConfigPath()` | `internal/app/app_config:47` | GetConfigPath 返回应用配置文件路径（跨平台：Windows %APPDATA%，Linux ~/.config，macOS ~/Library/Application |
| `App.SaveAppConfig()` | `internal/app/app_config:108` | — |
| `App.SetDownloadMirror()` | `internal/app/app_config:140` | — |
| `App.LoadAppConfig()` | `internal/app/app_config:166` | — |
| `App.GetSubDirMap()` | `internal/app/app_config:187` | ========== 自动更新 ========== GetSubDirMap 返回资源类型→子目录映射表（前端右键菜单等场景使用） |
| `App.CurrentVersion()` | `internal/app/app_config:191` | — |
| `App.CheckUpdate()` | `internal/app/app_config:193` | — |
| `App.DownloadUpdate()` | `internal/app/app_config:197` | — |
| `App.ApplyUpdate()` | `internal/app/app_config:201` | — |
| `App.DoUpdate()` | `internal/app/app_config:205` | — |
| `App.RestartApplication()` | `internal/app/app_config:217` | — |
| `App.SaveWindowPosition()` | `internal/app/app_config:269` | — |
| `App.GetWindowPosition()` | `internal/app/app_config:283` | — |
| `App.SelectDirectory()` | `internal/app/app_config:312` | ========== 目录选择 ========== |
| `App.GetMinecraftPaths()` | `internal/app/app_config:373` | — |
| `App.ValidateMinecraftDir()` | `internal/app/app_config:375` | — |
| `NewDownloadQueue()` | `internal/app/app_download:51` | NewDownloadQueue 创建串行下载队列（回调由 App 初始化时注入） |
| `App.EnqueueDownloads()` | `internal/app/app_download:56` | — |
| `App.CancelQueue()` | `internal/app/app_download:86` | — |
| `App.QueueStatus()` | `internal/app/app_download:103` | — |
| `App.DownloadFromGitHub()` | `internal/app/app_download:228` | — |
| `App.GetModelTexSizes()` | `internal/app/app_download:233` | GetModelTexSizes 扫描仓库文件提取纹理尺寸（轻量级，不解析完整模型） |
| `QueueStatusInfo()` | `internal/app/app_download:18` | QueueStatusInfo 队列状态（替代多返回值，Wails 自动映射为 JS object） |
| `DownloadTask()` | `internal/app/app_download:24` | DownloadTask 下载队列任务 |
| `DownloadQueue()` | `internal/app/app_download:33` | DownloadQueue 串行下载队列 回调注入替代 *App 反向引用（ADR-002 P1：打破 DownloadQueue ↔ App 循环，解锁独立测试） |
| `App.CreateDir()` | `internal/app/app_files:19` | ========== 目录操作 ========== |
| `App.RenameDir()` | `internal/app/app_files:23` | — |
| `App.RemoveDir()` | `internal/app/app_files:30` | — |
| `App.RenameFile()` | `internal/app/app_files:37` | — |
| `App.FindPreviewImage()` | `internal/app/app_files:42` | ========== 预览提取 ========== |
| `App.ExtractPreviewTexture()` | `internal/app/app_files:46` | — |
| `App.GetPackInfo()` | `internal/app/app_files:51` | ========== 包信息 ========== |
| `App.MoveModelFile()` | `internal/app/app_files:56` | ========== 模型移动/复制 ========== |
| `App.CopyModelFile()` | `internal/app/app_files:64` | CopyModelFile 复制（root 传 FilesRoot 做路径安全校验） |
| `App.ImportModelFolder()` | `internal/app/app_files:71` | ImportModelFolder 文件夹型模型整组导入（YSM 解压目录，保留子目录层级，ADR-038 关联） folderName = 仓库文件夹名（模型名）；files = |
| `App.RevealInExplorer()` | `internal/app/app_files:84` | ========== 在资源管理器中显示 ========== |
| `App.ToggleModelEnable()` | `internal/app/app_files:96` | ========== 启用/禁用 ========== ToggleModelEnable 切换 .ban 状态（fileops 纯逻辑 + 薄壳缓存失效） |
| `App.IsFileBanned()` | `internal/app/app_files:104` | — |
| `App.InstallModelFile()` | `internal/app/app_install:24` | ========== 安装 ========== |
| `App.InstallModelTo()` | `internal/app/app_install:28` | — |
| `App.InstallModelWithOverlay()` | `internal/app/app_install:38` | — |
| `App.SyncCustomToRepo()` | `internal/app/app_install:43` | SyncCustomToRepo 同步整合包自定义目录到仓库（执行逻辑下沉 go/sync） |
| `App.ImportModelFile()` | `internal/app/app_install:47` | — |
| `App.DetectZipType()` | `internal/app/app_install:52` | DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用） |
| `App.ImportModelFileSkipCheck()` | `internal/app/app_install:60` | — |
| `App.ImportModelFileOverwrite()` | `internal/app/app_install:68` | — |
| `App.ImportModelFileTo()` | `internal/app/app_install:88` | — |
| `App.ImportModelFileOverwriteTo()` | `internal/app/app_install:92` | — |
| `App.MoveToRecycle()` | `internal/app/app_install:149` | ========== 回收站 ========== |
| `App.MoveToRecycleEx()` | `internal/app/app_install:158` | — |
| `App.ClearCustomDir()` | `internal/app/app_install:190` | — |
| `App.CountInstanceResources()` | `internal/app/app_install:245` | CountInstanceResources 统计指定整合包中可清空的资源文件数 只统计仓库中已有的文件（同 clearInstanceDir 逻辑） rtype 为空时统计全部类 |
| `App.ClearInstanceResources()` | `internal/app/app_install:285` | ClearInstanceResources 清空指定整合包中已同步的文件 insName: 整合包名, rtype: 资源类型（空=全部, 非空=只清此类型） 返回清除的文件数量 |
| `App.DeduplicateCustomDir()` | `internal/app/app_install:365` | DeduplicateCustomDir 按 SHA256 哈希去重（执行逻辑下沉 go/recycle） |
| `App.ListRecycleBin()` | `internal/app/app_install:380` | — |
| `App.RestoreFromRecycle()` | `internal/app/app_install:397` | — |
| `App.DeleteFromRecycle()` | `internal/app/app_install:411` | — |
| `App.EmptyRecycleBin()` | `internal/app/app_install:424` | — |
| `App.GetInstanceStatus()` | `internal/app/app_install:463` | ========== 状态同步 ========== |
| `App.GetResourceInstanceStatus()` | `internal/app/app_install:475` | GetResourceInstanceStatus 按资源类型获取整合包同步状态 repoDir 仅对 YSM 类型生效（其他类型从全局资源目录推导） |
| `App.SyncModelToggleStatus()` | `internal/app/app_install:515` | — |
| `App.RelinkCustomDir()` | `internal/app/app_install:520` | RelinkCustomDir 重新应用链接模式到指定目录（兼容旧版） |
| `App.RelinkAllInstanceResources()` | `internal/app/app_install:540` | RelinkAllInstanceResources 重新应用链接模式到整合包所有资源类型目录 |
| `App.SyncResources()` | `internal/app/app_install:575` | SyncResources 获取全局 ↔ 整合包的资源同步状态 |
| `App.PushResourceToInstance()` | `internal/app/app_install:609` | PushResourceToInstance 将全局中缺失的资源推送到整合包 PushResourceToInstance 推送缺失资源到整合包（执行循环下沉 go/sync） |
| `App.PullResourceFromInstance()` | `internal/app/app_install:627` | PullResourceFromInstance 拉取整合包多余资源回仓库（执行循环下沉 go/sync） |
| `App.PullSingleResourceFromInstance()` | `internal/app/app_install:661` | PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库 PullSingleResourceFromInstance 从 |
| `App.PushSingleResourceToInstance()` | `internal/app/app_install:678` | PushSingleResourceToInstance 推送单个资源到整合包（分派核心下沉 go/sync） |
| `App.GetInstanceSyncStatus()` | `internal/app/app_install:698` | GetInstanceSyncStatus 获取整合包下所有资源类型的同步状态（扁平列表） GetInstanceSyncStatus 整合包同步状态（组装逻辑已下沉 go/ins |
| `App.HasYSMMod()` | `internal/app/app_install:737` | ========== YSM 检测 ========== |
| `App.SetLinkMode()` | `internal/app/app_install:755` | ========== 链接模式 ========== |
| `App.GetLinkMode()` | `internal/app/app_install:772` | — |
| `App.AddImportLog()` | `internal/app/app_install:777` | ========== 日志 ========== |
| `App.AddOpLog()` | `internal/app/app_install:781` | — |
| `App.GetImportLogs()` | `internal/app/app_install:785` | — |
| `App.ClearImportLogs()` | `internal/app/app_install:789` | — |
| `App.GetRuntimeLogs()` | `internal/app/app_install:794` | GetRuntimeLogs 获取运行时日志（watcher/sync 等标准库 log 输出） |
| `App.ClearRuntimeLogs()` | `internal/app/app_install:799` | ClearRuntimeLogs 清空运行时日志缓冲 |
| `App.AnalyzeYSMModel()` | `internal/app/app_model:22` | — |
| `App.ExtractYsmSummary()` | `internal/app/app_model:26` | — |
| `App.ExtractYSMHeader()` | `internal/app/app_model:40` | — |
| `App.ExtractYSMHeaderFromBase64()` | `internal/app/app_model:44` | — |
| `App.SavePreviewTempFile()` | `internal/app/app_model:52` | — |
| `App.ReadFileBytes()` | `internal/app/app_model:71` | — |
| `App.AnalyzeBedrockModel()` | `internal/app/app_model:89` | — |
| `App.GetModel3DSpec()` | `internal/app/app_model:134` | — |
| `App.SaveScreenshotFile()` | `internal/app/app_model:145` | SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用） 路径守卫：限制在 os.TempDir()/ysm-preview 内，禁止绝对路 |
| `App.ExportBoneStructures()` | `internal/app/app_scan:23` | ========== 批量导出骨骼结构 ========== |
| `App.ExportModelStructureJSON()` | `internal/app/app_scan:79` | ExportModelStructureJSON 导出单模型骨骼结构 |
| `App.SearchModels()` | `internal/app/app_scan:116` | ========== 高级搜索 ========== |
| `App.ScanModelEntries()` | `internal/app/app_scan:186` | ScanModelEntries 用户可见的扫描入口（Wails 绑定），记录操作日志。 |
| `App.ScanModelEntriesWithLabel()` | `internal/app/app_scan:197` | ScanModelEntriesWithLabel 同 ScanModelEntries，但操作日志附带资源类型标签 （如「资源包」「光影包」「模型」），便于在操作日志面板区分扫描 |
| `App.ClearScanCache()` | `internal/app/app_scan:210` | ClearScanCache 清除扫描缓存（下载/导入后调用） |
| `InvalidateScanCache()` | `internal/app/app_scan:215` | InvalidateScanCache 清空扫描缓存（同步完成后调用，确保下次扫描取最新数据） |
| `App.ListModelAuthors()` | `internal/app/app_scan:220` | ListModelAuthors 统计 [作者] 前缀（走扫描缓存，不重复读磁盘） |
| `App.GenerateRepoIndex()` | `internal/app/app_scan:229` | GenerateRepoIndex 生成 index.json（含 GitHub Actions workflow 模板） |
| `App.ScanLocalAuthors()` | `internal/app/app_scan:234` | ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者 |
| `App.ListVersionInstances()` | `internal/app/app_scan:242` | — |
| `App.GetGlobalCustomDir()` | `internal/app/app_scan:246` | — |
| `App.ListFileNames()` | `internal/app/app_scan:250` | — |
| `App.ListAllFilePaths()` | `internal/app/app_scan:263` | ListAllFilePaths 递归列出指定目录下的所有文件完整路径（不限制扩展名） |
| `App.CheckFileExists()` | `internal/app/app_scan:270` | — |
| `App.OpenFolder()` | `internal/app/app_scan:289` | — |
| `App.OpenInstanceFolder()` | `internal/app/app_scan:296` | OpenInstanceFolder 按资源类型打开整合包子目录；目录不存在时回退到实例根目录 |
| `progressReader.Read()` | `internal/app/app_scan:319` | — |
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
| `NewApp()` | `internal/app/app:39` | — |
| `App.SetApp()` | `internal/app/app:55` | SetApp 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框/浏览器管理器 |
| `App.SetMainWindow()` | `internal/app/app:60` | SetMainWindow 注入主窗口实例，避免依赖 Window.Current()。 |
| `App.ServiceStartup()` | `internal/app/app:63` | ServiceStartup 对应 v2 的 startup，在 app.Run() 期间由框架调用 |
| `App.ServiceShutdown()` | `internal/app/app:128` | ServiceShutdown 对应 v2 的 shutdown，在应用退出前由框架调用 |
| `App.OpenInBrowser()` | `internal/app/app:142` | OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌） |
| `App.GetAppVersion()` | `internal/app/app:147` | GetAppVersion 返回当前版本号 |
| `App()` | `internal/app/app:21` | — |
| `SetEmbedded()` | `internal/app/assets:16` | SetEmbedded 由根包 main 的 init() 注入编译期嵌入的静态资产。 |
| `CLIMain()` | `internal/app/cli:18` | — |
| `Issue()` | `internal/app/cli:183` | — |
| `App.StartProxy()` | `internal/app/proxy:23` | StartProxy 启动本地反代服务器（127.0.0.1 仅本机可访问） |
| `App.StopProxy()` | `internal/app/proxy:45` | StopProxy 关闭反代服务器 |
| `App.IsProxyRunning()` | `internal/app/proxy:60` | IsProxyRunning 检查代理是否运行中 |
| `App.LoadResourceTypes()` | `internal/app/resource_bindings:22` | LoadResourceTypes 加载资源类型注册表 |
| `App.ReadPackMeta()` | `internal/app/resource_bindings:31` | ReadPackMeta 读取资源包信息（pack.mcmeta + pack.png） |
| `App.ReadShaderpackLang()` | `internal/app/resource_bindings:56` | ReadShaderpackLang 读取光影包 lang/en_US.lang 提取显示名 |
| `App.GetNbtVoxelData()` | `internal/app/resource_bindings:83` | GetNbtVoxelData 读取 .nbt 结构文件体素数据 |
| `App.GetSchematicVoxelData()` | `internal/app/resource_bindings:88` | GetSchematicVoxelData 读取 .schematic 文件体素数据 |
| `App.ReadSchematic()` | `internal/app/resource_bindings:93` | ReadSchematic 读取 .schematic 文件基本信息 |
| `App.ReadNbtStructure()` | `internal/app/resource_bindings:103` | ReadNbtStructure 读取 .nbt 结构文件基本信息 |
| `App.ReadLitematicMeta()` | `internal/app/resource_bindings:113` | ReadLitematicMeta 读取投影文件元数据（作者/时间/版本/方块统计/预览图） |
| `App.GetLitematicVoxelData()` | `internal/app/resource_bindings:124` | GetLitematicVoxelData 读取投影文件体素数据（按颜色分组的方块位置） |
| `App.SetVoxelMaxBlocks()` | `internal/app/resource_bindings:129` | SetVoxelMaxBlocks 设置 3D 体素渲染上限，0=恢复默认 200000 |
| `App.DetectResourceType()` | `internal/app/resource_bindings:136` | DetectResourceType 检测指定文件的资源类型 |
| `App.GetRepoRoot()` | `internal/app/resource_bindings:145` | GetRepoRoot 根据资源类型返回对应的仓库根目录 |
| `App.ToggleResourcePack()` | `internal/app/resource_bindings:184` | ToggleResourcePack 切换资源包的启用/禁用状态（.zip ↔ .zip.disabled） |
| `App.IsResourcePackEnabled()` | `internal/app/resource_bindings:201` | IsResourcePackEnabled 检查资源包是否启用 |
| `App.SelectImportZip()` | `internal/app/resource_bindings:206` | SelectImportZip 打开文件选择器选取 .zip 文件 |
| `App.SelectImportFile()` | `internal/app/resource_bindings:219` | SelectImportFile 打开文件选择器，按给定扩展名过滤 filter 格式: "显示名|*.ext1;*.ext2" |
| `App.SetResourceRoot()` | `internal/app/resource_bindings:240` | SetResourceRoot 设置指定资源类型的自定义根路径（空=恢复默认） P1 修复：非空入参经 filepath.Abs(filepath.Clean()) 规范化，防止含 |
| `App.ResetResourceRoot()` | `internal/app/resource_bindings:271` | ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值） |
| `App.ImportResourcePack()` | `internal/app/resource_bindings:297` | ImportResourcePack 使用策略模式导入资源包 |
| `App.ImportByType()` | `internal/app/resource_bindings:310` | ImportByType 统一导入入口——根据资源类型自动选择导入策略 |
| `App.DeleteResourcePack()` | `internal/app/resource_bindings:327` | DeleteResourcePack 删除资源（目录感知，ADR-038 D3.6）： src 为 ysm.json 时整组删除父目录（文件夹型模型），否则删除单文件。 |
| `App.DeleteModelDir()` | `internal/app/resource_bindings:333` | DeleteModelDir 删除文件夹型资源（MMD 模型等），删除文件所在父文件夹 路径守卫：限制在 FilesRoot 内，防止删除系统目录 |
| `App.FindDuplicateFiles()` | `internal/app/resource_bindings:344` | FindDuplicateFiles 扫描目录返回所有重复文件分组（JSON 字符串） |
| `App.CountDuplicateFiles()` | `internal/app/resource_bindings:354` | CountDuplicateFiles 快速统计重复文件数量 |
| `App.InvalidateScanCache()` | `internal/app/resource_bindings:364` | InvalidateScanCache 清空扫描缓存，下次扫描获取最新数据 |
| `App.InstallResourceToInstance()` | `internal/app/resource_bindings:370` | InstallResourceToInstance 将资源文件安装到指定整合包 rtype: 资源类型（resourcepack/shaderpack 等），srcPath: 源文 |
| `App.GetWasmBinary()` | `internal/app/wasm_embed:5` | GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用）。 |

## 前端·根 (app-modules/bus)

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `bus()` | `frontend/src/bus:170` | 默认实例（组件直接使用） |
| `ToastPayload()` | `frontend/src/bus:7` | — |
| `MenuItem()` | `frontend/src/bus:18` | — |
| `PageName()` | `frontend/src/bus:28` | 核心页面名（与 app-nav 导航菜单一致） |
| `NavPagePayload()` | `frontend/src/bus:36` | — |
| `ModelSelectPayload()` | `frontend/src/bus:40` | — |
| `CtxShowPayload()` | `frontend/src/bus:45` | — |
| `BusEvents()` | `frontend/src/bus:62` | — |
| `BusEventName()` | `frontend/src/bus:118` | — |
| `Bus()` | `frontend/src/bus:120` | — |

## 前端·核心

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `registerContextMenus()` | `frontend/src/core/context-menus:464` | 注册右键菜单映射（ctx:show → menu:show）；由 registerGlobalHandlers 统一调用，unsub 收集进 unsubs 清理 |
| `__TEST__resetDiary()` | `frontend/src/core/error-diary:16` | 仅测试用：重置注册状态使下次 registerErrorDiary 可重新注册。 |
| `registerErrorDiary()` | `frontend/src/core/error-diary:34` | 注册 UI 报错落日记功能。 |
| `registerGlobalHandlers()` | `frontend/src/core/handlers/global:11` | 注册所有 core 全局 handler，返回 unsub 函数数组（features/views 层注册由 app-content 编排） |
| `registerInstanceOps()` | `frontend/src/core/handlers/instance-ops:10` | 注册整合包操作 handler，push 返回的取消订阅函数到 unsubs |
| `requireMcRoot()` | `frontend/src/core/handlers/require-mcroot:12` | 读取游戏根目录（mcRoot），空时发 warn toast 并返回 null。 |
| `registerSync()` | `frontend/src/core/handlers/sync:10` | 注册同步 handler，push 返回的取消订阅函数到 unsubs |
| `MenuDef()` | `frontend/src/core/menu-defs:18` | 单类菜单的完整声明 |
| `MENU_DEFS()` | `frontend/src/core/menu-defs:24` | 四类右键菜单的声明式规格（唯一事实来源） |
| `getMenuDef()` | `frontend/src/core/menu-defs:112` | 测试辅助：按 type 取声明（不存在返回 undefined） |
| `resolveInitialPage()` | `frontend/src/core/page-store:28` | — |
| `PageStore()` | `frontend/src/core/page-store:42` | — |
| `registerPageStore()` | `frontend/src/core/page-store:49` | 注册页面状态同步（由 registerGlobalHandlers 统一调用，bus.on 的 unsub 收集进 unsubs 清理） |

## 前端·特性

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `showProgress()` | `frontend/src/features/community/data:7` | 创建进度条 UI（插入到 searchResults 容器） |
| `FetchModelsResult()` | `frontend/src/features/community/data:31` | 抓取结果 |
| `tryFetchModels()` | `frontend/src/features/community/data:44` | 从 GitHub 获取 index.json（并发竞速：同时请求所有镜像源，取最快响应） |
| `DownloadTask()` | `frontend/src/features/community/download-queue:22` | 下载任务 |
| `QueueError()` | `frontend/src/features/community/download-queue:30` | 队列错误项 |
| `DownloadState()` | `frontend/src/features/community/download-queue:36` | 队列状态快照 |
| `subscribe()` | `frontend/src/features/community/download-queue:70` | 订阅 STATE 变更。返回取消订阅函数。 |
| `getState()` | `frontend/src/features/community/download-queue:82` | 当前状态的只读快照 |
| `resume()` | `frontend/src/features/community/download-queue:91` | 页面切回时调用，从 Go 端恢复当前队列状态。 |
| `enqueueDownloads()` | `frontend/src/features/community/download-queue:137` | 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。 |
| `cancelDownloads()` | `frontend/src/features/community/download-queue:169` | 模块级取消 — 纯粹的 Go 调用。 |
| `QueueControllerOptions()` | `frontend/src/features/community/download-queue:263` | createDownloadQueue 选项 |
| `QueueController()` | `frontend/src/features/community/download-queue:272` | 队列控制器 |
| `createDownloadQueue()` | `frontend/src/features/community/download-queue:297` | 创建一个下载队列 UI 控制器。 |
| `RepoEventsContext()` | `frontend/src/features/community/events:12` | bindRepoEvents 上下文 |
| `RepoEventsHandle()` | `frontend/src/features/community/events:24` | 绑定返回值 |
| `bindRepoEvents()` | `frontend/src/features/community/events:37` | 绑定仓库模型页面的所有事件。 |
| `WorkshopModel()` | `frontend/src/features/community/render:8` | 工坊模型条目（index.json 结构） |
| `WorkshopSite()` | `frontend/src/features/community/render:16` | 工坊站点 |
| `isModelMissing()` | `frontend/src/features/community/render:26` | 判断模型是否缺失（本地不存在） |
| `countMissing()` | `frontend/src/features/community/render:42` | 计算缺失数量 |
| `renderModelList()` | `frontend/src/features/community/render:87` | 渲染模型列表（DocumentFragment） |
| `renderCardsHTML()` | `frontend/src/features/community/render:181` | 生成左栏站点卡片 HTML |
| `renderRepoHeaderHTML()` | `frontend/src/features/community/render:235` | 生成仓库模型页面的头部 HTML（含返回按钮、计数、筛选按钮等） |
| `getExt()` | `frontend/src/features/dnd-shared:4` | — |
| `isSupportedFile()` | `frontend/src/features/dnd-shared:8` | 扩展名是否在支持列表 |
| `isImportableFile()` | `frontend/src/features/dnd-shared:14` | 是否可作为独立文件导入：.json 仅放行 ysm.json 入口清单 包内 geometry/animation/语言 json（main.json / *.animation. |
| `shouldEnterForm()` | `frontend/src/features/dnd-shared:22` | 判断文件是否需要进入命名表单 2026-08-05：导入默认直接（保留原文件名，后端自动路由类型/冲突覆盖确认）， 不再强制命名表单；ysm.json 单文件保留表单提示（整组导入 |
| `CollectedEntry()` | `frontend/src/features/dnd-shared:33` | 收集条目（文件 + 相对路径） |
| `FolderGroup()` | `frontend/src/features/dnd-shared:39` | 文件夹组：dir 为顶层目录名（可能含多级嵌套，组内文件保留完整 relPath） |
| `groupCollected()` | `frontend/src/features/dnd-shared:51` | 将收集到的条目分组： - 有目录前缀的条目 → 按「顶层目录」整组（dir = 第一段路径），组内保留完整 relPath（支持多层嵌套） - 无目录前缀的散落文件 → 单文件队列 |
| `registerDnD()` | `frontend/src/features/import-dnd:265` | 注册 DnD 全局事件，push 返回的取消订阅函数到 unsubs |
| `isImportableFile()` | `frontend/src/features/import-executor` | — |
| `ImportFile()` | `frontend/src/features/import-executor:12` | 带相对路径的 File（文件夹导入时标记 _relPath） |
| `ImportRecord()` | `frontend/src/features/import-executor:15` | 已导入历史条目（导入 tab「已导入」列表数据源） |
| `CollectedEntry()` | `frontend/src/features/import-executor:23` | 收集条目（文件 + 相对路径） |
| `ImportHistory()` | `frontend/src/features/import-executor:32` | — |
| `directImport()` | `frontend/src/features/import-executor:76` | 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认） |
| `importFolder()` | `frontend/src/features/import-executor:107` | 文件夹整组导入（含 ysm.json 模型目录或普通文件夹；组内至少 1 个支持文件由调用方保证） |
| `executeCollected()` | `frontend/src/features/import-executor:154` | 执行一组拖拽收集的条目（静默导入入口）： 文件夹 → 整组（组内至少 1 个支持文件）；散落单文件 → 直导。 |
| `ImportQueueHost()` | `frontend/src/features/import-queue:24` | app-content 组件实例（initImportQueue 依赖的成员） |
| `initImportQueue()` | `frontend/src/features/import-queue:30` | 初始化导入队列，返回清理函数 |
| `loadOldestModel()` | `frontend/src/features/oldest-models:25` | 加载资历最深、仓库评分、热力图和每日推荐 |
| `RecycleHost()` | `frontend/src/features/recycle-bin:11` | app-content 组件实例（initRecycleBin 依赖的成员） |
| `initRecycleBin()` | `frontend/src/features/recycle-bin:18` | 初始化回收站管理，返回清理函数 |
| `initResourcePacks()` | `frontend/src/features/resource-packs:13` | 初始化资源包 tab |
| `UpdateInfo()` | `frontend/src/features/version-updater:8` | 更新信息（CheckUpdate 返回） |
| `checkUpdateSilent()` | `frontend/src/features/version-updater:107` | 启动时静默检查更新（受 6h 频次限制） 有新版本则在右下角显示可点击的 toast 通知 |
| `initVersionUpdater()` | `frontend/src/features/version-updater:130` | 手动检查更新（设置页按钮） |

## 前端·服务

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ServiceName()` | `frontend/src/services/registry:11` | 已知服务名（新服务先在 app-modules.ts 注册，再在此登记） |
| `register()` | `frontend/src/services/registry:18` | 注册一个服务（.ts 调用方：register("name", impl as X) 声明类型；重复注册覆盖旧实例并告警） |
| `get()` | `frontend/src/services/registry:24` | 获取一个服务（.ts 调用方：get&lt;X&gt;("name") 断言期望类型；未注册抛错，错误含服务名） |
| `has()` | `frontend/src/services/registry:32` | 检查服务是否已注册 |
| `unregister()` | `frontend/src/services/registry:37` | 注销（测试用） |
| `clear()` | `frontend/src/services/registry:42` | 清空所有（测试用） |

## frontend/test-utils

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `fireEvent()` | `frontend/src/test-utils/events:6` | 构造一个基础 CustomEvent 并 dispatch |
| `fireClick()` | `frontend/src/test-utils/events:17` | 模拟鼠标点击 |
| `fireFocus()` | `frontend/src/test-utils/events:24` | 模拟焦点 |
| `fireBlur()` | `frontend/src/test-utils/events:31` | 模拟失焦 |
| `fireKeyDown()` | `frontend/src/test-utils/events:38` | 模拟键盘按下 |
| `fireInput()` | `frontend/src/test-utils/events:45` | 模拟输入变化（更新 input.value 并触发 input + change 事件） |
| `fireDrop()` | `frontend/src/test-utils/events:55` | 模拟拖拽：构造 DragEvent |
| `queryByTestId()` | `frontend/src/test-utils/index` | — |
| `getByTestId()` | `frontend/src/test-utils/index` | — |
| `queryAllByTestId()` | `frontend/src/test-utils/index` | — |
| `getAllByTestId()` | `frontend/src/test-utils/index` | — |
| `fireEvent()` | `frontend/src/test-utils/index` | — |
| `fireClick()` | `frontend/src/test-utils/index` | — |
| `fireFocus()` | `frontend/src/test-utils/index` | — |
| `fireBlur()` | `frontend/src/test-utils/index` | — |
| `fireKeyDown()` | `frontend/src/test-utils/index` | — |
| `fireInput()` | `frontend/src/test-utils/index` | — |
| `fireDrop()` | `frontend/src/test-utils/index` | — |
| `renderComponent()` | `frontend/src/test-utils/index` | — |
| `mountCustomElement()` | `frontend/src/test-utils/index:26` | 同步渲染自定义元素到 body，返回已创建元素。 |
| `unmountElement()` | `frontend/src/test-utils/index:38` | 卸载元素：从 DOM 移除。 |
| `sleep()` | `frontend/src/test-utils/index:45` | 简单睡眠（测试中等待异步渲染）。 |
| `waitFor()` | `frontend/src/test-utils/index:54` | 轮询等待条件满足（兼容现有测试风格，作为统一导出）。 |
| `waitForElementToBeRemoved()` | `frontend/src/test-utils/index:79` | 轮询等待元素被移除。 |
| `QueryContainer()` | `frontend/src/test-utils/query-by-testid:11` | — |
| `queryByTestId()` | `frontend/src/test-utils/query-by-testid:19` | — |
| `getByTestId()` | `frontend/src/test-utils/query-by-testid:26` | — |
| `getAllByTestId()` | `frontend/src/test-utils/query-by-testid:35` | — |
| `queryAllByTestId()` | `frontend/src/test-utils/query-by-testid:44` | — |
| `RenderOptions()` | `frontend/src/test-utils/render:6` | 渲染配置 |
| `RenderResult()` | `frontend/src/test-utils/render:13` | — |
| `renderComponent()` | `frontend/src/test-utils/render:31` | 渲染一个自定义元素到 DOM。 |

## 前端·工具

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BedrockCube()` | `frontend/src/utils/3d/model2d:8` | Bedrock cube（AnalyzeBedrockModel 结构） |
| `BedrockBone()` | `frontend/src/utils/3d/model2d:18` | Bedrock bone |
| `BedrockModel()` | `frontend/src/utils/3d/model2d:24` | BedrockModel（AnalyzeBedrockModel 返回） |
| `Model2DOptions()` | `frontend/src/utils/3d/model2d:29` | renderModel2D 选项 |
| `renderModel2D()` | `frontend/src/utils/3d/model2d:59` | 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转） |
| `calcBoneHitZones()` | `frontend/src/utils/3d/model2d:250` | 计算骨骼在屏幕上的命中热区（2D 正交投影，供鼠标拾取；导出供测试） |
| `SpecCube()` | `frontend/src/utils/3d/model3d-spec:10` | 立方体（骨骼上的 box 元素） |
| `SpecBone()` | `frontend/src/utils/3d/model3d-spec:20` | 骨骼 |
| `SpecModelInput()` | `frontend/src/utils/3d/model3d-spec:28` | 模型输入（buildSpecFromModel 参数） |
| `SpecBuildResult()` | `frontend/src/utils/3d/model3d-spec:35` | 构建产物：mesh data + bones |
| `SpecMeshData()` | `frontend/src/utils/3d/model3d-spec:43` | 单 mesh 数据（Go spec meshGroups 结构近似） |
| `buildSpecFromModel()` | `frontend/src/utils/3d/model3d-spec:64` | 构建 Three.js 可消费的 spec 结构 { bones[], meshes[] } |
| `SpecBone3D()` | `frontend/src/utils/3d/model3d:7` | — |
| `SpecMeshGroup3D()` | `frontend/src/utils/3d/model3d:15` | — |
| `SpecModelGroup3D()` | `frontend/src/utils/3d/model3d:27` | — |
| `Spec3D()` | `frontend/src/utils/3d/model3d:32` | — |
| `BoneSelectInfo()` | `frontend/src/utils/3d/model3d:37` | 骨骼选中信息（window._3dOnBoneSelect 回调参数） |
| `RenderModel3DHandle()` | `frontend/src/utils/3d/model3d:51` | renderModel3D 返回的渲染句柄 |
| `TdKeyAction()` | `frontend/src/utils/3d/model3d:66` | — |
| `DEFAULT_TD_KEYMAP()` | `frontend/src/utils/3d/model3d:69` | 默认键位以 KeyboardEvent.code 存储（物理键，跨键盘布局一致） |
| `loadTdKeymap()` | `frontend/src/utils/3d/model3d:83` | 读取用户自定义键位（无/非法时回退默认） |
| `loadTdCamSpeed()` | `frontend/src/utils/3d/model3d:101` | 相机移动速度（2–200），默认 20 |
| `loadTdRotMode()` | `frontend/src/utils/3d/model3d:107` | true = 环绕（orbit），false = 自身（free） |
| `buildSceneMesh()` | `frontend/src/utils/3d/model3d:120` | 构建骨骼层级场景（bone group 树），返回组映射与根节点 |
| `renderModel3D()` | `frontend/src/utils/3d/model3d:178` | 渲染 3D 模型到容器，返回控制句柄 |
| `screenshotPreview()` | `frontend/src/utils/3d/model3d:843` | 截取当前 3D 预览画面（PNG base64，无 data: 前缀），无渲染器时返回 null |
| `animateNumber()` | `frontend/src/utils/animation/animate:12` | 里程表滚动进位动画 |
| `Vec3()` | `frontend/src/utils/animation/animation:9` | 三维向量 [x, y, z] |
| `Keyframe()` | `frontend/src/utils/animation/animation:12` | 关键帧 |
| `BoneChannels()` | `frontend/src/utils/animation/animation:20` | 单骨骼三通道 |
| `AnimationClip()` | `frontend/src/utils/animation/animation:27` | 动画剪辑 |
| `BoneTransform()` | `frontend/src/utils/animation/animation:36` | 骨骼变换（evaluateClip 结果值） |
| `BoneHierarchyNode()` | `frontend/src/utils/animation/animation:43` | 骨骼层级节点 |
| `parseBedrockAnimationJSON()` | `frontend/src/utils/animation/animation:193` | 解析完整的基岩版动画 JSON 字符串 |
| `evaluateKeyframes()` | `frontend/src/utils/animation/animation:290` | 在指定时间 t 对一组关键帧求值 |
| `evaluateClip()` | `frontend/src/utils/animation/animation:334` | 对整个动画 clip 在指定时间求值（支持骨骼层级） |
| `stagger()` | `frontend/src/utils/animation/stagger:11` | — |
| `dbg()` | `frontend/src/utils/debug/debug:32` | 输出调试日志（保留 tag 用于过滤） |
| `btnBaseCSS()` | `frontend/src/utils/dom/css:1` | — |
| `focusVisibleCSS()` | `frontend/src/utils/dom/css:32` | Shadow DOM 通用 focus-visible 规则（所有 button/input/select/textarea） |
| `AdvFilterValue()` | `frontend/src/utils/dom/dialogs/adv-filter:11` | 筛选条件 |
| `AdvFilterResult()` | `frontend/src/utils/dom/dialogs/adv-filter:22` | — |
| `modalAdvFilter()` | `frontend/src/utils/dom/dialogs/adv-filter:29` | 弹出高级筛选弹窗 |
| `BatchRenameChange()` | `frontend/src/utils/dom/dialogs/batch-rename:18` | 应用变更载荷 |
| `showBatchRenameDialog()` | `frontend/src/utils/dom/dialogs/batch-rename:47` | 弹出批量重命名对话框 重复打开时先结算上一个 Promise，调用方 await 不会永远悬挂 |
| `esc()` | `frontend/src/utils/dom/dialogs/modal` | — |
| `trapFocus()` | `frontend/src/utils/dom/dialogs/modal:25` | 焦点陷阱：Tab 键在弹窗内可聚焦元素间循环，防止焦点逃逸到背后页面 |
| `closeDlg()` | `frontend/src/utils/dom/dialogs/modal:53` | 带退场动画关闭对话框 |
| `registerDlg()` | `frontend/src/utils/dom/dialogs/modal:77` | 弹窗 append 到 body 后调用，登记为当前活动弹窗 |
| `ModalPromptOptions()` | `frontend/src/utils/dom/dialogs/modal:84` | modalPrompt 选项 |
| `modalPrompt()` | `frontend/src/utils/dom/dialogs/modal:97` | 弹出带输入框的模态框，类似 styled prompt() |
| `ModalSelectOptions()` | `frontend/src/utils/dom/dialogs/modal:166` | modalSelect 选项 |
| `modalSelect()` | `frontend/src/utils/dom/dialogs/modal:179` | 弹出下拉选择框 |
| `ModalConfirmOptions()` | `frontend/src/utils/dom/dialogs/modal:242` | modalConfirm 选项 |
| `modalConfirm()` | `frontend/src/utils/dom/dialogs/modal:258` | 弹出确认对话框 |
| `showRenameDialog()` | `frontend/src/utils/dom/dialogs/rename:14` | 弹出重命名对话框 |
| `modalTagEditor()` | `frontend/src/utils/dom/dialogs/tag-editor:12` | 弹出标签编辑弹窗 |
| `ParsedModelName()` | `frontend/src/utils/dom/display:6` | 解析后的模型文件名字段 |
| `parseModelName()` | `frontend/src/utils/dom/display:28` | 解析模型文件名 → 结构化字段 支持格式: [作者]【作品】角色变体2023-05.ysm 也兼容: [作者]《作品》角色变体2023-05.ysm |
| `renderDisplayName()` | `frontend/src/utils/dom/display:79` | 渲染美化文件名 HTML（通用接口） 应用 CSS 变量: --meta-author, --meta-work, --meta-date |
| `renderModelName()` | `frontend/src/utils/dom/display:157` | renderModelName = renderDisplayName 别名，options.showExt 支持 |
| `renderModelNameWithHighlight()` | `frontend/src/utils/dom/display:166` | 搜索高亮版：先对纯文本高亮，再渲染 HTML，避免 keyword 命中 HTML 标签内容破坏 DOM |
| `friendlyError()` | `frontend/src/utils/dom/errors:9` | 将 Go 错误转换为中文友好提示 |
| `fmt()` | `frontend/src/utils/dom/format:4` | 字节数 → 可读大小（B/KB/MB/GB），非法值返回空串 |
| `sizeColor()` | `frontend/src/utils/dom/format:13` | 文件大小颜色 class：&lt;1MB 绿色，1-3MB 正常，&gt;3MB 红色 |
| `fmtDate()` | `frontend/src/utils/dom/format:23` | 时间戳 → 友好日期：今天显时间，今年显 M月D日，往年显 YYYY/M/D |
| `esc()` | `frontend/src/utils/dom/html:4` | HTML 转义（治理红线：所有 innerHTML 拼接必须过 esc） |
| `renderFormattedText()` | `frontend/src/utils/format/mc-format:45` | 将含 Minecraft § 分节符的文本渲染为带颜色的 HTML。 |
| `PackMeta()` | `frontend/src/utils/format/pack-format:92` | ReadPackMeta 返回的 JSON 对象（仅覆盖用到的字段） |
| `describeVersionRange()` | `frontend/src/utils/format/pack-format:103` | 根据 meta 对象生成格式号 + 版本号描述 |
| `SummaryAuthor()` | `frontend/src/utils/format/summarize:8` | — |
| `SummaryAnimGroup()` | `frontend/src/utils/format/summarize:14` | — |
| `SummaryConfigMenu()` | `frontend/src/utils/format/summarize:20` | — |
| `YsmSummary()` | `frontend/src/utils/format/summarize:25` | — |
| `YSMHeader()` | `frontend/src/utils/format/summarize:50` | — |
| `summaryCardHTML()` | `frontend/src/utils/format/summarize:153` | 从 YsmSummary + YSMHeader 渲染为精简摘要卡片 |
| `fileIcon()` | `frontend/src/utils/icon/icon:9` | 按扩展名返回图标 emoji |
| `isYsmName()` | `frontend/src/utils/icon/icon:28` | 是否为 YSM 文件 |
| `ICONS()` | `frontend/src/utils/icon/workshop-icons:3` | — |
| `getSiteIcon()` | `frontend/src/utils/icon/workshop-icons:46` | — |
| `getTagIconFromRole()` | `frontend/src/utils/icon/workshop-icons:50` | — |
| `RESOURCE_EXTS()` | `frontend/src/utils/resource/extensions:8` | 每种资源类型对应的扩展名 |
| `ALL_EXTS()` | `frontend/src/utils/resource/extensions:19` | 所有支持的扩展名列表（去重，用于 UI 提示文案） |
| `getExts()` | `frontend/src/utils/resource/extensions:34` | 获取某资源类型支持的扩展名 |
| `isSupportedExt()` | `frontend/src/utils/resource/extensions:39` | 检查扩展名是否被某资源类型支持 |
| `extBelongsTo()` | `frontend/src/utils/resource/extensions:44` | 返回扩展名所属的资源类型 ID |
| `ResourceTypeEntry()` | `frontend/src/utils/resource/registry:6` | 资源类型注册表条目（对应 resource_types.json 结构） |
| `loadResourceRegistry()` | `frontend/src/utils/resource/registry:19` | 加载资源类型注册表（失败不缓存：Go 桥瞬断后下次调用重试，避免整会话降级） |
| `RESOURCE_TYPES()` | `frontend/src/utils/resource/types:4` | 资源类型 ID（键为类型标签，值为内部 ID） |
| `RESOURCE_TYPE_LABELS()` | `frontend/src/utils/resource/types:15` | 资源类型显示标签（内部 ID → 中文名） |
| `ALL_RESOURCE_TYPES()` | `frontend/src/utils/resource/types:26` | 全部资源类型 ID 列表 |

## frontend/views

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `LocalCreator()` | `frontend/src/views/app-content/community-data:7` | 本地合并后的创作者（绑定 WorkshopCreator + 运行时附加字段） |
| `CommunityData()` | `frontend/src/views/app-content/community-data:23` | 站点 + 创作者 + 作者 数据包 |
| `loadCommunityData()` | `frontend/src/views/app-content/community-data:33` | 加载站点 + 创作者数据（纯数据，不碰 DOM） 自动合并本地仓库提取的作者 |
| `fillSearch()` | `frontend/src/views/app-content/community-data:104` | 替换 {{q}} 为查询词 |
| `fetchCommunityCreators()` | `frontend/src/views/app-content/community-data:156` | 从 GitHub 拉取 creators.json（三路回退） |
| `mergeCommunityCreators()` | `frontend/src/views/app-content/community-data:185` | 合并社区索引到本地 creators.json |
| `fetchCommunitySites()` | `frontend/src/views/app-content/community-data:222` | 从 GitHub 拉取 workshop_sites.json（三路回退） |
| `mergeCommunitySites()` | `frontend/src/views/app-content/community-data:246` | 合并社区站点到本地 workshop_sites.json |
| `DEFAULT_COMMUNITY_URL()` | `frontend/src/views/app-content/community-data:267` | 社区索引的默认 URL（可配置为社区维护的独立 creators JSON） 贡献通道：https://github.com/eghrhegpe/ysm-model-manager |
| `contentCSS()` | `frontend/src/views/app-content/content-css:2` | — |
| `initDiagnostics()` | `frontend/src/views/app-content/diagnostics/community:16` | 初始化诊断页所有功能 |
| `startDedup()` | `frontend/src/views/app-content/diagnostics/community:251` | 去重结果容器统一显式传入（消除 mock root 包装 + 幽灵 id diag-dedup-list）。 |
| `initSettings()` | `frontend/src/views/app-content/settings/community:17` | 初始化设置页所有事件绑定 |
| `RepoAuthorLike()` | `frontend/src/views/app-content/site-view:11` | 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） |
| `RenderSiteViewCtx()` | `frontend/src/views/app-content/site-view:14` | 竚点视图渲染上下文（index.ts _initWorkshop 传入） |
| `LocalCreatorLike()` | `frontend/src/views/app-content/site-view:31` | 本地创作者（绑定 + 运行时附加字段） |
| `renderSiteView()` | `frontend/src/views/app-content/site-view:42` | 站点视图渲染主入口 — 编排壳：构造数据 → 构 HTML → 绑事件 → 聚 cleanup。 |
| `bindDragEvents()` | `frontend/src/views/app-content/site/drag:13` | 绑定拖拽 JSON 导入事件：创作者 JSON / 站点 JSON 识别 + 合并。 |
| `bindEditEvents()` | `frontend/src/views/app-content/site/edit:15` | 绑定编辑模式事件：编辑入口 / 拉取配置 / 取消 / 保存 / 行内编辑 / 删除创作者 / 拖拽排序 / 增删搜索词 / 搜索过滤。 |
| `bindBrowseEvents()` | `frontend/src/views/app-content/site/events:27` | 绑定浏览态事件：空状态按钮 / 创作者卡片网格 / 预设搜索 / 收藏 / 头像调试 / 卡片点击详情浮层 / 键盘导航 / storage 同步 / 浏览仓库模型。 |
| `CrCardCtx()` | `frontend/src/views/app-content/site/render:12` | 创作者卡片工厂上下文 |
| `BuildSiteHtmlCtx()` | `frontend/src/views/app-content/site/render:23` | buildSiteHtml 依赖的渲染上下文 |
| `createCrCard()` | `frontend/src/views/app-content/site/render:35` | 创作者卡片工厂 |
| `SiteViewState()` | `frontend/src/views/app-content/site/types:12` | SiteViewState —— renderSiteView 内部闭包共享变量的显式收拢。 |
| `CleanupFn()` | `frontend/src/views/app-content/site/types:39` | bindXxxEvents 函数的统一返回：清理函数，主入口聚合成单一 cleanup |
| `repositoryHTML()` | `frontend/src/views/app-content/tpl:4` | — |
| `instancesHTML()` | `frontend/src/views/app-content/tpl:44` | — |
| `settingsHTML()` | `frontend/src/views/app-content/tpl:65` | — |
| `downloadsHTML()` | `frontend/src/views/app-content/tpl:437` | — |
| `diagnosticsHTML()` | `frontend/src/views/app-content/tpl:488` | — |
| `recycleHTML()` | `frontend/src/views/app-content/tpl:547` | — |
| `githubHTML()` | `frontend/src/views/app-content/tpl:560` | ===== GitHub 仓库页面 ===== |
| `workshopHTML()` | `frontend/src/views/app-content/tpl:591` | — |
| `CreatorIdentity()` | `frontend/src/views/app-content/workshop-data:8` | 创作者身份识别结果 |
| `CreatorIdentityInput()` | `frontend/src/views/app-content/workshop-data:15` | 创作者输入（role/tag 可空，_fromLocal 为运行时附加字段） |
| `getCreatorIdentity()` | `frontend/src/views/app-content/workshop-data:22` | — |
| `getTagFromRole()` | `frontend/src/views/app-content/workshop-data:44` | — |
| `parseDescTags()` | `frontend/src/views/app-content/workshop-data:49` | — |
| `loadFavs()` | `frontend/src/views/app-content/workshop-data:59` | — |
| `isFaved()` | `frontend/src/views/app-content/workshop-data:71` | — |
| `toggleFav()` | `frontend/src/views/app-content/workshop-data:75` | — |
| `CacheValue()` | `frontend/src/views/app-preview/cache:10` | 缓存条目值 |
| `cacheSetEvictHandler()` | `frontend/src/views/app-preview/cache:39` | 注册 evict 回调，淘汰条目时调用 |
| `cacheGet()` | `frontend/src/views/app-preview/cache:43` | — |
| `cacheSet()` | `frontend/src/views/app-preview/cache:47` | — |
| `previewCSS()` | `frontend/src/views/app-preview/css:2` | — |
| `showModelDetail()` | `frontend/src/views/app-preview/detail:15` | 显示模型详情（YSM 模型） |
| `showResourcePack()` | `frontend/src/views/app-preview/detail:102` | 显示资源包信息（pack.mcmeta + pack.png） |
| `showShaderPack()` | `frontend/src/views/app-preview/detail:139` | 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 |
| `BedrockCube()` | `frontend/src/views/app-preview/geometry:4` | Bedrock 方块 |
| `BedrockBone()` | `frontend/src/views/app-preview/geometry:15` | Bedrock 骨骼 |
| `BedrockGeometry()` | `frontend/src/views/app-preview/geometry:30` | 解析后的 Bedrock geometry |
| `parseBedrockGeometryFromJSON()` | `frontend/src/views/app-preview/geometry:53` | 从 JSON 字符串解析 Bedrock geometry |
| `cleanupVoxel3D()` | `frontend/src/views/app-preview/litematic-3d:25` | 清理体素 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 |
| `createLitematic3D()` | `frontend/src/views/app-preview/litematic-3d:32` | — |
| `showLitematic()` | `frontend/src/views/app-preview/litematic-meta:91` | 显示投影文件详情面板（tab 布局） |
| `cleanupLitematic3D()` | `frontend/src/views/app-preview/litematic-meta:214` | 组件销毁时清理体素 3D（转发至 litematic-3d，避免 index 静态依赖 Three.js 渲染模块） |
| `loadModelData()` | `frontend/src/views/app-preview/loader:13` | 加载模型几何数据 + 纹理 + 作者信息 统一路径：缓存 → WASM 解码 → Go AnalyzeBedrockModel 兜底 |
| `ModelLike()` | `frontend/src/views/app-preview/model3d-loader:6` | 模型对象（轻量接口，覆盖 loadTextures/fetchSpec/preloadModel 用到的字段） |
| `ModelSpec()` | `frontend/src/views/app-preview/model3d-loader:14` | Go 返回的 3D spec（models 数组） |
| `loadTextures()` | `frontend/src/views/app-preview/model3d-loader:30` | 并行加载纹理 URL 列表，返回 THREE.Texture 数组 |
| `preloadModel()` | `frontend/src/views/app-preview/model3d-loader:100` | 预加载：纹理 + spec 并行获取 |
| `AngleShot()` | `frontend/src/views/app-preview/screenshot-renderer:7` | — |
| `renderMultiAngle()` | `frontend/src/views/app-preview/screenshot-renderer:13` | — |
| `loadModel2D()` | `frontend/src/views/app-preview/skeleton:34` | 加载模型 2D 骨骼线条图 + 统计面板 ctx = 组件实例（提供 this._root, this._appendDebug 等） |
| `ModelDetailMeta()` | `frontend/src/views/app-preview/tpl:5` | 模型统计元数据（modelDetailHTML 入参） |
| `modelDetailHTML()` | `frontend/src/views/app-preview/tpl:19` | 模型详情面板（仓库页面） |
| `StatsCardModel()` | `frontend/src/views/app-preview/tpl:57` | 模型统计卡片（statsCardHTML 入参的几何视图） |
| `statsCardHTML()` | `frontend/src/views/app-preview/tpl:66` | 模型统计卡片 |
| `devLog()` | `frontend/src/views/app-preview/utils:6` | DEV 模式下输出调试日志 |
| `DecodedYsm()` | `frontend/src/views/app-preview/utils:11` | WASM 解码结果（decodeYsmViaWasm 返回） |
| `PreviewCtx()` | `frontend/src/views/app-preview/utils:26` | 预览上下文（index.ts AppPreview 类实现的接口，子模块以最小面引用） |
| `getPrefer3D()` | `frontend/src/views/app-preview/utils:38` | — |
| `setPrefer3D()` | `frontend/src/views/app-preview/utils:41` | — |
| `stripYsgpTextHeader()` | `frontend/src/views/app-preview/utils:108` | 剥离 YSGP 文本头部，返回标准二进制格式 |
| `decodeYsmViaWasm()` | `frontend/src/views/app-preview/wasm:27` | 通过前端 WASM 解码 .ysm，返回 { texture, geometry, animations } 不依赖组件实例（无 this 引用），可独立调用 |
| `openFullPreview()` | `frontend/src/views/app-preview/zoom:7` | 全窗放大预览（独立函数，不依赖组件实例） |
| `registerResourceManagerGlobal()` | `frontend/src/views/app-resource-manager/index:51` | 全局配置刷新监听：registerGlobalHandlers 统一收集 unsub （替代顶层无守卫注册 — ADR-008 违规点，TS 化后收敛） |
| `AppResourceManager()` | `frontend/src/views/app-resource-manager/index:71` | — |
| `PackMetaDetail()` | `frontend/src/views/app-resource-manager/tpl:7` | 详情面板元数据（ReadPackMeta / ReadShaderpackLang 返回 JSON 的兼容视图） |
| `sidebarHTML()` | `frontend/src/views/app-resource-manager/tpl:20` | 侧栏布局（路径 + 操作栏 + 列表） |
| `itemHTML()` | `frontend/src/views/app-resource-manager/tpl:60` | 列表项 HTML |
| `detailHTML()` | `frontend/src/views/app-resource-manager/tpl:97` | 详情面板 HTML |
| `placeholderHTML()` | `frontend/src/views/app-resource-manager/tpl:154` | 空状态占位 |
| `SidebarInstance()` | `frontend/src/views/app-sidebar/data:4` | sidebar 整合包实例（loader 转换后的渲染格式） |
| `bindCardEvents()` | `frontend/src/views/app-sidebar/events:15` | — |
| `bindFooter()` | `frontend/src/views/app-sidebar/events:136` | — |
| `MmdVariantGroups()` | `frontend/src/views/app-sidebar/loader:19` | MMD 变体聚合结果 |
| `loadInstances()` | `frontend/src/views/app-sidebar/loader:26` | 从 Go 加载整合包实例列表，转换为 render 需要的格式 |
| `groupMmdVariants()` | `frontend/src/views/app-sidebar/loader:149` | 对 MMD 类型，按父文件夹聚合 .pmx 变体文件。 |
| `renderVersionCards()` | `frontend/src/views/app-sidebar/render:6` | — |
| `sidebarCSS()` | `frontend/src/views/app-sidebar/sidebar-css:3` | — |
| `headerHTML()` | `frontend/src/views/app-sidebar/tpl:16` | — |
| `footerHTML()` | `frontend/src/views/app-sidebar/tpl:35` | — |
| `listContainerHTML()` | `frontend/src/views/app-sidebar/tpl:58` | — |
| `vcHeaderHTML()` | `frontend/src/views/app-sidebar/tpl:77` | 单个整合包卡片头部。 |
| `AppSyncManager()` | `frontend/src/views/app-sync-manager/index:41` | — |
| `SyncItem()` | `frontend/src/views/app-sync-manager/tpl:7` | 同步列表项（GetInstanceSyncStatus 返回 JSON 条目） |
| `containerHTML()` | `frontend/src/views/app-sync-manager/tpl:19` | 容器骨架 |
| `statusTabHTML()` | `frontend/src/views/app-sync-manager/tpl:58` | 状态筛选标签 HTML |
| `itemHTML()` | `frontend/src/views/app-sync-manager/tpl:87` | 列表项 HTML |
| `emptyHTML()` | `frontend/src/views/app-sync-manager/tpl:145` | 空状态 HTML |
| `loadingHTML()` | `frontend/src/views/app-sync-manager/tpl:159` | 加载中 |
| `treeCSS()` | `frontend/src/views/app-tree/app-tree-styles:3` | — |
| `AuthorInfo()` | `frontend/src/views/app-tree/authors:5` | 作者统计（Go ListModelAuthors 返回） |
| `loadAuthors()` | `frontend/src/views/app-tree/authors:13` | 从 Go 端加载作者列表 |
| `bindBusEvents()` | `frontend/src/views/app-tree/bus-handlers:13` | — |
| `selectState()` | `frontend/src/views/app-tree/data:4` | 多选状态 |
| `toggleSelect()` | `frontend/src/views/app-tree/data:16` | 切换选中状态 |
| `selectOnly()` | `frontend/src/views/app-tree/data:31` | 单选：清空后选中单个并设为 lastKey（用于单击选中，避免外部直接写 selectState） |
| `updateSelectCount()` | `frontend/src/views/app-tree/events:11` | — |
| `bindTreeEvents()` | `frontend/src/views/app-tree/events:92` | — |
| `setPendingTreeSearch()` | `frontend/src/views/app-tree/index:20` | — |
| `AppTree()` | `frontend/src/views/app-tree/index:49` | — |
| `initInstanceActions()` | `frontend/src/views/app-tree/instance-actions:24` | — |
| `TreeEntry()` | `frontend/src/views/app-tree/loader:9` | 树条目（loader 转换后的渲染格式） |
| `loadEntries()` | `frontend/src/views/app-tree/loader:37` | 从 Go 后端加载仓库文件列表，返回格式化的 entries |
| `TreeRow()` | `frontend/src/views/app-tree/render:21` | 扁平化行（虚拟滚动数据单元） |
| `TreeNode()` | `frontend/src/views/app-tree/render:31` | buildTree 嵌套节点（文件夹 = 子节点对象，文件 = { _e: entry }） |
| `RenderMode()` | `frontend/src/views/app-tree/render:37` | 渲染模式 |
| `getRenderMode()` | `frontend/src/views/app-tree/render:43` | Get render mode from localStorage, default to 'grid' |
| `setRenderMode()` | `frontend/src/views/app-tree/render:53` | Set render mode to localStorage |
| `buildTree()` | `frontend/src/views/app-tree/render:60` | — |
| `flattenVisible()` | `frontend/src/views/app-tree/render:138` | — |
| `cleanupVirtualScroll()` | `frontend/src/views/app-tree/render:280` | 断开虚拟滚动相关监听 |
| `renderTree()` | `frontend/src/views/app-tree/render:289` | — |
| `updateStat()` | `frontend/src/views/app-tree/render:353` | — |
| `fileRowCommon()` | `frontend/src/views/app-tree/row-common:11` | 文件行公共计算：path 转义、开关状态、禁用 class、类型图标、缩进 |
| `folderRowCommon()` | `frontend/src/views/app-tree/row-common:34` | 文件夹行公共计算：图标、颜色、箭头、开关 class、显示名、缩进 |
| `listFileRowHTML()` | `frontend/src/views/app-tree/row-tpl-list:8` | 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） |
| `listFolderRowHTML()` | `frontend/src/views/app-tree/row-tpl-list:25` | 文件夹行 HTML（紧凑列表模式：arrow + folder icon + name） |
| `fileRowHTML()` | `frontend/src/views/app-tree/row-tpl:8` | 文件行 HTML（indent = padding-left，rowCls 用于选中高亮等行级类） |
| `folderRowHTML()` | `frontend/src/views/app-tree/row-tpl:31` | 文件夹行 HTML（indent = padding-left，扁平化无 .ch 容器） |
| `bindToolbarEvents()` | `frontend/src/views/app-tree/toolbar-events:209` | — |
| `headerHTML()` | `frontend/src/views/app-tree/tpl:3` | — |
| `footerHTML()` | `frontend/src/views/app-tree/tpl:27` | — |
| `emptyHTML()` | `frontend/src/views/app-tree/tpl:35` | — |
| `spinnerHTML()` | `frontend/src/views/app-tree/tpl:39` | — |
| `flashBtn()` | `frontend/src/views/app-tree/utils:4` | — |
| `ROW_H_GRID()` | `frontend/src/views/app-tree/virtual-scroll:3` | — |
| `ROW_H_LIST()` | `frontend/src/views/app-tree/virtual-scroll:4` | — |
| `calcVisibleRange()` | `frontend/src/views/app-tree/virtual-scroll:14` | 根据滚动位置计算可见行范围（支持动态行高） |
| `installScrollSync()` | `frontend/src/views/app-tree/virtual-scroll:31` | 在容器上安装滚动监听，当滚动到新范围时自动重新渲染可见行 |

## 前端·Wails 桥接

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `getApp()` | `frontend/src/wails/app:11` | 获取 Go App 绑定的缓存引用，避免重复动态 import |

## 前端·WASM

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `_getGlueCode()` | `frontend/src/wasm/ysm-glue-data:4` | — |
| `YsmDecodedFile()` | `frontend/src/wasm/ysm-parser:46` | 解码输出文件 |
| `initYSMParser()` | `frontend/src/wasm/ysm-parser:59` | — |
| `decodeYsmFileFromMemory()` | `frontend/src/wasm/ysm-parser:142` | 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组） 返回 [{path, data}]，失败返回 null |
| `decodeYsmFile()` | `frontend/src/wasm/ysm-parser:181` | 通过 callMain + MEMFS 解码 .ysm（回退路径） 保留以兼容旧的 WASM 编译 |
| `_getWasmBinary()` | `frontend/src/wasm/ysm-wasm-data:4` | — |

---

> 说明列由 funcmap 自动提取导出符号紧邻 JSDoc/注释的首句摘要（无注释则留 —）。
> Go 方法记为 `Type.Method`；符号列统一以 `()` 结尾（与 MikuMikuAR 约定一致）。