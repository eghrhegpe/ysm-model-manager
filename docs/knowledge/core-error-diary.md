---
kind: core-error-diary
name: UI 报错落日记 error-diary
tier: leaf
category: core
source_files:
  - frontend/src/core/error-diary.ts
auto_fields:
  symbols_with_lines:
    - DiaryEntry
    - DiarySink
    - DiaryStatus
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
  - 日记写入失败外溢 → 必须 try/catch 兜底，不影响 toast 链路
use_when:
  - error-diary
  - 报错日记
  - toast error warn 落盘
  - 运行时日志环
  - DiarySink
invariant_anchors:
  - frontend/src/core/error-diary.ts|DiarySink
status: active
---

# UI 报错落日记 error-diary

## 概览

把 UI 层的错误/告警（toast、未捕获异常、未处理拒绝、logWarn/logError）统一净化后写入运行时日志环（go/logs），诊断页可回溯。**core 不感知 Wails**：落盘通道 `DiarySink` 由装配层注入，`AddOpLog` 适配在 `backend/diary-sink.ts`，装配层（app-modules）接线（ADR-189 D1 断环）。

## 核心职责

- **四路监听收口**：① error/warn toast（`toast:show`）② `window.onerror` ③ `unhandledrejection` ④ `logWarn`/`logError` 透写——后者经 `utils/base/log.ts` 的注入式 `setLogSink` 收敛到本模块，复用同一套净化/去重
- **净化策略**（留在 core，属内核策略非 IO）：剥 `❌/⚠️` emoji 前缀（含 U+FE0F 变体选择器）、剥离 Go 端 AppError 拼入的内部路径段（`源路径：...` / `目标路径：...`，ADR-051 日记持久化不引入完整路径）、截断 title 200 / detail 500（前端冗余防御，Go 侧 maxFieldLen 会再截断）
- **写入放大防护**：同 `(msg+status)` 连续 5s 去重（UI 错误挤占 500 条共享环形缓冲；A-B-A 交错风暴按设计逐条记录）
- **注册语义**：幂等可重复调用；任一监听挂载失败整体回滚（unregisterErrorDiary），防部分注册后重试叠加；`unregisterErrorDiary` 为对称正式生命周期（拆除四路监听 + 重置去重状态 + 清 log sink），应用生命周期内通常只在测试中使用
- **失败兜底**：sink 同步抛错或异步拒绝均不外溢（异步由 sink 实现自行截断），日记写入失败只 console.warn

## 对外 API / 入口

- `registerErrorDiary(sink: DiarySink): void` — 注册（注入式，幂等）
- `unregisterErrorDiary(): void` — 注销（幂等）
- `DiarySink = (entry: DiaryEntry) => void` — 落盘通道类型；实现须自行捕获异步失败
- `DiaryEntry { title, detail, status: "failed" | "warn" }` — 净化后条目（title→AddOpLog modelName 位，detail→errMsg 位，status 与 go/logs 枚举对齐）

## 与其他子系统关系

- `backend/diary-sink.ts`：AddOpLog 适配器（含 reject 截断防死循环），测试在 `backend/diary-sink.test.ts`
- `utils/base/log.ts`：`setLogSink` 注入点（core→utils/base 属 ADR-189 D4 允许边）
- `@/bus`：消费 `toast:show` 事件

## 不变量

- core 不得 import `backend/*`（ADR-189 D1）；新增落盘通道一律走注入
- 日记持久化不引入内部路径（ADR-051）
- 注册/注销必须成对可重入，监听不得叠加

## 相关

- [ADR-189](./../adr/ADR-189-frontend-core-backend-utils-core-feedback.md)（core 准入 + D1 断环）
- `docs/knowledge/event-bus.md`（bus 契约）
