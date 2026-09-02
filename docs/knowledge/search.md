---
kind: search
name: 搜索筛选编排 search
tier: architecture
category: feature
source_files:
  - frontend/src/views/app-tree/toolbar-search.ts
  - frontend/src/views/app-tree/toolbar-events.ts
  - frontend/src/views/app-tree/index.ts
  - frontend/src/views/app-tree/render.ts
  - frontend/src/utils/dom/dialogs/adv-filter.ts
  - frontend/src/utils/dom/dialogs/adv-filter-util.ts
  - frontend/src/backend/web-stats.ts
invariant_anchors:
  - frontend/src/views/app-tree/toolbar-search.ts|openAdvFilterDialog
  - frontend/src/views/app-tree/toolbar-search.ts|dgAfIntersectPaths
  - frontend/src/utils/dom/dialogs/adv-filter.ts|modalAdvFilter
  - frontend/src/backend/web-stats.ts|consumeWebSearchDegraded
tests:
  - frontend/src/views/app-tree/toolbar-search.test.ts
  - frontend/src/views/app-tree/toolbar-events.test.ts
  - frontend/src/utils/dom/dialogs/adv-filter.test.ts
  - frontend/src/utils/dom/dialogs/adv-filter-util.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 搜索、筛选、关键词 / 标签 / 数值三路交集
  - SearchModels、adv-filter、网页版降级
  - dgAfIntersectPaths
quick_risk_lines:
  - 搜索筛选必须经 toolbar-search 编排 + adv-filter 弹窗 + SearchModels 后端，前端只做 UI 不做筛选逻辑
pitfalls:
  - 前端本地重算筛选逻辑 → 与后端 SearchModels 能力脱节、结果不一致；必须交后端执行
  - adv-filter 条件未走三路交集（关键词 + 数值 + 标签）→ 结果不精确；必须经 dgAfIntersectPaths

use_when:
  - 搜索
  - 筛选
  - 三路交集
  - adv-filter
  - SearchModels
  - 网页版降级
status: active
---

# 搜索筛选编排 search

## 概览

搜索筛选的**跨层端到端编排层**：前端工具栏搜索输入 → 关键词 + 标签 + 数值三路交集 → 后端 Go 一次性过滤 → 白名单回填 `buildTree` 精确匹配。

> **差异化定位**：已有 `toolbar-search.md`（组件层搜索栏）、`dialog-adv-filter.md`（弹窗 UI）、`go-cli-search.md`（CLI 命令）分述各层；本卡作为 feature 卡专注**跨文件编排视角**——一次用户搜索动作如何串联这三张卡各自描述的层。

## 编排流程（端到端）

```
用户输入（inline #srch debounce 150ms 或 高级筛选弹窗）
  │
  ├─ inline 搜索：仅前端 _search 文本匹配（轻量、不触后端）
  │
  └─ 高级筛选：openAdvFilterDialog($) 编排入口
       │
       ├─ 8 段 dgAf* 私有子函数线性流水线
       ├─ 组装三路参数
       │   ├─ 关键词 + 6 数值范围 → getApp().SearchModels()
       │   ├─ 标签列表 → getApp().ListByTag()
       │   └─ getAllTags() 兜底候选
       │
       ├─ 三路结果客户端 Set 交集
       │
       └─ _filterPaths 白名单 → buildTree 精确匹配
```

## 核心职责

- **三路交集语义**：`SearchModels`（关键词 + 6 数值范围一次性过滤）+ `ListByTag`（标签路径集）+ 客户端 `Set` 交集 → `_filterPaths` 白名单 → `buildTree` 精确匹配
- **两路搜索**：inline `#srch` debounce 150ms 仅做前端 `_search` 文本匹配（轻量路径）；高级筛选走 Go 后端 + 白名单（全量路径），两者叠加生效
- **编排入口唯一**：`openAdvFilterDialog($, vm)`（`toolbar-search.ts`），8 段 `dgAf*` 私有子函数串成线性流水线

## 错误 / 降级分支（三路）

| 错误源 | 行为 | 用户可见 |
|--------|------|---------|
| tag 查询失败 | 取消该路，其余两路继续 | 无 |
| `SearchModels` 抛错 | 清空过滤（防假绿） | 无 |
| Worker 降级 | toast + ⚠️ 角标 3s | 是 |

## 对外 API / 入口

- `openAdvFilterDialog($, vm)` — 编排入口，触发完整流水线
- `_filterPaths` — 白名单注入 `buildTree` 的精确匹配层
- `getAllTags()` — 全量标签候选（兜底）

## Go 绑定（精确函数名）

| 绑定 | 文件 | 用途 |
|------|------|------|
| `SearchModels` | `app_scan.go:62` | 关键词 + 6 数值范围一次性过滤 |
| `ListByTag` | `app_tags.go:38` | 按标签反查路径集 |
| `AllTags` | `app_tags.go:43` | 全量标签候选 |

## 与其他子系统关系

- 消费 `toolbar-search.md`（组件层搜索栏）作为用户输入入口
- 消费 `dialog-adv-filter.md`（弹窗 UI）作为参数收集层
- 调用 Go `SearchModels` / `ListByTag`（`go-cli-search.md` 同函数名，CLI 与 GUI 共用后端）
- 数值范围依赖 `model-stats.md`（Web Worker 预计算的骨骼/立方体/纹理统计）

## 不变量

- **前端不重算**：搜索过滤在 Go 执行，前端只负责参数组装与白名单回填（AGENTS 红线）
- **三路任一失败不阻塞**：tag 失败取消该路、SearchModels 抛错清空过滤——保证降级可用而非假绿
- **Worker 降级必须可见**：toast + ⚠️ 角标 3s 提示用户统计数据可能滞后
- **debounce 150ms**：inline 搜索防高频触发，仅做文本匹配不触后端

## 相关

- [toolbar-search](./toolbar-search.md) — 组件层搜索栏
- [dialog-adv-filter](./dialog-adv-filter.md) — 高级筛选弹窗 UI
- [go-cli-search](./go-cli-search.md) — CLI 搜索命令（共用 SearchModels）
- [model-stats](./model-stats.md) — 数值范围筛选的统计源
- [go-tags](./go-tags.md) — `ListByTag` 后端
