---
kind: model-stats
name: Web Worker 模型统计层 model-stats
tier: architecture
category: core
source_files:
  - frontend/src/workers/stats-core.ts
  - frontend/src/workers/stats-protocol.ts
  - frontend/src/workers/stats.worker.ts
  - frontend/src/backend/web-stats.ts
tests:
  - frontend/src/workers/stats-core.test.ts
use_when:
  - 模型统计
  - 骨骼数
  - 立方体数
  - 纹理尺寸
  - SearchModels
  - 数值筛选
  - Web Worker
  - 批量统计
perf:
  - cpu-bound
  - concurrent
invariant_anchors:
  - frontend/src/workers/stats-core.ts|statsFromDecodedFiles
  - frontend/src/backend/web-stats.ts|batchStatsWebModels
---

# Web Worker 模型统计层 model-stats

## 概览

`frontend/src/workers/` + `frontend/src/backend/web-stats.ts` 是 ADR-071 审计增强 #7 新增的**Web Worker 批量模型统计层**，为网页版 `SearchModels` 数值条件（`minBones`/`maxBones`/`minCubes`/`maxCubes`/`minTex`/`maxTex`）提供统计来源。Worker 内独立加载 WASM 解码 + `open` IndexedDB（同源）逐个模型解析统计，主线程零解析负载——大库后台跑不卡 UI。

## 核心职责

- **`stats-core.ts`** — 纯计算核心（无 IO、无 WASM 依赖），输入为解码/直读产物文件，输出统计数值
  - `statsFromDecodedFiles(files)` — 批量统计：骨数 = `bones` 数组长度；立方体数 = 各 `bone.cubes` 长度之和（递归收集）；纹理宽高 = `max(嗅探, geometry description 描述)`
  - **纹理头魔数**：`PNG_SIG` / `JPG_SIG` / `GIF_SIG` / `BMP_SIG` / `TGA_SIG` — 单一事实源已收敛至 `frontend/src/utils/tex-size.ts` 的 `sniffTexSize`（2026-09 去重专项：从 stats-core / wasm.ts 抽出的公共纯函数），与 Go `imagePixelArea` 同口径，勿单独改
  - 输出 `ModelStatsResult`（`boneCount` / `cubeCount` / `texWidth` / `texHeight` / `hasError`），口径对齐 Go `decodeYSMViaNodeJS`（`internal/app/wasm_decoder.go` decodeYSMViaNodeJS）与前端 `decodeYsmViaWasm`

- **`stats-protocol.ts`** — 协议层：`StatsWorkerRequest` / `StatsWorkerResponse` / `WebModelStats` / `WebModelStatsWithPath` 类型；`STATS_BATCH_LIMIT`（单批上限）

- **`stats.worker.ts`** — Worker 入口：独立 `import` WASM + `open` IndexedDB（同源），消息驱动批量处理

- **`web-stats.ts`** — 主线程编排：
  - `batchStatsWebModels(paths)` — 串行发送请求（同一时刻至多一个），批间 `STATS_CHUNK_TIMEOUT_MS`（60s）超时终止防僵尸
  - **降级契约**：Worker 不支持（`new Worker` 抛错）/ 启动失败 / 运行时错误 / 单批超时 → 返回 `null` 并置降级标记（`consumeWebSearchDegraded` 消费，供 toolbar-search 提示）；`web-fs.searchWebModels` 收到 `null` 走「数值 0 + `hasError: false`」降级路径
  - **测试注入**：`setStatsRunnerForTest` 替换 Worker 路径（`browser-adapter.test.ts` 用）

## 已知边界

- **仅支持同源 IndexedDB**：Worker 内 `open('ysm')` 同源读取，跨源场景不可用
- **主线程不直接调 WASM**：统计走 Worker，避免大库解析卡 UI
- **口径对称**：`sniffTexSize`（`utils/tex-size.ts` 单一事实源）与 Go `imagePixelArea` 必须同口径；`boneCount`/`cubeCount` 口径对齐 Go 侧

## 不变量

- 单批超时 60s 终止 Worker 防僵尸
- 降级时 `hasError: false`（统计失败不影响搜索结果可用性，仅数值为 0）
- 批量统计串行（`requestSeq` 保证顺序），批间不可并行

## 消费方

- **`toolbar-search.ts`**（`openAdvFilterDialog`）— 消费 `consumeWebSearchDegraded` 降级标记，Worker 不可用时 toast 提示"数值条件已忽略"；消费 `onStatsProgress` 显示多线程统计角标 `🧵×N ⚙️ x/y`
- **`web-fs.ts`**（`searchWebModels`）— 消费 `batchStatsWebModels` 返回值，null 时走「数值 0 + hasError: false」降级路径

## 相关

- [toolbar-search.md](./toolbar-search.md) — 搜索编排层，消费降级标记与进度回调
- [backend-idb](./backend-idb.md) — `searchWebModels` 数值条件统计来源（本层被其消费）
- [ysm-wasm](./ysm-wasm.md) — Worker 内 WASM 加载（`ysm-worker-loader.ts` 独立于主线程单例）
- ADR-071（网页版审计增强 #7 移动/复制 + #8 日志持久化 + 统计数值条件）