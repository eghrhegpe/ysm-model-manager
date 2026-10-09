#!/usr/bin/env node
/**
 * baseline-guard.ts — 「基线是否有意义」的**单一实现**（零依赖纯函数）。
 *
 * 设计意图（2026-10-09 审核体系锐评 · 第二刀）：
 *   假绿的第一大成因不是「判据写错」，而是**判据的输入是空的却与真通过同形**。最典型的一例
 *   （2026-10-08 CI run 37806261054 实证）：CI 在 push **之后**跑，checkout 的 HEAD 与 fetch
 *   到的 origin/main 指向同一提交 ⇒ `git diff origin/main...HEAD` 为空 ⇒ 门禁输出
 *   「本次无改动源码需要检查。通过。」exit 0——**与「真通过」不可区分**。前后端两个
 *   diff-coverage 门禁同时中招，于是有了这段守卫；但它当时被**逐字复制成两份**（一份在
 *   check-diff-coverage.ts、一份在 check-go-diff-coverage.ts），第三份、第四份 diff 型门禁
 *   随时可以再漏一次——本仓「改一处漏三处」的老病。
 *
 *   本模块把那 27 行判据收成一处：任何以「与某基线做 diff」为输入的门禁，只需把已解析的
 *   oid 喂进来，拿回「能不能判」的结论。**判据单一实现，文案单一起源**——文案里
 *   「基线无意义 / 与 HEAD 是同一提交 / 变更集必为空 / 基准分支不可达 / 无法解析 HEAD」
 *   是既有契约测试锚定的字符串，回退/重写文案会立刻红灯（tests/test_check_diff_coverage.ts
 *   + tests/test_baseline_guard.ts 双向锁）。
 *
 * 依赖：零依赖（纯逻辑，不碰 git —— oid 由调用方用各脚本自己的 git 助手解析）。
 *
 * 用法：
 *   import { checkBaselineMeaningful, CHANGED_NULL_REASON } from './_lib/baseline-guard.ts';
 *   const v = checkBaselineMeaningful({
 *     headOid, baseOid, base, staged, uncommitted, filesMode: Boolean(args.files),
 *   });
 *   if (!v.ok) failOrWarn(v.reason);      // 各脚本自己的 fail-or-suggest 出口（exit 2 / 建议模式 exit 0）
 *
 * 退出码：本模块无独立 CLI（被 check-diff-coverage / check-go-diff-coverage import）。
 */

/** 判定结果：ok=false 时 `reason` 可直接交给调用方的 failOrWarn。 */
export type BaselineCheck = { ok: true } | { ok: false; reason: string };

export interface BaselineGuardInput {
  /** `git rev-parse HEAD` 的结果（null/空 = 解析失败：不在仓库 / git 环境异常）。 */
  headOid: string | null | undefined;
  /** `git rev-parse --verify <base>^{commit}` 的结果（null/空 = 基线不可达）。 */
  baseOid: string | null | undefined;
  /** CLI 传入的基线名（仅用于文案，如 origin/main / HEAD~1）。 */
  base: string;
  /** `--staged`：索引 vs HEAD，无「基线」语义，跳过可达性与同一性判据。 */
  staged: boolean;
  /** `--uncommitted`：工作区 vs HEAD，同上。 */
  uncommitted: boolean;
  /** `--files`：完全不依赖 git 上下文，整段跳过（调用方也可自行提前 return）。 */
  filesMode?: boolean;
}

/** `git diff` 执行失败（返回 null）时的统一文案：拒绝把「没查到」当成「没问题」。 */
export const CHANGED_NULL_REASON = "git diff 执行失败（对象/索引异常），拒绝空跑放行";

/**
 * 判断当前 diff 输入是否**具备判定意义**。
 *
 * 判据顺序（与出问题时的报错顺序一致，先报最根因）：
 *   1. `--files` 模式 → 无 git 上下文，直接放行（本函数不适用于该模式的自检）；
 *   2. HEAD 不可解析 → 无法判定；
 *   3. 非 staged 且基线不可达 → 无法判定（提示 fetch / --base）；
 *   4. 非 staged 且非 uncommitted 且 base oid == HEAD oid → **假绿高危**：变更集必为空，
 *      必须显式报错而**不能**任其落入「本次无改动源码 ⇒ 通过」分支。
 *
 * 第 4 条用 commit oid 比对而非字符串比对：`origin/main` 与 `HEAD` 字面不同却可能同 oid。
 */
export function checkBaselineMeaningful(input: BaselineGuardInput): BaselineCheck {
  const { headOid, baseOid, base, staged, uncommitted, filesMode } = input;
  if (filesMode) return { ok: true };
  if (!headOid) {
    return { ok: false, reason: "无法解析 HEAD（git 环境异常/不在仓库内）" };
  }
  if (!staged && !baseOid) {
    return {
      ok: false,
      reason: `基准分支不可达：${base}（请先 \`git fetch\` 或改用 --base 指向本地分支）`,
    };
  }
  if (!staged && !uncommitted && headOid === baseOid) {
    return {
      ok: false,
      reason:
        `基线无意义：--base ${base} 与 HEAD 是同一提交（${headOid.slice(0, 12)}）⇒ 变更集必为空。` +
        `请传 HEAD 之前的基线（CI 用 \`changes\` job 解析出的 base；本地用 --uncommitted/--staged）。`,
    };
  }
  return { ok: true };
}
