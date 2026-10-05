# ADR-322：元失败层：日志通道健康锁存 + 第二落盘通道 + 不可驱逐保留位

- **状态**：✅ 已采纳（D1–D4 全部落地并提交，2026-10-05；P2 两项按 §2 否决方案 ④ 后置另批）
- **实施状态**：已实施（Go 侧 `Logger.Health()` + `go/logs/ring.go trimRing` 分区裁剪 + `GetLogChannelHealth` 绑定、web 侧 `web-store|GetLogChannelHealth` 写探针、`backend/diary-outbox.ts` 第二通道与启动期 drain、`bus.ts` emit 收编 `logError`、诊断页 `channel-health.ts` 常驻红条；知识卡 `go-logs` / `core-error-diary` / `app_content_diagnostics` / `backend-idb` 已同步）
- **日期**：2026-10-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：报告失败的通道自身失效是一类独立失败形状，缺它则已知失败形状的收敛终点静默丢失；跨 Go 日志环/前端装配层/诊断页三域，方向难逆转
- **相关**：`frontend/src/core/error-diary.ts, go/logs/logs.go, go/logs/runtime.go, internal/app/app_install_log.go, frontend/src/backend/diary-sink.ts, frontend/src/backend/web-store.ts, frontend/src/bus.ts, frontend/src/views/app-content/diagnostics/logs.ts, docs/knowledge/core-error-diary.md, docs/knowledge/go-logs.md, docs/adr/architecture/ADR-189-core-dependency-purity.md, docs/adr/decisions/ADR-207-error-message-cross-language.md, docs/adr/decisions/ADR-210-ui-failure-recovery.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

2026-10-05 元失败锐评（对本仓错误处理链的源码勘查）得出的定性：**本仓把失败精确收口到了「已知的失败形状」，却没有为「报告失败的机制自身失效」保留任何失败类型**。两半的成熟度落差极大：

**已收口的一半（做得好，无需动）**——toast 类型由 `toastTypeToStatus` 的 `const exhaustive: never = type` 穷举裁决（`frontend/src/core/error-diary.ts:45-50`，新增 toast 类型漏裁决即编译错）；Go 侧 `addOpErr` 用 `errors.As` 把 `types.AppError` 拆成 `Code/Reason/Suggestion` 三字段（`go/logs/logs.go:238-247`）；sink 同步抛错被 `logUiMsg` 的 try/catch 就地截断（`error-diary.ts:121-126`）、异步拒绝被 `diary-sink.ts` 的就地 `.catch` 截断（有 `diary-sink.test.ts` 锁浮空 Promise）；去重风暴有 5s 窗口 / 32 键 fail-open；字段膨胀有前端 200/500 + Go 1024 三层截断。**每一类失败都有一条可命名的路径。**

**没收口的一半（元失败）**——全部失败收敛到单漏斗单终点：

```
toast / logError / window error → logUiMsg → DiarySink → AddOpLog → op log ring → JSON 文件
                                                                                  ↓
                                                                          终点 = console.warn（不进任何环）
```

终点本身就是元失败：通道没有 outbox、没有第二通道、没有自身健康状态位。六个具体缺口：

1. **通道失败只落裸 console**：`error-diary.ts:125`（写入失败）与 `:158`（注册失败已回滚）只 `console.warn`。前端没有 Go 侧 `log.SetOutput(io.MultiWriter(os.Stderr, a.runtimeLogs))`（`internal/app/app.go:175`）的等价物，裸 console 不进任何环，GUI 生产态无 DevTools → 用户永不可见。
2. **唯一兜底落点被调试门控**：`frontend/src/backend/diary-sink.ts:20` `dbg("diary-sink", "AddOpLog 失败", ...)` 受 `isDebugEnabled()` 门控（`?nodebug=1` 或 localStorage `_debug=0` 即静默）。「加了调试开关查完问题后，元失败唯一证据随之消失」——这是取证路径与证据保留的自我矛盾。
3. **失败汇聚点自己不走通道**：`frontend/src/bus.ts:202-208` handler 异常与 `:199` 缺参告警都只 `console.error`/`console.warn`。全仓 `console.(warn|error|log)\s*=` 生产零猴补（仅 `frontend/src/preview-3d/menu/engine/items.test.ts:543/581` 测试临时替换），故 `frontend/src` 约 90 处裸 console 一次性流出生记系统，**无任何收编机制**。
4. **Go 内存态降级静默 + 同仓政策自相矛盾**：`NewLogger` 在 `configDir==""` 或 `MkdirAll` 失败时返回 `path==""` 内存态 logger，此后 `save()`（`go/logs/logs.go:163-165`）静默 no-op、`scheduleSave()`（`:289-291`）直接 return，只有 `log.Printf` 落在「只在内存不落盘、重启即失」的 runtime 环；`AddOpLog`（`internal/app/app_install_log.go:12-14`）**无 `error` 返回值**、`GetLogCaps`（`:33-35`）只回传容量不回传持久化状态 → 前端契约层无从得知。**同仓已有相反先例**：`go/tags/tags.go:132` 注释「P1 修复：内存态显式返回错误，让调用方感知持久化不可用」；而 `docs/knowledge/go-logs.md:90` 反把 logs 的静默记成设计优点「操作日志落盘失败只记系统 log、不向上抛错（日志不阻塞主流程）」。同一仓对「日志不阻塞主流程」有两种相反口径。
5. **环形上限专挤最值钱证据**：op 环默认 500（`logMaxEntries()`，可经 `LogMaxEntries` 调）、runtime 环 200（`go/logs/runtime.go` `DefaultRuntimeCap`）、debug 环 200（`frontend/src/utils/debug/debug.ts` `RING_MAX`）三者**都丢最旧**。崩溃循环时最有诊断价值的「第一次出错」最早被挤掉；且日记以 `op="ui"` 与 import op 挤同一个 500 环，元失败风暴会挤掉真正的 import 诊断证据。
6. **诊断页自证循环**：`frontend/src/views/app-content/diagnostics/logs.ts:329/349` 的「加载操作日志失败」「加载运行时日志失败」都走 `logError`，而 `logError` 即经 `setLogSink` → `logUiMsg` → `AddOpLog` 这同一条通道。通道整体不可用时，「日志页打不开」与「写日志失败」互为成因，而失败证据又被第 1/2 条吞掉。此处零注释、零 ADR、零测试。

**病根不是疏忽，是词汇表缺失**：全仓 grep「元失败 / meta-fail / 失败形状」零匹配——该概念从未在本仓 ADR 体系与知识卡出现，因此它在设计评审时根本不是一个待裁决项。讽刺对照：`error-diary.ts:124` 注释「日记写入失败不影响调用方」本身是正确的取舍，但「正确取舍」的**隐式后果**（于是终点永久丢失）从未被写成显式决策；本仓对「REVISION 断言 throw vs 六锚点 warn」这类不对称都专门写注释论证（`docs/audit-water-critique.md` 九章第⑤条），同样严谨没有延伸到 sink 失败。**失败可以是已知的，报告失败的能力却是未知的。**

## 2. 决策（Decision）

**方向（提议）：把「报告失败的通道自身」升为一等公民——健康状态位可查询、失败有第二落点、元失败证据不可被普通日志驱逐。**分四条独立可回滚的子决策：

1. **通道健康锁存位（P0，Go 侧契约先行）**：`logs.Logger` 新增持久化健康状态（`persistOK bool` + `reason string`，`NewLogger` 内存态与 `save()` 失败即置位并锁存——一次失败后健康位不再回弹，避免「闪断」让 UI 红条闪烁掩盖真实状态），经 `*App` 导出为 `GetLogChannelHealth()` 绑定。**不把 `AddOpLog` 改成返回 `error`**：那条路要求全部 90 处调用方处理返回值，且日志不阻塞主流程的既有正确取舍会被推翻；健康位是只读观测面，不改写侧契约。照抄 `go/tags/tags.go:132` 既有先例。
2. **前端第二落点 = localStorage outbox（P1）**：日记 sink 失败时把原始 `DiaryEntry` 写 `localStorage["ysmm:diary-outbox"]`，下次启动 drain 进主通道后清空。outbox 天然不经 backend，故不构成环。容量与条目上限随实现钉死在知识卡，不做无界增长。**两条子句冲突时取「不得经日记通道报错」的那条**——即**不**走 `utils/base/primitives/storage.ts` 的 `safeGetJSON`/`safeSet`（仓内 localStorage 统一入口，ADR-044 策略 A），而是**裸 localStorage + try/catch 静默**：那三个函数的失败分支是 `logWarn("storage", ...)`，用它必然踩到下一句的禁令（`logWarn → sink → AddOpLog 失败 → outbox → logWarn` 死循环），与「安全性质优先于复用偏好」。死循环形态是跨 microtask 无限循环——不栈溢出，只静默烧 CPU 直到页面关闭，比抛错更难发现。沿用 `diary-sink.ts` 已确立的同一纪律。
3. **元失败证据不可驱逐（P1）**：op 环对 `op="ui"` 给独立配额（或独立 ring），runtime 环对 `[meta]` 前缀条目保底不裁。直接针对缺口 5——「先挤掉最值钱的第一次出错」是环形结构在崩溃态下的固有缺陷，须用「按类配额」而非「改 cap」解决（改 cap 只是把问题推后，且挤掉的仍是同一批证据）。**必须同步 `go/logs/logs_test.go:230-240` `TestLogger_CapAt500` 与 `go/logs/logs_extra_test.go:330-345` `TestLogger_AddOp_CapRealloc` / `:349-364` `TestRuntimeBuffer_WriteRealloc`**——后者构造 `path==""` 内存态并断言 `cap(l.logs)==maxLogEntries`，保留位逻辑须在内存态下语义一致。
4. **收编失败汇聚点（P0）**：`frontend/src/bus.ts` `emit` 的 handler 异常与缺参告警改经 `logError` 进日记。环风险已核：`logError` → sink → `AddOpLog` 是 async 边界，不回 `emit`。**代价须记账**：`bus.ts` 至今**零 import**（纯类型 + 实现的叶子模块，239 行），加 `logError` 依赖会改变其叶子地位——这是本决策唯一的方向性代价，且因 `logError` 本身只依赖 `utils/base/primitives/log.ts` 而可接受，但须在代码里留注释说明为何此处破例。

**否决方案**：

- ① **只加注释、把「sink 失败只落 console」写成显式取舍**（最小动作）——否决：这承认了缺口却不改变「终点永久丢失」的事实，与 §1 缺口 2 的取证悖论直接冲突；可以作为文档升格的**补充**，不能作为本体。
- ② **给 `AddOpLog` 加 `error` 返回值**——否决：改写侧契约要求全量调用方处理返回值，把「日志不阻塞主流程」的正确取舍推翻为「写日志也要处理错误」，是与 ADR-051（日记不引入内部路径）/ 既有 docs 口径相反的方向；健康位以只读观测面达成同一可观测性目标而不动写侧。
- ③ **在 `error-diary.ts` 内建 in-memory outbox 并周期性重试**——否决：`src/core` 准入要求无 Wails 也能单测且不依赖 DOM 原语层，持久化职责不属于 core；且纯内存 outbox 在通道故障（往往伴随主通道整体不可用）下与主通道同生共死，跨不过重启——第二通道必须活得比主通道久，故落在 `backend` 侧的 localStorage。
- ④ **P2 两项（元失败落点脱离 `dbg` 门控、启动自检探针）同期做**——否决：`dbg` 门控与自检探针各自需要独立裁决（自检探针会写合成条目，污染用户可见的 op 环，需先定「合成条目可辨识/不计数」的标记位），与本期四条耦合会扩大一次改动的验证面；待本 ADR 落地后单独立执行批。

## 3. 后果（Consequences）

- **正面**：通道故障第一次成为**可查询状态**而非纯静默（`GetLogChannelHealth` + 诊断页常驻红条 + 启动一次 toast，用户与前端都看得见）；元失败有了跨重启的第二证据带（localStorage outbox），崩溃现场可事后复盘；`bus.ts` 汇聚点收编后，全仓最大的一处裸 console 流失止住；`op="ui"` 独立配额让界面元失败与 import 诊断互不驱逐。`docs/knowledge/go-logs.md:90`「静默不抛错」的旧口径随之改写为「不抛错但置健康位」——**同仓两种口径在此归一**。
- **负面**：`Logger` 结构新增可变健康状态字段（`mu` 保护下），`Logger` 从「无状态可序列化环」变成「带状态对象」，涉及 `logs_extra_test.go` 里直接构造 `&Logger{...}` 字面量的测试；新增 Wails 绑定需重跑 `cd frontend && npm run generate:bindings`（禁手写绑定）**并同步 `frontend/src/backend/web-store.ts` 的 `webStoreBindings`**（否则 web 版 `canBinding` 返回 false、`browserAdapter.ts:79` `throw new WebUnsupportedError(name)` fail-fast），以及 `frontend/e2e/mock-data.ts` 可能需补一行；`localStorage` outbox 引入一个新的持久化键（需纳入清理/隐私口径审查）；`bus.ts` 破例引入 import 依赖。
- **已知遗留**：① web 模式语义不对等——`frontend/src/backend/web-store.ts:136-151` `addWebOpLog` 有意把 op 日志写进 **runtime 环**（ADR-071），故 web 版「日志未落盘」只能报「内存环是否可用」（IDB 失败时 `pushWebLog` 的 `swallowError(idbSet(...))` 静默降级为纯内存），无桌面版的持久化概念；② `frontend/src` 仍有约 88 处裸 `console.warn/error` 未收编（`bus.ts` 只是最大的一处），全面收编需另立裁决（是否全局猴补 console）；③ 「加一个 cap 只解决一个环」的反例——本 ADR 三个环（op/runtime/debug）里 debug 环（200）未做保留位，只因元失败证据不走它；④ P2 两项（脱离 `dbg` 门控、启动自检探针）按 §2 否决方案 ④ 后置。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 用户锐评指令（2026-10-05）原文「代码设计只把失败 demande 精确到『已知的失败形状』，没人处理『元失败』」+ 随后的全仓源码勘查与终稿 | 本 ADR §1 全部六缺口与病根定性、§2 方向 |
| 终稿处方表七行（P0 通道健康锁存位 / P0 `bus.emit` 收编 / P1 outbox 第二通道 / P1 不可驱逐保留位 / P2 脱离调试门控 / P2 自检探针 / 文档升格），用户拍板「先修复吧」 | §2 子决策 1-4 范围、§2 否决方案 ④（P2 后置）、§3 已知遗留 |
| `go/tags/tags.go:132` 注释「P1 修复：内存态显式返回错误，让调用方感知持久化不可用」 | §2 子决策 1「照抄既有先例」而非新造口径的依据 |
| `docs/knowledge/go-logs.md:90` 把「落盘失败只记系统 log、不向上抛错」记成设计优点 | §1 缺口 4「同仓政策自相矛盾」、§3 正面「两种口径归一」 |
| `frontend/src/backend/diary-sink.ts` 就地 `.catch` + `dbg` 替代 `console.warn` 防死循环的既有决策（含注释与 `diary-sink.test.ts`） | §2 子决策 2「outbox 写入必须裸 try/catch 静默」的纪律来源 |
| `frontend/src/core/error-diary.ts:124-125`「日记写入失败不影响调用方」注释 | §1 病根「正确取舍的隐式后果未升格为显式决策」 |
| `go/logs/logs_extra_test.go:330-364` 两个 Realloc 测试构造 `path==""` 内存态并断言 `cap(...)` 精确值 | §2 子决策 3「保留位逻辑须在内存态下语义一致」的测试约束 |
| ADR-051（日记不引入内部路径）/ ADR-189 D1（core 准入与断环）/ ADR-207 D2（跨语言错误文案契约）/ ADR-210 D5（失活留痕）/ ADR-071（web op 日志走 runtime 环） | §2 各项的既有约束来源、§3 已知遗留 ①② |
| `node scripts/new-adr.ts --tier architecture --reason ...` 占号输出（dry-run 预测 ADR-322 与文件名 `meta-failure-log-channel-health.md`） | 本文件编号与文件名 |

<!-- 文件名: meta-failure-log-channel-health.md → 实际文件 architecture/ADR-322-meta-failure-log-channel-health.md（ADR-320 architecture 全量模板） -->
