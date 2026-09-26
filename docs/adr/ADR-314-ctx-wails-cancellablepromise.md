# ADR-314：诊断页长任务取消通道：ctx 贯穿 + Wails 原生 CancellablePromise

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-26
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-119（确定性契约——取消不得破坏逐字节确定性输出）、ADR-230（createLoadGuard 代际守卫——前端丢弃陈旧响应的既有出口）、诊断页对接锐评（2026-09-26，第⑥笔记账的立项）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

诊断页是全应用最容易触发长任务的地方：

- **仓库体检**（`RepoHealthAudit` → `repoaudit.HealthReportFor`）：`filepath.Walk` 全仓库目录 + 逐文件 SHA256，大仓库分钟级；
- **去重扫描**（`FindDuplicateFiles` → `dedup.FindDuplicateFiles`）：逐目录全量哈希（deep_hash 档为 SHA256 全量读盘）。

现状是**发起后不可撤销**：UI 只有按钮禁用 + 占位文案，用户既不能取消，也看不到剩余量；切走页面扫描照跑，结果写回缓存面板（面板分离后写入不可见）。唯一止血手段是杀进程。

Go 侧两条核心链路（repoaudit 遍历、dedup 并行哈希管道）的函数签名均无 `context.Context`，无从接收取消信号。

**已验证的平台能力**（决策依据，实测于 wails v3.0.0-alpha2.105）：

- 前端绑定返回 `CancellablePromise`（`@wailsio/runtime`）：`promise.cancel()` 经 `CancelCall` 运行时消息（携带 call-id）直达 Go；
- Go 侧 `messageprocessor_call.go` 为每次绑定调用建 `context.WithCancel(...)` 并登记进 `runningCalls`——**绑定方法签名首参声明 `ctx context.Context` 即可收到该 ctx**，客户端取消时 ctx 被取消；
- 取消后 promise 以 `CancelError` reject（`name === "CancelError"`），前端可据此与真实错误分流。

即：**平台已内建取消通道，此前未接**。缺的只是（a）ctx 贯穿到耗时循环、（b）循环内检查点、（c）前端取消按钮与 CancelError 分流。

## 2. 决策（Decision）

**走 Wails 原生 CancellablePromise 通道，不自造 Start/Cancel 绑定对。**

1. **核心签名贯穿 ctx**（Go）：
   - `repoaudit.HealthReportFor(dir)` → `HealthReportForCtx(ctx, dir)`；`Audit` 内 `filepath.Walk` 回调与哈希循环每 N 个文件检查 `ctx.Err()`，命中即提前返回；
   - `dedup.FindDuplicateFiles(dir, ...)` 同构：`collectFiles` / `hashFilesParallel` 循环内设检查点；
   - 原**无 ctx 签名保留为薄壳**（`ctx=context.Background()`），CLI 调用点（repo-audit / health-report / dedup）零改动。
2. **绑定层注入 ctx**（internal/app）：`RepoHealthAudit(ctx context.Context, dir string)`、`FindDuplicateFiles(ctx context.Context, dir, strategy string)`——Wails 自动注入可取消 ctx，绑定生成物自动携带 `CancellablePromise` 语义（签名首参 ctx 不进前端参数表）。
3. **前端最小 UI**：扫描占位行内加「取消」按钮，点击调 `promise.cancel()`（需把当前 promise 存进面板状态）；catch 分流 `err.name === "CancelError"` → 静默复位占位文案，不弹错误 toast。
4. **确定性不受影响**（ADR-119 契约）：取消只发生在**响应送达前**——被取消的调用整单作废，前端不消费其部分结果；完整跑完的调用输出仍与串行逐字节一致。

**否决的替代方案**：

- *自造 Start/Cancel 绑定对（任务 ID 表）*：多一组绑定、一处全局可变状态、一套 ID 生命周期管理——平台已内建等价物，纯属重复造轮子；
- *只做前端「假取消」（丢弃响应不中断后端）*：CPU/磁盘照跑，用户看到的「已取消」是谎言——与诊断页「展示层不诚实」的整肃方向相悖；
- *进度百分比上报*：Walk/哈希总量未知，进度条会撒谎；本期不做（事件流上报属另一档工程量，收益存疑）。

## 3. 后果（Consequences）

**正面**：

- 用户获得真实的「停止」能力；大仓库误触扫描不再以分钟为单位绑架应用；
- 平台原生通道 = 最少自造面积（无新增绑定方法、无全局任务表）；
- ctx 贯穿后，后续任何超时/竞shutdown需求（如退出时优雅中止扫描）复用同一通道。

**负面 / 已知遗留**：

- `repoaudit.Audit` 与 `dedup` 核心签名变更触及 CLI 与全部调用点（薄壳兜底后调用点零改动，但函数族多一层转发）；
- ctx 检查点密度是权衡：逐文件检查读 ctx 有开销，每 N 个文件检查则可能多跑 N 个文件才停——取 N=64 量级即可，不追求即时性；
- `RepoHealthAuditAll` 已于 2026-09-26 删除（孤儿绑定），本 ADR 落地时无需覆盖它；
- web 模式无 Go 桥，`web-gate` 本就拦截这两类扫描，无取消需求。

## 4. 数据溯源

- 锐评第⑥笔「长任务无取消通道」→ 本文立项；
- `@wailsio/runtime/dist/calls.js` + `cancellable.js` + wails `pkg/application/messageprocessor_call.go` 实读 → 「平台已内建取消」结论（含 `runningCalls`/`CancelCall`/`CancelError` 三处实证）；
- 耗时实测依据：诊断页体检占位文案与 `single-bench` 面板的大仓库耗时记录。
