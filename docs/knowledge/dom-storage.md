---
kind: dom-storage
name: localStorage 安全读写 safeGet/safeSet
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/storage.ts
auto_fields:
  symbols_with_lines:
    - safeGet:7
    - safeRemove:25
    - safeSet:16
  quick_groups:
    - 跨组件通信与页面
  quick_intents:
    - localStorage、隐私模式、safeGet / safeSet
  quick_risk_lines:
    - localStorage 读写必须走 safeGet/safeSet，禁止裸调 localStorage，防隐私模式中断启动
  pitfalls:
    - 裸调 localStorage → 隐私模式抛异常、启动链中断；必须经 safeGet/safeSet
    - safeSet 不带 fallback → 存储禁用时静默失败；必须在 safeSet 中设 fallback 或 try/catch
  use_when:
    - localStorage
    - 隐私模式
    - safeGet
    - safeSet
    - storage
  invariant_anchors:
    - frontend/src/utils/dom/storage.ts|safeGet
    - frontend/src/utils/dom/storage.ts|safeSet
tests: []
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - localStorage、隐私模式、safeGet / safeSet
quick_risk_lines:
  - localStorage 读写必须走 safeGet/safeSet，禁止裸调 localStorage，防隐私模式中断启动
pitfalls:
  - 裸调 localStorage → 隐私模式抛异常、启动链中断；必须经 safeGet/safeSet
  - safeSet 不带 fallback → 存储禁用时静默失败；必须在 safeSet 中设 fallback 或 try/catch

use_when:
  - localStorage
  - 隐私模式
  - safeGet
  - safeSet
  - storage
invariant_anchors:
  - frontend/src/utils/dom/storage.ts|safeGet
  - frontend/src/utils/dom/storage.ts|safeSet
status: active
---

# localStorage 安全读写 safeGet/safeSet

## 概览

`localStorage` 安全读写工具层（ADR-044 策略 A），收敛项目内所有 `localStorage` 调用，避免隐私模式/存储禁用下裸调抛错中断启动链（`initTheme`/`applyUIPrefs`/`settings.initSettings` 等）。

## 核心职责

- **安全读**: `safeGet(key)` — `try/catch` 包装 `localStorage.getItem`，存储不可用时返回 `null`（调用方走默认值回退）
- **安全写**: `safeSet(key, val)` — `try/catch` 包装 `localStorage.setItem`，存储不可用时静默忽略（不中断调用方）
- **安全删**: `safeRemove(key)` — `try/catch` 包装 `localStorage.removeItem`，存储不可用时静默忽略

## 对外 API / 入口

- `safeGet(key: string): string | null`
- `safeSet(key: string, val: string): void`
- `safeRemove(key: string): void`

## 不变量

- 禁止在业务代码中裸调 `localStorage.getItem/setItem/removeItem`，统一走本模块
- 隐私模式下读写静默降级，不抛错、不中断流程
