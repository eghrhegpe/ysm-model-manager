---
kind: app-toast
name: Toast 通知 app-toast
tier: leaf
category: ui
source_files:
  - frontend/src/views/app-toast/index.ts
  - frontend/src/utils/dom/feedback.ts
  - frontend/src/utils/dom/toast-ms.ts
auto_fields:
  symbols_with_lines:
    - FLASH_DURATION_MS:10
    - flashBtn:28
    - FlashOptions:13
    - TOAST_MS:6
    - ToastType:26
    - VIEW_TESTIDS:12
  quick_groups:
    - UI 交互与弹窗
  quick_intents:
    - Toast 通知、提示、反馈、报错提示
    - 撤销、消息、toast-ms
  quick_risk_lines:
    - Toast 必须复用 utils/dom/toast-ms.ts 的毫秒级反馈，禁止手写浮层
  pitfalls:
    - 手写 toast 浮层 → 与全局反馈样式不一致、缺撤销按钮；必须复用 toast-ms
    - toast 未设置防重入 → 快速触发多个 toast 重叠；必须挂防重入锁
  use_when:
    - toast
    - 通知
    - 提示
    - 消息
    - 撤销
    - 反馈
    - 报错提示
  invariant_anchors:
    - frontend/src/views/app-toast/index.ts|防重入
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - Toast 通知、提示、反馈、报错提示
  - 撤销、消息、toast-ms
quick_risk_lines:
  - Toast 必须复用 utils/dom/toast-ms.ts 的毫秒级反馈，禁止手写浮层
pitfalls:
  - 手写 toast 浮层 → 与全局反馈样式不一致、缺撤销按钮；必须复用 toast-ms
  - toast 未设置防重入 → 快速触发多个 toast 重叠；必须挂防重入锁

use_when:
  - toast
  - 通知
  - 提示
  - 消息
  - 撤销
  - 反馈
  - 报错提示
invariant_anchors:
  - frontend/src/views/app-toast/index.ts|防重入
status: active
---

# Toast 通知 app-toast

## 概览

`app-toast` 是全局 Toast 通知组件（Shadow DOM，固定悬浮于视口底部居中），是全应用唯一的操作反馈出口。治理红线要求所有异常路径必须有 toast 反馈，各模块统一通过 `bus.emit("toast:show", ...)` 触发，不各自实现提示 UI。

## 核心职责

- `app-toast.ts` — `<app-toast>` 组件：监听 `toast:show` 并调 `show(msg, undoCallback, duration, type, clickCallback)`；管理 toast 生命周期（入场弹性动画、定时自动移除、`slideOut` 出场动画）；支持「↩ 撤销」按钮（点击执行回调并追加「✅ 已撤销」确认）、整条点击回调、手动关闭；同屏上限 5 条，超出同步移除最早一条

## 对外 API / 入口

- 自定义元素：`<app-toast>`
- 监听 bus：`toast:show`，载荷 `{ msg, undo?, duration?, type?, click? }`（`type`：`error` / `success` / `info` / `warn`；默认时长 4000ms 来自 `utils/dom/toast-ms.ts` 的 `TOAST_MS.verbose`；全仓 toast 时长已收敛至 `TOAST_MS` 8 档单一事实源（含新增 `persist=10000` / `sticky=60000` 长期通知档），消费方统一引用语义档，内联魔法数字由 `scripts/check-toast-duration.ts` 门禁守护 R7 红线）
- 实例方法：`show(msg, undoCallback, duration, type, clickCallback)`（一般不经由方法直调，统一走 bus）
- 派发 bus：无

## 与其他子系统关系

- 全应用各组件（app-content / app-sidebar / app-sync-manager / core/context-menus 等）的异常与结果反馈均汇入此组件
- 撤销型 toast 支撑破坏性操作的可撤销路径（UX 维度「操作结果可撤销」）
- 样式走全局 CSS 变量（`var(--card)` / `var(--paid)` / `var(--free)` / `var(--accent)`），层级走 `var(--z-toast)`

## 不变量

- `bus.on("toast:show")` 的 `_unsub` 必须在 `disconnectedCallback` 清理
- 消息文本必须过 `_esc`（textContent→innerHTML 方式）转义，禁止直拼 HTML
- 超过 5 条时同步移除最早条目（不可走异步 `_remove`，否则死循环）；移除前必须 `clearTimeout` 对应定时器
- 组件实例全局唯一（`app-modules.ts` 静态导入一次），反馈路径禁止另起炉灶
- **撤销/点击回调在 `_remove` 200ms 出场动画窗口内禁止重复触发**（P2 修复：回调触发即置 `pointer-events:none`；原实现 handler 未摘除、连点可重复执行 undo/双开弹窗）；**`undoCallback` 抛错不得跳过反馈**（P2 修复：原 try/finally 无 catch，异常传播跳过「✅ 已撤销」且无用户提示；现 catch 后给「❌ 撤销失败」）

## 相关

- `frontend/src/bus.ts` — 事件总线（见知识卡 `event_bus`）
- `frontend/src/app-modules.ts` — 组件装配入口（见知识卡 `app_modules`）
- `docs/governance-rules.md` — 「所有异常路径必须有 toast 反馈」规则条文
