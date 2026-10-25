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
    - BLOCKING_RULES
    - blocksCommit
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
  - "刀2（2026-10-25 起）**只阻断 BLOCKING_RULES 白名单内的两条**（subject-empty / subject-prefix），不是「severity=hard 即拒」——subject-length / subject-multi-topic / body-line-length 仍是 hard 档判定但**不拒提交**，只提示。看到 --strict 别以为全拒"
  - "存量（闸上线前 300 条窗口）约 47% 提交不符合结构判据——闸只判新提交，不追溯历史（重写历史 commit message 是 ADR-080 禁令）。闸上线后新提交合规率已升至 81%，两组数字的对照见正文「闸上线后的对照」节"
  - "阻断与 severity 是两件事：severity 是规则的固有档位（决定它算 hard 还是 warn），阻断与否由 `blocksCommit()` + `BLOCKING_RULES` 决定。**禁止再写 `v.severity === \"hard\"` 当阻断条件**——那会让扩员/收窄绕开白名单"
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
| 结构 | subject 非空且 ≤72 码点；须 `<type>[(scope)][!]: ` 前缀；单主题（` + ` ≥2 **或编号项 ≥2** 判并联）；正文单行 ≤120 码点 | hard（其中 subject-empty / subject-prefix **阻断**，其余只提示） |
| 台账 | 验证报告腔 / `YSM_SKIP_*` / "并行会话"入正文；body 行数 >20 | warn |
| 豁免 | `Merge` / `Revert` / `fixup!` / `squash!` / `amend!` 直放且不触发任何判据 | — |

**单主题判据的两个信号**（2026-10-14 补洞）：` + ` ≥2 是原始信号；**编号项 ≥2**（`P0-1`/`S1-2`/圈码）是补的第二个——实测 `fix(repository): …四项修复落地——P0-1 …、P1-1 …、P1-2 …、P1-3 …` 用顿号枚举编号，` + ` 一次不出现，原先只被判「超长」，多主题性质漏判（只靠长度会放过「70 字符的四项并联」）。
补洞时踩到的两个假阳性，均已钉进契约测试：**ADR/RFC 引用**（「落实 ADR-338-d1 与 ADR-339 的裁定」是引用既有决策，非待办并联）须先剔除；**中文顿号本身不判**（「治满载假红、非掩盖」只有一个主题，按顿号计数会大面积误伤，故判据只认编号式）。

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
| **结构 hard 合计** | — | **170** | **57%** |
| **仅 warn 命中** | — | 65 | 22% |
| **完全合规** | — | 107 | 36%（含豁免行） |

subject 码点分位：中位 **70**、p90 **160**、p95 **381**、max **869**。

结论：**阈值不打人，打的是形式**——中位 70 说明自然写作本就可达标，超限者全是台账堆叠。

> 上表是**刀1 上线前的校准窗口**，保留作历史对照。2026-10-25 刀2 开闸时重跑同一口径（`--replay 300`，合规 162 条）得：subject-length 105(35%)、subject-multi-topic 28(9%)、ledger-verification 16(5%)、ledger-parallel 6(2%)、body-line-length 6(2%)、subject-prefix 4(1%)、body-length 3(1%)、ledger-skipvalve 1(0%)；结构 hard 合计 124 条(41%)。**刀2 阻断集只命中 4 条(1%)，且 4 条全为真阳性**（缺常规前缀）——这就是「阻断集取 subject-empty + subject-prefix、不取全部 hard」的数据依据。

## 闸上线后的对照（关键证据：闸在 warn 档已生效）

刀1 上线（`d6d854e67`）之后又攒了 16 笔提交，同一 `--replay` 口径复算——**这是判断「要不要转 hard」的直接依据**：

| 指标 | 上线前（300 条窗口） | 上线后（16 笔） | 趋势 |
|------|-------------------|---------------|------|
| 合规率 | 36% | **81%** | 🟢 |
| subject 中位 | 70 | **53** | 🟢 |
| subject p90 | 160 | **80** | 🟢 |
| subject max | 869 | **95** | 🟢 |
| 转 hard 会被拒 | 57% | **19%（3 笔）** | 🟢 |

**结论：warn 档本身就在改行为**（中位降 24%、max 降 89%），不必靠 hard 才有约束力。3 笔超限里只有 1 笔是台账并联（`e3c0730c4`，现已能被正确识别），另 2 笔是**单主题只是偏长**（74/80 字符）——硬拒这种会让闸显得在「数长度」而非「治台账」。

**转 hard 的决策口径**（本卡给判据，不给结论——样本会变）：
- 门槛：**≥30 笔**上线后样本（16 笔不足以定档，3 笔里的构成一变比例就跳）
- 前提：`--replay N` 的 hard 命中里，**台账类（并联/前缀）占比高于纯长度类**
- 代价：并行会话期硬拒会拦住他人合理提交，故转档前须确认逃生阀留痕链路（`YSM_SKIP_COMMIT_MSG`）在真实会话里跑通

## 对外 API / 入口

三入口共用一个 CLI（`scripts/check-commit-message.ts`）+ 一个纯判定内核（`scripts/_lib/commit-blocks/commit-message.ts`，ADR-323 范式）。

| 入口 | 命令参数 | 场景 | 退出码 |
|------|---------|------|--------|
| commit-msg 钩子 | `--file "$1" --strict` | 每次 commit；**刀2 起阻断集内违规 → 拒提交**（rc=1），rc=2 判不了则放行交推送侧复验 | 0 放行 / 1 阻断 / 2 判定不可用（钩子内放行） |
| pre-push 双挂 | `--range auto --strict` | gate-config 条目 `{ tool: "check-commit-message.ts", args: ["--range", "auto", "--strict"], blockPolicy: "hard" }` | 0 合规 / 1 阻断集违规 / 2 不可用 |
| 历史校准 | `--replay <n> [--limit N]` | 只读分析分布（`--limit` 试不同 subject 上限），不写库 | 0 恒 |

`--strict` 只开关是否**阻断**，不改变**判定结果**（`renderViolations(warn) !== renderViolations(hard)`，但 `evaluate(m, { mode: "warn" }) === evaluate(m, { mode: "hard" })`——这就是 ADR-338-d1 D3 两步走的结构前提：翻开关，不改规则）。

### 阻断集（刀2 的核心机制）

```ts
export const BLOCKING_RULES: ReadonlySet<RuleId> = new Set<RuleId>(["subject-empty", "subject-prefix"]);
export function blocksCommit(vs: readonly Violation[]): boolean {
  return vs.some((v) => BLOCKING_RULES.has(v.rule));
}
```

**为什么不是「severity === hard 即阻断」**：severity 是规则的固有属性（口径），阻断是运营策略（闸门）。两者绑死后，任何一次调档都会同时改动口径与闸门，且 `--replay` 的 `hardHits` 会失去「结构性违规存量」这个诊断含义。分开后 `ReplaySummary` 同时报 `hardHits`（结构违规总数）与 `blockHits`（刀2 实际会拒数），**差值就是「有结构问题但当前不拒」的存量**，是下次扩员的观察窗口。

阻断集当前只有两条的实证理由：`subject-empty` 是硬性事实错误（没有 subject），`subject-prefix` 的修法是一行加 `fix: ` 前缀——**确定性、零歧义、可当场改**。而 `subject-length`（replay 300 命中 35%）多为「单主题只是偏长」，硬拒会让闸显得在数长度而非治台账。扩员必须先跑 `--replay` 并说明新增项为何同样确定性；`tests/test_commit_message_gate.ts` 有扩员守卫断言，只允许这两条在集合内。

钩子层的 rc 分流是这一机制的落地形态：**rc=1（阻断集命中）→ exit 1 拒提交；rc=2（判不了）→ 放行**。理由：环境坏时若也拒，谁都提交不了且改不动仓（连修钩子本身都提交不了）；fail-closed 的兜底放在推送侧——`--range auto --strict` 会对整段未推送提交复验，钩子被 `--no-verify` 绕过也逃不掉。


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
3. **阻断面由 `BLOCKING_RULES` 白名单决定，不由 severity 决定**（2026-10-25 刀2 起）：`.githooks/commit-msg` 带 `--strict`、`gate-config.ts` 条目 `blockPolicy: "hard"`，但**真正拒哪几条**只看 `BLOCKING_RULES`。调用方一律走 `blocksCommit(vs)`；禁止再写 `v.severity === "hard"` 当阻断条件（会让扩员/收窄绕开白名单，`test_commit_message_gate.ts` 有扩员守卫）
4. **fail-closed 只对推送侧成立**：`scripts/check-commit-message.ts` 在 message 文件读不到、git 不可用、range 不可解析时退出码 2（"不可用"≠"通过"），绝不冒充合规。**钩子层对 rc=2 放行**（环境坏 = 谁都提交不了且连修钩子本身都提交不了），兜底靠推送侧 `--range auto --strict` 复验
5. **双挂不可单点**：`.githooks/commit-msg` 钩子可被 `git commit --no-verify` 整钩绕过（零痕迹），必须同时挂入 `scripts/_lib/gate-config.ts` 的 `ALL_STATIC_TOOLS` 走 `--range auto` 在推送时复验。两条防线缺任何一条 = 单点 (仓内既有的"只减不增型闸一律双挂"不变量)
6. **`--range auto` 自证可达**：浅克隆（`--depth=1` fetch）下 `HEAD~1` 不可解析 -> 退 `origin/main..HEAD` merge-base；仍然不可解析（单提交仓）-> 返回 `HEAD`（即自己）。**绝不**把不可解析的 range 丢给 `git log` 让 git 报错冒充违规 (浅克隆教训)

## 相关

- [ADR-338-d1 提交信息减负：commit-msg 闸与 trailer 出口](../adr/decisions/ADR-338-d1-commit-message-hygiene.md) — 决策全文（背景 / 决策 / 后果 / 不做 / 双挂 / trailer 白名单）
- [门禁链全景图 (gate-chain-map)](./gate-chain-map.md) — commit-msg 在四入口横向归属中的位置
- [ADR-323 钩子薄壳 + blocks 范式] — 本闸的纯判定层文件 `scripts/_lib/commit-blocks/commit-message.ts` 所在结构
- [ADR-232 D2] — `YSM_SKIP_COMMIT_MSG` 命中后复用 `hook-audit.ts` 写 `SKIPPED_PRECOMMIT` 留痕
- [ADR-151] — 并发隔离：并行会话期第一刀 hard 会把他人提交一起卡住，是刀1 不阻断的根由
- `tests/test_commit_message_gate.ts` — 契约测试（31 条，涵盖纯判定、CLI 集成、钩子静态接线与 rc 分流、阻断集扩员守卫、门禁入册）
