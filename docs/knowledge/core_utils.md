---
kind: core_utils
name: 核心工具函数 core-utils
tier: architecture
category: utils
source_files:
  - frontend/src/utils/core/
auto_fields:
  symbols_with_lines:
    - Abortable
    - addDisposableListener
    - asArray
    - asNumber
    - asString
    - clamp
    - clamp01
    - clampInt
    - clampPct
    - debounce
    - DebouncedTimer
    - delay
    - Disposable
    - fireAndForget
    - getCompound
    - isObj
    - lerp
    - lerpArray
    - LoadingGuard
    - logError
    - logWarn
    - makeLazyLoader
    - swallowError
    - waitForFrame
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - 工具函数、防抖、异步工具
    - swallowError / fireAndForget / retry / timeout
    - 纯函数
  quick_risk_lines:
    - swallowError 只用于"吞掉已知安全错误"，禁止用于掩盖业务异常；fireAndForget 必须带 error 回调兜底
  pitfalls:
    - swallowError 吞掉业务异常 → 静默失败、无法排查；必须用于"预期内可忽略"的错误
    - fireAndForget 无 error 兜底 → 异常丢失；必须挂 onerror 回调或全局 error 监听
  use_when:
    - 工具函数
    - 工具方法
    - 纯函数
    - 防抖
    - 异步
  invariant_anchors:
    - frontend/src/utils/core/async.ts|swallowError
    - frontend/src/utils/core/async.ts|fireAndForget
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 工具函数、防抖、异步工具
  - swallowError / fireAndForget / retry / timeout
  - 纯函数
quick_risk_lines:
  - swallowError 只用于"吞掉已知安全错误"，禁止用于掩盖业务异常；fireAndForget 必须带 error 回调兜底
pitfalls:
  - swallowError 吞掉业务异常 → 静默失败、无法排查；必须用于"预期内可忽略"的错误
  - fireAndForget 无 error 兜底 → 异常丢失；必须挂 onerror 回调或全局 error 监听

use_when:
  - 工具函数
  - 工具方法
  - 纯函数
  - 防抖
  - 异步
invariant_anchors:
  - frontend/src/utils/core/async.ts|swallowError
  - frontend/src/utils/core/async.ts|fireAndForget
status: active
---

# 核心工具函数 core-utils

## 概览

`utils/core/` 是全前端最基础的纯函数工具层，不依赖任何前端框架或业务模块。按 ADR-044 策略 A 收敛自多包重复实现，统一入口。

## 核心职责

| 工具 | 文件 | 用途 |
|------|------|------|
| async | `async.ts` | 异步工具（sleep、retry、timeout、swallowError、fireAndForget） |
| clamp | `clamp.ts` | 数值约束（min/max/clamp） |
| debounce | `debounce.ts` | 防抖/节流 |
| disposable | `disposable.ts` | 资源生命周期管理（dispose 模式） |
| log | `log.ts` | 运行时日志工具（带级别过滤） |

## 对外 API / 入口

每个工具独立导出，按需 import：

```ts
import { clamp } from './utils/core/clamp';
import { sleep, retry } from './utils/core/async';
```

## 不变量

- 所有函数为纯函数，无副作用
- 零外部依赖（不依赖 Three.js、Wails、DOM）
- 全局唯一实现（ADR-044 策略 A 收敛），禁止各模块自行实现同功能

## 相关

- [utils-dom](./utils-dom.md) — DOM 工具层（依赖 core-utils）
- [utils-fmt](./utils-fmt.md) — 格式化工具（依赖 core-utils）