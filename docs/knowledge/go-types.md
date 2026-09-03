---
kind: go-types
name: 共享类型 go/types
tier: architecture
adr:
  - ADR-144
category: go
source_files:
  - go/types/types.go
  - go/types/config.go
  - go/types/resource.go
  - go/types/extensions.go
  - go/types/bedrock.go
  - go/types/
  - resource_types.json
auto_fields:
  symbols_with_lines:
    - AllExts
    - AllSubDirs
    - AppConfig
    - AppError
    - AppError.Error
    - AppError.Unwrap
    - AppError.WithCause
    - AuthorInfo
    - BedrockModel
    - Bone2D
    - BundledRegistryJSON
    - ContainerExts
    - Cube2D
    - CustomFileInfo
    - DedupConfig
    - DisableSuffixes
    - DownloadTask
    - ErrAlreadyExists
    - ErrDecodeFailed
    - ErrFileEmpty
    - ErrFileExists
    - ErrFileNameInvalid
    - ErrFileTooLarge
    - ErrInvalidParam
    - ErrInvalidPath
    - ErrIO
    - ErrLinkFailed
    - ErrMkdirFailed
    - ErrorCode
    - ErrUnknown
    - ErrUnsupportedFmt
    - ErrUnsupportedType
    - ErrWriteFailed
    - ExtBelongsTo
    - ExtBelongsToBy
    - FileInventory
    - FindInstDir
    - FormatRange
    - FormatRange.UnmarshalJSON
    - GroupIcon
    - GroupLabel
    - GroupOf
    - GroupStorageRoot
    - ImportFileItem
    - ImportLog
    - InstallExtsFor
    - InstanceStatus
    - IsContainerExt
    - IsDirLevelSync
    - IsDisableSuffix
    - IsNestedModelDir
    - IsResourceAllowed
    - IsScanInstance
    - IsSupportedExt
    - IsYsmEntryJSON
    - LauncherInstance
    - LevelDebug
    - LevelError
    - LevelFatal
    - LevelInfo
    - LevelWarn
    - LinkCopy
    - LinkHard
    - LinkSym
    - LinkType
    - LinkUnknown
    - LitematicBlockStat
    - LitematicMeta
    - LitematicVoxelData
    - LoadRegistry
    - LogLevel
    - MatchZipEntry
    - MaxImportSize
    - MaxImportSizeMB
    - MaxReadLimit
    - ModelEntry
    - ModKeywordsFor
    - ModMetaFor
    - ModRequirement
    - NestedPattern
    - NestedPatternsFor
    - NormalizeResourceName
    - PackInfo
    - PackMeta
    - PackMeta.Desc
    - PackMetaView
    - PackModelDetail
    - PackModelDetailList
    - ParseDedupConfig
    - QueueStatusInfo
    - RegistryType
    - ResourceSyncItem
    - ResourceSyncResult
    - ResourceType
    - ResourceType.EffectiveExtensions
    - ResourceType.MatchZipEntry
    - ResourceTypeRegistry
    - ResourceTypeRegistry.FindByID
    - RuntimeLog
    - SearchResult
    - SetBundledRegistryJSON
    - SetRegistryPath
    - ShaderpackLang
    - ShouldHashExt
    - StatusToLevel
    - StorageSubDir
    - StripBanSuffix
    - StripDisableSuffix
    - SubDirAll
    - SubDirEntry
    - SubDirMap
    - SubModel
    - SupportedExtsForSubtype
    - SupportedExtsForType
    - SyncConfig
    - SyncResolveResult
    - SyncScanDirs
    - SyncStatus
    - SyncStatusDisabled
    - SyncStatusDiverged
    - SyncStatusLegacy
    - SyncStatusMissing
    - SyncStatusOptional
    - SyncStatusSynced
    - TypeByLocation
    - Variant
    - VersionInstance
    - VoxelGroup
    - WindowState
    - WorkshopCreator
    - WorkshopPresetSearch
    - WorkshopSite
    - YsmAuthor
    - YsmLicense
    - YsmMetadata
    - ZipEntryMatch
quick_groups:
  - 配置与注册表
quick_intents:
  - 共享类型、AppConfig、配置
  - 注册表、扩展名、LinkType、BedrockModel
  - LoadRegistry/ParseDedupConfig
quick_risk_lines:
  - 共享类型必须走 go/types 单点定义，禁止在业务代码里复制类型定义
pitfalls:
  - 复制类型定义 → 类型不一致、重构时漏改；必须经 go/types 单点
  - LoadRegistry 失败未兜底 → 启动崩溃；必须在 LoadRegistry 里做默认值兜底

use_when:
  - 共享类型
  - AppConfig
  - 配置
  - 注册表
  - 扩展名
  - LinkType
  - BedrockModel
invariant_anchors:
  - go/types/resource.go|LoadRegistry
  - go/types/config.go|AppConfig
  - go/types/config.go|ParseDedupConfig
  - go/types/resource.go|ResourceType
  - go/types/extensions.go|ShouldHashExt
  - go/types/types.go|ErrorCode
status: active
---

# 共享类型 go/types

## 概览

`go/types/` 包是全应用的共享类型层：应用配置（AppConfig）、各子系统交换的数据结构（模型条目/实例状态/同步结果/日志/投影元数据等）、以及资源类型注册表的 Go 端加载与扩展名查询。与 [resource_registry](./resource-registry.md) 互补：那张卡讲 `resource_types.json` 单一事实源，本卡讲 Go 端的类型定义与配置结构。

## 核心职责

- `types.go` — 跨包数据结构：ModelEntry（含 **SubDir 字段，ADR-096 P1**：MMD 用途子目录分组，`json:"subdir,omitempty"`）、VersionInstance、InstanceStatus、ResourceSyncResult、SyncStatus、ImportLog、LinkType、AppError、CustomFileInfo、WindowState、AuthorInfo、SearchResult、**ErrorCode（结构化错误码，ADR-051 落地）**、**LogLevel（日志级别）**、**DownloadTask/QueueStatusInfo（下载队列契约 DTO，ADR-145：自 internal/app 下沉——go/cli 定义 AppService 接口需引用，不下沉则 cli 反向依赖 app 成死结；JSON tag 原样保留 → bindings 零漂移）**
- `config.go` — AppConfig（FilesRoot/各类型 Root/LinkMode/Theme/Mirror/VoxelMaxBlocks/窗口状态）、PackInfo、WorkshopSite、WorkshopCreator；**`ParseDedupConfig`**（绑定层 configStr 的统一解析入口：空串→nil,nil「未配置」、非法 JSON→错误；`FindDuplicateFiles` 依赖它，消多个绑定入口各自内联 json.Unmarshal 的解析语义双轨漂移）。注意：`SyncConfig` 结构体仅供 `go/sync.SyncResourcesWithConfig` 使用，**暂无绑定层解析入口**——`ParseSyncConfig` 曾引入但因无消费者被删（d22368ad），同步配置链保持休眠
- `resource.go` — 注册表加载（LoadRegistry），编译期嵌入基线 `bundledRegistryJSON`（根包 `embed.go` 经 `SetBundledRegistryJSON` 注入，单源 = 仓库根 `resource_types.json`，取代旧 `resource_types_embed.go` 手工副本）；PackMeta/FormatRange、LitematicMeta/LitematicVoxelData/VoxelGroup、**`ResourceType.ZipEntries []ZipEntryMatch`（ADR-067 内容指纹）**
- `extensions.go` — 注册表驱动的扩展名与子目录查询
- `bedrock.go` — BedrockModel/Bone2D/Cube2D（2D 摘要与 3D 构建共用）

## 对外 API / 入口

- `LoadRegistry() *ResourceTypeRegistry` — 单例加载注册表，解析优先级：显式路径（`SetRegistryPath`）→ exe 同级/上级 `resource_types.json` → 编译期嵌入基线 `bundledRegistryJSON`（根包注入）→ 测试/未注入回退读仓库根 `resource_types.json`
- `RegistryType(id string) *ResourceType` — 按 id 查类型，无匹配返回 nil
- `SetRegistryPath(path string)` — 仅测试用，重置单例
- 扩展名/目录查询：`AllExts()`、`IsSupportedExt(ext)`、`ExtBelongsTo(ext)`、`SupportedExtsForType(rtype)`、`StorageSubDir(rtype)`、`SubDirMap(rtype)`、`SubDirAll()`、`AllSubDirs()`、`FindInstDir(versionDir, subDir, rtype)`（标准子目录不存在/存在但无该类型文件时仅对 `scanInstance=true` 的类型（目前仅 blueprint）按扩展名兜底扫描；**blueprint 兜底只认 `Sable-Schematics` 白名单（2026-08-27 收紧）**，其余类型一律返回标准路径，禁止越界扫兄弟目录）——**整合包侧资源子目录解析的唯一入口（ADR-064 锚定）**：展示（`BuildSyncItems`）、状态对比（`CompareGlobalInstanceHashes`）、单/全量推拉（`findInstanceDir`/`SyncResources` binding）、安装（`InstallResourceToInstance`）、重链接（`RelinkAllInstanceResources`）、打开文件夹（`OpenInstanceFolder`）均走它，禁止 `filepath.Join(versionDir, subDir)` 直拼（历史直拼曾致 Sable-Schematics 场景展示/操作口径不一致报"不在目标目录内"）；`mods` 目录检测（`HasYSMMod`）无兜底语义除外
- **同步过滤/归一化收敛（ADR-064）**：`NormalizeResourceName(name)`（小写 + 去 `.disabled`/`.ban`）、`IsResourceAllowed(name)`（全扩展集 + `.json` 仅 `ysm.json`，原 `sync.isSyncAllowed`）、`IsDirLevelSync(rtype)` 留在本包（纯注册表查询）；**`IsTypeModelFile(name, rtype)`（单类型扩展集 + `ysm.json`，原 `sync.isModelFile` / `instance.extMatch`）已下沉 `go/packs/classify.go`（ADR-144：其 `zipentry` 分支需开容器做指纹判定，随识别大脑移出共享类型层）**——三处同义实现收敛；**`ysm.json` 特判限定扩展集含 `.json` 的类型（仅 ysm 放行；resourcepack/shaderpack 扩展集仅 `.zip`，整合包目录散落的 `ysm.json` 不得作为其独立同步条目，d45f3bc1）**；**`zipentry` 检测器类型的 `.zip` 不再按扩展名直判为模型——必须内装 `zipEntries` 指纹（经 `container.ZipMatchesEntries` + `rt.MatchZipEntry` 校验，`packs.IsTypeModelFile` 内）才算模型（581c3ec8），与 `packs.DetectResourceType` 的 `zipentry` 分支语义对齐；非 `zipentry` 类型（resourcepack/shaderpack）保持 `.zip` 扩展名直判不变。修正了同步推送/拉取把损坏包/纯打包物（如 DefaultAnim 误判 68.9MB 的 1.2.zip）当顶层模型搬运的故障**
- `(pm *PackMeta) Desc() string` — description 可读文本（兼容 string / JSON text component 对象 / 数组）
- **内容指纹契约（ADR-067）**：`ZipEntryMatch{Name, Match}`（Match ∈ `exact`/`prefix`/`suffix`）+ `(rt *ResourceType) MatchZipEntry(name)`（小写不敏感）——mmd/vrc/蓝图/投影 4 类经 `zipEntries` 指纹参与 zip 化识别；消费方：`packs.DetectResourceType` 的 `zipentry` detector（容器分支）、`importer.DetectZipType`（遍历全注册表首命中）；`Detector` 字段枚举：`"ysm"` / `"mcmeta"` / `"shader"` / **`"zipentry"`** / `"extension"`
- 关键常量：`LinkCopy` / `LinkHard` / `LinkSym` / `LinkUnknown`（LinkType）；`SyncStatusSynced/Missing/Optional/Disabled/Legacy`；`ErrorCode` 系列（`ErrFileExists` / `ErrInvalidParam` / `ErrIO` / `ErrLinkFailed` 等 15 个，见下方）；`LogLevel` 系列（`LevelDebug/Info/Warn/Error/Fatal`）；`statusToLevel(status string) LogLevel`（将 ImportLog.Status 映射为日志级别，由 `addOp` 自动调用）

### ErrorCode + LogLevel（ADR-051 落地）

`AppError.Code` 字段类型为 `ErrorCode`（而非 `string`），强制只收常量枚举，消除前后端双份分类表漂移。

| 常量 | Code 值 | 语义 |
|------|---------|------|
| `ErrFileExists` | `FILE_EXISTS` | 导入时目标文件已存在 |
| `ErrAlreadyExists` | `ALREADY_EXISTS` | 安装时目标已存在（需覆盖检查） |
| `ErrInvalidParam` | `INVALID_PARAM` | 参数为空/无效 |
| `ErrInvalidPath` | `INVALID_PATH` | 路径不在 `.minecraft` / 仓库内 |
| `ErrFileNameInvalid` | `FILENAME_INVALID` | 文件名含 `..` 或非法分隔符 |
| `ErrUnsupportedType` | `FILE_TYPE_UNSUPPORTED` | 扩展名不在白名单 |
| `ErrUnsupportedFmt` | `UNSUPPORTED_FORMAT` | 格式不支持 |
| `ErrDecodeFailed` | `DECODE_FAILED` | base64 解码失败 |
| `ErrFileTooLarge` | `FILE_TOO_LARGE` | 超过 500MB 限制 |
| `ErrFileEmpty` | `FILE_EMPTY` | 文件内容为空 |
| `ErrMkdirFailed` | `MKDIR_FAILED` | 无法创建目录 |
| `ErrWriteFailed` | `WRITE_FAILED` | 写入失败 |
| `ErrIO` | `IO_ERROR` | 通用 IO 错误 |
| `ErrLinkFailed` | `LINK_FAILED` | 硬链接/符号链接失败 |
| `ErrUnknown` | `UNKNOWN` | 未知兜底 |

`LogLevel`（`LevelDebug/Info/Warn/Error/Fatal`）由 `ImportLog` / `RuntimeLog` 的 `Level` 字段携带，供诊断页按级别过滤；`ImportLog` 由 `addOp` 通过 `statusToLevel` 自动派生（`success`→info, `failed`→error, `warn`→warn, `skipped`→debug），`RuntimeLog` 默认 `LevelInfo`。

## 与其他子系统关系

- 被几乎所有 `go/` 包与 `internal/app/` 引用（数据交换的公共语言）
- 注册表数据源是仓库根 `resource_types.json`（见 [resource_registry](./resource-registry.md)）；`extensions.go` 的查询被 [go_sync](./go-sync.md) / [go_importer](./go-importer.md) 等消费
- BedrockModel 由 [go_geometry](./go-geometry.md) 产出、[go_threejs](./go-threejs.md) 消费

## 不变量

- 注册表加载是加锁单例（`registryMu`，实现注释「加锁替代 sync.Once」——避免 SetRegistryPath 重置与 Once.Do 竞争；行为上仍是单例）；默认**不读 cwd 裸文件名**，避免部署时工作目录漂移读到旧 JSON
- 外部 JSON 解析失败时**回退嵌入基线**并记录告警（P2 修复：原实现缓存空注册表，进程生命周期内所有扩展名查询静默失效）；仅当嵌入基线也损坏才缓存空表（**回退路径已有测试**：`TestLoadRegistry_CorruptFallbackToEmbedded` 钉住损坏外部 JSON 回退基线，P3 补测）
- `RepoRoot` 为旧版字段（v1.6.4+ 弃用），仅用于配置迁移，新功能不得使用
- 单一权威来源为仓库根 `resource_types.json`，编译期通过 `go:embed` 内嵌为内存镜像（替代历史 `resource_types_embed.go`），`zipEntries`/`detector` 双副本由 `resource_types_consistency_test.go` 逐字段强约束（ADR-067 S1 双文件同步的守卫）
- 新增资源类型只改 `resource_types.json`，Go 端不手写 StorageSubDir/扩展名条目（治理红线：注册表优先）。`ShouldHashExt` 已改为注册表驱动（检查 `rt.Hashable` 字段），非 `blueprint`/`litematic` 等类型默认 `Hashable: false`（与 JSON 中 `hashable` 字段语义一致）。已有测试钉住清单（`TestShouldHashExt_FromRegistry`），新增类型只需在 JSON 中声明 `hashable: true/false`
- **Rust-Go 契约**：`StripDisableSuffix` / `IsYsmEntryJSON` / `IsDisableSuffix` 是与 `rust-core` 对齐的谓词，行为由共享向量 `tests/parity/go-rust-predicates.json` 双端锁定（本包 `parity_test.go` ↔ `rust-core/src/tests.rs`），单一权威 = 本包（ADR-038 D2）；改口径必须改 fixture 且两端同绿。跨层契约与 scan_index 故意分歧详见 [rustbridge](./rustbridge.md)
- **ADR-051 单一事实来源**：`AppError.Code` 类型是 `ErrorCode` 枚举（不是 `string`），强制所有错误码必须从 15 个常量中选取；前端 `friendlyError`（`utils/dom/errors.ts`）直接消费 Code 做 i18n 映射，不再维护独立正则分类表；前端 `CODE_KEYS` 表必须与本卡的 ErrorCode 表同步，任一新增/改名须两处同时更新

## 相关

- [resource_registry](./resource-registry.md) — resource_types.json 单一事实源（互补卡）
- [go_sync](./go-sync.md) — InstanceStatus/LinkType 的主要消费方
- [go_geometry](./go-geometry.md) / [go_threejs](./go-threejs.md) — BedrockModel 生产/消费链
