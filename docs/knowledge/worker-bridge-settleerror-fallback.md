---
kind: worker-bridge-settleerror-fallback
name: worker-bridge-settleError-fallback
tier: leaf
category: utils
source_files:
  - frontend/src/utils/3d/adapters/worker-bridge.ts
use_when:
  - 扩展 WorkerErrorStrategy 策略
  - 评审 worker-bridge settleError 分支
---

# worker-bridge-settleError-fallback

## 概览

`worker-bridge.ts:89-97` `settleError` 三分支结算：`terminatePool` → reject；`makeErrorResponse` 存在 → resolve 错误响应；else → reject。L65 `const onWorkerError = opts.onWorkerError ?? "resolveAllError"` 把联合窄化成 `string`，后续 L94 `if (onWorkerError === "terminatePool")` 比较合法但 L95 `else if (makeErrorResponse)` 兜底——若未来加第三种策略，`settleError` 静默走 `makeErrorResponse` 分支。

## 核心职责

Worker 桥单请求失败结算：超时 / dispose / onerror 复用 `settleError`，按 `WorkerErrorStrategy` 策略选择 reject 或 resolve 错误响应。

## 对外 API / 入口

- `settleError(id: number, msg: string): void` — 闭包内函数，`handleMessage`/`clearPending`/`terminatePool`/`handleWorkerError`/`request` 复用。

## 与其他子系统关系

- 上游：`createResolveModeBridge`（pmx/fbx resolve-mode）/ ktx2 reject-mode 池。
- 下游：`pending` Map 管理 in-flight 请求，`settleError` 结算后 `pending.delete(id)`。

## 不变量

- `WorkerErrorStrategy = "resolveAllError" | "terminatePool"` 联合类型穷尽性。
- `resolveAllError` 模式必须传 `makeErrorResponse`（L71 入口契约校验，抛错）。
- `terminatePool` 模式 `makeErrorResponse` 不允许（联合分支约束）。
- **消息接线由工厂完成**：`createResolveModeBridge` 内部把 `worker.onmessage/onerror` 委托回 `bridge.handleMessage/handleWorkerError`——薄封装不暴露这两者，漏接 = worker 响应永不结算、恒超时 ok:false 静默回退主线程。409b060e 重构曾丢失接线，2026-08-30 补测轮（audit-r16）修复并加 `worker-bridge.test.ts`「工厂内部接线」回归锁。

## 问题清单（ts-package-review 2026-08-27）

1. **可扩展性隐患**：L65 `onWorkerError` 窄化成 `string`，L94 `if` 比较 + L95 `else if` 兜底——若未来加第三种策略（如 `retryPool`），`settleError` 静默走 `makeErrorResponse` 分支，语义反转。
2. **当前非 bug**：只有两策略，L94-96 分支穷尽，行为正确。

## 建议动作

1. `settleError` 的 `else if (makeErrorResponse)` 分支加 `assertNever(onWorkerError)` 兜底，未来加策略编译期报错。
2. 或：`onWorkerError` 窄化成 `"resolveAllError" | "terminatePool"` 字面量联合（`const onWorkerError: WorkerErrorStrategy = opts.onWorkerError ?? "resolveAllError"`），L94 `if` 比较 + L95 `else` 兜底（无 `makeErrorResponse` 检查）——但需确认 `resolveAllError` 模式 `makeErrorResponse` 必传的 L71 校验仍生效。

## 相关

- ADR-101（goroutine 池设计，前端 concurrentMap 对齐）
- 兄弟卡：`mount3D-584-giant`（同审核批次，3D 层坏味道）
