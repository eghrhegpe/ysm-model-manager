# ADR-218：stats worker 池并发契约与协议收敛

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/backend/web-stats.ts · frontend/src/workers/stats-protocol.ts · docs/knowledge/model-stats.md`

---

## 1. 背景（Context）

stats Worker 池（`web-stats.ts`）按批共享：批内 chunk 经 `Promise.all(ws.map(runWorkerQueue))` 分发，`statsOneChunk` 每次调用**直接覆写** `w.onmessage`/`w.onerror` 单槽位。单批内每 worker 严格串行，槽位安全；但**两个 `batchStatsWebModels` 并发**（adv-filter 与 toolbar 连发、双击数值搜索）时，后发起的批覆写共享池 worker 的槽位 → 前一批回包被 requestId 过滤永久丢弃 → 60s 超时杀**整池** → 两批集体降级。该风险此前仅由知识卡 `model-stats.md` 的调用方纪律承载（"调用方必须保证同一时刻至多一个 batch 在跑"）——人肉不变量，无机器强制。

同目录还存在一批结构重复：`ModelStatsResult`（stats-core）与 `WebModelStats`（stats-protocol）五字段逐字相同；`StatsFileInput`（stats-core）与 `YsmDecodedFile`（wasm/parser-shared）形状相同；协议 `progress` 消息 worker 每 10 模型发一条、主线程 onmessage 明确忽略（注释自认"无消费方"）；结果携带的 `path` 字段注释承诺"按 path 对齐防顺序漂移"，合并层实际按下标对齐。

## 2. 决策（Decision）

- **D1 池并发 = 批级单飞（机器强制串行）**：`web-stats.ts` 增 `batchChain` 串行链——同一时刻池上至多一个 batch 在跑，后续批排队等待前批整体完成；`terminateStatsWorker` 升代（`poolGen++`），**排队未启动的批直接弃置**（降级 null + 标记），防"取消后又偷偷重跑"。
  - 否决备选：①维持调用方纪律（现状，无机器强制，本 ADR 即升级它）；②共享 dispatcher + 按 requestId 路由 + per-worker busy 标记（两批公平共享池、chunk 级进度平滑，改动面大——作为后续候选记入知识卡）；③supersede 最新胜出（新搜索取消旧在途批，需调用方弃旧结果，UI 语义变更，另立项）。
  - `__setStatsRunnerForTest` 注入路径不走串行链（测试 seam，保持现有语义）。
- **D2 协议收敛**：删 `StatsWorkerProgress` 消息与 worker 内进度节流（UI 进度本就走 chunk 级 `onStatsProgress`，worker 级细粒度进度留作未来扩展点，注释说明）；**保留 `path` 字段**并让合并层真按 path 对齐（Map 查表，顺序不再承担契约，为未来 worker 内并行解码留口）。
- **D3 结构去重**：`ModelStatsResult` → 并入 `WebModelStats`（stats-protocol 为单一形状源）；`StatsFileInput` → 并入 `YsmDecodedFile`（type-only import，不引入运行时依赖，workers→wasm 边已有值 import 先例）；`EMPTY_ERROR` 常量化收敛到 stats-core 单处导出。
- **范围外（记账不动）**：`hasError` 语义拆分（"零骨骼 ≠ 错误"，需 Go 侧对齐口径，独立 ADR）；coi-sw 隐私模式防循环持久化失效（`safeGet/safeSet` 静默降级时 `{t,n}` 标记不落地）；workers 目录归属（全仓 5 族 worker 散落 4 处，目录整编）。
- **不动**：`web-fs.ts` `WebSearchResult` 与 Go `types.SearchResult` 的跨语言形状（契约测试 `tests/*.ts` 守卫，类型合并无收益且有 binding 形状漂移风险）。

## 3. 后果（Consequences）

- **正面**：双批并发从"60s 互杀 + 集体降级"变为"后批排队、前批完成后接续"，槽位契约由实现保证而非调用方纪律；`path` 字段从死载荷变成真对齐契约；`progress` 死协议移除；同目录零结构重复。
- **负面**：头阻塞——两个数值搜索重叠时，第二个批等第一个**整批**跑完（常见场景秒级，最坏 60s×片数）；`terminateStatsWorker` 后排队批被弃置（语义：终止 = 停止一切统计工作，含排队）。
- **已知遗留**：D1 备选②③、D3 范围外三项见正文记账；`statsProgressCb` 单槽位在两批排队下天然按序消费，无 clobber（前批跑完才轮到后批注册语义不变）。

## 4. 数据溯源

- 根因定位：`web-stats.ts` `statsOneChunk`（onmessage 覆写）× 知识卡 `model-stats.md`「池内 chunk 并行 + 批间调用方串行」不变量（调用方纪律原文）
- 双批 60s 互杀路径推演：批 A/B 同池 → B 覆写槽位 → A 回包被 requestId 过滤 → `STATS_CHUNK_TIMEOUT_MS` 触发 `terminateStatsWorker` → `inflight` 全量 settle 降级
- 死协议实证：`stats-protocol.ts` `StatsWorkerProgress` 注释"当前无主线程消费方" + `web-stats.ts` onmessage 分支 `// progress：当前无 UI 消费，忽略`
- 结构重复实证：`ModelStatsResult`/`WebModelStats` 五字段逐字对比；`StatsFileInput` ≡ `YsmDecodedFile` `{path, data}`

<!-- 文件名: stats-pool-concurrency.md → 实际文件 ADR-218-stats-pool-concurrency.md -->
