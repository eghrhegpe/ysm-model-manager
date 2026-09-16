# ADR-256：设计令牌门禁改判真行级：判定与账本分离（行号位移幻影实证，复算见 §4）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`scripts/check-design-tokens.ts, scripts/_lib/diff-source.ts, scripts/_lib/git-hunks.ts, .githooks/pre-commit, scripts/_lib/gate-config.ts, scripts/token-shift-audit.ts, docs/knowledge/pre-commit-hook.md`

---

## 1. 背景（Context）

该闸（2026-09 立）的门禁口径是**基线文件级判定**：基线键 = `file:line:kind`，判「当前违规键 − 基线键 = 新增」（「只减不增」）；接线三处——pre-commit 硬阻断③、`_lib/gate-config.ts` 的
FRONTEND / ALL_STATIC_TOOLS。

**行号入键同时制造噪声与盲区**（2026-09 用 `scripts/token-shift-audit.ts` 量算 116 个提交窗口）：

- **幻影（误伤）**：任何行位移都会把下方存量违规换成新行号 → 判「新增」。
  `token-shift-audit.ts --window 120`（116 提交样本）实测：added **330** 条中 **322 条（97.6%）**
  在父版本 ±80 行内能找到同 kind 近邻；阻断视角：24 次阻断里 **19 次（79%）行级命中为 0**，
  而行级规则总共只在 9 次上阻断（8%）。典型全幻影提交：`88ddb1ec`（69 条）、`6cec6a18`（57 条）、
  `4ea0a214`（48 条）——多为批量迁移 / 重排 / 图标替换类改动。
- **盲区（漏检）**：新增违规恰好落在旧违规的同行号上 → 键相同 → 判「非新增」。
  这是**机制性**风险（同行替换同类违规，如 `color:#abc` → `color:#fff`）；本次窗口实测
  「键碰撞漏检」**0 次**（工具已单列该指标，见 §4），故不作主要论据——但行级判定天然免疫。
- 量算以**父提交快照当基线**（理想基线，比冻结基线更宽松），故上述幻影占比是**下界**：
  真实基线愈旧，幻影愈多。现场实例：一次不含任何前端文件的 docs 提交，被并行会话未提交
  改动造成的 21 条幻影 exit 1（同文件同 kind，added 21 / gone 22 —— 纯位移签名）。

结论：这不是「严格 vs 宽松」的取舍，而是**高噪声 + 机制性盲区**；既拦的提交里 baseline 要求的
条数是真新增的 median 3.25×（mean 4.4×），且 pre-commit 必须扫全树（frontend/src + frontend/css）。

## 2. 决策（Decision）

**D1 判定与账本分离**：门禁判定 = **真行级**（只判本次变更新增行上的违规）；
`scripts/baseline/design-tokens-baseline.json` 降级为**债务账本**，只供 `doctor` 报告 / 收债排期，
**不再参与判定**。理由：行级判定天然不需要基线，幻影与键碰撞盲区同时消失；
账本继续承担它本来的职责——存量债务度量。

**D2 统一口径（单一事实源）**：pre-commit（索引源）与 pre-push / CI（range 源）共用同一实现
（`_lib/diff-source.ts` 取 diff 与内容 + `_lib/git-hunks.ts|addedLinesFromDiff` 取新增行 +
`_lib/design-tokens.ts|findViolationsOnLines` 判违规），新增 `--added-lines` 模式；
判定语义只有一个实现点，避免两处漂移。

**D3 内容取提交侧 blob**（索引 `:path` / `<rev>:path`），**不读工作区**：判定对象 == 提交对象，
顺带消灭「磁盘 ≠ 提交」错位（原 `--staged` 的「未暂存编辑守卫」因此退化为不需要）。

**D4 废止「碰过的文件顺带清债」政策**：位移即放行，存量债由账本 + 收债排期驱动，
不在提交时刻强制。理由：该政策在真实历史里 95% 产出噪声，且可被 `--update-baseline` 或逃生键
轻易绕过——治理收益低于摩擦成本。

**D5 阻断强度暂维持 `debt`**：先在 push / CI 观察一轮无假阻断，再议是否升 `hard`。

## 3. 后果（Consequences）

**正面**：位移幻影归零（纯位移提交判 0 条）；键碰撞盲区消失（同行替换同类照样命中）；
pre-commit 由全树扫描降为只扫新增行（秒级承诺更稳）；门禁不再依赖基线文件存在
（少一类 fail-closed 失败面）；与 biome 行级闸（`check-biome-lines.ts`）同哲学，
「只对自己动过的行负责」成为全仓统一口径。

**负面**：放开「碰过的文件」里的存量债——存量收敛节奏转由账本与收债排期驱动，
不再由提交时刻强制；须保持「账本只许全库刷新」纪律（防重建基线洗债）。

**已知遗留**：`--files`（显式清单）模式仍读工作区内容——pre-push 时若工作区脏，
判定对象与推送对象仍可能错位（未纳入本次决策）；`--baseline` 保留给 `--all` / CI 全量诊断与账本刷新。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `scripts/token-shift-audit.ts --window 120`（只读，可复查） | 样本 116 提交 / 587 文件；added 330；位移幻影 322（**97.6%**）；真新增候选 8 |
| 同上（阻断视角） | baseline 会阻 24 次（21%），其中纯幻影 19 次（79%）；行级会阻 9 次（8%） |
| 同上（代价侧） | 两规则都拦时：baseline 条数 / 行级条数 = median 3.25× / mean 4.4× |
| 同上（盲区侧） | 键碰撞漏检 **0 次**（机制存在、本窗口未现；指标已固化，后续窗口可复查） |
| 现场 | 不含前端文件的 docs 提交被并行会话位移造成的 21 条幻影 exit 1（`tpl-settings.ts`；其中 20 条纯幻影 + 1 条落在被重写的 hunk 内） |

一次性探针（未入库）：`%TEMP%\token-shift-probe.ts`、`%TEMP%\token-shift-verify.ts`；
固化后的可复查入口即上表第一行的 `scripts/token-shift-audit.ts`。

<!-- 文件名: design-tokens-added-lines.md → 实际文件 ADR-256-design-tokens-added-lines.md -->
