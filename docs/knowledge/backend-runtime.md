---
kind: backend-runtime
name: Wails runtime 抽象 backend-runtime
tier: leaf
category: core
source_files:
  - frontend/src/backend/runtime.ts
  - frontend/src/backend/platform-web.ts
auto_fields:
  symbols_with_lines:
    - ANDROID_UNAVAILABLE
    - canBinding
    - Events
    - isViewerPlatform
    - isWebPlatform
    - PlatformMode
    - resolvePlatformMode
    - Window
quick_groups:
  - 后端桥接与运行时
quick_intents:
  - Wails Events 事件抽象
  - Wails Window 窗口抽象
  - web no-op 桩
  - 桌面/网页版运行时区分
pitfalls:
  - 业务模块禁止直 import "@wailsio/runtime"；统一经此桥
  - Web 模式 Events.On 返回空函数（no-op）；Emit 返回 Promise<false>
  - Web 模式 Window 用 Proxy 动态捕获任意方法（返回 async no-op）；thenable 探测陷阱：返回 undefined 防 await 挂起
  - 网页版 Events/Window 无原生后端，须 no-op 兜底，否则 OpenDevTools 等会抛 / 行为漂移
use_when:
  - Wails 事件订阅
  - Wails 窗口操作
  - 桌面/网页版运行时切换
  - no-op 桩消费
status: active
---

# Wails runtime 抽象 backend-runtime

## 概览

`@wailsio/runtime` 统一桥（ADR-049 Phase 1 收尾：value import 全量迁移）。业务模块禁止再直 import `@wailsio/runtime`；统一经此桥，桌面走真 runtime、网页版（无 Wails 壳）走 no-op 桩——MikuMikuAR ADR-176 教训：`Events`/`Window` 在纯浏览器无原生后端，须 no-op 兜底，否则 `OpenDevTools` 等会抛 / 行为漂移。

## 核心职责

- **`Events`** — 统一事件接口（桌面 = `WailsEvents`；web = `webEvents` no-op 桩）。web 桩实现 `RuntimeEvents` 6 方法：`On` / `OnMultiple` / `Once`（返回空函数），`Off` / `OffAll`（空函数），`Emit`（返回 `Promise<false>` 诚实报告未发送）。
- **`Window`** — 统一窗口接口（桌面 = `WailsWindow`；web = `webWindow` Proxy 动态捕获）。Proxy 任意方法返回 async no-op；`then` 属性返回 undefined（thenable 探测陷阱：防 `await Window` 挂起）。
- **`isWeb` 判定** — `backend/platform-web.ts` 的 `isWebPlatform()`；桥接层据此切换桌面 / web 实现。

## 对外 API / 入口

- `Events: typeof WailsEvents` — 统一事件接口（业务模块唯一消费入口）
- `Window: typeof WailsWindow` — 统一窗口接口
- `RuntimeEvents`（内部接口）— web 桩 6 方法契约

## 与其他子系统关系

- **`backend/platform-web.ts` `isWebPlatform()`** — web 判定源；桥接层据此切换。
- **`@wailsio/runtime`** — 真值来源（`Events as WailsEvents` / `Window as WailsWindow`）；业务模块禁止直 import。
- **`utils/debug/debug.ts` `dbg`** — web no-op 桩操作留痕（`runtime-bridge` tag），可观测。
- **`backend/app.ts`** — 桥接上层：`getApp()` 返回类型化绑定；本模块是更底层的原语抽象。
- **业务消费方**：`features/community/download-queue-store.ts`（4 组 `Events.On` 注册）、`core/android-bridge.ts`、`core/context-menus.ts`、`views/*` 等所有使用 Wails 事件 / 窗口 API 的模块。

## 不变量

- **业务模块禁止直 import `@wailsio/runtime`**：统一经此桥。
- **web Events 6 方法完整**：`On` / `OnMultiple` / `Once` / `Off` / `OffAll` / `Emit`；`Types`/`WailsEvent` 复杂类不纳入桩接口（业务侧不直接消费）。
- **web Emit 诚实返回 `Promise<false>`**：真值返回 `Promise<boolean>`，桩返回 `Promise<false>`（诚实报告未发送）。
- **web Window 无 thenable**：Proxy `get` 对 `then` 返回 undefined，防 `await Window` 被误判为 thenable 永久挂起。
- **`as unknown as` 兜底**：`Events` 桩经 `unknown` 桥接避免类型造假；`Window` Proxy 保留 `as unknown as` 兜底。

## 相关

- `docs/knowledge/wails-bridge.md`（Wails 桥接上层）
- `docs/knowledge/go-ts-golden.md`（binding 生成）
