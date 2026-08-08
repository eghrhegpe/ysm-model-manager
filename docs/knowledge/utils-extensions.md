---
kind: utils-extensions
name: 扩展名映射 extensions
tier: leaf
category: utils
source_files:
  - frontend/src/utils/resource/extensions.ts
use_when:
  - 扩展名
  - 支持的文件类型
  - 拖拽过滤
  - RESOURCE_EXTS
  - ALL_EXTS
  - 导入过滤
  - 扩展名归属
---

# 扩展名映射 extensions

## 概览

前端扩展名 → 资源类型映射的集中定义。拖拽导入等场景需要同步判断扩展名（无法等待异步注册表加载），故提供这份静态默认表；事实来源仍是 `resource_types.json`，三端一致性由契约测试守护。

## 核心职责

- 资源类型 → 扩展名列表的静态映射
- 全部支持扩展名的去重列表（UI 提示文案用）
- 扩展名 → 资源类型反查（多对多）

## 对外 API / 入口

- `RESOURCE_EXTS: Record<string, string[]>` — 7 类映射：ysm(.ysm/.zip/.7z/.json)、mmd-skin(.pmx/.pmd)、vrchat-avatar(.vrca/.vrm)、resourcepack(.zip)、shaderpack(.zip)、create-blueprint(.nbt/.schematic)、litematic(.litematic)
- `ALL_EXTS: string[]` — 全部扩展名去重列表（按 RESOURCE_EXTS 出现顺序）
- `getExts(rtype: string): string[]` — 取某类型的扩展名列表，未知类型返回 `[]`
- `isSupportedExt(ext: string): boolean` — 扩展名是否被支持（大小写不敏感）
- `extBelongsTo(ext: string): string[]` — 扩展名所属的资源类型列表（如 .zip 同属 ysm / resourcepack / shaderpack 三类）

## 与其他子系统关系

- 消费方：`features/dnd-shared.ts`（拖拽过滤 ALL_EXTS）、`features/import-dnd.ts`、`features/import-queue.ts`（导入队列 ALL_EXTS）、`views/app-tree/loader.ts` + `views/app-tree/toolbar-events.ts`（getExts）
- 一致性对端：`resource_types.json`（单一事实源）↔ Go `LoadRegistry()` 运行时加载（无静态 ResourceExts 表）↔ 本文件

## 不变量

- **改扩展名两步走**：1) 改 `resource_types.json` → 2) 改本文件（Go 端运行时直读 JSON 无需手工改）；两处必须同步，禁止单独改本文件（注册表优先，AGENTS.md §4.4）
- 一致性由 vitest 守护（`extensions.test.ts` 已 import `resource_types.json` 做双向对账——7 类型/每类型扩展名/无额外类型，P2 修复：原测试硬编码断言，三端一致性只靠退出码恒 0 陷阱的外部 type-consistency.mjs）+ Go `registry_test.go`
- 扩展名比较一律小写；扩展名带前导点（".ysm"）

## 相关

- [resource_registry](./resource-registry.md) — 单一事实源 resource_types.json
- [utils_resource_types](./utils-resource-types.md) — 资源类型常量
- `frontend/src/utils/resource/extensions.test.js` — 契约测试（验证入口）
