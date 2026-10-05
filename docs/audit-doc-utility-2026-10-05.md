# 文档实用性审计（只读）— 2026-10-05

> 审计员：分析子代理 | 方法：全仓 grep 引用面 + frontmatter 统计 + git 活跃度 + 与源码树对账
> **判据不是行数，而是「有没有真实读者 + 是否服务于当前工作」**
> 本报告为一次性快照，**不改任何文件**。

---

## 1. 总盘点表

| 目录/文件 | 文件数 | 行数 | 性质 | 结论 |
|---|---|---|---|---|
| `docs/adr/` | 329 | 22,695 | 决策史书（史书，勿删） | **保留**，但 12 份承担了规划/债务台账职能（4 处问题） |
| `docs/knowledge/` | 203 | 27,097 | 活文档体系（有机器校验） | **保留**，5 张 snapshot 卡违反自订归档规约 + 11 张零互链卡 |
| `docs/releases/` | 8 (+122 断言) | 5,014 | 发版记录（史书） | **保留**（有 `release-notes-gen.ts --check` 契约） |
| `docs/novel/` | 2 | 379 | 创作子项目 | 保留 |
| `docs/guide/` | 30 | 1,440 | 人类用户入口 | 保留（1 处形态错位） |
| `docs/archive/` | 12 | 1,140 | 冻结区 | 保留（1 处陈旧，见 §2.6） |
| `docs/plans/` | 4 | 386 | 规划 | **可精简**（与 ADR/知识卡三处重复） |
| `docs/drafts/` | 1 | 142 | 草稿 | 观察（活跃，非死档） |
| `docs/` 顶层 | 14 | 3,554 | 混合 | **5 处问题**（见 §2） |
| `docs/upstream-pr/` | 1 | 75 | 一次性 PR 材料 | 可归档 |

**顶层 14 个 .md 明细**（行数 / 非 dist 引用文件数 / 性质 / 最近提交）：

| 文件 | 行数 | 引用 | 性质 | 最近提交 | 结论 |
|---|---|---|---|---|---|
| `UI-Design.md` | 734 | 19 | 人类入口+机器契约 | 2026-10-05 (17) | 保留（唯一 UI 规范） |
| `architecture.md` | 733 | 21 | 人类入口+快照 | 2026-10-05 (38) | **可精简**（见 §2.1） |
| `cli-commands.md` | 389 | 12 | 生成物（机器契约） | 2026-09-19 (16) | 保留（自动生成+奇偶校验） |
| `event-graph.md` | 370 | 8 | 生成物（机器契约） | 2026-10-05 (492) | 保留 |
| `preview-menu-overview.md` | 320 | 1 | 人类入口 | 2026-10-05 (2) | 保留（**已自订"不写快照数字"纪律**） |
| `audit-water-critique.md` | 284 | 4 | 快照报告 | 2026-10-05 (14) | **可精简**（见 §2.3） |
| `audit-postprocessing-critique.md` | 263 | 1 | 快照报告 | 2026-10-05 (5) | **可精简**（见 §2.3） |
| `audit-env-review.md` | 118 | 3 | 快照报告 | 2026-10-05 (24) | 可合并 |
| `audit-src-map.md` | 106 | 7 | **生成物** | 2026-09-26 (3) | 保留（`gen-project-map.ts`） |
| `audit-env-design-critique.md` | 99 | **0** | 快照报告 | 2026-10-05 (3) | **可动**（见 §2.2） |
| `VitePress-maintenance.md` | 97 | 1 | 维护手册 | 2026-09-19 (5) | 保留 |
| `audit-ground-review.md` | 49 | 1 | 快照报告 | 2026-10-05 (2) | 可归档 |
| `index.md` | 49 | 4 | VitePress 首页 | 2026-09-08 (4) | 保留 |
| `.doc-next-steps.md` | 11 | 6 | **生成物** | — (0) | 保留（`gen-doc-next-steps.ts` 产出） |

---

## 2. 可动清单（按价值排序）

### 2.1 `docs/architecture.md` — 快照数字 + 死链 + 变更日志（判据 B）✅ **已落地 2026-10-05**

**三种 B 类病并举**，均已修（933→908 行）：

| 病 | 实证 | 处置 |
|---|---|---|
| 写死统计数字 | 三处称 `internal/app/` **29 文件 ~5700 行**；实测 **90 文件 / 16.5k 行**（错 3.1 倍）。同类：目录树内多处手写约数 | 删数 + 加「刻意不写死，要数字直接跑命令」声明；逐文件行数表删「行数」列（保留「文件→职责」映射） |
| 死链 | `docs/archive/architecture.md` 与 `docs/architecture-evolution-summary.md` 经 Test-Path 均 **False**（已被 `9086ea597`「删除过时文档」有意删档，引用未清） | 删两条引用行 |
| 承担变更日志职能 | 文末 31 行按日期提交记录表，与 git log / `docs/releases/` 完全重复；且正文自称「更新于 2026-08-10」却含 09-04 条目（自相矛盾） | **§14 整节删除** → 改「架构变动从哪看」（指向 git log / releases / adr 三个权威源） |

**保留**：架构树骨架（`check-doc-drift.ts` 的 `ARCH_DOCS` 校验对象，删不得）。
**验证**：`doctor --docs` 23/23 PASS（证明骨架完好）。

---

### 2.2 `docs/audit-env-design-critique.md` — 零外部消费者（判据 A）✅ **已归档 2026-10-05**

**实证**：全仓 **0 引用**（排除 `.vitepress/dist/` 与代码/脚本侧）。唯一提及它的 `audit-env-review.md`
是把它当**同批审计的兄弟报告**列在头部，非内容依赖。

**处置**：内容并入 `audit-env-review.md` **§5「设计层审：概念骨架」**（保留 F-1~F-5 裂缝表、F-1 证据表、
跨代承重说明、判据盲区、两次假绿灯自查），随后 `git mv docs/archive/`（git 识别为 rename，历史保留）。
归档件头部加「已归档 + 活文档指向」注记。
**验证**：归档前把 `audit-env-review.md` 内 3 处实质指向改为内部 §5 引用；`doctor --docs` 23/23 PASS。

---

### 2.3 四份 `audit-*-critique/review.md`（顶层 814 行）— 同一职能四份并列（判据 B：重复 + C：形态错位）

**为什么可动**：同一次「3D 环境系统锐评」拆成四份独立报告：
```
audit-water-critique.md          284 行  引用 4
audit-postprocessing-critique.md 263 行  引用 1
audit-env-review.md              118 行  引用 3
audit-ground-review.md            49 行  引用 1
audit-env-design-critique.md      99 行  引用 0  ← §2.2
```
它们互相引用成环（`audit-water-critique.md:8` 声明「与 `audit-env-review.md` §5/§6 不重复」、`:155/:163` 又指向 ground 与 env-design），**读者要读五份才能拼出一次审计的全貌**。

**证据 — 内容正在腐坏**：`audit-water-critique.md` 自带订正声明：
```
⚠️ 状态订正（2026-10-05）：本报告原称「至此 12 条全部处置完毕」——
经收敛核对，P2-1⑤ 源码未动，故实为 11 条已修 + 1 条未修。
文首汇总行误记为全清。
```
这是**快照报告承担了追踪职能导致自相矛盾**的典型。

**证据 — 承担规划职能**：P0/P1/P2 标记密度极高（`audit-water-critique.md` **44 处**、`audit-postprocessing-critique.md` **30 处**、`audit-ground-review.md` **11 处**）。按 `ADR-320` §决策，规划应在 plan/issue，不在文档。

**建议动作**：① 五份合并为一份 `docs/archive/env-system-audit-2026-10.md`（保留史书价值）；② **唯一有活消费者的部分**——`audit-water-critique.md` 被 `docs/knowledge/water.md:337` 与 `ADR-322` 引用、`audit-postprocessing-critique.md` 被 `preview-env-state.md:261` 引用——合并时把被引用的**不变量**提炼进对应知识卡（`water.md` / `preview-env-state.md`），把未收口项立 ADR。
**风险**：**中**。动前必须处理 4 处入链（`water.md:337`、`ADR-322:37`、`preview-env-state.md:261`、`ADR-292/305`）。**注意 `audit-water-critique.md` 正文自带警告「账⑤ 被 ADR-322 引用，勿改」——编号是硬引用锚点**。

---

### 2.4 `docs/knowledge/` 内 5 张 `status: snapshot` 卡 — 违反本仓自订归档规约（判据 A：已被取代）

**为什么可动**：`docs/knowledge/AGENTS.md:50` 明文规定：
> **快照卡终局 = 归档迁出**：`status: snapshot` 且不再被在途工作引用的一次性报告卡，`git mv docs/archive/`

**证据 — 规约已执行过一批，但这 5 张漏网**：
```
frontend-repo-audit.md      1444 行  status: snapshot  affected: false
frontend-design-critique.md  684 行  status: snapshot  affected: false
go-design-critique.md        302 行  status: snapshot  affected: false
frontend-test-audit.md       109 行  status: snapshot  affected: false
frontend-design-debt.md       83 行  status: snapshot  affected: false
```
共 **2,622 行**。`affected: false` 意味着它们**已退出 `--affected` 机器匹配**——即已不算活文档，却仍占着 `docs/knowledge/` 的机器卡槽位。

**旁证 — 仓内早已有此判断**：`scripts/_attic/analyze-knowledge-refs.ts:435` 写道：
> 「零互链卡 46 张中，`frontend-test-audit` / `cli-quality-audit` 等**审计报告型卡是历史快照，可归档**而非知识卡目录（卡目录保持「可导航的活文档」）」

**建议动作**：`git mv` 至 `docs/archive/`（保留史书）。**分批做，先做引用最少的 `frontend-design-debt.md`（83 行）与 `frontend-test-audit.md`**。
**风险**：**高（但有现成教训）**。`AGENTS.md:51` 记录了血案：迁 `optimization_log.md` 时**漏改 `go/cli/perf.go` 的代码侧硬编码路径，导致 44 个提交测试红**。本批实测代码侧硬编码：`internal/app/app_recycle_binding_test.go:7` 注释引 `go-design-critique`；`frontend/src/preview-3d/infra/gpu-load.ts:2` 注释引 `frontend-design-critique`；`tests/check-knowledge-hook.ts:69` 与 `tests/check-knowledge-fm-delimiter.ts:7` 都点名 `frontend-repo-audit`。**必须按 `AGENTS.md:51` 的「迁出前三查」执行**。

---

### 2.5 `docs/plans/` 4 文件 — 规划职能三处重复（判据 B）

```
diagnostics-dedup-audit.md     78 行  last=2026-10-04
diagnostics-log-capability.md  56 行  last=2026-09-20
light-volumetric-simplify.md   49 行  last=2026-09-16
UI-Design-Fix-Plan.md         203 行  last=2026-10-04
```
**证据 — 同一主题在三处**：`light-volumetric-simplify.md` 与 `ADR-246-light-volumetric-simplify.md`（状态 **🔄 部分采纳**，命中 §3 部分采纳清单）**同题同名**。规划内容同时散落在 ADR（`ADR-285-...-plan.md`）、`docs/plans/`、知识卡三处。

**建议动作**：将 `light-volumetric-simplify.md` 并入 ADR-246 的「遗留」节或知识卡；其余三份若仍活跃则保留，否则归档。
**风险**：**低**。`docs/plans/` 无脚本消费者。

---

### 2.6 `docs/archive/audit-drift-report-2026.md` — 冻结区内的陈旧数据（判据 B，低优先）

**证据 — 审计范围数字已过期**：
```
> 范围：`docs/knowledge/*.md` 共 186 张，抽查 40 张
```
实测 `docs/knowledge/` = **203 张**。差 17 张。

**建议动作**：**不动**（已在冻结区，史书属性）。仅记录：`archive` 在 `link-checker.ts` 的 `SKIP_DIRS` 内，**归档文档会静默腐坏、永不被检查**——这是体系设计代价，需知情。
**风险**：无。

---

### 2.7 `docs/upstream-pr/ysmparser-collecttomemory-pr.md` — 75 行一次性材料

**为什么可动**：单一文件目录，为上游 PR 准备的一次性材料，0 脚本引用。
**建议动作**：`git mv docs/archive/`。
**风险**：**极低**。

---

## 3. 明确不建议动的（避免下次重复评估）

| 对象 | 行数 | 为什么不动 |
|---|---|---|
| **`docs/adr/ADR-*.md` 的 304 份「已采纳」** | 22k | **史书**。ADR 是决策记录，删 = 抹除决策依据。`ADR-320:39` 明写「存量保持原位不迁移（历史编号是稳定锚点，搬迁收益低于断链风险）」。**含 3 份 🧊已废弃也应留**——它记录了「为什么这条路不走」，正好防止后人重走 |
| **`docs/adr/index.md`** | 702 | **生成物**，`gen-docs-index.ts` 产出。实测自洽：称 ADR **326** 篇 = 实测 `ADR-*.md` **326** 份，状态分布与逐份核对一致（提议 4 / 采纳 299 / 部分 13 / 取代 7 / 废弃 3）。**这是全仓最健康的文档之一** |
| **`docs/releases/` 8 文件** | 5k | 有**机器契约**：`release-notes-gen.ts:145` 规定「每个 `vX.Y.Z` tag 必须有对应 `docs/releases/vX.Y.Z.md`」，`--check` 进 CI。是史书**且**被脚本消费 |
| **`docs/knowledge/` 整体** | 27k | **活文档体系**：`check-knowledge-drift` 机器校验（frontmatter / source_files 存在性 / 状态词表 / 符号漂移）。grep 出的「重复组」（go-37 张、app-12 张）是**按源码模块切分的正常粒度**，非冗余 |
| **`docs/cli-commands.md` / `event-graph.md` / `audit-src-map.md`** | 865 | **全是生成物**，有 `--check` 防漂移。`event-graph.md` 492 次提交正是每提交自动重生成的证据 |
| **`docs/UI-Design.md`** | 734 | 自述「**唯一规范**」，19 个消费者（含 `scripts/_lib/design-tokens.ts`、`check-design-tokens.ts` 等**机器消费者**）+ `skills/3d-ui-DESIGN.md` |
| **`docs/guide/` 30 文件** | 1.4k | 面向**人类用户**的入口，平均 48 行/篇——**正是「精准简练」的正面样本**，无冗余空间 |
| **`docs/preview-menu-overview.md`** | 320 | **教科书级正面样本**：L5 与 L232 两处主动声明「**不记用例数/性能实测等快照数字**（那类必然漂移，要数字直接跑 vitest/doctor）」。**建议把它作为全仓顶层文档的写作范式**（对照 §2.1 的 `architecture.md`） |
| **`docs/drafts/ground-design-exploration.md`** | 142 | 唯一草稿，`last=2026-10-05`（当天），**活跃**，是 ground 未收口项的探索记录 |
| **`.doc-next-steps.md`** | 11 | 生成物，且 `link-checker.ts:28` 特意把它列入 `SKIP_FILES` 白名单 |
| **`docs/novel/`** | 379 | 独立子项目（`docs/novel/AGENTS.md` 自管辖），与本仓文档体系无关 |

**特别澄清（纠正任务前提）**：任务书称「`docs/preview-menu-overview.md` 证实称 29 个测试文件、实际 25 个」——**实测不成立**。该文件是**全仓唯一明文拒绝写快照数字的文档**（见上）。真实漂移发生在 `docs/architecture.md`（称 `internal/app/` 29 文件，实测 **90**），见 §2.1。结论相同（存在漂移），**但病灶位置不同**，请勿据此修改 `preview-menu-overview.md`。

---

## 4. 最值得先做的 3 件事

### ① 修 `docs/architecture.md` 的硬编码数字与死链 ✅ **已完成（2026-10-05，933→908 行）**

见 §2.1。结论仍是本轮最有代表性的一条：**要数字直接跑命令，不写死在文档**。

### ② 迁出 5 张 `status: snapshot` 知识卡（`docs/knowledge/` → `docs/archive/`）⏳ 待做
**成本**：分批 `git mv` + 改链 | **收益**：2,622 行离开活文档目录；**执行的是仓库自己已立的规矩**（`AGENTS.md:50`），不是新增规则 | **风险**：高，但**已有成文操作规程**（`AGENTS.md:51`「迁出前三查」）与血案教训（`go/cli/perf.go` 44 提交红灯）**
先做引用最少的 `frontend-design-debt.md`（83 行）与 `frontend-test-audit.md` 试水，验证链路无误再批量。

### ③ 合并 audit 报告为一份归档件 🔄 **起步已完成（零引用那份，见 §2.2）；其余待做**

**成本**：中 | **收益**：顶层行数下降；消除互引成环 | **风险**：中，需先处理入链硬引用

**已完成**：`audit-env-design-critique.md`（0 引用）→ 并入 `audit-env-review.md` §5 + 归档。
合并流程已验证可行（改内部指向 → git mv → 头部加归档注记 → 门禁绿）。

**待做**：其余四份 `audit-*-critique/review.md` 互引成环，**读者要读五份才能拼出一次审计的全貌**。
⚠️ 动前必须处理 3 处入链：`water.md:337`（引 water-critique）、`ADR-322:37`（引「九章第⑤条」，
**编号是硬锚点**）、`preview-env-state.md:261`（引 postprocessing-critique）。
建议把被引用的**不变量**提炼进对应知识卡，把未收口项立 ADR，再归档。

---

## 附：审计方法与边界
- 引用计数**已排除** `docs/.vitepress/dist/`（构建产物，会把每个数字抬高数倍）与 `node_modules`；表中标注 `引用` 列为非 dist 的手写文件数。
- 「已取代/已废弃/部分采纳/提议中」由逐份读 frontmatter 首部 25 行统计，非按标题猜测。
- `docs/knowledge/` 的孤儿卡扫描（11 张零互链卡：`ai-review-pitfalls` / `css-token-check` / `debt_ledger_refresh` / `doctor-gate-overlap` / `dom-storage` / `experience` / `frontend-design-debt` / `go-ccheck` / `go-testutil` / `icon-kit` / `mc-ao-tint`）为**弱信号**，未列入可动清单——`check-knowledge-drift` 的存在说明「卡的价值由 `source_files` 覆盖 + `use_when` 检索承担，不靠互链」，零互链 ≠ 死卡。仅 `frontend-design-debt`（`status: snapshot`）因另有规约依据而进入 §2.4。
- **本审计未修改任何文件。**
