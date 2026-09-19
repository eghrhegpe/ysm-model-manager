---
kind: resource-registry
name: 资源注册表 registry
tier: architecture
category: config
source_files:
  - resource_types.json
  - go/types/
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
    - DisabledSuffix
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
    - ErrMcRootNotSet
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
    - IsRenderableTextureExt
    - IsResourceAllowed
    - IsScanInstance
    - IsSupportedExt
    - IsTextureExt
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
    - RenderableTextureExts
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
    - SupportedTextureExts
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
    - TextureMIME
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
  tests:
    - frontend/src/utils/resource/schema.test.ts
use_when:
  - 资源类型
  - 注册表
  - resource_types
  - registry
  - 文件类型
invariant_anchors:
  - resource_types.json|resourceTypes

quick_groups:
  - 配置与注册表
quick_intents:
  - 新增资源类型 / 修改 resource_types.json / 文件类型
quick_risk_lines:
  - resource_types.json 是唯一事实来源；前端只读不判、禁本地重算
pitfalls:
  - ⚠️ 历史：原前端 `services/resource-registry.ts` 异步加载器 `loadResourceRegistry()`（Go RPC + `_registry` 缓存，空/失败不缓存）已由 ADR-269 D3（2026-09）退役——全部消费方迁 `utils/resource/schema.ts` 同步视图 `allResourceTypes`/`resourceTypesById` 后连模块一并删除，勿再引用
  - ⚠️ 历史：原 `services/registry.ts` 服务注册表的 `get` 用 `Map.has()` 判定 falsy 值——该文件已删，本 pitfall 仅存史
  - MMD 子类型 instanceDir 必须精确为 `3d-skin/<子名>`（含子级），漏写一级右键「打开文件夹」打开到错误父目录；TestResolveInstDirTarget_MmdSubtype_3dSkinPrefix 回归测试锁定
status: active
---

# 资源注册表 registry

## 概览

`resource_types.json` 是 YSM 资源类型定义的单一事实来源（Single Source of Truth）。所有资源类型、子目录、扩展名的定义均以此处为准。

## 核心职责

- 定义资源类型及其 `StorageSubDir`、`specificRoot`、`ResourceExts`
- ⚠️ 历史注记：曾存在 services/registry.ts **服务注册表**（与资源类型定义无关），2026-09 已删除，此处不再有同名混淆源
- Go 端 `go/types/` 包同步读取同一份定义

## 对外 API / 入口

- `resource_types.json` — 单一事实源（顶层唯一键 `resourceTypes`），Go `go/types/` 与前端 `utils/resource/schema.ts` 各自同源读取
- `utils/resource/schema.ts`（前端唯一同步入口）— `allResourceTypes: ResourceType[]` + `resourceTypesById: Record<string, ResourceType>`；构建期 import 内联 JSON，无空表窗口
- ⚠️ 历史：原前端 `services/resource-registry.ts` 提供 `loadResourceRegistry()`（异步 Go RPC + 模块级缓存），ADR-269 D3（2026-09）退役全部消费方后连模块删除——勿再引用
- ⚠️ 历史：原 `services/registry.ts` **服务注册表**曾提供 `register/get/has/unregister/clear`（`ServiceName` 联合收窄 + `Map.has()` falsy 判定），2026-09 已删除——勿再引用

## 与其他子系统关系

- `go/types/`: Go 端注册表加载（读同一份 `resource_types.json`）
- `frontend/src/utils/resource/schema.ts`: 前端唯一同步入口（`types.ts`/`extensions.ts`/键控消费方同源消费，ADR-269 D3 起取代原 `services/resource-registry.ts` 异步 RPC 旁路）

## 不变量

- 新增资源类型必须在 `resource_types.json` 中添加，不可在 Go/Frontend 中手写新条目
- 派生守卫（`type-consistency.ts`，ADR-204 收敛）：守护 extensions.ts 必须派生自 resource_types.json（禁手写 RESOURCE_EXTS 副本）；JSON↔JS 字面量比对已不可达废弃，dup id 等结构性校验移交 Go `resource_types_consistency_test.go`
- **MMD 子类型 `instanceDir` 防回归（2026-08-23）**：游戏实际在整合包生成 6 个 `3d-skin/` 子目录——`SceneModel` / `EntityPlayer` / `CustomMorph` / `CustomAnim` / `DefaultMorph` / `DefaultAnim`，这些类型的 `instanceDir` **必须**精确为 `3d-skin/<子名>`（含子级），漏写一级（只写 `3d-skin`）会导致右键「打开文件夹」打开到错误父目录差一级。`StageAnim` / `mmd-shader` 游戏未实际生成独立子目录，`instanceDir` 保持 `3d-skin` 父目录兜底（打开到父级仍可定位，不报错）。`OpenInstanceFolder` → `resolveInstDirTarget` 只用 `rtype.instanceDir` 拼路径、`subdir` 参数已不参与路由（app_scan.go OpenInstanceFolder），所以「兜底」完全依赖 `instanceDir` 数据正确——**纯数据层契约，无代码猜测**。回归测试 `TestResolveInstDirTarget_MmdSubtype_3dSkinPrefix` 锁定这 6 个类型的子目录。

## 相关

- `resource_types.json` — 单一事实源
- 治理红线 §五.4: 注册表优先
