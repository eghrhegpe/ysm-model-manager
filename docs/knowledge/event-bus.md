---
kind: event-bus
name: 事件总线 bus.ts
tier: architecture
category: core
source_files:
  - frontend/src/bus.ts
tests:
  - frontend/src/bus.test.ts
use_when:
  - 事件
  - 事件总线
  - 通信
  - emit
  - 跨组件通信
  - bus
---

# 事件总线 bus.ts

## 概览

`bus.ts` 是 YSM 前端的唯一事件中枢，基于发布/订阅模式。所有跨组件、跨页面的异步通信都经过此总线，避免组件间直接耦合。

## 核心职责

- **统一通信通道**: 所有组件通过 `bus.emit()` 发送事件，`bus.on()` / `bus.off()` 监听
- **事件命名规范**: 小写 kebab-case + 冒号分段（`domain:action`），如 `nav:changed`, `toast:show`, `tree:set-search`
- **全局事件注册**: 全局事件必须注册在 `app-content/index.ts` 的 `_registerGlobalHandlers()` 中

## 对外 API / 入口

- `createBus` — 创建事件总线实例
- `on` / `off` / `once` / `emit` — 订阅 / 退订 / 一次性 / 发布（`Bus` 接口）
- `BusEvents` — 事件名 → payload 类型映射（类型化总线，`BusEventName` 联合类型）；`on` 返回取消订阅函数供 `_unsubs` 收集

## 与其他子系统关系

- `app-modules.ts`: 各子模块入口，负责模块内部事件分发
- `core/global-handlers.ts`: 全局事件处理器集合
- Wails EventsOn: Go 后端 → 前端的 Bridge 事件也通过 bus 转发

## 不变量

- 全局事件只注册一次，不重复注册（见 AGENTS.md §三 陷阱 #3 #8）
- 异步操作的 `finally` 中必须 emit 完成事件，不可放 `try` 末尾
- 不通过 `window` 传递事件，统一走 bus

## 相关

- `frontend/src/core/global-handlers.ts` — 全局事件处理
- `frontend/src/app-modules.ts` — 子模块事件路由
