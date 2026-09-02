---
kind: utils-resource-types
name: 资源类型工具 resource-types
tier: architecture
category: utils
source_files:
  - frontend/src/utils/resource/
  - frontend/src/utils/types-re-export.ts
  - frontend/src/features/repo-rtype.ts
auto_fields:
  symbols_with_lines:
    - ALL_EXTS:21
    - ALL_RESOURCE_TYPES:47
    - allResourceTypes:55
    - AMBIGUOUS_EXTS:313
    - currentRepoType:18
    - extBelongsTo:46
    - extOf:168
    - getExts:36
    - getPreviewableTypeTabs:226
    - GROUP_META:104
    - GROUP_OF:119
    - GROUP_TYPE_OPTIONS:140
    - groupLabelOf:125
    - groupStorageRootOf:156
    - GroupTypeOption:135
    - isContainerExt:271
    - isSupportedExt:41
    - isYsmWasmPreview:296
    - loadResourceRegistry:20
    - matchTypeByExt:249
    - matchZipEntryTS:376
    - NO_3D_TYPES:203
    - PreviewTab:219
    - resolveDefaultPreviewKey:281
    - resolvePreviewKey:56
    - resolvePreviewKeyByExt:87
    - resolvePreviewKeyToRtype:72
    - resolveTypeSafe:326
    - RESOURCE_EXTS:16
    - RESOURCE_TYPE_LABELS:28
    - RESOURCE_TYPES:9
    - ResourceType:29
    - ResourceTypeEntry:10
    - ResourceTypeVariant:23
    - shortLabelOf:24
    - typeIconOf:291
    - useCurrentResourceType:28
    - VOXEL_RPC_BY_EXT:302
    - ZipEntryMatch:17
  quick_groups:
    - 配置与注册表
  quick_intents:
    - 资源类型、RESOURCE_TYPES、类型标签
    - 存储子目录、storageSubDir、LoadResourceTypes、注册表加载
  quick_risk_lines:
    - 资源类型注册表必须经 LoadResourceTypes 加载，前端禁止手写类型映射
  pitfalls:
    - 手写类型映射 → 与注册表不一致、分类错乱；必须经 LoadResourceTypes
    - 新增资源类型未注册 → 前端无法识别；必须在 resource_types.json 中注册
  use_when:
    - 资源类型
    - RESOURCE_TYPES
    - 类型标签
    - 存储子目录
    - storageSubDir
    - LoadResourceTypes
    - 注册表加载
  invariant_anchors:
    - frontend/src/utils/resource/registry.ts|_registry
quick_groups:
  - 配置与注册表
quick_intents:
  - 资源类型、RESOURCE_TYPES、类型标签
  - 存储子目录、storageSubDir、LoadResourceTypes、注册表加载
quick_risk_lines:
  - 资源类型注册表必须经 LoadResourceTypes 加载，前端禁止手写类型映射
pitfalls:
  - 手写类型映射 → 与注册表不一致、分类错乱；必须经 LoadResourceTypes
  - 新增资源类型未注册 → 前端无法识别；必须在 resource_types.json 中注册

use_when:
  - 资源类型
  - RESOURCE_TYPES
  - 类型标签
  - 存储子目录
  - storageSubDir
  - LoadResourceTypes
  - 注册表加载
invariant_anchors:
  - frontend/src/utils/resource/registry.ts|_registry
status: active
---

# 资源类型工具 resource-types

## 概览

前端资源类型常量与注册表加载工具。与 [resource_registry](./resource-registry.md) 卡互补：那张讲 `resource_types.json` 单一事实源与 `services/registry.ts`；本卡讲 `utils/` 下的两套工具 —— 静态常量表（同步、直接 import）与轻量注册表加载器（异步、走 Wails binding）。

## 核心职责

- 提供资源类型 ID 常量、中文标签、全类型列表（同步访问，无需等加载）
- 从 Go 端异步加载 resource_types.json 并提供条目/存储子目录查询

## 对外 API / 入口

`resource-types.ts`（同步常量，知识卡旧文「resource-types.ts」文件名漂移，实际为 `types.ts`）：
- `RESOURCE_TYPES: Record<string, string>` — 15 个 ID 常量（与 `resource_types.json` 对齐）：YSM/MMD/SCENE/CUSTOM_ANIM/CUSTOM_MORPH/STAGE/MMD_SHADER/DEFAULT_ANIM/DEFAULT_MORPH/PACK/SHADER/BLUEPRINT/LITEMATIC/MAID/FBX → "ysm"/"EntityPlayer"/"SceneModel"/... 完整列表见 `types.ts` 源码
- `RESOURCE_TYPE_LABELS: Record<string, string>` — ID → 中文标签（YSM 模型/角色模型/场景模型/自定义动画/... 共 15 项；**与 JSON `name` 是不同文案**——LABELS 为缩写「角色模型」，JSON name 为「MMD 角色模型」，同一类型 UI 不同处显示不同）
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

`registry.ts`（异步加载器，知识卡旧文「resource-registry.ts」文件名漂移，实际为 `registry.ts`）：
- `loadResourceRegistry(): Promise<Record<string, ResourceTypeEntry>>` — 经 `getApp().LoadResourceTypes()` 加载，模块级 `_registry` 缓存；**仅当拿到非空 `resourceTypes` 数组才写缓存**（P2 修复：Go 端错误路径返回 `"{}"` 时原实现会缓存空注册表、整会话降级；现失败/空结果返回 `{}` 不缓存，Go 桥瞬断后下次调用重试）
- `ResourceTypeEntry` 接口：`extends ResourceType`（`schema.ts` 唯一完整前端视图：id/name/icon/group/groupLabel/groupIcon/extensions/storageSubDir/configField/instanceDir/preview/detector/variants/zipEntries）+ `[key: string]: unknown` 索引签名（容忍 Go 端未来新增字段，消费者读未知字段需自行 `typeof` 收窄；T2 收敛自原 `{id, storageSubDir?, name?}` 手写子集）
- 有 vitest 覆盖（registry.test.ts：成功缓存/失败不缓存/空结果不缓存/重复调用仅一次 Go 调用，P2 补测）

## 与其他子系统关系

- `RESOURCE_TYPES` 是消费面最广的前端常量：`app-sidebar`、`app-tree`、`app-content`、`app-sync-manager`、`app-preview`、`core/handler-dnd`、`core/handler-sync`、`core/context-menus`、`features/*`（`app-resource-manager` 已于 2026-08-24 删除）
- `loadResourceRegistry` 消费方：`features/recycle-bin.ts`、`features/oldest-models.ts`、`app-content/community/settings.ts` + `diagnostics.ts`
- Wails 调用统一走 `getApp()`（治理红线 §3.2，禁止 window.go.main.App）

## 不变量

- 不在前端手写新的 StorageSubDir / ResourceExts 条目，新增类型从 `resource_types.json` 开始（注册表优先，AGENTS.md §4.4）
- `RESOURCE_TYPE_LABELS` 是 UI 类型中文文案的来源，新增类型必须同步补标签（UI 文案与代码字段一致）
- loadResourceRegistry 返回的 Map 只应读取不应改写；注册表条目查询请基于其返回值就地进行
- **歧义扩展名（`.zip`/`.7z`）禁止用扩展名直判类型**：`.zip` 可包裹任意类型（ADR-067），必须经 `resolveTypeSafe`（返回 null）回退 Go `DetectResourceType` 内容指纹——`AMBIGUOUS_EXTS` 派生自注册表，新增类型含容器扩展名自动纳入歧义集
- **契约测试守护**（`types.test.ts`，18 例）：RESOURCE_TYPES/LABELS 与 JSON 对账、`AMBIGUOUS_EXTS` 与注册表派生一致、`resolveTypeSafe` 单归属/歧义/大小写、`VOXEL_RPC_BY_EXT` 体素扩展名全覆盖（voxelFn 映射契约）

## 相关

- [resource_registry](./resource-registry.md) — 单一事实源 + services/registry.ts
- [utils_extensions](./utils-extensions.md) — 扩展名映射
- [utils_icon](./utils-icon.md) — 文件图标（容器扩展名统一 📦，见 ADR-067 漂移修复）
- [wails_bridge](./wails-bridge.md) — getApp() 桥接
