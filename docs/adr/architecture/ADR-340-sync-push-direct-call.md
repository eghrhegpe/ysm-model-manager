# ADR-340：推送链去总线化：请求-响应回归直调，token/回执/宽限期协议件退役

- **状态**：✅ 已采纳（用户拍板 2026-10-14）
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：公共契约变更（BusEvents 两事件退役）+ 难逆转（三消费层测试与知识卡连环重写）+ 跨域影响面（sidebar 同步流程/features 调度/bus 契约）
- **相关**：`docs/knowledge/sync-manager.md`、`docs/knowledge/app-sidebar.md`、`docs/knowledge/global-handlers.md`、`frontend/src/views/app-sidebar/sync-flow.ts`、`frontend/src/features/sync/sync.ts`、锐评 2026-10-14 §二（总线当 RPC 为推送链唯一协议级病根，P1-1/P1-2/P1-3/P2-1 皆为其下游）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还治」以当前源码树 + 知识卡为准。 -->

`app-sidebar` 的整包推送链（`runPush`）与安装 handler（`features/sync`）之间是一次**请求-响应**：发一批缺失安装请求，等这批装完的计数回执。现状却把它塞进**广播总线**（`sync:download:missing` → `sync:download:done`），于是总线不保证的每一件（时序、不错过、回执匹配）都长出了一层补丁：

| 协议补丁 | 治什么 |
|---------|--------|
| `nextPushToken` 单调序号 | 回执错配（原 `Date.now()` 同毫秒撞车） |
| `done.skipped` 回执 | busy 命中时调用方干等超时 |
| `waitBusQuiet` + `BUS_QUIET_GRACE_MS`(2s) | done 先于订阅发出的竞态错过——用「等 2 秒猜通道空闲」的启发式弥补协议不保证送达 |
| `SYNC_TIMEOUT_MS`(120s) | handler 永不回执时按钮解卡 |

机检 `docs/event-graph.md` 钉死该通道**生产者 1、消费者 1**（sidebar → sync.ts，`done` 的两个订阅点也全在 `sync-flow.ts` 自己家里）——没有任何第三方依赖广播语义，事件通道是纯历史包袱（旧 JS 时代 handler 注册分散、无法直调的产物；`registerSync` 已集中、`features/sync` 可导出函数、`app-content` 本就直调 `registerSync`，直调通路已成立）。

反证在同文件：拉取链 `runPull` 直调 `PullResourceFromInstance`，`Promise.allSettled` 收结果，零协议开销且计数精确——同场景直调路径的可观测性完胜。

已支付的利息（锐评 P1 系列）：文件级失败消失在成功 toast（P1-1，已由 91e18f5ed 止血到 done 载荷）；一类型超时后 handler 仍持锁，后续类型被 busy 连锁假跳过、归因文案误导（P1-2）；批量模式丢失 per-pack 结果粒度（P1-3）。

## 2. 决策（Decision）

**推送链改直调，`sync:download:missing` / `sync:download:done` 两事件从 BusEvents 契约整条退役。**

1. **`features/sync/sync.ts` 导出 `downloadMissing(payload): Promise<DownloadOutcome>`**——现 `runDownloadMissing` + `withLock(downloadLock)` 的合体，返回值即结果：`{ ok, fail, skipped?, skipReason? }`。busy 命中返回 `skipped:"busy"`（防御路径——直调串行下自撞锁不再可能，仅剩跨页并发触发）。单包模式（无 `instanceNames`）的自弹 toast 语义保留（右键菜单等未来直调方零改动）；批量模式静默交调用方汇总（91e18f5ed 已立的口径不变）。
2. **`sync-flow.ts runPush` 按类型循环 `await downloadMissing(...)`**，累加 `ok/fail`，汇总一条 toast。删除四件套：`nextPushToken` / token 订阅匹配 / `waitBusQuiet` / `BUS_QUIET_GRACE_MS`（`kindError`/`pushErrorKind` 随删）。
3. **超时语义重定义**：保留单批 `withTimeout` 兜底（防 binding 永久挂起卡死按钮），但**超时即终止类型循环并如实报告**，不再续发后续批——根治 P1-2 级联（原实现超时后 handler 仍持锁，下一批必被 busy 吞，「1 超时 + N 跳过」是协议级假象；直调下超时是真挂起，续发只会堆积）。晚到的 Promise 结果被丢弃不双计。
4. **`tree:reload` / `stats:refresh` 维持广播**——它们是真正的「数据已变更，请重读」多消费者信号（存活边界见 `app-sidebar.md` 不变量「存活守卫适用边界」②），不在退役范围。
5. **`sync:toggle:status` 不动**——该事件确有多生产者（app-tree 批量/单文件），广播语义名实相符。

理由：请求-响应的正确原语是 Promise（可 `await`、可超时、错误即 reject、结果带类型），不是总线 + 相关 ID 匹配。事件通道对 1:1 通信的每一层防御（token/skipped/宽限/竞态猜测）都是在重发明 Promise 已经免费提供的东西。

## 3. 后果（Consequences）

**正面**：
- 推送/拉取两链同构（都直调），可观测性对齐；`DownloadOutcome` 类型成为单一结果契约，per-pack 粒度（P1-3）后续可在类型上直接扩展，无需再动总线契约。
- 删除约 4 个并发补丁函数与 2 个事件；`app-sidebar` 不再订阅 `sync:download:done`（少一条 `bus.on` 生命周期面）。
- 测试从「bus 往返夹具」（waitFor 循环补 done、错 token 负例）简化为「mock seam + 断言返回值」，原竞态类回归锁（token 撞车、静默干等）随实现退役——它们守护的是补丁本身，补丁没了，守护不再必要。

**负面 / 风险**：
- 事件面收窄：`docs/event-graph.md` 与 `UI-Design.md` §15 事件表须同步（前者为生成物自动同步，后者手改）。
- 跨模块直调使「将来第三方监听推送完成」不再有免费通道——若真出现，届时应加显式回调参数或结果订阅原语，而非复活总线回执；这是本决策有意收紧的方向（YAGNI）。
- `sync.test.ts` 大改（emit → 直调），回归网在重写期间有短暂裸露，以「先改测试钉旧行为、再迁实现」顺序压缩窗口。

**已知遗留（不在本刀范围）**：`_syncInProgress`/`_singleBusy`/`_dropBusy` 等多套 busy 语义归一（锐评 P2-2）已由 [ADR-341](./ADR-341-busy-lock-unification.md) 落地（`_singleBusy` 属 per-key 豁免族）；per-pack 计数粒度（P1-3）待 `DownloadOutcome` 扩展。

## 4. 数据溯源

来源：锐评 2026-10-14 §二/§四（总线当 RPC 病根，四层补丁清单）→ 机检 `docs/event-graph.md`（生产者 1 消费者 1）→ `registerSync` 集中注册 + `app-content` 直调先例 + `sync-deps.ts` seam 在位 → 结果：ADR-340 立项，直调 + 事件退役方案待拍板。

<!-- 文件名: sync-push-direct-call.md → 实际文件 architecture/ADR-340-sync-push-direct-call.md（ADR-320 architecture 全量模板） -->
