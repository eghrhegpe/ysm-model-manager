---
kind: utils_fmt
name: 格式化工具 fmt
tier: leaf
category: utils
source_files:
  - frontend/js/utils/dom/format.ts
use_when:
  - 文件大小
  - 字节格式化
  - KB MB
  - 日期格式化
  - 友好日期
  - 文件大小颜色
---

# 格式化工具 fmt

## 概览

字节数与时间戳的格式化纯函数集，服务于列表行的尺寸与日期展示。

## 核心职责

- 字节数 → 可读大小（B / KB / MB）
- 文件大小 → 颜色 class（<1MB 绿，1-3MB 正常，>3MB 红）
- 时间戳 → 友好日期（今天显时间，今年显「M月D日」，往年显「YYYY/M/D」）

## 对外 API / 入口

- `fmt(b: number): string` — 字节数 → `"N B"` / `"N.N KB"` / `"N.N MB"`（KB/MB 阈值 1024 / 1048576）；非法值（null/undefined/NaN）返回空串
- `sizeColor(b: number): string` — 返回 CSS class：`"sz-green"`（<1MB）、`""`（1-3MB）、`"sz-red"`（>3MB，阈值 3145728）
- `fmtDate(ts: number): string` — 时间戳 → 友好日期；0/空值返回空串

## 与其他子系统关系

- 被 `app-tree/render.ts` 消费（树/列表行渲染：文件大小、尺寸颜色、修改日期）
- `sz-green` / `sz-red` class 的具体颜色在组件 CSS 中定义，必须走 CSS 变量

## 不变量

- 纯函数、无副作用、不抛异常：非法输入一律返回空串
- 日期判断基于本地时区（`toDateString` / `getFullYear` 与当前时间比较）

## 相关

- [app_tree](./app_tree.md) — 主要消费方
- `frontend/js/utils/dom/format.test.ts` — 单元测试（验证入口）
