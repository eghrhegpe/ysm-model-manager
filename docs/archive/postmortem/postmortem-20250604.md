# 2025-06-04 重构复盘报告（第二次）

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（逐轮症状/根因/修复）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-005：前端治理规则](../../adr/ADR-005-frontend-governance-rules.md) — 架构统一原则（全部 ESM + Vite）、`public/` 禁止下放 JS（R6）
- [ADR-014：TypeScript 迁移](../../adr/ADR-014-typescript-migration.md) — Vite 原生转译、新旧混编

## 原内容摘要

Go Binding ↔ 前端调用对接审计、回收站/设置页/诊断页重构、CSS 变量迁移、链接模式切换与硬链接跨分区回退等。其中「架构统一为 ESM + Vite、`public/` 仅放静态资源」为关键架构决策，已归 ADR-005/014。
