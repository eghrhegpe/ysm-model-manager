---
kind: utils-resource-types
name: 资源类型工具 resource-types
tier: architecture
category: utils
source_files:
  - frontend/src/utils/resource/
  - frontend/src/utils/types-re-export.ts
  - frontend/src/features/repo/repo-rtype.ts
tests:
  - frontend/src/features/repo-rtype.test.ts
auto_fields:
  symbols_with_lines:
    - __resetShortLabelCacheForTest
    - ALL_EXTS
    - ALL_RESOURCE_TYPES
    - allResourceTypes
    - AMBIGUOUS_EXTS
    - asArray
    - asNumber
    - asString
    - currentRepoType
    - DataGlyph
    - DedupGroup
    - extBelongsTo
    - extOf
    - FileConflict
    - getCompound
    - getExts
    - getPreviewableTypeTabs
    - GROUP_META
    - GROUP_OF
    - GROUP_TYPE_OPTIONS
    - groupLabelOf
    - groupStorageRootOf
    - GroupTypeOption
    - HealthReport
    - isContainerExt
    - isImportableFile
    - isObj
    - isSupportedExt
    - isSupportedFile
    - isYsmWasmPreview
    - matchTypeByExt
    - matchZipEntryTS
    - NO_3D_TYPES
    - previewCandidateExtsOf
    - PreviewTab
    - resolveDefaultPreviewKey
    - resolvePreviewKey
    - resolvePreviewKeyByExt
    - resolvePreviewKeyToRtype
    - resolveTypeSafe
    - RESOURCE_EXTS
    - RESOURCE_TYPE_LABELS
    - RESOURCE_TYPES
    - ResourceType
    - resourceTypesById
    - ResourceTypeVariant
    - shortLabelOf
    - typeIconOf
    - useCurrentResourceType
    - VOXEL_RPC_BY_EXT
    - ZipEntryMatch
quick_groups:
  - 配置与注册表
quick_intents:
  - 资源类型、RESOURCE_TYPES、类型标签
  - 存储子目录、storageSubDir、资源类型同步视图、schema.ts
quick_risk_lines:
  - 资源类型必须派生自 resource_types.json（前端唯一入口 = schema.ts 的同步视图 allResourceTypes/resourceTypesById），禁止手写类型映射、禁止异步 RPC 旁路
pitfalls:
  - 手写类型映射 → 与注册表不一致、分类错乱；必须派生自 resource_types.json（走 schema.ts 同步视图）
  - 新增资源类型未注册 → 前端无法识别；必须在 resource_types.json 中注册

use_when:
  - 资源类型
  - RESOURCE_TYPES
  - 类型标签
  - 存储子目录
  - storageSubDir
  - resourceTypesById
  - 注册表加载
invariant_anchors:
  - frontend/src/utils/resource/schema.ts|resourceTypesById
status: active
---

# 资源类型工具 resource-types

## 概览

前端资源类型常量与派生工具。与 [resource_registry](./resource-registry.md) 卡互补：那张讲 `resource_types.json` 单一事实源与 Go 端加载；本卡讲 `utils/resource/` 下的同步派生层 —— `schema.ts`（唯一 ResourceType 接口 + 单一 JSON 解析点，导出 `allResourceTypes`/`resourceTypesById`）与 `types.ts`/`extensions.ts`（同源派生视图）。⚠️ ADR-269 D3（2026-09）退役了原 `services/resource-registry.ts` 异步 RPC 旁路，前端资源类型统一走 `schema.ts` 同步视图，无空表窗口。⚠️ 更曾存在的 `services/registry.ts` 服务注册表已于 2026-09 删除，与本卡无关。

## 核心职责

- 提供资源类型 ID 常量、中文标签、全类型列表（同步访问，无需等加载）
- 键控条目/存储子目录查询走 `schema.ts` 的同步视图 `resourceTypesById`（构建期 import 内联，ADR-269 D3 起取代异步 RPC）

## 对外 API / 入口

`resource-types.ts`（同步常量，知识卡旧文「resource-types.ts」文件名漂移，实际为 `types.ts`）：
- `RESOURCE_TYPES: Record<string, string>` — 15 个 ID 常量（与 `resource_types.json` 对齐）：YSM/MMD/SCENE/CUSTOM_ANIM/CUSTOM_MORPH/STAGE/MMD_SHADER/DEFAULT_ANIM/DEFAULT_MORPH/PACK/SHADER/BLUEPRINT/LITEMATIC/MAID/FBX → "ysm"/"EntityPlayer"/"SceneModel"/... 完整列表见 `types.ts` 源码
- `RESOURCE_TYPE_LABELS: Record<string, string>` — ID → 中文标签（YSM 模型/角色模型/场景模型/自定义动画/... 共 15 项）；**派生自 `resource_types.json` 的 `name` 字段**（`allResourceTypes.filter(t => t.name).map(t => [t.id, t.name])`），单一事实源，新增类型只需改 JSON，无需手动维护双表
- `ALL_RESOURCE_TYPES: string[]` — 全部 ID 列表
- **能力元数据派生层（ADR-066 P0 + ADR-067 S4，由 `resource_types.json` 派生，单一事实来源；T2 起 JSON 解析收口到 `schema.ts` 的 `allResourceTypes`，`types.ts`/`extensions.ts` 同源共享）**：
  - `extOf(path)` — 路径→小写扩展名（含点）
  - `matchTypeByExt(path, typeId)` — 按注册表 extensions 判定归属（不处理歧义，`loader.ts` 的 WASM 能力判定用）
  - `isYsmWasmPreview(path)` — ysm 单文件（`.ysm`/`.json`）走前端 WASM 预览，`.zip`/`.7z` 容器由 Go `FindPreviewImage` 兜底（`index.ts` 缩略图加载用）
  - `VOXEL_RPC_BY_EXT` — `.nbt/.schematic/.litematic` → `GetNbtVoxelData/GetSchematicVoxelData/GetLitematicVoxelData` 单点映射（`litematic-meta.ts` 用，解硬编码字符串分支）
  - `AMBIGUOUS_EXTS` — 歧义扩展名集合（同扩展名归属 ≥2 类型，如 `.zip` 归属 7 类），从注册表派生、新增类型自动纳入
  - `resolveTypeSafe(path)` — **安全解析入口（ADR-067 S4）**：单归属扩展名直接命中；歧义扩展名返回 `null` 强制调用方回退 Go `DetectResourceType` 内容检测；新分发器（P1 VRM / P2 MMD 适配器）统一使用
  - `resolvePreviewKey(filePath, rtype)` — 按 variants 解析预览 key（ADR-111：`.pmx→mmd`、`.vrm→vrm`），无变体回退 rtype 自身
  - `resolvePreviewKeyToRtype(previewKey)` — 预览键反解真实资源类型 ID（"mmd"→"EntityPlayer"，`scanModelsByType` 白名单过滤用）
  - `resolvePreviewKeyByExt(filePath)` — **歧义扩展名预览路由兜底（ADR-111 兜底层）**：DetectResourceType 对多声明扩展名（如 `.pmx` 同时归属 EntityPlayer/SceneModel）保守返回 `"other"` 时，按扩展名取首个声明者的 preview key（`.pmx/.pmd→mmd`）兜底路由；只做「预览适配器路由」派生，不参与类型判定；无 variants 声明返回空串
  - `resolveDefaultPreviewKey(rtype)` — **rtype 默认预览 key（容器兜底，2026-08-28）**：取该类型首个 variants 的 preview（EntityPlayer→mmd），无 variants 回退 rtype 自身；供 `openModel3DFullscreen` 对 `.zip` 容器（被路径消歧归 rtype 但 variants 无 `.zip`）按默认适配器路由
  - `isContainerExt(pathOrExt)` — 压缩容器扩展名判定（`.zip`/`.7z`；容器可包裹任意类型，类型判定仍以 Go 内容检测为准）
  - 内部实现（非导出）：`RESOURCE_CAPS`（派生能力表）/`resolveTypeByExt`（反查）——外部统一走 `resolveTypeSafe`/`matchTypeByExt` 等安全入口（2026-08-16 去 export 收敛，消除死代码告警）

`schema.ts`（同步单一解析点，ADR-269 D3 起取代异步加载器）：
- `allResourceTypes: ResourceType[]` — 全类型条目数组（插入序 = JSON 序），`types.ts`/`extensions.ts`/`web-fs.ts`/`site-edit.ts` 等消费
- `resourceTypesById: Record<string, ResourceType>` — 按 id 键控视图（`Object.fromEntries` 保序），取代原 `loadResourceRegistry()` 的 keyed-map：设置/诊断/同步管理等键控消费方直读此处，与 `allResourceTypes` 同源、无空表窗口
- `ResourceType` 接口（前端消费字段子集，完整 schema 事实源仍是 Go `go/types/resource.go` + 根 `resource_types.json`）：`id/name/icon/group/groupLabel/groupIcon/extensions/storageSubDir/configField/instanceDir/preview/detector/variants/zipEntries`；Go 新增未被前端消费的字段不要求补声明
- ⚠️ 历史：原 `services/resource-registry.ts` 提供 `loadResourceRegistry()`（走 `getApp().LoadResourceTypes()` 异步 RPC + 模块级 `_registry` 缓存），ADR-269 D3（2026-09）删除全部消费方后连模块一并退役——勿再引用

## 与其他子系统关系

- `RESOURCE_TYPES` 是消费面最广的前端常量：`app-sidebar`、`app-tree`、`app-content`、`app-sync-manager`、`app-preview`、`core/handler-dnd`、`core/handler-sync`、`core/context-menus`、`features/*`（`app-resource-manager` 已于 2026-08-24 删除）
- 键控消费方（ADR-269 D3 起同步读 `schema.ts` `resourceTypesById`）：`features/maintenance/recycle-bin.ts`（图标走 `typeIconOf`）、`app-content/settings/init.ts`、`app-content/diagnostics/dedup.ts` + `perf-matrix-render.ts`、`app-sync-manager/store.ts`
- Wails 调用统一走 `getApp()`（治理红线 §3.2，禁止 window.go.main.App）

## 不变量

- 不在前端手写新的 StorageSubDir / ResourceExts 条目，新增类型从 `resource_types.json` 开始（注册表优先，AGENTS.md §4.4）
- `RESOURCE_TYPE_LABELS` 是 UI 类型中文文案的来源，新增类型必须同步补标签（UI 文案与代码字段一致）
- `schema.ts` 导出的 `allResourceTypes`/`resourceTypesById` 是构建期内联派生的只读视图，消费方只读不改写（改写会污染同会话所有消费方）
- **歧义扩展名（`.zip`/`.7z`）禁止用扩展名直判类型**：`.zip` 可包裹任意类型（ADR-067），必须经 `resolveTypeSafe`（返回 null）回退 Go `DetectResourceType` 内容指纹——`AMBIGUOUS_EXTS` 派生自注册表，新增类型含容器扩展名自动纳入歧义集
- **契约测试守护**（`types.test.ts`，18 例）：RESOURCE_TYPES/LABELS 与 JSON 对账、`AMBIGUOUS_EXTS` 与注册表派生一致、`resolveTypeSafe` 单归属/歧义/大小写、`VOXEL_RPC_BY_EXT` 体素扩展名全覆盖（voxelFn 映射契约）

## 相关

- [resource_registry](./resource-registry.md) — `resource_types.json` 单一事实源 + Go 端加载（前端异步加载器 ADR-269 D3 已退役，统一走本卡 `schema.ts` 同步视图）
- [utils_extensions](./utils-extensions.md) — 扩展名映射
- [utils_icon](./utils-icon.md) — 文件图标（容器扩展名统一 📦，见 ADR-067 漂移修复）
- [wails_bridge](./wails-bridge.md) — getApp() 桥接
