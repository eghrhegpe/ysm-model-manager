---
kind: gate-chain-map
name: 门禁委托链全景图（四入口横向拼图）
tier: architecture
category: config
source_files:
  - .githooks/pre-commit
  - .githooks/pre-push
  - .githooks/prepare-commit-msg
  - .githooks/post-commit
  - scripts/pre-push-gate.ts
  - scripts/doctor.ts
  - scripts/commit-with-check.ts
auto_fields:
  symbols_with_lines: []
use_when:
  - 门禁委托链
  - 找门禁流程
  - 钩子在哪拦
  - 为什么还能提交
  - 哪个入口阻断
  - 门禁总览
invariant_anchors:
  - scripts/pre-push-gate.ts|function main
  - scripts/doctor.ts|function delegate
quick_groups:
  - 门禁与脚本
quick_intents:
  - 一眼看清 commit/push/CI 各环谁在哪拦
  - 判断某个检查项归属哪一层
  - 排查「闸红了为什么还能提交」
pitfalls:
  - 本卡是横向拼图，单环纵深细节读 pre-commit-hook / pre-push-gate 两卡；勿用本卡替代细读
  - 判定「某检查项是否真阻断」必须看它所在清单的 blockPolicy（hard/debt/failClosed），FAIL 非空 ≠ 被拦
  - 注释与知识卡的「CI 是否同跑 gate」曾三处口径不一（钩子写尚未、同卡两行一写已接线一写尚未）；判断现状只认 .github/workflows/test.yml 实况
status: active
---

# 门禁委托链全景图（四入口横向拼图）

## 概览

单环细读是清楚的（[pre-commit-hook](./pre-commit-hook.md) / [pre-push-gate](./pre-push-gate.md) 各讲一环纵深），**环与环之间没有一张拼图**才是「从 git 钩子找流程困难」的真正来源：读者知道 pre-commit 里发生了什么，却不知道它与 pre-push、doctor、CI 是分工还是重复、某个检查项到底归哪一层、某道闸红/绿会影响哪次操作。本卡只回答**横向归属**，纵深一律跳单环卡。

四入口 × 委托链总览：

```
git commit ─┬─ pre-commit（sh 薄壳，含逻辑）── sec 级 gen + stage + 提示 + 硬阻断×3
            ├─ prepare-commit-msg ──────────── 纯提示（知识漂移/覆盖率），恒 exit 0
            └─ post-commit ───────────────── 清「路径限定提交」的索引残留

git push ──── pre-push（41行薄壳）→ pre-push-gate.ts（调度器）→ gate-blocks/×6 → gate-config.ts（清单）

doctor ────── doctor.ts 薄派发器 ─全部委托─→ pre-push-gate.ts（--all / --docs / --gate）
commit-with-check ── 独立轻量清单（刻意不复用 gate，避免重型构建双重付费）

CI ────────── test.yml 独立步骤：pre-push-gate --static（静态层）+ 各步骤独立承担 build/test/契约
```

## 四入口分工（横向归属表）

| 入口 | 触发 | 委托终点 | 阻断性 | 逃生阀 |
|------|------|---------|--------|--------|
| pre-commit | commit 时 | 内联 sh（快照/stage/格式/防御）+ 直调各 check 脚本 | 三段 **hard**（android-lite / biome 行级 / design-tokens 行级），其余仅提示 | `YSM_SKIP_*`（命中即留痕 SKIPPED_PRECOMMIT） |
| prepare-commit-msg | commit 时 | `scripts/hooks/`×3 提示脚本 | 恒 exit 0，纯提示 | 各 `YSM_SKIP_*_HINT=1` |
| post-commit | commit 后 | `gen-staged-pair.ts` 清索引残留 | 恒 exit 0 | `YSM_SKIP_POSTCLEAN=1` |
| pre-push | push 时 | `pre-push-gate.ts`（薄壳→调度器→gate-blocks→gate-config 清单） | hard 档阻断；debt/failClosed 只记录 | `YSM_SKIP_GATE=1`（留痕 SKIPPED）／`--no-verify`（零痕迹） |
| doctor | 手动 | 全部委托 `pre-push-gate`（三模式） | 同 pre-push | 同 pre-push |
| CI | push/PR | `pre-push-gate --static`（静态层）＋各步骤独立承担 build/test/契约 | 静态层 hard 阻断 | 无（远端唯一防线） |

## 「某检查项归哪一层」速查

- **只减不增型闸（biome 行级 / design-tokens / a11y / css-layer）**：按不变量须**双挂**——pre-commit 拦提交 + gate-config 清单拦推送/CI；只挂其一属单点防线。判定口径统一走真行级 `--added-lines`，不用行号入键。
- **域级检查（go build/test、前端 build/vitest、契约测试）**：本地由 gate 域块承担；CI 由 test.yml 各步骤独立承担，**不经 gate 编排**。
- **静态治理工具（27/37 接入门禁）**：清单单一事实源 = `scripts/_lib/gate-config.ts`，分 ALL / DOC / FRONTEND / GO 四张；未接入项走 pre-commit 或 CI 旁路。判定「真阻断」看该清单项 `blockPolicy`，FAIL 非空 ≠ 被拦。
- **审计留痕**：逃生阀命中分两级——`YSM_SKIP_GATE=1` 与 `YSM_SKIP_*` 命中写 `.git/gate-audit.log`（SKIPPED/PUSH 行，可审计）；`git commit --no-verify` / `git push --no-verify` 整钩不跑，零痕迹，只能靠 CI 远端拦截与 `doctor --audit-check` 对账事后回溯。

## 与其他子系统关系

- [pre-commit-hook](./pre-commit-hook.md)：commit 环纵深（gen 快照/stage/并发配对/硬阻断三段）。
- [pre-push-gate](./pre-push-gate.md)：push 环纵深（域裁剪/gate-ctx/gate-config 清单/阻断矩阵/覆盖尾行）。
- [doctor-gate-overlap](./doctor-gate-overlap.md)：doctor 与 gate 双调度器重叠审计。
- [scripts-readme-index](./scripts-readme-index.md)：脚本登记侧对账闸。
- 三卡（pre-commit-hook / pre-push-gate / commit-with-check）各自 spawn 的脚本集交集与耗时实测结论 → `8496da9fd` + doctor-gate-overlap；**重复 ≠ 浪费，量级与同名同参才决定是否删**。

## 不变量

- **判断某环现状只认实况**（读 `.githooks/` 钩子 + `.github/workflows/*.yml` + 当前清单），不认注释里的历史快照——注释是决策时化石，会与后续落地脱节（2026-10-06 实证：「CI 尚未同跑 gate」在钩子与知识卡并存三处，实为 09-14 已接线）。
- **pre-push 是唯一全量阻断的本地闸**：commit 期间前端域红灯照落（pre-commit 不跑域级检查），真正拦截在 push / commit-with-check / doctor。
- **清单单一事实源 = `gate-config.ts`**，新增检查项只改清单不 gate 调度；块内按 ALL/DOC/FRONTEND/GO 分挂。

## 相关

- `.githooks/pre-push`（push 薄壳）、`.githooks/pre-commit`（commit 壳）、`scripts/pre-push-gate.ts`（调度器）、`scripts/_lib/gate-config.ts`（清单）、`scripts/doctor.ts`（派发器）、`.github/workflows/test.yml`（CI 静态层）