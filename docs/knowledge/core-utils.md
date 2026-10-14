---
kind: core-utils
name: 核心工具函数 core-utils
tier: architecture
category: utils
source_files:
  - frontend/src/utils/base/
auto_fields:
  symbols_with_lines:
    - addDisposableListener
    - APP_ERROR_PATH_RE
    - arrayBufferToBase64
    - asRecord
    - base64ToBytes
    - BusyLock
    - bytesToArrayBuffer
    - clamp
    - clamp01
    - clampPct
    - createBusyLock
    - createListenerSet
    - debounce
    - Disposable
    - formatLongTask
    - GH_DOCS
    - GH_RELEASES
    - GH_REPO
    - hasRecycleSegment
    - isNum
    - isObj
    - isStorageAccessible
    - isWebPath
    - LabelSource
    - ListenerSet
    - logError
    - LogSink
    - logWarn
    - LongTaskInfo
    - moveItemMut
    - parseWebDirPath
    - parseWebPath
    - resolveLabel
    - safeErrorMessage
    - safeGet
    - safeGetJSON
    - safeRemove
    - safeSet
    - setLogSink
    - sniffTexSize
    - startMainThreadWatch
    - stripAppErrorPaths
    - swallowError
    - TimeoutError
    - toInt
    - u8ToBase64
    - webDirType
    - withLock
    - withTimeout
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 工具函数、防抖、异步工具
  - swallowError（fire-and-forget 错误兜底）
  - 纯函数
quick_risk_lines:
  - swallowError 只用于"吞掉已知安全错误"，禁止用于掩盖业务异常；fire-and-forget 场景必须经 swallowError 兜底
pitfalls:
  - swallowError 吞掉业务异常 → 静默失败、无法排查；必须用于"预期内可忽略"的错误
  - swallowError 异常仅记日志不抛出 → 调用方无感知；生产无 console 时须靠 log.ts setLogSink 接日志

use_when:
  - 工具函数
  - 工具方法
  - 纯函数
  - 防抖
  - 异步
invariant_anchors:
  - frontend/src/utils/base/primitives/async.ts|swallowError
  - frontend/src/utils/base/primitives/lock.ts|createBusyLock
status: active
---

# 核心工具函数 core-utils

## 概览

`utils/base/`（原 `utils/core/`，ADR-189 D2 改名消双 core 歧义）是全前端最基础的纯函数工具层，不依赖任何前端框架或业务模块。按 ADR-044 策略 A 收敛自多包重复实现，统一入口。

## 核心职责

| 工具 | 文件 | 用途 |
|------|------|------|
| async | `async.ts` | 异步工具（swallowError，fire-and-forget 错误兜底） |
| clamp | `clamp.ts` | 数值约束（min/max/clamp） |
| debounce | `debounce.ts` | 防抖/节流 |
| disposable | `disposable.ts` | 资源生命周期管理（dispose 模式） |
| log | `log.ts` | 运行时日志工具（带级别过滤） |
| nbt-guards | `nbt-guards.ts` | NBT 数据结构类型守卫（isObj / asString / asNumber / asArray / getCompound） |

## 对外 API / 入口

每个工具独立导出，按需 import：

```ts
import { clamp } from './utils/base/pure/clamp';
import { swallowError } from './utils/base/primitives/async';
```

## 不变量

- 所有函数为纯函数，无副作用
- 零外部依赖（不依赖 Three.js、Wails、DOM）
- 全局唯一实现（ADR-044 策略 A 收敛），禁止各模块自行实现同功能

## 忙锁语义边界（`primitives/lock.ts`，ADR-341 唯一互斥形态）

`BusyLock { tryStart / finish / isBusy }` + `withLock` 是全仓「单临界区互斥」的**唯一形态**（ADR-341 归一，前身六族 busy 并存已被收编）：手写「检查 → 置忙 → finally 复位」三段一律改 `if (!lock.tryStart()) {...}`（检查+置位单步原子，杜绝「查了再抢」竞态窗口，recycle-bin 连点双确认框即该疾实证），能整体包住的走 `withLock`。`isBusy()` 只服务 UI 查询（drop hint 显隐之类），业务守卫禁写「查了再抢」回潮。

**豁免边界（判据「挡的是不是同一个临界区」）**：per-key 在途集合（`features/import/executor.ts` 的 `inFlight` 指纹集、`views/app-sync-manager/network.ts` 的 `_singleBusy` 按 path）挡的是「每个 key 各自一份在途」，异键须并发；代际/状态机字段（`preview-3d` 的 `switching` 态、`diagnostics/dedup.ts` 的 `state.busy`+`pendingType` 补扫记账）是会话状态机的分体——两族均不归本原语。

## 相关

- [utils-dom](./utils-dom.md) — DOM 工具层（依赖 core-utils）
- [utils-fmt](./utils-fmt.md) — 格式化工具（依赖 core-utils）