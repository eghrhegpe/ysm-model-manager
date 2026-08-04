# Postmortem: 导航重构 + YSM 头部修复 + v1.4.x 发布周期（2026-06-09/11）

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（逐轮症状/根因/修复）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-029：YSMParser 解码架构：WASM 内嵌取代 sidecar EXE](../../adr/ADR-029-ysmparser-wasm-embed.md) — YSM 文件头解析（二进制泄露终止条件、纯二进制 V2 跳过扫描）、V3（`YSM` 魔数）MEMFS+callMain 分支、`detectYsmVersion` 预检
- [ADR-005：前端治理规则](../../adr/ADR-005-frontend-governance-rules.md) — Shadow DOM 样式归属（content-css.js vs components.css）、跨 Shadow DOM `querySelector` 不可穿透、事件名精确匹配
- [ADR-030：后端持久化与健壮性契约](../../adr/ADR-030-backend-robustness-contract.md) — Go `bool` 零值三态、`map[K]V` 静默覆盖、`nil` slice→`null`

## 原内容摘要

导航栏精炼、创意工坊页面分离、YSGP 文件头二进制泄露修复、`<free>` 三态标签、整合包同步状态误标（哈希去重覆盖）、V3 文本头部 WASM 解码。渲染/解码归 ADR-029，样式归属归 ADR-005，Go 零值陷阱归 ADR-030。
