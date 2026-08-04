# 2026-06-07 复盘报告

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（逐轮症状/根因/修复）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-005：前端治理规则](../../adr/ADR-005-frontend-governance-rules.md) — `public/` 禁止下放 JS（R6）、同名文件冲突规避

## 原内容摘要

全局拖拽导入（DnD）修复、旧版代码清理、`public/js/app-legacy-bundle.js` 副本冲突（Vite `public/` 优先于源码）、WebView2 DnD API 差异、异步回调 Promise 包装等。其「`public/` 仅放静态资源、改前 grep 同名文件」原则已归 ADR-005。
