# ADR-338-d1：提交信息减负：commit-msg 闸与 trailer 出口

- **状态**：✅ 已采纳
- **日期**：2026-10-13
- **决策人**：用户（三岔口拍板：挂 338 子编号 / subject 上限 72 / warn→校准→hard 两步走）
- **关联主 ADR**：ADR-338（文档减负——同一病灶：每一层都在写台账）
- **关联**：ADR-323（钩子薄壳 + blocks 范式）、ADR-232 D2（逃生必留痕）、ADR-151（并发白名单提交）

## 背景

提交信息层是仓内**唯一零执法的产物层**。实测最近 300 条提交（可复算，口径见
`commit-message-gate.md` §测量）：

| 维度 | 实测 |
|------|------|
| subject 长度 | 均 **105** 字符，中位 71，最长 **869**，**47%（142/300）超 72** |
| body | 22% 有正文；9 条超 20 行，最长 33 行 |
| 台账腔 | ~14% 含验证报告腔（全绿/typecheck/build/biome/单测数）；3 条写 `YSM_SKIP` 理由；6 条写「并行会话」归属 |
| 一致性 | 2 组重复 subject（同 message 不同内容）；ADR-072 / ADR-080 各留一处「⚠️ 归属纠正」实证 message 与内容漂移 |

结构性缺口三条：

1. **`.githooks/commit-msg` 从未存在**——42 个 `check-*.ts` + pre-commit 三段硬阻断
   + prepare-commit-msg 四个提示脚本，无一校验信息本身。
2. **CONTRIBUTING.md §提交规范只有 type 表**，无长度判据、无单主题判据、无内容归属判据
   → 规范存在但无执法，等于没有。
3. **诉求没有出口**：ADR-086 把「验证留痕不进 message 就难以从 git log 追踪」当成问题陈述
   ——「想说」是真需求，「用散文说」是错形式。

关键取舍认知：**长 message ≠ 可信 message**。20 行台账里第 3 行声称改了 X，无人核得动；
减负不是少说话，是**把话换成可核对的形式**。

## 决策

### D1 — 新增 commit-msg 闸，判定与渲染分离（ADR-323 范式）

`.githooks/commit-msg` 薄壳 → `scripts/check-commit-message.ts`（CLI）
→ `scripts/_lib/commit-blocks/commit-message.ts`（纯判定 + 独立渲染）。
**fail-closed**：解析失败 = error，绝不冒充通过。

### D2 — 判据分层（hard 拦结构，warn 采噪音）

| 层 | 规则 |
|----|------|
| 结构（hard） | subject 非空且 ≤72 码点；须 `<type>[(scope)]?!?:` 前缀；单主题（` + ` ≥2 次判并联）；正文单行 ≤120 |
| 台账（warn） | 验证腔关键词 / `YSM_SKIP` / 「并行会话」入正文；body >20 行 |
| 豁免 | `Merge ` / `Revert ` / `fixup!` / `squash!` / initial commit 直放 |

72 取值理由：中位 71 = 自然写作本可达标，超限者全是台账堆叠——**阈值不打人，打的是形式**。

### D3 — 两步走：warn 采集 → 数据定档 → hard

第一档只打 stderr 不阻断，并用 `--replay <n>` 只读复算历史命中率定 hard 集实际杀伤；
连续 ≥15 次真实提交零误伤后方可转 hard。**并行会话期第一刀就 hard 会把他人提交一起卡住。**

### D4 — 双挂防单点绕过（仓内既有不变量）

「只减不增型闸一律双挂」：commit-msg 钩子拦提交 + `_lib/gate-config.ts` 静态清单走
`--range` 拦推送/CI。逃生键 `YSM_SKIP_COMMIT_MSG=1` 命中复用 `_lib/hook-audit.ts`
写 `SKIPPED_PRECOMMIT` 留痕（不新造审计通道）。

### D5 — 台账诉求改走 trailer 字段（白名单，一行一字段）

`Verification:` / `Refs:` / `Knowledge:` / `Skip-Evidence:` / `Parallel-Scope:`。
理由：字段可被机器聚合（「本周多少提交带 Skip-Evidence」），散文不能——
**留痕需求与减负目标在此不冲突，冲突的只是载体**。

## 后果

- **正面**：提交信息首次具备执法；`git log --oneline` 恢复可读；message 与内容的可核对性上升
  （短 subject 才核得动）；验证/逃生/归属三类留痕从散文变可 grep 字段。
- **成本**：每提交多一次秒级判定（纯字符串，无 IO 重活）；作者需把台账内容分流到
  知识卡（结论）/ trailer（证据），不是一删了之。
- **边界**：本 ADR 不治 diff 规模（>20 文件仅提示，挂 commit-with-check 侧）；
  不重写历史（存量 47% 超长不受影响，见「不做」）。

## 不做

- **不重写历史 message**（承 ADR-080 惯例：commit message 是历史记录，只以文档确权）。
- 不追溯存量、不做全库基线——判定域 = 本次提交 / 本次推送集（对齐 ADR-256 行级口径教训：
  键不带行号，判决域不越界到他人未提交内容）。
- 不动 prepare-commit-msg 四个 hint（职责不同：那几个讲代码，本闸讲信息）。

<!-- 文件名: commit-message-hygiene.md → 实际文件 decisions/ADR-338-d1-commit-message-hygiene.md（ADR-320 decisions 轻量模板） -->
