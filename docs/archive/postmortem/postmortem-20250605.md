# 2026-06-05 晚间复盘报告

> 本复盘记录已**收口**：其决策内核已提炼为正式架构决策记录（ADR）。完整调试过程（逐轮症状/根因/修复）保留于 git 历史；本文件仅保留决策指针，避免真相源分裂。

## 决策已收口至

- [ADR-030：后端持久化与健壮性契约](../../adr/ADR-030-backend-robustness-contract.md) — 配置落点 `os.Executable`、JSON 非 CSV、shutdown 防御式 recover、fetch 超时、Windows 路径规范化、RE2 限制

## 原内容摘要

窗口逐次缩小 / shutdown panic / 正则 panic / CSV 中文乱码 / 下载 404 / fetch 无超时等 Bug 修复，及 9 条「关键教训」（架构级 / 前端级 / Go 级）。其工程契约内核已归 ADR-030。
