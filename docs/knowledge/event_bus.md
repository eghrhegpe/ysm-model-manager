---
kind: event_bus
name: 事件总线 bus.js
tier: architecture
category: core
source_files:
  - frontend/js/bus.js
use_when:
  - 事件
  - 事件总线
  - 通信
  - emit
  - 跨组件通信
  - bus
---

# 事件总线 bus.js

## 概览

`bus.js` 是 YSM 前端的唯一事件中枢，基于发布/订阅模式。所有跨组件、跨页面的异步通信都经过此总线，避免组件间直接耦合。

## 核心职责

- **统一通信通道**: 所有组件通过 `bus.emit()` 发送事件，`bus.on()` / `bus.off()` 监听
- **事件命名规范**: 小写蛇形命名，如 `model-selected`, `download-started`
- **全局事件注册**: 全局事件必须注册在 `app-content/index.js` 的 `_registerGlobalHandlers()` 中

## 与其他子系统关系

- `app-modules.js`: 各子模块入口，负责模块内部事件分发
- `core/global-handlers.js`: 全局事件处理器集合
- Wails EventsOn: Go 后端 → 前端的 Bridge 事件也通过 bus 转发

## 不变量

- 全局事件只注册一次，不重复注册（见 AGENTS.md §三 陷阱 #3 #8）
- 异步操作的 `finally` 中必须 emit 完成事件，不可放 `try` 末尾
- 不通过 `window` 传递事件，统一走 bus

## 相关

- `frontend/js/core/global-handlers.js` — 全局事件处理
- `frontend/js/app-modules.js` — 子模块事件路由
