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
    - App.AnalyzeMmdStats
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
    - emptyStateForEmptyEntries
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
    - SelectedKeys
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
| tag 查询失败 | 取消该路，其余两路继续 | toast `toolbar-search.ts\|advFilterFetchTagPaths`（`tree.tagQueryFail`，verbose 级） |
| `SearchModels` 抛错 | 清空过滤（防假绿） | toast `toolbar-search.ts\|advFilterSearchModelPaths`（`tree.advFilterFail`，long 级） |
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
- **不缓存解析失败（空结果）**（锐评 2026-10-09 补齐）：`analyzeBedrockModelUncached` 失败返回空
  `BedrockModel{}`（`.ysm` WASM 解码挂起 / 越权等）；原实现**无条件缓存空结果**，会把**临时失败固化**——
  模型在后续搜索里「永久消失」直到 `ClearScanCache`（假绿）。现 `geoCache.Get` 对 `BoneCount==0` 不写缓存、
  下次重试（失败模型数量有限，代价可接受）；对齐 contract-b1「`BoneCount==0` = 无内容」语义。
- **字节预算封顶（2026-10-14 锐评 P2 补齐）**：`BedrockModel` 含 base64 纹理，原无界 map 在万级模型库
  一轮全量搜索后可驻留数百 MB 直到下次导入 `Clear`（桌面应用长驻进程，内存只进不出）。现 `geoCache`
  带 `geoCacheMaxBytes`（128MB）字节预算：条目成本按 `geoCacheEntryBytes` 估算（纹理占绝对大头，单调
  稳定即可）；覆盖既有键先扣旧成本再账新值；超预算按 FIFO（首次插入序）逐出最旧条目，单条超预算时
  保留该条（不逐出到 0）；`Clear` 复位逐出记账。测试 seam `newGeoCacheWithMax`（未导出，同包测试）。

**边界取舍（下次会话勿误判为 bug）**：缓存键按"剥离后缀后的 path"计算，因此同一文件在 `.ban` ↔ 正常之间切换会产生**两条独立键**各自命中（而非共享）。属可接受代价——`.ban`/`.disabled` 切换本就改变 scannable 归属语义，且 `ClearScanCache` 在导入/下载后统一清掉，不会长期分裂。

**`benchmark` 命令每迭代清缓存测冷启动**（锐评 2026-10-09）：`go/cli/model.go|runBenchmark` 的 B1 扫描 / B2 全量搜索 / B3 关键词搜索**每迭代首行调 `ClearScanCache`**——原实现 `AppService` 未声明 `ClearScanCache`（`go/cli/appservice.go`），迭代 2 起命中 `ScanModelEntries` 30s 缓存 + `geoCache`，扫描/搜索基准**计时失真**（测的是缓存命中后的热性能，非冷启动）。代价是每次迭代真实扫盘，正是基准要测的。`single-bench`（`perf_snapshot.go|runBenchIterations`）是单模型 N 轮基准，与本命令无关。**⚠️ 刀 2 后语义位移（2026-10-14）**：B2/B3 不带数值条件 → 走直通路径**不再触发几何分析**——B2 已收敛为「扫描 + 直通」成本（~18ms 量级），全量几何分析成本改由 B4 单模型分析 / `single-bench` 度量；读旧基准数据（B2 冷 ~580ms）时注意那是刀 2 前的「搜索隐式全库解析」口径。

**全量扫描 Type 派生（ADR-343 刀 1 已落地，2026-10-14）**：`app_scan.go|fillEntryTypes` 在 `scanModelEntriesWithHit` 末尾为全量扫描条目填 `ModelEntry.Type`——判定单一事实源 = registry + 内容指纹（复用既有分类器，不新写判定逻辑）：裸扩展名走 `packs.DetectResourceType`（嵌套/location/扩展名三段，零 I/O，多声明者 (priority desc, id asc) 确定性裁决，与导入 classifyForScan 同口径）；容器扩展名（.zip/.7z）经 `containerCache` 指纹缓存（modtime/size 变即重核验，避免逐扫重开归档），内容未识别回 `container` 诚实占位（ClassifyResource 的 ClassContainer，不猜）。性能门禁实测（混合类型实证库，`scan-bench`/`benchmark` 前后对照）：B1 扫描 ~13ms→~17ms（+5ms = 容器指纹冷开档，热态归零）、B2 全量搜索冷 ~580→620ms（+40ms，≤800ms 门槛内）、B3 关键词搜索不变——成本面受控。测试 `app_scan_typefill_test.go`（7 条目表驱动：单声明者 / location 消歧 / 多声明者确定性裁决 / 容器指纹 / container 占位 + Filtered 路径 rtype 覆盖不受破坏）。
**`SearchResult.Type` 收口（ADR-343 刀 3 已落地，2026-10-14）**：`types.go` 的 `SearchResult.Type` 曾标 `omitempty` 从不填充——「查证根因」段的结论是：须先让全量 `ScanModelEntries` 给条目推导 `Type`（刀 1），搜索结果才「有得填」。刀 1+2 落地后，刀 3 即三条路径（顺序/并发分析 + 无数值直通）统一 `Type: entry.Type` 下发：分析路径结果必为几何系类型（分流保证），直通路径原样透传占位值（`container`/`other`，诚实不猜）——前端可区分「无几何数据」与「未知类型」。历史锚点：ADR-183 是 8 参数封装的暂缓决策、不覆盖 Type 语义，本卡原句曾误挂 ADR-183（2026-10-14 修正后随刀 3 销账）。
**过渡态（A 案已落地）**：`resource_types.json` 的 `geometrySearchable` 声明（ysm / maid-model）驱动前端 adv-filter 数值区展示端门控——无几何管线类型禁用数值条件并提示，数值条件不再静默蒸发整类条目（能力面收口归 ADR-343，展示端门控见知识卡 dialog-adv-filter）。
**8 参数收编 `SearchFilters`（ADR-343 刀 4 已落地，2026-10-14）**：`SearchModels(filesRoot, filters types.SearchFilters)`——Wails 绑定契约变更（`npm run generate:bindings` 重生成，生成 diff 面 3 文件：models.ts 新增 `SearchFilters` + app.ts 签名 + types index）。口径：数值字段 0 = 未设置（不限）、Keyword 空串 = 不限（与前端 `parseFilterNumber`、`modelMatchesFilters` 同源）；结构体可扩展 = 新过滤维度追加字段不再扩签名。执行修订：不带「目标 rtype 集合」字段（跨类型检索无消费方，带上即死参数——扩展位留给跨类型语义立项时追加）。同步面：CLI 3 处 + Go 测试 23 处 + 前端 4 套件（web-fs 适配层经 `satisfies Partial<GoBindingShape>` 编译期对账，测试位 44 处机械改写）；ADR-183（8 参数暂缓决策）标 ❌ 已取代。

## 与其他子系统关系

- 消费 `toolbar-search.md`（组件层搜索栏）作为用户输入入口
- 消费 `dialog-adv-filter.md`（弹窗 UI）作为参数收集层
- 调用 Go `SearchModels` / `ListByTag`（`go-cli-search.md` 同函数名，CLI 与 GUI 共用后端）
- 数值范围依赖 `model-stats.md`（Web Worker 预计算的骨骼/立方体/纹理统计）

## 不变量

- **前端不重算**：搜索过滤在 Go 执行，前端只负责参数组装与白名单回填（AGENTS 红线）
- **`BoneCount==0` 排除已改数值条件化（ADR-343 刀 2 落地，2026-10-14）**：旧实现 `modelMatchesFilters` 首行无条件排除，让「不带任何过滤的关键词独占搜」也静默丢掉无几何条目的半仓结果（4 条目实证库蒸发 2 条 zip，数据在案）。现 `SearchModels` 双路径：
  - **无数值条件（6 范围全 0）→ `searchModelsUnanalyzed` 直通**：候选全量零值几何返回（不跑分析器、不蒸发；消费端 omitempty = 无几何数据）；
  - **数值条件已设置 → 按 entry.Type 分流**（刀 1 派生 + 单点出口 `registry.IsGeometrySearchableID`，ysm/maid-model 进分析器，非几何系显式排除且不白解析）。
  实测：同一实证库无过滤搜索 2/4 → **4/4** 条；B2 全量搜索冷 ~580ms → ~18ms（32x，几何分析成本移出搜索、归位显式分析路径），B3 关键词搜索 ~155ms → ~17ms。测试 `app_scan_search_dispatch_test.go`（未知 zip 不蒸发 / 数值排除 container 占位 / maid 端到端命中）+ `TestSearchModels_ZeroBoneFilter` 双语义拆断言
- **三路任一失败不阻塞**：tag 失败取消该路、SearchModels 抛错清空过滤——保证降级可用而非假绿
- **Worker 系统级降级必须可见**：toast + ⚠️ 角标 3s 提示用户数值条件已被忽略（仅系统级故障；挂死类局部故障走模型级 `hasError` 细粒度降级，无 toast，ADR-219 D3）
- **debounce 150ms**：inline 搜索防高频触发，仅做文本匹配不触后端

## 相关

- [toolbar-search](./toolbar-search.md) — 组件层搜索栏
- [dialog-adv-filter](./dialog-adv-filter.md) — 高级筛选弹窗 UI
- [go-cli-search](./go-cli-search.md) — CLI 搜索命令（共用 SearchModels）
- [model-stats](./model-stats.md) — 数值范围筛选的统计源
- [go-tags](./go-tags.md) — `ListByTag` 后端
