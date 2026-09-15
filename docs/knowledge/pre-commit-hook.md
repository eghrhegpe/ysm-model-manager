---
kind: pre-commit-hook
name: 提交前钩子 pre-commit
tier: architecture
category: utils
source_files:
  - .githooks/pre-commit
  - .githooks/post-commit
  - scripts/_lib/gen-staged-pair.ts
  - scripts/_lib/hook-audit.ts
auto_fields:
  symbols_with_lines:
    - appendHookAudit
    - deletePairList
    - GEN_STAGED_PREFIX
    - HookAuditEntry
    - hookAuditFilePath
    - ORPHAN_TTL_MS
    - pairListPath
    - readPairList
    - sweepOrphanPairs
    - writePairList
use_when:
  - pre-commit
  - 钩子
  - 文档同步
  - 自动 stage
  - 并发隔离
  - 逃生留痕
invariant_anchors:
  - .githooks/pre-commit|snap_docs
  - .githooks/pre-commit|GEN_SKIPPED
  - .githooks/pre-commit|PARENT_OID
  - .githooks/post-commit|HEAD~1..HEAD
quick_groups:
  - 提交与钩子
quick_intents:
  - 提交前文档自动同步
  - 防吞并发会话未提交漂移
quick_risk_lines:
  - 禁止在 pre-commit 用 git add -u docs/ 兜底（会吞他人未提交半成品，违反 P2-2）
pitfalls:
  - 快照缺失时严禁 git add -u docs/ 兜底（违反 P2-2 并发隔离）→ 仅置 GEN_SKIPPED=1 跳过并告警
  - 并发共享 checkout 下 snap_docs mtime 窗口期内并行会话手改 docs → 误判为 gen 产物
  - gen 产物文件路径含空格时 git add 不加引号会断裂 → 必须用 git add -- "文件路径"
  - snap_docs 使用 $ 进程后缀生成快照文件路径，Windows Git Bash 下 /tmp 可能不存在
  - 智能 stage 测试文件逻辑对含多个点号的文件名可能截断错误
  - drift --affected 过滤逻辑中 docs/knowledge/index.md 应排除，但其他 gen 产物未过滤可能误报
  - 版本防御检查 $ 开头文件名的正则会匹配路径中含 $ 的合法文件
status: active
---

# 提交前钩子 pre-commit

## 概览

`.githooks/pre-commit` 在 commit 前跑秒级 gen 脚本同步文档/索引/知识卡机器生成区，并**仅 stage 本次 gen 实际 touch 的文件**（gen 前后快照 diff 对比，2026-08-17 P2-2 修复并发隔离）。gen 与格式化段**非阻断**；但钩子另含**三段硬阻断（exit 1）**：`check-biome-lines`（行级新增违规）、`check-android-unavailable`（平台黑名单）、`check-design-tokens --baseline`（设计令牌只减不增）——它们刻意挂 pre-commit 而非仅 pre-push，目的是防 `--no-verify` 单点绕过；全量门禁仍留给 pre-push。

## 核心职责

- `snap_docs()`：gen 前/后遍历 `docs/`、`frontend/public/locales/`、`completions/` 记录 `(mtime,size,path)` 快照；**node 优先**生成（跨平台稳），`find -printf` 仅 GNU 快路径
- 精确 stage：diff 快照取 `>` 侧（新增/变化文件）逐一 `git add`，无 diff 无副作用；**并发下失效修复**（2026-09-01）：stage 判定下沉 `_lib/gen-stage.ts`（stage = 快照变化 ∩ 非并行 dirty，`??` 按 gen 前后存在性区分），契约测试 `tests/test_gen_stage.ts` 守护
- 兜底收窄（ADR-150）：`GEN_SNAP` 缺失时**不** `git add -u docs/`，仅置 `GEN_SKIPPED=1` 跳过并告警——防止吞并行会话未提交漂移（实证 `ebb921a5` 误吞 96 张知识卡）
- drift `--affected` 秒级接入（ADR-087）：取本次 stage 文件查知识卡漂移，不自动 stage
- 智能 stage：改源码自动 stage 同名 `.test.ts`（防误 stage）
- gofmt 自动修复 staged go 文件（失败仅提示）
- biome 自动修复 staged frontend TS/TSX（2026-09 接线，镜像 gofmt 范式）：只处理 `git diff --cached` 的 `frontend/*.ts/tsx`，跳过含未暂存编辑的文件（防混拼半成品），`check-biome.ts --write --files` 原地修复后重新 stage；失败仅提示不阻断（pre-push 只读校验兜底）。逃生阀 `YSM_SKIP_BIOME_FIX=1`。曾长期只有 pre-push 只读门禁、与 gofmt 不对称（头注释 "—write pre-commit 用" 空挂），2026-09 补齐
- 并发配对生成物清单（ADR-232 D1，2026-09-13）：`PARENT_OID=$(git rev-parse HEAD)` 早于 stage 段定义（`set -u` 下必须 `:-` 守卫引用）；gen 产物清单写 `.git/ysm_gen_staged_<PARENT_OID12>`（`_lib/gen-staged-pair.ts` 配对，替代旧版 last-writer-wins 单文件 `ysm_gen_staged`，并发会话父 oid 不同天然互不覆盖）；`/tmp/ysm_gen_to_stage_$$.txt` 加 `$$` 进程后缀防互踩
- 逃生留痕（ADR-232 D2，2026-09-13）：`YSM_SKIP_BIOME_LINES=1` / `YSM_SKIP_ANDROID=1` 命中时调用 `_lib/hook-audit.ts` 写 `.git/gate-audit.log` 的 `SKIPPED_PRECOMMIT` 行（钩子仍执行→可留痕，区别于 `--no-verify` 整钩不跑的零痕迹绕过）；文案纠正：旧「绕过不留审计」误导已改为「命中即留痕可审计」

## 不变量

- **禁止 `git add -u docs/` 兜底**：会吞他人未提交 docs 半成品，违反 P2-2。快照缺失宁可跳过也不吞（ADR-150）
- gen 产物同步幂等：已同步时无 diff，`git add` 无副作用
- 任何 gen 失败仅提示，不阻断 commit；**但三段硬阻断闸是例外**（biome-lines / android / design-tokens），失败 exit 1——它们与 gen 段解耦，各有独立逃生阀
- 逃生阀：`YSM_SKIP_GEN=1 git commit` 或 `git commit --no-verify`；`YSM_SKIP_BIOME_FIX=1` 跳过 biome 自动修复；`YSM_SKIP_BIOME_LINES=1` / `YSM_SKIP_ANDROID=1` / `YSM_SKIP_DESIGN_TOKENS=1` 命中即留痕 SKIPPED_PRECOMMIT（ADR-232 D2）
- **PARENT_OID 必须先于 stage 段定义 + `set -u` 下引用须 `:-` 守卫**（`PARENT_OID=` 赋值处；引用处统一 `"${PARENT_OID:-}"`）——2026-09-13 实证：定义晚于 stage 段 + 无守卫 → `git commit` 触发 `PARENT_OID: unbound variable` 中止

## 与其他子系统关系

- 与 `post-commit` 互补：post-commit 按 `HEAD~1`（父 oid）读 `.git/ysm_gen_staged_<oid>` 清单清生成物残留，判定锚点 `HEAD~1..HEAD`（commit 不可变对象，根治「HEAD 此刻」误判，ADR-232 D1）；清完 `gen-staged-pair.ts delete` 删本清单 + `sweep` 回收 48h 孤儿
- 与 `pre-push` 互补：pre-commit 快同步+stage（另含三段硬阻断闸防 `--no-verify` 绕过），pre-push 全量门禁阻断
- 「只减不增」型闸须**双挂**：pre-commit（拦提交）+ `_lib/gate-config.ts` 的静态工具清单（拦推送/CI）——只挂 pre-commit 属单点防线。`check-design-tokens` 2026-09 补齐第二重后与 `css-layer-check` 同等防护
- 与 `prepare-commit-msg` 互补：只读 `frontend/coverage/` 不触发慢检查
- 知识卡漂移由 `check-knowledge-drift` 守护，gen 产物由本钩子 stage

## 相关

- ADR-232 — scripts/hooks 并发竞态/审计留痕/退化降级三修复（D1 配对 / D2 留痕 / D3 reconcile 退化降级）
- ADR-150 — pre-commit 兜底收窄（禁用 git add -u docs/ 吞并发漂移）
- ADR-087 — drift --affected 秒级接入
- [pre_push_gate](./pre_push_gate.md) — 逃生留痕对账（gate-audit-reconcile）
- [scripts_readme_index](./scripts_readme_index.md) — 钩子/脚本总览
