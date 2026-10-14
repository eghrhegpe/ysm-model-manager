---
kind: commit-message-gate
name: 提交信息减负闸
tier: architecture
category: config
status: active
source_files:
  - scripts/check-commit-message.ts
  - scripts/_lib/commit-blocks/commit-message.ts
  - .githooks/commit-msg
auto_fields:
  symbols_with_lines:
    - BODY_LINE_LIMIT
    - BODY_LINES_WARN
    - evaluate
    - EvaluateOptions
    - measureSubjectLen
    - parseCommitMessage
    - ParsedMsg
    - renderViolations
    - ReplayRow
    - ReplaySummary
    - RuleId
    - Severity
    - SUBJECT_LIMIT
    - summarizeReplay
    - Trailer
    - TRAILER_KEYS
    - Violation
invariant_anchors:
  - scripts/_lib/commit-blocks/commit-message.ts|measureSubjectLen
  - scripts/_lib/commit-blocks/commit-message.ts|CONVENTIONAL_TYPES
  - scripts/_lib/commit-blocks/commit-message.ts|TRAILER_KEYS
  - .githooks/commit-msg|YSM_SKIP_COMMIT_MSG
use_when:
  - 提交信息超长或主体跑偏的规则不清楚
  - 想了解提交信息减负闸的判据和豁免条件
  - 需要在 message 里放验证报告/逃生记录/决策出处，但不知道用哪个 trailer 字段
pitfalls:
  - "刀1（采集期）恒不阻断，仅 stderr 提示。转 hard 需先跑 `--replay 300` 出硬数据，且连续 ≥15 次真实提交无误伤"
  - "47% 存量提交符合结构上的「违规」标准——闸只判新提交，不追溯历史（重写历史 commit message 是 ADR-080 禁令）"
  - "采集期 gate-config 条目 blockPolicy: 'debt'——不阻断但会在 CI/pre-push 留下记录。转档时只改两处：钩子加 --strict + gate-config 改 'hard'"
quick_groups:
  - 门禁与脚本
quick_intents:
  - 提交信息的减负规则是什么
quick_risk_lines:
  - "`--replay N` 只读历史不写库；`--file` 只在钩子内被调用；`--range auto` 在推送时双挂复验"
  - "`YSM_SKIP_COMMIT_MSG=1` 跳过钩子，但通过 hook-audit 写 SKIPPED_PRECOMMIT 留痕——`--no-verify` 整钩不跑，零痕迹（故 gate-config 另有 --range 第二重）"
---

# 提交信息减负闸

## 概览

提交信息减负闸（ADR-338-d1）是仓内**首个校验提交信息本身**的自动化门禁。此前 42 个 `check-*.ts` 脚本 + pre-commit 三段硬阻断 + 四个 prepare-commit-msg 提示脚本，无一校验 message 本身的结构与内容。

三条结构性缺口决定了它的必要性：

1. **`.githooks/commit-msg` 不存在**——仓内最完整的门禁链，惟独缺了这一环
2. **CONTRIBUTING.md 只有 type 表**——长度、单主题、内容归属判据全部没有
3. **诉求没有结构化出口**——验证报告、逃生理由、并行会话归属等"留痕"需求本应走 trailer，但没有字段就各自发明散文格式，导致 subject 47% 超 72 字符、最长 869 字符

它与 [ADR-338 文档减负](../adr/architecture/ADR-338-docs-burden-reduction.md) 治的同一个病：**每一层都在写台账**。

## 核心职责

| 层 | 判据 | 档位 |
|----|------|------|
| 结构 | subject 非空且 ≤72 码点；须 `<type>[(scope)][!]: ` 前缀；单主题（` + ` ≥2 判并联）；正文单行 ≤120 码点 | hard |
| 台账 | 验证报告腔 / `YSM_SKIP_*` / "并行会话"入正文；body 行数 >20 | warn |
| 豁免 | `Merge` / `Revert` / `fixup!` / `squash!` / `amend!` 直放且不触发任何判据 | — |

计值口径（`scripts/_lib/commit-blocks/commit-message.ts|measureSubjectLen`）：**按码点数**（`Array.from(s).length`）。CJK 一字 1 码点、emoji 一个字符 1 码点（UTF-16 surrogate pair 算 2 是 Node.js 长度实现细节，不是度量口径——闸要治的是"一句话说几件事"，与 UTF-16 编码无关）。

## 历史实证（replay 300）

以下分布基于最近 300 条 `--no-merges` 提交的只读复算（`--replay 300`），即刀2 转 hard 的直接校准依据：

| 规则 | 档位 | 命中提交数 | 比例 |
|------|------|-----------|------|
| subject-length | hard | 142 | 47% |
| ledger-verification | warn | 63 | 21% |
| body-line-length | hard | 41 | 14% |
| subject-multi-topic | hard | 31 | 10% |
| body-length | warn | 15 | 5% |
| ledger-parallel | warn | 9 | 3% |
| subject-prefix | hard | 5 | 2% |
| ledger-skipvalve | warn | 4 | 1% |
| **转 hard 后会被拒** | — | **170** | **57%** |
| **仅 warn 命中** | — | 65 | 22% |
| **完全合规** | — | 107 | 36%（含豁免行） |

subject 码点分位：中位 **70**、p90 **160**、p95 **381**、max **869**。

结论：**阈值不打人，打的是形式**——中位 70 说明自然写作本就可达标，超限者全是台账堆叠。

## 对外 API / 入口

三入口共用一个 CLI（`scripts/check-commit-message.ts`）+ 一个纯判定内核（`scripts/_lib/commit-blocks/commit-message.ts`，ADR-323 范式）。

| 入口 | 命令参数 | 场景 | 退出码 |
|------|---------|------|--------|
| commit-msg 钩子 | `--file "$1"` | 每次 commit，刀1 不带 `--strict` 恒 0 | 0（采集期） |
| pre-push 双挂 | `--range auto --strict` | gate-config 条目 `{ tool: "check-commit-message.ts", args: ["--range", "auto"] }`（刀1 debt，刀2 hard） | 0 合规 / 1 hard 违规被拒 / 2 不可用 |
| 历史校准 | `--replay <n> [--limit N]` | 只读分析分布（`--limit` 试不同 subject 上限），不写库 | 0 恒 |

`--strict` 只开关是否**阻断**，不改变**判定结果**（`renderViolations(warn) !== renderViolations(hard)`，但 `evaluate(m, { mode: "warn" }) === evaluate(m, { mode: "hard" })`——这就是 ADR-338-d1 D3 两步走的结构前提：翻开关，不改规则）。

## Trailer 白名单（ADR-338-d1 D5）

| 旧散文位置 | 应替换为 | 示例 |
|-----------|---------|------|
| 验证报告 | `Verification:` | `Verification: 8358 unit + 6 e2e green` |
| 决策出处 | `Refs:` / `Knowledge:` | `Refs: ADR-336`, `Knowledge: app-tree.md` |
| 逃生理由 | `Skip-Evidence:` | `Skip-Evidence: YSM_SKIP_DESIGN_TOKENS 存量位移` |
| 并发归属 | `Parallel-Scope:` | `Parallel-Scope: context-menu 三文件属并行会话` |

trailer 段以空行与正文分隔，每条一行。Git 原生支持这些字段（`git log --format=%(trailers)` 可提取）。**"留痕"与"减负"在此不冲突，冲突的只是载体。**

## 不变量

1. **计量口径不可分岔**——全仓唯一 subject 长度走 `measureSubjectLen`（`Array.from(s).length`），不用 String.length（UTF-16 代理对、UTF-8 字节数各有坑且不反映"一句话的长度"）
2. **判定与渲染永久分离**（ADR-323 判据①）——`evaluate()` 只返回 `Violation[]`，不涉及 stderr/stdout/exit code；`renderViolations()` 只消费 `Violation[]` 和 `mode`，不重算；此结构由 `test_commit_message_gate.ts` 的 `"render：mode 不改变判定结果"` 契约测试锁死
3. **刀1 到刀2 的转档路径只改两处**：`.githooks/commit-msg` 加 `--strict`；`scripts/_lib/gate-config.ts` 对应 `blockPolicy: "debt" → "hard"`。`scripts/_lib/commit-blocks/commit-message.ts` 一行不动——规则是固定口径，是否阻断是开关
4. **fail-closed**：`scripts/check-commit-message.ts` 在 message 文件读不到、git 不可用、range 不可解析时退出码 2（"不可用"≠"通过"），绝不冒充合规
5. **双挂不可单点**：`.githooks/commit-msg` 钩子可被 `git commit --no-verify` 整钩绕过（零痕迹），必须同时挂入 `scripts/_lib/gate-config.ts` 的 `ALL_STATIC_TOOLS` 走 `--range auto` 在推送时复验。两条防线缺任何一条 = 单点 (仓内既有的"只减不增型闸一律双挂"不变量)
6. **`--range auto` 自证可达**：浅克隆（`--depth=1` fetch）下 `HEAD~1` 不可解析 -> 退 `origin/main..HEAD` merge-base；仍然不可解析（单提交仓）-> 返回 `HEAD`（即自己）。**绝不**把不可解析的 range 丢给 `git log` 让 git 报错冒充违规 (浅克隆教训)

## 相关

- [ADR-338-d1 提交信息减负：commit-msg 闸与 trailer 出口](../adr/decisions/ADR-338-d1-commit-message-hygiene.md) — 决策全文（背景 / 决策 / 后果 / 不做 / 双挂 / trailer 白名单）
- [门禁链全景图 (gate-chain-map)](./gate-chain-map.md) — commit-msg 在四入口横向归属中的位置
- [ADR-323 钩子薄壳 + blocks 范式] — 本闸的纯判定层文件 `scripts/_lib/commit-blocks/commit-message.ts` 所在结构
- [ADR-232 D2] — `YSM_SKIP_COMMIT_MSG` 命中后复用 `hook-audit.ts` 写 `SKIPPED_PRECOMMIT` 留痕
- [ADR-151] — 并发隔离：并行会话期第一刀 hard 会把他人提交一起卡住，是刀1 不阻断的根由
- `tests/test_commit_message_gate.ts` — 契约测试（27 条，涵盖纯判定、CLI 集成、钩子静态接线、门禁入册）
