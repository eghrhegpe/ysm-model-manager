---
kind: safe_error_msg
name: 安全错误消息提取 utils
tier: architecture
category: utils
source_files:
  - frontend/src/utils/safe-error-msg.ts
tests:
  - frontend/src/utils/safe-error-msg.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 错误消息提取、Worker 错误、catch
  - safeErrorMessage、异常提取
quick_risk_lines:
  - Web Worker 内错误提取必须用 safeErrorMessage，禁止 import i18n 依赖
pitfalls:
  - Worker 内 import i18n → 模块加载失败、Worker 崩溃；必须用 safeErrorMessage
  - safeErrorMessage 不做字符串化 → null/undefined 错误丢信息；必须经 safeStr 兜底

use_when:
  - 错误消息
  - Worker 错误
  - catch
  - safeErrorMessage
  - 异常提取
invariant_anchors:
  - frontend/src/utils/safe-error-msg.ts|safeErrorMessage
status: active
---

# 安全错误消息提取 utils

## 概览

`frontend/src/utils/safe-error-msg.ts` 提供轻量级错误消息提取函数 `safeErrorMessage`，从任意错误对象中安全提取可读消息字符串。与 `errors.ts` 的 `friendlyError` 区别：本函数无 i18n 依赖、无 AppError 翻译，可在 Web Worker 内安全 import（Worker 无法访问 i18n 模块）。

## 核心职责

- 从任意 `unknown` 类型错误中提取可读消息字符串
- 处理四种输入形态：`Error` 实例（取 `.message`）、含 `.message` 属性的对象、其他可序列化值（`String(err)`）、`null`/`undefined`（返回 `"unknown error"`）
- 零依赖、Worker 安全——stats.worker / mmd-ktx2-worker / pmx-parser.worker 等 27 处消费者使用

## 对外 API / 入口

- `safeErrorMessage(err: unknown): string` — 唯一导出函数，从任意错误对象提取可读消息

## 与其他子系统关系

- 被 27 个前端模块消费（3D 适配器、Worker、视图组件、社区下载队列、诊断面板等）
- 与 `errors.ts` 的 `friendlyError` 互补：`safeErrorMessage` 做轻量提取（Worker/日志），`friendlyError` 做用户侧 toast 翻译

## 不变量

- 函数签名 `safeErrorMessage(err: unknown): string` 不变——所有 Worker 依赖此签名
- `null`/`undefined` 输入恒返回 `"unknown error"`，不抛异常
- 不 import i18n 模块——Worker 环境无法访问

## 相关

- [utils-dom](./utils-dom.md) — 其他工具函数
