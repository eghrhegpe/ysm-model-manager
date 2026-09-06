# ADR-197：conc/scanner context 贯通——并发任务可取消

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-119（conc 确定性契约）、ADR-145（internal/app 与 go/cli 解耦）

---

## 1. 背景（Context）

全仓 `context.Context` 仅 `go/download` 一处使用（且由 ADR 前序工作接入 appCtx）。
`go/conc.Parallel` 注释明确「不提供 context 取消」（pool.go 旧注释自认）；
scanner 的 WalkDir 全程不可中断；internal/app 的并发分析/批量读取均无取消语义。
后果：GUI 退出（ServiceShutdown 已 cancel appCtx）或将来要做「取消扫描」按钮时，
在途并发任务只能等跑完——桌面应用不可取消是架构级缺陷。

## 2. 决策（Decision）

1. **conc 增 `ParallelCtx`**：`fn` 签名收 `context.Context`；ctx 取消后停止派发新任务，
   在途任务由 fn 自行尽早返回（ok=false 跳过）。旧 `Parallel` 委托
   `ParallelCtx(context.Background(), ...)` 保留，旧调用方零迁移成本。
   取消语义只保证「尽快停止派发」，不强制打断在途 IO——与 pool 的确定性契约（ADR-119）不冲突。
2. **绑定签名不动**：Wails 绑定方法（ReadFileBytesBatchWithMeta 等）签名变化会触发
   绑定重生成契约（回归红线），一律不改；internal/app 三处 conc.Parallel 调用点改为
   `ParallelCtx(a.appCtx ...)`（nil 守卫对齐 app_download.go:96 惯例），
   fn 内部检查 ctx 提前返回。
3. **scanner 增 ctx 变体**：`ScanEntriesCtx` / `ScanEntriesLiteCtx`，WalkDir 回调内
   ctx.Done 即 `fs.SkipAll`；旧签名委托 Background。CLI 与 watcher 后续按需接入。
4. 不做：给 go/ 各业务包全量签名加 ctx（大爆炸改造无当期收益，按调用链逐步渗透，
   新代码一律走 ctx 变体）。

## 3. 后果（Consequences）

- 正面：应用退出可中断在途批量任务；后续「取消扫描」UI 有现成管道。
- 负面：Parallel/ParallelCtx 双入口并存（文档标注 Parallel 为兼容壳）；
  在途单个任务仍不可打断（可接受——粒度是文件级）。
- 遗留：go/cli benchmark harness（ADR-196/后续拆分项）未接 ctx；
  scanner 的 rust scan 路径（tryRustScan）内部取消需 WASM 侧配合，暂以 walk 层 SkipAll 为界。

## 4. 数据溯源

- 锐评审计（2026-09-06）：conc.Parallel 无取消（go/conc/pool.go:26 旧注释）、
  context 全仓仅 download 一包、appCtx 已存在（internal/app/app.go:42-88）。
