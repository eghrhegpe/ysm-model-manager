# ADR-273：下载队列落盘账本（借鉴 .dsh durable ledger）

- **状态**：✅ 已采纳（Implemented）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/install/queue.go`、`internal/app/install/queue_ledger.go`、`go/download/download.go`（续传插槽）

## 1. 背景（Context）

`DownloadQueue`（`internal/app/install/queue.go`，ADR-237 常驻 worker + channel 串行队列）的
`tasks []types.DownloadTask` 是**纯内存**态。批量下载（社区/workshop 安装几十条）期间进程退出或崩溃时，
`parentCtx.Done()` 直接丢队列：未开始的下载整批消失、在途的 `.part-*` 临时文件成为孤儿残留。

隔壁 `.dsh`（某 agent 运行时主目录）用「`task-board/ledger-v2.json` + `scheduler-v2.lastTickAt` + `.lock`」
组织其后台作业，账本落盘可跨重启续跑。灵感风暴下确认要借鉴这一思路——但要**按 ysm 的实际形态裁剪**，
不照搬全套。

## 2. 决策（Decision）

只借 `.dsh` durable ledger 的**落盘账本**一件，裁剪另两件：

| .dsh 范式 | 取舍 | 理由 |
|---|---|---|
| 落盘账本（pending 任务持久化 + 重启续排） | **借** | DownloadQueue 崩溃丢 pending，是真消费者 |
| scheduler + `lastTickAt` 心跳 | **不借** | 本队列 wake(channel) 驱动排空，无周期 tick 循环，加即死重量 |
| `.lock` + revision 乐观并发 | **不借** | 单进程 + `sync.Mutex` 已守，跨进程锁 YAGNI |

落地（`queue_ledger.go`）：账本 JSON `{schemaVersion, tasks[]}` 原子写（复用 `fsutil.WriteFileAtomic`），
存于 `configDir()/download-queue.json`。写点 = `Enqueue` / `consume` 每出队 / `Cancel`；启动播种 =
`UseLedger(path)`（由 `app.go` 注入路径，`configDir()` 空则禁用持久化、行为零漂移）。

**v1 语义边界**：账本只存「尚未开始」的 pending；任务一出队即移出 pending，故崩溃时**在途那一个不自动重下**——
字节级断点续传是 `go/download/download.go` 预留的「续传 ADR」职责（`.part` 稳定命名 + Range/206 校验，
`download.go:311` 明言"动它即语义变更"），本 ADR 刻意与之**解耦**。

播种复用 Enqueue 的 https 守卫：防陈旧账本被外部篡改后引入非 https（SSRF/本地读）任务。

## 3. 后果（Consequences）

- **正面**：批量下载崩溃/重启后未开始的自动续排；损坏/版本不符的账本安全降级为无账本、不阻断启动；前端零改动（仍只收 `queue:status`，归属红线不破）。
- **负面**：多一次 JSON 落盘 IO（每任务出队一次，量级小，`ledgerMu` 串行化 last-writer-wins 可接受）。
- **已知遗留**：在途任务的断点续传（`.part`/Range）未做，留给后续「续传 ADR」；孤儿 `.part-*` 启动清理未纳入本 ADR。

## 4. 数据溯源

- 消费者实证：`executor.ts` 前端导入是 fire-and-forget 无队列（非消费者）→ 落点锁 Go `DownloadQueue`。
- 队列现状：`queue.go` tasks 内存态、`parentCtx.Done()` 丢队列。
- 落点边界：`download.go:311/330/482` 续传插槽注释（刻意解耦，不触碰）。
- 原子写与 configDir：`app_config.go:95` / `fsutil/write.go:86`。
- 测试：`queue_ledger_test.go` 重启续排 / https 篡改过滤 / 损坏忽略 / Cancel 清空。

<!-- 文件名: download-queue-ledger.md → 实际文件 ADR-273-download-queue-ledger.md -->
