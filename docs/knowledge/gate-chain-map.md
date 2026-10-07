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
  - scripts/_lib/gate-blocks/static-tools.ts
  - scripts/_lib/gate-ctx.ts
  - scripts/_lib/gate-parse.ts
  - scripts/_lib/commit-blocks/smart-stage.ts
auto_fields:
  symbols_with_lines:
    - buildScanVerdict
    - createGateCtx
    - deriveTestTargets
    - ExecResult
    - GATE_TIMEOUT_MS
    - GateCtx
    - GateResult
    - isTestOrSpecFile
    - ParsedToolOutput
    - parseToolOutput
    - readStagedSourceFiles
    - RecordOpts
    - requireSummaryField
    - requireSummaryOk
    - runScopedDocDrift
    - runTools
    - stageFiles
    - stripSourceSuffix
    - tryParseJson
    - tryParseSummary
    - WARNS_TOP_N
use_when:
  - 门禁委托链
  - 找门禁流程
  - 钩子在哪拦
  - 为什么还能提交
  - 哪个入口阻断
  - 门禁总览
  - 门禁块写法
  - 新块怎么写
invariant_anchors:
  - scripts/pre-push-gate.ts|function main
  - scripts/doctor.ts|function delegate
  - scripts/_lib/gate-blocks/static-tools.ts|runTools
  - scripts/_lib/gate-ctx.ts|createGateCtx
quick_groups:
  - 门禁与脚本
quick_intents:
  - 一眼看清 commit/push/CI 各环谁在哪拦
  - 判断某个检查项归属哪一层
  - 排查「闸红了为什么还能提交」
  - 新增门禁块按哪套范式写（gate-blocks 还是 commit-blocks）
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
- **静态治理工具（42 个 `check-*.ts`，30 个为 `gate-config.ts` 精确 `tool:` 条目，其余 12 个走 pre-commit / gate-blocks 旁路，仅 1 个刻意挂起）**：清单单一事实源 = `scripts/_lib/gate-config.ts`，分 ALL / DOC / FRONTEND / GO 四张（**ALL 唯一条目 = 32 项**，其余为域子集，有重叠——旧口径「27/37 接入」「合计 40+ 项」均已过时，2026-10-08 复核实测修正）。统计口径：**只数 `tool: "X.ts"` 条目，注释里提名字不算**（2026-10-08 实测踩坑：子串匹配会把注释里的 `check-*.ts` 计入，虚高）。判定「真阻断」看该清单项 `blockPolicy`，FAIL 非空 ≠ 被拦。
  - 2026-10-08 门禁清单对账（锐评复核）处置：补挂 `check-comment-history` / `check-twin-siblings` / `check-unread-fields`（ALL，debt）+ `check-go-coverage-threshold`（GO，debt）；`check-diff-coverage` **刻意挂起**——依赖前端 coverage-final.json 与 diff 基线 ref，本地无覆盖率会 rc=2 恒红（假阻断），正确归宿是 CI vitest --coverage 之后。判定「真阻断」看该清单项 `blockPolicy`，FAIL 非空 ≠ 被拦。
- **审计留痕**：逃生阀命中分两级——`YSM_SKIP_GATE=1` 与 `YSM_SKIP_*` 命中写 `.git/gate-audit.log`（SKIPPED/PUSH 行，可审计）；`git commit --no-verify` / `git push --no-verify` 整钩不跑，零痕迹，只能靠 CI 远端拦截与 `doctor --audit-check` 对账事后回溯。

## 门禁块写法范式（gate-blocks vs commit-blocks，2026-10-06 摸底）

两类「块」是**同一壮大的两种形态**，弄清各自写法才能延续：

| 维度 | gate-blocks（pre-push 侧） | commit-blocks（pre-commit 侧） |
|------|---------------------------|-------------------------------|
| 服务对象 | `pre-push-gate.ts` 调度器（import 调用） | pre-commit 钩子（CLI 直接调用） |
| 入口形态 | **无独立 CLI**，导出函数供调度器 import | **独立 CLI**（`isCli` 判定 + `main()`），sh 钩子直接 `node` |
| 结果落账 | `ctx.record()` 统一入 `results[]`（label/ok/time/note/tail/raw/blockPolicy） | `console.log`/`console.error` 直通终端（无统一账目） |
| 判定方式 | `parseToolOutput()` 三级优先级：`_summary.ok → errors===0 → rc`——**退出码不可靠**，审计类工具恒 0 | 直接判 rc / 壳层判退出码 |
| 阻断语义 | `blockPolicy` 三分（hard 阻断 / debt 记债 / failClosed 工具不可用才阻断），FAIL 明细带归属标签 | 非阻断为主（`|| true`），三段硬阻断留在 shell（exit 1） |
| 清单驱动 | `GateTool[]` 数组驱动（`gate-config.ts` 单一事实源） | 硬编码分块（无清单层） |
| 执行安全 | 数组式 `procRun`（防 shell 注入）；`sh()` 只接受源码常量命令 | 无注入面（纯逻辑 + git 子进程） |

**为什么形态不同是合理的**：gate-blocks 服务「调度器统一汇总→生成报告→判定推送」，必须落账；commit-blocks 服务「钩子内联即时输出→stderr 直达终端（AI 必看通道）」，直通即可。**同类加入共识**：

1. **「纯判定 + 渲染分离」是两侧共同底线**（gate-blocks 的 parseToolOutput / commit-blocks 的 detectVersionDefense 都是纯函数 + 独立渲染）——判定可单测是硬要求，形态差异只在落账/输出层。
2. **新块先问服务对象**：被调度器编排 → 按 gate-blocks 写（函数导出 + record + blockPolicy）；被钩子直调 → 按 commit-blocks 写（CLI + 纯判定导出 + 契约测试）。
3. **执行安全是 gate 侧红线**（数组式 procRun），commit 侧无 shell 拼接面故豁免——但 commit-blocks 一旦出现「拼命令串」就必须升级为数组式（同 gate-ctx 不变式）。

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