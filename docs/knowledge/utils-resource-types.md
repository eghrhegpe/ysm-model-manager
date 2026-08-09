---
kind: utils-resource-types
name: 资源类型工具 resource-types
tier: leaf
category: utils
source_files:
  - frontend/src/utils/resource/types.ts
  - frontend/src/utils/resource/registry.ts
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
---

# 资源类型工具 resource-types

## 概览

前端资源类型常量与注册表加载工具。与 [resource_registry](./resource-registry.md) 卡互补：那张讲 `resource_types.json` 单一事实源与 `services/registry.ts`；本卡讲 `utils/` 下的两套工具 —— 静态常量表（同步、直接 import）与轻量注册表加载器（异步、走 Wails binding）。

## 核心职责

- 提供资源类型 ID 常量、中文标签、全类型列表（同步访问，无需等加载）
- 从 Go 端异步加载 resource_types.json 并提供条目/存储子目录查询

## 对外 API / 入口

`resource-types.ts`（同步常量，知识卡旧文「resource-types.ts」文件名漂移，实际为 `types.ts`）：
- `RESOURCE_TYPES: Record<string, string>` — 7 个 ID 常量：YSM/MMD/VRC/PACK/SHADER/BLUEPRINT/LITEMATIC → "ysm" / "mmd-skin" / "vrchat-avatar" / "resourcepack" / "shaderpack" / "create-blueprint" / "litematic"
- `RESOURCE_TYPE_LABELS: Record<string, string>` — ID → 中文标签（模型/MMD/VRC/资源包/光影包/蓝图/投影；**与 JSON `name` 是不同文案**——LABELS 为缩写「模型」，JSON name 为「YSM 模型」，同一类型 UI 不同处显示不同，P4 观察）
- `ALL_RESOURCE_TYPES: string[]` — 全部 ID 列表

`registry.ts`（异步加载器，知识卡旧文「resource-registry.ts」文件名漂移，实际为 `registry.ts`）：
- `loadResourceRegistry(): Promise<Record<string, ResourceTypeEntry>>` — 经 `getApp().LoadResourceTypes()` 加载，模块级 `_registry` 缓存；**仅当拿到非空 `resourceTypes` 数组才写缓存**（P2 修复：Go 端错误路径返回 `"{}"` 时原实现会缓存空注册表、整会话降级；现失败/空结果返回 `{}` 不缓存，Go 桥瞬断后下次调用重试）
- `ResourceTypeEntry` 接口：`{ id, storageSubDir?, label?, [key: string]: unknown }`（`label` 为幽灵字段，JSON 无此字段、全库无消费者读 entry.label；真实 JSON 有 13+ 字段含 `name/icon`，经索引签名读出 `unknown`，消费者需自行 `typeof` 收窄）
- 有 vitest 覆盖（registry.test.ts：成功缓存/失败不缓存/空结果不缓存/重复调用仅一次 Go 调用，P2 补测）

## 与其他子系统关系

- `RESOURCE_TYPES` 是消费面最广的前端常量：`app-sidebar`、`app-tree`、`app-content`、`app-sync-manager`、`app-resource-manager`、`app-preview`、`core/handler-dnd`、`core/handler-sync`、`core/context-menus`、`features/*`
- `loadResourceRegistry` 消费方：`features/recycle-bin.ts`、`features/oldest-models.ts`、`app-content/community/settings.ts` + `diagnostics.ts`
- Wails 调用统一走 `getApp()`（治理红线 §3.2，禁止 window.go.main.App）

## 不变量

- 不在前端手写新的 StorageSubDir / ResourceExts 条目，新增类型从 `resource_types.json` 开始（注册表优先，AGENTS.md §4.4）
- `RESOURCE_TYPE_LABELS` 是 UI 类型中文文案的来源，新增类型必须同步补标签（UI 文案与代码字段一致）
- loadResourceRegistry 返回的 Map 只应读取不应改写；注册表条目查询请基于其返回值就地进行

## 相关

- [resource_registry](./resource-registry.md) — 单一事实源 + services/registry.ts
- [utils_extensions](./utils-extensions.md) — 扩展名映射
- [wails_bridge](./wails-bridge.md) — getApp() 桥接
- `frontend/src/utils/resource/resource-types.test.js` — 单元测试（验证入口）
