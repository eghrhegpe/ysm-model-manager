# 函数映射表

> AI 找代码用。改功能前先 grep 此表定位文件:行。
> **自动生成** — 由 `scripts/funcmap.mjs` 生成（提取 Go/JS/TS 导出符号，参考 MikuMikuAR docs/function-map.md 风格）。

## 总览

| 模块 | 文件数 | 导出符号数 |
|------|--------|-----------|
| Go·头像 | 4 | 11 |
| go/cli | 4 | 29 |
| go/config | 1 | 3 |
| go/container | 1 | 30 |
| Go·去重 | 2 | 16 |
| Go·下载 | 1 | 16 |
| go/executil | 2 | 2 |
| go/fileops | 4 | 13 |
| Go·文件系统 | 10 | 22 |
| Go·几何 | 2 | 11 |
| Go·导入 | 2 | 16 |
| Go·安装 | 1 | 10 |
| go/instance | 1 | 4 |
| go/internal | 1 | 3 |
| Go·Litematic | 6 | 9 |
| Go·日志 | 2 | 12 |
| Go·包管理 | 1 | 3 |
| Go·路径 | 1 | 7 |
| Go·回收站 | 2 | 19 |
| go/repoaudit | 1 | 9 |
| go/rustbridge | 5 | 10 |
| go/scanner | 1 | 12 |
| Go·同步 | 9 | 38 |
| Go·标签 | 1 | 8 |
| go/texture_cache | 1 | 13 |
| Go·Three.js | 1 | 6 |
| Go·类型 | 8 | 101 |
| Go·更新器 | 1 | 10 |
| Go·监听 | 1 | 6 |
| Go·YSM 核心 | 7 | 26 |
| Go(internal)·应用入口 | 28 | 211 |
| 前端·根 (app-modules/bus) | 4 | 17 |
| frontend/backend | 22 | 110 |
| 前端·核心 | 18 | 36 |
| 前端·特性 | 17 | 82 |
| 前端·服务 | 2 | 18 |
| frontend/test-utils | 5 | 35 |
| frontend/ui | 18 | 64 |
| 前端·工具 | 163 | 644 |
| frontend/views | 115 | 333 |
| 前端·WASM | 9 | 22 |
| frontend/workers | 2 | 14 |
| **合计** | **487** | **2061** |

## Go·头像

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SetNodeJS()` | `go/avatar/avatar_decode:39` | SetNodeJS 设置 Node.js 路径和 WASM/胶水代码加载函数。 |
| `limitedBuffer.Write()` | `go/avatar/avatar_decode:54` | — |
| `DecodeYSMFiles()` | `go/avatar/avatar_decode:63` | DecodeYSMFiles 底层解码，返回完整文件列表。 |
| `ExtractAvatarURI()` | `go/avatar/avatar_extract:25` | ExtractAvatarURI 从模型文件中提取指定所有者的头像 data URI。 |
| `CacheAvatarsFromJSON()` | `go/avatar/avatar_extract:179` | CacheAvatarsFromJSON 从解压目录的 ysm.json 缓存所有作者头像。 |
| `CacheAvatarsFromModel()` | `go/avatar/avatar_extract:249` | CacheAvatarsFromModel 从 .ysm/.zip/.json 模型缓存所有作者头像。 |
| `ReadFileFromZip()` | `go/avatar/avatar_zip:20` | ReadFileFromZip 从 ZIP 读取指定路径的文件。 |
| `ReadFileFromContainer()` | `go/avatar/avatar_zip:55` | ReadFileFromContainer 从统一容器读取指定路径的文件（ADR-068： 容器打开统一走 container，替代 zip.NewReader + ReadFil |
| `SafeName()` | `go/avatar/avatar:45` | SafeName 将非法文件名字符替换为下划线。 |
| `ReadCachedAvatar()` | `go/avatar/avatar:139` | ReadCachedAvatar 读取缓存中的头像，返回 data URI。 |
| `SaveAvatarData()` | `go/avatar/avatar:165` | SaveAvatarData 将头像数据写入缓存。 |

## go/cli

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `RunCLI()` | `go/cli/cli:14` | RunCLI 执行 CLI 模式 |
| `ExecuteCLIWithApp()` | `go/cli/cli:72` | ExecuteCLIWithApp 执行 CLI 命令 |
| `NewJsonSuccess()` | `go/cli/json:39` | NewJsonSuccess 创建成功响应 |
| `NewJsonError()` | `go/cli/json:50` | NewJsonError 创建错误响应 |
| `NewJsonNotSupported()` | `go/cli/json:81` | NewJsonNotSupported 创建平台不支持响应 |
| `JsonResponse.ToJson()` | `go/cli/json:94` | ToJson 将响应序列化为 JSON 字符串 |
| `IsCommandAllowed()` | `go/cli/json:103` | IsCommandAllowed 检查命令是否已注册（自动派生自 cliCommands 注册表，无需手动白名单） |
| `GetAllowedCommands()` | `go/cli/json:110` | GetAllowedCommands 返回所有已注册命令（自动派生自 cliCommands 注册表） 新增命令只需 RegisterCommand，无需手动同步白名单 |
| `JsonResponse()` | `go/cli/json:12` | JsonResponse 统一 JSON 输出协议 |
| `JsonError()` | `go/cli/json:22` | JsonError 错误详情 |
| `TimingInfo()` | `go/cli/json:29` | TimingInfo 耗时统计 |
| `MetaInfo()` | `go/cli/json:34` | MetaInfo 元信息 |
| `RegisterCommand()` | `go/cli/registry:39` | RegisterCommand 注册一个 CLI 子命令（默认归入 CatOther） 重复注册会输出警告并跳过，不再 panic（init() 阶段 panic 无法 recov |
| `RegisterCommandC()` | `go/cli/registry:44` | RegisterCommandC 注册带分类的 CLI 子命令 |
| `GetCommand()` | `go/cli/registry:58` | GetCommand 获取已注册的命令 |
| `GetAllCommands()` | `go/cli/registry:64` | GetAllCommands 获取所有已注册命令 |
| `DispatchCommand()` | `go/cli/registry:73` | DispatchCommand 分发命令执行 |
| `CmdContext()` | `go/cli/registry:11` | CmdContext 统一命令执行上下文 |
| `CliCommand()` | `go/cli/registry:18` | CliCommand 命令注册结构 |
| `ErrParam.Error()` | `go/cli/shared:28` | — |
| `ErrParam.Unwrap()` | `go/cli/shared:35` | — |
| `ErrRuntime.Error()` | `go/cli/shared:43` | — |
| `ErrRuntime.Unwrap()` | `go/cli/shared:50` | — |
| `ExitCodeOf()` | `go/cli/shared:53` | ExitCodeOf 根据错误类型返回退出码 |
| `PrintError()` | `go/cli/shared:62` | PrintError 输出错误到 stderr |
| `ParseCommandArgs()` | `go/cli/shared:71` | ParseCommandArgs 从参数中提取 files-root、--json 开关和命令参数 返回: filesRoot, jsonMode, commandArgs（不含全 |
| `outputBuffer.String()` | `go/cli/shared:191` | — |
| `ErrParam()` | `go/cli/shared:23` | ErrParam 参数错误（exit code 2） |
| `ErrRuntime()` | `go/cli/shared:38` | ErrRuntime 运行时业务错误（exit code 1） |

## go/config

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Set()` | `go/config/config:28` | Set 注入运行阈值配置源。薄壳 internal/app 启动时调用，取代 4 包各自 SetConfigFunc。 |
| `Get()` | `go/config/config:37` | Get 返回当前 AppConfig。未注入时返回零值，字段 0 由消费包回退各自包级默认常量。 |
| `Provider()` | `go/config/config:21` | Provider 运行阈值配置源。区别于常见配置注入，这里保持函数形以支持运行期重读。 |

## go/container

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `zipEntry.Name()` | `go/container/container:47` | — |
| `zipEntry.IsDir()` | `go/container/container:48` | — |
| `zipEntry.UncompressedSize64()` | `go/container/container:49` | — |
| `zipEntry.Open()` | `go/container/container:50` | — |
| `zipContainer.Entries()` | `go/container/container:59` | — |
| `zipContainer.Close()` | `go/container/container:71` | — |
| `zipContainer.Incomplete()` | `go/container/container:78` | — |
| `sevenzipEntry.Name()` | `go/container/container:85` | — |
| `sevenzipEntry.IsDir()` | `go/container/container:86` | — |
| `sevenzipEntry.UncompressedSize64()` | `go/container/container:87` | — |
| `sevenzipEntry.Open()` | `go/container/container:88` | — |
| `sevenzipContainer.Entries()` | `go/container/container:97` | — |
| `sevenzipContainer.Close()` | `go/container/container:105` | — |
| `sevenzipContainer.Incomplete()` | `go/container/container:112` | — |
| `dirEntry.Name()` | `go/container/container:123` | — |
| `dirEntry.IsDir()` | `go/container/container:124` | — |
| `dirEntry.UncompressedSize64()` | `go/container/container:125` | — |
| `dirEntry.Open()` | `go/container/container:136` | — |
| `Open()` | `go/container/container:50` | — |
| `OpenZipPath()` | `go/container/container:177` | OpenZipPath 按路径打开 zip 容器。 |
| `OpenZipBytes()` | `go/container/container:186` | OpenZipBytes 从内存打开 zip 容器。 |
| `Open7zPath()` | `go/container/container:195` | Open7zPath 按路径打开 7z 容器。 |
| `Open7zBytes()` | `go/container/container:204` | Open7zBytes 从内存打开 7z 容器。 |
| `dirContainer.Entries()` | `go/container/container:264` | — |
| `dirContainer.Close()` | `go/container/container:265` | — |
| `dirContainer.Incomplete()` | `go/container/container:266` | — |
| `OpenDir()` | `go/container/container:269` | OpenDir 打开目录容器（导出，供已解压资源包/光影包分支）。 |
| `ZipMatchesEntries()` | `go/container/container:281` | ZipMatchesEntries 打开 zip 容器并枚举条目名，任一命中 match 即返回 true。 |
| `Entry()` | `go/container/container:26` | Entry 统一容器条目（zip.File / sevenzip.File / 目录文件）。 |
| `Reader()` | `go/container/container:34` | Reader 容器读取器。 |

## Go·去重

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `FindDuplicateFiles()` | `go/dedup/dedup:167` | FindDuplicateFiles 扫描目录，按配置的哈希算法分组，返回包含重复的分组 skipRecycle 为 true 时跳过 .recycle 子目录 config 为去 |
| `CountDuplicates()` | `go/dedup/dedup:241` | CountDuplicates 统计重复文件数量（比 FindDuplicateFiles 轻量，只计数） 同样消费共享并行哈希管道（ADR-119 P1：与 FindDuplic |
| `CleanEmptyDirs()` | `go/dedup/dedup:286` | CleanEmptyDirs 递归删除指定目录下的所有空子目录（不含 dir 自身）。 |
| `FileEntry()` | `go/dedup/dedup:25` | FileEntry 文件条目 |
| `Group()` | `go/dedup/dedup:33` | Group 重复文件分组 |
| `DeepHash.Name()` | `go/dedup/strategy:25` | — |
| `DeepHash.ComputeHash()` | `go/dedup/strategy:29` | — |
| `QuickHash.Name()` | `go/dedup/strategy:47` | — |
| `QuickHash.ComputeHash()` | `go/dedup/strategy:51` | — |
| `NameSizeHash.Name()` | `go/dedup/strategy:69` | — |
| `NameSizeHash.ComputeHash()` | `go/dedup/strategy:73` | — |
| `NewHashAlgorithm()` | `go/dedup/strategy:83` | NewHashAlgorithm 根据配置创建哈希算法实例 |
| `HashAlgorithm()` | `go/dedup/strategy:15` | HashAlgorithm 去重算法策略接口 |
| `DeepHash()` | `go/dedup/strategy:23` | DeepHash 深度哈希算法 (基于 SHA256) - 精确但较慢 |
| `QuickHash()` | `go/dedup/strategy:45` | QuickHash 快速哈希算法 (基于 MD5) - 速度较快，适合大文件 |
| `NameSizeHash()` | `go/dedup/strategy:67` | NameSizeHash 基于文件名和大小的"伪哈希" - 速度最快但不精确 |

## Go·下载

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `HTTPStatusError.Error()` | `go/download/download:81` | — |
| `TruncationError.Error()` | `go/download/download:89` | — |
| `TruncationError.Unwrap()` | `go/download/download:95` | Unwrap 让 errors.Is(err, ErrTruncated) 成立——调用方既可判断类别（errors.Is）， 又可提取数值（errors.As），无需文本匹配（# |
| `Downloader.WithRetry()` | `go/download/download:128` | WithRetry 返回开启重试的下载器副本（不改原实例）。 |
| `New()` | `go/download/download:193` | New 创建 Downloader，默认 5 分钟超时（可被 AppConfig.DownloadTimeoutSec 覆盖，ADR-062）。 |
| `NewWithClient()` | `go/download/download:198` | NewWithClient 使用指定 HTTP client。 |
| `Downloader.File()` | `go/download/download:498` | File 从 URL 下载文件到 savePath，支持进度回调。ctx 取消/超时即中断下载。 |
| `Downloader.FileWithChecksum()` | `go/download/download:504` | FileWithChecksum 与 File 相同，额外校验下载内容 SHA256 与期望值一致。 |
| `Downloader.FromGitHubAPI()` | `go/download/download:509` | FromGitHubAPI 从 GitHub API 下载（设置 Accept 头）。ctx 取消/超时即中断下载。 |
| `Downloader.FromGitHubAPIWithChecksum()` | `go/download/download:514` | FromGitHubAPIWithChecksum 与 FromGitHubAPI 相同，额外校验 SHA256（P2 预留，语义同 FileWithChecksum）。 |
| `ResolveSavePath()` | `go/download/download:538` | ResolveSavePath 从 GitHub raw URL 解析存储路径和回退源。 |
| `HTTPStatusError()` | `go/download/download:77` | HTTPStatusError 携带 HTTP 状态码的类型化错误，调用方用 errors.As 提取码值， 替代 strings.Contains(err.Error(), "4 |
| `TruncationError()` | `go/download/download:84` | TruncationError 携带期望/实际字节数的截断错误，调用方用 errors.As 提取数值做诊断上报。 |
| `ProgressFn()` | `go/download/download:98` | ProgressFn 下载进度回调。downloaded / total 为字节数。 |
| `Downloader()` | `go/download/download:101` | Downloader 文件下载器。 |
| `RetryPolicy()` | `go/download/download:121` | RetryPolicy 下载重试策略（字段 0 回退包级默认常量，见 WithRetry 注释）。 |

## go/executil

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `HideWindow()` | `go/executil/hidewindow_other:8` | HideWindow 非 Windows no-op（Unix 无控制台窗口概念）。 |
| `HideWindow()` | `go/executil/hidewindow_windows:15` | HideWindow 隐藏子进程控制台窗口（Windows 专属）。 |

## go/fileops

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ToggleModelEnable()` | `go/fileops/fileops_enable:26` | ToggleModelEnable 切换禁用状态文件（返回是否处于启用态；缓存失效由薄壳处理） ADR-038 D3.7：src 为 ysm.json 时提升为父目录级 .disa |
| `IsFileBanned()` | `go/fileops/fileops_enable:141` | IsFileBanned 判断路径是否被禁用标记（文件级或目录级，ADR-038 D3.7） 支持新标准 .disabled 和历史 .ban。 |
| `FindPreviewImage()` | `go/fileops/fileops_preview:24` | FindPreviewImage 查找模型同目录的预览图并转 data URI |
| `ExtractPreviewTexture()` | `go/fileops/fileops_preview:50` | ExtractPreviewTexture 从模型文件中提取预览纹理（zip/7z/ysm/json） |
| `GetPackInfo()` | `go/fileops/fileops_preview:154` | GetPackInfo 读取 ysm-pack.json（root 为空时按绝对路径处理） |
| `CreateDir()` | `go/fileops/fileops:52` | CreateDir 在 root 下创建子目录（校验非法字符，与 RenameDir 对齐） |
| `RenameDir()` | `go/fileops/fileops:70` | RenameDir 重命名目录（仅改末段，保持父目录） |
| `RemoveDir()` | `go/fileops/fileops:96` | RemoveDir 递归删除目录（基础安全校验——拒绝空路径/NUL/穿越段/根目录； 仓库归属校验由调用方 isPathInRoot 负责，此处为纵深防御） |
| `RenameFile()` | `go/fileops/fileops:119` | RenameFile 重命名文件（校验非法字符；ysm.json 为模型目录清单，禁止改名） |
| `MoveModelFile()` | `go/fileops/fileops:151` | MoveModelFile 移动 src 到 dstDir（保留原名） root 用于路径安全校验（空则跳过校验，对齐 CopyModelFile 语义）； ADR-038 D3： |
| `CopyModelFile()` | `go/fileops/fileops:265` | CopyModelFile 复制 src 到 dstDir（root 用于路径安全校验，空则跳过校验） ADR-038 D3：支持目录递归复制（含 .ban 状态文件）；src 为 |
| `DeleteModelFile()` | `go/fileops/fileops:362` | DeleteModelFile 删除模型（目录感知，ADR-038 D3.6）： src 为 ysm.json 时删除整个模型目录（整组语义——包内 geometry/animat |
| `WriteModelFolder()` | `go/fileops/folder_import:21` | WriteModelFolder 写入文件夹整组到仓库（YSM 解压目录或普通模型文件夹）。 |

## Go·文件系统

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `StripBOM()` | `go/fsutil/bom:12` | StripBOM 移除 data 前缀的 UTF-8 BOM；无 BOM 时原样返回（bytes.TrimPrefix 语义）。 |
| `StepError.Error()` | `go/fsutil/copy:48` | — |
| `StepError.Unwrap()` | `go/fsutil/copy:49` | — |
| `CopyFile()` | `go/fsutil/copy:64` | CopyFile 原子复制单文件：先写同目录临时文件再 rename 落地，崩溃/失败不留半截目标。 |
| `CopyDirRecursive()` | `go/fsutil/copy:149` | CopyDirRecursive 递归复制目录树到 dst（保留相对路径）。 |
| `StepError()` | `go/fsutil/copy:43` | StepError 带步骤标注的复制错误。 |
| `CopyDirOptions()` | `go/fsutil/copy:124` | CopyDirOptions 目录递归复制选项（各调用方按自身语义传参） |
| `IsCrossDeviceErr()` | `go/fsutil/crossdevice_other:14` | IsCrossDeviceErr 判断 rename/链接失败是否为跨设备（EXDEV）。 |
| `IsCrossDeviceErr()` | `go/fsutil/crossdevice_windows:18` | IsCrossDeviceErr 判断 rename/链接失败是否为跨设备（EXDEV）。 |
| `FormatSize()` | `go/fsutil/format:7` | FormatSize 人性化字节大小（B/KB/MB/GB 分级）。 |
| `IsHardLink()` | `go/fsutil/hardlink_other:15` | IsHardLink 判断路径是否为硬链接（nlink &gt; 1）。 |
| `IsHardLink()` | `go/fsutil/hardlink_windows:14` | IsHardLink 判断路径是否为硬链接（NumberOfLinks &gt; 1）。 |
| `ContainsIllegalNameChar()` | `go/fsutil/perms:19` | ContainsIllegalNameChar 检测文件名是否含非法字符。 |
| `WalkAllFiles()` | `go/fsutil/walk:13` | WalkAllFiles 递归遍历目录返回所有文件的完整路径（不限制扩展名） skipRecycle 为 true 时跳过 .recycle 子目录 |
| `WalkAllDirs()` | `go/fsutil/walk:38` | WalkAllDirs 递归遍历目录，返回所有子目录路径（深度优先后序：子目录在前，父目录在后） 不包含根目录本身。后序便于删除类操作（先删深目录，父目录变空后可被继续删除）。 |
| `CountFiles()` | `go/fsutil/walk:72` | CountFiles 统计目录中的文件数（不限制扩展名） 流式计数：不构造完整 []string，避免大目录下为取 len 白白物化整棵文件树 （遍历语义与 WalkAllFile |
| `CleanEmptyDirs()` | `go/fsutil/walk:96` | CleanEmptyDirs 递归删除空子目录，返回删除数 |
| `IsRecycleDir()` | `go/fsutil/walk:112` | IsRecycleDir 判断路径是否指向 .recycle 回收站目录（大小写不敏感，ADR-044 策略 A 统一口径）—— dedup / scanner / sync 的回 |
| `IsResourcePackFolder()` | `go/fsutil/walk:120` | IsResourcePackFolder 检查目录是否为资源包文件夹（内含 pack.mcmeta）。 |
| `ReadLimitedEntry()` | `go/fsutil/write:59` | ReadLimitedEntry 读取 zip/7z 单条目：limit+1 探测截断（ADR-033 修复，ADR-044 策略 A 统一口径）—— 原 `io.ReadAll( |
| `WriteFileAtomic()` | `go/fsutil/write:79` | WriteFileAtomic 临时文件 + rename 原子落地目标文件。 |
| `SHA256File()` | `go/fsutil/write:121` | SHA256File 计算文件内容的 SHA256 哈希，返回十六进制字符串。 |

## Go·几何

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `IsArmModelName()` | `go/geometry/archive:37` | IsArmModelName 判断模型文件是否为第一人称手持视角的独立手臂几何 （arm.json / arm.geo.json）。 |
| `ExtractFirstPNGFromZip()` | `go/geometry/archive:80` | ExtractFirstPNGFromZip 从 ZIP 中提取第一张 PNG 图片（用于快速预览） |
| `ExtractFirstPNGFrom7z()` | `go/geometry/archive:90` | ExtractFirstPNGFrom7z 从 7z 中提取第一张 PNG 图片（用于快速预览） |
| `ParseFromZip()` | `go/geometry/archive:1306` | ParseFromZip 从 ZIP 字节中解析 Bedrock Geometry 并提取纹理和动画。 |
| `ParseFrom7z()` | `go/geometry/archive:1312` | ParseFrom7z 从 7z 字节中解析 Bedrock Geometry 并提取纹理。 |
| `ParseFromZipEntry()` | `go/geometry/archive:1325` | ParseFromZipEntry 按 subPath（zip 内路径，L0 SubModel.SourcePath 口径）解析单个 geometry 文件。 |
| `ParseFrom7zEntry()` | `go/geometry/archive:1330` | ParseFrom7zEntry 对应 ParseFromZipEntry 的 7z 版本；subPath 匹配策略完全一致。 |
| `IsMainModelName()` | `go/geometry/archive:1396` | IsMainModelName 判断模型文件是否为主组件（main.json / main.geo.json）。 |
| `ParseComponentsFromZip()` | `go/geometry/archive:1408` | ParseComponentsFromZip 多组件解析（YSMViewer 式）：zip 内每个模型文件独立组件， 含 arm/载具等组件（不合并、不排除）；main 优先排序， |
| `ParseComponentsFrom7z()` | `go/geometry/archive:1619` | ParseComponentsFrom7z 多组件解析（7z 版）：与 ParseComponentsFromZip 同构， 复用 parseComponentsFromArchi |
| `ParseBedrockGeometry()` | `go/geometry/parse:238` | ParseBedrockGeometry 解析 Bedrock geometry JSON。 |

## Go·导入

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ImportFromBase64()` | `go/importer/importer_file:39` | ImportFromBase64 从 base64 导入模型文件（校验 + 类型检测 + 写文件） rootFn 按资源类型返回仓库根目录（薄壳注入 a.GetRepoRoot） |
| `WriteFileAtomic()` | `go/importer/importer_file:135` | WriteFileAtomic 已提升至 go/fsutil（ADR-044 策略 A：基础设施工具收敛，tags/logs/fileops 共用）。 |
| `DetectZipType()` | `go/importer/importer_file:149` | DetectZipType 扫描容器条目名识别资源类型 #5 收敛：收集全部条目名后委托 types.DetectByEntries 做 (priority desc, id as |
| `ImportOptions()` | `go/importer/importer_file:29` | ImportOptions 导入选项 |
| `ImportLogger()` | `go/importer/importer_file:35` | ImportLogger 导入日志回调（薄壳注入 App.logger.Add） |
| `Register()` | `go/importer/importer:34` | Register 注册导入策略（线程安全） |
| `Get()` | `go/importer/importer:41` | Get 获取指定类型的导入策略（线程安全） |
| `NewSimpleCopy()` | `go/importer/importer:72` | NewSimpleCopy 创建简单文件复制导入器 |
| `SimpleCopyImporter.Type()` | `go/importer/importer:76` | — |
| `SimpleCopyImporter.Import()` | `go/importer/importer:78` | — |
| `NewDirectoryCopy()` | `go/importer/importer:187` | NewDirectoryCopy 创建文件夹复制导入器 |
| `DirectoryCopyImporter.Type()` | `go/importer/importer:191` | — |
| `DirectoryCopyImporter.Import()` | `go/importer/importer:196` | Import 复制源文件夹到目标目录 srcPath 可以是文件夹内任意文件路径，也可以是文件夹本身 若 srcPath 是文件则取父目录，若是目录则直接使用 |
| `Handler()` | `go/importer/importer:21` | Handler 资源导入策略接口 |
| `SimpleCopyImporter()` | `go/importer/importer:67` | — |
| `DirectoryCopyImporter()` | `go/importer/importer:182` | — |

## Go·安装

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Install()` | `go/installer/installer:44` | Install 安装模型到目标目录（支持链接模式） |
| `InstallLocked()` | `go/installer/installer:127` | InstallLocked 安装模型到目标目录（调用方须已持有 InstallLock，禁止直接调用）。 |
| `InstallDir()` | `go/installer/installer:168` | InstallDir 安装整个目录下的所有文件到目标目录。 |
| `InstallDirRel()` | `go/installer/installer:178` | InstallDirRel 安装目录到 dstRoot/&lt;relSlash&gt;（保留仓库多层物理路径）。 |
| `InstallDirLocked()` | `go/installer/installer:185` | InstallDirLocked 与 InstallDir 语义相同，但不重复加锁——供已持锁调用方使用。 |
| `InstallToGlobal()` | `go/installer/installer:468` | InstallToGlobal 安装到全局 custom 目录 |
| `InstallWithOverlay()` | `go/installer/installer:494` | InstallWithOverlay 带冲突检查的安装 |
| `CopyFile()` | `go/installer/installer:578` | CopyFile 复制文件到目标目录（带互斥锁） |
| `CopyFileLocked()` | `go/installer/installer:586` | CopyFileLocked 复制文件到目标目录（调用方须已持有 InstallLock，禁止直接调用）。 |
| `IsValidRepoRoot()` | `go/installer/installer:736` | IsValidRepoRoot 禁止选择系统敏感目录作为仓库 跨平台实现：禁止根目录、系统关键目录 |

## go/instance

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `RegisterInvalidationHook()` | `go/instance/instance:44` | RegisterInvalidationHook 把同步结果缓存挂到 scanner 失效钩子上。 |
| `InvalidateSyncItemsCache()` | `go/instance/instance:52` | InvalidateSyncItemsCache 清空全部整合包同步结果缓存。 |
| `BuildSyncItems()` | `go/instance/instance:320` | BuildSyncItems 组装整合包内各资源类型的同步状态项（纯逻辑，root 由调用方注入） subtype 指定子类型目录名（如 EntityPlayer/SceneMod |
| `ResourceTypeInfo()` | `go/instance/instance:21` | ResourceTypeInfo 资源类型注册表条目（BuildSyncItems 需要的字段） |

## go/internal

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `CreateTestFile()` | `go/internal/testutil/testutil:14` | CreateTestFile 在 dir 下创建 name 文件（自动建父目录），返回完整路径。 |
| `MakeZipBytes()` | `go/internal/testutil/testutil:28` | MakeZipBytes 构造内存 ZIP（entries: 条目名→内容），返回字节。 |
| `WriteZipFile()` | `go/internal/testutil/testutil:48` | WriteZipFile 构造 ZIP 并写入 t.TempDir()/name，返回文件路径。 |

## Go·Litematic

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `MapColor()` | `go/litematic/block_colors:10` | MapColor 返回 minecraft 方块名对应的近似十六进制颜色。 |
| `ResolveBlockName()` | `go/litematic/block_ids:12` | ResolveBlockName 把旧版数字 ID（schematic v1）解析为注册名。 |
| `ResolveBlockZH()` | `go/litematic/block_ids:26` | ResolveBlockZH 把注册名映射为中文名（自动去除 minecraft: 前缀）。 |
| `ParseMeta()` | `go/litematic/parser:30` | ParseMeta 解析 litematic 格式（Litematic/Minihud 保存的投影）元数据。 |
| `ParseSchematicSummary()` | `go/litematic/schematic:10` | ParseSchematicSummary 解析 WorldEdit schematic（.schem）摘要。 |
| `ParseNbtStructure()` | `go/litematic/structure:6` | ParseNbtStructure 解析 Java 版 structure NBT（.nbt 结构方块保存）摘要。 |
| `BuildVoxelData()` | `go/litematic/voxel:92` | BuildVoxelData 构建体素渲染数据（按颜色分组） |
| `BuildNbtVoxelData()` | `go/litematic/voxel:274` | — |
| `BuildSchematicVoxelData()` | `go/litematic/voxel:492` | — |

## Go·日志

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewLogger()` | `go/logs/logs:78` | NewLogger 创建日志管理器 configDir 为应用配置根目录（含 "YSM-Model-Manager" 子目录）—— 由调用方（internal/app）注入，与 c |
| `Logger.Add()` | `go/logs/logs:193` | Add 添加一条导入日志（兼容旧调用） |
| `Logger.AddOp()` | `go/logs/logs:198` | AddOp 添加一条指定操作类型的日志 |
| `Logger.Flush()` | `go/logs/logs:259` | Flush 立即落盘（取消防抖窗口）：批量写入后调用方需要立即可重启加载（测试）或 退出前确保审计完整时使用。内存态 no-op。同步语义不变——返回即已落盘， 仅磁盘 IO 移出 |
| `Logger.GetAll()` | `go/logs/logs:270` | GetAll 获取所有日志 |
| `Logger.Clear()` | `go/logs/logs:279` | Clear 清空日志（同步落盘语义不变：返回即磁盘已为空，防快速退出后旧日志复活） |
| `Logger()` | `go/logs/logs:56` | Logger 导入日志管理器 |
| `NewRuntimeBuffer()` | `go/logs/runtime:22` | NewRuntimeBuffer 创建环形缓冲 |
| `RuntimeBuffer.Write()` | `go/logs/runtime:30` | Write 实现 io.Writer：每次调用记录一条运行时日志（标准库 log 一行即一次 Write） |
| `RuntimeBuffer.GetAll()` | `go/logs/runtime:51` | GetAll 返回全部日志的副本 |
| `RuntimeBuffer.Clear()` | `go/logs/runtime:60` | Clear 清空缓冲 |
| `RuntimeBuffer()` | `go/logs/runtime:15` | RuntimeBuffer 运行时日志环形缓冲：捕获标准库 log 输出（watcher/sync 等），供诊断页展示。 |

## Go·包管理

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ReadPackMeta()` | `go/packs/mcmeta:34` | ReadPackMeta 从资源包文件（.zip 或目录）中读取 pack.mcmeta，返回名称和 base64 缩略图 |
| `DetectResourceType()` | `go/packs/mcmeta:139` | DetectResourceType 薄壳委托 types.ClassifyResource（#5 收敛：三套编排统一于 types 包， packs 不再持有独立分类逻辑）。签名 |
| `ReadShaderpackLang()` | `go/packs/mcmeta:161` | ReadShaderpackLang 从光影包 ZIP 中读取 lang/en_US.lang，尝试提取显示名 返回 {name, entries}，name 为空时前端用文件名兜 |

## Go·路径

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ErrPathEscalation.Error()` | `go/paths/safe:40` | — |
| `ErrPathEscalation.Unwrap()` | `go/paths/safe:46` | Unwrap 暴露分类哨兵：errors.Is(err, ErrNotInside) 等可直接判断， 无需文本匹配错误文案。 |
| `IsInside()` | `go/paths/safe:51` | IsInside 检查 path 是否在 baseDir 下，防止路径遍历。 |
| `IsInsideResolved()` | `go/paths/safe:116` | IsInsideResolved 解析符号链接后再判定 path 是否在 baseDir 下（BUG-1 修复）。 |
| `HasTraversal()` | `go/paths/safe:137` | HasTraversal 检查路径片段是否包含 ".." 遍历组件（统一入口）。 |
| `ContainsMinecraftMarker()` | `go/paths/safe:159` | ContainsMinecraftMarker 检查路径中是否包含 .minecraft 或 minecraft 标记 PrismLauncher 实例目录下可能是 minecra |
| `ErrPathEscalation()` | `go/paths/safe:32` | ErrPathEscalation 路径越权错误 |

## Go·回收站

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `RemoveRepoDuplicates()` | `go/recycle/recycle_clean:25` | RemoveRepoDuplicates 清理整合包子目录中仓库已有的文件： 在 recycleRoot 内的移入回收站（可恢复），否则直接删除（仓库侧无损可重推）。 |
| `DeduplicateEntries()` | `go/recycle/recycle_clean:117` | DeduplicateEntries 按 SHA256 哈希分组去重：每组显式按路径排序保留第一个，其余移入回收站 |
| `CleanOpLogger()` | `go/recycle/recycle_clean:19` | CleanOpLogger 清理操作日志回调（薄壳注入 App.logger.Add） |
| `New()` | `go/recycle/recycle:34` | New 创建回收站管理器，root 是资源根目录，回收站为 root/.recycle |
| `TrashManager.RecycleDir()` | `go/recycle/recycle:44` | RecycleDir 返回回收站目录路径 |
| `TrashManager.Move()` | `go/recycle/recycle:49` | Move 移动文件到回收站 |
| `TrashManager.MoveEx()` | `go/recycle/recycle:55` | MoveEx 移动文件到回收站，返回操作详情 |
| `TrashManager.List()` | `go/recycle/recycle:185` | List 列出回收站中的文件。 |
| `TrashManager.Restore()` | `go/recycle/recycle:245` | Restore 从回收站恢复到原目录 |
| `TrashManager.Delete()` | `go/recycle/recycle:334` | Delete 永久删除回收站中的文件 ADR-038 D3.4：整组合并条目 Path 指向目录，os.Remove 无法删非空目录 → 目录用 RemoveAll |
| `TrashManager.Empty()` | `go/recycle/recycle:354` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `Move()` | `go/recycle/recycle:49` | Move 移动文件到回收站 |
| `MoveEx()` | `go/recycle/recycle:55` | MoveEx 移动文件到回收站，返回操作详情 |
| `List()` | `go/recycle/recycle:185` | List 列出回收站中的文件。 |
| `Restore()` | `go/recycle/recycle:245` | Restore 从回收站恢复到原目录 |
| `Delete()` | `go/recycle/recycle:334` | Delete 永久删除回收站中的文件 ADR-038 D3.4：整组合并条目 Path 指向目录，os.Remove 无法删非空目录 → 目录用 RemoveAll |
| `Empty()` | `go/recycle/recycle:354` | Empty 清空回收站 采用 RemoveAll 删除整个 .recycle 目录后重建，确保所有子目录和文件均被清理 |
| `MoveResult()` | `go/recycle/recycle:17` | MoveResult 回收操作结果 |
| `TrashManager()` | `go/recycle/recycle:23` | TrashManager 可配置的回收站管理器 |

## go/repoaudit

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Audit()` | `go/repoaudit/repoaudit:124` | Audit 仓库健康审计核心：资源扫描 + 完整性 + 缓存 + 健康分数 + 警告，一次遍历。 |
| `HealthReportFor()` | `go/repoaudit/repoaudit:250` | HealthReportFor 完整体检（审计 + 去重），GUI 绑定与 CLI health-report 同一载荷 |
| `Classify()` | `go/repoaudit/repoaudit:363` | Classify 将扩展名映射到注册表资源类型 id（如 "ysm"/"fbx"/"blueprint"）。 |
| `Result()` | `go/repoaudit/repoaudit:64` | Result 仓库审计结果（结构对齐原 go/cli repoAuditResult） |
| `Completeness()` | `go/repoaudit/repoaudit:75` | Completeness 完整性统计 |
| `CacheStatus()` | `go/repoaudit/repoaudit:83` | CacheStatus 缓存状态 |
| `ResourceSummary()` | `go/repoaudit/repoaudit:93` | ResourceSummary 资源统计 |
| `DedupSummary()` | `go/repoaudit/repoaudit:102` | DedupSummary 去重维度汇总（HealthReport 追加） |
| `HealthReport()` | `go/repoaudit/repoaudit:109` | HealthReport 完整体检：审计 + 去重（GUI 与 CLI health-report 同一载荷） |

## go/rustbridge

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Scan()` | `go/rustbridge/bridge_android:43` | — |
| `ScanManifest()` | `go/rustbridge/bridge_android:73` | — |
| `Scan()` | `go/rustbridge/bridge_darwin:41` | — |
| `ScanManifest()` | `go/rustbridge/bridge_darwin:69` | — |
| `Scan()` | `go/rustbridge/bridge_linux:41` | — |
| `ScanManifest()` | `go/rustbridge/bridge_linux:69` | — |
| `Scan()` | `go/rustbridge/bridge_windows:24` | — |
| `ScanManifest()` | `go/rustbridge/bridge_windows:59` | ScanManifest 使用 Go 预枚举的文件清单调用 Rust，跳过 Rust 侧的文件系统发现（jwalk）。 |
| `ScanError()` | `go/rustbridge/types:7` | — |
| `ScanResponse()` | `go/rustbridge/types:12` | — |

## go/scanner

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SetErrorSink()` | `go/scanner/scanner:93` | SetErrorSink 注入扫描错误回调（薄壳 internal/app 启动时调用，如 AddOpLog 包装） |
| `EffectiveCacheTTL()` | `go/scanner/scanner:135` | EffectiveCacheTTL 导出当前生效的扫描缓存 TTL，供派生缓存（go/instance 同步结果、 go/sync 扫描缓存）写缓存时取同一刷新周期——30s 刷新 |
| `OnCacheInvalidated()` | `go/scanner/scanner:160` | OnCacheInvalidated 注册一个扫描缓存失效回调。回调会在 InvalidateCache 或 InvalidatePath 完成清理后同步调用，适合清理依赖 sca |
| `InvalidateCache()` | `go/scanner/scanner:179` | InvalidateCache 清空全部扫描缓存（下载/导入/同步后调用） |
| `InvalidatePath()` | `go/scanner/scanner:195` | InvalidatePath 删除指定目录的扫描缓存（启用/禁用 .ban 后调用） |
| `ScanEntries()` | `go/scanner/scanner:227` | ScanEntries 扫描目录下的模型文件（含 .recycle 排除、扩展名过滤、SHA256 哈希、30s TTL 缓存） |
| `ScanEntriesWithHit()` | `go/scanner/scanner:234` | ScanEntriesWithHit 同 ScanEntries，但额外返回是否命中 30s 缓存。 |
| `ComputeFileHash()` | `go/scanner/scanner:473` | ComputeFileHash 计算文件的 SHA256 哈希（用于同步系统文件匹配） |
| `ScanEntriesLite()` | `go/scanner/scanner:496` | ScanEntriesLite 轻量目录遍历（作者提取专用）：与 ScanEntries 同一套过滤口径 （recycle/.github/禁用后缀目录跳过、扩展名白名单、.jso |
| `ListModelAuthors()` | `go/scanner/scanner:539` | ListModelAuthors 从扫描条目提取 [作者] 前缀统计（按出现次数降序） |
| `ScanLocalAuthors()` | `go/scanner/scanner:569` | ScanLocalAuthors 扫描各资源类型根目录，从文件名提取 [作者]（roots: rtype→root） |
| `GenerateRepoIndex()` | `go/scanner/scanner:651` | GenerateRepoIndex 扫描仓库目录，生成 index.json（供 GitHub Actions/Linux 消费，正斜杠路径） |

## Go·同步

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `DetectConflicts()` | `go/sync/conflict:69` | DetectConflicts 检测本地和远端之间的冲突 基于文件哈希比较：两端都存在且哈希不同 → 内容冲突 localDir: 本地目录路径（整合包） remoteDir: 远 |
| `ResolveConflict()` | `go/sync/conflict:131` | ResolveConflict 解决单个文件冲突 先备份再操作，确保安全 |
| `ResolveConflicts()` | `go/sync/conflict:167` | ResolveConflicts 批量解决冲突 |
| `ConflictType()` | `go/sync/conflict:13` | ConflictType 冲突类型 |
| `ResolutionStrategy()` | `go/sync/conflict:23` | ResolutionStrategy 冲突解决策略 |
| `FileConflict()` | `go/sync/conflict:35` | FileConflict 文件冲突详情 |
| `ConflictReport()` | `go/sync/conflict:57` | ConflictReport 冲突报告 |
| `RegisterInvalidationHook()` | `go/sync/sync_cache:30` | RegisterInvalidationHook 把同步扫描缓存挂到 scanner 失效钩子上。 |
| `InvalidateSyncScanCaches()` | `go/sync/sync_cache:61` | InvalidateSyncScanCaches 清空全部同步目录扫描结果缓存。 |
| `ResourceDiff()` | `go/sync/sync_diff:31` | ResourceDiff 按调用方提供的 key（文件名或相对路径，ADR-064 阶段二统一为 relKey 相对路径）对比两侧条目：   - 同名同大小（或含目录条目）→ Sy |
| `DiffEntry()` | `go/sync/sync_diff:17` | DiffEntry 一侧目录的同步条目（文件或资源包文件夹）。 |
| `SyncResourcesDirLevel()` | `go/sync/sync_dirlevel:375` | SyncResourcesDirLevel 文件夹级同步（默认 filepath.Walk，行为不变，供测试/旧调用方使用）。 |
| `SyncResourcesDirLevelScan()` | `go/sync/sync_dirlevel:384` | SyncResourcesDirLevelScan 同 SyncResourcesDirLevel，但注入 scanFn 复用扫描缓存， 消除 8 个 MMD 子类型 ×(1+N |
| `DiffFolderContents()` | `go/sync/sync_dirlevel:608` | DiffFolderContents 对同名文件夹进行内容级 diff 扫描两侧文件夹内的模型文件，比较差异，返回子文件级别的同步状态 用于在文件夹级同步单元内恢复单文件粒度的同步 |
| `DiffFolderContentsScan()` | `go/sync/sync_dirlevel:664` | DiffFolderContentsScan 同 DiffFolderContents，但全局侧文件收集复用 scanner 已缓存的 组根扫描结果（scanFn(globalRo |
| `ScanEntriesFn()` | `go/sync/sync_dirlevel:372` | SyncResourcesDirLevel 按文件夹名对比资源（用于 YSM 的 ysm.json 文件夹和 MMD 的 .pmx/.pmd 文件夹） 以文件夹名为单位，一个文件夹 |
| `FileDiffEntry()` | `go/sync/sync_dirlevel:582` | FileDiffEntry 文件级差异条目（用于文件夹内容级 diff） |
| `ListVersions()` | `go/sync/sync_discovery:15` | — |
| `HasDotMinecraftSubdirs()` | `go/sync/sync_discovery:30` | HasDotMinecraftSubdirs 检测目录的子目录中是否包含 .minecraft/ 或 minecraft/（用于识别 instances 目录） |
| `FindMinecraftDir()` | `go/sync/sync_discovery:47` | FindMinecraftDir 在给定目录下查找 .minecraft 或 minecraft 子目录，返回找到的路径 |
| `ListVersionsFunc()` | `go/sync/sync_discovery:13` | ListVersionsFunc 列出版本实例（函数类型，测试时可注入 mock） |
| `CompareGlobalInstanceHashes()` | `go/sync/sync_hash:29` | CompareGlobalInstanceHashes 对比全局目录和整合包实例子目录，返回每个实例的 Missing / Extra / Synced 状态。 |
| `HasModInDirFn()` | `go/sync/sync_hash:19` | HasModInDirFn 判断 mods 目录是否含有指定类型 mod 的函数类型。 |
| `PushResources()` | `go/sync/sync_push:28` | PushResources 推送缺失资源到整合包（folder 级类型用 SyncResourcesDirLevel） 多层物理路径支持： 对于 dirLevelSync 类型，会 |
| `PullResources()` | `go/sync/sync_push:93` | PullResources 拉取整合包多余资源回仓库 持 InstallLock：从实例目录复制文件回仓库，与 SyncToggleStatus/RelinkDir 等并发操作同一 |
| `PullSingleResource()` | `go/sync/sync_push:194` | PullSingleResource 拉取单个资源（文件夹/文件）回仓库 持 InstallLock：从实例目录复制文件回仓库，与并发同步操作互斥（ADR-056） |
| `PushSingleResource()` | `go/sync/sync_push:233` | PushSingleResource 推送单个资源到整合包： 文件夹 / .json/.pmx/.pmd（文件夹级类型）走 InstallDir，其余 Install。 |
| `SyncCustomToRepo()` | `go/sync/sync_push:254` | SyncCustomToRepo 同步整合包自定义目录的模型到仓库（哈希/名称去重） |
| `Logger()` | `go/sync/sync_push:19` | Logger 导入日志回调（薄壳注入 App.logger.Add） |
| `RelinkDir()` | `go/sync/sync_relink:18` | RelinkDir 按哈希比对重链接实例目录与仓库（原子替换，失败回滚） |
| `GetInstanceStatus()` | `go/sync/sync:28` | GetInstanceStatus 获取整合包状态（使用真实 ListVersions） rtype: 资源类型 ID（如 "ysm"），用于解析特定子目录；为空时使用 ins.C |
| `GetInstanceStatusWith()` | `go/sync/sync:34` | GetInstanceStatusWith 可注入的整合包状态获取（测试用） rtype: 资源类型 ID（如 "ysm"），用于解析特定子目录；为空时使用 ins.CustomD |
| `SyncToggleStatus()` | `go/sync/sync:195` | SyncToggleStatus 同步启用/禁用状态 |
| `SyncResources()` | `go/sync/sync:364` | — |
| `SyncResourcesWithConfig()` | `go/sync/sync:369` | SyncResourcesWithConfig 同步资源，支持配置化（含冲突检测） |
| `SortEntries()` | `go/sync/sync:455` | SortEntries 按名称排序模型条目 |
| `GetLinkType()` | `go/sync/sync:462` | GetLinkType 判断文件的链接类型 |
| `ScanFunc()` | `go/sync/sync:24` | ScanFunc 扫描模型（函数类型，由 app.go 注入） |

## Go·标签

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `NewStore()` | `go/tags/tags:26` | NewStore 创建标签存储（懒加载：首次 Get/Set 时自动读取） |
| `Store.GetTags()` | `go/tags/tags:107` | GetTags 返回指定路径的所有标签（已排序） |
| `Store.SetTags()` | `go/tags/tags:135` | SetTags 设置指定路径的标签列表（覆盖写入） |
| `Store.AddTag()` | `go/tags/tags:170` | AddTag 追加单个标签（不会重复） |
| `Store.RemoveTag()` | `go/tags/tags:196` | RemoveTag 移除单个标签 |
| `Store.ListByTag()` | `go/tags/tags:228` | ListByTag 返回所有打了指定标签的文件路径列表 |
| `Store.AllTags()` | `go/tags/tags:252` | AllTags 返回所有被使用的标签（按使用次数降序） |
| `Store()` | `go/tags/tags:19` | Store 是标签存储，线程安全 |

## go/texture_cache

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `TextureHash()` | `go/texture_cache/texture_cache:39` | TextureHash 计算文件内容的 SHA256 哈希，用作缓存 key。 |
| `CachePath()` | `go/texture_cache/texture_cache:48` | CachePath 返回给定哈希对应的缓存文件路径。 |
| `ReadCached()` | `go/texture_cache/texture_cache:58` | ReadCached 读取缓存中的 KTX2 数据。 |
| `WriteCached()` | `go/texture_cache/texture_cache:78` | WriteCached 写入 KTX2 数据到缓存。 |
| `HasCached()` | `go/texture_cache/texture_cache:96` | HasCached 检查缓存中是否存在指定哈希的 KTX2 文件。 |
| `ClearCache()` | `go/texture_cache/texture_cache:112` | ClearCache 清空纹理缓存目录（用于测试或用户主动清理）。 |
| `ListCacheFiles()` | `go/texture_cache/texture_cache:144` | ListCacheFiles 列出所有缓存文件 |
| `GetCacheStats()` | `go/texture_cache/texture_cache:190` | GetCacheStats 获取缓存统计 |
| `SetCacheLimits()` | `go/texture_cache/texture_cache:240` | SetCacheLimits 覆盖淘汰阈值（测试/配置注入用）。 |
| `Prune()` | `go/texture_cache/texture_cache:258` | Prune 淘汰纹理缓存：先清超龄（TTL），再按容量从最旧删到上限内。 |
| `CacheEntry()` | `go/texture_cache/texture_cache:137` | CacheEntry 缓存条目信息 |
| `CacheStats()` | `go/texture_cache/texture_cache:183` | CacheStats 缓存统计信息 |
| `PruneResult()` | `go/texture_cache/texture_cache:249` | PruneResult 一次淘汰的结果（供日志与测试断言） |

## Go·Three.js

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `Build()` | `go/threejs/spec:68` | Build 接收已解析的 BedrockModel，生成 Three.js 可直接消费的 JSON spec |
| `BuildMulti()` | `go/threejs/spec:87` | BuildMulti 多组件 spec：每个组件独立构建为 spec.models 元素（YSMViewer 式多组件同屏）。 |
| `Model3DSpec()` | `go/threejs/spec:20` | — |
| `ModelGroup()` | `go/threejs/spec:24` | — |
| `BoneData()` | `go/threejs/spec:35` | — |
| `MeshData()` | `go/threejs/spec:45` | — |

## Go·类型

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `BedrockModel()` | `go/types/bedrock:4` | BedrockModel 基岩版模型几何体摘要（用于 2D 预览） |
| `FileInventory()` | `go/types/bedrock:33` | FileInventory zip 内文件归属清单（对齐 Modern YSM parseGlobalResources 的分流思想， 但只识别归属、不解析内容——不造双路径，前端 |
| `SubModel()` | `go/types/bedrock:44` | SubModel 子模型条目（多角色加载）。 |
| `Bone2D()` | `go/types/bedrock:51` | Bone2D 骨骼简化信息（只用于 2D 线条图） |
| `Cube2D()` | `go/types/bedrock:61` | Cube2D 立方体信息 |
| `YsmMetadata()` | `go/types/bedrock:79` | YsmMetadata ysm.json 的 metadata 段（模型详情：名称/许可/作者/链接）。 |
| `YsmLicense()` | `go/types/bedrock:88` | YsmLicense 许可信息（wine_fox：{"type": "CC BY-NC-SA 4.0"}） |
| `YsmAuthor()` | `go/types/bedrock:94` | YsmAuthor 作者条目 |
| `ClassifyResource()` | `go/types/classify:38` | ClassifyResource 规范资源类型识别器（单一事实源）。 |
| `ClassifyExt()` | `go/types/classify:64` | ClassifyExt 扩展名兜底判定：仅单一声明者直判，多/零声明者返回 "other"。 |
| `ExtBelongsToBy()` | `go/types/classify:73` | ExtBelongsToBy 返回扩展名在指定注册表中的声明者 ID 列表（ExtBelongsTo 的可注入版本）。 |
| `DetectByEntries()` | `go/types/classify:91` | DetectByEntries 条目名列表指纹裁决（importer 字节流路径专用，不开文件）： 对每个有指纹能力的类型做匹配，(priority desc, id asc) 裁 |
| `IsYsmFile()` | `go/types/classify:278` | IsYsmFile YSM 模型判定：.ysm 直判；.json 仅 ysm.json 入口清单； .zip/.7z 统一开容器走段后缀指纹（ADR-082 续：坏容器 false |
| `MatchZipArchive()` | `go/types/classify:293` | MatchZipArchive 打开容器并按 rt.ZipEntries 内容指纹匹配（packs.matchZipArchive 收敛版）。 |
| `CountZipEntryMatches()` | `go/types/classify:298` | CountZipEntryMatches 对已打开条目统计匹配数（去重：同一文件被多条规则命中只计一次）。 |
| `MatchYsmEntries()` | `go/types/classify:312` | MatchYsmEntries 对已打开条目做 ysm 段后缀指纹判定（ysm.json/models/ 任意层级）。 |
| `ParseDedupConfig()` | `go/types/config:105` | ParseDedupConfig 解析去重配置 JSON 字符串（绑定层 configStr 的统一入口）。 |
| `AppConfig()` | `go/types/config:10` | AppConfig 应用持久化配置 独立路径下沉为 CustomRoots map（ADR-095）：以资源类型 id 为 key（如 "ysm"→"D:/.../ysm"）， 取 |
| `PackInfo()` | `go/types/config:50` | PackInfo 模型整合包信息（ysm-pack.json） |
| `WorkshopPresetSearch()` | `go/types/config:57` | WorkshopPresetSearch 预设搜索词 |
| `WorkshopSite()` | `go/types/config:63` | WorkshopSite 创意工坊站点配置 |
| `WorkshopCreator()` | `go/types/config:76` | WorkshopCreator 创作者条目 Type 是平台标签，分号分隔，如 "bilibili;afdian" |
| `DedupConfig()` | `go/types/config:84` | DedupConfig 去重功能配置 |
| `SyncConfig()` | `go/types/config:94` | SyncConfig 同步功能配置 |
| `IsNestedModelDir()` | `go/types/extensions:22` | IsNestedModelDir 判断 rtype 是否有嵌套模型目录结构（ADR-095）： 模型入口文件在 assets/&lt;namespace&gt;/ 下（如 maid-model |
| `NestedPatternsFor()` | `go/types/extensions:31` | NestedPatternsFor 返回指定资源类型的嵌套模式配置列表（ADR-XXX）。 |
| `AllExts()` | `go/types/extensions:68` | AllExts 返回所有支持的扩展名（去重后）。 |
| `ContainerExts()` | `go/types/extensions:89` | ContainerExts 全局容器扩展名集合（.zip/.7z）。 |
| `IsContainerExt()` | `go/types/extensions:96` | IsContainerExt 判断扩展名是否是容器扩展名（大小写不敏感）。 |
| `IsSupportedExt()` | `go/types/extensions:141` | IsSupportedExt 检查扩展名是否被任何资源类型支持。 |
| `IsYsmEntryJSON()` | `go/types/extensions:149` | IsYsmEntryJSON 判断是否为 YSM 解压目录的唯一清单入口 ysm.json（大小写不敏感） ADR-038 D2：.json 仅放行 ysm.json；包内 geo |
| `StripDisableSuffix()` | `go/types/extensions:159` | StripDisableSuffix 剥离禁用后缀（大小写不敏感，依次尝试 .disabled/.ban）。 |
| `StripBanSuffix()` | `go/types/extensions:170` | StripBanSuffix 保留向后兼容——内部委托 StripDisableSuffix。 |
| `IsDisableSuffix()` | `go/types/extensions:175` | IsDisableSuffix 判断文件名是否带禁用后缀（.disabled/.ban，大小写不敏感）。 |
| `NormalizeResourceName()` | `go/types/extensions:188` | NormalizeResourceName 归一化资源文件名用于同步匹配（ADR-064 收敛）： 小写 + 去除 .disabled/.ban 禁用后缀。原 sync.isSyn |
| `IsResourceAllowed()` | `go/types/extensions:200` | IsResourceAllowed 判断文件名是否属于受支持的同步资源（ADR-064 收敛）： 扩展名命中注册表全扩展集（AllExts），.json 仅放行 ysm.json（ |
| `IsTypeModelFile()` | `go/types/extensions:219` | IsTypeModelFile 判断文件名是否为指定资源类型的模型文件（ADR-064 收敛）： 扩展名命中该类型注册表扩展集（SupportedExtsForType），.jso |
| `ShouldHashExt()` | `go/types/extensions:257` | ShouldHashExt 判断扩展名是否需要计算 SHA256 哈希（用于同步系统文件匹配）。 |
| `IsDirLevelSync()` | `go/types/extensions:264` | IsDirLevelSync 判断 rtype 是否为文件夹级资源同步类型 （sync.SyncResourcesDirLevel 按文件夹名对比；注册表 dirLevelSync |
| `IsScanInstance()` | `go/types/extensions:277` | IsScanInstance 判断 rtype 是否需要 instance 视图额外扫描整合包目录。 |
| `InstallExtsFor()` | `go/types/extensions:286` | InstallExtsFor 返回 rtype 的安装白名单扩展名（空=全部放行，仅可执行文件黑名单除外） installer.installDirRecursive 的 isAl |
| `MatchZipEntry()` | `go/types/extensions:297` | MatchZipEntry 按注册表 zipEntries 特征匹配 ZIP 条目名，返回命中的资源类型 ID。 |
| `ExtBelongsTo()` | `go/types/extensions:312` | ExtBelongsTo 返回扩展名所属的资源类型 ID 列表（可能多个）。 |
| `SupportedExtsForType()` | `go/types/extensions:331` | SupportedExtsForType 返回指定资源类型的所有扩展名。 |
| `SupportedExtsForSubtype()` | `go/types/extensions:344` | SupportedExtsForSubtype 返回指定资源类型的扩展名。 |
| `StorageSubDir()` | `go/types/extensions:350` | StorageSubDir 每种资源类型在 FilesRoot 下的存储子目录 从 resource_types.json 注册表读取，无匹配时返回 rtype 自身 |
| `GroupOf()` | `go/types/extensions:359` | GroupOf 返回资源类型所属分组 id（ADR-092） 从注册表 group 字段读取；无 group 字段时返回空串（表示单级平铺、不参与分组）。 |
| `GroupStorageRoot()` | `go/types/extensions:371` | GroupStorageRoot 返回资源类型在 FilesRoot 下的分组存储根目录（ADR-092 两层路由）：   - 有 group：FilesRoot/{group}/ |
| `GroupLabel()` | `go/types/extensions:388` | GroupLabel 返回分组显示名（从注册表各类型的 groupLabel 字段派生，消除 resourceGroups 冗余源）； 取该组第一个有 groupLabel 的类型 |
| `GroupIcon()` | `go/types/extensions:402` | GroupIcon 返回分组图标（从注册表各类型的 groupIcon 字段派生）。 |
| `SubDirMap()` | `go/types/extensions:427` | SubDirMap 返回指定资源类型在整合包实例版本目录中的实例子目录 |
| `SubDirAll()` | `go/types/extensions:443` | SubDirAll 返回所有资源类型在整合包实例中的版本子目录映射 |
| `AllSubDirs()` | `go/types/extensions:455` | AllSubDirs 返回所有资源类型的版本子目录信息（遍历用） |
| `SubDirEntry()` | `go/types/extensions:416` | SubDirEntry 资源类型的版本子目录信息 |
| `FindInstDir()` | `go/types/findinst:71` | FindInstDir 查找整合包中指定资源类型的子目录：  1. |
| `TypeByLocation()` | `go/types/location:17` | TypeByLocation 祖先目录归属判定（location 路由，MMD 子类型共享扩展名消歧）： path 的祖先目录命中某类型 storageSubDir/instanc |
| `SetBundledRegistryJSON()` | `go/types/resource:20` | SetBundledRegistryJSON 由根包 main 注入编译期内嵌的注册表字节（单源：仓库根 resource_types.json）。 |
| `ResourceType.EffectiveExtensions()` | `go/types/resource:101` | EffectiveExtensions 返回资源类型的有效扩展名集（小写化）。 |
| `ResourceType.MatchZipEntry()` | `go/types/resource:119` | MatchZipEntry 检测 ZIP 条目名是否命中本类型的特征条目（小写不敏感） ADR-082 S1：任意层级段后缀匹配——对路径按 / 分段，每个段后缀都参与指纹匹配， |
| `SetRegistryPath()` | `go/types/resource:154` | SetRegistryPath 设置注册表文件路径（仅测试用） 加锁保护：并发调用 LoadRegistry + SetRegistryPath 触发数据竞争（审计 P1 #2）。 |
| `LoadRegistry()` | `go/types/resource:165` | LoadRegistry 加载资源类型注册表（单一事实来源 = 编译期嵌入的 resource_types.json）。 |
| `BundledRegistryJSON()` | `go/types/resource:397` | BundledRegistryJSON 返回编译期内嵌的资源类型注册表原始 JSON 字节（单一事实来源）。 |
| `RegistryType()` | `go/types/resource:404` | RegistryType 按 id 查找资源类型，不存在时返回 nil 返回深拷贝：结构体按值拷贝仅能防标量字段篡改，Extensions 切片仍共享缓存 底层数组——调用方修改 |
| `ResourceTypeRegistry.FindByID()` | `go/types/resource:410` | FindByID 按 id 查找资源类型，不存在时返回 nil（深拷贝） |
| `ModKeywordsFor()` | `go/types/resource:429` | ModKeywordsFor 从注册表查询资源类型的 mod 文件名关键词（ADR-110）：   - 类型自身有 mod.jarKeywords → 返回   - 类型无声明但所 |
| `ModMetaFor()` | `go/types/resource:456` | ModMetaFor 从注册表查询内容检测型资源类型的 mod 信息（ADR-110）：   - 类型有 mod.modId → 返回 (modId, displayName) |
| `FormatRange.UnmarshalJSON()` | `go/types/resource:471` | UnmarshalJSON 实现 json.Unmarshaler，支持 int / [int] / [int,int] 三种格式 |
| `PackMeta.Desc()` | `go/types/resource:567` | Desc 返回 description 的可读文本（处理 string / JSON text component 对象 / 数组） |
| `ResourceTypeRegistry()` | `go/types/resource:25` | ResourceTypeRegistry 资源类型注册表 |
| `ResourceType()` | `go/types/resource:30` | ResourceType 一种受支持的资源类型定义 |
| `ModRequirement()` | `go/types/resource:63` | ModRequirement mod 依赖声明（ADR-110）：   - JarKeywords：文件名关键词匹配（如 "mmdskin" 匹配 mmdskin-1.0.jar） |
| `Variant()` | `go/types/resource:72` | Variant 格式变体声明（ADR-111：variants 解耦）： 同一资源类型内不同格式变体的预览器路由。 |
| `NestedPattern()` | `go/types/resource:93` | NestedPattern 嵌套模型模式配置（ADR-XXX）： 支持任意深度的嵌套路径检测，用于识别多层嵌套的模型结构。 |
| `ZipEntryMatch()` | `go/types/resource:110` | ZipEntryMatch ZIP 内容特征条目：检测 ZIP 内是否存在命中条目名 |
| `FormatRange()` | `go/types/resource:465` | FormatRange 资源包 supported_formats 范围（可为 int 或 [int,int]） |
| `PackMeta()` | `go/types/resource:556` | PackMeta 资源包信息（来自 pack.mcmeta） |
| `LitematicMeta()` | `go/types/resource:574` | LitematicMeta 投影文件元数据（对应 .litematic 中 Metadata compound） |
| `LitematicBlockStat()` | `go/types/resource:591` | LitematicBlockStat 方块类型统计 |
| `LitematicVoxelData()` | `go/types/resource:597` | LitematicVoxelData 体素渲染数据 |
| `VoxelGroup()` | `go/types/resource:605` | VoxelGroup 同一颜色的方块组 |
| `StatusToLevel()` | `go/types/types:130` | StatusToLevel 将 ImportLog 的 Status 字符串映射到日志级别。 |
| `AppError.WithCause()` | `go/types/types:178` | WithCause 附加底层错误，使 errors.Is/As 可以穿透 AppError 判定 errno/哨兵。 |
| `AppError.Unwrap()` | `go/types/types:184` | Unwrap 暴露底层错误链（ADR-051：配合 WithCause 恢复结构化错误判定能力） |
| `AppError.Error()` | `go/types/types:186` | — |
| `WindowState()` | `go/types/types:6` | WindowState 窗口位置 |
| `AuthorInfo()` | `go/types/types:14` | AuthorInfo 作者信息（含模型计数） |
| `ModelEntry()` | `go/types/types:21` | ModelEntry 模型文件条目 |
| `ImportFileItem()` | `go/types/types:40` | ImportFileItem 文件夹型模型整组导入的文件项（ADR-038 关联：解压目录整组导入） |
| `VersionInstance()` | `go/types/types:46` | VersionInstance 整合包信息 |
| `SearchResult()` | `go/types/types:54` | SearchResult 模型搜索结果 |
| `ImportLog()` | `go/types/types:66` | ImportLog 应用操作日志（导入、扫描、下载、同步等） |
| `RuntimeLog()` | `go/types/types:79` | RuntimeLog 运行时日志（watcher/sync 等标准库 log 输出，诊断页可见） |
| `LinkType()` | `go/types/types:86` | LinkType 链接类型 |
| `ErrorCode()` | `go/types/types:97` | ErrorCode 结构化错误码（ADR-051 落地：替代裸字符串拼接，消除前后端双份分类表漂移）。 |
| `LogLevel()` | `go/types/types:118` | LogLevel 日志级别（诊断页按 Level 过滤；向后兼容——旧日志无此字段时前端按 Status 兜底） |
| `CustomFileInfo()` | `go/types/types:146` | CustomFileInfo custom 目录下的文件信息 |
| `InstanceStatus()` | `go/types/types:152` | InstanceStatus 整合包状态 |
| `AppError()` | `go/types/types:165` | — |
| `ResourceSyncResult()` | `go/types/types:199` | ResourceSyncResult 资源同步结果 |
| `SyncStatus()` | `go/types/types:206` | SyncStatus 资源文件同步状态 |
| `ResourceSyncItem()` | `go/types/types:221` | ResourceSyncItem 单个资源文件的同步状态 |

## Go·更新器

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `progressWriter.Write()` | `go/updater/updater:82` | — |
| `Check()` | `go/updater/updater:139` | Check 检查 GitHub 是否有新版本（聚合所有未读版本的更新日志） |
| `CheckWithClient()` | `go/updater/updater:145` | CheckWithClient 可注入 client 与 API URL 的测试变体（Check 的内部实现） |
| `Download()` | `go/updater/updater:248` | Download 下载更新包（裸 exe）到临时目录，返回更新包路径（无进度回调，兼容旧调用方）。 |
| `DownloadWithProgress()` | `go/updater/updater:257` | DownloadWithProgress 下载更新包；onProgress 在下载过程中节流回调 (done, total) 字节数 （total&lt;=0 表示 Content-Le |
| `CleanupOldVersion()` | `go/updater/updater:407` | CleanupOldVersion 启动时清理上一次更新留下的 .old 文件 |
| `InstallUpdate()` | `go/updater/updater:431` | InstallUpdate 校验下载的更新 exe 并通过 helper 进程替换当前 exe。 |
| `ReleaseAsset()` | `go/updater/updater:102` | ReleaseAsset GitHub Release 中的文件 |
| `Release()` | `go/updater/updater:108` | Release GitHub Release 信息 |
| `UpdateInfo()` | `go/updater/updater:117` | UpdateInfo 更新信息（序列化给前端） |

## Go·监听

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `New()` | `go/watcher/watcher:45` | New 创建文件监听器 |
| `Watcher.Start()` | `go/watcher/watcher:61` | Start 开始监听 |
| `Watcher.Stop()` | `go/watcher/watcher:109` | Stop 停止监听 |
| `Watcher.IsRunning()` | `go/watcher/watcher:157` | IsRunning 返回是否正在运行 |
| `ScanFunc()` | `go/watcher/watcher:18` | ScanFunc matches mdsync.ScanFunc |
| `Watcher()` | `go/watcher/watcher:28` | Watcher 监听仓库目录的文件变更，自动同步 .ban 状态到所有整合包 |

## Go·YSM 核心

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `SetDecoder()` | `go/ysm/decode_inject:25` | SetDecoder 注入 .ysm 解码器（internal/app init 阶段调用，替换 FindCLI 模式） |
| `DecodeYSM()` | `go/ysm/decode_inject:32` | DecodeYSM 解码 .ysm 字节；解码器未注入或解码失败返回 nil |
| `DecodedFile()` | `go/ysm/decode_inject:11` | DecodedFile 解码 .ysm 产出的一个文件（Path 为输出目录内相对路径） |
| `FindGeometryInExtractedYSM()` | `go/ysm/extracted:461` | FindGeometryInExtractedYSM 在解压后的 YSM 模型目录中查找 geometry 和纹理 ysmJsonPath: ysm.json 的完整路径 返回: |
| `FindComponentsInExtractedYSM()` | `go/ysm/extracted:773` | FindComponentsInExtractedYSM 多组件解析（YSMViewer 式）：解压目录内每个模型文件独立组件， **不合并 bones、不排除 arm**（arm |
| `AnalyzeYSMHeader()` | `go/ysm/header:172` | AnalyzeYSMHeader 读取 YSM 文件的文本头部，提取元数据 |
| `AnalyzeYSMHeaderFromBytes()` | `go/ysm/header:325` | AnalyzeYSMHeaderFromBytes 从字节数据解析 YSM 头部（适用于 base64 导入场景） |
| `YSMHeader()` | `go/ysm/header:17` | YSMHeader 从 YSM 文件文本头部提取的元数据（适用于加密和非加密模型） |
| `AnalyzeYSMModel()` | `go/ysm/parse:45` | AnalyzeYSMModel 解析 .ysm 文件，提取模型元数据 |
| `YSMModelMeta()` | `go/ysm/parse:15` | YSMModelMeta 模型元数据（从 model.json 提取） |
| `ExtractYsmSummary()` | `go/ysm/summary:299` | ExtractYsmSummary 从 .ysm / .zip 文件中提取摘要。 |
| `Author()` | `go/ysm/summary:17` | — |
| `Link()` | `go/ysm/summary:23` | — |
| `AnimGroup()` | `go/ysm/summary:28` | — |
| `ConfigMenu()` | `go/ysm/summary:34` | — |
| `PreviewInfo()` | `go/ysm/summary:40` | — |
| `YsmSummary()` | `go/ysm/summary:48` | YsmSummary 是前端右侧面板和 AI 搜索消费的标准摘要 |
| `Stats()` | `go/ysm/summary:65` | — |
| `ScanModelTexSizes()` | `go/ysm/texsize:28` | ScanModelTexSizes 扫描仓库文件读取纹理尺寸，不调用 YSMParser/WASM 仅支持 zip/7z 格式（未加密模型），加密 .ysm 返回 0,0 |
| `ScanFiles()` | `go/ysm/texsize:164` | ScanFiles 读取目录下所有支持的文件条目（供 ScanModelTexSizes 使用） |
| `TexInfo()` | `go/ysm/texsize:20` | TexInfo 轻量级纹理尺寸（不解析完整模型） |
| `ModelEntry()` | `go/ysm/texsize:43` | ModelEntry 轻量级条目（仅用于纹理扫描签名，调用方传入完整路径） |
| `IsYSMJar()` | `go/ysm/ysm:14` | IsYSMJar 检查单个 jar 是否是 YSM 模组（支持 mods.toml 和 neoforge.mods.toml） |
| `IsModJar()` | `go/ysm/ysm:21` | IsModJar 内容检测单个 jar 是否是指定 mod（读取 META-INF/mods.toml / neoforge.mods.toml 的 [[mods]] 块，按 mo |
| `HasYSMMod()` | `go/ysm/ysm:86` | HasYSMMod 检查 mods 目录是否有 YSM 模组（先做文件名过滤避免对每个 JAR 打开 ZIP） |
| `HasModInDir()` | `go/ysm/ysm:110` | HasModInDir 检查 mods 目录是否有匹配指定类型关键词的 jar ADR-110：mod 依赖从注册表查询（types.ModKeywordsFor / types. |

## Go(internal)·应用入口

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `App.CachedCreatorAvatar()` | `internal/app/app_avatar:18` | CachedCreatorAvatar 检查缓存中是否有作者头像，返回 data URI |
| `App.BatchExtractCreatorAvatars()` | `internal/app/app_avatar:23` | BatchExtractCreatorAvatars 批量提取所有有本地模型的创作者头像 |
| `App.DebugExtractCreatorAvatar()` | `internal/app/app_avatar:76` | DebugExtractCreatorAvatar 调试版：提取指定作者头像 |
| `App.CacheModelAvatars()` | `internal/app/app_avatar:131` | CacheModelAvatars 从模型文件缓存作者头像（覆盖 .ysm/.zip/.json 等所有格式） |
| `App.GetConfigPath()` | `internal/app/app_config:62` | GetConfigPath 返回应用配置文件路径（跨平台：Windows %APPDATA%，Linux ~/.config，macOS ~/Library/Application |
| `App.SaveAppConfig()` | `internal/app/app_config:134` | — |
| `App.SetDownloadMirror()` | `internal/app/app_config:204` | — |
| `App.SaveThresholds()` | `internal/app/app_config:213` | SaveThresholds 保存运行阈值配置（ADR-062 §2.3：前端设置页写入入口）。 |
| `App.LoadAppConfig()` | `internal/app/app_config:245` | — |
| `App.GetSubDirMap()` | `internal/app/app_config:268` | ========== 自动更新 ========== GetSubDirMap 返回资源类型→子目录映射表（前端右键菜单等场景使用） |
| `App.CurrentVersion()` | `internal/app/app_config:272` | — |
| `App.CheckUpdate()` | `internal/app/app_config:274` | — |
| `App.DoUpdate()` | `internal/app/app_config:301` | — |
| `App.RestartApplication()` | `internal/app/app_config:319` | — |
| `App.SaveWindowPosition()` | `internal/app/app_config:354` | — |
| `App.GetWindowPosition()` | `internal/app/app_config:368` | — |
| `App.SelectDirectory()` | `internal/app/app_config:401` | ========== 目录选择 ========== |
| `App.GetMinecraftPaths()` | `internal/app/app_config:464` | — |
| `App.ValidateMinecraftDir()` | `internal/app/app_config:466` | — |
| `NewDownloadQueue()` | `internal/app/app_download:51` | NewDownloadQueue 创建串行下载队列（回调由 App 初始化时注入） |
| `App.EnqueueDownloads()` | `internal/app/app_download:56` | — |
| `App.CancelQueue()` | `internal/app/app_download:86` | — |
| `App.QueueStatus()` | `internal/app/app_download:106` | — |
| `App.DownloadFromGitHub()` | `internal/app/app_download:259` | — |
| `App.GetModelTexSizes()` | `internal/app/app_download:270` | GetModelTexSizes 扫描仓库文件提取纹理尺寸（轻量级，不解析完整模型） |
| `QueueStatusInfo()` | `internal/app/app_download:18` | QueueStatusInfo 队列状态（替代多返回值，Wails 自动映射为 JS object） |
| `DownloadTask()` | `internal/app/app_download:24` | DownloadTask 下载队列任务 |
| `DownloadQueue()` | `internal/app/app_download:33` | DownloadQueue 串行下载队列 回调注入替代 *App 反向引用（ADR-002 P1：打破 DownloadQueue ↔ App 循环，解锁独立测试） |
| `App.CreateDir()` | `internal/app/app_files:23` | ========== 目录操作 ========== |
| `App.RenameDir()` | `internal/app/app_files:27` | — |
| `App.RemoveDir()` | `internal/app/app_files:39` | — |
| `App.RenameFile()` | `internal/app/app_files:51` | — |
| `App.FindPreviewImage()` | `internal/app/app_files:65` | ========== 预览提取 ========== |
| `App.ExtractPreviewTexture()` | `internal/app/app_files:69` | — |
| `App.GetPackInfo()` | `internal/app/app_files:74` | ========== 包信息 ========== |
| `App.MoveModelFile()` | `internal/app/app_files:146` | MoveModelFile 移动（findMoveRoot 遍历所有已配置根做路径安全校验， 修复原硬编码 cfg.FilesRoot 导致自定义根下文件无法移动的 bug。 |
| `App.CopyModelFile()` | `internal/app/app_files:155` | CopyModelFile 复制（同 MoveModelFile 修复：findMoveRoot 多根校验，fail-closed） |
| `App.ImportModelFolder()` | `internal/app/app_files:167` | ImportModelFolder 文件夹型模型整组导入（YSM 解压目录 / MMD 模型目录，保留子目录层级，ADR-038 关联） folderName = 仓库文件夹名（模 |
| `App.ImportModelFolderTo()` | `internal/app/app_files:185` | ImportModelFolderTo 带页面上下文类型的文件夹整组导入（拖拽导入上下文路由）。 |
| `App.RevealInExplorer()` | `internal/app/app_files:260` | ========== 在资源管理器中显示 ========== |
| `App.OpenFolder()` | `internal/app/app_files:290` | ========== 打开文件夹 ========== OpenFolder 在宿主文件管理器中打开目录（explorer/open/xdg-open 平台分支）。 |
| `App.OpenInstanceFolder()` | `internal/app/app_files:326` | OpenInstanceFolder 按资源类型打开整合包内资源存储目录 扁平化架构下，统一使用 instanceDir（如 EntityPlayer、config/yes_ste |
| `App.ToggleModelEnable()` | `internal/app/app_files:347` | ========== 启用/禁用 ========== ToggleModelEnable 切换 .ban 状态（fileops 纯逻辑 + 薄壳缓存失效） |
| `App.IsFileBanned()` | `internal/app/app_files:355` | — |
| `App.ToggleEnable()` | `internal/app/app_files:364` | ========== 统一启用/禁用（兄弟会话裁定：无 rtype，纯路径包含判定）========== ToggleEnable 统一启禁入口——root 归属由「哪个已知根包含 |
| `App.InstallModelFile()` | `internal/app/app_install_import:21` | ========== 安装 ========== |
| `App.InstallModelTo()` | `internal/app/app_install_import:25` | — |
| `App.InstallModelWithOverlay()` | `internal/app/app_install_import:43` | — |
| `App.SyncCustomToRepo()` | `internal/app/app_install_import:48` | SyncCustomToRepo 同步整合包自定义目录到仓库（执行逻辑下沉 go/sync） |
| `App.ImportModelFile()` | `internal/app/app_install_import:56` | — |
| `App.DetectZipType()` | `internal/app/app_install_import:61` | DetectZipType 通过 ZIP 内容检测资源类型（供前端导入路由使用） |
| `App.ImportModelFileSkipCheck()` | `internal/app/app_install_import:69` | — |
| `App.ImportModelFileOverwrite()` | `internal/app/app_install_import:77` | — |
| `App.ImportModelFileTo()` | `internal/app/app_install_import:103` | — |
| `App.ImportModelFileOverwriteTo()` | `internal/app/app_install_import:107` | — |
| `App.ImportModelFileToMMD()` | `internal/app/app_install_import:114` | ImportModelFileToMMD 导入 MMD 模型文件到指定用途子目录（ADR-096）。 |
| `App.ImportModelFileOverwriteToMMD()` | `internal/app/app_install_import:119` | ImportModelFileOverwriteToMMD 覆盖导入 MMD 模型文件到指定用途子目录。 |
| `App.CountInstanceResources()` | `internal/app/app_install_instance:26` | CountInstanceResources 统计指定整合包中可清空的资源文件数 只统计仓库中已有的文件（同 clearInstanceDir 逻辑） rtype 为空时统计全部类 |
| `App.ClearInstanceResources()` | `internal/app/app_install_instance:66` | ClearInstanceResources 清空指定整合包中已同步的文件 insName: 整合包名, rtype: 资源类型（空=全部, 非空=只清此类型） 返回清除的文件数量 |
| `App.DeduplicateCustomDir()` | `internal/app/app_install_instance:152` | DeduplicateCustomDir 按 SHA256 哈希去重（执行逻辑下沉 go/recycle） |
| `App.GetInstanceStatus()` | `internal/app/app_install_instance:197` | ========== 状态同步 ========== GetInstanceStatus 获取整合包状态（按资源类型限定路径） rtype: 资源类型 ID，用于解析特定子目录；为 |
| `App.GetResourceInstanceStatus()` | `internal/app/app_install_instance:209` | GetResourceInstanceStatus 按资源类型获取整合包同步状态 统一走 GetInstanceStatus 路径，通过 rtype 限定实例侧扫描子目录 + 仓库 |
| `App.SyncModelToggleStatus()` | `internal/app/app_install_instance:271` | — |
| `App.RelinkCustomDir()` | `internal/app/app_install_instance:281` | RelinkCustomDir 重新应用链接模式到指定目录（兼容旧版） |
| `App.RelinkAllInstanceResources()` | `internal/app/app_install_instance:306` | RelinkAllInstanceResources 重新应用链接模式到整合包所有资源类型目录 |
| `App.SyncResources()` | `internal/app/app_install_instance:350` | SyncResources 获取全局 ↔ 整合包的资源同步状态 |
| `App.PushResourceToInstance()` | `internal/app/app_install_instance:388` | PushResourceToInstance 将全局中缺失的资源推送到整合包 PushResourceToInstance 推送缺失资源到整合包（执行循环下沉 go/sync） |
| `App.PullResourceFromInstance()` | `internal/app/app_install_instance:410` | PullResourceFromInstance 拉取整合包多余资源回仓库（执行循环下沉 go/sync） |
| `App.PullSingleResourceFromInstance()` | `internal/app/app_install_instance:452` | PullSingleResourceFromInstance 从整合包拉取单个 extra 文件/文件夹到全局仓库 PullSingleResourceFromInstance 从 |
| `App.PushSingleResourceToInstance()` | `internal/app/app_install_instance:473` | PushSingleResourceToInstance 推送单个资源到整合包（分派核心下沉 go/sync） |
| `App.GetInstanceSyncStatus()` | `internal/app/app_install_instance:500` | GetInstanceSyncStatus 获取整合包下所有资源类型的同步状态（扁平列表） subtype 可选，指定子类型目录名（如 EntityPlayer），仅 subDir |
| `App.HasYSMMod()` | `internal/app/app_install_instance:562` | ========== YSM 检测 ========== |
| `App.SetLinkMode()` | `internal/app/app_install_link:11` | ========== 链接模式 ========== |
| `App.GetLinkMode()` | `internal/app/app_install_link:38` | — |
| `App.AddImportLog()` | `internal/app/app_install_log:8` | ========== 日志 ========== |
| `App.AddOpLog()` | `internal/app/app_install_log:12` | — |
| `App.GetImportLogs()` | `internal/app/app_install_log:16` | — |
| `App.ClearImportLogs()` | `internal/app/app_install_log:20` | — |
| `App.GetRuntimeLogs()` | `internal/app/app_install_log:25` | GetRuntimeLogs 获取运行时日志（watcher/sync 等标准库 log 输出） |
| `App.ClearRuntimeLogs()` | `internal/app/app_install_log:30` | ClearRuntimeLogs 清空运行时日志缓冲 |
| `App.MoveToRecycle()` | `internal/app/app_install_recycle:17` | ========== 回收站 ========== |
| `App.MoveToRecycleEx()` | `internal/app/app_install_recycle:38` | — |
| `App.ClearCustomDir()` | `internal/app/app_install_recycle:91` | — |
| `App.ListRecycleBin()` | `internal/app/app_install_recycle:161` | — |
| `App.RestoreFromRecycle()` | `internal/app/app_install_recycle:178` | — |
| `App.DeleteFromRecycle()` | `internal/app/app_install_recycle:199` | — |
| `App.EmptyRecycleBin()` | `internal/app/app_install_recycle:215` | EmptyRecycleBin 清空所有已配置资源根目录的回收站，返回删除条目总数。 |
| `App.AnalyzeYSMModel()` | `internal/app/app_model:39` | — |
| `App.ExtractYsmSummary()` | `internal/app/app_model:43` | — |
| `App.ExtractYSMHeader()` | `internal/app/app_model:57` | — |
| `App.ExtractYSMHeaderFromBase64()` | `internal/app/app_model:61` | — |
| `App.SavePreviewTempFile()` | `internal/app/app_model:69` | — |
| `App.ReadFileBytes()` | `internal/app/app_model:88` | — |
| `App.ReadFileBytesBatch()` | `internal/app/app_model:110` | ReadFileBytesBatch 批量读取多个文件（ADR-101：MMD 纹理加载优化）。 |
| `App.ReadFileBytesBatchWithMeta()` | `internal/app/app_model:215` | ReadFileBytesBatchWithMeta 批量读取文件并返回内容 + SHA256 哈希。 |
| `App.AnalyzeBedrockModel()` | `internal/app/app_model:275` | — |
| `App.AnalyzeBedrockModelEntry()` | `internal/app/app_model:337` | AnalyzeBedrockModelEntry 按 SubModel.SourcePath 只解析归档内单模型 geometry（多角色包角色切换用）。 |
| `App.GetModel3DSpec()` | `internal/app/app_model:385` | — |
| `App.Build3DSpecFromGeometryJSON()` | `internal/app/app_model:425` | Build3DSpecFromGeometryJSON 从 bedrock geometry JSON 构建 3D spec（纯 Go，无 Node 依赖）。 |
| `App.SaveScreenshotFile()` | `internal/app/app_model:529` | SaveScreenshotFile 保存 base64 PNG 到磁盘（供 JS 批量截图用） 路径守卫：限制在 os.TempDir()/ysm-preview 内，禁止绝对路 |
| `ReadFileMeta()` | `internal/app/app_model:191` | ReadFileMeta 是 ReadFileBytesBatchWithMeta 的单个文件元信息。 |
| `App.ExportModelStructureJSON()` | `internal/app/app_scan:25` | ========== 导出单模型骨骼结构 ========== ExportModelStructureJSON 导出单模型骨骼结构 |
| `App.SearchModels()` | `internal/app/app_scan:63` | ========== 高级搜索 ========== SearchModels 扫描模型条目后按关键词、骨骼数、立方体数、纹理尺寸范围过滤。 |
| `App.SearchAllModels()` | `internal/app/app_scan:216` | SearchAllModels 跨类型搜索：遍历所有已配置资源类型的根目录，并发扫描 + 合并结果。 |
| `App.ScanModelEntries()` | `internal/app/app_scan:305` | ScanModelEntries 用户可见的扫描入口（Wails 绑定），记录操作日志。 |
| `App.ScanModelEntriesWithLabel()` | `internal/app/app_scan:327` | ScanModelEntriesWithLabel 同 ScanModelEntries，但操作日志附带资源类型标签 （如「资源包」「光影包」「模型」），便于在操作日志面板区分扫描 |
| `App.ScanModelEntriesFiltered()` | `internal/app/app_scan:380` | ScanModelEntriesFiltered 同 ScanModelEntriesWithLabel，但额外按 rtype（+可选 subtype）的 extensions 注 |
| `App.ClearScanCache()` | `internal/app/app_scan:430` | ClearScanCache 清除扫描缓存（下载/导入后调用） |
| `App.ListModelAuthors()` | `internal/app/app_scan:437` | ListModelAuthors 统计 [作者] 前缀（轻量遍历：只看文件名，不读元数据不算哈希， 不占全量扫描缓存——原走 ScanEntries 会陪绑 SHA256，大库下拖 |
| `App.GenerateRepoIndex()` | `internal/app/app_scan:446` | GenerateRepoIndex 生成 index.json（含 GitHub Actions workflow 模板） |
| `App.ScanLocalAuthors()` | `internal/app/app_scan:457` | ScanLocalAuthors 扫描所有本地资源目录，从文件名提取作者 ScanLocalAuthors 扫描本地仓库的作者信息。 |
| `App.ListVersionInstances()` | `internal/app/app_scan:469` | — |
| `App.GetGlobalCustomDir()` | `internal/app/app_scan:473` | — |
| `App.ListFileNames()` | `internal/app/app_scan:479` | — |
| `App.ListAllFilePaths()` | `internal/app/app_scan:496` | ListAllFilePaths 递归列出指定目录下的所有文件完整路径（不限制扩展名） |
| `App.CheckFileExists()` | `internal/app/app_scan:505` | — |
| `App.DetectConflicts()` | `internal/app/app_sync:15` | DetectConflicts 检测指定整合包与全局仓库之间的文件冲突 rtype: 资源类型 ID instanceName: 整合包名称 返回冲突报告 JSON |
| `App.ResolveConflicts()` | `internal/app/app_sync:59` | ResolveConflicts 批量解决冲突 conflictsJSON: 冲突列表 JSON（来自 DetectConflicts） defaultStrategy: 默认解决 |
| `App.GetModelTags()` | `internal/app/app_tags:19` | GetModelTags 返回指定模型文件的所有标签 |
| `App.SetModelTags()` | `internal/app/app_tags:29` | SetModelTags 设置指定模型文件的标签列表（覆盖写入） |
| `App.ListByTag()` | `internal/app/app_tags:38` | ListByTag 返回所有打了指定标签的文件路径列表 |
| `App.AllTags()` | `internal/app/app_tags:43` | AllTags 返回所有被使用的标签（按使用次数降序） |
| `App.GetCachedTexture()` | `internal/app/app_texture_cache:25` | GetCachedTexture 读取纹理文件，计算内容哈希，检查 KTX2 缓存。 |
| `App.SaveCachedTexture()` | `internal/app/app_texture_cache:71` | SaveCachedTexture 保存前端 WASM 编码后的 KTX2 数据到缓存。 |
| `App.ClearTextureCache()` | `internal/app/app_texture_cache:80` | ClearTextureCache 清空纹理缓存（用户主动清理用）。 |
| `App.HasCachedTexture()` | `internal/app/app_texture_cache:85` | HasCachedTexture 检查指定纹理的内容哈希是否已有 KTX2 缓存。 |
| `App.GetCachedTextureByHash()` | `internal/app/app_texture_cache:92` | GetCachedTextureByHash 通过哈希直接读取 KTX2 缓存（不读取原始文件，轻量操作）。 |
| `App.HasCachedTextures()` | `internal/app/app_texture_cache:105` | HasCachedTextures 批量检查多个哈希是否已有 KTX2 缓存。 |
| `CachedTextureResult()` | `internal/app/app_texture_cache:16` | CachedTextureResult 是 GetCachedTexture 的返回值。 |
| `App.DefaultWorkshopSites()` | `internal/app/app_workshop:103` | — |
| `App.SaveWorkshopSites()` | `internal/app/app_workshop:114` | — |
| `App.LoadWorkshopCreators()` | `internal/app/app_workshop:156` | — |
| `App.SaveWorkshopCreators()` | `internal/app/app_workshop:167` | — |
| `App.SaveWorkshopCreatorsBySite()` | `internal/app/app_workshop:176` | SaveWorkshopCreatorsBySite 只替换指定站点的创作者，其他站点不动 |
| `App.SaveWorkshopPresetsBySite()` | `internal/app/app_workshop:192` | SaveWorkshopPresetsBySite 只替换指定站点的搜索词，其他站点不动 |
| `App.LoadGitHubRepos()` | `internal/app/app_workshop:205` | — |
| `App.ResetWorkshopConfigs()` | `internal/app/app_workshop:216` | — |
| `App.ExportWorkshopSitesCSV()` | `internal/app/app_workshop:237` | ========== CSV 导出/导入 ========== |
| `App.ExportWorkshopSitesJSONFile()` | `internal/app/app_workshop:249` | — |
| `App.ValidateWorkshopSites()` | `internal/app/app_workshop:262` | — |
| `App.ImportWorkshopSitesCSV()` | `internal/app/app_workshop:278` | — |
| `App.ExportWorkshopCreatorsJSONFile()` | `internal/app/app_workshop:304` | — |
| `App.BackupWorkshopCreators()` | `internal/app/app_workshop:311` | — |
| `App.MergeWorkshopCreatorsFromJSON()` | `internal/app/app_workshop:326` | — |
| `App.ReplaceWorkshopCreatorsFromJSON()` | `internal/app/app_workshop:368` | — |
| `NewApp()` | `internal/app/app:63` | — |
| `App.SetApp()` | `internal/app/app:89` | SetApp 注入 Wails 3 应用实例，供 service 方法访问窗口/事件/对话框/浏览器管理器 |
| `App.GetYSMRepoRoot()` | `internal/app/app:92` | GetYSMRepoRoot 返回当前配置的 YSM 仓库根目录 |
| `App.SetMainWindow()` | `internal/app/app:104` | SetMainWindow 注入主窗口实例，避免依赖 Window.Current()。 |
| `App.ServiceStartup()` | `internal/app/app:107` | ServiceStartup 对应 v2 的 startup，在 app.Run() 期间由框架调用 |
| `App.ServiceShutdown()` | `internal/app/app:206` | ServiceShutdown 对应 v2 的 shutdown，在应用退出前由框架调用 |
| `App.OpenInBrowser()` | `internal/app/app:241` | OpenInBrowser 在系统默认浏览器中打开链接（而非 WebView2 内嵌） |
| `App.GetAppVersion()` | `internal/app/app:246` | GetAppVersion 返回当前版本号 |
| `App()` | `internal/app/app:30` | — |
| `SetEmbedded()` | `internal/app/assets:16` | SetEmbedded 由根包 main 的 init() 注入编译期嵌入的静态资产。 |
| `App.SetAllowedCommands()` | `internal/app/cli_bridge:15` | SetAllowedCommands 注入可用 CLI 命令列表（由 main.go 调用 cli.GetAllowedCommands() 提供） 避免 app→cli 循环依赖 |
| `App.ExecuteCLI()` | `internal/app/cli_bridge:31` | ExecuteCLI 执行 CLI 命令并返回 JSON 响应（Wails 绑定） |
| `App.GetAllowedCLICommands()` | `internal/app/cli_bridge:140` | GetAllowedCLICommands 返回可用 CLI 命令列表 列表由 main.go 从 cli 注册表注入（SetAllowedCommands），新增命令自动可见 |
| `CoopCoepMiddleware()` | `internal/app/coi_middleware:10` | CoopCoepMiddleware 注入 COOP/COEP 响应头（ADR-079 M2：桌面 Wails 解锁 SharedArrayBuffer → 支持 pthread |
| `ErrorJSON()` | `internal/app/error_json:16` | ErrorJSON 构建带 error 字段的响应 JSON。 |
| `SyncErrorJSON()` | `internal/app/error_json:31` | SyncErrorJSON 构建同步操作的错误响应（含 conflicts / totalConflicts 基础字段）。 |
| `ResolveErrorJSON()` | `internal/app/error_json:39` | ResolveErrorJSON 构建冲突解决的操作错误响应（含 resolved / failed / manual 基础字段）。 |
| `DedupErrorJSON()` | `internal/app/error_json:50` | DedupErrorJSON 构建去重扫描的错误响应（仅含 error 字段，前端契约：DedupGroup[] | {error}）。 |
| `androidPathManager.AppDataRoot()` | `internal/app/pathmgr_android:45` | AppDataRoot 按候选序返回第一个可写目录；全不可写返回错误—— 直接返回 HOME/Getwd 可能退化为不可写的文件系统根 "/"（P2 审核发现）， 配置/标签将静默 |
| `androidPathManager.DefaultRepoRoot()` | `internal/app/pathmgr_android:74` | DefaultRepoRoot Android 固定公共仓库根：外部存储根 + 应用名。 |
| `desktopPathManager.AppDataRoot()` | `internal/app/pathmgr_desktop:10` | — |
| `desktopPathManager.DefaultRepoRoot()` | `internal/app/pathmgr_desktop:15` | DefaultRepoRoot 桌面无默认公共仓库——路径由用户在设置页配置（GetRepoRoot 走 FilesRoot） |
| `App.NavigatePlazaWindow()` | `internal/app/plaza_window:40` | — |
| `App.ClosePlazaWindow()` | `internal/app/plaza_window:77` | — |
| `App.PlazaGoBack()` | `internal/app/plaza_window:98` | — |
| `App.PlazaGoForward()` | `internal/app/plaza_window:102` | — |
| `App.PlazaReload()` | `internal/app/plaza_window:106` | — |
| `App.PlazaZoomIn()` | `internal/app/plaza_window:117` | — |
| `App.PlazaZoomOut()` | `internal/app/plaza_window:128` | — |
| `App.PlazaZoomReset()` | `internal/app/plaza_window:139` | — |
| `cookieJar.SetCookies()` | `internal/app/proxy:138` | — |
| `cookieJar.Cookies()` | `internal/app/proxy:160` | — |
| `App.LoadResourceTypes()` | `internal/app/resource_bindings:27` | LoadResourceTypes 加载资源类型注册表 |
| `App.ReadPackMeta()` | `internal/app/resource_bindings:37` | ReadPackMeta 读取资源包信息（pack.mcmeta + pack.png） |
| `App.ReadShaderpackLang()` | `internal/app/resource_bindings:61` | ReadShaderpackLang 读取光影包 lang/en_US.lang 提取显示名 |
| `App.GetNbtVoxelData()` | `internal/app/resource_bindings:105` | GetNbtVoxelData 读取 .nbt 结构文件体素数据 |
| `App.GetSchematicVoxelData()` | `internal/app/resource_bindings:110` | GetSchematicVoxelData 读取 .schematic 文件体素数据 |
| `App.ReadSchematic()` | `internal/app/resource_bindings:115` | ReadSchematic 读取 .schematic 文件基本信息 |
| `App.ReadNbtStructure()` | `internal/app/resource_bindings:124` | ReadNbtStructure 读取 .nbt 结构文件基本信息 |
| `App.ReadLitematicMeta()` | `internal/app/resource_bindings:133` | ReadLitematicMeta 读取投影文件元数据（作者/时间/版本/方块统计/预览图） |
| `App.GetLitematicVoxelData()` | `internal/app/resource_bindings:143` | GetLitematicVoxelData 读取投影文件体素数据（按颜色分组的方块位置） |
| `App.SetVoxelMaxBlocks()` | `internal/app/resource_bindings:148` | SetVoxelMaxBlocks 设置 3D 体素渲染上限，0=恢复默认 200000 |
| `App.DetectResourceType()` | `internal/app/resource_bindings:158` | DetectResourceType 检测指定文件的资源类型 |
| `App.GetDefaultRepoRoot()` | `internal/app/resource_bindings:171` | GetDefaultRepoRoot 返回平台默认公共仓库根目录（不含类型子目录）。 |
| `App.GetRepoRoot()` | `internal/app/resource_bindings:186` | GetRepoRoot 根据资源类型返回对应的仓库根目录 |
| `App.GetAllRepoRoots()` | `internal/app/resource_bindings:218` | GetAllRepoRoots 遍历所有注册资源类型，返回 rtype → root 映射（供跨类型搜索）。 |
| `App.EnsureStorageDirs()` | `internal/app/resource_bindings:242` | EnsureStorageDirs 预创建所有注册资源类型的存储子目录 （FilesRoot/{group}/{storageSubDir}，或各类型专属覆写路径）。 |
| `App.ToggleResourcePack()` | `internal/app/resource_bindings:314` | ToggleResourcePack 切换资源包的启用/禁用状态（.zip ↔ .zip.disabled） 补路径守卫——原实现 os.Rename 对任意路径可重命名（对齐 T |
| `App.IsResourcePackEnabled()` | `internal/app/resource_bindings:352` | IsResourcePackEnabled 检查资源包是否启用 |
| `App.SelectImportZip()` | `internal/app/resource_bindings:357` | SelectImportZip 打开文件选择器选取 .zip 文件 |
| `App.SelectImportFile()` | `internal/app/resource_bindings:370` | SelectImportFile 打开文件选择器，按给定扩展名过滤 filter 格式: "显示名|*.ext1;*.ext2" |
| `App.SetResourceRoot()` | `internal/app/resource_bindings:392` | SetResourceRoot 设置指定资源类型的自定义根路径（空=恢复默认） ADR-095：写入 cfg.CustomRoots[rtype]；删除则清空该 key。 |
| `App.ResetResourceRoot()` | `internal/app/resource_bindings:412` | ResetResourceRoot 恢复指定资源类型的路径为默认（清空自定义值） |
| `App.ImportResourcePack()` | `internal/app/resource_bindings:446` | ImportResourcePack 使用策略模式导入资源包 |
| `App.ImportByType()` | `internal/app/resource_bindings:459` | ImportByType 统一导入入口——根据资源类型自动选择导入策略 |
| `App.DeleteResourcePack()` | `internal/app/resource_bindings:479` | DeleteResourcePack 删除资源（目录感知，ADR-038 D3.6）： 统一入口——根据 rtype.isDir 决定语义： isDir=true:  删除文件所在 |
| `App.FindDuplicateFiles()` | `internal/app/resource_bindings:548` | FindDuplicateFiles 扫描目录返回所有重复文件分组（JSON 字符串）。 |
| `App.CountDuplicateFiles()` | `internal/app/resource_bindings:576` | CountDuplicateFiles 快速统计重复文件数量。 |
| `App.InvalidateScanCache()` | `internal/app/resource_bindings:589` | InvalidateScanCache 清空扫描缓存，下次扫描获取最新数据（委托 ClearScanCache） |
| `App.RepoHealthAudit()` | `internal/app/resource_bindings:596` | RepoHealthAudit 一键全仓体检（审计 + 去重），返回 JSON 字符串。 |
| `App.RepoHealthAuditAll()` | `internal/app/resource_bindings:617` | RepoHealthAuditAll 全仓库体检：遍历所有已配置资源类型根目录，合并审计结果。 |
| `App.InstallResourceToInstance()` | `internal/app/resource_bindings:682` | InstallResourceToInstance 将资源文件安装到指定整合包 rtype: 资源类型（resourcepack/shaderpack 等），srcPath: 源文 |
| `App.ListPackModels()` | `internal/app/resourcepack_models:49` | ListPackModels 枚举资源包容器内的 block/item 模型 JSON 条目路径（升序）。 |
| `App.ReadPackEntry()` | `internal/app/resourcepack_models:74` | ReadPackEntry 读取容器内条目内容（base64 字符串）。 |
| `limitedBuffer.Write()` | `internal/app/wasm_decoder:86` | — |
| `App.GetWasmBinary()` | `internal/app/wasm_embed:5` | GetWasmBinary 返回内嵌的 YSMParser.wasm 字节（供前端 WebView2 使用）。 |

## 前端·根 (app-modules/bus)

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `normalizeTheme()` | `frontend/src/app-modules` | — |
| `applyTheme()` | `frontend/src/app-modules` | — |
| `initTheme()` | `frontend/src/app-modules` | — |
| `bus()` | `frontend/src/bus:198` | 默认实例（组件直接使用） |
| `ToastPayload()` | `frontend/src/bus:7` | — |
| `MenuItem()` | `frontend/src/bus:18` | — |
| `PageName()` | `frontend/src/bus:30` | 核心页面名（与 app-nav 导航菜单一致） |
| `NavPagePayload()` | `frontend/src/bus:38` | — |
| `ModelSelectPayload()` | `frontend/src/bus:42` | — |
| `CtxShowPayload()` | `frontend/src/bus:47` | — |
| `BusEvents()` | `frontend/src/bus:66` | — |
| `BusEventName()` | `frontend/src/bus:110` | — |
| `Bus()` | `frontend/src/bus:135` | — |
| `revealMainWindow()` | `frontend/src/startup-reveal:2` | Wait until the DOM has been upgraded and painted before exposing the native window. |
| `normalizeTheme()` | `frontend/src/theme-core:17` | 主题归一化：白名单外一律回落 system（P2 修复后持久层也只写合法值） |
| `applyTheme()` | `frontend/src/theme-core:21` | — |
| `initTheme()` | `frontend/src/theme-core:34` | — |

## frontend/backend

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `AppBindings()` | `frontend/src/backend/app` | — |
| `getApp()` | `frontend/src/backend/app:18` | 获取 Go App 绑定的缓存引用，避免重复动态 import |
| `WebUnsupportedError()` | `frontend/src/backend/browser-adapter` | — |
| `WEB_ROOT()` | `frontend/src/backend/browser-adapter` | — |
| `MAX_IMPORT_BYTES()` | `frontend/src/backend/browser-adapter` | — |
| `arrayBufferToBase64()` | `frontend/src/backend/browser-adapter` | — |
| `importWebFiles()` | `frontend/src/backend/browser-adapter` | — |
| `selectLocalRepo()` | `frontend/src/backend/browser-adapter` | — |
| `getFsaAuthState()` | `frontend/src/backend/browser-adapter` | — |
| `reauthorizeFsaRoot()` | `frontend/src/backend/browser-adapter` | — |
| `rescanFsaRoot()` | `frontend/src/backend/browser-adapter` | — |
| `consumeWebSearchDegraded()` | `frontend/src/backend/browser-adapter` | — |
| `__setStatsRunnerForTest()` | `frontend/src/backend/browser-adapter` | — |
| `terminateStatsWorker()` | `frontend/src/backend/browser-adapter` | — |
| `onStatsProgress()` | `frontend/src/backend/browser-adapter` | — |
| `getStatsPoolSize()` | `frontend/src/backend/browser-adapter` | — |
| `prefetchStatsWorker()` | `frontend/src/backend/browser-adapter` | — |
| `browserAdapter()` | `frontend/src/backend/browser-adapter:70` | 浏览器后端（Proxy 动态形状，未实现 binding 一律 fail-fast） |
| `isCrossOriginIsolated()` | `frontend/src/backend/coi-sw:15` | 当前是否已跨源隔离（SW 补头后 crossOriginIsolated=true；供多线程 WASM 分支） |
| `registerCoiServiceWorker()` | `frontend/src/backend/coi-sw:20` | 注册 COI SW（网页版）：首次注册后 reload 一次让浏览器重新导航经 SW（解锁跨源隔离） |
| `ZipEntryMeta()` | `frontend/src/backend/extract:33` | ZIP 中央目录条目元数据（pre-parse 产物） |
| `ExtractResult()` | `frontend/src/backend/extract:49` | extractZip 返回值 |
| `ZipType()` | `frontend/src/backend/extract:58` | detectZipType 返回值 |
| `parseZipCentralDir()` | `frontend/src/backend/extract:63` | 解析 ZIP 中央目录，返回每个 entry 的 fflateKey + 原始文件名字节 |
| `extractZip()` | `frontend/src/backend/extract:142` | 解压 ZIP 数据，返回 {entries, metas}。 |
| `gbkDecodeEntry()` | `frontend/src/backend/extract:178` | 尝试 GBK 解码 fflateKey 的原始字节（当 gpf bit 11 未设时）。 |
| `detectZipType()` | `frontend/src/backend/extract:196` | detectZipType：扫描 ZIP local file header 文件名段（不解压数据）， 识别资源类型。Go DetectZipType 的 1:1 TS 平移 （g |
| `Store()` | `frontend/src/backend/idb:17` | — |
| `openDB()` | `frontend/src/backend/idb:21` | — |
| `__resetDBForTest()` | `frontend/src/backend/idb:139` | 仅测试用：重置单例连接 + 降级标志（避免用例间共享状态） |
| `idbGet()` | `frontend/src/backend/idb:156` | 读取单 key |
| `idbSet()` | `frontend/src/backend/idb:167` | 写入单 key（QuotaExceededError 走 onabort，必须监听否则 Promise 永不 settle） |
| `idbDel()` | `frontend/src/backend/idb:184` | 删除单 key |
| `idbKeys()` | `frontend/src/backend/idb:205` | 前缀扫描（MikuMikuAR 模式：dir:&lt;stem&gt;: / file:&lt;stem&gt;: 遍历模型库） 性能优化（R1 万级 key 门槛）：真实浏览器用 IDBKeyRange |
| `parseNbtRoot()` | `frontend/src/backend/nbt-parse:253` | 解析 NBT 根 compound，返回全部顶层标签。 |
| `parseNbtRootExact()` | `frontend/src/backend/nbt-parse:276` | ADR-070 M2：精确 LongArray 变体——LongArray 输出 bigint[]（精确 64 位）， 供 voxel 打包位解码（BlockStates）使用。其 |
| `litematicMetaView()` | `frontend/src/backend/nbt-parse:328` | .litematic 视图：根 Version/MinecraftDataVersion + Metadata compound → LitematicMeta JSON 形状。 |
| `nbtStructureView()` | `frontend/src/backend/nbt-parse:362` | .nbt 视图：对齐 ParseNbtStructure（parser.go:267）。 |
| `schematicSummaryView()` | `frontend/src/backend/nbt-parse:483` | .schematic 视图：对齐 ParseSchematicSummary（parser.go:173）。 |
| `findZipEntry()` | `frontend/src/backend/pack-meta:23` | zip entries 中按小写名找条目（对齐 go 端 strings.ToLower(f.Name) 匹配—— zip 内路径大小写不敏感：PACK.MCMETA / Lang |
| `parsePackMetaJson()` | `frontend/src/backend/pack-meta:99` | pack.mcmeta 字节 → meta 对象（对齐 internal/app ReadPackMeta 的 result 形状： pack_format / descripti |
| `packPngToThumbnail()` | `frontend/src/backend/pack-meta:132` | pack.png 字节 → data URL base64 缩略图（10MB 限额；空/超限 → ""，对齐 go 截断探测置空） |
| `parseShaderpackLang()` | `frontend/src/backend/pack-meta:142` | lang/en_US.lang 字节 → {name, entries} JSON 字符串（对齐 go ReadShaderpackLang： &gt;1MB → 空结果；key=val |
| `readDeclaredBackend()` | `frontend/src/backend/platform:13` | 读取入口 HTML 声明的适配器身份（'go' | 'browser'），未声明返回 undefined |
| `isWebEntryMode()` | `frontend/src/backend/platform:19` | Tier 1：旧 web 短路标记 / vite MODE=web 构建 |
| `resolveWebMode()` | `frontend/src/backend/platform:28` | 同步判定：当前是否应路由到 browser adapter（网页版） |
| `Events()` | `frontend/src/backend/runtime:21` | — |
| `Window()` | `frontend/src/backend/runtime:25` | — |
| `AppBindings()` | `frontend/src/backend/types:6` | Wails v3 生成的 App 绑定模块形状（bindings 目录下 app.ts） |
| `mapColor()` | `frontend/src/backend/voxel-colors:92` | 对齐 go/litematic/block_colors.go MapColor：方块注册名 → 近似十六进制颜色。 |
| `resolveBlockName()` | `frontend/src/backend/voxel-colors:107` | 对齐 go/litematic/block_ids.go ResolveBlockName：schematic v1 数字 ID → 注册名（优先 "id:data" 变体，回退 |
| `VoxelGroup()` | `frontend/src/backend/voxel-parse:36` | 输出形状（对齐 types.VoxelGroup / LitematicVoxelData json tag） |
| `VoxelData()` | `frontend/src/backend/voxel-parse:41` | — |
| `readVarInt()` | `frontend/src/backend/voxel-parse:60` | 对齐 voxel.go:531-549 readVarInt：返回 {value, offset}（shift≥64 截断防溢出 wrap） |
| `extractBits()` | `frontend/src/backend/voxel-parse:79` | 对齐 nbt.go:299-327 extractBits：从 LongArray（精确 bigint[]，小端位序）按 bitOffset 取 bitCount 位，支持跨 64 |
| `bitsPerEntry()` | `frontend/src/backend/voxel-parse:99` | 对齐 nbt.go:329-338 bitsPerEntry：palette 大小 → 每方块位数（≥2，单条目返回 0） |
| `unpackBlockStates()` | `frontend/src/backend/voxel-parse:111` | 打包位解码：expectedCount 个方块索引 → palette 索引数组。 |
| `litematicVoxelView()` | `frontend/src/backend/voxel-parse:325` | 对齐 voxel.go:92-171 BuildVoxelData：.litematic 体素视图。 |
| `nbtVoxelView()` | `frontend/src/backend/voxel-parse:402` | 对齐 voxel.go:286-382 BuildNbtVoxelData：structure NBT 体素视图。 |
| `schematicVoxelView()` | `frontend/src/backend/voxel-parse:570` | 对齐 voxel.go:384-491 BuildSchematicVoxelData：schematic 体素视图。 |
| `decodeVoxelNbt()` | `frontend/src/backend/voxel-parse:665` | 纯函数：base64 字节 → NBT root（IO 与解码解耦——本函数无任何 IO，输入 b64 字符串 输出解析后的 root 对象；readVoxelJson 等装配层只 |
| `webCliBindings()` | `frontend/src/backend/web-cli:34` | 网页版 CLI 绑定 |
| `WebUnsupportedError()` | `frontend/src/backend/web-common:8` | 网页版专属错误：binding 浏览器端未实现（Phase 3 能力门控隐藏对应 UI） |
| `WEB_ROOT()` | `frontend/src/backend/web-common:16` | 网页版虚拟仓库根（路径语义与桌面一致：/web/&lt;type&gt;/&lt;name&gt;/&lt;rel&gt;） |
| `isWebPath()` | `frontend/src/backend/web-common:27` | 校验是否为 /web/ 虚拟仓库路径（含 type 段与至少一个后续段） |
| `parseWebPath()` | `frontend/src/backend/web-common:32` | /web/&lt;type&gt;/&lt;rest&gt; → {type, rest}；非 /web/ 前缀或无 rest 返回 null |
| `parseWebDirPath()` | `frontend/src/backend/web-common:39` | 目录形态 /web/&lt;type&gt;/&lt;name&gt; → {type, name}（name 可含多段路径）；非 /web/ 前缀返回 null |
| `webDirType()` | `frontend/src/backend/web-common:46` | /web/ 之后的类型段（/web/ysm/xxx → "ysm"）；非 /web/ 前缀返回 null |
| `MAX_IMPORT_BYTES()` | `frontend/src/backend/web-common:52` | 导入大小上限 100MB（对齐 import-dnd.ts MAX_FILE_SIZE，桌面 oversize 过滤同口径） |
| `arrayBufferToBase64()` | `frontend/src/backend/web-common:55` | ArrayBuffer → base64（分块，大文件避免栈溢出） |
| `base64ToBytes()` | `frontend/src/backend/web-common:66` | base64 → Uint8Array（arrayBufferToBase64 逆操作；非法输入返回 null） |
| `webCommonBindings()` | `frontend/src/backend/web-common:88` | — |
| `webCommunityBindings()` | `frontend/src/backend/web-community:247` | — |
| `FsaAuthState()` | `frontend/src/backend/web-fs-auth:29` | FSA 授权状态（供 UI 启动引导，不触发权限弹窗） |
| `getFsaAuthState()` | `frontend/src/backend/web-fs-auth:61` | 查询根目录授权状态（不触发权限弹窗） |
| `reauthorizeFsaRoot()` | `frontend/src/backend/web-fs-auth:83` | 对持久化句柄重新请求授权（不重选目录）。须用户手势内调用，成功写入内存句柄返回 true |
| `rescanFsaRoot()` | `frontend/src/backend/web-fs-auth:101` | 启动自愈：恢复持久化句柄并重扫入库（R2 数据互通，参照 MikuMikuAR ScanModelDir） |
| `selectLocalRepo()` | `frontend/src/backend/web-fs-auth:138` | 网页版授权本地仓库目录：showDirectoryPicker → 递归扫主文件 → importWebFiles 落 IDB。 |
| `importWebFiles()` | `frontend/src/backend/web-fs-import:284` | 导入主流程：.7z 过滤 → ZIP 展平 → 粗分组 → 细分组 → 逐组 校验/写入/回滚。 |
| `dirKey()` | `frontend/src/backend/web-fs-shared:9` | — |
| `fileKey()` | `frontend/src/backend/web-fs-shared:10` | — |
| `MAIN_FILE_RANK_TYPE()` | `frontend/src/backend/web-fs-shared:20` | — |
| `MAIN_FILE_RANK_NONE()` | `frontend/src/backend/web-fs-shared:21` | — |
| `mainFileRank()` | `frontend/src/backend/web-fs-shared:36` | 主文件优先级打分（注册表驱动：YSM .ysm/.zip &gt; ysm.json &gt; 其他类型主文件 &gt; 辅助文件）。 |
| `importWebFiles()` | `frontend/src/backend/web-fs` | — |
| `getFsaAuthState()` | `frontend/src/backend/web-fs` | — |
| `reauthorizeFsaRoot()` | `frontend/src/backend/web-fs` | — |
| `rescanFsaRoot()` | `frontend/src/backend/web-fs` | — |
| `selectLocalRepo()` | `frontend/src/backend/web-fs` | — |
| `typeFromWebDir()` | `frontend/src/backend/web-fs:73` | 从 /web/&lt;type&gt;/... |
| `scanWebModels()` | `frontend/src/backend/web-fs:79` | — |
| `readWebFile()` | `frontend/src/backend/web-fs:138` | 读文件（/web/&lt;type&gt;/&lt;rest&gt; → IDB → base64；wasm.ts 解码链零改动复用） 模型组 name 与组内 rel 在 file key 中无缝拼接（ |
| `scanAllWebModels()` | `frontend/src/backend/web-fs:314` | 扫描全部资源类型的模型（供标签聚合 / 子目录映射等全库操作） |
| `WebModelStats()` | `frontend/src/backend/web-stats` | — |
| `STATS_BATCH_LIMIT()` | `frontend/src/backend/web-stats` | — |
| `onStatsProgress()` | `frontend/src/backend/web-stats:40` | 注册批量统计进度回调（done/total 为该批已处理模型数；传 null 注销） |
| `__setStatsRunnerForTest()` | `frontend/src/backend/web-stats:53` | 测试注入统计实现（替换 Worker 路径）。传 null 恢复 Worker 真实路径。 |
| `consumeWebSearchDegraded()` | `frontend/src/backend/web-stats:58` | 消费「最近一次批量统计是否降级」标记（读完复位，避免跨搜索串扰） |
| `terminateStatsWorker()` | `frontend/src/backend/web-stats:65` | 终止并回收整个 Worker 池（取消在途任务：调用方在超时/失败后使用；外部也可主动取消） |
| `getStatsPoolSize()` | `frontend/src/backend/web-stats:91` | 当前池大小（Worker 池并行线程数，供 UI 角标显示 🧵×N） |
| `prefetchStatsWorker()` | `frontend/src/backend/web-stats:113` | 预加载 stats.worker chunk（页面加载后后台静默下载，让首次搜索秒开）。 |
| `batchStatsWebModels()` | `frontend/src/backend/web-stats:173` | 批量统计模型（骨骼/立方体/纹理尺寸）。返回数组与输入 paths 一一对应； Worker 池不可用 / 任一片失败 / 超时 → 返回 null（整体降级）。 |
| `__resetWebLogStateForTest()` | `frontend/src/backend/web-store:117` | 测试钩子：重置日志环状态与 hydrated 标记（防模块级状态测试间污染） |
| `webStoreBindings()` | `frontend/src/backend/web-store:190` | — |
| `YsmHeaderShape()` | `frontend/src/backend/ysm-header:37` | YSMHeader（对齐 go/ysm/header.go:17 YSMHeader json tag） |
| `YsmSummaryShape()` | `frontend/src/backend/ysm-header:56` | YsmSummary（对齐 go/ysm/summary.go:48 YsmSummary json tag；animGroups/configMenus 一并平移） |
| `emptyYsmHeader()` | `frontend/src/backend/ysm-header:74` | 空 YSMHeader（对齐 Go YSMHeader{} JSON 形状：isYsm/isFree/hasFree/name 恒输出） |
| `emptyYsmSummary()` | `frontend/src/backend/ysm-header:79` | 最小空 YsmSummary（对齐 Go app 层失败返回 {schema, source} 的最小结构 + 消费方零值容错） |
| `parseYsmHeaderFromBytes()` | `frontend/src/backend/ysm-header:101` | 从字节解析 YSM 头部（对齐 AnalyzeYSMHeaderFromBytes + AnalyzeYSMHeader 的 YSGP 合并）： - 超 4096 字节截断（头部在 |
| `extractYsmSummaryFromBytes()` | `frontend/src/backend/ysm-header:328` | 从字节提取 YsmSummary（source 为原始文件名）。 |

## 前端·核心

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `DIR_HANDLERS()` | `frontend/src/core/context-menu-dir-handlers:10` | dir 类 handler 子表 |
| `FILE_HANDLERS()` | `frontend/src/core/context-menu-file-handlers:13` | file 类 handler 子表 |
| `MenuCtx()` | `frontend/src/core/context-menu-handlers:73` | — |
| `HANDLERS()` | `frontend/src/core/context-menu-handlers:76` | 行为 handler 表（instance + batch + merge file/dir） |
| `refreshUI()` | `frontend/src/core/context-menu-shared:15` | 通知树组件和统计面板刷新 |
| `toast()` | `frontend/src/core/context-menu-shared:21` | 显示 toast 通知 |
| `isUnsafeFolderName()` | `frontend/src/core/context-menu-shared:26` | 路径安全过滤：禁止逃逸段（. |
| `resolveDstDir()` | `frontend/src/core/context-menu-shared:38` | 解析「移动/复制到文件夹」的目标路径（batch.move / batch.copy / file.move / file.copy 共用）。 |
| `registerContextMenus()` | `frontend/src/core/context-menus:77` | 注册右键菜单映射（ctx:show → menu:show）；由 registerGlobalHandlers 统一调用，unsub 收集进 unsubs 清理 |
| `__TEST__resetDiary()` | `frontend/src/core/error-diary:29` | 仅测试用：重置注册状态使下次 registerErrorDiary 可重新注册。 |
| `registerErrorDiary()` | `frontend/src/core/error-diary:51` | 注册 UI 报错落日记功能。 |
| `registerAndroidEvents()` | `frontend/src/core/handlers/android-events:18` | 注册 Android 系统事件消费，push 取消订阅函数到 unsubs |
| `registerGlobalHandlers()` | `frontend/src/core/handlers/global:12` | 注册所有 core 全局 handler，返回 unsub 函数数组（features/views 层注册由 app-content 编排） |
| `registerInstanceOps()` | `frontend/src/core/handlers/instance-ops:12` | 注册整合包操作 handler，push 返回的取消订阅函数到 unsubs |
| `requireMcRoot()` | `frontend/src/core/handlers/require-mcroot:13` | 读取游戏根目录（mcRoot），空时发 warn toast 并返回 null。 |
| `registerSync()` | `frontend/src/core/handlers/sync:252` | 注册同步 handler，push 返回的取消订阅函数到 unsubs |
| `SUPPORTED_LANGS()` | `frontend/src/core/i18n/locale:11` | 支持的语言列表（规划清单） |
| `LangCode()` | `frontend/src/core/i18n/locale:17` | — |
| `warnedKeys()` | `frontend/src/core/i18n/locale:31` | 缺失 key 告警节流（每 key 只告警一次；跨模块共享给 t.ts 用，故不带 _ 私有前缀） |
| `loadLocale()` | `frontend/src/core/i18n/locale:40` | 加载指定语言的 JSON 包（幂等：已加载不重复 fetch）。 |
| `getBundle()` | `frontend/src/core/i18n/locale:60` | 获取指定语言的翻译包（已加载时直接读缓存，空包/未加载回落非空基准 zh-CN）。 |
| `getLang()` | `frontend/src/core/i18n/locale:74` | 读取当前语言代码 |
| `setLang()` | `frontend/src/core/i18n/locale:79` | 切换语言（异步加载语言包后触发事件） |
| `initI18n()` | `frontend/src/core/i18n/locale:127` | 启动时调用：读取持久化/系统语言 → 预加载语言包 → 同步 HTML 属性。 |
| `en()` | `frontend/src/core/i18n/locales/en:4` | — |
| `ja()` | `frontend/src/core/i18n/locales/ja:5` | — |
| `zhCN()` | `frontend/src/core/i18n/locales/zh-CN:6` | — |
| `t()` | `frontend/src/core/i18n/t:12` | 翻译函数。 |
| `MenuDef()` | `frontend/src/core/menu-defs:19` | 单类菜单的完整声明 |
| `MENU_DEFS()` | `frontend/src/core/menu-defs:25` | 四类右键菜单的声明式规格（唯一事实来源） |
| `getMenuDef()` | `frontend/src/core/menu-defs:113` | 测试辅助：按 type 取声明（不存在返回 undefined） |
| `sanitizePage()` | `frontend/src/core/page-store:30` | — |
| `PAGE_WHITELIST()` | `frontend/src/core/page-store:28` | — |
| `resolveInitialPage()` | `frontend/src/core/page-store:40` | — |
| `PageStore()` | `frontend/src/core/page-store:54` | — |
| `registerPageStore()` | `frontend/src/core/page-store:61` | 注册页面状态同步（由 registerGlobalHandlers 统一调用，bus.on 的 unsub 收集进 unsubs 清理） |

## 前端·特性

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `showProgress()` | `frontend/src/features/community/data:9` | 创建进度条 UI（插入到 searchResults 容器） |
| `FetchModelsResult()` | `frontend/src/features/community/data:42` | 抓取结果 |
| `isRecyclePath()` | `frontend/src/features/community/data:56` | 判断仓库相对路径是否含回收站目录段 `.recycle`（大小写不敏感，对齐 Go fsutil.IsRecycleDir， EqualFold 语义：.RECYCLE/.Recy |
| `tryFetchModels()` | `frontend/src/features/community/data:242` | 从 GitHub 获取 index.json（并发竞速：同时请求所有镜像源，取最快响应） |
| `ProgressGuardHooks()` | `frontend/src/features/community/download-queue-progress:16` | createProgressGuard 依赖注入（controller 提供查找与收口回调） |
| `ProgressGuard()` | `frontend/src/features/community/download-queue-progress:24` | 进度条守卫控制器 |
| `createProgressGuard()` | `frontend/src/features/community/download-queue-progress:267` | — |
| `DownloadTask()` | `frontend/src/features/community/download-queue-store:27` | 下载任务 |
| `QueueError()` | `frontend/src/features/community/download-queue-store:35` | 队列错误项 |
| `DownloadState()` | `frontend/src/features/community/download-queue-store:41` | 队列状态快照 |
| `STATE()` | `frontend/src/features/community/download-queue-store:53` | 模块级共享状态（progress guard / UI 控制器 import 协作，不对外 re-export） |
| `subscribe()` | `frontend/src/features/community/download-queue-store:75` | 订阅 STATE 变更。返回取消订阅函数。 |
| `notify()` | `frontend/src/features/community/download-queue-store:83` | 广播 STATE 变更（UI 控制器 enqueue 失败回滚等场景也经此通知） |
| `getState()` | `frontend/src/features/community/download-queue-store:88` | 当前状态的只读快照 |
| `resume()` | `frontend/src/features/community/download-queue-store:97` | 页面切回时调用，从 Go 端恢复当前队列状态。 |
| `isActiveStatus()` | `frontend/src/features/community/download-queue-store:136` | 队列是否处于活跃下载中（downloading 或 enqueued）。 |
| `enqueueDownloads()` | `frontend/src/features/community/download-queue-store:144` | 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。 |
| `cancelDownloads()` | `frontend/src/features/community/download-queue-store:200` | 模块级取消 — 纯粹的 Go 调用。 |
| `subscribe()` | `frontend/src/features/community/download-queue` | — |
| `getState()` | `frontend/src/features/community/download-queue` | — |
| `resume()` | `frontend/src/features/community/download-queue` | — |
| `enqueueDownloads()` | `frontend/src/features/community/download-queue` | — |
| `cancelDownloads()` | `frontend/src/features/community/download-queue` | — |
| `DownloadTask()` | `frontend/src/features/community/download-queue` | — |
| `DownloadState()` | `frontend/src/features/community/download-queue` | — |
| `QueueError()` | `frontend/src/features/community/download-queue` | — |
| `QueueControllerOptions()` | `frontend/src/features/community/download-queue:44` | createDownloadQueue 选项 |
| `QueueController()` | `frontend/src/features/community/download-queue:53` | 队列控制器 |
| `DownloadQueue()` | `frontend/src/features/community/download-queue:61` | 旧契约别名（events.ts / download-tasks.ts 仍使用 DownloadQueue 命名） |
| `createDownloadQueue()` | `frontend/src/features/community/download-queue:326` | 创建一个下载队列 UI 控制器。 |
| `DOWNLOAD_CONFIRM_BYTES()` | `frontend/src/features/community/download-tasks:7` | 超过该大小需弹窗确认（含边界值本身直接下载） |
| `DOWNLOAD_REJECT_BYTES()` | `frontend/src/features/community/download-tasks:9` | 超过该大小直接拒绝（含边界值本身需确认） |
| `DownloadSizeDecision()` | `frontend/src/features/community/download-tasks:11` | — |
| `classifyDownloadSize()` | `frontend/src/features/community/download-tasks:14` | 下载大小策略：≤4MB 直接下；4–10MB 需确认；&gt;10MB 拒绝 |
| `DownloadCandidate()` | `frontend/src/features/community/download-tasks:24` | 下载候选（结构类型，兼容 WorkshopModel） |
| `buildDownloadTasks()` | `frontend/src/features/community/download-tasks:31` | 选中集 → 下载任务列表（路径统一转正斜杠；未匹配的选中项静默跳过） |
| `RepoEventsContext()` | `frontend/src/features/community/events:17` | bindRepoEvents 上下文 |
| `RepoEventsHandle()` | `frontend/src/features/community/events:29` | 绑定返回值 |
| `bindRepoEvents()` | `frontend/src/features/community/events:340` | 绑定仓库模型页面的所有事件。 |
| `WorkshopModel()` | `frontend/src/features/community/render:10` | 工坊模型条目（index.json 结构） |
| `WorkshopSite()` | `frontend/src/features/community/render:18` | 工坊站点 |
| `isModelMissing()` | `frontend/src/features/community/render:28` | 判断模型是否缺失（本地不存在） |
| `countMissing()` | `frontend/src/features/community/render:44` | 计算缺失数量 |
| `filterModels()` | `frontend/src/features/community/render:55` | 过滤模型列表：关键词匹配（模型名）+ 「仅显示缺失」开关。 |
| `ModelRowCtx()` | `frontend/src/features/community/render:91` | 单行构建上下文（renderModelList / buildModelRow 共用） |
| `buildModelRow()` | `frontend/src/features/community/render:100` | 构建单行模型行（虚拟列表 renderItem 用） |
| `renderModelList()` | `frontend/src/features/community/render:176` | 渲染模型列表（DocumentFragment） |
| `SITE_GROUP_ORDER()` | `frontend/src/features/community/render:210` | 站点分组展示顺序（renderCardsHTML 使用） |
| `groupSites()` | `frontend/src/features/community/render:215` | 按 group 分组站点（缺省 browse）。纯函数，供单测覆盖（ADR-023 L3）。 |
| `renderCardsHTML()` | `frontend/src/features/community/render:232` | 生成左栏站点卡片 HTML |
| `renderRepoHeaderHTML()` | `frontend/src/features/community/render:282` | 生成仓库模型页面的头部 HTML（含返回按钮、计数、筛选按钮等） |
| `showRepoModels()` | `frontend/src/features/community/show-repo-models:27` | 显示 GitHub 仓库模型列表（比对本地已有文件） 包含：本地扫描、sourceLabel构建、countMissing、renderRepoHeaderHTML、bindRep |
| `VirtualListOpts()` | `frontend/src/features/community/virtual-list:8` | — |
| `VirtualList()` | `frontend/src/features/community/virtual-list:21` | — |
| `createVirtualList()` | `frontend/src/features/community/virtual-list:31` | — |
| `CollectedFile()` | `frontend/src/features/dnd-collector:6` | 收集结果条目 |
| `collectFiles()` | `frontend/src/features/dnd-collector:35` | 递归收集 DataTransferItem[] 或 FileSystemEntry[] 中的文件。 |
| `getExt()` | `frontend/src/features/dnd-shared:4` | — |
| `isSupportedFile()` | `frontend/src/features/dnd-shared:8` | 扩展名是否在支持列表 |
| `isImportableFile()` | `frontend/src/features/dnd-shared:14` | 是否可作为独立文件导入：.json 仅放行 ysm.json 入口清单 包内 geometry/animation/语言 json（main.json / *.animation. |
| `shouldEnterForm()` | `frontend/src/features/dnd-shared:22` | 判断文件是否需要进入命名表单 2026-08-05：导入默认直接（保留原文件名，后端自动路由类型/冲突覆盖确认）， 不再强制命名表单；ysm.json 单文件保留表单提示（整组导入 |
| `CollectedEntry()` | `frontend/src/features/dnd-shared:33` | 收集条目（文件 + 相对路径） |
| `FolderGroup()` | `frontend/src/features/dnd-shared:39` | 文件夹组：dir 为顶层目录名（可能含多级嵌套，组内文件保留完整 relPath） |
| `groupCollected()` | `frontend/src/features/dnd-shared:51` | 将收集到的条目分组： - 有目录前缀的条目 → 按「顶层目录」整组（dir = 第一段路径），组内保留完整 relPath（支持多层嵌套） - 无目录前缀的散落文件 → 单文件队列 |
| `handleTreeDrop()` | `frontend/src/features/import-dnd:36` | 处理 drop 事件：收集文件 → 过滤 → 执行导入。 |
| `bindTreeDnD()` | `frontend/src/features/import-dnd:152` | 在目标容器上注册仓库页 DnD 事件。 |
| `CollectedEntry()` | `frontend/src/features/import-executor` | — |
| `isImportableFile()` | `frontend/src/features/import-executor` | — |
| `ImportFile()` | `frontend/src/features/import-executor:19` | 带相对路径的 File（文件夹导入时标记 _relPath） |
| `directImport()` | `frontend/src/features/import-executor:60` | 单文件直接导入（保留原文件名，后端自动路由类型 + 冲突覆盖确认） |
| `importFolder()` | `frontend/src/features/import-executor:97` | 文件夹整组导入（含 ysm.json 模型目录或普通文件夹；组内至少 1 个支持文件由调用方保证） rtype：页面上下文类型（当前树根属性，派生自注册表路由配置）——非空走 Im |
| `executeCollected()` | `frontend/src/features/import-executor:178` | 执行一组拖拽收集的条目（静默导入入口）： 文件夹 → 整组（组内至少 1 个支持文件）；散落单文件 → 直导。 |
| `importWebFilesWithToast()` | `frontend/src/features/import-executor:203` | 网页版导入执行（ADR-049 Phase 3）：拖入/选择文件 → importWebFiles 直写 IndexedDB → toast 反馈 → tree/stats 刷新。 |
| `loadOldestModel()` | `frontend/src/features/oldest-models:290` | — |
| `RecycleHost()` | `frontend/src/features/recycle-bin:23` | — |
| `isPathInRoot()` | `frontend/src/features/recycle-bin:33` | — |
| `initRecycleBin()` | `frontend/src/features/recycle-bin:235` | — |
| `currentRepoType()` | `frontend/src/features/repo-rtype:18` | 读取当前仓库资源类型（时刻值）。 |
| `useCurrentResourceType()` | `frontend/src/features/repo-rtype:28` | 订阅当前仓库资源类型。 |
| `UpdateInfo()` | `frontend/src/features/version-updater:14` | 更新信息（CheckUpdate 返回） |
| `checkUpdateSilent()` | `frontend/src/features/version-updater:170` | 启动时静默检查更新（受 6h 频次限制） 有新版本则在右下角显示可点击的 toast 通知 |
| `initVersionUpdater()` | `frontend/src/features/version-updater:209` | 手动检查更新（设置页按钮） |

## 前端·服务

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `CLIArgs()` | `frontend/src/services/cli-bridge:13` | CLI 命令参数（统一格式：key-value map） |
| `CLIResponse()` | `frontend/src/services/cli-bridge:35` | CLI 统一响应 |
| `ALLOWED_CLI_COMMANDS()` | `frontend/src/services/cli-bridge:45` | 允许的 CLI 命令默认白名单（网页版降级 + 首次加载缓存用） |
| `resetDynamicCommandsCache()` | `frontend/src/services/cli-bridge:73` | 重置动态白名单缓存（供测试使用） |
| `executeCLI()` | `frontend/src/services/cli-bridge:120` | 执行 CLI 命令（核心入口） |
| `getAllowedCLICommands()` | `frontend/src/services/cli-bridge:169` | 获取允许的 CLI 命令列表（优先使用动态缓存） |
| `cliSearch()` | `frontend/src/services/cli-bridge:184` | 搜索模型 |
| `cliList()` | `frontend/src/services/cli-bridge:193` | 列出所有模型 |
| `cliAnalyze()` | `frontend/src/services/cli-bridge:198` | 分析模型 |
| `cliCacheStatus()` | `frontend/src/services/cli-bridge:203` | 缓存状态查询 |
| `buildArgsMap()` | `frontend/src/services/cli-bridge:210` | 构建参数 map（过滤 undefined 和 null） |
| `parseCLIResponse()` | `frontend/src/services/cli-bridge:221` | 解析 CLI JSON 响应 |
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
| `fireDrop()` | `frontend/src/test-utils/events:55` | 模拟拖拽 drop：构造 DragEvent 并注入 dataTransfer（happy-dom 忽略 DragEvent init 参数，需 defineProperty） |
| `fireDrag()` | `frontend/src/test-utils/events:67` | 模拟任意类型拖拽事件（dragstart/dragover/dragleave…），与 fireDrop 同款 dataTransfer 注入 |
| `queryByTestId()` | `frontend/src/test-utils/index` | — |
| `getByTestId()` | `frontend/src/test-utils/index` | — |
| `queryAllByTestId()` | `frontend/src/test-utils/index` | — |
| `getAllByTestId()` | `frontend/src/test-utils/index` | — |
| `expectContainsAtLeast()` | `frontend/src/test-utils/index` | — |
| `expectNotContains()` | `frontend/src/test-utils/index` | — |
| `deriveTestIds()` | `frontend/src/test-utils/index` | — |
| `extractIds()` | `frontend/src/test-utils/index` | — |
| `mountCustomElement()` | `frontend/src/test-utils/index:30` | 同步渲染自定义元素到 body，返回已创建元素。 |
| `unmountElement()` | `frontend/src/test-utils/index:42` | 卸载元素：从 DOM 移除。 |
| `sleep()` | `frontend/src/test-utils/index:49` | 简单睡眠（测试中等待异步渲染）。 |
| `flushPromises()` | `frontend/src/test-utils/index:63` | 刷新微任务队列——让 async 函数链路的全部 await 解包。 |
| `waitFor()` | `frontend/src/test-utils/index:72` | 轮询等待条件满足（兼容现有测试风格，作为统一导出）。 |
| `waitForElementToBeRemoved()` | `frontend/src/test-utils/index:101` | 轮询等待元素被移除。 |
| `QueryContainer()` | `frontend/src/test-utils/query-by-testid:11` | — |
| `queryByTestId()` | `frontend/src/test-utils/query-by-testid:30` | — |
| `getByTestId()` | `frontend/src/test-utils/query-by-testid:39` | — |
| `getAllByTestId()` | `frontend/src/test-utils/query-by-testid:48` | — |
| `queryAllByTestId()` | `frontend/src/test-utils/query-by-testid:57` | — |
| `RenderOptions()` | `frontend/src/test-utils/render:6` | 渲染配置 |
| `RenderResult()` | `frontend/src/test-utils/render:13` | — |
| `renderComponent()` | `frontend/src/test-utils/render:31` | 渲染一个自定义元素到 DOM。 |
| `MenuDefLike()` | `frontend/src/test-utils/self-healing:8` | 形如菜单项的定义（至少有 id；可选 dockGroup） |
| `expectContainsAtLeast()` | `frontend/src/test-utils/self-healing:17` | 自愈断言：actual 至少包含 required（允许额外项）。 |
| `expectNotContains()` | `frontend/src/test-utils/self-healing:36` | 反向自愈断言：actual 不包含 forbidden。 |
| `deriveTestIds()` | `frontend/src/test-utils/self-healing:49` | 从菜单项推导 data-testid 选择器（`preview-${id}`）。 |
| `extractIds()` | `frontend/src/test-utils/self-healing:57` | 从菜单项列表提取 id 数组（已排序）。 |

## frontend/ui

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `ControlUpdater()` | `frontend/src/ui/control-registry:9` | — |
| `setControlRegistry()` | `frontend/src/ui/control-registry:20` | 接入外部控件更新系统。传入 null 可取消接入（内部注册表不受影响）。 |
| `registerControl()` | `frontend/src/ui/control-registry:29` | 注册一个控件更新回调（需唯一 id）。 |
| `getControl()` | `frontend/src/ui/control-registry:35` | 按 id 获取已注册的更新回调，未注册返回 undefined。 |
| `unregisterControl()` | `frontend/src/ui/control-registry:40` | 按 id 移除已注册的更新回调，成功返回 true，未命中返回 false（重复 unregister 不抛错）。 |
| `clearControls()` | `frontend/src/ui/control-registry:53` | 清空所有已注册的控件。不取消外部系统接入。 |
| `getControlCount()` | `frontend/src/ui/control-registry:58` | 当前已注册控件数量。 |
| `ROLE()` | `frontend/src/ui/dom-contract:6` | 渲染层 role 常量 |
| `ARIA_ATTR()` | `frontend/src/ui/dom-contract:17` | aria 属性名常量 |
| `COLLAPSIBLE()` | `frontend/src/ui/dom-contract:29` | collapsible（folder）组件契约 |
| `SLIDER_BAR_CLASS()` | `frontend/src/ui/dom-contract:37` | 滑动条本体 class（slider / colorSlider / modeSlider 共用 .cs-bar） |
| `createIcon()` | `frontend/src/ui/icons:10` | 创建一个图标元素（可能返回 null，调用方应走兜底层）。 |
| `addColorSliderRow()` | `frontend/src/ui/ui-advanced-rows:37` | — |
| `addVector3SliderRow()` | `frontend/src/ui/ui-advanced-rows:209` | — |
| `addModeSlider()` | `frontend/src/ui/ui-advanced-rows:406` | — |
| `cardContainer()` | `frontend/src/ui/ui-card:10` | Card container helper: removes render-card bg, wraps content in an lcard. |
| `addCollapsible()` | `frontend/src/ui/ui-collapsible:24` | 通用折叠面板组件 |
| `addSectionTitle()` | `frontend/src/ui/ui-collapsible:137` | 区块标题（section-title），用于 cardContainer 内的视觉分组。 |
| `addPresetChip()` | `frontend/src/ui/ui-collapsible:162` | 创建一个 preset-chip 按钮并追加到 container（通常是 .preset-group div）。 |
| `uiComponentsCss()` | `frontend/src/ui/ui-components-styles:7` | — |
| `uiComponentsStyleSheet()` | `frontend/src/ui/ui-components-styles:21` | — |
| `installUiComponentsStyles()` | `frontend/src/ui/ui-components-styles:25` | 将组件样式注入 document.head（全局/light-DOM 场景）。幂等，仅注入一次。 |
| `SLIDER_QUARTER_LARGE_STEP()` | `frontend/src/ui/ui-constants:6` | 左区大幅减步进：全范围 15% |
| `SLIDER_QUARTER_SMALL_STEP()` | `frontend/src/ui/ui-constants:8` | 中左/中右微调步进：全范围 5% |
| `HeaderToggleConfig()` | `frontend/src/ui/ui-header-toggle:82` | — |
| `createHeaderToggle()` | `frontend/src/ui/ui-header-toggle:100` | 创建标题栏小型开关。返回 `&lt;label class="toggle header-toggle"&gt;`， 含双触发去重（跳过 target===input 的 synthetic |
| `cardContainer()` | `frontend/src/ui/ui-helpers` | — |
| `addFieldRow()` | `frontend/src/ui/ui-helpers` | — |
| `createSlideMenu()` | `frontend/src/ui/ui-helpers` | — |
| `withLoadingIndicator()` | `frontend/src/ui/ui-loading:10` | — |
| `PresetChipItem()` | `frontend/src/ui/ui-preset:16` | 单个预设芯片的描述。 |
| `buildPresetChipGroup()` | `frontend/src/ui/ui-preset:35` | 渲染一组 preset-chip（统一 .preset-group 容器 + addPresetChip 布局）。 |
| `addClearRow()` | `frontend/src/ui/ui-preset:73` | 渲染一行右对齐的「清除」按钮（统一 cs-btn cs-btn-sm 样式）。 |
| `addToggleRow()` | `frontend/src/ui/ui-rows:147` | — |
| `initControl()` | `frontend/src/ui/ui-rows:184` | 封装 registerControl + immediate update 模式。 |
| `addSliderRow()` | `frontend/src/ui/ui-rows:401` | 数字滑块行。内部统一由 {@link DragSliderController} 驱动 （拖拽 + 键盘 + 游标点击），行为与其他滑块 builder 保持一致。 |
| `addModeRow()` | `frontend/src/ui/ui-rows:445` | — |
| `addEmptyRow()` | `frontend/src/ui/ui-rows:480` | 创建空状态占位行（灰色文字，不可点击），替代手动 `el.style.opacity = '0.5'` 模式 |
| `addCardTitle()` | `frontend/src/ui/ui-rows:503` | 创建 card-title 标题行并追加到容器 |
| `addDangerRow()` | `frontend/src/ui/ui-rows:518` | 创建危险操作行（icon + red label），替代手动拼接 `div.slide-item &gt; icon + label.danger-text` |
| `addFieldRow()` | `frontend/src/ui/ui-rows:550` | 创建字段行（左 label + 右 value），替代手动拼接的 `div.slide-item &gt; span.slide-label.field-label + span.fie |
| `addInfoGrid()` | `frontend/src/ui/ui-rows:583` | — |
| `addInfoCard()` | `frontend/src/ui/ui-rows:590` | — |
| `sliderRow()` | `frontend/src/ui/ui-rows:623` | — |
| `toggleRow()` | `frontend/src/ui/ui-rows:640` | — |
| `addWatchDirRow()` | `frontend/src/ui/ui-rows:665` | — |
| `addActionRow()` | `frontend/src/ui/ui-rows:727` | 创建一个可点击的动作按钮行（替代手写 cs-row + button）。 |
| `addDisabledRow()` | `frontend/src/ui/ui-rows:764` | 创建一个不可交互的提示行（替代手写 cs-row + opacity 0.4 + pointer-events none）。 |
| `addInlineToggleRow()` | `frontend/src/ui/ui-rows:795` | 创建一个内联 toggle 行（替代手写 toggle-row + toggle-label + toggle-switch）。 |
| `slideMenuCss()` | `frontend/src/ui/ui-slide-menu-styles:9` | — |
| `slideMenuStyleSheet()` | `frontend/src/ui/ui-slide-menu-styles:165` | — |
| `installSlideMenuStyles()` | `frontend/src/ui/ui-slide-menu-styles:169` | 将外壳样式注入 document.head（全局/light-DOM 场景）。幂等，仅注入一次。 |
| `SlideMenuView()` | `frontend/src/ui/ui-slide-menu:19` | 单个菜单视图：标题 + 把内容渲染进给定的 list 容器。 |
| `SlideMenuHandle()` | `frontend/src/ui/ui-slide-menu:26` | — |
| `createSlideMenu()` | `frontend/src/ui/ui-slide-menu:54` | 构建 slide-menu 卡片外壳（含轻量导航栈）。 |
| `HeaderToggleConfig()` | `frontend/src/ui/ui-slide-row` | — |
| `TrailingAction()` | `frontend/src/ui/ui-slide-row:12` | — |
| `createTrailingBtn()` | `frontend/src/ui/ui-slide-row:55` | 统一尾部第二动作按钮工厂——供 slideRow 与 menu.ts createRow 共用， 确保两条渲染路径的第二按钮观感与行为一致（22px .slide-add-btn； |
| `createLeadingBtn()` | `frontend/src/ui/ui-slide-row:64` | 统一左侧行为区按钮工厂——镜像 createTrailingBtn，但渲染为 21px 透明可点击 `.slide-lead-btn`（复用 .slide-icon 尺寸，非 22 |
| `SlideRowExtra()` | `frontend/src/ui/ui-slide-row:68` | — |
| `slideRow()` | `frontend/src/ui/ui-slide-row:97` | — |
| `DragSliderOptions()` | `frontend/src/ui/ui-slider-controller:9` | — |
| `DragSliderController()` | `frontend/src/ui/ui-slider-controller:24` | — |
| `ControlOptions()` | `frontend/src/ui/ui-types:2` | 控件通用选项：支持 bind 自动更新或 onUpdate 手动更新 |

## 前端·工具

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `CameraControlBridge()` | `frontend/src/utils/3d/adapters/camera-controls:13` | 相机控制桥：shared/self 双模式统一构建旋转/速度/重置控件的回调集合（方案 A：消灭 ysm-adapter 双份实现） |
| `buildCameraControls()` | `frontend/src/utils/3d/adapters/camera-controls:31` | 在根菜单 camera 面板内追加通用相机控件（旋转模式 / 速度滑条 / 重置视角），shared/self 双模式复用 |
| `CleanupContext()` | `frontend/src/utils/3d/adapters/cleanup-3d:40` | — |
| `runFullCleanup()` | `frontend/src/utils/3d/adapters/cleanup-3d:79` | — |
| `FbxDataPort()` | `frontend/src/utils/3d/adapters/fbx-adapter:24` | FBX 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） |
| `FBX_TARGET_MAX_DIM()` | `frontend/src/utils/3d/adapters/fbx-adapter:31` | FBX 归一化目标：包围盒最长边（单位）。对齐 MMD 厘米惯例（1.6m 人体 ≈ 160）， 与场景能力雾距（50-800，厘米尺度）及 MMD 同框尺度一致；cm/m 导出差 |
| `FbxScaleInfo()` | `frontend/src/utils/3d/adapters/fbx-adapter:34` | Box3 尺度归一结果（factor 供诊断日志回显，size/center 为缩放后坐标） |
| `normalizeFbxScale()` | `frontend/src/utils/3d/adapters/fbx-adapter:50` | Box3 尺度归一（ADR-112 P1）：DCC 导出单位混乱（cm/m/Unity units 可差 100×）时， 模型要么小到穿近平面看不见、要么顶天立地顶爆场景能力。均匀 |
| `buildFbxScene()` | `frontend/src/utils/3d/adapters/fbx-adapter:163` | 构建 FBX 内容场景（ADR-112 地基）。 |
| `FbxParser()` | `frontend/src/utils/3d/adapters/fbx-parser:18` | FBX 解析器管理器（接口对齐 PmxParser） |
| `createFbxParser()` | `frontend/src/utils/3d/adapters/fbx-parser:27` | 创建 FBX 解析器（Worker）。测试/受限环境无 Worker → always-fail 降级守卫， 调用方（fbx-adapter）会 fallback 到主线程 FBX |
| `FbxSceneBuilderConfig()` | `frontend/src/utils/3d/adapters/fbx-parser:44` | 场景重建配置 |
| `buildFbxSceneFromData()` | `frontend/src/utils/3d/adapters/fbx-parser:214` | 从 worker 产出的纯数据重建 Three.js 场景（FBX worker 路径的主线程构建器） 按 nodes 层级还原：非 mesh 节点建 Group、mesh 节点建 |
| `FbxParseRequest()` | `frontend/src/utils/3d/adapters/fbx-parser.worker:17` | 主线程 → Worker 请求 |
| `FbxParseResponse()` | `frontend/src/utils/3d/adapters/fbx-parser.worker:23` | Worker → 主线程响应 |
| `FbxGeometryData()` | `frontend/src/utils/3d/adapters/fbx-scene-to-data:16` | — |
| `FbxMaterialData()` | `frontend/src/utils/3d/adapters/fbx-scene-to-data:29` | — |
| `FbxSkeletonData()` | `frontend/src/utils/3d/adapters/fbx-scene-to-data:45` | — |
| `FbxMeshData()` | `frontend/src/utils/3d/adapters/fbx-scene-to-data:56` | — |
| `FbxSceneData()` | `frontend/src/utils/3d/adapters/fbx-scene-to-data:88` | — |
| `captureTextureName()` | `frontend/src/utils/3d/adapters/fbx-scene-to-data:102` | — |
| `fbxSceneToData()` | `frontend/src/utils/3d/adapters/fbx-scene-to-data:209` | — |
| `InputOptions()` | `frontend/src/utils/3d/adapters/input-and-animation:15` | 输入绑定所需的最小依赖集（原 mount3D 内嵌状态） |
| `InputHandlers()` | `frontend/src/utils/3d/adapters/input-and-animation:29` | 输入事件 handler 集合（供 fullCleanup 解绑用） |
| `bindInputHandlers()` | `frontend/src/utils/3d/adapters/input-and-animation:46` | 创建并绑定所有 3D 预览输入事件：WASD 键盘 + 拖拽自转 + resize。 |
| `buildLitematicScene()` | `frontend/src/utils/3d/adapters/litematic-adapter:415` | Litematic 内容构建：把体素网格挂入核心 scene，返回 dispose + 分层控件钩子。 |
| `litematicMenuItems()` | `frontend/src/utils/3d/adapters/litematic-adapter:458` | 构造 litematic 专属菜单项： 分层切片调节（axis/layer 控件）作为 🧍 模型组的一个面板项， 点击后弹出面板，内含轴选择 + 分层模式 + 滑块控件。 |
| `MmdDataPort()` | `frontend/src/utils/3d/adapters/mmd-adapter:62` | MMD 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） |
| `MmdPanelHooks()` | `frontend/src/utils/3d/adapters/mmd-adapter:172` | 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） |
| `buildMmdScene()` | `frontend/src/utils/3d/adapters/mmd-adapter:1135` | — |
| `MmdMenuItemsOpts()` | `frontend/src/utils/3d/adapters/mmd-adapter:1208` | mmdMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 |
| `mmdMenuItems()` | `frontend/src/utils/3d/adapters/mmd-adapter:1240` | MMD 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 材质 / 播放（+ 条件 bones）。 |
| `getCustomAnimPath()` | `frontend/src/utils/3d/adapters/mmd-anim-library:12` | 获取 MMD 动作库（CustomAnim）的绝对路径。 |
| `filterAnimFiles()` | `frontend/src/utils/3d/adapters/mmd-anim-library:24` | 从文件列表中筛选动作文件（.vmd / .vpd） |
| `BasisEncoderLike()` | `frontend/src/utils/3d/adapters/mmd-ktx2-basis:13` | BasisEncoder 实例的最小接口（embind 运行时提供） |
| `BasisModuleLike()` | `frontend/src/utils/3d/adapters/mmd-ktx2-basis:29` | 初始化后的 basis 模块（含 BasisEncoder 构造器） |
| `MAX_KTX2_PIXELS()` | `frontend/src/utils/3d/adapters/mmd-ktx2-basis:65` | 单纹理像素上限：超过则跳过 KTX2 编码。 |
| `TextureTooLargeError()` | `frontend/src/utils/3d/adapters/mmd-ktx2-basis:68` | 超大纹理跳过编码的标记错误（encodeAndCacheTexture 据此记 warn 而非 fail） |
| `encodeToKTX2Basis()` | `frontend/src/utils/3d/adapters/mmd-ktx2-basis:81` | 将 RGBA ImageData 编码为 KTX2（Basis Universal ETC1S）。 |
| `cancelPendingEncodings()` | `frontend/src/utils/3d/adapters/mmd-ktx2-encoder:71` | 取消所有待执行的编码（已在执行的不受影响） |
| `resetEncoderState()` | `frontend/src/utils/3d/adapters/mmd-ktx2-encoder:83` | 重置编码器状态（测试用） |
| `__setEncodeImplForTest()` | `frontend/src/utils/3d/adapters/mmd-ktx2-encoder:228` | 测试用：注入编码实现（默认走本地 WASM） |
| `encodeAndCacheTexture()` | `frontend/src/utils/3d/adapters/mmd-ktx2-encoder:239` | 将单个 PNG 纹理编码为 KTX2 并缓存。 |
| `scheduleBackgroundEncoding()` | `frontend/src/utils/3d/adapters/mmd-ktx2-encoder:289` | 遍历 mesh 材质，对有 KTX2 缓存需要的纹理进行后台编码。 |
| `Ktx2TextureLoaderDeps()` | `frontend/src/utils/3d/adapters/mmd-ktx2-texture-loader:21` | 拦截 loader 依赖注入（装配方提供） |
| `Ktx2TextureLoader()` | `frontend/src/utils/3d/adapters/mmd-ktx2-texture-loader:61` | — |
| `Ktx2EncodeRequest()` | `frontend/src/utils/3d/adapters/mmd-ktx2-worker:9` | 主线程 → Worker 的请求 |
| `Ktx2EncodeResponse()` | `frontend/src/utils/3d/adapters/mmd-ktx2-worker:17` | Worker → 主线程的响应 |
| `pmxObjectToResponse()` | `frontend/src/utils/3d/adapters/mmd-pmx-convert:194` | 权威 PmxObject → PmxParseResponse（压缩数组可 transferable；id 由调用方填入） |
| `PmxBuilderConfig()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser:29` | Builder 配置 |
| `PmxBuildResult()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser:37` | Builder 产出 |
| `PmxParser()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser:46` | PMX 解析器管理器 |
| `createPmxParser()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser:54` | 创建 PMX 解析器（Worker） |
| `buildPmxScene()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser:76` | 从 Worker 解析结果构建 Three.js 场景对象。 |
| `buildPmxSceneSliced()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser:209` | 异步切片版 buildPmxScene：将重负载同步构建拆成 rAF 帧片段。 |
| `PmxParseRequest()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:17` | 主线程 → Worker 请求 |
| `PmxVertexData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:23` | 顶点数据（交织存储，GPU 友好） |
| `PmxFaceData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:33` | 面数据 |
| `PmxMaterialData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:39` | 材质数据 |
| `PmxBoneData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:56` | 骨骼数据（字段对齐 @moeru/three-mmd PmxObject.Bone） |
| `PmxMorphData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:71` | Morph 数据 |
| `PmxParseResponse()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:78` | Worker → 主线程响应 |
| `PmxRigidBodyData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:98` | — |
| `PmxJointData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:115` | — |
| `PmxDisplayFrameData()` | `frontend/src/utils/3d/adapters/mmd-pmx-parser.worker:130` | — |
| `TexDecodeRequest()` | `frontend/src/utils/3d/adapters/mmd-texture-decode.worker:9` | 主线程 → Worker 的请求 |
| `TexDecodeResponse()` | `frontend/src/utils/3d/adapters/mmd-texture-decode.worker:17` | Worker → 主线程的响应 |
| `TexDecodeConfig()` | `frontend/src/utils/3d/adapters/mmd-texture-decoder:15` | 解码器配置 |
| `DecodedTexture()` | `frontend/src/utils/3d/adapters/mmd-texture-decoder:23` | 解码结果条目 |
| `TextureDecoder()` | `frontend/src/utils/3d/adapters/mmd-texture-decoder:40` | 解码管理器：创建 Worker 池、分发任务、收集结果。 |
| `getTextureDecoder()` | `frontend/src/utils/3d/adapters/mmd-texture-decoder:149` | 获取共享解码器（懒创建） |
| `applyWorkerDecodedTextures()` | `frontend/src/utils/3d/adapters/mmd-texture-decoder:169` | 将 Worker 解码的 ImageBitmap 应用到 MMD 模型的材质纹理： 1. |
| `bytesToBase64()` | `frontend/src/utils/3d/adapters/mmd-zip-overlay` | — |
| `MmdZipConfig()` | `frontend/src/utils/3d/adapters/mmd-zip-overlay:20` | ZIP 解析产物（传给 overlay 的配置） |
| `resolveMmdZipConfig()` | `frontend/src/utils/3d/adapters/mmd-zip-overlay:39` | 解压 zip + 找 .pmx/.pmd 模型 → 返回 MmdZipConfig。 |
| `makeZipOverlayPort()` | `frontend/src/utils/3d/adapters/mmd-zip-overlay:113` | 创建 ZIP Overlay Port：包装 MmdDataPort， 将 zip 内路径前缀（如 "/repo/miku.zip!/"）路由到内存中的 zip entries。 |
| `prepareMmdZipInput()` | `frontend/src/utils/3d/adapters/mmd-zip-overlay:202` | 构造完整的 zip 包装流程： 检测 zip → 解析 zip → 创建 overlay → 返回 { port, rootPath } 调用方只需： const { port, |
| `zipFindEntry()` | `frontend/src/utils/3d/adapters/mmd-zip-overlay:218` | 从 zip entries 中按名称查找（大小写不敏感，basename 匹配） |
| `PreviewBuildCtx()` | `frontend/src/utils/3d/adapters/mount-preview-core:74` | 适配器构建时可用的通用外壳句柄（内容层据此注入场景/灯光/定相机） |
| `PreviewScene()` | `frontend/src/utils/3d/adapters/mount-preview-core:93` | 适配器返回的内容场景契约（对齐 Model3DHandleX，方法全部可选，便于纯静态渲染） |
| `PreviewAdapter()` | `frontend/src/utils/3d/adapters/mount-preview-core:119` | — |
| `PreviewHandle()` | `frontend/src/utils/3d/adapters/mount-preview-core:129` | 统一预览句柄（D 步 ysm 接入时经此暴露内容层方法） |
| `invalidatePreview()` | `frontend/src/utils/3d/adapters/mount-preview-core:175` | 任意新预览派发时调用，作废在途加载（对齐 invalidateVrmPreview / invalidateLitematicPreview） |
| `cleanupPreview()` | `frontend/src/utils/3d/adapters/mount-preview-core:180` | 清理所有 3D 预览（dispose built + 移除 scene children，保留 renderer/canvas/overlay 存活避免黑屏） |
| `_resetSingletons()` | `frontend/src/utils/3d/adapters/mount-preview-core:200` | 测试用：重置所有模块级单例状态（不影响生产代码路径） |
| `switchPreview()` | `frontend/src/utils/3d/adapters/mount-preview-core:213` | 当前会话内切换到另一模型（复用外壳重建内容层，ADR-066 §5.6）；无活跃会话时 no-op |
| `hasActivePreview()` | `frontend/src/utils/3d/adapters/mount-preview-core:219` | 是否存在活跃 3D 预览会话（多模型同台追加的前置判定，ADR-093 T4） |
| `Mount3DOptions()` | `frontend/src/utils/3d/adapters/mount-preview-core:224` | mount3D 附加选项（ADR-066 §5.6 3D 内模型切换） |
| `mount3D()` | `frontend/src/utils/3d/adapters/mount-preview-core:242` | — |
| `buildPackScene()` | `frontend/src/utils/3d/adapters/pack-model-adapter` | — |
| `PackDeps()` | `frontend/src/utils/3d/adapters/pack-model-adapter:22` | Go 绑定依赖（薄包装层经 getApp 注入，对齐 vrm/litematic 工厂模式） |
| `makePackAdapter()` | `frontend/src/utils/3d/adapters/pack-model-adapter:38` | 工厂：适配器持 zipPath（容器路径），buildPath 即 entry path（虚拟文件夹下的文件路径） |
| `PerceptionState()` | `frontend/src/utils/3d/adapters/perception-controls:7` | 感知层状态：各模块开关（adapter build 时创建，update 循环读取，面板 UI 写入） |
| `PerceptionCapability()` | `frontend/src/utils/3d/adapters/perception-controls:16` | 可用感知模块描述（由 adapter 按实际能力填写） |
| `buildPerceptionControls()` | `frontend/src/utils/3d/adapters/perception-controls:37` | 在感知面板内渲染开关行（对齐 camera-controls.ts 范式）。 |
| `PostprocessingLike()` | `frontend/src/utils/3d/adapters/postprocessing:8` | 后处理对外最小契约（PostprocessingCapability 实现此接口） |
| `renderCapControls()` | `frontend/src/utils/3d/adapters/preview-menu-cap-controls:421` | — |
| `PreviewMenuItemKind()` | `frontend/src/utils/3d/adapters/preview-menu-defs:30` | — |
| `PreviewMenuGroupId()` | `frontend/src/utils/3d/adapters/preview-menu-defs:31` | — |
| `PreviewMenuItemDef()` | `frontend/src/utils/3d/adapters/preview-menu-defs:33` | — |
| `PreviewMenuGroupDef()` | `frontend/src/utils/3d/adapters/preview-menu-defs:60` | 底栏分组定义（能力驱动：组内无任何可显示项时不渲染该组按钮） |
| `PREVIEW_MENU_GROUPS()` | `frontend/src/utils/3d/adapters/preview-menu-defs:66` | — |
| `CORE_MENU_ITEMS()` | `frontend/src/utils/3d/adapters/preview-menu-defs:86` | core 固定菜单项（不依赖适配器注入）： - roles：模型组唯一 core 项（已加载角色管理 + 底部内嵌加载入口 fillSwitch； 2026-08-21 合并：独立 |
| `buildEnvSchema()` | `frontend/src/utils/3d/adapters/preview-menu-env:56` | — |
| `renderEnvLevel()` | `frontend/src/utils/3d/adapters/preview-menu-env:146` | 环境面板（ADR-075 + 统一注册表）：只渲染环境类能力（sky/ground/environment/fog/reflector） 独立面板排除项：light → light |
| `PreviewStatePath()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:14` | 状态路径：类型化字符串（沿用 MikuMikuAR 契约；ysm 侧 state 映射表尚未建立时为占位） |
| `PreviewActionMenuCtx()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:24` | 动作节点回调上下文（与 ActionMenuCtx 对齐；ysm 侧 toast/closeOverlays 由 ctx.menu 提供） |
| `PreviewMenuNodeKind()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:30` | 节点种类：folder 可嵌套；其余为叶节点（与 MikuMikuAR MenuKind 对齐，加 ysm 的 panel 语义） |
| `PreviewControlSpec()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:44` | 控件绑定规格（slider/toggle/button/field 用；ysm 侧 state 映射表建立后 bind 生效） |
| `PreviewMenuNode()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:64` | 声明式菜单节点：菜单即数据。与 PreviewMenuItemDef 的映射见 preview-menu-defs.ts 顶部注释 |
| `isPreviewFolderNode()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:104` | 类型守卫：节点是否为 folder（可下钻） |
| `collectPreviewLeafNodes()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:109` | 递归收集全部叶子节点（folder 展开；供测试/审计遍历） |
| `collectPreviewNodeIds()` | `frontend/src/utils/3d/adapters/preview-menu-node-types:122` | 递归收集全部节点 id（供 id 唯一性契约测试） |
| `renderMenu()` | `frontend/src/utils/3d/adapters/preview-menu-render:218` | — |
| `roleBaseName()` | `frontend/src/utils/3d/adapters/preview-menu-roles:29` | 角色路径 basename：角色详情/工具面板标题复用（fillRoles 与 dock 🧍 捷径共享，防两处漂移）。 |
| `roleDetailView()` | `frontend/src/utils/3d/adapters/preview-menu-roles:44` | 角色详情子面板（目标态「详情=模型信息面板本体」）： - model 组第一个 panel（恒为「模型信息」）→ renderCustom 直渲进详情主体（1 跳看内容，用户「最想 |
| `fillRoles()` | `frontend/src/utils/3d/adapters/preview-menu-roles:273` | — |
| `buildCameraSchema()` | `frontend/src/utils/3d/adapters/preview-menu-settings:31` | 相机面板 schema：wrap buildCameraControls 为声明式节点 |
| `buildLightingSchema()` | `frontend/src/utils/3d/adapters/preview-menu-settings:45` | 灯光面板 schema：从 light cap 自报控件渲染 |
| `buildShadowSchema()` | `frontend/src/utils/3d/adapters/preview-menu-settings:66` | 阴影面板 schema：从 shadow cap 自报控件渲染 |
| `buildPostprocessingSchema()` | `frontend/src/utils/3d/adapters/preview-menu-settings:82` | 后处理面板 schema：从 postprocessing cap 自报控件渲染 |
| `buildSettingsSchema()` | `frontend/src/utils/3d/adapters/preview-menu-settings:98` | 设置面板 schema：性能/画质开关声明式节点 |
| `fillSwitch()` | `frontend/src/utils/3d/adapters/preview-menu-switch:216` | — |
| `roleBaseName()` | `frontend/src/utils/3d/adapters/preview-menu` | — |
| `renderMenu()` | `frontend/src/utils/3d/adapters/preview-menu` | — |
| `renderCapControls()` | `frontend/src/utils/3d/adapters/preview-menu` | — |
| `PreviewMenuCtx()` | `frontend/src/utils/3d/adapters/preview-menu:36` | 根菜单上下文：core 在 mount3D 内组装，全部经 getter 暴露避免闭包捕获过期值 |
| `PreviewMenuHandle()` | `frontend/src/utils/3d/adapters/preview-menu:78` | 根菜单句柄：dispose 解绑；setAdapterItems 替换适配器专属项；openPanel 直接打开指定面板；refreshDock 在 caps 创建后重渲染底栏（A |
| `mountPreviewRootMenu()` | `frontend/src/utils/3d/adapters/preview-menu:486` | — |
| `ModelEntry()` | `frontend/src/utils/3d/adapters/scene-registry:21` | 单条模型记录（角色面板 fillRoles 消费：path/rtype/menuItems/roots） |
| `sceneRegistry()` | `frontend/src/utils/3d/adapters/scene-registry:206` | 模块级单例（随活跃会话 reset） |
| `MAX_MODELS()` | `frontend/src/utils/3d/adapters/scene-registry:209` | 同场景最大模型数（超量追加被拒，ADR-093 T6） |
| `SwitchContext()` | `frontend/src/utils/3d/adapters/switch-preview:31` | 会话内切换所需的外部上下文（原 mount3D 内嵌闭包变量） |
| `switchToSession()` | `frontend/src/utils/3d/adapters/switch-preview:91` | 会话内切换模型（复用外壳重建内容层）。 |
| `syncLightTargetFromContent()` | `frontend/src/utils/3d/adapters/switch-preview:404` | 重算内容层包围盒，更新灯光 target（ADR-081 L1 + ADR-084 L2）。 |
| `Endianness()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/endianness:4` | Endianness utility class for serlization/deserialization |
| `ConsoleLogger()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/ILogger:6` | A logger that outputs to the console generally, you can use this class as default logger |
| `MmdDataDeserializer()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/mmdDataDeserializer:5` | DataView wrapper for deserializing MMD data |
| `PmxObject()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxObject` | — |
| `Vec3()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:4` | — |
| `Vec4()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:5` | — |
| `PmxHeader()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:7` | — |
| `PmxVertex()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:21` | — |
| `PmxMaterial()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:34` | — |
| `PmxBone()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:53` | — |
| `PmxMorph()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:73` | — |
| `PmxDisplayFrame()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:86` | — |
| `PmxRigidBody()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:93` | — |
| `PmxJoint()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:111` | — |
| `PmxObject()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader.d:127` | — |
| `PmxReader()` | `frontend/src/utils/3d/adapters/vendor/babylon-mmd/pmxReader:62` | PmxReader is a static class that parses PMX data |
| `FBXLoader()` | `frontend/src/utils/3d/adapters/vendor/fbx/FBXLoader:79` | A loader for the FBX format. |
| `VrmDataPort()` | `frontend/src/utils/3d/adapters/vrm-adapter:29` | VRM 数据端口（视图壳注入，适配器 0 backend import——ADR-072 边界判据） |
| `VrmMetaInfo()` | `frontend/src/utils/3d/adapters/vrm-adapter:86` | VRM meta 归一化信息（meta 卡展示用） |
| `readVrmMeta()` | `frontend/src/utils/3d/adapters/vrm-adapter:105` | 解析 VRM meta（不渲染 3D，parse 后立即 deepDispose），失败返回 null |
| `VrmPanelHooks()` | `frontend/src/utils/3d/adapters/vrm-adapter:165` | 面板填充回调（视图层注入，解除 utils→views 运行时分层违规 R1；缺失时菜单 render 退化为 no-op） |
| `buildVrmScene()` | `frontend/src/utils/3d/adapters/vrm-adapter:490` | — |
| `VrmMenuItemsOpts()` | `frontend/src/utils/3d/adapters/vrm-adapter:510` | vrmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 |
| `vrmMenuItems()` | `frontend/src/utils/3d/adapters/vrm-adapter:546` | VRM 声明式根菜单专属项（ADR-076 v2 Phase 2）：🦴 骨骼 + 🎨 材质。 |
| `VrmBonePanelCtx()` | `frontend/src/utils/3d/adapters/vrm-bone-ui:21` | 骨骼面板上下文：core 外壳注入（extraPanel 标准契约） |
| `RenderVrmBonePanel()` | `frontend/src/utils/3d/adapters/vrm-bone-ui:31` | 骨骼面板渲染契约：返回清理函数（面板移除时调用） |
| `makeBonePanelRenderer()` | `frontend/src/utils/3d/adapters/vrm-bone-ui:37` | 通用骨骼面板渲染器（ADR-074 S3：从 VRM 专属抽通用版，喂 BoneTree 而非 VRM）。 |
| `buildVrmBoneNodes()` | `frontend/src/utils/3d/adapters/vrm-bone:20` | 从 vrm.humanoid 提取标准人形骨骼列表（id = HumanoidBoneName 如 "leftUpperArm"）。 |
| `buildVrmBoneTree()` | `frontend/src/utils/3d/adapters/vrm-bone:52` | 从 vrm.humanoid 直接构建通用骨骼树（buildBoneNodes → buildBoneTree 一步到位） |
| `ResolveModeResponse()` | `frontend/src/utils/3d/adapters/worker-bridge:15` | 响应必须携带 id；resolve-mode 还需 ok 标志（错误以响应形式回传，不 reject） |
| `WorkerErrorStrategy()` | `frontend/src/utils/3d/adapters/worker-bridge:22` | 崩溃/终止时的结算策略 |
| `WorkerBridge()` | `frontend/src/utils/3d/adapters/worker-bridge:24` | — |
| `CreateWorkerBridgeOpts()` | `frontend/src/utils/3d/adapters/worker-bridge:39` | — |
| `createWorkerBridge()` | `frontend/src/utils/3d/adapters/worker-bridge:54` | — |
| `ResolveModeBridge()` | `frontend/src/utils/3d/adapters/worker-bridge:147` | — |
| `createResolveModeBridge()` | `frontend/src/utils/3d/adapters/worker-bridge:154` | — |
| `YsmAdapterOptions()` | `frontend/src/utils/3d/adapters/ysm-adapter:43` | 适配器可选项：loader 注入（预览面板语境数据加载链）/ 纹理重建 / 关闭回调 |
| `buildYsmScene()` | `frontend/src/utils/3d/adapters/ysm-adapter:472` | 构建 YSM 3D 内容并挂载到统一外壳（shared 模式）。 |
| `makeYsmAdapter()` | `frontend/src/utils/3d/adapters/ysm-adapter:502` | 工厂：构造统一 PreviewAdapter（shared 模式） |
| `YsmMenuItemsOpts()` | `frontend/src/utils/3d/adapters/ysm-adapter:521` | ysmMenuItems 组装依赖：适配器 build 内组装；测试可构造假依赖遍历真实菜单表 |
| `ysmMenuItems()` | `frontend/src/utils/3d/adapters/ysm-adapter:555` | YSM 声明式根菜单专属项（ADR-076 v2 Phase 2）：model / 截图 / 骨骼。 |
| `ALPHA_F_VISIBLE()` | `frontend/src/utils/3d/alpha-index:5` | — |
| `ALPHA_F_HOLE()` | `frontend/src/utils/3d/alpha-index:6` | — |
| `ALPHA_F_TRANSLUCENT()` | `frontend/src/utils/3d/alpha-index:7` | — |
| `flagsForAlpha()` | `frontend/src/utils/3d/alpha-index:12` | — |
| `AlphaIndex()` | `frontend/src/utils/3d/alpha-index:18` | — |
| `b64ToBytes()` | `frontend/src/utils/3d/base64:6` | base64 → Uint8Array（Go []byte 的 base64 序列化） |
| `bytesToArrayBuffer()` | `frontend/src/utils/3d/base64:15` | Uint8Array → ArrayBuffer（Blob 构造要求 ArrayBufferView&lt;ArrayBuffer&gt;，规避 SharedArrayBuffer 泛型） |
| `bytesToBase64()` | `frontend/src/utils/3d/base64:20` | Uint8Array → base64（分块防栈溢出，对齐 atob 解码口径） |
| `BoneInfoLite()` | `frontend/src/utils/3d/bone-list:7` | getBoneList 返回的扁平骨骼信息 |
| `getBoneList()` | `frontend/src/utils/3d/bone-list:21` | 从 spec 提取骨骼列表，支持按组件索引： - modelIdx 缺省 0 → 第一组件（main，动画驱动）——向后兼容 v1 单组件语义 - modelIdx &gt;= 0  → |
| `buildBoneHierarchy()` | `frontend/src/utils/3d/bone-raycast:14` | 构建骨骼层级路径映射（name/id/parent/children）。 |
| `getMeshBoneId()` | `frontend/src/utils/3d/bone-raycast:53` | Mesh → 所属骨骼名（沿父链向上查找 has isGroup 且 name 在 nameMap 中的节点）。 |
| `assembleBoneSelectInfo()` | `frontend/src/utils/3d/bone-raycast:68` | 骨骼选中信息组装。 |
| `registerBoneRaycast()` | `frontend/src/utils/3d/bone-raycast:130` | 注册 pointermove / click 骨骼拾取监听器。 |
| `BoneNode()` | `frontend/src/utils/3d/bone-tools:11` | 统一骨骼节点：来源无关（YSM spec bones / VRM humanoid bones 均适配） |
| `BoneTree()` | `frontend/src/utils/3d/bone-tools:23` | 骨骼树：id 索引 + 子映射 + 根集合 + object 反查（buildBoneTree 产物） |
| `buildBoneTree()` | `frontend/src/utils/3d/bone-tools:36` | 从任意扁平骨骼声明构建层级树。 |
| `BoneListItem()` | `frontend/src/utils/3d/bone-tools:58` | 深度缩进的骨骼列表项（枚举 + 父子 + 深度） |
| `listBonesWithDepth()` | `frontend/src/utils/3d/bone-tools:65` | 骨骼树 → 深度缩进列表（前序遍历，根 depth=0；数组顺序即展开顺序） |
| `getBonePath()` | `frontend/src/utils/3d/bone-tools:78` | 骨骼 id → 全路径（如 "root / spine / head"；找不到该 id 返回 null） |
| `getBonePosition()` | `frontend/src/utils/3d/bone-tools:93` | 骨骼 id → 世界坐标（需 object；无 object 或缺省返回 null） |
| `BoneDetail()` | `frontend/src/utils/3d/bone-tools:101` | 骨骼详情：路径/坐标/父骨骼/子骨骼列表（id 不存在返回 null） |
| `getBoneDetail()` | `frontend/src/utils/3d/bone-tools:110` | — |
| `setBoneVisible()` | `frontend/src/utils/3d/bone-tools:129` | 骨骼显隐：设置该骨骼节点及其所有子网格可见性（需 object；无 object no-op） |
| `toggleBoneVisible()` | `frontend/src/utils/3d/bone-tools:137` | 骨骼显隐：切换（取反）该骨骼节点可见性 |
| `findAncestorBoneId()` | `frontend/src/utils/3d/bone-tools:153` | 沿 Object3D 父链向上找最近的骨骼 id（object 引用匹配，不依赖 name 约定） |
| `pickBone()` | `frontend/src/utils/3d/bone-tools:169` | Raycaster 拾取：命中任意 mesh → 沿父链找最近挂载在骨骼节点上的祖先（需 object）。 |
| `BoneGroupMap()` | `frontend/src/utils/3d/bone-visibility:6` | BoneGroupMap 类型别名：骨骼 id → THREE.Group |
| `setBoneVisible()` | `frontend/src/utils/3d/bone-visibility:11` | 设置指定骨骼组及其所有子网格的可见性。 |
| `toggleBone()` | `frontend/src/utils/3d/bone-visibility:19` | 切换指定骨骼组的可见性（取反）。 |
| `showModelGroup()` | `frontend/src/utils/3d/bone-visibility:29` | 按索引显示单个模型组件（idx &lt; 0 = 全部显示，NaN 防御）。 |
| `fitCameraToScene()` | `frontend/src/utils/3d/camera-setup:12` | 根据内容根节点的包围盒适配相机位置和 controls.target。 |
| `fitCameraToRoots()` | `frontend/src/utils/3d/camera-setup:26` | 按给定根节点列表（多模型同框）计算并集包围盒并返回相机初始位姿。 |
| `EnvPresetId()` | `frontend/src/utils/3d/caps/environment-capability:20` | — |
| `EnvPreset()` | `frontend/src/utils/3d/caps/environment-capability:22` | — |
| `ENV_PRESETS()` | `frontend/src/utils/3d/caps/environment-capability:43` | — |
| `EnvPresetLinkage()` | `frontend/src/utils/3d/caps/environment-capability:88` | 预设快捷联动表：选某预设时，除切 environment.preset 外，一并联动 sky/fog/env 参数， 让「日落」「夜景」等预设呈现完整氛围，而非只换一张 envMa |
| `ENV_PRESET_LINKAGE()` | `frontend/src/utils/3d/caps/environment-capability:100` | — |
| `EnvironmentParams()` | `frontend/src/utils/3d/caps/environment-capability:127` | — |
| `DEFAULT_ENV_PARAMS()` | `frontend/src/utils/3d/caps/environment-capability:138` | — |
| `ENV_PRESET_BY_MODEL()` | `frontend/src/utils/3d/caps/environment-capability:147` | 模型类别环境默认 preset（YSM 方块=sky，VRM/MMD=studio 柔光更友好，体素=forest） |
| `drawEnvEquirect()` | `frontend/src/utils/3d/caps/environment-capability:158` | 给 canvas 2D ctx 填充 equirectangular 环境贴图（程序化） |
| `EnvironmentCapability()` | `frontend/src/utils/3d/caps/environment-capability:399` | — |
| `FogMode()` | `frontend/src/utils/3d/caps/fog-capability:15` | — |
| `FogParams()` | `frontend/src/utils/3d/caps/fog-capability:17` | — |
| `DEFAULT_FOG_PARAMS()` | `frontend/src/utils/3d/caps/fog-capability:30` | — |
| `FOG_PRESETS()` | `frontend/src/utils/3d/caps/fog-capability:40` | 模型类别雾预设：材质特性不同，雾浓度/远近做合理初始值 |
| `FogCapability()` | `frontend/src/utils/3d/caps/fog-capability:68` | — |
| `GroundParams()` | `frontend/src/utils/3d/caps/ground-capability:36` | — |
| `DEFAULT_GROUND_PARAMS()` | `frontend/src/utils/3d/caps/ground-capability:57` | — |
| `GroundCapability()` | `frontend/src/utils/3d/caps/ground-capability:70` | — |
| `GroundSurfaceMode()` | `frontend/src/utils/3d/caps/ground-surface-spec:17` | 地面表面模式（扁平枚举：来源 × 画布样式合一，避免双字段耦合守卫） |
| `GroundMaterialParams()` | `frontend/src/utils/3d/caps/ground-surface-spec:19` | — |
| `DEFAULT_GROUND_SURFACE_PARAMS()` | `frontend/src/utils/3d/caps/ground-surface-spec:40` | — |
| `GroundSurfaceStructuralSpec()` | `frontend/src/utils/3d/caps/ground-surface-spec:52` | — |
| `GroundSurfaceAppearanceSpec()` | `frontend/src/utils/3d/caps/ground-surface-spec:61` | — |
| `GroundSurfaceSpec()` | `frontend/src/utils/3d/caps/ground-surface-spec:69` | — |
| `buildGroundSurfaceSpec()` | `frontend/src/utils/3d/caps/ground-surface-spec:80` | — |
| `surfaceSpecKey()` | `frontend/src/utils/3d/caps/ground-surface-spec:102` | structural 子集确定性序列化：新增结构字段后在此补一行即自动纳入重建判别 |
| `groundSurfaceNeedsRebuild()` | `frontend/src/utils/3d/caps/ground-surface-spec:114` | 结构性变化 → 需要重建材质与纹理；否则原地更新即可 |
| `TILE_WORLD_SIZE()` | `frontend/src/utils/3d/caps/ground-surface-spec:121` | 每格世界单位基准：50 单位地面默认铺 5×5 次重复 |
| `textureRepeat()` | `frontend/src/utils/3d/caps/ground-surface-spec:123` | — |
| `generateSurfacePixels()` | `frontend/src/utils/3d/caps/ground-surface-spec:129` | ============ 程序化像素生成（RGBA，node 可测）============ |
| `applyGroundSurfaceStructural()` | `frontend/src/utils/3d/caps/ground-surface-spec:170` | 重建路径专用：把 structural 落到新材质上。 |
| `applyGroundSurfaceAppearance()` | `frontend/src/utils/3d/caps/ground-surface-spec:189` | 原地/重建通用：appearance 字段统一落地（唯一入口）。 |
| `DirectionalLightParams()` | `frontend/src/utils/3d/caps/light-capability:32` | ============ 参数类型 ============ |
| `AmbientLightParams()` | `frontend/src/utils/3d/caps/light-capability:42` | — |
| `SpotlightParams()` | `frontend/src/utils/3d/caps/light-capability:47` | — |
| `VolumetricParams()` | `frontend/src/utils/3d/caps/light-capability:61` | — |
| `LightParams()` | `frontend/src/utils/3d/caps/light-capability:75` | — |
| `DEFAULT_LIGHT_PARAMS()` | `frontend/src/utils/3d/caps/light-capability:103` | — |
| `LIGHT_PRESETS()` | `frontend/src/utils/3d/caps/light-capability:113` | 模型类别预设（对齐 SkyCapability.MODEL_SKY_PRESETS 模式） |
| `LightCapability()` | `frontend/src/utils/3d/caps/light-capability:343` | — |
| `ReflectionMode()` | `frontend/src/utils/3d/caps/postprocessing-capability:33` | 反射模式三档：envmap-only 纯环境贴图、envmap+ssr SSR+屏外 fallback、ssr-only 纯 SSR（屏外会变黑） |
| `PostprocessingParams()` | `frontend/src/utils/3d/caps/postprocessing-capability:35` | — |
| `DEFAULT_POSTPROC_PARAMS()` | `frontend/src/utils/3d/caps/postprocessing-capability:85` | — |
| `POSTPROC_PRESETS()` | `frontend/src/utils/3d/caps/postprocessing-capability:335` | 模型类别后处理预设 |
| `PostprocessingCapability()` | `frontend/src/utils/3d/caps/postprocessing-capability:374` | — |
| `ReflectorParams()` | `frontend/src/utils/3d/caps/reflector-capability:18` | — |
| `DEFAULT_REFLECTOR_PARAMS()` | `frontend/src/utils/3d/caps/reflector-capability:34` | — |
| `REFLECTOR_PRESETS()` | `frontend/src/utils/3d/caps/reflector-capability:45` | 模型类别反光预设：反光强度按材质风格适配（toon 不要强反射，PBR 角色中等，方块/体素弱） |
| `ReflectorCapability()` | `frontend/src/utils/3d/caps/reflector-capability:125` | — |
| `SceneCapabilityFactory()` | `frontend/src/utils/3d/caps/scene-capability-registry:20` | 能力工厂：接收 scene/renderer/camera，返回能力实例 |
| `SceneCapabilityRegistry()` | `frontend/src/utils/3d/caps/scene-capability-registry:27` | 注册表：管理所有场景能力的工厂和实例 |
| `sceneCapabilityRegistry()` | `frontend/src/utils/3d/caps/scene-capability-registry:106` | 全局单例（模块级单例 + 运行时状态隔离） |
| `MenuControlDef()` | `frontend/src/utils/3d/caps/scene-capability:16` | 菜单控件定义（声明式，由框架渲染为 DOM） |
| `SceneCapability()` | `frontend/src/utils/3d/caps/scene-capability:68` | ============ 场景能力统一接口 ============ |
| `persistState()` | `frontend/src/utils/3d/caps/scene-capability:109` | 保存 JSON 到 localStorage |
| `restoreState()` | `frontend/src/utils/3d/caps/scene-capability:114` | 从 localStorage 加载 JSON |
| `ShadowParams()` | `frontend/src/utils/3d/caps/shadow-capability:24` | ============ 参数类型 ============ |
| `DEFAULT_SHADOW_PARAMS()` | `frontend/src/utils/3d/caps/shadow-capability:39` | — |
| `SHADOW_PRESETS()` | `frontend/src/utils/3d/caps/shadow-capability:49` | 预设（setPreset 套用到不同模型类别） |
| `ShadowCapability()` | `frontend/src/utils/3d/caps/shadow-capability:168` | ============ ShadowCapability ============ |
| `SkyParams()` | `frontend/src/utils/3d/caps/sky-capability:28` | — |
| `DEFAULT_SKY_PARAMS()` | `frontend/src/utils/3d/caps/sky-capability:49` | — |
| `SkyModelType()` | `frontend/src/utils/3d/caps/sky-capability:64` | 模型类别标识（取 PreviewAdapter.id：ysm/vrm/mmd/litematic） |
| `MODEL_SKY_PRESETS()` | `frontend/src/utils/3d/caps/sky-capability:72` | 按模型类别的散射/曝光预设（ADR-073 #3）。 |
| `SkyCapability()` | `frontend/src/utils/3d/caps/sky-capability:164` | — |
| `disposeDebugGroup()` | `frontend/src/utils/3d/cleanup-helper:14` | 释放 debug 叠加层中的所有 Three.js 资源（geometry / material / texture）。 |
| `disposeSceneMeshes()` | `frontend/src/utils/3d/cleanup-helper:40` | 遍历场景图释放所有 Mesh 的 geometry 和 material。 |
| `eulerToQuaternion()` | `frontend/src/utils/3d/cube-mesh` | — |
| `isIdentityQuat()` | `frontend/src/utils/3d/cube-mesh` | — |
| `hasBoneRotation()` | `frontend/src/utils/3d/cube-mesh` | — |
| `computeBoneLocalPos()` | `frontend/src/utils/3d/cube-mesh:24` | 计算骨骼本地位置（对齐 YSMViewer/C# ConvertBones 口径）。 |
| `buildCubeMeshData()` | `frontend/src/utils/3d/cube-mesh:192` | 从 Bedrock cube 数据构建 THREE.Mesh 几何数据。 |
| `mergeCubes()` | `frontend/src/utils/3d/cube-mesh:261` | 合并两组 cube：新 cube 中与旧 cube 空间重叠的替换之，不重叠的追加。 |
| `rebuildDebug()` | `frontend/src/utils/3d/debug-render:58` | 重建 debug 叠加层（pivot 标记 / 骨骼线框）。 |
| `MeshFragment()` | `frontend/src/utils/3d/face-split:14` | 网格碎片：同一 meshGroup 按 alpha 特征拆出的子几何 + 渲染路径 |
| `splitMeshByFaceAlpha()` | `frontend/src/utils/3d/face-split:24` | 按三角形 UV 包围盒查询 AlphaIndex，把 md 拆成 ≤3 个 mode 碎片。 |
| `registerModelRoot()` | `frontend/src/utils/3d/frustum-cull:18` | 注册模型根节点（adapter 调用） |
| `unregisterModelRoot()` | `frontend/src/utils/3d/frustum-cull:23` | 注销模型根节点（adapter dispose 时调用） |
| `getModelRootCount()` | `frontend/src/utils/3d/frustum-cull:29` | 获取当前注册的模型根节点数 |
| `cullModelGroups()` | `frontend/src/utils/3d/frustum-cull:38` | 对所有已注册的模型根节点做视锥裁剪。 |
| `clearModelRoots()` | `frontend/src/utils/3d/frustum-cull:99` | 清空所有注册（session 结束时调用） |
| `isFrustumCullEnabled()` | `frontend/src/utils/3d/frustum-cull:111` | 视锥裁剪开关是否启用（undefined → 默认关；safeGet 隐私模式安全） |
| `setFrustumCullEnabled()` | `frontend/src/utils/3d/frustum-cull:117` | 设置视锥裁剪开关（设置面板开关调用） |
| `restoreModelGroupsVisible()` | `frontend/src/utils/3d/frustum-cull:122` | 关闭剔除时恢复所有注册模型根可见性（幂等） |
| `IKChain()` | `frontend/src/utils/3d/ik-solver:21` | IK 链：从 root 到 endEffector 的 THREE.Object3D 有序数组（含两端） |
| `IKConfig()` | `frontend/src/utils/3d/ik-solver:24` | IK 求解配置 |
| `IKResult()` | `frontend/src/utils/3d/ik-solver:42` | IK 求解结果 |
| `solveIK()` | `frontend/src/utils/3d/ik-solver:75` | CCD IK 求解器。 |
| `extractIKChainFromTree()` | `frontend/src/utils/3d/ik-solver:195` | 从 BoneTree 中提取从 root 到 endEffector 的骨骼链（object 引用）。 |
| `TdKeyAction()` | `frontend/src/utils/3d/keymap:8` | — |
| `DEFAULT_TD_KEYMAP()` | `frontend/src/utils/3d/keymap:11` | 默认键位以 KeyboardEvent.code 存储（物理键，跨键盘布局一致） |
| `loadTdKeymap()` | `frontend/src/utils/3d/keymap:27` | 读取用户自定义键位（无/非法时回退默认） |
| `loadTdCamSpeed()` | `frontend/src/utils/3d/keymap:45` | 相机移动速度（2–200），默认 20 |
| `loadTdRotMode()` | `frontend/src/utils/3d/keymap:52` | true = 环绕（orbit），false = 自身（free） |
| `LoadTraceTexture()` | `frontend/src/utils/3d/load-trace:6` | — |
| `LoadTraceStage()` | `frontend/src/utils/3d/load-trace:12` | — |
| `LoadTraceAssets()` | `frontend/src/utils/3d/load-trace:18` | — |
| `LoadTrace()` | `frontend/src/utils/3d/load-trace:38` | — |
| `recordLoadTrace()` | `frontend/src/utils/3d/load-trace:52` | — |
| `getLoadTraces()` | `frontend/src/utils/3d/load-trace:57` | — |
| `clearLoadTraces()` | `frontend/src/utils/3d/load-trace:61` | — |
| `loadMcTints()` | `frontend/src/utils/3d/mc-tints:29` | 预载 vendored tints 表（幂等；失败抛错由调用方降级兜底）。 |
| `getTintColorSync()` | `frontend/src/utils/3d/mc-tints:51` | 取某染色类别在某 biome 下的颜色（默认 plains）。 |
| `bakeMeshFragments()` | `frontend/src/utils/3d/mesh-baker:10` | Bake fragments once, then batch by animated bone, texture, and alpha mode. |
| `addMeshToBoneGroup()` | `frontend/src/utils/3d/mesh-builder:31` | 从 spec mesh group 数据构建 THREE.Mesh 并添加到 boneGroup。 |
| `compKey()` | `frontend/src/utils/3d/mesh:17` | 组件内骨骼 key（mi: 组件下标, id: 骨骼 id）。renderModel3D 与 buildSceneMesh 共用，随 mesh 迁移。 |
| `disposeMaterial()` | `frontend/src/utils/3d/mesh:35` | 释放材质（含所有位图贴图），null/undefined 安全。 |
| `buildSceneMesh()` | `frontend/src/utils/3d/mesh:53` | 构建 3D 场景网格（组件分组 + 骨骼树），返回供渲染/交互使用的组结构。 |
| `mmdBonesToBoneNodes()` | `frontend/src/utils/3d/mmd-bones:16` | MMD 骨骼 → bone-tools BoneNode[]（id = pmx 索引字符串；越界父/自引用 → null 根） |
| `MmdBonePickResult()` | `frontend/src/utils/3d/mmd-bones:32` | 拾取结果（pickMmdBone 命中） |
| `pickMmdBone()` | `frontend/src/utils/3d/mmd-bones:39` | MMD 骨骼拾取：射线到骨骼 worldPosition 距离命中（Bone 无几何，网格归属拾取不适用） |
| `FootIKController()` | `frontend/src/utils/3d/mmd-foot-ik:13` | 足部 IK 控制器 |
| `createFootIKController()` | `frontend/src/utils/3d/mmd-foot-ik:27` | 创建足部 IK 控制器 |
| `MmdMaterialListItem()` | `frontend/src/utils/3d/mmd-materials:13` | 材质列表项（listMmdMaterials） |
| `MmdMaterialDetail()` | `frontend/src/utils/3d/mmd-materials:19` | 材质详情（getMmdMaterialDetail） |
| `listMmdMaterials()` | `frontend/src/utils/3d/mmd-materials:31` | 材质列表：pmx.materials name + 索引（索引与 mesh.material 对齐） |
| `setMmdMaterialVisible()` | `frontend/src/utils/3d/mmd-materials:38` | 材质显隐：Material.visible（MMDToonMaterial 继承 MeshPhongMaterial） |
| `toggleMmdMaterialVisible()` | `frontend/src/utils/3d/mmd-materials:48` | 材质显隐切换：返回切换后的可见状态（越界返回 false） |
| `setMmdMaterialOpacity()` | `frontend/src/utils/3d/mmd-materials:59` | 材质透明度（0-1）：opacity 设置 + transparent 联动（opacity &lt; 1 → transparent = true） |
| `getMmdMaterialDetail()` | `frontend/src/utils/3d/mmd-materials:71` | 材质详情：name/可见/透明/高光/光泽（越界返回 null） |
| `buildModelGroup()` | `frontend/src/utils/3d/model-group-builder:299` | 单组件 spec 构建核心。 |
| `drawView()` | `frontend/src/utils/3d/model2d-draw:234` | 主视图绘制：逐 bone/cube 投影 + 可选高亮 + 可选标签 |
| `drawMiniView()` | `frontend/src/utils/3d/model2d-draw:301` | 小地图：俯视图投影全部 cube 包围盒 |
| `cubeVec()` | `frontend/src/utils/3d/model2d-draw:11` | — |
| `HitZone()` | `frontend/src/utils/3d/model2d-hit-zones:9` | 骨骼屏幕热区（鼠标拾取） |
| `calcBoneHitZones()` | `frontend/src/utils/3d/model2d-hit-zones:18` | 计算骨骼在屏幕上的命中热区（2D 正交投影，供鼠标拾取；导出供测试） |
| `calcBoneHitZones()` | `frontend/src/utils/3d/model2d` | — |
| `BedrockCube()` | `frontend/src/utils/3d/model2d:16` | Bedrock cube（AnalyzeBedrockModel 结构） |
| `BedrockBone()` | `frontend/src/utils/3d/model2d:26` | Bedrock bone |
| `BedrockModel()` | `frontend/src/utils/3d/model2d:32` | BedrockModel（AnalyzeBedrockModel 返回） |
| `Model2DOptions()` | `frontend/src/utils/3d/model2d:37` | renderModel2D 选项 |
| `renderModel2D()` | `frontend/src/utils/3d/model2d:58` | 在 Canvas 上绘制模型骨骼的 2D 正交投影（前视图，支持 Y 轴旋转） |
| `CUBE_EPS()` | `frontend/src/utils/3d/model3d-spec:6` | 立方体几何 epsilon（0.001）——单点导出，cube-mesh.ts 的 THICKNESS_EPSILON/CUBE_EPSILON 同值收敛于此 |
| `SpecCube()` | `frontend/src/utils/3d/model3d-spec:11` | 立方体（骨骼上的 box 元素） |
| `SpecBone()` | `frontend/src/utils/3d/model3d-spec:23` | 骨骼 |
| `SpecModelInput()` | `frontend/src/utils/3d/model3d-spec:31` | 模型输入（buildSpecFromModel 参数） |
| `SpecBuildResult()` | `frontend/src/utils/3d/model3d-spec:38` | 构建产物：mesh data + bones |
| `SpecMeshData()` | `frontend/src/utils/3d/model3d-spec:46` | 单 mesh 数据（Go spec meshGroups 结构近似） |
| `buildSpecFromModel()` | `frontend/src/utils/3d/model3d-spec:67` | 构建 Three.js 可消费的 spec 结构 { bones[], meshes[] } |
| `TdKeyAction()` | `frontend/src/utils/3d/model3d` | — |
| `DEFAULT_TD_KEYMAP()` | `frontend/src/utils/3d/model3d` | — |
| `loadTdKeymap()` | `frontend/src/utils/3d/model3d` | — |
| `loadTdCamSpeed()` | `frontend/src/utils/3d/model3d` | — |
| `loadTdRotMode()` | `frontend/src/utils/3d/model3d` | — |
| `SpecBone3D()` | `frontend/src/utils/3d/model3d:11` | — |
| `SpecMeshGroup3D()` | `frontend/src/utils/3d/model3d:23` | — |
| `Spec3D()` | `frontend/src/utils/3d/model3d:43` | — |
| `BoneSelectInfo()` | `frontend/src/utils/3d/model3d:48` | 骨骼选中信息（window._3dOnBoneSelect 回调参数） |
| `BoneMaps()` | `frontend/src/utils/3d/model3d:62` | 骨骼层级映射（dispatch 拾取归属用，ADR-093 T5） |
| `JavaModelFace()` | `frontend/src/utils/3d/parse-java-model:44` | 单面解析产物（像素坐标 + Three 域 UV） |
| `JavaModelResult()` | `frontend/src/utils/3d/parse-java-model:59` | — |
| `PackEntryReader()` | `frontend/src/utils/3d/parse-java-model:73` | 条目读取器：Go binding ReadPackEntry 包装（返回 base64 或 null） |
| `modelEntryFor()` | `frontend/src/utils/3d/parse-java-model:93` | 模型名 → 条目路径（无命名空间默认 minecraft） |
| `parseJavaModel()` | `frontend/src/utils/3d/parse-java-model:310` | 解析资源包内 block/item 模型（parent 链递归）。 |
| `isRenderableModel()` | `frontend/src/utils/3d/parse-java-model:339` | 判定模型是否"完整可渲染"：至少一个面有纹理或纯色（纯模板如 cube/cube_all 返回 false） |
| `BeatDetectorLike()` | `frontend/src/utils/3d/perception/autodance:18` | 节拍 detector 接口（抽象，解耦具体实现） |
| `AutoDanceOptions()` | `frontend/src/utils/3d/perception/autodance:26` | AutoDance 配置 |
| `createAutoDanceController()` | `frontend/src/utils/3d/perception/autodance:69` | — |
| `BeatDetectorOptions()` | `frontend/src/utils/3d/perception/beat-detector:27` | 节拍检测配置 |
| `createBeatDetector()` | `frontend/src/utils/3d/perception/beat-detector:68` | 构建节拍 detector。 |
| `BlinkCallback()` | `frontend/src/utils/3d/perception/blink:24` | 眨眼 callback：被 controller 在眨眼周期内周期性调用，传入当前权重（0→1→0） |
| `BlinkOptions()` | `frontend/src/utils/3d/perception/blink:42` | — |
| `createBlinkController()` | `frontend/src/utils/3d/perception/blink:55` | 构建眨眼 controller。 |
| `createBreathController()` | `frontend/src/utils/3d/perception/breath:48` | 构建呼吸 controller：每次 build 调用一次，持有闭包 state |
| `createGazeController()` | `frontend/src/utils/3d/perception/gaze:35` | — |
| `LipSyncCallback()` | `frontend/src/utils/3d/perception/lipsync:26` | 单 morph 回调：消费方写入具体格式的 morph weight |
| `MultiLipSyncCallback()` | `frontend/src/utils/3d/perception/lipsync:29` | 多 morph 回调：(morphId, weight) → 消费方写入 |
| `LipSyncOptions()` | `frontend/src/utils/3d/perception/lipsync:36` | — |
| `createLipSyncController()` | `frontend/src/utils/3d/perception/lipsync:51` | 构建 LipSync controller。 |
| `buildLipMorphIndices()` | `frontend/src/utils/3d/perception/lipsync:132` | 从 SemanticMorphMap 提取口型 morph index 映射（供消费方使用）。 |
| `eulerToQuaternion()` | `frontend/src/utils/3d/quaternion:15` | 欧拉角（度）→ 四元数，旋转顺序: Rz * Ry * Rx (ZYX intrinsic = XYZ extrinsic)。 |
| `isIdentityQuat()` | `frontend/src/utils/3d/quaternion:78` | 判定四元数是否≈单位四元数（浮点 epsilon）。 |
| `hasBoneRotation()` | `frontend/src/utils/3d/quaternion:89` | 判定骨骼旋转是否实际生效（四元数 ≠ 单位四元数，epsilon 口径）。 |
| `applyRotationIfNonIdentity()` | `frontend/src/utils/3d/quaternion:102` | 若旋转四元数非单位四元数，则赋值到 Three.js 对象的 quaternion；单位四元数跳过（保持默认）。 |
| `MAX_PIXEL_RATIO_KEY()` | `frontend/src/utils/3d/render-budget:5` | — |
| `getMaxPixelRatio()` | `frontend/src/utils/3d/render-budget:10` | 读取用户设置的渲染分辨率上限（设置面板 slider 持久化）；缺省 1.5。 |
| `PREVIEW_FRAME_INTERVAL_MS()` | `frontend/src/utils/3d/render-budget:17` | — |
| `MAX_FPS_KEY()` | `frontend/src/utils/3d/render-budget:23` | — |
| `invalidateMaxFpsCache()` | `frontend/src/utils/3d/render-budget:30` | — |
| `getMaxFps()` | `frontend/src/utils/3d/render-budget:33` | — |
| `getFrameIntervalMs()` | `frontend/src/utils/3d/render-budget:44` | 当前帧间隔（ms）：fps=0（不限制）→ 极小间隔（rAF 每帧都渲染）。 |
| `AdaptiveRenderBudget()` | `frontend/src/utils/3d/render-budget:52` | — |
| `previewPixelRatio()` | `frontend/src/utils/3d/render-budget:58` | — |
| `createAdaptiveRenderBudget()` | `frontend/src/utils/3d/render-budget:63` | — |
| `sampleAdaptivePixelRatio()` | `frontend/src/utils/3d/render-budget:74` | Returns a new pixel ratio only when sustained frame delivery is too slow. |
| `shouldRenderPreviewFrame()` | `frontend/src/utils/3d/render-budget:90` | — |
| `shouldRenderAtFps()` | `frontend/src/utils/3d/render-budget:101` | 帧率上限节流版：now 已到/过 nextFrame 才渲染。 |
| `addStandardSceneLights()` | `frontend/src/utils/3d/scene-lights:13` | 添加 3D 场景标准主灯（AmbientLight 0xffffff@1.0 + DirectionalLight 0xffffff@2 位于 [10,30,20]）。 |
| `ScreenshotOpts()` | `frontend/src/utils/3d/screenshot:13` | 截图选项 |
| `screenshotFromRenderer()` | `frontend/src/utils/3d/screenshot:27` | 从活跃的 renderer/scene/camera 截图，返回 PNG/JPEG base64（无 data: 前缀）。 |
| `SemanticBoneId()` | `frontend/src/utils/3d/semantic-bones:21` | 语义骨骼 id（对齐 VRM humanoid 命名；MMD 经候选名匹配；center 为 MMD 特有整体根） |
| `SEMANTIC_BONE_IDS()` | `frontend/src/utils/3d/semantic-bones:47` | 全部语义骨骼 id（稳定顺序：躯干 → 头颈 → 四肢；消费方遍历用） |
| `SemanticBoneEntry()` | `frontend/src/utils/3d/semantic-bones:74` | 语义骨骼解析结果：语义 → 格式内骨骼（object 可直接改变换；缺失 = 该语义缺省） |
| `SemanticBoneMap()` | `frontend/src/utils/3d/semantic-bones:82` | 语义骨骼映射表（Partial：匹配不到的语义缺省，消费方宽容降级） |
| `MMD_SEMANTIC_CANDIDATES()` | `frontend/src/utils/3d/semantic-bones:92` | MMD 语义候选名表：语义 → 候选骨骼名列表（MMD 命名空间；消费方不直接触达） |
| `matchSemanticBone()` | `frontend/src/utils/3d/semantic-bones:154` | 在 BoneTree 中按候选名匹配首个骨骼（name 优先、id 兜底；候选顺序即优先级）。 |
| `resolveSemanticBones()` | `frontend/src/utils/3d/semantic-bones:167` | 从 BoneTree + 候选表解析语义映射（MMD 等无标准语义的格式走此路）。 |
| `getSemanticBone()` | `frontend/src/utils/3d/semantic-bones:186` | 取语义骨骼（消费方唯一入口；缺失返回 null，调用方自行降级）。 |
| `vrmSemanticBoneMap()` | `frontend/src/utils/3d/semantic-bones:200` | VRM 特化：humanoid.humanBones 的键天然就是语义名（52 个标准骨骼）， 零候选匹配直接产映射——与 buildVrmBoneNodes 同一数据源。 |
| `mmdSemanticBoneMap()` | `frontend/src/utils/3d/semantic-bones:216` | MMD 特化：BoneTree（mmdBonesToBoneNodes → buildBoneTree 产物）+ 内置候选表 → 语义映射。 |
| `ysmSemanticBoneMap()` | `frontend/src/utils/3d/semantic-bones:303` | YSM 特化：从 SpecBone3D[]（spec.models[].bones[]）构建语义映射。 |
| `SemanticMorphId()` | `frontend/src/utils/3d/semantic-morphs:14` | 语义 morph id（对齐 MMD 标准表情 + VRM 标准 expression） |
| `SEMANTIC_MORPH_IDS()` | `frontend/src/utils/3d/semantic-morphs:24` | 全部语义 morph id（稳定顺序） |
| `SemanticMorphEntry()` | `frontend/src/utils/3d/semantic-morphs:30` | 语义 morph 解析结果 |
| `SemanticMorphMap()` | `frontend/src/utils/3d/semantic-morphs:36` | 语义 morph 映射表（Partial：匹配不到的语义缺省） |
| `MMD_SEMANTIC_MORPH_CANDIDATES()` | `frontend/src/utils/3d/semantic-morphs:43` | MMD 语义 morph 候选名表 |
| `matchSemanticMorph()` | `frontend/src/utils/3d/semantic-morphs:60` | 在 morph 名列表中按候选名匹配首个语义 morph（候选顺序 = 优先级）。 |
| `resolveSemanticMorphs()` | `frontend/src/utils/3d/semantic-morphs:70` | 从 morph 名列表 + 候选表解析语义 morph 映射（MMD 等无标准语义的格式走此路）。 |
| `mmdSemanticMorphMap()` | `frontend/src/utils/3d/semantic-morphs:87` | MMD 特化：pmx.morphs[].name 列表 → 语义 morph 映射。 |
| `getSemanticMorph()` | `frontend/src/utils/3d/semantic-morphs:95` | 取语义 morph 条目（消费方唯一入口；缺失返回 null）。 |
| `Vec3()` | `frontend/src/utils/3d/spec-builder:23` | vec3 — Go threejs/spec.go L55 |
| `Cube2D()` | `frontend/src/utils/3d/spec-builder:30` | Cube2D — Go types/bedrock.go Cube2D |
| `BedrockModel()` | `frontend/src/utils/3d/spec-builder:56` | BedrockModel — Go types/bedrock.go BedrockModel |
| `SubModel()` | `frontend/src/utils/3d/spec-builder:72` | SubModel 子模型条目（Go types/bedrock.go SubModel）。 |
| `ModelGroup()` | `frontend/src/utils/3d/spec-builder:87` | ModelGroup — Go threejs/spec.go ModelGroup |
| `BoneData()` | `frontend/src/utils/3d/spec-builder:99` | BoneData — Go threejs/spec.go BoneData |
| `MeshData()` | `frontend/src/utils/3d/spec-builder:109` | MeshData — Go threejs/spec.go MeshData |
| `buildSpecFromGeometryJSON()` | `frontend/src/utils/3d/spec-builder:128` | 从 bedrock geometry JSON 构建 3D spec（纯 TS，无 Go 依赖）。 |
| `TextureAlphaMode()` | `frontend/src/utils/3d/texture-alpha:4` | — |
| `TextureAlphaInfo()` | `frontend/src/utils/3d/texture-alpha:7` | 纹理级透明信息：整图模式 + 面级查询索引（ADR-118 Phase B） |
| `getTextureAlphaInfo()` | `frontend/src/utils/3d/texture-alpha:17` | — |
| `getTextureAlphaMode()` | `frontend/src/utils/3d/texture-alpha:35` | Classify alpha once per cached texture so material setup can choose a render path. |
| `TextureCacheImpl()` | `frontend/src/utils/3d/texture-cache:17` | — |
| `textureCache()` | `frontend/src/utils/3d/texture-cache:70` | 全局单例（随 3D 会话生命周期；disposeAll 由 cleanup-3d.ts 调用） |
| `VrmMaterialListItem()` | `frontend/src/utils/3d/vrm-materials:11` | 材质列表项（listVrmMaterials） |
| `VrmMaterialDetail()` | `frontend/src/utils/3d/vrm-materials:17` | 材质详情（getVrmMaterialDetail） |
| `listVrmMaterials()` | `frontend/src/utils/3d/vrm-materials:28` | 材质列表：vrm.scene 遍历所有 Mesh.material（含数组材质） |
| `setVrmMaterialVisible()` | `frontend/src/utils/3d/vrm-materials:38` | 材质显隐：Material.visible（MToon/标准/基础均支持） |
| `setVrmMaterialOpacity()` | `frontend/src/utils/3d/vrm-materials:48` | 材质透明度（0-1）：opacity 设置 + transparent 联动 |
| `getVrmMaterialDetail()` | `frontend/src/utils/3d/vrm-materials:62` | 材质详情：name/可见/透明/类型（越界返回 null） |
| `YsmAnimPlayer()` | `frontend/src/utils/3d/ysm-animation-player:32` | — |
| `createYsmAnimPlayer()` | `frontend/src/utils/3d/ysm-animation-player:281` | Builds a YSM animation player whose per-frame path reuses every temporary object. |
| `YsmObjectHandle()` | `frontend/src/utils/3d/ysm-object:25` | YSM 内容场景句柄：挂进任意 scene 后的内容层操作与释放 |
| `buildYsmObject()` | `frontend/src/utils/3d/ysm-object:50` | 构建 YSM 内容场景图：spec → rootGroup（骨骼分组 + 网格挂载 + 纹理绑定）。 |
| `animateNumber()` | `frontend/src/utils/animation/animate:15` | 里程表滚动进位动画 |
| `ControllerTransition()` | `frontend/src/utils/animation/animation-controller:10` | 状态转换定义 |
| `ControllerState()` | `frontend/src/utils/animation/animation-controller:22` | 单个状态定义 |
| `AnimationController()` | `frontend/src/utils/animation/animation-controller:36` | 动画控制器（状态机） |
| `parseAnimationControllerJSON()` | `frontend/src/utils/animation/animation-controller:52` | 解析 Bedrock Animation Controller JSON |
| `AnimationControllerRuntime()` | `frontend/src/utils/animation/animation-controller:159` | 动画控制器运行时：维护当前状态，每帧评估转换条件。 |
| `findControllerForAnimation()` | `frontend/src/utils/animation/animation-controller:260` | 从多个控制器中查找匹配指定动画名的控制器。 |
| `Vec3()` | `frontend/src/utils/animation/animation:12` | 三维向量 [x, y, z] |
| `MolangAxes()` | `frontend/src/utils/animation/animation:15` | Molang 轴三元组（null = 该轴为纯数字，取 Keyframe 对应轴值） |
| `Keyframe()` | `frontend/src/utils/animation/animation:18` | 关键帧 |
| `BoneChannels()` | `frontend/src/utils/animation/animation:29` | 单骨骼三通道 |
| `TimelineEvent()` | `frontend/src/utils/animation/animation:37` | Timeline 事件：时间戳 → Molang 表达式（字符串或字符串数组） |
| `AnimationClip()` | `frontend/src/utils/animation/animation:45` | — |
| `BoneTransform()` | `frontend/src/utils/animation/animation:56` | 骨骼变换（evaluateClip 结果值） |
| `BoneHierarchyNode()` | `frontend/src/utils/animation/animation:66` | 骨骼层级节点 |
| `parseBedrockAnimationJSON()` | `frontend/src/utils/animation/animation:473` | 解析完整的基岩版动画 JSON 字符串 |
| `evaluateKeyframes()` | `frontend/src/utils/animation/animation:549` | 在指定时间 t 对一组关键帧求值 |
| `executeTimeline()` | `frontend/src/utils/animation/animation:613` | 执行 timeline 事件：找出 [prevTime, currentTime] 区间内触发的事件并执行。 |
| `evaluateClip()` | `frontend/src/utils/animation/animation:645` | 对整个动画 clip 在指定时间求值（支持骨骼层级） |
| `ysmAnimClipLabels()` | `frontend/src/utils/animation/animation:778` | YSM 动画 clip 播放列表标签策略（ADR-100 L3 全 clip 列表）。 |
| `Easings()` | `frontend/src/utils/animation/molang-lib/easing:2` | — |
| `Molang()` | `frontend/src/utils/animation/molang-lib/molang:11` | — |
| `MolangFn()` | `frontend/src/utils/animation/molang:18` | Molang 求值函数：入参为当前动画时间（秒，即 query.anim_time） |
| `setMolangScope()` | `frontend/src/utils/animation/molang:39` | 设置/清除当前持久变量作用域。 |
| `compileMolang()` | `frontend/src/utils/animation/molang:71` | 编译 Molang 表达式为求值闭包。 |
| `stagger()` | `frontend/src/utils/animation/stagger:11` | — |
| `moveItem()` | `frontend/src/utils/array:8` | 将 arr[from] 移到 arr[to]（原地修改，返回同一数组）。 |
| `LoadGuard()` | `frontend/src/utils/async/load-guard:7` | — |
| `createLoadGuard()` | `frontend/src/utils/async/load-guard:16` | — |
| `CachePolicy()` | `frontend/src/utils/cache/with-cached:15` | 缓存策略 |
| `withCached()` | `frontend/src/utils/cache/with-cached:48` | 带过期时间的异步缓存包装器 策略行为（优先级从高到低）： FORCE  — 忽略缓存，强制重新计算（不写入缓存） STALE  — 命中缓存直接返回；过期则立即返回旧值 + 后台刷 |
| `invalidateCache()` | `frontend/src/utils/cache/with-cached:131` | 清除指定缓存条目 |
| `clearAllCache()` | `frontend/src/utils/cache/with-cached:139` | 清除所有缓存 |
| `getCacheTtlMs()` | `frontend/src/utils/cache/with-cached:157` | 获取缓存条目的剩余 TTL（毫秒），未命中或已过期返回 -1 |
| `swallowError()` | `frontend/src/utils/core/async:11` | 吞掉 promise 的异常并记录日志（比空 `.catch(() =&gt; {})` 可调试）。 |
| `fireAndForget()` | `frontend/src/utils/core/async:16` | 启动一个异步操作但不等待，异常由 swallowError 兜底。 |
| `delay()` | `frontend/src/utils/core/async:21` | Promise 包装的延迟。 |
| `waitForFrame()` | `frontend/src/utils/core/async:26` | Promise 包装的等待下一帧。 |
| `makeLazyLoader()` | `frontend/src/utils/core/async:36` | 创建惰性动态 import 加载器（带并发守卫 + 失败重试）。 |
| `LoadingGuard()` | `frontend/src/utils/core/async:70` | 并发加载守卫——防止同一 key 的异步操作重复触发。 |
| `DebouncedTimer()` | `frontend/src/utils/core/async:102` | 防抖定时器——封装 setTimeout 的 schedule/cancel 样板。 |
| `Abortable()` | `frontend/src/utils/core/async:137` | 可复用的 AbortController 封装——abort 后自动重置，使对象可重复使用。 |
| `clamp()` | `frontend/src/utils/core/clamp:5` | — |
| `clampInt()` | `frontend/src/utils/core/clamp:9` | — |
| `clamp01()` | `frontend/src/utils/core/clamp:13` | — |
| `lerp()` | `frontend/src/utils/core/clamp:18` | 线性插值。 |
| `lerpArray()` | `frontend/src/utils/core/clamp:23` | 逐元素线性插值数组。 |
| `clampPct()` | `frontend/src/utils/core/clamp:28` | 百分比钳制到 [0, 100]。 |
| `debounce()` | `frontend/src/utils/core/debounce:8` | 函数防抖：在等待指定时间后才执行函数，如果在等待期间再次调用则重置计时器。 |
| `Disposable()` | `frontend/src/utils/core/disposable:5` | 可释放资源的统一契约。 |
| `addDisposableListener()` | `frontend/src/utils/core/disposable:13` | 添加事件监听器并返回 Disposable，便于在 dispose 链路中统一释放。 |
| `logWarn()` | `frontend/src/utils/core/log:5` | 统一告警日志。tag 用于按模块聚合排查；err 可为任意错误值。 |
| `logError()` | `frontend/src/utils/core/log:11` | 统一错误日志。 |
| `dbg()` | `frontend/src/utils/debug/debug:38` | 输出调试日志（保留 tag 用于过滤） |
| `safeStr()` | `frontend/src/utils/debug/debug:61` | 任意值 → 可读字符串（200 字符截断；供单测导出的纯函数） |
| `WailsAndroidBridge()` | `frontend/src/utils/dom/android-bridge:7` | — |
| `getAndroidBridge()` | `frontend/src/utils/dom/android-bridge:13` | 返回 Android Java 桥（桌面端为 null），类型安全断言（无 as any） |
| `isViewerMode()` | `frontend/src/utils/dom/android-bridge:24` | 查看器模式判定（ADR-049 Phase 3 能力门控统一入口）： Android（双端桥存在）或网页版（browser adapter）——均无本地文件系统写能力、 无桌面专属 |
| `registerAndroidBackHandler()` | `frontend/src/utils/dom/android-bridge:40` | 注册安卓返回键处理器，返回取消函数（供调用方在自身销毁/关闭时注销）。 |
| `emitAndroidBack()` | `frontend/src/utils/dom/android-bridge:53` | 系统返回键的前端触发入口：依次从栈顶触发已注册处理器。 |
| `can()` | `frontend/src/utils/dom/capabilities:30` | 当前平台是否可用指定 binding（web 查 adapter 实现；桌面恒 true；Android 查黑名单） |
| `copyText()` | `frontend/src/utils/dom/clipboard:6` | 复制纯文本到剪贴板：优先 Clipboard API（需要安全上下文），降级隐藏 textarea + execCommand |
| `refreshAdoptedStyleSheets()` | `frontend/src/utils/dom/css-hmr:13` | 热刷指定自定义元素的 Shadow DOM 样式表。 |
| `btnBaseCSS()` | `frontend/src/utils/dom/css:1` | — |
| `focusVisibleCSS()` | `frontend/src/utils/dom/css:32` | Shadow DOM 通用 focus-visible 规则（所有 button/input/select/textarea） |
| `AdvFilterValue()` | `frontend/src/utils/dom/dialogs/adv-filter-util:6` | 筛选条件 |
| `parseFilterNumber()` | `frontend/src/utils/dom/dialogs/adv-filter-util:21` | 解析范围输入框数字：空 / 非数字 / 负数 → null（null 表示不限制）。 |
| `validateAdvFilter()` | `frontend/src/utils/dom/dialogs/adv-filter-util:32` | 校验三组 min/max 范围（仅两端都填数字时比对），返回错误 i18n key 或 null。 |
| `AdvFilterValue()` | `frontend/src/utils/dom/dialogs/adv-filter` | — |
| `AdvFilterResult()` | `frontend/src/utils/dom/dialogs/adv-filter:19` | — |
| `modalAdvFilter()` | `frontend/src/utils/dom/dialogs/adv-filter:181` | — |
| `rebuildParsedName()` | `frontend/src/utils/dom/dialogs/batch-rename-util:16` | 按 YSM 命名规范重建文件名：`[作者]【作品】角色 (日期).ext(.disabled)` - 作者/作品空值跳过；角色缺省回退到「剥禁用尾缀与扩展名后的文件名」； - 扩展 |
| `ReplaceResult()` | `frontend/src/utils/dom/dialogs/batch-rename-util:31` | — |
| `applyReplaceToName()` | `frontend/src/utils/dom/dialogs/batch-rename-util:41` | 查找替换：分离扩展名，仅对文件名主体做替换。 |
| `BatchRenameChange()` | `frontend/src/utils/dom/dialogs/batch-rename:21` | 应用变更载荷 |
| `showBatchRenameDialog()` | `frontend/src/utils/dom/dialogs/batch-rename:438` | — |
| `trapFocus()` | `frontend/src/utils/dom/dialogs/modal:25` | 焦点陷阱：Tab 键在弹窗内可聚焦元素间循环，防止焦点逃逸到背后页面 |
| `closeDlg()` | `frontend/src/utils/dom/dialogs/modal:53` | 带退场动画关闭对话框 |
| `__resetModalStateForTest()` | `frontend/src/utils/dom/dialogs/modal:81` | 测试钩子：重置活动弹窗单例槽位（isolate:false 共享模块图下，兄弟文件残留的 _activeOverlay 会让「无活动弹窗」断言失真；web-store.__rese |
| `registerDlg()` | `frontend/src/utils/dom/dialogs/modal:88` | 弹窗 append 到 body 后调用，登记为当前活动弹窗 |
| `closeActiveDialog()` | `frontend/src/utils/dom/dialogs/modal:104` | 关闭当前活动弹窗（按取消值结算）。返回是否关闭了弹窗。 |
| `ModalPromptOptions()` | `frontend/src/utils/dom/dialogs/modal:185` | modalPrompt 选项 |
| `modalPrompt()` | `frontend/src/utils/dom/dialogs/modal:263` | 弹出带输入框的模态框，类似 styled prompt() |
| `ModalSelectOptions()` | `frontend/src/utils/dom/dialogs/modal:282` | modalSelect 选项 |
| `modalSelect()` | `frontend/src/utils/dom/dialogs/modal:351` | 弹出下拉选择框 |
| `ModalConfirmOptions()` | `frontend/src/utils/dom/dialogs/modal:367` | modalConfirm 选项 |
| `modalConfirm()` | `frontend/src/utils/dom/dialogs/modal:422` | 弹出确认对话框 |
| `ModalProgressOptions()` | `frontend/src/utils/dom/dialogs/modal:435` | — |
| `ModalProgressHandle()` | `frontend/src/utils/dom/dialogs/modal:443` | — |
| `fmtMB()` | `frontend/src/utils/dom/dialogs/modal:450` | 格式化字节为 MB（进度弹窗/窗口标题共用） |
| `modalProgress()` | `frontend/src/utils/dom/dialogs/modal:533` | 只读进度弹窗（无确认/取消按钮，Esc 或点遮罩关闭）。 |
| `RenameFields()` | `frontend/src/utils/dom/dialogs/rename-format:7` | 重命名字段（调用方已 trim） |
| `BuildModelNameOptions()` | `frontend/src/utils/dom/dialogs/rename-format:21` | 命名模板引擎选项（索引 4.9 收敛 buildRenameName / rebuildParsedName 两套手工拼接）： - fillDefaults=true：空作品补「未 |
| `ModelNameFields()` | `frontend/src/utils/dom/dialogs/rename-format:27` | 命名模板输入字段（variant 可选：单重命名有、批量重建无） |
| `buildModelName()` | `frontend/src/utils/dom/dialogs/rename-format:40` | 按 YSM 命名规范拼接文件名：`[作者]【作品】角色[-变体] (年月).ext[.disabled]` 单一模板引擎——buildRenameName（缺省填充）与 rebui |
| `buildRenameName()` | `frontend/src/utils/dom/dialogs/rename-format:60` | 按 YSM 命名规范拼接新文件名：`[作者]【品牌】角色-变体 (年月).ext` 品牌缺省「未知」、角色缺省「?」，与预览一致（收敛自 buildModelName，索引 4.9 |
| `showRenameDialog()` | `frontend/src/utils/dom/dialogs/rename:210` | 弹出重命名对话框 |
| `modalTagEditor()` | `frontend/src/utils/dom/dialogs/tag-editor:220` | 弹出标签编辑弹窗 |
| `TagSetResult()` | `frontend/src/utils/dom/dialogs/tag-set:6` | — |
| `MAX_TAG_LENGTH()` | `frontend/src/utils/dom/dialogs/tag-set:12` | 标签最大长度（与原 addTag 一致） |
| `addTagToSet()` | `frontend/src/utils/dom/dialogs/tag-set:19` | 向标签集合添加一个标签（已 trim）： 空输入 → 原样返回；重复 → error「标签已存在」；超长 → error「最多 20 个字符」； 合法 → 排序后返回新数组。错误文 |
| `resolveAndroidRepoDir()` | `frontend/src/utils/dom/directory-picker:26` | Android 共享仓库目录解析（双端桥接：授权引导 + 定位公共目录）。 |
| `pickDirectory()` | `frontend/src/utils/dom/directory-picker:66` | 选择目录：桌面走系统对话框；查看器模式（Android/网页版）走授权检查 + 自动定位公共目录 |
| `stripDisableSuffix()` | `frontend/src/utils/dom/display:14` | 剥离禁用后缀（.disabled / .ban，大小写不敏感）。 |
| `stripBanSuffix()` | `frontend/src/utils/dom/display:19` | 剥离禁用后缀（.disabled / .ban，大小写不敏感）。 |
| `ParsedModelName()` | `frontend/src/utils/dom/display:22` | 解析后的模型文件名字段 |
| `parseModelName()` | `frontend/src/utils/dom/display:61` | 解析模型文件名 → 结构化字段 支持格式: [作者]【作品】角色变体2023-05.ysm 也兼容: [作者]《作品》角色变体2023-05.ysm |
| `renderDisplayName()` | `frontend/src/utils/dom/display:130` | 渲染美化文件名 HTML（通用接口） 应用 CSS 变量: --meta-author, --meta-work, --meta-date |
| `renderModelName()` | `frontend/src/utils/dom/display:199` | renderModelName = renderDisplayName 别名，options.showExt 支持 |
| `renderModelNameWithHighlight()` | `frontend/src/utils/dom/display:208` | 搜索高亮版：先对纯文本高亮，再渲染 HTML，避免 keyword 命中 HTML 标签内容破坏 DOM |
| `friendlyError()` | `frontend/src/utils/dom/errors:44` | 将 Go 错误转换为友好提示 |
| `stripPathSegments()` | `frontend/src/utils/dom/errors:72` | — |
| `isFileExistsError()` | `frontend/src/utils/dom/errors:87` | 判断错误消息是否为「文件已存在」冲突（索引 4.2 收敛）。 |
| `YSW_FAB_CSS()` | `frontend/src/utils/dom/fab:7` | — |
| `ensureFabStyles()` | `frontend/src/utils/dom/fab:76` | 幂等注入 overlay 全局样式到 head（overlay 挂 body，light DOM 需全局 CSS 生效） |
| `IconButtonOpts()` | `frontend/src/utils/dom/fab:91` | — |
| `createIconButton()` | `frontend/src/utils/dom/fab:105` | 图标按钮工厂（ADR-057 §2.6）：统一 emoji/图标按钮，集中可达性；用 textContent 防 XSS。 |
| `FLASH_DURATION_MS()` | `frontend/src/utils/dom/feedback:10` | 默认闪烁时长（ms） |
| `FlashOptions()` | `frontend/src/utils/dom/feedback:13` | 闪烁反馈配置 |
| `flashBtn()` | `frontend/src/utils/dom/feedback:28` | 按钮/行闪烁反馈：加 flash class，duration 后移除。 |
| `formatBytes()` | `frontend/src/utils/dom/format:11` | 字节数 → 可读大小（B/KB/MB/GB），非法值或 0 返回空串 |
| `sizeColor()` | `frontend/src/utils/dom/format:23` | 文件大小颜色 class：&lt;1MB 绿色，1-3MB 正常，≥3MB 红色 |
| `fmtDate()` | `frontend/src/utils/dom/format:35` | 时间戳 → 友好日期：今天显时间，今年显 M月D日，往年显 YYYY/M/D |
| `esc()` | `frontend/src/utils/dom/html:4` | HTML 转义（治理红线：所有 innerHTML 拼接必须过 esc） |
| `safeGet()` | `frontend/src/utils/dom/storage:7` | 安全读：存储不可用时返回 null（调用方走默认值回退） |
| `safeSet()` | `frontend/src/utils/dom/storage:16` | 安全写：存储不可用时静默忽略持久化（不中断调用方） |
| `safeRemove()` | `frontend/src/utils/dom/storage:25` | 安全删：存储不可用时静默忽略（不中断调用方） |
| `TOAST_MS()` | `frontend/src/utils/dom/toast-ms:6` | — |
| `ToastType()` | `frontend/src/utils/dom/toast-ms:26` | toast:show 的 type 取值域（与 ToastPayload.type 对齐） |
| `YSW_TOOLTIP_CSS()` | `frontend/src/utils/dom/tooltip:9` | — |
| `ensureTooltipStyles()` | `frontend/src/utils/dom/tooltip:17` | 幂等注入 tooltip 全局样式到 head（模式同 ensureFabStyles） |
| `TooltipOptions()` | `frontend/src/utils/dom/tooltip:101` | — |
| `attachTooltip()` | `frontend/src/utils/dom/tooltip:110` | 给元素挂悬浮提示，返回 cleanup 函数（摘除全部监听并隐藏）。 |
| `promoteTitle()` | `frontend/src/utils/dom/tooltip:149` | 把元素上的原生 title 升级为自定义 tooltip（模板里已写 title 的按钮一行接入）。 |
| `promoteTitleIfPresent()` | `frontend/src/utils/dom/tooltip:158` | promoteTitle + 空值守卫（querySelector 结果可能为 null 的绑定点一行接入） |
| `calcVisibleRange()` | `frontend/src/utils/dom/virtual-scroll:17` | 根据滚动位置计算可见行范围。 |
| `installScrollSync()` | `frontend/src/utils/dom/virtual-scroll:36` | 在滚动容器上安装监听，滚动时经 rAF 合并后触发重渲（一帧最多一次）。 |
| `WebComponentBase()` | `frontend/src/utils/dom/web-component-base:7` | — |
| `renderFormattedText()` | `frontend/src/utils/format/mc-format:45` | 将含 Minecraft § 分节符的文本渲染为带颜色的 HTML。 |
| `PackMeta()` | `frontend/src/utils/format/pack-format:95` | ReadPackMeta 返回的 JSON 对象（仅覆盖用到的字段） |
| `describeVersionRange()` | `frontend/src/utils/format/pack-format:108` | 根据 meta 对象生成格式号 + 版本号描述 拼接用「 / 」作分隔符，避免出现 "1.9 ~ 1.10.2 ~ 1.11" 的四段歧义串。 |
| `SummaryAuthor()` | `frontend/src/utils/format/summarize:10` | — |
| `SummaryAnimGroup()` | `frontend/src/utils/format/summarize:16` | — |
| `SummaryConfigMenu()` | `frontend/src/utils/format/summarize:22` | — |
| `YsmSummary()` | `frontend/src/utils/format/summarize:27` | — |
| `YSMHeader()` | `frontend/src/utils/format/summarize:52` | — |
| `summaryCardHTML()` | `frontend/src/utils/format/summarize:156` | 从 YsmSummary + YSMHeader 渲染为精简摘要卡片 |
| `DecodedStats()` | `frontend/src/utils/format/summarize:283` | 解码统计结果（原 spike 侧 YsmSummary，改名避免与上方元数据接口撞名） |
| `findBones()` | `frontend/src/utils/format/summarize:295` | 递归找第一个数组（骨骼列表通常嵌在 model/bones 等层级）。 |
| `summarizeDecoded()` | `frontend/src/utils/format/summarize:313` | 解析 main.json 提取骨骼/几何摘要（只做统计，不渲染） |
| `YsmProperties()` | `frontend/src/utils/format/ysm-anim-config:14` | WASM 解码产物 ysm.json 的 properties 相关字段（仅取本模块需要的部分） |
| `extractAnimGroupsAndConfigs()` | `frontend/src/utils/format/ysm-anim-config:34` | 从 ysm.json properties 提取动画分组与配置菜单。 |
| `GH_REPO()` | `frontend/src/utils/gh-links:5` | — |
| `GH_RELEASES()` | `frontend/src/utils/gh-links:6` | — |
| `GH_DOCS()` | `frontend/src/utils/gh-links:7` | — |
| `fileIcon()` | `frontend/src/utils/icon/icon:36` | 按扩展名返回图标 emoji |
| `isYsmName()` | `frontend/src/utils/icon/icon:52` | 是否为 YSM 文件 |
| `ICONS()` | `frontend/src/utils/icon/workshop-icons:3` | — |
| `getSiteIcon()` | `frontend/src/utils/icon/workshop-icons:46` | — |
| `getTagIconFromRole()` | `frontend/src/utils/icon/workshop-icons:54` | — |
| `LongTaskInfo()` | `frontend/src/utils/main-thread-watch:11` | longtask 最小报告结构（duration 单位 ms） |
| `startMainThreadWatch()` | `frontend/src/utils/main-thread-watch:24` | 启动主线程长任务观测，返回 stop 函数（disconnect + 清回调）。 |
| `formatLongTask()` | `frontend/src/utils/main-thread-watch:63` | 便捷格式化：LongTaskInfo → 环形日志消息串。 |
| `loadView()` | `frontend/src/utils/module-loader:14` | 懒加载 Web Component：统一动态 import + 加载失败 toast 反馈。 |
| `RESOURCE_EXTS()` | `frontend/src/utils/resource/extensions:16` | 每种资源类型对应的扩展名（从 resource_types.json 派生，单一事实来源） |
| `ALL_EXTS()` | `frontend/src/utils/resource/extensions:21` | 所有支持的扩展名列表（去重，用于 UI 提示文案） |
| `getExts()` | `frontend/src/utils/resource/extensions:36` | 获取某资源类型支持的扩展名 |
| `isSupportedExt()` | `frontend/src/utils/resource/extensions:41` | 检查扩展名是否被某资源类型支持 |
| `extBelongsTo()` | `frontend/src/utils/resource/extensions:46` | 返回扩展名所属的资源类型 ID |
| `ResourceTypeEntry()` | `frontend/src/utils/resource/registry:10` | 资源类型注册表条目（对应 resource_types.json 结构）。extends ResourceType 共享已知字段， 保留 index signature 以容忍 G |
| `loadResourceRegistry()` | `frontend/src/utils/resource/registry:20` | 加载资源类型注册表（失败不缓存：Go 桥瞬断后下次调用重试，避免整会话降级） |
| `ZipEntryMatch()` | `frontend/src/utils/resource/schema:17` | 压缩容器条目指纹（zipEntries）：name 为段模式，match 为 exact/prefix/suffix |
| `ResourceTypeVariant()` | `frontend/src/utils/resource/schema:23` | 预览变体（variants：.pmx→mmd / .vrm→vrm / .pmd→mmd 等适配器路由） |
| `ResourceType()` | `frontend/src/utils/resource/schema:29` | 资源类型（前端消费视图，resource_types.json 字段子集 — 单一事实来源） |
| `allResourceTypes()` | `frontend/src/utils/resource/schema:55` | 全部资源类型条目（types.ts / extensions.ts 共同消费，单一来源） |
| `shortLabelOf()` | `frontend/src/utils/resource/short-label:24` | 资源类型短标签：map 命中 → 短名；否则全名（RESOURCE_TYPE_LABELS）→ 原始 id（兜底） |
| `RESOURCE_TYPES()` | `frontend/src/utils/resource/types:9` | 资源类型 ID（键为类型标签，值为内部 ID） |
| `RESOURCE_TYPE_LABELS()` | `frontend/src/utils/resource/types:28` | 资源类型显示标签（内部 ID → 中文名） |
| `ALL_RESOURCE_TYPES()` | `frontend/src/utils/resource/types:47` | 全部资源类型 ID 列表（从 resource_types.json id 派生，单一事实来源） |
| `resolvePreviewKey()` | `frontend/src/utils/resource/types:56` | 按 variants 解析预览路由 key（ADR-111：类别—格式分层）。 |
| `resolvePreviewKeyToRtype()` | `frontend/src/utils/resource/types:72` | 预览键反解为资源类型 ID（ADR-111 逆向）。 |
| `GROUP_META()` | `frontend/src/utils/resource/types:85` | 分组元数据（id → {name, icon, order}），从各类型 group 字段派生 |
| `GROUP_OF()` | `frontend/src/utils/resource/types:100` | 资源类型 → 所属分组 id（无 group 字段返回空串 = 单级平铺） |
| `groupLabelOf()` | `frontend/src/utils/resource/types:106` | 分组 id → 显示名 |
| `GroupTypeOption()` | `frontend/src/utils/resource/types:116` | 大类(group) → 其下资源类型选项（ADR-092 双下拉导航第二级）。 |
| `GROUP_TYPE_OPTIONS()` | `frontend/src/utils/resource/types:121` | — |
| `groupStorageRootOf()` | `frontend/src/utils/resource/types:137` | 资源类型在 FilesRoot 下的分组存储根目录（ADR-092 两层路由）。 |
| `extOf()` | `frontend/src/utils/resource/types:149` | 提取路径扩展名（小写、含点；无扩展名返回空串） |
| `NO_3D_TYPES()` | `frontend/src/utils/resource/types:184` | 无 3D 预览能力的资源类型集合（从 resource_types.json preview 字段派生）。 |
| `PreviewTab()` | `frontend/src/utils/resource/types:200` | 3D 切换面板类型 tab 的单一事实来源（ADR-111 收口）。 |
| `getPreviewableTypeTabs()` | `frontend/src/utils/resource/types:207` | — |
| `matchTypeByExt()` | `frontend/src/utils/resource/types:230` | 路径是否属于指定类型（按注册表 extensions 判定，不处理歧义扩展名） |
| `typeIconOf()` | `frontend/src/utils/resource/types:255` | 资源类型图标（从 resource_types.json 的 icon 字段派生——扩展点残留清单 #3： 原 icon.ts 手写 RTYPE_ICONS 与 JSON 漂移，新 |
| `isYsmWasmPreview()` | `frontend/src/utils/resource/types:260` | ysm 单文件（.ysm/.json）走前端 WASM 预览；.zip/.7z 容器由 Go FindPreviewImage 兜底 |
| `VOXEL_RPC_BY_EXT()` | `frontend/src/utils/resource/types:266` | 体素类（蓝图/投影）Go 体素数据 RPC 名称，按扩展名单点映射（ADR-066 解墙） |
| `AMBIGUOUS_EXTS()` | `frontend/src/utils/resource/types:277` | 歧义扩展名集合：同扩展名归属 ≥2 类型，禁止用 matchTypeByExt / resolveTypeByExt 直接定类型。 |
| `resolveTypeSafe()` | `frontend/src/utils/resource/types:290` | 安全解析类型（ADR-067）：单归属扩展名直接命中；歧义扩展名（.zip/.7z 等可包裹任意资源） 返回 null，调用方必须回退到 Go DetectResourceType |
| `matchZipEntryTS()` | `frontend/src/utils/resource/types:340` | 按注册表 zipEntries 指纹匹配 ZIP 条目名，返回命中的资源类型 ID（ADR-082 S4： 前端指纹注册表化，与 Go types.MatchZipEntry 同构 |
| `safeErrorMessage()` | `frontend/src/utils/safe-error-msg:19` | 从任意错误对象提取可读消息字符串。 |
| `WorkshopSite()` | `frontend/src/utils/types-re-export` | — |
| `WorkshopPresetSearch()` | `frontend/src/utils/types-re-export` | — |

## frontend/views

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `LocalCreator()` | `frontend/src/views/app-content/community-data:9` | 本地合并后的创作者（绑定 WorkshopCreator + 运行时附加字段） |
| `LocalAuthorLike()` | `frontend/src/views/app-content/community-data:18` | 绑定 LocalAuthor（合并来源） |
| `CommunityData()` | `frontend/src/views/app-content/community-data:25` | 站点 + 创作者 + 作者 数据包 |
| `forceRefreshCommunityMerge()` | `frontend/src/views/app-content/community-data:52` | 供测试强制刷新缓存 |
| `forceRefreshScanAuthors()` | `frontend/src/views/app-content/community-data:57` | 供测试清除扫描缓存 |
| `forceRefreshCommunitySites()` | `frontend/src/views/app-content/community-data:63` | 清除站点索引缓存 |
| `clearAllCommunityCache()` | `frontend/src/views/app-content/community-data:71` | 统一失效入口：数据变更时一次性清除所有社区相关缓存 供导入/同步/下载完成后调用，替代分散的 invalidateCache 调用 |
| `loadCommunityData()` | `frontend/src/views/app-content/community-data:90` | 加载站点 + 创作者数据（纯数据，不碰 DOM）——首屏快路径。 |
| `loadLocalAuthors()` | `frontend/src/views/app-content/community-data:133` | 本地作者扫描（后台补充路径）：withCached STALE——过期先返旧值再后台刷新， 不阻塞调用方；冷缓存时才真等扫描（Go 侧已轻量化为纯目录枚举）。 |
| `mergeLocalAuthorsInto()` | `frontend/src/views/app-content/community-data:149` | 把本地扫描提取的作者合并进创作者列表（原地合并，返回同一引用）。 |
| `fillSearch()` | `frontend/src/views/app-content/community-data:226` | 替换 &#123;&#123;q&#125;&#125; 为查询词 |
| `fetchCommunityCreators()` | `frontend/src/views/app-content/community-data:280` | 从 GitHub 拉取 creators.json（三路回退） |
| `mergeCommunityCreators()` | `frontend/src/views/app-content/community-data:309` | 合并社区索引到本地 creators.json |
| `fetchCommunitySites()` | `frontend/src/views/app-content/community-data:346` | 从 GitHub 拉取 workshop_sites.json（三路回退，withCached 30min TTL） |
| `mergeCommunitySites()` | `frontend/src/views/app-content/community-data:381` | 合并社区站点到本地 workshop_sites.json |
| `DEFAULT_COMMUNITY_URL()` | `frontend/src/views/app-content/community-data:402` | 社区索引的默认 URL（可配置为社区维护的独立 creators JSON） 贡献通道：https://github.com/eghrhegpe/ysm-model-manager |
| `contentCreatorCSS()` | `frontend/src/views/app-content/content-creator:2` | — |
| `contentCSS()` | `frontend/src/views/app-content/content-css:14` | — |
| `contentDiagCSS()` | `frontend/src/views/app-content/content-diag:4` | — |
| `contentLayoutCSS()` | `frontend/src/views/app-content/content-layout:10` | — |
| `contentRepoCSS()` | `frontend/src/views/app-content/content-repo:2` | — |
| `contentStgCSS()` | `frontend/src/views/app-content/content-stg:7` | — |
| `contentUtilCSS()` | `frontend/src/views/app-content/content-util:2` | — |
| `scanConflicts()` | `frontend/src/views/app-content/diagnostics/conflicts:139` | — |
| `scanSyncConflicts()` | `frontend/src/views/app-content/diagnostics/conflicts:232` | — |
| `initDedupConfig()` | `frontend/src/views/app-content/diagnostics/dedup:189` | 初始化去重配置面板（标签页打开时调用，配置实时保存） 扫描结果不覆盖面板，控件扫描后仍可改；code_review P3） |
| `startDedup()` | `frontend/src/views/app-content/diagnostics/dedup:537` | 去重结果容器统一显式传入（消除 mock root 包装 + 幽灵 id diag-dedup-list）。 |
| `runHealthAudit()` | `frontend/src/views/app-content/diagnostics/health:52` | 仓库体检：调 Go 端 RepoHealthAudit（当前类型单仓库审计）并渲染结果—— 动态感知当前资源类型（repo-rtype，等价树视图 vm._filesRoot 的类 |
| `parseHealthReport()` | `frontend/src/views/app-content/diagnostics/health:99` | 解析 RepoHealthAudit 返回的 JSON 字符串。 |
| `renderHealthReport()` | `frontend/src/views/app-content/diagnostics/health:125` | 渲染体检报告（分数环 + 完整性/缓存/资源/去重 + 警告），全部走 esc() 防注入 |
| `formatSize()` | `frontend/src/views/app-content/diagnostics/health:178` | 字节大小人性化——委托至 formatBytes（单一事实来源，消灭多处实现口径漂移） |
| `startDedup()` | `frontend/src/views/app-content/diagnostics/init` | — |
| `initDiagnostics()` | `frontend/src/views/app-content/diagnostics/init:207` | 初始化诊断页所有功能 |
| `EscFn()` | `frontend/src/views/app-content/diagnostics/logs:9` | 转义函数签名（单一事实源 = utils/dom/html.ts 的 esc；调用方以 (s) =&gt; esc(String(s || "")) 包装适配） |
| `loadDiagnosticsLogs()` | `frontend/src/views/app-content/diagnostics/logs:189` | — |
| `loadRuntimeLogs()` | `frontend/src/views/app-content/diagnostics/logs:209` | 加载运行时日志（watcher/sync 等标准库 log 输出） |
| `sectionHeader()` | `frontend/src/views/app-content/diagnostics/perf-cli:34` | 结果区段头（可选复制按钮：data-perf-copy 供事件委托识别） |
| `bindPerfCopyHandlers()` | `frontend/src/views/app-content/diagnostics/perf-cli:74` | — |
| `runSingleBench()` | `frontend/src/views/app-content/diagnostics/perf-cli:317` | — |
| `runGuiFlow()` | `frontend/src/views/app-content/diagnostics/perf-cli:432` | — |
| `runPerfLog()` | `frontend/src/views/app-content/diagnostics/perf-cli:513` | — |
| `renderLoadTraceSection()` | `frontend/src/views/app-content/diagnostics/perf-trace:18` | 渲染加载剖析区段（取最近一条 trace 渲染甘特图 + 资产清单） |
| `renderLoadTraceSection()` | `frontend/src/views/app-content/diagnostics/perf` | — |
| `initPerfPanel()` | `frontend/src/views/app-content/diagnostics/perf:14` | 初始化性能面板（single-bench / gui-flow / perf-log / 加载剖析） |
| `appContentStyle()` | `frontend/src/views/app-content/index:11` | — |
| `GithubPageCtx()` | `frontend/src/views/app-content/init-github:23` | GitHub 社群页编排上下文——把 initGithubPage 各闭包捕获的共享状态显式注入， 供 githubLoadRepos / githubShowRepo / git |
| `initGithubPage()` | `frontend/src/views/app-content/init-github:281` | 初始化 GitHub 页（纯分派：创建 ctx + 初始化缓存 + 触发 loadRepos） |
| `initDiagnosticsPage()` | `frontend/src/views/app-content/init-pages:21` | 初始化诊断页 |
| `initInstancesPage()` | `frontend/src/views/app-content/init-pages:28` | 初始化实例页 |
| `initWorkshopPage()` | `frontend/src/views/app-content/init-pages:288` | 初始化创意工坊页（委托到 init-workshop.ts） |
| `initGithubPage()` | `frontend/src/views/app-content/init-pages:295` | 初始化 GitHub 页（委托到 init-github.ts） |
| `rememberModelPath()` | `frontend/src/views/app-content/init-pages:303` | 记住最后选中的模型路径（供文件树等外部调用） |
| `getLastModelPath()` | `frontend/src/views/app-content/init-pages:307` | — |
| `initPreviewResize()` | `frontend/src/views/app-content/init-preview:8` | 初始化预览面板拖拽调整宽度 |
| `initWorkshopPage()` | `frontend/src/views/app-content/init-workshop:38` | 初始化创意工坊页（编排入口） |
| `resetAvatarConfigLoaded()` | `frontend/src/views/app-content/init-workshop:171` | 供 app-content disconnectedCallback 调用：回收 config-loaded 订阅并复位注册 flag |
| `AppContentHost()` | `frontend/src/views/app-content/init-workshop:182` | app-content 组件接口（供 workshop/github 初始化函数访问） |
| `PageDefinition()` | `frontend/src/views/app-content/page-registry:23` | — |
| `PAGE_REGISTRY()` | `frontend/src/views/app-content/page-registry:30` | — |
| `initSettings()` | `frontend/src/views/app-content/settings/init:311` | 初始化设置页所有事件绑定 |
| `initKeymap()` | `frontend/src/views/app-content/settings/keymap:130` | 初始化 3D 预览操作：键位网格 + 恢复默认 + 相机速度 + 默认旋转模式 |
| `saveCfg()` | `frontend/src/views/app-content/settings/path-cards:25` | — |
| `bindPathClick()` | `frontend/src/views/app-content/settings/path-cards:53` | — |
| `initAdvancedGrid()` | `frontend/src/views/app-content/settings/path-cards:194` | — |
| `initMcDetect()` | `frontend/src/views/app-content/settings/path-cards:319` | — |
| `SettingsCfg()` | `frontend/src/views/app-content/settings/store:11` | 设置页当前配置类型（LoadAppConfig 返回值，经 Wails $CancellablePromise 解包） |
| `cfg()` | `frontend/src/views/app-content/settings/store:14` | 当前配置：initSettings 加载后注入，各模块就地更新字段（saveCfg/检测/主题/链接模式） |
| `cardRefreshers()` | `frontend/src/views/app-content/settings/store:17` | 所有路径卡片的刷新函数列表（绑定后收集，重排/重置时统一调用） |
| `isBusy()` | `frontend/src/views/app-content/settings/store:21` | — |
| `setBusy()` | `frontend/src/views/app-content/settings/store:22` | — |
| `toastError()` | `frontend/src/views/app-content/settings/store:27` | — |
| `resetSettingsStore()` | `frontend/src/views/app-content/settings/store:36` | 重置模块级状态（initSettings 开头调用；重复执行时清空上次残留） |
| `initTheme()` | `frontend/src/views/app-content/settings/theme:24` | 初始化主题段：主题卡片点击切换 + 自动切换下拉框 |
| `applyUIPrefs()` | `frontend/src/views/app-content/settings/ui-prefs:12` | 应用 UI 偏好到 CSS 变量（字号/字体/密度/动画）——启动链与设置页共用（ADR-040 拆分去重） |
| `initUiPrefs()` | `frontend/src/views/app-content/settings/ui-prefs:52` | 初始化界面与体验设置：应用偏好 + 绑定字号/字体/密度/动画/默认页变更 |
| `initWorkerPrefs()` | `frontend/src/views/app-content/settings/worker-prefs:35` | 初始化 3D 解析 worker 开关：读取现有偏好回填 + 绑定变更 |
| `RepoAuthorLike()` | `frontend/src/views/app-content/site-view:13` | 作者计数条目（绑定 ListModelAuthors 元素：string 或 {Name, Count}） |
| `RenderSiteViewCtx()` | `frontend/src/views/app-content/site-view:16` | 竚点视图渲染上下文（index.ts _initWorkshop 传入） |
| `LocalCreatorLike()` | `frontend/src/views/app-content/site-view:43` | 本地创作者（绑定 + 运行时附加字段） |
| `renderSiteView()` | `frontend/src/views/app-content/site-view:54` | 站点视图渲染主入口 — 编排壳：构造数据 → 构 HTML → 绑事件 → 聚 cleanup。 |
| `bindDragEvents()` | `frontend/src/views/app-content/site/drag:14` | 绑定拖拽 JSON 导入事件：创作者 JSON / 站点 JSON 识别 + 合并。 |
| `bindEditEvents()` | `frontend/src/views/app-content/site/edit:520` | 绑定编辑模式事件：编辑入口 / 拉取配置 / 取消 / 保存 / 行内编辑 / 删除创作者 / 拖拽排序 / 增删搜索词 / 搜索过滤。 |
| `CrCardCtx()` | `frontend/src/views/app-content/site/render:14` | 创作者卡片工厂上下文 |
| `BuildSiteHtmlCtx()` | `frontend/src/views/app-content/site/render:25` | buildSiteHtml 依赖的渲染上下文 |
| `createCrCard()` | `frontend/src/views/app-content/site/render:45` | 创作者卡片工厂 |
| `SiteViewState()` | `frontend/src/views/app-content/site/types:13` | SiteViewState —— renderSiteView 内部闭包共享变量的显式收拢。 |
| `CleanupFn()` | `frontend/src/views/app-content/site/types:43` | bindXxxEvents 函数的统一返回：清理函数，主入口聚合成单一 cleanup |
| `RepoCacheEntry()` | `frontend/src/views/app-content/state:13` | — |
| `AppContentState()` | `frontend/src/views/app-content/state:19` | — |
| `SubscriptionBucket()` | `frontend/src/views/app-content/subscription-bucket:11` | — |
| `recycleHTML()` | `frontend/src/views/app-content/tpl-recycle:5` | — |
| `aboutHTML()` | `frontend/src/views/app-content/tpl-settings-about:6` | About 标签页（版本/特性/技术栈/链接/快速上手） |
| `creditsHTML()` | `frontend/src/views/app-content/tpl-settings-about:101` | Credits 标签页（灵感来源/特别感谢） |
| `settingsHTML()` | `frontend/src/views/app-content/tpl-settings:331` | — |
| `settingsHTML()` | `frontend/src/views/app-content/tpl` | — |
| `recycleHTML()` | `frontend/src/views/app-content/tpl` | — |
| `repositoryHTML()` | `frontend/src/views/app-content/tpl:9` | — |
| `instancesHTML()` | `frontend/src/views/app-content/tpl:47` | — |
| `diagnosticsHTML()` | `frontend/src/views/app-content/tpl:70` | — |
| `githubHTML()` | `frontend/src/views/app-content/tpl:171` | ===== GitHub 仓库页面 ===== |
| `workshopHTML()` | `frontend/src/views/app-content/tpl:202` | — |
| `extractAvatars()` | `frontend/src/views/app-content/workshop-avatar:13` | 提取创作者头像（后台批量） 无参全量：BatchExtractCreatorAvatars() 扫全部模型一次性灌满 host._avatarCache； 先前按「当前站点/作者限 |
| `BrowseMode()` | `frontend/src/views/app-content/workshop-browse-mode:5` | 创作者频道浏览模式 |
| `BrowseModeRef()` | `frontend/src/views/app-content/workshop-browse-mode:8` | 浏览模式可变引用：与 wsEditModeRef:{v} 同构，贯穿 ctx→render→openUrl 消除值拷贝 stale |
| `createBrowseModeRef()` | `frontend/src/views/app-content/workshop-browse-mode:13` | 建浏览模式 ref（单源，setBrowseMode 改 .v 即处处生效） |
| `loadBrowseMode()` | `frontend/src/views/app-content/workshop-browse-mode:20` | 从 localStorage 加载浏览模式 |
| `saveBrowseMode()` | `frontend/src/views/app-content/workshop-browse-mode:31` | 保存浏览模式到 localStorage |
| `CreatorIdentity()` | `frontend/src/views/app-content/workshop-data:9` | 创作者身份识别结果 |
| `CreatorIdentityInput()` | `frontend/src/views/app-content/workshop-data:16` | 创作者输入（role/tag 可空，_fromLocal 为运行时附加字段） |
| `getCreatorIdentity()` | `frontend/src/views/app-content/workshop-data:23` | — |
| `getTagFromRole()` | `frontend/src/views/app-content/workshop-data:49` | — |
| `parseDescTags()` | `frontend/src/views/app-content/workshop-data:54` | — |
| `loadFavs()` | `frontend/src/views/app-content/workshop-data:64` | — |
| `isFaved()` | `frontend/src/views/app-content/workshop-data:76` | — |
| `toggleFav()` | `frontend/src/views/app-content/workshop-data:80` | — |
| `openSite()` | `frontend/src/views/app-content/workshop-site-opener:19` | 打开站点（外链/内嵌/窗口） |
| `bindSiteEvents()` | `frontend/src/views/app-content/workshop-site-opener:73` | 绑定站点打开相关事件 |
| `WorkshopRefs()` | `frontend/src/views/app-content/workshop-tabs:20` | 创意工坊页的共享 ref 集合——单一事实来源。 |
| `createWorkshopRefs()` | `frontend/src/views/app-content/workshop-tabs:28` | 创建创意工坊页的共享 ref 对象（单一入口，所有消费者共享同一实例） |
| `initWorkshopTabs()` | `frontend/src/views/app-content/workshop-tabs:40` | 初始化创意工坊 Tab |
| `setShowSiteView()` | `frontend/src/views/app-content/workshop-tabs:150` | — |
| `navCSS()` | `frontend/src/views/app-nav/tpl:2` | — |
| `BoneEntry()` | `frontend/src/views/app-preview/bone-names:5` | 骨骼条目（结构类型，兼容 DecodedYsm.bones 元素） |
| `buildBoneNamesText()` | `frontend/src/views/app-preview/bone-names:15` | 构建骨骼名导出文本行： 首行 `模型: &lt;path&gt;`、次行 `骨骼总数: &lt;n&gt;`，其后每根骨骼 有方块则 `名称 (n 方)`，结构骨骼（无方块）则 `名称 (结构骨骼,无方) |
| `CacheValue()` | `frontend/src/views/app-preview/cache:10` | 缓存条目值 |
| `cacheSetEvictHandler()` | `frontend/src/views/app-preview/cache:39` | 注册 evict 回调，淘汰条目时调用 |
| `cacheGet()` | `frontend/src/views/app-preview/cache:43` | — |
| `collectBlobUrls()` | `frontend/src/views/app-preview/cache:48` | 收集缓存值中全部 blob URL（evict 释放用） |
| `cacheSet()` | `frontend/src/views/app-preview/cache:65` | — |
| `previewCSS()` | `frontend/src/views/app-preview/css:2` | — |
| `showVrmMeta()` | `frontend/src/views/app-preview/detail-3d:28` | 显示 VRM meta 卡（名称/作者/许可/版本/缩略图 + FAB 进 3D，对齐 YSM 模式） |
| `showMmdPreview()` | `frontend/src/views/app-preview/detail-3d:101` | 显示 MMD 预览卡（文件名 + FAB 进 3D；PMX/PMD 无标准 meta 读取，保持简单形态） |
| `showFbxPreview()` | `frontend/src/views/app-preview/detail-3d:131` | 显示 FBX 预览卡（文件名 + FAB 进 3D；FBX 无标准 meta 读取，保持简单形态，ADR-112） |
| `showScenePreview()` | `frontend/src/views/app-preview/detail-3d:161` | 显示场景 MMD 预览卡（独立入口，与角色模型完全隔离） |
| `showMorphPreview()` | `frontend/src/views/app-preview/detail-3d:191` | 显示 CustomMorph 预览卡（VPD 表情姿势 + 兄弟列表 + 应用 FAB） |
| `showStagePreview()` | `frontend/src/views/app-preview/detail-3d:251` | 显示 StageAnim 预览卡（舞台包：VMD + 音频 + 配置） |
| `nextDetailGen()` | `frontend/src/views/app-preview/detail:25` | 跨文件共享代际：自增并返回（detail-3d.ts 等 3D 入口复用，保证快速切换时在途请求互相作废） |
| `getDetailGen()` | `frontend/src/views/app-preview/detail:30` | 跨文件共享代际：读取当前值（detail-3d.ts 过期守卫用） |
| `showModelDetail()` | `frontend/src/views/app-preview/detail:35` | 显示模型详情（YSM 模型） |
| `showResourcePack()` | `frontend/src/views/app-preview/detail:146` | 显示资源包信息（pack.mcmeta + pack.png） |
| `showSimplePreview()` | `frontend/src/views/app-preview/detail:189` | 显示简单类型预览（仅图标 + 名称），用于光影包/蓝图/MMD/VRChat 等 |
| `showShaderpack()` | `frontend/src/views/app-preview/detail:207` | 显示光影包详情（lang/en_US.lang 提取显示名 + 配置项简介），对齐资源管理器渲染口径 |
| `openEmpty3DFullscreen()` | `frontend/src/views/app-preview/empty-3d:35` | 打开空场景 3D 全屏预览（无需 path）。 |
| `cleanupEmpty3D()` | `frontend/src/views/app-preview/empty-3d:40` | 清理空场景 3D（WebGL renderer + rAF 循环） |
| `invalidateEmptyPreview()` | `frontend/src/views/app-preview/empty-3d:45` | 作废在途空场景加载 |
| `createFbx3D()` | `frontend/src/views/app-preview/fbx-3d:41` | 打开 FBX 3D 预览（独立资产：模型 + 内嵌动画）；siblings 透传同类型候选（ADR-066 §5.6） |
| `resolveFbxSiblings()` | `frontend/src/views/app-preview/fbx-siblings:7` | 同类型 FBX 模型候选（GetRepoRoot(fbx) → ScanModelEntriesFiltered 主文件 Path 列表）；失败返回 []（下拉不渲染） |
| `BedrockCube()` | `frontend/src/views/app-preview/geometry:6` | Bedrock 方块 |
| `BedrockSubModel()` | `frontend/src/views/app-preview/geometry:19` | SubModel 子模型条目（Go types/bedrock.go SubModel）。 |
| `BedrockBone()` | `frontend/src/views/app-preview/geometry:26` | Bedrock 骨骼 |
| `BedrockGeometry()` | `frontend/src/views/app-preview/geometry:41` | 解析后的 Bedrock geometry |
| `parseBedrockGeometryFromJSON()` | `frontend/src/views/app-preview/geometry:83` | 从 JSON 字符串解析 Bedrock geometry |
| `createLitematic3D()` | `frontend/src/views/app-preview/litematic-3d:26` | 打开 Litematic/蓝图 体素 3D 预览（voxelFn 由注册表 VOXEL_RPC_BY_EXT 解析）；siblings 提供同类型候选 |
| `appendLitematicPreview()` | `frontend/src/views/app-preview/litematic-3d:49` | 同台追加 Litematic/蓝图 模型：经统一路由主门收口（cooperate → keepInScene 追加，ADR-093 T4），与 mmd/vrm 对称 |
| `cleanupVoxel3D()` | `frontend/src/views/app-preview/litematic-3d:54` | 清理体素 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 |
| `invalidateLitematicPreview()` | `frontend/src/views/app-preview/litematic-meta:28` | P2 修复（code_review）：任意新预览派发时推进代际——原 litematicGen 只在 showLitematic 自身递增，litematic A 解析中切到 YS |
| `showLitematic()` | `frontend/src/views/app-preview/litematic-meta:183` | 显示投影文件详情面板（tab 布局） |
| `cleanupLitematic3D()` | `frontend/src/views/app-preview/litematic-meta:251` | 组件销毁时清理体素 3D（转发至 litematic-3d，避免 index 静态依赖 Three.js 渲染模块） |
| `LoadModelOpts()` | `frontend/src/views/app-preview/loader:11` | loadModelData 选项（Bedrock 通用模型加载控制） |
| `loadModelData()` | `frontend/src/views/app-preview/loader:29` | 加载模型几何数据 + 纹理（优先路径，阻塞渲染） 统一路径：缓存 → WASM 解码（仅 .ysm）→ Go AnalyzeBedrockModel 兜底 作者/头像延迟到 fil |
| `fillAuthorsAsync()` | `frontend/src/views/app-preview/loader:232` | 异步补全作者/头像信息（不阻塞首帧渲染） 在几何渲染完成后调用，后台补齐作者名 + 头像 URL |
| `MaidOpenOptions()` | `frontend/src/views/app-preview/maid-3d:39` | — |
| `cleanupMaid3D()` | `frontend/src/views/app-preview/maid-3d:88` | 关闭活跃女仆 3D 预览 |
| `invalidateMaidPreview()` | `frontend/src/views/app-preview/maid-3d:93` | 作废在途女仆 3D 加载 |
| `showMaidPreview()` | `frontend/src/views/app-preview/maid-3d:282` | 车万女仆详情预览（基本信息卡 + 详细数据 + FAB 进 3D）。 |
| `createMmd3D()` | `frontend/src/views/app-preview/mmd-3d:27` | 打开 MMD 3D 预览（.pmx/.pmd 直引 @moeru/three-mmd）；siblings 提供同类型候选以渲染 topBar 切换下拉（ADR-066 §5.6） |
| `cleanupMmd3D()` | `frontend/src/views/app-preview/mmd-3d:32` | 清理 MMD 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 |
| `appendMmdPreview()` | `frontend/src/views/app-preview/mmd-3d:37` | 同台追加 MMD 模型：经统一路由主门收口（cooperate → keepInScene 追加，ADR-093 T4） |
| `invalidateMmdPreview()` | `frontend/src/views/app-preview/mmd-3d:42` | 任意新预览派发时调用，作废在途 MMD 加载 |
| `CameraControlBridge()` | `frontend/src/views/app-preview/mmd-controls` | — |
| `MmdBottomNavCtx()` | `frontend/src/views/app-preview/mmd-controls:26` | — |
| `fillMmdModelPanel()` | `frontend/src/views/app-preview/mmd-controls:39` | MMD 模型面板：信息卡 + 表情列表（morph 权重 0/1 切换，✓ 高亮当前开启） |
| `MmdPlayBridge()` | `frontend/src/views/app-preview/mmd-controls:86` | MMD 播放/动作控制桥（mmd-adapter 组装，纯逻辑层状态） |
| `fillMmdPlayPanel()` | `frontend/src/views/app-preview/mmd-controls:99` | MMD 播放面板：播放/暂停 + 多动作切换 + 空态提示 |
| `MaterialControlBridge()` | `frontend/src/views/app-preview/mmd-controls:167` | 材质控制桥：复用 mmd-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在视图层（ADR-072） |
| `buildMaterialControls()` | `frontend/src/views/app-preview/mmd-controls:183` | 在 container 渲染 MMD 材质面板：每行 = 显隐开关（👁/🚫）+ 名称 + 透明度滑条。 |
| `fillMmdShotPanel()` | `frontend/src/views/app-preview/mmd-controls:264` | MMD 截图面板填充（ADR-052 P3：对齐 ysm-controls fillYsmShotPanel 范式）。 |
| `makeMmdDataPort()` | `frontend/src/views/app-preview/mmd-data-port:11` | 构建一个接入 Go RPC 的 MMD 数据端口；scope 仅用于 AddOpLog 的运行时环打标 （角色预览用 "mmd-preview"，场景预览用 "mmd-scene" |
| `resolveMmdSiblings()` | `frontend/src/views/app-preview/mmd-siblings:13` | 同类型 MMD 模型候选（委托共享底座 resolveSiblingsByType）；失败返回 []（下拉不渲染） |
| `ModelLike()` | `frontend/src/views/app-preview/model3d-loader:12` | 模型对象（轻量接口，覆盖 loadTextures/fetchSpec/preloadModel 用到的字段） |
| `ModelSpec()` | `frontend/src/views/app-preview/model3d-loader:24` | Go 返回的 3D spec（models 数组） |
| `loadTextures()` | `frontend/src/views/app-preview/model3d-loader:53` | 并行加载纹理 URL 列表，返回 THREE.Texture 数组（P0 优化：纹理缓存池，同 URL 复用） |
| `preloadModel()` | `frontend/src/views/app-preview/model3d-loader:161` | 预加载：spec 先行，纹理按全量清单加载（texArr 槽位 = cube texSlot 下标） |
| `resolveMorphSiblings()` | `frontend/src/views/app-preview/morph-siblings:8` | CustomMorph 目录下所有候选文件（含子目录）；失败返回 [] |
| `createPack3D()` | `frontend/src/views/app-preview/pack-3d:30` | 打开资源包模型 3D 预览（ADR-084 L2：zip 当文件夹，entries 作 siblings） |
| `cleanupPack3D()` | `frontend/src/views/app-preview/pack-3d:50` | 清理资源包 3D（WebGL renderer + rAF 循环）：组件销毁前调用，防 GPU 资源残留 |
| `invalidatePackPreview()` | `frontend/src/views/app-preview/pack-3d:55` | 任意新预览派发时调用，作废在途资源包加载 |
| `parseYsmJsonDirect()` | `frontend/src/views/app-preview/parse-ysm-json:23` | 直接解析纯 JSON 格式的 ysm.json（解压后的 YSM 模型文件） |
| `registerReRoute()` | `frontend/src/views/app-preview/preview-library:24` | 注册某资源类型的「打开全屏 3D」入口（由对应 createXxx3D 包装器在模块加载时调用； 第二参透传 siblings，切换后新会话「当前目录」tab 有候选，P1-2） |
| `getRegisteredRoutes()` | `frontend/src/views/app-preview/preview-library:32` | 返回已注册的路由类型列表（供测试/CI 验证 _openers 覆盖率，审核 P3） |
| `OpenModel3DOptions()` | `frontend/src/views/app-preview/preview-library:37` | openModel3DFullscreen 选项（ADR-093 T4：cooperate 统一多模型同台追加入口） |
| `openModel3DFullscreen()` | `frontend/src/views/app-preview/preview-library:57` | 通用「打开一个模型 3D」路由：探测类型 → 查注册表派发 opener（跨类型换角色）。 |
| `scanModelsByType()` | `frontend/src/views/app-preview/preview-library:109` | 按资源类型（+可选子类型）扫描候选模型路径（轻量：GetRepoRoot + ScanModelEntriesFiltered， 复用文件树扫描缓存，不逐文件解析）。供 3D 内切 |
| `withPreviewExtras()` | `frontend/src/views/app-preview/preview-library:126` | 给 mount3D opts 注入「跨类型换角色」入口 + 按类型懒加载数据源。各 createXxx3D 统一经此接入 |
| `createScene3D()` | `frontend/src/views/app-preview/scene-3d:32` | 打开场景 MMD 3D 预览（独立入口，只加载 SceneModel 目录下的 PMX/PMD） |
| `cleanupScene3D()` | `frontend/src/views/app-preview/scene-3d:37` | 清理场景 3D（WebGL renderer + rAF 循环） |
| `invalidateScenePreview()` | `frontend/src/views/app-preview/scene-3d:42` | 任意新预览派发时调用，作废在途场景加载 |
| `resolveSceneSiblings()` | `frontend/src/views/app-preview/scene-siblings:8` | 场景模型候选（只扫 SceneModel 子目录）；失败返回 [] |
| `AngleShot()` | `frontend/src/views/app-preview/screenshot-renderer:13` | — |
| `RenderMultiAngleOptions()` | `frontend/src/views/app-preview/screenshot-renderer:18` | — |
| `renderMultiAngle()` | `frontend/src/views/app-preview/screenshot-renderer:25` | — |
| `resolveSiblingsByType()` | `frontend/src/views/app-preview/siblings:13` | 解析某资源类型的同目录候选主文件路径列表。 |
| `PanelHandle()` | `frontend/src/views/app-preview/skeleton-fill-panel:11` | fill3DPanel 需要的句柄子集（Model3DHandleX / YsmContentHandle 均满足——结构兼容） |
| `fill3DPanel()` | `frontend/src/views/app-preview/skeleton-fill-panel:37` | — |
| `fill3DPanel()` | `frontend/src/views/app-preview/skeleton-render` | — |
| `setup2DCanvas()` | `frontend/src/views/app-preview/skeleton-render:19` | 创建 2D 骨骼画布并异步加载纹理 |
| `buildToggleRow()` | `frontend/src/views/app-preview/skeleton-render:44` | 构建骨骼名开关行（不含放大按钮，放大按钮由调用方单独添加） |
| `buildStatsCard()` | `frontend/src/views/app-preview/skeleton-render:84` | 构建统计卡片（含作者列表） |
| `buildBoneExportRow()` | `frontend/src/views/app-preview/skeleton-render:133` | 构建导出骨骼名按钮行 |
| `saveScreenshot()` | `frontend/src/views/app-preview/skeleton-render:166` | 截图保存内部逻辑（供 3D overlay 使用） |
| `sec()` | `frontend/src/views/app-preview/skeleton-utils:6` | 面板分区标题（3D overlay 信息面板使用） gap=false 用于面板首个分区（panel 已有 padding-top，避免顶部 10+12=22px 过空） |
| `iRow()` | `frontend/src/views/app-preview/skeleton-utils:15` | 信息行：标签 | 值 |
| `buildDepthMap()` | `frontend/src/views/app-preview/skeleton-utils:34` | 构建骨骼层级深度映射（用于骨骼列表缩进渲染） parentId 为空的骨骼深度为 0，其余递归计算 |
| `closeActive3DOverlay()` | `frontend/src/views/app-preview/skeleton:35` | 关闭当前活跃的 3D 全屏 overlay（若存在）。供 app-preview/index.ts 切换模型前调用。 |
| `setActive3DClose()` | `frontend/src/views/app-preview/skeleton:41` | 设置当前活跃的 3D 全屏 overlay 关闭函数（maid/通用 Bedrock 模型复用此机制）。 |
| `loadModel2D()` | `frontend/src/views/app-preview/skeleton:58` | 加载模型 2D 骨骼线条图 + 统计面板 |
| `resolveStageSiblings()` | `frontend/src/views/app-preview/stage-siblings:13` | 扫描 StageAnim 目录下所有资源文件（VMD + 音频 + config）；失败返回 [] |
| `OrderedTexInput()` | `frontend/src/views/app-preview/texture-order:7` | — |
| `buildOrderedTexKeys()` | `frontend/src/views/app-preview/texture-order:21` | 计算 3D 渲染/纹理选择器用的有序纹理名列表 |
| `ModelDetailMeta()` | `frontend/src/views/app-preview/tpl:6` | 模型统计元数据（modelDetailHTML 入参） |
| `modelDetailHTML()` | `frontend/src/views/app-preview/tpl:20` | 模型详情面板（仓库页面） |
| `StatsCardModel()` | `frontend/src/views/app-preview/tpl:58` | 模型统计卡片（statsCardHTML 入参的几何视图） |
| `statsCardHTML()` | `frontend/src/views/app-preview/tpl:67` | 模型统计卡片 |
| `devLog()` | `frontend/src/views/app-preview/utils:6` | DEV 模式下输出调试日志 |
| `DecodedYsm()` | `frontend/src/views/app-preview/utils:11` | WASM 解码结果（decodeYsmViaWasm 返回） |
| `PreviewRoot()` | `frontend/src/views/app-preview/utils:32` | 渲染容器 + 生命周期（detail/litematic-meta/skeleton 消费 root，skeleton 消费 unsubs） |
| `YsmDecoder()` | `frontend/src/views/app-preview/utils:39` | WASM 解码能力（loader/skeleton 消费） |
| `PreviewDebugger()` | `frontend/src/views/app-preview/utils:44` | 调试输出能力（loader/skeleton 消费） |
| `PreviewImageLoader()` | `frontend/src/views/app-preview/utils:49` | 预览图加载能力（detail 消费） |
| `PreviewCtx()` | `frontend/src/views/app-preview/utils:56` | 组合接口：实现方（AppPreview）与兼容旧调用方的完整视图。 |
| `getPrefer3D()` | `frontend/src/views/app-preview/utils:60` | — |
| `setPrefer3D()` | `frontend/src/views/app-preview/utils:63` | — |
| `stripYsgpTextHeader()` | `frontend/src/views/app-preview/utils:147` | 剥离 YSGP 文本头部，返回标准二进制格式 |
| `createVrm3D()` | `frontend/src/views/app-preview/vrm-3d:45` | 打开 VRM 3D 预览（.vrm 直引 three-vrm）；siblings 提供同类型候选以渲染 topBar 切换下拉 |
| `cleanupVrm3D()` | `frontend/src/views/app-preview/vrm-3d:60` | 清理 VRM 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 |
| `invalidateVrmPreview()` | `frontend/src/views/app-preview/vrm-3d:65` | 任意新预览派发时调用，作废在途 VRM 加载 |
| `VrmMaterialControlBridge()` | `frontend/src/views/app-preview/vrm-controls:15` | 材质控制桥：复用 vrm-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在本文件 |
| `makeVrmPanelRenderer()` | `frontend/src/views/app-preview/vrm-controls:94` | VRM 菜单面板渲染器（声明式菜单 item.render 回调） |
| `decodeYsmViaWasm()` | `frontend/src/views/app-preview/wasm:20` | — |
| `YsmOpenOptions()` | `frontend/src/views/app-preview/ysm-3d:42` | — |
| `createYsm3D()` | `frontend/src/views/app-preview/ysm-3d:55` | 打开 YSM 3D 预览（统一外壳 shared 模式，path 驱动）。 |
| `cleanupYsm3D()` | `frontend/src/views/app-preview/ysm-3d:88` | 关闭活跃 YSM 3D 预览（WebGL renderer + rAF + overlay 全清） |
| `invalidateYsmPreview()` | `frontend/src/views/app-preview/ysm-3d:93` | 作废在途 YSM 3D 加载（切模型前调用，防旧会话迟到渲染覆盖新模型） |
| `CameraControlBridge()` | `frontend/src/views/app-preview/ysm-controls` | — |
| `YsmModel()` | `frontend/src/views/app-preview/ysm-controls:21` | 模型对象（对齐 fill3DPanel / saveScreenshot 的字段需求；ysm-adapter 复用此类型） |
| `YsmContentHandle()` | `frontend/src/views/app-preview/ysm-controls:30` | YSM 内容层句柄（shared 化：相机操作走核心 cameraControls，本句柄只管内容/骨骼） |
| `YsmControlsContext()` | `frontend/src/views/app-preview/ysm-controls:43` | 控件装配上下文：由 ysm-adapter 在 buildYsmScene 内组装传入 |
| `fillYsmModelPanel()` | `frontend/src/views/app-preview/ysm-controls:74` | 模型菜单面板：统计 / 纹理 / 骨骼列表 / 骨骼详情 / 多组件切换（fill3DPanel 内容） |
| `fillYsmShotPanel()` | `frontend/src/views/app-preview/ysm-controls:96` | 截图面板：6 角度保存（原视图菜单截图子区，相机控件已归 core 根菜单 camera 项） |
| `attachYsmBoneSelect()` | `frontend/src/views/app-preview/ysm-controls:137` | 骨骼拾取联动（YSM 特色）：未开根菜单时先打开 model 面板，更新详情框 + 滚动高亮 |
| `openFullPreview()` | `frontend/src/views/app-preview/zoom:7` | 全窗放大预览（独立函数，不依赖组件实例） |
| `SidebarInstance()` | `frontend/src/views/app-sidebar/data:4` | sidebar 整合包实例（loader 转换后的渲染格式） |
| `bindCardEvents()` | `frontend/src/views/app-sidebar/events:126` | — |
| `resetSelectedEmit()` | `frontend/src/views/app-sidebar/events:188` | 复位去重标记：组件真正卸载（disconnectedCallback）时调用—— 同组件 reload 不复位（去重跨 reload 生效），仅新挂载会话才需重置（P2 复核修复） |
| `bindFooter()` | `frontend/src/views/app-sidebar/events:231` | — |
| `appSidebarStyle()` | `frontend/src/views/app-sidebar/index:13` | — |
| `MmdVariantGroups()` | `frontend/src/views/app-sidebar/loader:21` | MMD 变体聚合结果 |
| `loadInstances()` | `frontend/src/views/app-sidebar/loader:37` | 从 Go 加载整合包实例列表，转换为 render 需要的格式（同 rtype 在途请求合并） 去重只服务「读并发」（多组件同时触发 reload），若变异完成的刷新并入变异前发起 |
| `groupMmdVariants()` | `frontend/src/views/app-sidebar/loader:167` | 对 MMD 类型，按父文件夹聚合 .pmx 变体文件。 |
| `renderVersionCards()` | `frontend/src/views/app-sidebar/render:8` | — |
| `sidebarCSS()` | `frontend/src/views/app-sidebar/sidebar-css:3` | — |
| `headerHTML()` | `frontend/src/views/app-sidebar/tpl:7` | — |
| `footerHTML()` | `frontend/src/views/app-sidebar/tpl:26` | — |
| `listContainerHTML()` | `frontend/src/views/app-sidebar/tpl:70` | — |
| `instanceCardHeaderHTML()` | `frontend/src/views/app-sidebar/tpl:100` | 单个整合包卡片头部。 |
| `EventSelf()` | `frontend/src/views/app-sync-manager/events:9` | — |
| `bindEvents()` | `frontend/src/views/app-sync-manager/events:17` | 绑定所有 DOM 事件（状态筛选 / 单行操作按钮 / dir-level 文件夹展开折叠） |
| `SyncManagerSelf()` | `frontend/src/views/app-sync-manager/index:27` | 合并四子模块（store / renderer / events / network）对组件实例的接口需求， 一统江湖，消除各处 `as any` 桥接。各子模块可改从此导入。 |
| `AppSyncManager()` | `frontend/src/views/app-sync-manager/index:71` | — |
| `NetworkSelf()` | `frontend/src/views/app-sync-manager/network:14` | — |
| `performSingleOp()` | `frontend/src/views/app-sync-manager/network:27` | 统一推送 / 拉取单文件操作。 |
| `SyncRenderSelf()` | `frontend/src/views/app-sync-manager/renderer:20` | — |
| `render()` | `frontend/src/views/app-sync-manager/renderer:33` | 主渲染入口：设置骨架 → 类型标签 → 状态标签 → 列表 |
| `LAST_TYPE_KEY()` | `frontend/src/views/app-sync-manager/state:13` | — |
| `_lastSelectedType()` | `frontend/src/views/app-sync-manager/state:17` | — |
| `setLastSelectedType()` | `frontend/src/views/app-sync-manager/state:19` | — |
| `SyncStoreSelf()` | `frontend/src/views/app-sync-manager/store:13` | — |
| `loadTypeConfig()` | `frontend/src/views/app-sync-manager/store:19` | 加载资源类型配置（LoadResourceTypes） 过期代际/已卸载静默丢弃；加载失败 toast 提醒 + 空数组降级。 |
| `loadData()` | `frontend/src/views/app-sync-manager/store:42` | 加载实例同步状态（GetInstanceSyncStatus） 过期代际丢弃；加载失败 toast 提醒 + 空数组。 |
| `tabStatus()` | `frontend/src/views/app-sync-manager/store:63` | tabStatus：diverged 折叠进 missing tab（继承可操作属性——与 renderer 计数同规， 逐节点复用以防口径漂移）。返回该条目在 status ta |
| `applyFilter()` | `frontend/src/views/app-sync-manager/store:111` | 应用类型 + 状态筛选，写入 self._filteredItems（递归 + keep-ancestors）。 |
| `SyncItem()` | `frontend/src/views/app-sync-manager/tpl:9` | 同步列表项（GetInstanceSyncStatus 返回 JSON 条目） |
| `STATUS_ICON()` | `frontend/src/views/app-sync-manager/tpl:32` | — |
| `STATUS_COLOR()` | `frontend/src/views/app-sync-manager/tpl:41` | — |
| `statusIconOf()` | `frontend/src/views/app-sync-manager/tpl:50` | — |
| `statusColorOf()` | `frontend/src/views/app-sync-manager/tpl:51` | — |
| `actionBtnHTML()` | `frontend/src/views/app-sync-manager/tpl:54` | 状态操作按钮（missing/diverged→push；optional→pull；legacy→pullHere；其余无） |
| `syncDirRowHTML()` | `frontend/src/views/app-sync-manager/tpl:71` | 文件夹行 HTML（dir-level 层级展示：箭头 + 图标 + 名称 + 大小 + 操作按钮） 点击整行切换展开/折叠；push/pull 按钮冒泡到文件行层，由 event |
| `containerHTML()` | `frontend/src/views/app-sync-manager/tpl:138` | 容器骨架 |
| `statusTabHTML()` | `frontend/src/views/app-sync-manager/tpl:181` | 状态筛选标签 HTML |
| `itemHTML()` | `frontend/src/views/app-sync-manager/tpl:210` | 列表项 HTML（扁平文件行，按 isDir 为 false 渲染） |
| `emptyHTML()` | `frontend/src/views/app-sync-manager/tpl:253` | 空状态 HTML |
| `loadingHTML()` | `frontend/src/views/app-sync-manager/tpl:267` | 加载中 |
| `treeCSS()` | `frontend/src/views/app-tree/app-tree-styles:3` | — |
| `AuthorInfo()` | `frontend/src/views/app-tree/authors:6` | 作者统计（Go ListModelAuthors 返回） |
| `loadAuthors()` | `frontend/src/views/app-tree/authors:19` | 从 Go 端加载作者列表 |
| `bindBusEvents()` | `frontend/src/views/app-tree/bus-handlers:26` | — |
| `selectState()` | `frontend/src/views/app-tree/data:4` | 多选状态 |
| `toggleSelect()` | `frontend/src/views/app-tree/data:16` | 切换选中状态 |
| `selectSingle()` | `frontend/src/views/app-tree/data:31` | 单选：清空后选中单个并设为 lastKey（用于单击选中，避免外部直接写 selectState） |
| `updateSelectCount()` | `frontend/src/views/app-tree/events:391` | — |
| `bindTreeEvents()` | `frontend/src/views/app-tree/events:495` | — |
| `appTreeStyle()` | `frontend/src/views/app-tree/index:12` | — |
| `AppTree()` | `frontend/src/views/app-tree/index:62` | — |
| `TreeEntry()` | `frontend/src/views/app-tree/loader:11` | 树条目（loader 转换后的渲染格式） |
| `loadEntries()` | `frontend/src/views/app-tree/loader:68` | 从 Go 后端加载仓库文件列表，返回格式化的 entries 扁平化架构下每个 MMD 子类型为独立顶级类型，直接用 subdir 作为类型 ID 查表 |
| `TreeRow()` | `frontend/src/views/app-tree/render:22` | 扁平化行（虚拟滚动数据单元） |
| `TreeNode()` | `frontend/src/views/app-tree/render:32` | buildTree 嵌套节点（文件夹 = 子节点对象，文件 = { _e: entry }） |
| `RenderMode()` | `frontend/src/views/app-tree/render:38` | 渲染模式 |
| `getRenderMode()` | `frontend/src/views/app-tree/render:44` | Get render mode from localStorage, default to 'grid' |
| `setRenderMode()` | `frontend/src/views/app-tree/render:49` | Set render mode to localStorage |
| `buildTree()` | `frontend/src/views/app-tree/render:82` | — |
| `flattenVisible()` | `frontend/src/views/app-tree/render:285` | — |
| `cleanupVirtualScroll()` | `frontend/src/views/app-tree/render:336` | 断开虚拟滚动相关监听 |
| `renderTree()` | `frontend/src/views/app-tree/render:345` | — |
| `updateStat()` | `frontend/src/views/app-tree/render:412` | — |
| `fileRowCommon()` | `frontend/src/views/app-tree/row-common:11` | 文件行公共计算：path 转义、开关状态、禁用 class、类型图标、缩进 |
| `folderRowCommon()` | `frontend/src/views/app-tree/row-common:34` | 文件夹行公共计算：图标、颜色、箭头、开关 class、显示名、缩进 |
| `listFileRowHTML()` | `frontend/src/views/app-tree/row-tpl-list:8` | 文件行 HTML（紧凑列表模式：icon + name + size，无 hover actions、无 date、无 tag dot） |
| `listFolderRowHTML()` | `frontend/src/views/app-tree/row-tpl-list:27` | 文件夹行 HTML（紧凑列表模式：arrow + folder icon + name） |
| `fileRowHTML()` | `frontend/src/views/app-tree/row-tpl:9` | 文件行 HTML（indent = padding-left，rowCls 用于选中高亮等行级类） |
| `folderRowHTML()` | `frontend/src/views/app-tree/row-tpl:34` | 文件夹行 HTML（indent = padding-left，扁平化无 .ch 容器） |
| `bindToolbarEvents()` | `frontend/src/views/app-tree/toolbar-events:356` | — |
| `openAdvFilterDialog()` | `frontend/src/views/app-tree/toolbar-search:253` | — |
| `pickWebFilesAndImport()` | `frontend/src/views/app-tree/toolbar-search:287` | — |
| `headerHTML()` | `frontend/src/views/app-tree/tpl:5` | — |
| `footerHTML()` | `frontend/src/views/app-tree/tpl:29` | — |
| `emptyHTML()` | `frontend/src/views/app-tree/tpl:37` | — |
| `spinnerHTML()` | `frontend/src/views/app-tree/tpl:41` | — |
| `ROW_H_GRID()` | `frontend/src/views/app-tree/virtual-scroll:3` | — |
| `ROW_H_LIST()` | `frontend/src/views/app-tree/virtual-scroll:4` | — |
| `calcVisibleRange()` | `frontend/src/views/app-tree/virtual-scroll:14` | 根据滚动位置计算可见行范围（支持动态行高） |
| `installScrollSync()` | `frontend/src/views/app-tree/virtual-scroll:31` | 在容器上安装滚动监听，当滚动到新范围时自动重新渲染可见行 |

## 前端·WASM

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `YsmDecodedFile()` | `frontend/src/wasm/parser-shared:8` | 解码输出文件 |
| `FSLike()` | `frontend/src/wasm/parser-shared:14` | Emscripten FS 最小接口（WASM 导出） |
| `WasmModuleLike()` | `frontend/src/wasm/parser-shared:26` | Emscripten Module 最小接口（WASM 实例） |
| `classifyWasmError()` | `frontend/src/wasm/parser-shared:55` | WASM 错误分类：收敛 decodeYsmFileFromMemory / decodeYsmFile / decodeYsmInWorker / decodeYsmInWork |
| `wipeDir()` | `frontend/src/wasm/parser-shared:78` | — |
| `ensureDir()` | `frontend/src/wasm/parser-shared:92` | — |
| `collectOutputFiles()` | `frontend/src/wasm/parser-shared:102` | — |
| `writeHeapBytes()` | `frontend/src/wasm/parser-shared:123` | 将 JS 数据写入 WASM 内存，返回指针。 |
| `_getGlueCodeMt()` | `frontend/src/wasm/ysm-glue-data-mt:3` | — |
| `_getGlueCode()` | `frontend/src/wasm/ysm-glue-data:3` | — |
| `YsmDecodedFile()` | `frontend/src/wasm/ysm-parser` | — |
| `initYSMParser()` | `frontend/src/wasm/ysm-parser:53` | — |
| `decodeYsmFileFromMemory()` | `frontend/src/wasm/ysm-parser:138` | 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组） 返回 [{path, data}]，失败返回 null |
| `decodeYsmFile()` | `frontend/src/wasm/ysm-parser:187` | 通过 callMain + MEMFS 解码 .ysm（回退路径） 保留以兼容旧的 WASM 编译 |
| `_getWasmBinaryMt()` | `frontend/src/wasm/ysm-wasm-data-mt.d:1` | — |
| `_getWasmBinaryMt()` | `frontend/src/wasm/ysm-wasm-data-mt:4` | — |
| `_getWasmBinary()` | `frontend/src/wasm/ysm-wasm-data.d:1` | — |
| `_getWasmBinary()` | `frontend/src/wasm/ysm-wasm-data:3` | — |
| `initYsmParserInWorker()` | `frontend/src/wasm/ysm-worker-loader:50` | Worker 内独立初始化 WASM（懒加载单例，生命周期等同 Worker 本身）。 |
| `initYsmParserInWorkerMt()` | `frontend/src/wasm/ysm-worker-loader:63` | ADR-079 M3/M4：pthread 多线程版初始化（需 crossOriginIsolated=true——SharedArrayBuffer 前提，见 backend/c |
| `decodeYsmInWorker()` | `frontend/src/wasm/ysm-worker-loader:161` | 内存解析 .ysm（优先路径 — 无文件 I/O，直接传入字节数组），返回 [{path, data}]。 |
| `decodeYsmInWorkerMemfs()` | `frontend/src/wasm/ysm-worker-loader:200` | callMain + MEMFS 解码 .ysm（回退路径，兼容旧 WASM 编译 / V3 文本头部等格式）。 |

## frontend/workers

| 符号 | 文件:行 | 说明 |
|------|--------|------|
| `StatsFileInput()` | `frontend/src/workers/stats-core:13` | 解码/直读产物文件（Worker 与主线程共用形状） |
| `ModelStatsResult()` | `frontend/src/workers/stats-core:19` | 单模型统计结果（SearchResult 数值字段对齐） |
| `sniffTexSize()` | `frontend/src/workers/stats-core:40` | 从纹理字节嗅探像素尺寸（PNG：签名 + IHDR 后宽/高大端；JPEG：SOI 后首个 SOF）。 |
| `statsFromDecodedFiles()` | `frontend/src/workers/stats-core:111` | 从 WASM 解码产物计算统计（.ysm 主文件路径）。 |
| `StatsRelReader()` | `frontend/src/workers/stats-core:147` | 读取相对路径文件的回调（Worker 内 = IDB 读取；测试可注入内存 Map） |
| `statsFromJsonBytes()` | `frontend/src/workers/stats-core:155` | 从 .json 主文件字节计算统计（解压目录入口，ADR-038 ysm.json 语义）： - ysm.json spec 格式（spec+files）：按 files.play |
| `WebModelStats()` | `frontend/src/workers/stats-protocol:5` | 单模型统计结果（与 SearchResult 数值字段对齐） |
| `WebModelStatsWithPath()` | `frontend/src/workers/stats-protocol:14` | 带 path 的统计结果（Worker 返回，主线程按 path 对齐防顺序漂移） |
| `StatsWorkerRequest()` | `frontend/src/workers/stats-protocol:17` | 主线程 → Worker：批量统计任务 |
| `StatsWorkerProgress()` | `frontend/src/workers/stats-protocol:26` | Worker → 主线程：进度 |
| `StatsWorkerResult()` | `frontend/src/workers/stats-protocol:34` | Worker → 主线程：批量结果（与 paths 一一对应，含 path 便于主线程对齐） |
| `StatsWorkerError()` | `frontend/src/workers/stats-protocol:41` | Worker → 主线程：致命错误（WASM 无法加载 / 任务内部异常），主线程据此整体降级 |
| `StatsWorkerResponse()` | `frontend/src/workers/stats-protocol:47` | — |
| `STATS_BATCH_LIMIT()` | `frontend/src/workers/stats-protocol:53` | 单批模型上限：防 Worker 内存爆（每个模型 WASM 解码 + 纹理驻留 HEAP，200 已含余量） |

---

> 说明列由 funcmap 自动提取导出符号紧邻 JSDoc/注释的首句摘要（无注释则留 —）。
> Go 方法记为 `Type.Method`；符号列统一以 `()` 结尾（与 MikuMikuAR 约定一致）。