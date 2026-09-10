---
kind: model-stats
name: Web Worker 模型统计层 model-stats
tier: architecture
adr:
  - ADR-218
  - ADR-219
category: core
source_files:
  - frontend/src/workers/stats-core.ts
  - frontend/src/workers/stats-protocol.ts
  - frontend/src/workers/stats.worker.ts
  - frontend/src/backend/web-stats.ts
auto_fields:
  symbols_with_lines:
    - __setStatsRunnerForTest
    - batchStatsWebModels
    - consumeWebSearchDegraded
    - EMPTY_ERROR
    - getStatsPoolSize
    - isCrossOriginIsolated
    - isValidStatsRequest
    - onStatsProgress
    - parseAnyGeometry
    - prefetchStatsWorker
    - STATS_BATCH_LIMIT
    - statsFromDecodedFiles
    - statsFromJsonBytes
    - StatsRelReader
    - StatsWorkerError
    - StatsWorkerPartial
    - StatsWorkerRequest
    - StatsWorkerResponse
    - StatsWorkerResult
    - terminateStatsWorker
    - WebModelStats
    - WebModelStatsWithPath
  tests:
    - frontend/src/workers/stats-core.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 模型统计、骨骼数/立方体数/纹理尺寸
  - SearchModels 数值筛选
  - Web Worker、批量统计
quick_risk_lines:
  - 模型统计必须走 Web Worker 批量统计层，主线程禁止同步跑统计，防 UI 卡顿
pitfalls:
  - 主线程同步跑统计 → 大库卡死 UI；必须经 Web Worker 后台统计
  - Worker 未独立加载 WASM → 与主线程 WASM 实例冲突；必须在 Worker 内独立 open 解码
  - 「5s `Promise.race` 软超时」对同步 ccall 挂死是半吊子（已知问题榜#4 原方案）——挂死点不可抢占，race 的 timer 在阻塞线程里根本不触发；挂死类故障唯一可靠侦测信号 = 逐模型 partial 流中断（ADR-219 静默看门狗）

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
status: active
---

# Web Worker 模型统计层 model-stats

## 概览

`frontend/src/workers/` + `frontend/src/backend/web-stats.ts` 是 ADR-071 审计增强 #7 新增的**Web Worker 批量模型统计层**，为网页版 `SearchModels` 数值条件（`minBones`/`maxBones`/`minCubes`/`maxCubes`/`minTex`/`maxTex`）提供统计来源。Worker 内独立加载 WASM 解码 + `open` IndexedDB（同源）逐个模型解析统计，主线程零解析负载——大库后台跑不卡 UI。

## 核心职责

- **`stats-core.ts`** — 纯计算核心（无 IO、无 WASM 运行时依赖；`YsmDecodedFile` 为 type-only import，形状单一事实源 = `wasm/parser-shared.ts`，ADR-218 D3），输入为解码/直读产物文件，输出统计数值
  - `statsFromDecodedFiles(files)` — 批量统计：骨数 = `bones` 数组长度；立方体数 = 各 `bone.cubes` 长度之和（**非递归**——Bedrock 骨骼不嵌套声明 cubes，嵌套关系由 `parent` 字段表达，与 Go 侧同口径）；纹理宽高 = `max(嗅探, geometry description 描述)`
  - `parseAnyGeometry(jsonStr)` — 宽松 geometry 解析：标准 `minecraft:geometry` 数组之外兼容 `minecraft.geometry[0]` / `geometry.model` / 直接 `{bones}` 根对象，失败返回 null（测试直接对其三条兼容形态做专项边界覆盖）
  - **纹理头魔数**：`PNG_SIG` / `JPG_SIG` / `GIF_SIG` / `BMP_SIG` / `TGA_SIG` — 单一事实源已收敛至 `frontend/src/utils/base/pure/tex-size.ts` 的 `sniffTexSize`（2026-09 去重专项：从 stats-core / wasm.ts 抽出的公共纯函数），与 Go `imagePixelArea` 同口径，勿单独改
  - 输出 `WebModelStats`（`boneCount` / `cubeCount` / `texWidth` / `texHeight` / `hasError`；单一形状源 = `stats-protocol.ts`，`EMPTY_ERROR` 错误标记自此文件单处导出，ADR-218 D3），口径对齐 Go `decodeYSMViaNodeJS`（`internal/app/wasm_decoder.go` decodeYSMViaNodeJS）与前端 `decodeYsmViaWasm`

- **`stats-protocol.ts`** — 协议层：`StatsWorkerRequest` / `StatsWorkerResponse`（`partial` 逐模型流式结果 + `result` 流结束标记 + `error`；ADR-219 D1 对 ADR-218 D2 的部分修订——重开 worker 级细粒度信道服务看门狗侦测，UI 进度顺带升级为模型级）/ `WebModelStats`（唯一统计形状源）/ `WebModelStatsWithPath`（主线程按 path 累积对齐）类型；`STATS_BATCH_LIMIT`（单批上限；内存口径 = 在途模型字节 + 解码产物，与批大小无关）；`isCrossOriginIsolated`（COI 判定单一事实源）；`isValidStatsRequest`（请求结构守卫，类型谓词：requestId 数字 + paths string[]，worker 入口拒收畸形消息防看门狗对账漂移）

- **`stats.worker.ts`** — Worker 入口：独立 `import` WASM + `open` IndexedDB（同源），消息驱动批量处理；**泵式有界并发**（`STATS_CONCURRENCY`=4 泵领号：模型 N+1 的 `idbGet` I/O 与模型 N 的同步 WASM 解码重叠；同步关键区无 await 单线程天然串行，共享 `/output` 目录不交叉污染；禁用裸 `Promise.all(全批)` 防原始字节全驻留）；**逐模型流式回包**（每模型统计完成立即 `partial`，全批走完发 `result` 结束标记，ADR-219 D1 活性信号不变）；COI 满足时优先 pthread 多线程 WASM（ADR-079 M4），mt init 失败回退一次单线程 init 再判 error（P2 审核修复：防 COI 满足但 pthread 环境瞬态异常的设备永久失去数值统计）

- **`web-stats.ts`** — 主线程编排：
  - `batchStatsWebModels(paths)` — **池并发 = 批级单飞**（ADR-218 D1：`batchChain` 串行链，第二起调用排队等前批整体完成；`terminateStatsWorker` 升池代际，排队批弃置）；批内 chunk 分发到池内 worker **并行**统计（`Promise.all(ws.map(runWorkerQueue))`，每 worker 单在途——见不变量）；合并层按 path 对齐（Map 查表，回包序不承担契约，ADR-218 D2）
  - **细粒度降级契约（ADR-219 D2/D3）**：`statsOneChunk` 双计时器——静默窗 `STATS_SILENCE_MS`（30s，每条 `partial` 重置）判单 worker 挂死（同步 ccall 挂起不可抢占，唯一可靠侦测信号 = 逐模型流中断）→ `terminateWorker` **只杀该 worker**（不杀整池），专属 replacement 上重试**剩余未回包**模型（已回包不重放）；静默杀预算 `CHUNK_SILENCE_KILLS`（2，双保险）或 chunk 墙钟 `STATS_CHUNK_TIMEOUT_MS`（60s，跨重试共享）耗尽 → 剩余模型全标 `EMPTY_ERROR`（`hasError: true`），chunk 正常收尾、**整批不降级**
  - **批级降级契约（仅系统级故障，ADR-219 D3 边界）**：Worker 不支持（`new Worker` 抛错）/ WASM 瞬态错误重试耗尽 / 主动取消（`terminateStatsWorker`）→ 返回 `null` 并置降级标记（`consumeWebSearchDegraded` 消费，供 toolbar-search 提示）；`web-fs.searchWebModels` 收到 `null` 走「数值 0 + `hasError: false`」降级路径。挂死类局部故障不经由此处（走上面的模型级 `hasError` 细粒度路径）
  - **测试注入**：`__setStatsRunnerForTest` 替换 Worker 路径（`browser-adapter.test.ts` / `web-stats.test.ts` 用）

## 已知边界

- **仅支持同源 IndexedDB**：Worker 内 `open('ysm')` 同源读取，跨源场景不可用
- **主线程不直接调 WASM**：统计走 Worker，避免大库解析卡 UI
- **口径对称**：`sniffTexSize`（`frontend/src/utils/base/pure/tex-size.ts` 单一事实源）与 Go `imagePixelArea` 必须同口径；`boneCount`/`cubeCount` 口径对齐 Go 侧
- **全池系统性挂死**（内存压力等致所有 worker 无响应）→ 所有模型 `EMPTY_ERROR` → 数值搜索返回空集且**无** toast（语义：统计全部失败而非条件被忽略，UI 可另立提示位，ADR-219 后果③）
- **挂死模型在 UI 上仅表现为「被数值搜索排除」**，无独立诊断面板（ADR-219 后果①，error-diary 可后续接 `safeErrorMessage` 落账）

## 不变量

- **单 worker 静默看门狗 + 模型级细粒度降级（ADR-219 D2/D3）**：静默 30s（无 `partial`）→ 只 `terminateWorker` 挂死者（不杀整池），专属 replacement 重试剩余未回包模型；静默杀预算（2）或 chunk 60s 墙钟耗尽 → 剩余模型全 `hasError`（`EMPTY_ERROR`），整批正常返回不降级。系统级故障（Worker 不可用 / 瞬态 error 重试耗尽 / 主动取消）仍整批降级 `null` + toast——**故障边界拆分：局部挂死 → 模型级；系统级 → 批级**
- 批级降级时 `hasError: false`（统计失败不影响搜索结果可用性，仅数值为 0）；模型级细粒度耗尽时该模型 `hasError: true`（数值搜索排除该模型，与 Go 统计失败口径一致）
- **池内 chunk 并行 + 批间机器强制串行（ADR-218 D1）**：单批内 chunk 经 `Promise.all(ws.map(runWorkerQueue))` 分发到池内 worker 并行处理（每 worker 单在途，见下条）；跨批并发由实现机器强制——`batchStatsWebModels` 经 `batchChain` 串行链单飞（同一时刻池上至多一个 batch，后批排队），`terminateStatsWorker` 升池代际（`poolGen`），排队（未启动）批弃置（降级 null，防"取消后又偷偷重跑"）。历史上的调用方纪律版（并发双批互踩 `onmessage` 单槽位 → 60s 超时杀整池互毁）已失效——不再依赖调用方保证
- **单 worker 单在途 + 重试专属 replacement**（2026-09-05 code_review 修复 8cfbf2e7）：
  - `statsOneChunk` 以 `w.onmessage` 单槽位按 `requestId` 过滤回包——每 worker 同时只允许一个在途请求（`runWorkerQueue` 池内并发各持一 worker；跨批安全由 ADR-218 D1 单飞链机器保证）
  - 瞬态 error（WASM init 失败 / trap 逃逸）与静默看门狗判挂死（ADR-219 D2）都只 `terminateWorker` 出错/挂死者；重试**必须新建专属 worker**（`spawnReplacementWorker` 补入池），**禁止复用池内既有 worker**——多 worker 池里其余 worker 正被并发队列持在途，复用会覆盖其 onmessage 槽位 → 对方回包被 requestId 丢弃 → 对方 chunk 坐等静默窗/墙钟到点细粒度耗尽（重试特性反而伤自己人）
  - 瞬态 error 重试预算按「每次 1 次」计（chunk 内独立，`errorRetries`）；挂死类静默杀预算按「每 chunk 至多 `CHUNK_SILENCE_KILLS`（2）次」计（`silenceKills`，第 2 次即撞 60s 墙钟，预算是双保险）；无 replacement 可用（池上限/构造失败）时：瞬态 → 整批降级（保留既有），挂死类 → 细粒度耗尽（ADR-219 D3）
  - 测试须覆盖 hc≥2 多 worker 并发（hc=1 下 terminate 清池 → 懒建新 worker，永远碰不到「抢他队 worker」冲突，是既有用例的盲区）

## 消费方

- **`toolbar-search.ts`**（`openAdvFilterDialog`）— 消费 `consumeWebSearchDegraded` 降级标记（仅系统级故障时置位，挂死类局部故障无 toast），Worker 不可用时 toast 提示"数值条件已忽略"；消费 `onStatsProgress` 显示多线程统计角标 `🧵×N ⚙️ x/y`（ADR-219 起逐模型推进，粒度从 chunk 级升级为模型级）
- **`web-fs.ts`**（`searchWebModels`）— 消费 `batchStatsWebModels` 返回值，null 时走「数值 0 + hasError: false」降级路径；非 null 时 `hasError` 条目（含挂死细粒度耗尽的 `EMPTY_ERROR`）经数值条件直接排除

## 相关

- [toolbar-search.md](./toolbar-search.md) — 搜索编排层，消费降级标记与进度回调
- [backend-idb](./backend-idb.md) — `searchWebModels` 数值条件统计来源（本层被其消费）
- [ysm-wasm](./ysm-wasm.md) — Worker 内 WASM 加载（`ysm-worker-loader.ts` 独立于主线程单例）
- ADR-071（网页版审计增强 #7 移动/复制 + #8 日志持久化 + 统计数值条件）
- ADR-218（stats worker 池并发契约与协议收敛：批级单飞 / progress 移除 / 类型去重；§D2 被 ADR-219 部分修订）
- ADR-219（stats worker 细粒度降级：per-model 流式回包 + 单 worker 静默看门狗 + 挂死模型 hasError）