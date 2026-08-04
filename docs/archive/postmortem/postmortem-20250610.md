# 2026-06-10 全功能复盘报告

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（逐轮症状/根因/修复）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-017：前端 UI 体验优化](../../adr/ADR-017-frontend-enhancement-backlog.md) — 自更新器 `os.Rename` 原子替换（F-2，取代 `updater.bat`）
- [ADR-029：YSMParser 解码架构：WASM 内嵌取代 sidecar EXE](../../adr/ADR-029-ysmparser-wasm-embed.md) — 解码性能优化（缓存 ArrayBuffer / 胶水缓存 / 移除必然失败的 callMain 回退）、`HideWindow` 防弹窗

## 原内容摘要

WASM 解码器性能大修、内存泄漏修复（缓存上限 50 + FIFO、Blob URL 释放、取消 `requestAnimationFrame`）、自动更新器重构（`os.Rename` 原子替换 + 回滚）、发布说明分离。更新器架构归 ADR-017，解码性能归 ADR-029。
