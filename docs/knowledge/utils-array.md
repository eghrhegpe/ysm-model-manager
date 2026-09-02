---
kind: utils-array
name: 数组工具 moveItem
tier: architecture
category: utils
source_files:
  - frontend/src/utils/array.ts
tests:
  - frontend/src/utils/array.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 数组排序、拖拽排序、moveItem
  - 列表 reorder
quick_risk_lines:
  - 数组移动必须走 array.ts 的 moveItem，禁止手写 splice 排序
pitfalls:
  - 手写 splice 排序 → 与拖拽 drop 逻辑不一致、边界溢出；必须经 moveItem
  - moveItem 未 clamp → 拖拽到首/尾位置时报错；必须在 moveItem 内做 clamp

use_when:
  - 数组排序
  - 拖拽排序
  - moveItem
  - 列表 reorder
invariant_anchors:
  - frontend/src/utils/array.ts|moveItem
status: active
---

# 数组工具 moveItem

## 概览

纯函数层数组操作工具，从 `site/edit.ts` 的拖拽排序 drop 逻辑抽出，供单测覆盖（ADR-023 L3）。

## 核心职责

- **原地移动**: `moveItem<T>(arr, from, to)` — 将 `arr[from]` 移到 `arr[to]` 位置，原地修改并返回同一数组引用
- **边界防御**: `from === to` 或越界时原样返回，不抛出

## 对外 API / 入口

- `moveItem<T>(arr: T[], from: number, to: number): T[]` — 将索引 `from` 的元素移到索引 `to`

## 相关

- `frontend/src/site/edit.ts` — 最初来源，拖拽排序逻辑
