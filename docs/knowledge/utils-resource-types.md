---
kind: utils-resource-types
name: 资源类型与扩展名派生层 resource-types
tier: architecture
category: utils
source_files:
  - frontend/src/utils/resource/
  - frontend/src/utils/types-re-export.ts
  - frontend/src/features/repo/repo-rtype.ts
tests:
  - frontend/src/features/repo/repo-rtype.test.ts
  - frontend/src/utils/resource/repo-rtype.test.ts
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
    - containerExts
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
    - rtypeGroupLabelOf
    - rtypeLabelOf
    - shortLabelOf
    - typeIconOf
    - useCurrentResourceType
    - VOXEL_RPC_BY_EXT
    - ZipEntryMatch
quick_groups:
  - 配置与注册表
quick_intents:
  - 资源类型、RESOURCE_TYPES、类型标签、注册表加载
  - 扩展名、支持的文件类型、拖拽过滤、RESOURCE_EXTS/ALL_EXTS
  - 存储子目录、storageSubDir、schema.ts 同步视图、resourceTypesById
  - 歧义扩展名、resolveTypeSafe、预览路由 previewKey
quick_risk_lines:
  - 资源类型必须派生自 resource_types.json（前端唯一入口 = schema.ts 同步视图），禁止手写类型映射、禁止异步 RPC 旁路
  - 扩展名判定必须走 extensions.ts 的 isSupportedExt，拖拽导入场景禁止等待异步注册表
  - 歧义扩展名（.zip/.7z）禁止用扩展名直判类型，必须经 resolveTypeSafe 回退 Go DetectResourceType
pitfalls:
  - 手写类型映射 → 与注册表不一致、分类错乱；必须派生自 resource_types.json（走 schema.ts 同步视图）
  - 新增资源类型未注册 → 前端无法识别；必须在 resource_types.json 中注册
  - 拖拽导入等待异步注册表 → 导入按钮短暂不可用；必须用 RESOURCE_EXTS 静态表
  - 静态表未与 resource_types.json 对齐 → 三端不一致；必须由契约测试守护

use_when:
  - 资源类型、RESOURCE_TYPES、类型标签、存储子目录
  - 扩展名、支持的文件类型、拖拽过滤、RESOURCE_EXTS、ALL_EXTS、扩展名归属
  - resourceTypesById、schema.ts、注册表加载
  - 歧义扩展名、resolveTypeSafe、预览路由
invariant_anchors:
  - frontend/src/utils/resource/schema.ts|resourceTypesById
  - frontend/src/utils/resource/schema.ts|allResourceTypes
  - frontend/src/utils/resource/extensions.ts|RESOURCE_EXTS
  - frontend/src/utils/resource/extensions.ts|isSupportedExt
status: active
---

# 资源类型与扩展名派生层 resource-types

> 2026-10-13 合并自原 `utils-extensions` 卡（ADR-338 推广，判据：互引 1↔1 + 同源派生层 + 消费重叠）——扩展名表与类型常量同由 `schema.ts` 派生，一条注册表链一张卡。原卡已归档 `docs/archive/utils-extensions.md`。
>
> `source_files` 为目录级 `frontend/src/utils/resource/`（沿用原卡形态）：覆盖 `schema.ts`/`types.ts`/`extensions.ts` 及目录下其余派生文件（importable.ts 等），无符号膨胀问题（目录符号 <100 阈值）——若未来该目录文件增多触发 WARN 再收窄到具体文件。

## 概览

前端资源类型与扩展名的**同步派生层**（全部从 `resource_types.json` 单一事实源派生，构建期 import 内联）。与 [resource_registry](./resource-registry.md) 卡互补：那张讲 JSON 单一事实源与 Go 端加载；本卡讲 `utils/resource/` 下的前端派生视图——`schema.ts`（唯一 ResourceType 接口 + 单一 JSON 解析点 → `allResourceTypes`/`resourceTypesById`）+ `types.ts`（ID 常量/标签/能力元数据）+ `extensions.ts`（类型↔扩展名静态映射）。

⚠️ ADR-269 D3（2026-09）退役了原 `services/resource-registry.ts` 异步 RPC 旁路，前端资源类型统一走 `schema.ts` 同步视图，无空表窗口。⚠️ 更曾存在的 `services/registry.ts` 服务注册表已于 2026-09 删除，与本卡无关。

## 核心职责

- **单一解析点**：`schema.ts` 内联解析 `resource_types.json` → `allResourceTypes`（插入序 = JSON 序）/ `resourceTypesById`（键控视图）
- **ID 常量与标签**：`RESOURCE_TYPES`（15 个 ID）/ `RESOURCE_TYPE_LABELS`（中文标签，派生自 JSON `name` 字段）/ `ALL_RESOURCE_TYPES`
- **能力元数据派生层**（ADR-066 P0 + ADR-067 S4）：扩展名归属 / 歧义判定 / 类型安全解析 / 预览路由 key / 体素 RPC 映射，全部从注册表派生
- **扩展名静态映射**：类型 → 扩展名列表（`RESOURCE_EXTS`）/ 全量去重（`ALL_EXTS`）/ 反查（`extBelongsTo`）——拖拽导入等场景需同步判断，不能等异步注册表

## 对外 API / 入口

`schema.ts`（同步单一解析点，ADR-269 D3 起取代异步加载器）：
- `allResourceTypes: ResourceType[]` — 全类型条目数组（插入序 = JSON 序），`types.ts`/`extensions.ts`/`web-fs.ts`/`site-edit.ts` 等消费
- `resourceTypesById: Record<string, ResourceType>` — 按 id 键控视图（`Object.fromEntries` 保序），取代原 `loadResourceRegistry()` 的 keyed-map：设置/诊断/同步管理等键控消费方直读此处，与 `allResourceTypes` 同源、无空表窗口
- `ResourceType` 接口（前端消费字段子集，完整 schema 事实源仍是 Go `go/types/resource.go` + 根 `resource_types.json`）：`id/name/icon/group/groupLabel/groupIcon/extensions/storageSubDir/configField/instanceDir/preview/detector/variants/zipEntries`；Go 新增未被前端消费的字段不要求补声明
- ⚠️ 历史：原 `services/resource-registry.ts` 提供 `loadResourceRegistry()`（走 `getApp().LoadResourceTypes()` 异步 RPC + 模块级 `_registry` 缓存），ADR-269 D3（2026-09）删除全部消费方后连模块一并退役——勿再引用

`types.ts`（同步常量）：
- `RESOURCE_TYPES: Record<string, string>` — 15 个 ID 常量（与 `resource_types.json` 对齐）：YSM/MMD/SCENE/CUSTOM_ANIM/CUSTOM_MORPH/STAGE/MMD_SHADER/DEFAULT_ANIM/DEFAULT_MORPH/PACK/SHADER/BLUEPRINT/LITEMATIC/MAID/FBX → "ysm"/"EntityPlayer"/"SceneModel"/... 完整列表见 `types.ts` 源码
- `RESOURCE_TYPE_LABELS: Record<string, string>` — ID → 中文标签；**派生自 `resource_types.json` 的 `name` 字段**，单一事实源，新增类型只需改 JSON
- `ALL_RESOURCE_TYPES: string[]` — 全部 ID 列表
- 能力元数据派生（T2 起与 `extensions.ts` 同源共享 `schema.ts`）：
  - `extOf(path)` — 路径→小写扩展名（含点）
  - `matchTypeByExt(path, typeId)` — 按注册表 extensions 判定归属（不处理歧义，`loader.ts` WASM 能力判定用）
  - `isYsmWasmPreview(path)` — ysm 单文件（`.ysm`/`.json`）走前端 WASM 预览，`.zip`/`.7z` 容器由 Go `FindPreviewImage` 兜底
  - `VOXEL_RPC_BY_EXT` — `.nbt/.schematic/.litematic` → `GetNbtVoxelData/GetSchematicVoxelData/GetLitematicVoxelData` 单点映射
  - `AMBIGUOUS_EXTS` — 歧义扩展名集合（同扩展名归属 ≥2 类型，如 `.zip` 归属 7 类），从注册表派生、新增类型自动纳入
  - `resolveTypeSafe(path)` — **安全解析入口（ADR-067 S4）**：单归属扩展名直接命中；歧义扩展名返回 `null` 强制调用方回退 Go `DetectResourceType` 内容检测；新分发器（P1 VRM / P2 MMD 适配器）统一使用
  - `resolvePreviewKey(filePath, rtype)` / `resolvePreviewKeyToRtype(previewKey)` / `resolvePreviewKeyByExt(filePath)` / `resolveDefaultPreviewKey(rtype)` — 预览路由 key 派生链（ADR-111；`resolvePreviewKeyByExt` 是歧义扩展名预览路由兜底，只做「预览适配器路由」派生、不参与类型判定）
  - `isContainerExt(pathOrExt)` — 压缩容器扩展名判定（值集派生自 `schema.ts|containerExts` ← JSON 顶层 `containerExts`）
  - 内部实现（非导出）：`RESOURCE_CAPS`（派生能力表）/`resolveTypeByExt`（反查）——外部统一走 `resolveTypeSafe`/`matchTypeByExt` 等安全入口

`extensions.ts`（类型 ↔ 扩展名静态映射）：
- `RESOURCE_EXTS: Record<string, string[]>` — 类型 → 扩展名列表静态映射（与 `resource_types.json` 对齐，由 `schema.ts allResourceTypes` 派生；完整列表见 `extensions.ts` 源码）
- `ALL_EXTS: string[]` — 全部扩展名去重列表（按 RESOURCE_EXTS 出现顺序）
- `getExts(rtype: string): string[]` — 取某类型的扩展名列表，未知类型返回 `[]`
- `isSupportedExt(ext: string): boolean` — 扩展名是否被支持（大小写不敏感）
- `extBelongsTo(ext: string): string[]` — 扩展名所属的资源类型列表（如 .zip 同属 ysm / resourcepack / shaderpack 三类）

## 与其他子系统关系

- `RESOURCE_TYPES` 是消费面最广的前端常量：`app-sidebar`、`app-tree`、`app-content`、`app-sync-manager`、`app-preview`、core handler 系、`features/*`
- 键控消费方（ADR-269 D3 起同步读 `schema.ts` `resourceTypesById`）：`features/maintenance/recycle-bin.ts`（图标走 `typeIconOf`）、`app-content/settings/init.ts`、`app-content/diagnostics/dedup.ts` + `perf-matrix-render.ts`、`app-sync-manager/store.ts`
- `RESOURCE_EXTS`/`ALL_EXTS` 消费方：`features/dnd-shared.ts`（拖拽过滤）、`features/import-dnd.ts`、`features/import-queue.ts`、`views/app-tree/toolbar-search.ts` + `toolbar-commands.ts`（getExts）
- 一致性对端：`resource_types.json`（单一事实源）↔ Go `LoadRegistry()` 运行时加载（无静态 ResourceExts 表）↔ 本文件
- Wails 调用统一走 `getApp()`（治理红线 §3.2）
- 图标派生消费方（`typeIconOf` → `fileIcon`）见 [utils_display](./utils-display.md)

## 不变量

- **不在前端手写新的 StorageSubDir / ResourceExts 条目**，新增类型从 `resource_types.json` 开始（注册表优先，AGENTS.md §4.4）——改扩展名一步到位：只改 JSON，Go 端运行时直读，前端 `types.ts`/`extensions.ts` 经 `schema.ts` 自动跟随
- `RESOURCE_TYPE_LABELS` 是 UI 类型中文文案来源，新增类型必须同步补标签
- `schema.ts` 的 `allResourceTypes`/`resourceTypesById` 是构建期内联派生的只读视图，消费方只读不改写（改写会污染同会话所有消费方）
- **歧义扩展名（`.zip`/`.7z`）禁止用扩展名直判类型**：必须经 `resolveTypeSafe`（返回 null）回退 Go `DetectResourceType` 内容指纹
- 扩展名比较一律小写；扩展名带前导点（".ysm"）
- **`extBelongsTo` 返回顺序为前端表插入序**（P4 观察：Go `ExtBelongsTo` 为注册表序，跨语言数组序不一致——当前前端无生产消费者，若未来 FE↔Go 精确对比需定义排序契约）
- 一致性由 vitest 守护：`types.test.ts`（RESOURCE_TYPES/LABELS 与 JSON 对账、`AMBIGUOUS_EXTS` 派生一致、`resolveTypeSafe` 单归属/歧义/大小写、`VOXEL_RPC_BY_EXT` 全覆盖）+ `extensions.test.ts`（双向对账 JSON→前端 + 前端→JSON）+ `consistency.test.ts`（`types.ts`↔`extensions.ts` id 集合/扩展名全等）+ Go `registry_test.go`

## 相关

- [resource_registry](./resource-registry.md) — `resource_types.json` 单一事实源 + Go 端加载
- [utils_display](./utils-display.md) — 文件图标 fileIcon / 文件名着色（同源派生消费）
- [wails_bridge](./wails-bridge.md) — getApp() 桥接
- 测试入口：`frontend/src/utils/resource/types.test.ts`、`extensions.test.ts`、`consistency.test.ts`