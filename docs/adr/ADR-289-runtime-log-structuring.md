# ADR-289：运行时日志结构化：tag 提取与级别推断

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/logs/runtime.go`（RuntimeBuffer 捕获层）、`go/types/types.go`（RuntimeLog 类型）、`frontend/src/views/app-content/diagnostics/logs.ts`（展示层）、`internal/app/app.go`（log.SetOutput 接线）、[ADR-040](./ADR-040-diagnostics-page-split.md)（诊断页按职责切文件）、`docs/plans/diagnostics-log-capability.md`（能力面复盘，本 ADR 是其「方向 D」立项）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

诊断页「运行时日志」子 tab 捕获的是**整个进程的标准库 log 输出**（`internal/app/app.go` 的 `log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))`），写入 `go/logs/runtime.go|RuntimeBuffer`（容量 200，重启清零）。

**量化现状**（2026-09-20 实测 grep）：全仓 `log.Printf`/`Println` 调用点 **250+**，分布在 30+ 个包（`avatar` / `geometry` / `ysm` / `watcher` / `sync` / `installer` / `fsutil` / `dedupe` / `texture_cache` / `queue` …）。

**问题不在「调用点太多」，而在「捕获层丢信息 + 展示层不利用」**：

1. **捕获层丢信息**：`RuntimeBuffer.Write` 把每次 `Write` 落成 `{Message, Timestamp, Level: LevelInfo}`——`Level` **恒为 info**（源码注释：「标准库 log 无级别，统一标记为 info」）。于是 250+ 条日志无论内容性质，在 UI 上**长得一模一样**。
2. **展示层不利用既有结构**：`logs.ts|dgLsRenderRuntimeRows` 渲染时只做三件事——固定 `UI_ICONS.joystick` 图标 + Message 原文 + 时间戳。**Go 侧 Message 里本已存在的 `[tag]` 包名前缀**（`[watcher]` / `[sync]` / `[avatar]` / `[queue]` …）是唯一可用的分类线索，前端**完全没有解析**。
3. **用户可见后果**：运行时日志是**一坨无法分类、无法分级、无法筛选的纯文本流**。搜到「同步失败」要靠肉眼扫；出事时无法「只看 watcher」；`[watcher] 自动同步完成: 禁用 3 启用 2` 这种**用户真正关心的业务信息**与 `[geometry] 解析 cube UV 失败` 这种**库级 debug 噪音**视觉等价。

**已确立的边界**（不违反职责归属红线）：运行时日志的**输入端**（进程 → 缓冲）归 Go，**展示端**（缓冲 → 视图）归前端且享有展示层豁免——本 ADR 只在此边界内做结构化，**不下沉任何新的磁盘 RPC、不重算归属**。

**为什么不走「重构 250 个调用点」**：那需要逐个判定「这条该不该给用户看」，涉及 30+ 包的语义决策，成本极高且极易漏判；而**信息其实已经在了**（`[tag]` 前缀），只是没被读出来。

## 2. 决策（Decision）

**D1 tag 提取在捕获层完成，不要求调用点改写。** `RuntimeBuffer.Write` 解析 Message 开头的 `[tag]` 前缀（形如 `^\[([a-zA-Z0-9_-]+)\]\s*`），写入新字段 `Tag`；无前缀时 `Tag` 为空串（**不报错、不丢弃**）。提取是**纯增量**——250+ 个既有调用点一行不改，带前缀的立即受益。

**覆盖率实证（2026-09-20 实测）**：225 / 247 个调用点**已经带** `[tag]` 前缀（**91.1%**），唯一 tag **41 个**（`avatar` / `geometry` / `sync` / `watcher` / `ysm` / `queue` / `threejs` / `logs` / `migrate` / `fsutil` / `download` / `updater` …）。即**九成以上既有日志无需任何改动即可获得分类**。

**级别推断实测分布**（同一批 247 条真实日志跑 `inferRuntimeLevel`）：fatal 2.0% / error 60.3% / warn 11.7% / info 25.9%。**error 占比高不是误判**——Go 侧只在出问题时才 `log.Printf`，正常路径不写日志，故真实分布本就以错误诊断为主。抽检含「失败」字样者（`[installer] 安装文件 x 失败: %v (继续)`、`[fsutil] 清理陈旧备份失败 %s: %v（不影响本次替换）`）确为 error 语义（真失败了，只是被优雅降级），用户排查时正需要它们。

**D2 级别推断在捕获层完成，产出 `Level` 真值。** 沿用「标准库 log 无级别」的诚实前提，**不假装知道真实级别**，而是按内容做**保守推断**并标注来源：

- Message 含 `panic`/`致命`/`fatal` → `fatal`
- Message 含 `失败`/`错误`/`error`/`拒绝`/`无法` → `error`
- Message 含 `警告`/`⚠️`/`[WARN]`/`超限`/`跳过`/`截断` → `warn`
- 其余 → `info`

推断规则集中在 `go/logs` 单点（**唯一事实源**），前端不重判——与「状态语义单一事实源 = Go」同族。

**D3 展示层消费结构化字段，不再解析原文。** `RuntimeLog` 增 `Tag` 字段（`json:"tag"`，绑定导出）；前端：

- 图标按 `Level` 映射（复用 `UI_ICONS`，与操作日志 `dgLsMakeStatusLabel` 同口径）
- tag 作为**可搜索维度**并入 `dgLsFilterRuntimeLogs` 的命中域（与操作日志把 Operation 并入搜索域同构）
- 运行时子 tab **接入状态 chips 的级别筛选**（用推断出的 `Level`）——此前 chips 在运行时子 tab 下「仅更新选中态、不生效」，本 ADR 让它们**真正生效**

**D4 不引入新日志基础设施。** 明确**不**引入 `slog` / 结构化 logger / 日志分级宏改造：那会要求 250+ 调用点逐个迁移，且与本仓「增量约束、存量不动」的注释纪律冲突。本 ADR 是**读出现有信息**，不是**要求写入新信息**。

**未采用：**

- **给 250+ 调用点逐个加级别参数**：成本极高、语义判定主观、漏判风险大；且 Tag 已提供足够分类。
- **Go 侧过滤后再传给前端**（只传 warn+ 级别）：剥夺用户在诊断页排查细节的能力，且「该传什么」判断权应收在 UI（展示层豁免）。
- **前端解析 Message 提取 tag**：违反「级别/语义单一事实源在 Go」的同族精神，且 200 条 × 每次渲染的重复解析纯属浪费——捕获层解析**每条只做一次**。
- **引入 `log/slog`**：见 D4。

## 3. 后果（Consequences）

**正面**

- 运行时日志从「一坨纯文本」变为**可分级、可筛选、可搜 tag** 的结构化列表，与操作日志面板能力对齐。
- **零调用点改动**即可让 250+ 条既有日志生效（带 `[tag]` 前缀者立刻可分）。
- 捕获层解析「每条一次」，展示层零重复解析。
- 级别推断规则单点，未来调整只改 `go/logs` 一处。

**负面 / 代价**

- **推断必然有误判**：含「失败」字样的正常信息（如 `[watcher] 同步失败数: 0`）会被标 error。缓解：规则保守 + 标注为「推断」，不宣称是精确级别。
- `RuntimeLog` 增字段 → **绑定须重新 `generate:bindings`**（前端类型同步）。
- chips 在运行时子 tab 下「**筛选不生效**」是既有行为（点击只更新选中态），本 ADR 改变它。**既有测试断言精确核对**（`init.test.ts`「运行时子 tab：点状态 chips 仅更新选中态，不回落拉取操作日志」）：其两条断言——①不调用 `GetImportLogs`、②chip 获得 `.active`——**在本 ADR 下依然成立**（改的是「重新渲染运行时列表」，不拉 op）；但**语义已变**，用例名与注释须同步更新，避免留下「不生效」的过期描述。

**已知遗留**

- 级别推断是启发式，非真实级别（标准库 log 无级别是硬前提）。
- 无 tag 的日志（裸 `log.Printf("...")`，如 `go/scanner/scanner.go` 的 sink 回退分支）仍只能靠搜索。
- 日志量上限（200）不变；本 ADR 不解决「历史日志不落盘」问题（那是流 B 的固有设计）。

## 4. 数据溯源

- **捕获层现状**：`go/logs/runtime.go|RuntimeBuffer.Write`（`Level: LevelInfo` 硬编码 + 注释「标准库 log 无级别」）。
- **展示层现状**：`frontend/src/views/app-content/diagnostics/logs.ts|dgLsRenderRuntimeRows`（固定 joystick 图标，无分类）。
- **tag 前缀实证**：全仓 grep `log.Printf("[` 命中 250+ 次，前缀集合含 `avatar`/`geometry`/`ysm`/`watcher`/`sync`/`installer`/`fsutil`/`dedup`/`texture_cache`/`queue`/`types`/`spec`/`threejs`/`container`/`packs`/`litematic`/`storage`/`proxy`/`plaza`/`pathmgr`/`logs` 等。
- **级别线索实证**：`go/types/registry/resource.go` 用 `log.Printf("[types][WARN] %s", v)`、`go/threejs/spec-bones.go` 用 `[spec] ⚠️ ...`、`go/cli/bench_concurrent.go` 用 `⚠️`——**调用点已自发携带级别线索**，本 ADR 只是把它们读出来。
- **接线**：`internal/app/app.go|ServiceStartup` 的 `log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))`。

<!-- 文件名: runtime-log-structuring.md → 实际文件 ADR-289-runtime-log-structuring.md -->
