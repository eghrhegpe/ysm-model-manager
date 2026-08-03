---
kind: go_types
name: 共享类型 go/types
tier: architecture
category: go
source_files:
  - go/types/types.go
  - go/types/config.go
  - go/types/resource.go
  - go/types/extensions.go
  - go/types/bedrock.go
  - go/types/resource_types_embed.go
use_when:
  - 共享类型
  - AppConfig
  - 配置
  - 注册表
  - 扩展名
  - LinkType
  - BedrockModel
---

# 共享类型 go/types

## 概览

`go/types/` 包是全应用的共享类型层：应用配置（AppConfig）、各子系统交换的数据结构（模型条目/实例状态/同步结果/日志/投影元数据等）、以及资源类型注册表的 Go 端加载与扩展名查询。与 [resource_registry](./resource_registry.md) 互补：那张卡讲 `resource_types.json` 单一事实源，本卡讲 Go 端的类型定义与配置结构。

## 核心职责

- `types.go` — 跨包数据结构：ModelEntry、VersionInstance、InstanceStatus、ResourceSyncResult、SyncStatus、ImportLog、LinkType、AppError、CustomFileInfo、WindowState、AuthorInfo、SearchResult
- `config.go` — AppConfig（FilesRoot/各类型 Root/LinkMode/Theme/Mirror/VoxelMaxBlocks/窗口状态）、PackInfo、WorkshopSite、WorkshopCreator
- `resource.go` — 注册表加载（LoadRegistry）、PackMeta/FormatRange、LitematicMeta/LitematicVoxelData/VoxelGroup
- `extensions.go` — 注册表驱动的扩展名与子目录查询
- `bedrock.go` — BedrockModel/Bone2D/Cube2D（2D 摘要与 3D 构建共用）
- `resource_types_embed.go` — 编译期嵌入的注册表基线（生成文件，禁止手改）

## 对外 API / 入口

- `LoadRegistry() *ResourceTypeRegistry` — 单例加载注册表，解析优先级：显式路径（`SetRegistryPath`）→ exe 同级/上级 `resource_types.json` → 嵌入基线 `embeddedRegistryJSON`
- `RegistryType(id string) *ResourceType` — 按 id 查类型，无匹配返回 nil
- `SetRegistryPath(path string)` — 仅测试用，重置单例
- 扩展名/目录查询：`AllExts()`、`IsSupportedExt(ext)`、`ExtBelongsTo(ext)`、`SupportedExtsForType(rtype)`、`StorageSubDir(rtype)`、`SubDirMap(rtype)`、`SubDirAll()`、`AllSubDirs()`、`FindInstDir(versionDir, subDir, rtype)`（标准子目录不存在时按扩展名兜底扫描）
- `(pm *PackMeta) Desc() string` — description 可读文本（兼容 string