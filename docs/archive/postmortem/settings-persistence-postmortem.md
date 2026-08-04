# 设置页路径持久化 Debug 记录（2026-06-12）

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整排查链路（症状→根因→修复）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-030：后端持久化与健壮性契约](../../adr/ADR-030-backend-robustness-contract.md) — 前后端键名大小写一致性（`MmdRoot` vs `mmdRoot`）、资源库页漏读自定义路径、Tab 切换重载

## 原内容摘要

设置页 MMD/VRChat 派生路径保存后丢失：根因为 `rtypeKeyMap` 键名大写 vs JSON 小写、Go 端 `GetRepoRoot` 漏读 `cfg.MmdRoot`、`rtype === cur` 跳过重复点击。其「键名大小写契约」「跨层读取一致性」已归 ADR-030。
