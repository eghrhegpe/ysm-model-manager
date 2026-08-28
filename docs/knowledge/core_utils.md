---
kind: core_utils
name: 核心工具函数 core-utils
tier: architecture
category: utils
source_files:
  - frontend/src/utils/core/
use_when:
  - 工具函数
  - 工具方法
  - 纯函数
  - 防抖
  - 异步
  - 日志
invariant_anchors:
  - frontend/src/utils/core/async.ts|swallowError
  - frontend/src/utils/core/async.ts|fireAndForget
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