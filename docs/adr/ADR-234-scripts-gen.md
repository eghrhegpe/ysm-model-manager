# ADR-234：scripts 治理三项软门禁：注释考古 / gen 并行 / 肥膘告警

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/check-comment-history.ts`（新建）/ `.githooks/pre-commit` L97-101 / `scripts/check-file-lines.ts` / `scripts/_lib/gen-cmds.ts` / `docs/adr/ADR-232-scripts-hooks.md`（前序）

---

## 1. 背景（Context）

ADR-232 已根治 scripts+hooks 的并发竞态 / 审计留痕 / 退化降级三处 🔴 病灶。本 ADR 承接其遗留的三项 🟡 治理项（锐评分级 P2-1/P2-2/P2-3），均为「可读性随时间递减 / 单次 commit 隐藏成本」类慢性债，非正确性缺陷——故设计原则统一为**软门禁 + 观察期**，不阻断（阻断留给真回归红线）。

| 病灶 | 现状实证 | 不修的代价 |
|---|---|---|
| **P2-1 注释考古** | `scripts/` + `.githooks/` 内「锐评 #N / code_review #N / 缺陷#N」裸评审引用 ~28 处、10 文件（`pre-push-gate.ts` 8 处最多）；新读者无从知「锐评 #1」指哪次评审 | 评审过程沉淀进代码，可读性随锐评次数单调递减；违反 AGENTS.md「ADR 记方向，代码记结论」的镜像原则 |
| **P2-2 gen 串行** | `.githooks/pre-commit` L97-101 逐条 `node scripts/$line` 串行 15 个 gen，实测全量 ~2-4s，且**每次 commit 全量重跑**（哪怕只改一个 Go 文件） | 每次 commit 隐藏 2-4s 成本；10+ 并发会话共享 checkout 时放大 |
| **P2-3 _lib 肥膘无门禁** | `check-file-lines` 现仅 1 条 RULES（前端 mount-preview-core 1045 行硬阻断）；`_lib` 最大 `contract-tests.ts` 589、`scripts` 最大 `check-knowledge-drift.ts` 923，均无门禁 | 共享层失去「薄」特性，胖到不可拆时无告警触发拆分 |

## 2. 决策（Decision）

三项统一「**软门禁 + 观察期，WARN 非阻断**」，先让门禁可见、量化病灶，后续按告警量决定是否升级阻断：

### D1 注释考古门禁（新建 `check-comment-history.ts`）

- 扫描 `scripts/**/*.ts` + `.githooks/*`，正则匹配裸评审引用：`(锐评|code_review|缺陷)\s*#`（含「重锐评 #」变体）。
- **判定**：命中且所在行**不含** `ADR-\d+` 锚点 → 记为「考古引用」（裸引用，无可追溯决策依据）。
- **输出**：`--json` 按 `_summary` 契约（`count` + 逐条 `file/line/match`）；默认非阻断 `exit 0`，仅 `console.warn` 汇总（观察期）。`--strict` 时 `exit 1`（未来升级路径）。
- **为何不阻断**：历史注释是已冻结的既有代码，批量重写回归面大；先观察新增速率（每次 commit 看 count 是否单调增），确认稳定后切 `--strict`。

### D2 gen 并行（改 `.githooks/pre-commit`）

- **前提核实**（本 ADR 数据溯源）：15 个 gen 的输出文件逐一核对（`docs/adr/index.md`、`docs/event-graph.md`、`docs/knowledge/index.md`、`docs/novel/index.md`、`sidebar.gen.mjs`、各知识卡自动段、`routes.md`/`routes-quick.md`、`cli-commands.md`、`completions/`、`locales/`），**两两互不重叠** → 并行写盘安全。
- 改法：`node scripts/$line` 串行 `while` 循环 → `xargs -P3 -I{} node scripts/{} >/dev/null 2>&1`，限并发 3（防 15 个 node 进程同时冷启吃满 CPU；3 是经验值，后续可提至 CPU 核数/2）。
- **stage 判定不受影响**：`gen-stage.ts` 读的是 gen **前**采集的 `GEN_PORCELAIN` 快照 + gen **后**的 `GEN_SNAP` mtime 快照，不依赖 gen 串行顺序。
- 契约测试：新增 `tests/test_gen_parallel.ts`，断言 15 个 gen 的 `write` 目标文件集合**两两不相交**（互斥不变量守护，防止未来新增 gen 写同文件后并行不安全）。

### D3 _lib/scripts 肥膘告警（扩展 `check-file-lines.ts`）

- 现有 `RULES` 是「精确文件 + 超限硬阻断」。新增**独立扫描段**（不动原 RULES 语义）：
  - `scripts/_lib/*.ts` > 400 行 → WARN
  - `scripts/*.ts`（顶层，不含 `_lib`）> 700 行 → WARN
- **为何 WARN 非阻断**：当前 `check-knowledge-drift`（923）/`check-redlines`（885）等 5 个 files 已超 700，若直接硬阻断会立刻阻断本次及后续 pre-push，违反「小步快跑」且非本次目标。先 WARN 列出全量超限文件，作为拆分排期的量化依据。
- **为何不并入现有 RULES 循环**：RULES 是 `exit 1` 语义，glob 扫描段是 `exit 0` 语义，两套混合会污染 `_summary` 契约（gate 读 `violations` 计数做判定）。独立段独立输出 `advisories` 字段。

## 3. 后果（Consequences）

- ✅ **正面**：三项病灶全部「可见」——考古引用 count 单调可观测；gen 耗时从 2-4s 降至 ~1s（3 并发）；肥膘文件有 WARN 清单驱动拆分排期。
- ⚠️ **负面 / 风险**：
  - D1：`--strict` 未启用，裸引用仍会继续累积——门禁只是「量体温」不是「治病」。治愈需人工把考古引用改写为「ADR-NNN 理由」（后续 ADR 排期，非本次）。
  - D2：`xargs -P3` 在 Windows Git Bash 下行为与 GNU xargs 一致（已用）；但若某 gen 失败（`node` 异常），原串行 `|| echo` 的单条失败提示会被 xargs 吞掉——改后统一 `xargs` 退出码非 0 时打一行「部分 gen 失败（不阻断）」。
  - D3：`advisories` 字段是新增 `_summary` 子键，gate 侧若读 `violations` 不受影响；但若未来有消费方读 `rules` 计数会多 0（未并入 RULES 循环，安全）。
- 🧊 **已知遗留**：D1 的「治愈」与 D3 的「拆分」本身都不在本次范围——本次只建门禁，不改存量。存量考古注释重写、超 700 行文件拆分，后续按告警量排新 ADR。

## 4. 数据溯源

| 来源 | 结果 |
|---|---|
| `grep -rc "锐评\s*#\|code_review\s*#\|缺陷\s*#" scripts/ .githooks/` | 10 文件 ~28 处；`pre-push-gate.ts` 8、`pre-commit` 4、`check-android-unavailable.ts` 3 |
| `wc -l scripts/_lib/*.ts` / `scripts/*.ts` | `_lib` 最大 589（contract-tests）；`scripts` 最大 923（check-knowledge-drift）、885（check-redlines）|
| 15 gen 输出路径逐一 grep（`OUT`/`OUT_PATH`/`writeFileSync` 目标） | 两两互不重叠 → D2 并行安全前提成立 |
| `.githooks/pre-commit` L97-101 | 串行 `while` 循环 15 条，实测全量 ~2-4s |
| `check-file-lines.ts` 全文 | 现仅 1 条 RULES（mount-preview-core 1045 硬阻断）；无 `_lib`/`scripts` 扫描段 |
