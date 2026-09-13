# ADR-232：scripts 与 hooks 并发竞态/审计留痕/退化降级修复

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`.githooks/pre-commit`、`.githooks/post-commit`、`scripts/_lib/gate-audit.ts`、`scripts/gate-audit-reconcile.ts`、`tests/test_hooks_concurrency.ts`

---

## 1. 背景（Context）

2026-09-13 锐评发现 hooks/scripts 体系三处结构性病灶，均源于「多 AI 并发共享 checkout」
的真实运行场景与代码假设的自相矛盾：

1. **P1-1 并发竞态**：`pre-commit` 写 `.git/ysm_gen_staged`（last-writer-wins 单文件）→
   `post-commit` 消费同一清单；并发两次 commit 时 B 覆盖 A 的清单，A 的生成物残留被 B
   误清（或 B 的残留滞留）。`/tmp/ysm_gen_to_stage.txt` 亦无进程后缀，并发互踩。
2. **P1-3 逃生不留痕 + 文案误导**：`YSM_SKIP_BIOME_LINES` 等 pre-commit 逃生键命中时
   零审计记录；而文案把 `YSM_SKIP_*`（钩子仍执行，可留痕）与 `--no-verify`（钩子不执行，
   不可检测）混为一谈，误导「用 YSM_SKIP_* 也没事」。
3. **P1-2 审计锚点建在会消失的数据上**：`gate-audit-reconcile` 以远端跟踪 reflog
   （`git reflog show origin/<branch>`）为推送事件锚点。远端跟踪 reflog 在 fetch/pull 时
   滚动（90 天过期 GC 清空历史、clone 不带），窗口内 reflog 缺失时把「正常 GC」误报成
   「--no-verify 缺口」。
4. **P2-4 post-commit 判定基于「HEAD 此刻」**：L32 `git diff --quiet HEAD -- $p` 在并行
   会话刚 commit 同文件时误判（HEAD 已变 → 非空 → 跳过清理 → 残留滞留），与 P1-1 同根。

## 2. 决策（Decision）

### D1（P1-1/P2-4）：按 commit 配对生成物清单

- `pre-commit` 写 `.git/ysm_gen_staged_<HEAD_oid>`（commit 时 HEAD 即本次将被 commit 的
  父 oid——git 语义保证，commit 后 HEAD 前进才变；两并发会话父 oid 不同天然互不覆盖）。
- `post-commit` 以 `git rev-parse HEAD~1`（本次 commit 的父 oid）定位本会话清单，清完删除；
  同时顺带清理超过 48h 的孤儿清单（并发中途崩溃遗留）。
- 判定锚点换为 **本次 commit 对象**：对清单内文件比 `git diff --quiet HEAD~1..HEAD -- $p`
  （HEAD 已变也无所谓——commit 不可变对象永在），替代 P2-4 的「HEAD 此刻」判定。
- `/tmp/ysm_gen_to_stage.txt` 加 `$$` 后缀（与既有 `GEN_SNAP_$` 规范对齐）。

### D2（P1-3）：pre-commit 逃生留痕 + 文案纠正

- 新增 `scripts/_lib/hook-audit.ts`：`appendHookAudit(entry)` 追加 `.git/gate-audit.log`
  的 `SKIPPED_PRECOMMIT` 行（6 列，oid=HEAD~1 前 12 位，与 PUSH/SKIPPED 同格式可 grep）。
- `.githooks/pre-commit` 的 `YSM_SKIP_BIOME_LINES` / `YSM_SKIP_ANDROID` 命中逃生时调用
  该模块留痕（钩子仍执行 → 留痕必然发生，不留死区）。
- 修正文案：`YSM_SKIP_*` 命中即留痕（可审计）；只有 `--no-verify` 是零痕迹（reconcile
  靠 HEAD 连续性推断，非直接检测）。
- doctor `--audit-check` 对账把 `SKIPPED_PRECOMMIT` 纳入「已审计」口径（它们不是缺口）。

### D3（P1-2）：reconcile 退化降级而非误报

- 新增 `scripts/_lib/audit-degraded.ts`：`isReflogDegraded(windowDays)` 判定退化条件——
  远端 ref 存在但 reflog 无窗口内条目（GC 过期/GC 清空/新 clone 远端 ref 无 push 事件
  历史）。
- `gate-audit-reconcile` 退化时不报缺口（避免把正常 GC 误判为绕过），而是输出
  `[DEGRADED]` 行说明数据源退化，**退出码 0**（reconcile 是观测工具，不是门禁判定；
  门禁判定在 pre-push-gate 本体，数据退化不构成推送阻断理由）。`--json` 输出
  `degraded: true` 供消费方区分「真缺口」与「数据缺失」。
- 非退化时行为完全不变（缺口 = FAIL exit 1，既有契约测试不回归）。

## 3. 后果（Consequences）

**正面**
- 并发共享 checkout 下生成物残留清理不再互踩（D1 父 oid 配对 + commit 对象不可变性）。
- 逃生全留痕：`gate-audit.log` 成为「所有绕过尝试」的完整审计流（PUSH / SKIPPED /
  SKIPPED_PRECOMMIT 三态），`--no-verify` 唯一例外（git 语义边界，头注释已声明）。
- reconcile 不再把正常 GC/新 clone 误报成绕过，审计可信度提升。

**负面 / 已知遗留**
- `.git/` 下新增 `ysm_gen_staged_<oid>` 与孤儿清理，git 目录略增（48h TTL 控制）。
- 老版本 `.git/ysm_gen_staged`（无 oid 后缀）遗留文件不读不删（新代码只认带 oid 的）；
  由 48h 孤儿清理顺带回收（命名不匹配 → 不被识别，48h 后随孤儿清理？否——孤儿清理只清
  `ysm_gen_staged_*` 前缀，旧单文件无此名，需一次性 `rm` 或留待 git gc 不管（.git 内文件
  不受 git 管，无碍）。
- `SKIPPED_PRECOMMIT` 行 oid 用 HEAD~1（commit 前父 oid）而非最终 commit oid（commit 前
  不知道）——reconcile 侧按 12 位前缀匹配时，SKIPPED_PRECOMMIT 的 oid 与后续 PUSH 行 oid
  可能不同（这是设计内的，reconcile 只看「有无记录」不看 oid 相等，口径已注明）。

## 4. 数据溯源

<!-- 来源 → 结果 -->
- 锐评 P1-1/P1-2/P1-3/P2-4（2026-09-13 会话）→ D1/D2/D3 三方向。
- 实证：`.git/logs/refs/remotes/` 4 remote 中 3 个 reflog 0 字节、origin 227K
  （退化条件真实存在，非理论）。
- 测试契约：`tests/test_hooks_concurrency.ts`（D1 清单配对 + D2 留痕 + D3 退化降级三块
  断言），经 `contract-tests` 登记后 pre-push 兜底。
