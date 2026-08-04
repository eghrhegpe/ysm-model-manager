# Postmortem: WASM 内嵌 YSMParser 解码（2026-06-08）

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（8 轮 Debug）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-029：YSMParser 解码架构：WASM 内嵌取代 sidecar EXE](../../adr/ADR-029-ysmparser-wasm-embed.md) — 内存解析优先、HEAPU8 扩容后重取、`Uint8Array.from` 转换、`atob()` 解码 base64、胶水代码字符串注入 patch

## 原内容摘要

将 YSMParser C++ 编译为 WASM 内嵌（取代 1.2MB sidecar exe）。8 轮 Debug：`Unsupported file version` → 内存解析 bridge → HEAPU8 闭包变量 → `const` 重赋值 → `.replace()` 歧义 → 内存扩容分离 → `new Uint8Array(string)` 空数组 → **终极根因 `ReadFileBytes` 返回 base64 字符串**。其工程契约内核已归 ADR-029。
