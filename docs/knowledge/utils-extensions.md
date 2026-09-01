---
kind: utils-extensions
name: 扩展名映射 extensions
tier: architecture
category: utils
source_files:
  - frontend/src/utils/resource/extensions.ts
tests:
  - frontend/src/utils/resource/extensions.test.ts
quick_groups:
  - 配置与注册表
quick_intents:
  - 扩展名、支持的文件类型、拖拽过滤
  - RESOURCE_EXTS/ALL_EXTS、导入过滤、扩展名归属
quick_risk_lines:
  - 扩展名判定必须走 extensions.ts 的 isSupportedExt，拖拽导入场景禁止等待异步注册表
pitfalls:
  - 拖拽导入等待异步注册表 → 导入按钮短暂不可用；必须用 RESOURCE_EXTS 静态表
  - 静态表未与 resource_types.json 对齐 → 三端不一致；必须由契约测试守护

use_when:
  - 扩展名
  - 支持的文件类型
  - 拖拽过滤
  - RESOURCE_EXTS
  - ALL_EXTS
  - 导入过滤
  - 扩展名归属
invariant_anchors:
  - frontend/src/utils/resource/extensions.ts|RESOURCE_EXTS
  - frontend/src/utils/resource/extensions.ts|isSupportedExt
---

# 扩展名映射 extensions

## 概览

前端扩展名 → 资源类型映射的集中定义。拖拽导入等场景需要同步判断扩展名（无法等待异步注册表加载），故提供这份静态默认表；事实来源仍是 `resource_types.json`，三端一致性由契约测试守护。

## 核心职责

- 资源类型 → 扩展名列表的静态映射
- 全部支持扩展名的去重列表（UI 提示文案用）
- 扩展名 → 资源类型反查（多对多）

## 对外 API / 入口

- `RESOURCE_EXTS: Record<string, string[]>` — 15 类映射（与 `resource_types.json` 对齐）：resourcepack/shaderpack/ysm/maid-model/blueprint/litematic/EntityPlayer/SceneModel/CustomAnim/CustomMorph/StageAnim/mmd-shader/DefaultAnim/DefaultMorph/fbx，完整列表见 `extensions.ts` 源码
- `ALL_EXTS: string[]` — 全部扩展名去重列表（按 RESOURCE_EXTS 出现顺序）
- `getExts(rtype: string): string[]` — 取某类型的扩展名列表，未知类型返回 `[]`
- `isSupportedExt(ext: string): boolean` — 扩展名是否被支持（大小写不敏感）
- `extBelongsTo(ext: string): string[]` — 扩展名所属的资源类型列表（如 .zip 同属 ysm / resourcepack / shaderpack 三类）

## 与其他子系统关系

- 消费方：`features/dnd-shared.ts`（拖拽过滤 ALL_EXTS）、`features/import-dnd.ts`、`features/import-queue.ts`（导入队列 ALL_EXTS）、`views/app-tree/loader.ts` + `views/app-tree/toolbar-events.ts`（getExts）
- 一致性对端：`resource_types.json`（单一事实源）↔ Go `LoadRegistry()` 运行时加载（无静态 ResourceExts 表）↔ 本文件

## 不变量

- **改扩展名一步到位**：只改 `resource_types.json`——Go 端运行时直读 JSON（无静态 ResourceExts 表），前端 `types.ts`/`extensions.ts` 经 `schema.ts` 的 `allResourceTypes` 自动跟随（T2 收敛：此前二者各自 import JSON 解析）；禁止手改扩展名表（注册表优先，AGENTS.md §4.4）
- 一致性由 vitest 守护（`extensions.test.ts` 双向对账：JSON→前端 + 前端→JSON 反向；新增 `consistency.test.ts` 跨文件契约：`types.ts`↔`extensions.ts` id 集合/扩展名全等）+ Go `registry_test.go`
- 扩展名比较一律小写；扩展名带前导点（".ysm"）
- **`extBelongsTo` 返回顺序为前端表插入序**（P4 观察：Go `ExtBelongsTo` 为注册表序，跨语言数组序不一致——当前前端无生产消费者，若未来 FE↔Go 精确对比需定义排序契约）

## 相关

- [resource_registry](./resource-registry.md) — 单一事实源 resource_types.json
- [utils_resource_types](./utils-resource-types.md) — 资源类型常量
- `frontend/src/utils/resource/extensions.test.ts` — 契约测试（验证入口；知识卡旧文 .js 路径笔误已修正）
