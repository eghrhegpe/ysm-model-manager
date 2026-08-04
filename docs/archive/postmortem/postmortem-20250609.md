# 2026-06-09 复盘报告

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（逐轮症状/根因/修复）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-004：3D 渲染管线](../../adr/ADR-004-3d-rendering-pipeline.md) — 三路模型来源（WASM/CLI/ZIP-7z）统一「全追加骨骼 → `threejs.Build()` 内去重」
- [ADR-029：YSMParser 解码架构：WASM 内嵌取代 sidecar EXE](../../adr/ADR-029-ysmparser-wasm-embed.md) — WASM 集成主线、`Module.wasmBinary` 注入、`detectYsmVersion` 预检
- [ADR-005：前端治理规则](../../adr/ADR-005-frontend-governance-rules.md) — Shadow DOM + `adoptedStyleSheets` 样式隔离

## 原内容摘要

3D 渲染引擎翻修（同名骨骼层级、pivots 共享、Bone2D Rotation、UV 映射、NearestFilter）、WASM 解码器集成、CSS 工程化（Shadow DOM + adoptedStyleSheets）。渲染去重决策已归 ADR-004，解码架构归 ADR-029，样式隔离归 ADR-005。
