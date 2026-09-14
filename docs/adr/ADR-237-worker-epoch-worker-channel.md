# ADR-237：下载队列并发模型：启停 worker + epoch 代际 → 常驻 worker + channel

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/install/queue.go`（被决策对象）、`internal/app/install/queue_test.go`（行为护栏）、`go/conc/pool.go`（同款「状态由结构表达」范式）

---

## 1. 背景（Context）

`internal/app/install/queue.go` 的 `DownloadQueue`（串行下载队列）采用「**改共享状态 + 启停 worker goroutine**」模型：`Enqueue` 在锁内判断 `running` 并 `go q.processForEpoch(...)` 启动消费循环，`Cancel` 重置状态并递增代际。

该模型下，**同一个根因**（worker 生命周期由共享状态推导，而非由同步原语表达）以五种形态暴露，每种都用一处补丁补偿：

| 补丁 | 补偿的竞态 |
|------|-----------|
| `epoch` 代际号 | 启停窗口：被取消取代的旧 worker 与新 worker 并发消费同一队列 |
| `restart` 分支 | **丢失唤醒**：消费循环判空解锁 return 与 defer 复位 `running` 之间，`Enqueue` 已追加任务却因 `running==true` 不启新 worker → 队列静默停滞 |
| `spawnEpoch` 捕获 | `go` 启动与 worker 首次取锁之间被 `Cancel`+`Enqueue` 取代 |
| `panicked` 标志 | panic → 重启 → 又 panic 的无限重启循环 |
| `shuttingDown` 判断 | 应用退出后重启出的 worker 在已取消 ctx 上空转 |

每一处的注释都记录了「P1 竞态修复」，即缺陷不是某一行写错，而是**并发模型选型**导致复杂度持续增生：状态机（`running`/`cancelled`/`epoch`/`tasks`）被多个 goroutine 并发读写，正确性依赖人类持续维护不变量。

`go/AGENTS.md` 已明文警示「`sync.Once` 只执行一次……重置场景不能用，改 `sync.Mutex` + 手动状态」——本队列正是「手动状态」写法的复杂度上限样本。

## 2. 决策（Decision）

**将 `DownloadQueue` 的并发模型改为「常驻 worker goroutine + channel」**：

- worker 由 `NewDownloadQueue` 启动**一次**，阻塞在 channel（或 `sync.Cond`）上等待任务；`Enqueue` 写入任务、`Cancel` 发送取消信号——**均不启停 goroutine**。
- `epoch` 代际号**整体删除**：不存在「旧 worker vs 新 worker」，竞态在结构上不可表达。
- `restart`/丢失唤醒分支**删除**：worker 阻塞等待即天然无丢失唤醒。
- `spawnEpoch` 捕获**删除**：不 spawn 即无「spawn 与取锁之间」窗口。
- `panicked` 保留（回调 panic 仍需 recover 兜底，这是**必要的**防御，与生命周期解耦）。
- `shuttingDown` 退化为消费循环 `select` 的一个分支（`<-parentCtx.Done()` 即退出）。

**理由**：

1. **复杂度归零而非转移**——五类补丁同一根因，换模型后不是「更难触发」而是「不可表达」。
2. **符合仓内既有范式**——`go/conc` 的 worker 池同样以结构（而非状态标志）保证正确性；本队列是 `internal/app` 内最后一处「手写状态机 + 启停 goroutine」。
3. **测试护栏天然存在**——8 个测试中 6 个断言**外部行为**（顺序、错误不中断、取消、parent cancel、panic recover、状态反映），重构后应原样通过；剩余 2 个锁定 `epoch` 内部机制的测试改为断言等价行为（「取消后重新入队不重复发 done」这一**行为契约**必须保留）。

**明确不做**：不改 `DownloadQueue` 的导出方法集与事件契约（`queue:status` / `queue:file-start` / `queue:file-done` 的载荷与时机不变）——前端零改动。

## 3. 后果（Consequences）

**正面**
- 五类竞态补丁及其维护负担一并消除；`queue.go` 消费循环变为可直读的 `for { select { ... } }`。
- 新增功能（如并发下载、优先级）不再需要与 epoch 机制协商。
- 「取消后立即重新入队」的正确性由结构保证，不再依赖代际号比对。

**负面 / 代价**
- 队列生命周期新增一个常驻 goroutine（可用 `parentCtx` 取消退出，无泄漏风险）——相比当前「按需启停」多一份常态资源占用，量级可忽略。
- 需改写 2 个锁定内部机制的测试；重构属关键路径改动，须逐项验证 6 个行为测试不变绿不合并。

**已知遗留**
- `process()`（`target=0` 手动/测试驱动路径）在无 epoch 后语义简化，需确认其测试用途是否仍有必要保留。

## 4. 数据溯源

| 来源 | 结论 |
|------|------|
| `internal/app/install/queue.go` 全文审读 | 同根因五形态补丁链，逐处注释均标「P1 竞态修复」 |
| `internal/app/install/queue_test.go` 8 个测试清点 | 6 个断言外部行为（重构护栏）、2 个锁定 epoch 内部机制（需改写） |
| `go/conc/pool.go` 范式对照 | 结构表达正确性是仓内既有做法 |
| `go/AGENTS.md` §Go 专属坑点 | 「`sync.Once` 重置场景不能用」——本队列是手动状态复杂度上限样本 |

<!-- 文件名: worker-epoch-worker-channel.md → 实际文件 ADR-237-worker-epoch-worker-channel.md -->
