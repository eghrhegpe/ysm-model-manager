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
  - frontend/src/features/dialogs/adv-filter.ts
  - frontend/src/features/dialogs/adv-filter-util.ts
  - frontend/src/backend/web-stats.ts
  - internal/app/app_geo_cache.go
  - internal/app/app_scan.go
  - internal/app/app_model.go
auto_fields:
  symbols_with_lines:
    - __setStatsRunnerForTest
    - advFilterClearAll
    - AdvFilterResult
    - AdvFilterTpl
    - AdvFilterValue
    - App.AnalyzeBedrockModel
    - App.AnalyzeBedrockModelEntry
    - App.AnalyzeYSMModel
    - App.Build3DSpecFromGeometryJSON
    - App.CheckFileExists
    - App.ClearScanCache
    - App.ExportModelStructureJSON
    - App.ExtractYSMHeader
    - App.ExtractYSMHeaderFromBase64
    - App.ExtractYsmSummary
    - App.GenerateRepoIndex
    - App.GetModel3DSpec
    - App.ListAllFilePaths
    - App.ListFileNames
    - App.ListModelAuthors
    - App.ListVersionInstances
    - App.ReadFileBytes
    - App.ReadFileBytesBatch
    - App.ReadFileBytesBatchWithMeta
    - App.SaveScreenshotFile
    - App.ScanLocalAuthors
    - App.ScanModelEntries
    - App.ScanModelEntriesFiltered
    - App.ScanModelEntriesWithLabel
    - App.SearchModels
    - AppliedAdvFilter
    - AppTree
    - appTreeStyle
    - batchStatsWebModels
    - bindToolbarEvents
    - buildTree
    - cleanupVirtualScroll
    - Clear
    - consumeWebSearchDegraded
    - createTreeRenderCtx
    - flattenVisible
    - Get
    - getRenderMode
    - getStatsPoolSize
    - getVsMode
    - getVsRows
    - Load
    - modalAdvFilter
    - onStatsProgress
    - openAdvFilterDialog
    - parseFilterNumber
    - pickWebFilesAndImport
    - prefetchStatsWorker
    - ReadFileMeta
    - RenderMode
    - renderTree
    - ROW_H_GRID_COMPACT
    - ROW_H_GRID_NORMAL
    - ROW_H_LIST_COMPACT
    - ROW_H_LIST_NORMAL
    - rowHeightGrid
    - rowHeightList
    - setRenderMode
    - setVsRows
    - terminateStatsWorker
    - TreeNode
    - TreeRenderCtx
    - TreeRow
    - updateStat
    - validateAdvFilter
    - VIEW_TESTIDS
    - WebModelStats
  tests:
    - frontend/src/views/app-tree/toolbar-search.test.ts
    - frontend/src/views/app-tree/toolbar-events.test.ts
    - frontend/src/features/dialogs/adv-filter.test.ts
    - frontend/src/features/dialogs/adv-filter-util.test.ts
invariant_anchors:
  - frontend/src/views/app-tree/toolbar-search.ts|openAdvFilterDialog
  - frontend/src/views/app-tree/toolbar-search.ts|advFilterIntersectPaths
  - frontend/src/features/dialogs/adv-filter.ts|modalAdvFilter
  - frontend/src/backend/web-stats.ts|consumeWebSearchDegraded
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 搜索、筛选、关键词 / 标签 / 数值三路交集
  - SearchModels、adv-filter、网页版降级
  - advFilterIntersectPaths
quick_risk_lines:
  - 搜索筛选必须经 toolbar-search 编排 + adv-filter 弹窗 + SearchModels 后端，前端只做 UI 不做筛选逻辑
pitfalls:
  - 前端本地重算筛选逻辑 → 与后端 SearchModels 能力脱节、结果不一致；必须交后端执行
  - adv-filter 条件未走三路交集（关键词 + 数值 + 标签）→ 结果不精确；必须经 advFilterIntersectPaths

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
       ├─ 12 段 advFilter* 私有子函数线性流水线（advFilterReadCurAndOpenDialog → BackfillInlinePanel → FetchTagPaths → SearchModelPaths → IntersectPaths → ToastAndRender 等）
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
- **编排入口唯一**：`openAdvFilterDialog($, vm)`（`toolbar-search.ts`），12 段 `advFilter*` 私有子函数串成线性流水线

## 错误 / 降级分支（三路）

| 错误源 | 行为 | 用户可见 |
|--------|------|---------|
| tag 查询失败 | 取消该路，其余两路继续 | 无 |
| `SearchModels` 抛错 | 清空过滤（防假绿） | 无 |
| Worker 系统级降级（不可用 / WASM init 重试耗尽 / 取消，ADR-219 D3） | toast + ⚠️ 角标 3s | 是 |
| 单模型挂死（ccall 挂起，ADR-219 细粒度） | 该模型 `hasError` 排除，其余模型真统计，整批正常返回 | 无（模型静默被数值条件排除） |

## 对外 API / 入口

- `openAdvFilterDialog($, vm)` — 编排入口，触发完整流水线
- `_filterPaths` — 白名单注入 `buildTree` 的精确匹配层
- `getAllTags()` — 全量标签候选（兜底）

## Go 绑定（精确函数名）

| 绑定 | 文件 | 用途 |
|------|------|------|
| `SearchModels` | `app_scan.go` | 关键词 + 6 数值范围一次性过滤 |
| `ListByTag` | `app_tags.go` | 按标签反查路径集 |
| `AllTags` | `app_tags.go` | 全量标签候选 |

## 后端几何缓存（geoCache，2026-09-14 落地）

`SearchModels` 每次重跑 `AnalyzeBedrockModel` —— 对真实 `.ysm` 二进制还要拉 Node+WASM 子进程解码，是全仓扫描/搜索热路径最贵单步。`ModelEntry` 不含几何字段、扫描层也不填，故几何分析结果此前零缓存。

新增 `internal/app/app_geo_cache.go` 的 `geoCache` 组件（与 `containerTypeCache`/`resolvedRootCache` 同范：`struct{mu; items}` + `NewApp` 注入 + `ensure` 兜底 + `Clear` 失效）：

- **接入点**：`AnalyzeBedrockModel` 包了一层 `geoCache.Get`，真实解析抽成 `analyzeBedrockModelUncached`（缓存包住整条路径，含 `.ysm`/zip/7z/json 分支与路径守卫）。
- **键**：剥离禁用后缀（`.ban`/`.disabled`）后的 path + 文件指纹（`modtime`+`size`）。文件变动即命中失效、重新计算真实几何。
- **失效**：挂在 `ClearScanCache`（下载/导入后随扫描缓存一起失效），避免模型几何变化后读到旧缓存。
- **不缓存不可 stat 路径**：越权 / 剥离后缀后指向不存在文件 → 直接 `compute`，不写垃圾键。

**边界取舍（下次会话勿误判为 bug）**：缓存键按"剥离后缀后的 path"计算，因此同一文件在 `.ban` ↔ 正常之间切换会产生**两条独立键**各自命中（而非共享）。属可接受代价——`.ban`/`.disabled` 切换本就改变 scannable 归属语义，且 `ClearScanCache` 在导入/下载后统一清掉，不会长期分裂。

**与前端 `SearchResult.Type` 字段的关系（查证根因，非「补一行即可」的死路待办）**：`types.go` 的 `SearchResult.Type` 标了 `omitempty`，`SearchModels` 从不填；而 `ModelEntry.Type` **只在 `ScanModelEntriesFiltered`（带 rtype 过滤）路径填**（`app_scan.go` 的 `e.Type = rtype`，`types.go:35` 注释也写明"未指定 rtype 时为 ''"）。`SearchModels` 走的是全量 `ScanModelEntries`（`app_scan.go`），该路径只填 `HasTags`、不填 `Type`。

→ **关键结论**：在 `SearchModels` 里填 `entry.Type` 会恒取空值、零收益——这是架构路径决定的死字段，不是"漏填一行"。要让搜索结果带类型，必须**先让全量 `ScanModelEntries` 给 entry 推导 `Type`**（依赖 `resource_types.json` 单一事实源 + registry 推导，属回归红线范畴，不可顺手做）。当前阶段 `SearchResult.Type` 应视为预留位（跨类型搜索语义未接上），不要误判为"补一行 `entry.Type` 即可"，也暂不应删除（待 ADR-183 收口时再决定）。

## 与其他子系统关系

- 消费 `toolbar-search.md`（组件层搜索栏）作为用户输入入口
- 消费 `dialog-adv-filter.md`（弹窗 UI）作为参数收集层
- 调用 Go `SearchModels` / `ListByTag`（`go-cli-search.md` 同函数名，CLI 与 GUI 共用后端）
- 数值范围依赖 `model-stats.md`（Web Worker 预计算的骨骼/立方体/纹理统计）

## 不变量

- **前端不重算**：搜索过滤在 Go 执行，前端只负责参数组装与白名单回填（AGENTS 红线）
- **三路任一失败不阻塞**：tag 失败取消该路、SearchModels 抛错清空过滤——保证降级可用而非假绿
- **Worker 系统级降级必须可见**：toast + ⚠️ 角标 3s 提示用户数值条件已被忽略（仅系统级故障；挂死类局部故障走模型级 `hasError` 细粒度降级，无 toast，ADR-219 D3）
- **debounce 150ms**：inline 搜索防高频触发，仅做文本匹配不触后端

## 相关

- [toolbar-search](./toolbar-search.md) — 组件层搜索栏
- [dialog-adv-filter](./dialog-adv-filter.md) — 高级筛选弹窗 UI
- [go-cli-search](./go-cli-search.md) — CLI 搜索命令（共用 SearchModels）
- [model-stats](./model-stats.md) — 数值范围筛选的统计源
- [go-tags](./go-tags.md) — `ListByTag` 后端
