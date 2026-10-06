---
kind: core-error-diary
name: UI 报错落日记 error-diary
tier: leaf
category: core
source_files:
  - frontend/src/core/error-diary.ts
  - frontend/src/backend/diary-outbox.ts
  - frontend/src/backend/diary-sink.ts
  - frontend/src/backend/global-error-listeners.ts
auto_fields:
  symbols_with_lines:
    - __resetDiaryOutboxForTest
    - DiaryEntry
    - DiaryHandle
    - DiarySink
    - DiaryStatus
    - drainDiaryOutbox
    - drainDiaryOutboxToMainChannel
    - enqueueDiaryOutbox
    - installGlobalErrorListeners
    - makeDiarySink
    - OUTBOX_KEY
    - pushToDiary
    - readDiaryOutbox
    - registerErrorDiary
    - unregisterErrorDiary
  tests:
    - frontend/src/core/error-diary.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 报错落日记、error toast 落盘、运行时日志环
  - error-diary / registerErrorDiary / DiarySink
  - logWarn logError 透写日记
quick_risk_lines:
  - error/warn toast、未捕获异常、未处理拒绝、logWarn/logError 四路都经 error-diary 落日记（注入式 DiarySink，不直连 backend）
pitfalls:
  - core 里直 import backend → 违反 ADR-189 D1 断环；落盘通道必须注入（backend/diary-sink.ts 适配 AddOpLog）
  - 注册不幂等 / 失败不回滚 → 重试叠加监听，同条 toast 落两遍日记
  - 注册失败 catch 后 fall-through 重新占位 currentHandle → 僵尸句柄致模块永久静默失效（回滚须返回空 handle、不占位）
  - 日记写入失败外溢 → 必须 try/catch 兜底，不影响 toast 链路
  - Go AppError 文案（`源路径：`/`目标路径：`全角冒号 token）变更须同步 fixture + stripAppErrorPaths 正则（双侧测试钉契约，ADR-207 D2）
  - 「sink 失败只 console.warn」已不是完整事实 —— 另有 outbox 第二通道 + `GetLogChannelHealth` 锁存位 + 诊断页红条（ADR-322）；只留 console 等于元失败留在 GUI 不可见区
  - 元失败层（通道自身失效）**禁** `logWarn`/`logError`/`pushToDiary` 收编 —— 那会经 sink 回到 `AddOpLog` 失败处，构成跨 microtask 无限循环（不栈溢出，静默烧 CPU）；此类处一律裸 try/catch 静默 + 锁存健康位（ADR-322 D2）
use_when:
  - error-diary
  - 报错日记
  - toast error warn 落盘
  - 运行时日志环
  - DiarySink
invariant_anchors:
  - frontend/src/core/error-diary.ts|DiarySink
  - go/types/types.go|AppError
status: active
---

# UI 报错落日记 error-diary

## 概览

把 UI 层的错误/告警（toast、未捕获异常、未处理拒绝、logWarn/logError）统一净化后写入运行时日志环（go/logs），诊断页可回溯。**core 不感知 Wails、不摸 window**：落盘通道 `DiarySink` 由装配层注入，`AddOpLog` 适配在 `backend/diary-sink.ts`，装配层（app-modules）接线（ADR-189 D1 断环）；全局错误监听（`window` error / `unhandledrejection`）下沉 `backend/global-error-listeners.ts`（装配层，唯一碰 window 处；utils 只许被别人引、不得反向依赖 core，故原 utils/dom 归属已迁出），经本模块 `pushToDiary` 入口收口（ADR-189 D4：DOM 原语不进 core）。

## 核心职责

- **监听分层收口**：① error/warn toast（`toast:show`）④ `logWarn`/`logError` 透写——两者在 core 内收口（`setLogSink` 注入式，复用同一套净化/去重）；②③ 未捕获异常 / 未处理拒绝的 `window` 监听**不在此模块**，由 `backend/global-error-listeners.ts` 注册并调用 `pushToDiary(msg, "failed")` 转发进本模块策略，core 自身零 `window` 调用（ADR-189 D4）
- **净化策略**（留在 core，属内核策略非 IO）：剥 `❌/⚠️` emoji 前缀（含 U+FE0F 变体选择器）、剥离 Go 端 AppError 拼入的内部路径段（ADR-051 日记持久化不引入完整路径；剥离正则本体在 `utils/base/pure/apperror-text.ts` `stripAppErrorPaths`，跨语言契约 fixture 见下）、截断 title 200 / detail 500（前端冗余防御，Go 侧 maxFieldLen 会再截断）
- **写入放大防护**：去重键 = `status + 净化后 title`（先净化后算键——仅路径段不同的原始文本塌缩为同键），按 key 独立 5s 窗口（`dedupAt: Map`，上限 32 键，超限淘汰最旧 fail-open）；A-B 交错风暴按 key 各自抑制（ADR-207 D1，取代旧「交错风暴逐条记录」语义）
- **AppError 文案跨语言契约**（ADR-207 D2）：`stripAppErrorPaths` 匹配 Go `AppError.Error()` 的 `源路径：`/`目标路径：`（全角冒号）token；共享 fixture `tests/fixtures/apperror-sample.json` 双端钉——Go 侧 `go/types/apperror_test.go` 断言 `Error()` 全串 == fixture，Node 契约测试 `tests/test_apperror_strip.ts` 读 fixture 跑净化断言路径段剥净；Go 改文案 → Go 测试先红 → 同 PR 同步 fixture + 前端正则
- **注册语义**：幂等可重复调用；返回 `DiaryHandle.taken` 区分「本次是否接管 sink」——首次成功 `taken=true`，重复注册 / 注册失败 `taken=false`（不再静默 no-op，装配层可据此告警）；任一监听挂载失败整体回滚，防部分注册后重试叠加；**提交 currentPush / currentHandle 全部成功后才赋值**——结构上杜绝僵尸（disposed）句柄占位导致后续注册恒 no-op 的缺陷类；`unregisterErrorDiary` 为对称正式生命周期（拆除四路监听 + 重置去重状态 + 清 log sink），应用生命周期内通常只在测试中使用
- **失败兜底**：sink 同步抛错或异步拒绝均不外溢（异步由 sink 实现自行截断）；**「日记写入失败不影响调用方」是正确取舍，但元失败层不留在此处终结**（ADR-322）——core 内仍只 `console.warn`，第二通道（outbox）由装配层在 sink 失败时补投，通道健康由 `GetLogChannelHealth` 锁存位上报，诊断页红条呈现。core 保持引擎无关、零 IO，不因新增通道而破 ADR-189 D1

## 对外 API / 入口

- `registerErrorDiary(sink: DiarySink): DiaryHandle` — 注册（注入式，幂等；返回 handle 供 dispose）
- `unregisterErrorDiary(): void` — 注销（幂等，向后兼容薄壳，委托 currentHandle?.dispose()）
- `pushToDiary(msg: string, status: DiaryStatus): void` — 全局错误转发入口（ADR-189 D4 拆分新增）：供 window 监听层（`backend/global-error-listeners.ts`）调用，把未捕获异常 / 未处理拒绝收口进同一套净化/去重策略；**未注册时告警一次并跳过（ADR-210 D5：失活须留痕，不再静默 no-op），注册成功后标志复位，再失活可再告警**
- `DiaryHandle { taken: boolean; dispose(): void }` — 生命周期句柄（`taken` 标记本次是否实际接管 sink；dispose 幂等，dispose 后 toast + logSink 监听全拆；window 监听归 backend 装配层 `global-error-listeners.ts`，由该层 disposer 独立移除）
- `DiarySink = (entry: DiaryEntry) => void` — 落盘通道类型；实现须自行捕获异步失败
- `DiaryEntry { title, detail, status: "failed" | "warn" }` — 净化后条目（title→AddOpLog modelName 位，detail→errMsg 位，status 与 go/logs 枚举对齐）

## 与其他子系统关系

- `backend/diary-sink.ts`：AddOpLog 适配器（含 reject 截断防死循环，测试在 `backend/diary-sink.test.ts`）；reject 时经 `enqueueDiaryOutbox(entry)` 投第二通道并导出 `drainDiaryOutboxToMainChannel()`（装配层启动期调用）
- `backend/diary-outbox.ts`：**日记第二通道**（ADR-322 D2）。key `ysmm:diary-outbox`（裸 localStorage、不用 `web:` 前缀那是 IDB 命名空间），上限 50 条丢最旧；`drainDiaryOutbox(emit)` 顺序发送遇败即停（不打乱因果链）、整批成功后一次性 `slice(sent)` 抹除；模块内铁律**禁 `logWarn`/`logError`/`pushToDiary`**（写失败再报 → 回 sink → `AddOpLog` 失败 → 回到 enqueue，跨 microtask 无限循环）
- `utils/base/primitives/log.ts`：`setLogSink` 注入点（core→utils/base 属 ADR-189 D4 允许边；副作用原语层仍零上层依赖）
- `backend/global-error-listeners.ts`：`installGlobalErrorListeners()` 注册 `window` error / `unhandledrejection`，转发 `pushToDiary`（backend → core 合法装配边，与 `diary-sink.ts` 同型；原 utils/dom 归属因 utils 不得反向依赖 core 迁出）
- `@/bus`：消费 `toast:show` 事件
- `bus.ts` → `logError`（ADR-322）：`emit` 的缺参告警与 handler 异常此前裸 `console.warn/error`（不进日记）；已收编进 `logError`（bus.ts 因此从零依赖叶子引入 `utils/base` 唯一依赖，循环风险已核：`logError`→sink→`AddOpLog` 是 async 边界不同步回 `emit`）

## 不变量

- core 不得 import `backend/*`（ADR-189 D1）；新增落盘通道一律走注入
- 日记持久化不引入内部路径（ADR-051）
- 注册/注销必须成对可重入，监听不得叠加

## 相关

- [ADR-189](./../adr/ADR-189-frontend-core-backend-utils-core-feedback.md)（core 准入 + D1 断环）
- [ADR-210](./../adr/ADR-210-core-convergence-locale-host.md)（D5：pushToDiary 未注册态告警一次 + 注册成功复位）
- [ADR-322](./../adr/architecture/ADR-322-meta-failure-log-channel-health.md)（元失败层：outbox 第二通道 + 通道健康锁存位 + 分区不可驱逐）
- `docs/knowledge/event-bus.md`（bus 契约）
