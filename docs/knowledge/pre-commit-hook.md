---
kind: pre-commit-hook
name: 提交前钩子 pre-commit
tier: architecture
category: utils
source_files:
  - .githooks/pre-commit
use_when:
  - pre-commit
  - 钩子
  - 文档同步
  - 自动 stage
  - 并发隔离
invariant_anchors:
  - .githooks/pre-commit|snap_docs
  - .githooks/pre-commit|GEN_SKIPPED
quick_groups:
  - 提交与钩子
quick_intents:
  - 提交前文档自动同步
  - 防吞并发会话未提交漂移
quick_risk_lines:
  - 禁止在 pre-commit 用 git add -u docs/ 兜底（会吞他人未提交半成品，违反 P2-2）
---

# 提交前钩子 pre-commit

## 概览

`.githooks/pre-commit`（非阻断）在 commit 前跑秒级 gen 脚本同步文档/索引/知识卡机器生成区，并**仅 stage 本次 gen 实际 touch 的文件**（gen 前后快照 diff 对比，2026-08-17 P2-2 修复并发隔离）。阻断检查留给 pre-push。

## 核心职责

- `snap_docs()`：gen 前/后遍历 `docs/`、`frontend/public/locales/`、`completions/` 记录 `(mtime,size,path)` 快照；**node 优先**生成（跨平台稳），`find -printf` 仅 GNU 快路径
- 精确 stage：diff 快照取 `>` 侧（新增/变化文件）逐一 `git add`，无 diff 无副作用；**并发下失效修复**（2026-09-01）：stage 判定下沉 `_lib/gen-stage.ts`（stage = 快照变化 ∩ 非并行 dirty，`??` 按 gen 前后存在性区分），契约测试 `tests/test_gen_stage.ts` 守护
- 兜底收窄（ADR-150）：`GEN_SNAP` 缺失时**不** `git add -u docs/`，仅置 `GEN_SKIPPED=1` 跳过并告警——防止吞并行会话未提交漂移（实证 `ebb921a5` 误吞 96 张知识卡）
- drift `--affected` 秒级接入（ADR-087）：取本次 stage 文件查知识卡漂移，不自动 stage
- 智能 stage：改源码自动 stage 同名 `.test.ts`（防误 stage）
- gofmt 自动修复 staged go 文件（失败仅提示）

## 不变量

- **禁止 `git add -u docs/` 兜底**：会吞他人未提交 docs 半成品，违反 P2-2。快照缺失宁可跳过也不吞（ADR-150）
- gen 产物同步幂等：已同步时无 diff，`git add` 无副作用
- 任何 gen 失败仅提示，不阻断 commit（阻断留给 pre-push）
- 逃生阀：`YSM_SKIP_GEN=1 git commit` 或 `git commit --no-verify`

## 与其他子系统关系

- 与 `pre-push` 互补：pre-commit 只快同步+stage，pre-push 全量门禁阻断
- 与 `prepare-commit-msg` 互补：只读 `frontend/coverage/` 不触发慢检查
- 知识卡漂移由 `check-knowledge-drift` 守护，gen 产物由本钩子 stage

## 相关

- ADR-150 — pre-commit 兜底收窄（禁用 git add -u docs/ 吞并发漂移）
- ADR-087 — drift --affected 秒级接入
- [scripts_readme_index](./scripts_readme_index.md) — 钩子/脚本总览
