# ADR-219：stats worker 细粒度降级：per-model 流式回包 + 单 worker 静默看门狗

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/backend/web-stats.ts · frontend/src/workers/stats-protocol.ts · frontend/src/workers/stats.worker.ts · docs/adr/ADR-218-stats-pool-concurrency.md · docs/knowledge/model-stats.md · docs/knowledge/frontend_design_critique.md`

---

## 1. 背景（Context）

stats Worker 池（`web-stats.ts`）的故障模型是「批粒度」的：一个 chunk（≤200 模型）内**任何一个**模型把 WASM ccall 挂死（worker 单线程 JS 不可抢占，挂死 = 该 worker 永久失响），主线程唯一的侦测手段是 60s 整批 chunk 超时，而超时处置是 `terminateStatsWorker` **杀整池** → 其余健康 worker 的在途结果全部作废 → 整批返回 null → `web-fs` 丢弃全部数值条件 → 用户挂 60s 拿到空结果 + 「数值条件已忽略」toast。故障粒度是一个模型，惩罚粒度是一整次搜索。

已知问题榜（`frontend_design_critique.md` 共识 #4）曾建议「`stats.worker.ts` 层加 `Promise.race` 5s 软超时」。该方案对**同步挂死**是半吊子：挂死点是同步 ccall，`Promise.race` 只能放弃结果、不能中断执行——worker 线程阻塞期间连 race 的 timer 都不会触发，同批后续模型仍排队在挂死 ccall 之后，最终仍走 60s 杀池。挂死类故障唯一可靠的侦测信号是「worker 停止逐模型产出消息」，而这要求 worker 级消息信道存在——恰是 ADR-218 D2 删除的细粒度消息（当时定位为无消费方的死协议）。

## 2. 决策（Decision）

**部分修订 ADR-218 D2**：重开最小 worker 级信道，并把 60s 超时从「杀整池」改判为「单 worker 看门狗 + 模型级细粒度降级」。

- **D1 协议：`partial` 逐模型流式回包**（对 ADR-218 D2 的 D2 部分修订）：`StatsWorkerResponse` 增 `StatsWorkerPartial`（每模型统计完成后立即回包一条）；`result` 消息瘦身为**流结束标记**（不再携带 `results` 全量数组，逐模型结果经 `partial` 流送达）。信道服务正确性（看门狗侦测 + 主线程逐模型累积），UI 进度顺带从 chunk 级升级为模型级（`onStatsProgress` 逐模型推进，零额外协议成本）。
- **D2 主线程：单 worker 静默看门狗**：`statsOneChunk` 的双计时器——静默窗（30s 无 `partial`/结束标记 → 判该 worker 挂死，`terminateWorker` **只杀该 worker**）+ chunk 墙钟预算（沿用 60s 自 chunk 首起算，跨重试共享）。挂死 chunk 在专属 replacement worker 上以**剩余未回包模型**重试（已回包模型不重放，主线程按 `partial` 累积去重）；静默杀次数（2）或墙钟预算耗尽 → 剩余模型全部标记 `EMPTY_ERROR`（`hasError: true`），**该 chunk 正常收尾，整批不降级**。
- **D3 故障边界拆分**：系统级故障（WASM 初始化失败等瞬态 error 重试耗尽、Worker 构造失败、主动取消）保留既有「整批降级 + toast」语义；局部故障（单模型挂死）走新「模型级 `hasError` 细粒度降级」——与 Go 统计失败排除语义（`BoneCount==0` 等价 `hasError`，数值搜索直接排除该模型）天然一致。
- **D4 重试预算**：静态 error 重试维持「每次瞬态 error 一次」不变量（ADR-218 知识卡既有契约）；静默杀每 chunk 上限 2 次（第二次即撞 60s 墙钟，预算是双保险）；replacement 沿用 `poolSize` 并发槽位上限，不另加总量闸。
- **不动**：`batchChain` 批级单飞（ADR-218 D1）、`poolGen` 代际弃置、`inflight` 取消 settle、`web-fs` 降级路径（「数值 0 + hasError:false」占位与 `consumeWebSearchDegraded` toast）均保留。

## 3. 后果（Consequences）

- **正面**：单模型挂死从「60s 后整批搜索降级 + 条件全丢」变为「≤60s 内该模型 `hasError` 排除、其余模型真统计、批完整返回」；看门狗 30s 先于 60s 墙钟触发，正常场景挂死恢复更快；UI 进度平滑到模型级；「杀整池」路径退役（超时不再误杀健康 worker）。
- **负面**：协议消息量放大（200 模型/chunk × 每模型一条 `partial`，结构化克隆小对象，开销可忽略但非零）；worker 回包语义从「整批一次」变流式，主线程累积状态（per-chunk `accounted` Map）复杂度上升；挂死 chunk 重试时 replacement worker 需重新冷启动 WASM（~1.5MB 资产 + 编译），恢复成本高于纯主线程等待。
- **已知遗留**：① 挂死模型在 UI 上仅表现为「被数值搜索排除」，无独立诊断面板（error-diary 可后续接 `safeErrorMessage` 落账）；② 60s 墙钟跨重试共享意味着「挂死模型 + 大库」场景总耗时仍可达 60s（与今日持平，但结果不再全损）；③ 全池系统性挂死（内存压力致所有 worker 无响应）→ 所有模型 `EMPTY_ERROR` → 数值搜索返回空集且**无** toast（语义：统计全部失败而非条件被忽略，UI 可另立提示位）。

## 4. 数据溯源

- 故障推演：`ysm-worker-loader.ts` `decodeYsmInWorker`（ccall 同步直调、无 watchdog，`frontend_design_critique.md` 共识 #4 验证记录）× `web-stats.ts` `statsOneChunk`（60s 超时 → `terminateStatsWorker` 杀整池 → `inflight` 全量降级 settle）
- 半吊子方案实证：`Promise.race` 不可抢占同步 ccall——worker 单线程 JS 语义（timer 回调与挂死 ccall 同线程排队，线程阻塞期间 timer 不触发）
- 信道代价评估：`stats-protocol.ts` ADR-218 D2 删除的 `progress` 消息为「每 10 模型一条」（删除前形态）；本 ADR 恢复为逐模型 `partial`（携带结果而非空心跳），消息量 ~10× 但载荷即既有用数据
- 排除语义对齐：`web-fs.ts` `searchWebModels`（`s.hasError → return` 排除）× Go `internal/app/wasm_decoder.go` `decodeYSMViaNodeJS`（`BoneCount==0` 统计失败口径）

<!-- 文件名: stats-graceful-degradation.md → 实际文件 ADR-219-stats-graceful-degradation.md -->
