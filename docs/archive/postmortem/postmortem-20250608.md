# Postmortem: YSMParser 集成与 2D 模型渲染（2026-06-07/08）

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（6 轮 Debug）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-029：YSMParser 解码架构：WASM 内嵌取代 sidecar EXE](../../adr/ADR-029-ysmparser-wasm-embed.md) — 双格式支持（LegacyYSM AES / OYSM zip）、YSMParser 输出字段兼容（float `texture_width`、`json.RawMessage` UV、cubes `null→[]`）、sidecar→WASM 方向

## 原内容摘要

`.ysm`/`.zip`/`.7z` 2D 骨骼线框预览集成，YSMParser.exe sidecar 路径查找、UV 格式不兼容、texture_width 类型不匹配、bone.cubes 可迭代等。解码架构决策已归 ADR-029。
